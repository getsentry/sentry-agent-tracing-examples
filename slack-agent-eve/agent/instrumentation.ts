import * as Sentry from "@sentry/node";
import { callSlackApi } from "eve/channels/slack";
import { defineInstrumentation, isChannel } from "eve/instrumentation";
import { z } from "zod";
import slack from "./channels/slack";
import { AGENT_NAME } from "./lib/agent-name";
import { activeTraceId, conversationForTrace, rememberConversation } from "./lib/conversation";

interface SlackIdentity {
  channelId?: string;
  threadTs?: string;
  userId?: string;
}

const slackSessionIdentity = new Map<string, SlackIdentity>();

// Env-first configuration, so the same file works from local dev to a real
// deployment without edits. Absent vars fall back to demo-friendly defaults.
// Same spellings the other two demos accept, so one documented value turns a
// direction off in every app.
const DISABLED_FLAG_VALUES = new Set(["false", "0", "no", "off"]);

function envFlag(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  return !DISABLED_FLAG_VALUES.has(raw.trim().toLowerCase());
}

function envRate(name: string, fallback: number): number {
  const raw = process.env[name];
  // `Number("")` is 0, so an empty assignment would otherwise read as "sample
  // nothing" and silently switch tracing off.
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback;
}

const recordInputs = envFlag("SENTRY_AI_RECORD_INPUTS", true);
const recordOutputs = envFlag("SENTRY_AI_RECORD_OUTPUTS", true);

interface SlackUserProfile {
  username?: string;
  email?: string;
}

// Slack user id → profile for Sentry.setUser enrichment. A `null` entry is
// the failure cache: a missing users:read scope fails once per user per
// process, not once per step.
const slackUserProfiles = new Map<string, SlackUserProfile | null>();

// Isolation scopes whose users.info call has not come back yet.
const slackProfileWaiters = new Map<string, Set<Sentry.Scope>>();

const usersInfoSchema = z.looseObject({
  ok: z.boolean(),
  // Slack reports `missing_scope` and friends here, with HTTP 200 and ok:false.
  error: z.string().optional(),
  user: z
    .looseObject({
      name: z.string().optional(),
      profile: z
        .looseObject({
          display_name: z.string().optional(),
          real_name: z.string().optional(),
          email: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
});

interface SlackUserContext {
  id: string;
  username?: string;
  email?: string;
}

function applySlackUser(scope: Sentry.Scope, userId: string): void {
  const profile = slackUserProfiles.get(userId);
  const user: SlackUserContext = { id: userId };
  // `username` is what the Logs pipeline emits as user.name and what the
  // Conversations/Issues User column prefers over the raw id.
  if (profile?.username) user.username = profile.username;
  if (profile?.email) user.email = profile.email;
  scope.setUser(user);
}

// The step hook is synchronous, so users.info cannot be awaited before the
// turn's first spans open. It does not need to be: Sentry reads a span's
// isolation scope when the span ends, so re-applying the profile on arrival
// still puts the display name on spans that were already in flight. This
// matters for the first turn a process handles — Explore > Conversations
// takes its User column from the earliest span alone, so losing that one
// span shows the whole conversation under a raw Slack id.
function trackSlackProfile(userId: string, scope: Sentry.Scope): void {
  applySlackUser(scope, userId);
  if (slackUserProfiles.has(userId)) return;

  const waiting = slackProfileWaiters.get(userId);
  if (waiting) {
    waiting.add(scope);
    return;
  }
  slackProfileWaiters.set(userId, new Set([scope]));

  void callSlackApi({
    botToken: undefined, // falls back to env SLACK_BOT_TOKEN
    operation: "users.info",
    body: { user: userId },
  })
    .then((response) => {
      const parsed = usersInfoSchema.safeParse(response);
      if (!parsed.success) throw new Error("users.info returned an unrecognised shape");
      if (!parsed.data.ok) throw new Error(`users.info failed: ${parsed.data.error ?? "unknown"}`);
      const user = parsed.data.user;
      if (!user) throw new Error("users.info returned ok with no user");
      slackUserProfiles.set(userId, {
        username: user.profile?.display_name || user.profile?.real_name || user.name,
        email: user.profile?.email,
      });
    })
    .catch((error) => {
      // Non-fatal: id-only user context still applies. Captured because a
      // missing users:read scope is otherwise invisible — every user would
      // just keep showing up under a raw Slack id.
      Sentry.captureException(error);
    })
    .finally(() => {
      if (!slackUserProfiles.has(userId)) slackUserProfiles.set(userId, null);
      for (const waiter of slackProfileWaiters.get(userId) ?? []) {
        // A scope that has moved on to another turn is left alone: step.started
        // rewrites the user on every step, and this reply can land after it.
        if (waiter.getUser()?.id !== userId) continue;
        applySlackUser(waiter, userId);
      }
      slackProfileWaiters.delete(userId);
    });
}

export default defineInstrumentation({
  // Names the agent in Sentry's AI views.
  functionId: AGENT_NAME,
  // Runs at server startup, before any agent code. Sentry.init registers a
  // global OpenTelemetry tracer provider, so eve's AI SDK telemetry spans
  // (ai.eve.turn > ai.streamText > ai.toolCall) go to Sentry's exporter.
  setup: () => {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.SENTRY_ENVIRONMENT ?? process.env.VERCEL_ENV ?? "development",
      tracesSampleRate: envRate("SENTRY_TRACES_SAMPLE_RATE", 1.0),
      // Vercel Workflow's own spans for calls the http and fetch integrations
      // already cover. These are the names eve sets; Sentry rewrites them to
      // `METHOD target` after this test runs.
      ignoreSpans: [
        { name: "workflow.route.flow" },
        { name: /^http (GET|POST|PUT|PATCH|DELETE|HEAD)$/ },
        { name: "workflow.stream.write" },
        { name: "workflow.stream.read.connect" },
      ],
      // Only the categories to switch off; the rest stay on. Inbound request
      // bodies also need httpIntegration's maxIncomingRequestBodySize.
      // https://docs.sentry.io/platforms/javascript/guides/node/configuration/options/#dataCollection
      // https://docs.sentry.io/platforms/javascript/guides/node/configuration/integrations/http/#maxincomingrequestbodysize
      dataCollection: {
        httpHeaders: { request: false, response: false },
        httpBodies: [],
        cookies: false,
        urlQueryParams: false,
        graphQL: { document: false, variables: false },
        stackFrameVariables: false,
      },
      // Only streamed spans reach the ingest pipeline that derives `gen_ai.*`
      // ops from span attributes.
      // https://docs.sentry.io/platforms/javascript/guides/node/configuration/options/#tracelifecycle
      traceLifecycle: "stream",
      // The trace record wins over the conversation id already on the span:
      // eve opens the turn span before step.started runs, so it can arrive
      // carrying the previous turn's id.
      //
      // withStreamedSpan is required — a bare callback silently downgrades
      // traceLifecycle to 'static'.
      beforeSendSpan: Sentry.withStreamedSpan((span) => {
        const attributes = span.attributes;
        if (!attributes) return span;
        // eve names its agent span after the model it called, not the agent.
        // The attribute holds the real one, including a delegated subagent's.
        if (span.name.startsWith("invoke_agent ")) {
          const agent = attributes["gen_ai.agent.name"];
          span.name = `invoke_agent ${typeof agent === "string" ? agent : AGENT_NAME}`;
        }
        const conv = conversationForTrace(span.trace_id);
        if (!conv) return span;
        const isConversationSpan =
          attributes["gen_ai.conversation.id"] !== undefined ||
          attributes["gen_ai.operation.name"] !== undefined ||
          /^(chat|generate_content|invoke_agent|execute_tool|embed) /.test(span.name);
        if (!isConversationSpan) return span;
        attributes["gen_ai.conversation.id"] = conv.conversationId;
        if (conv.userId) attributes["user.id"] = conv.userId;
        return span;
      }),
      // Logs are domain wide events only (meal.option.presented and
      // meal.pick.added in the tools) — the mechanical record (tool args,
      // tokens, models) already lives on the auto-instrumented spans; logs
      // add the business layer spans can't carry.
      enableLogs: envFlag("SENTRY_ENABLE_LOGS", true),
      // eve registers @ai-sdk/otel itself and emits the full gen_ai.* tree.
      // VercelAI, a default integration, subscribes to the same telemetry over
      // the ai:telemetry channel and opens a second tree beside it, carrying
      // the same gen_ai.usage.* — which doubles every token in the spend
      // dashboard and the AI detectors. eve's telemetry has no off switch
      // (`otelSettings` is enabled by this file existing), so this is the copy
      // that goes.
      integrations: (defaults) =>
        defaults.filter((integration) => integration.name !== "VercelAI"),
    });
  },
  // eve's own capture switches (they gate what eve's telemetry puts on
  // spans), driven by the same env flags read above.
  recordInputs,
  recordOutputs,
  events: {
    "step.started"(input) {
      // Only a turn's first step arrives with kind channel:slack — the
      // continuation steps after each tool result come through eve's internal
      // workflow queue — so the Slack identity is cached per session. Without
      // the cache every span after step 1 loses its thread and user.
      let identity: SlackIdentity | undefined;
      if (isChannel(input.channel, slack)) {
        const { channelId, threadTs, triggeringUserId } = input.channel.metadata;
        identity = {
          channelId: channelId ?? undefined,
          threadTs: threadTs ?? undefined,
          userId: triggeringUserId ?? undefined,
        };
        slackSessionIdentity.set(input.session.id, identity);
      } else {
        identity = slackSessionIdentity.get(input.session.id);
      }
      const channelId = identity?.channelId;
      const threadTs = identity?.threadTs;
      const userId = identity?.userId;
      // One eve session is one Slack thread or one local conversation, across
      // every turn in it; a delegated subagent runs in its own session, so the
      // root is what keeps a delegation in the conversation that started it.
      const conversationId =
        threadTs ?? input.session.parent?.rootSessionId ?? input.session.id;
      // This callback runs on the same execution path as the step's model
      // call, so isolation-scope state set here lands on the AI spans that
      // follow: setConversationId stamps gen_ai.conversation.id on each one
      // (grouping the conversation in Explore > Conversations), the tag puts
      // the same id on error events, which carry tags rather than span
      // attributes, and setUser fills that view's User column.
      //
      // Every step rewrites all of it, the empty user included: one process
      // serves both Slack and the local TUI, and an isolation scope outlives
      // the turn that wrote to it.
      const isolationScope = Sentry.getIsolationScope();
      Sentry.setConversationId(conversationId);
      isolationScope.setTag("gen_ai.conversation.id", conversationId);
      if (userId === undefined) isolationScope.setUser(null);
      else trackSlackProfile(userId, isolationScope);
      // Handoff for beforeSendSpan above, which may run in eve's replay
      // context (separate module instance) where this scope isn't reachable.
      // The channel id rides along for a second reader: it is the only trusted
      // destination the card tools have (activeSlackThread).
      const traceId = activeTraceId();
      if (traceId !== undefined)
        rememberConversation(traceId, { conversationId, channelId, threadTs, userId });
      if (identity === undefined) return undefined;
      return {
        runtimeContext: {
          // Lands on every AI span namespaced by eve + Sentry as
          // ai.settings.context.slack.channel_id / .slack.user_id.
          "slack.channel_id": identity.channelId ?? "",
          "slack.user_id": identity.userId ?? "",
        },
      };
    },
  },
});
