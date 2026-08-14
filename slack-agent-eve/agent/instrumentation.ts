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

const GEN_AI_SPAN_OPS = [
  ["invoke_agent ", "gen_ai.invoke_agent"],
  ["execute_tool ", "gen_ai.execute_tool"],
  ["chat ", "gen_ai.chat"],
] as const;

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
  // (ai.eve.turn > ai.streamText > ai.toolCall) flow straight into Sentry.
  setup: () => {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.SENTRY_ENVIRONMENT ?? process.env.VERCEL_ENV ?? "development",
      // Without a release Sentry cannot mark regressions, attribute an issue
      // to a deploy, or resolve suspect commits.
      release: process.env.SENTRY_RELEASE ?? process.env.VERCEL_GIT_COMMIT_SHA,
      tracesSampleRate: envRate("SENTRY_TRACES_SAMPLE_RATE", 1.0),
      // Only the categories to switch off; the rest stay on. Inbound request
      // bodies also need httpIntegration's maxIncomingRequestBodySize.
      // https://docs.sentry.io/platforms/javascript/guides/node/configuration/options/#dataCollection
      // https://docs.sentry.io/platforms/javascript/guides/node/configuration/integrations/http/#maxincomingrequestbodysize
      dataCollection: {
        genAI: { inputs: recordInputs, outputs: recordOutputs },
        httpHeaders: { request: false, response: false },
        httpBodies: [],
        cookies: false,
        urlQueryParams: false,
        graphQL: { document: false, variables: false },
        stackFrameVariables: false,
      },
      // Default segment export, which sends a turn's spans while the request
      // is still open — required on Vercel, where the function freezes as soon
      // as it responds and anything still buffered is lost. This only works
      // because eve >= 0.32 marks each step's restored context remote
      // (vercel/eve#1855), so every step forms its own exportable segment.
      //
      // A step's spans can still be created outside the isolation scope that
      // setConversationId below writes to, so the conversation id is settled
      // here as well, looked up by the turn's trace id — the one key this
      // callback and step.started share, and the reason a local TUI turn is
      // not labelled with the Slack turn before it.
      //
      // The trace record wins over whatever is already on the span, and an
      // already-stamped span is inspected even when its op says nothing about
      // gen_ai. Both are needed because eve opens the turn span before
      // step.started runs: the SDK's ConversationId integration stamps that
      // span at spanStart (its raw name `ai.eve.turn` matches the "ai." rule)
      // from an isolation scope this turn has not corrected yet, so it can
      // arrive here carrying the previous turn's thread under the description
      // `eve.turn` and op `default`. Assigning `undefined` drops the key when
      // the turn has no thread.
      beforeSendSpan: (span) => {
        // eve's spans arrive with no op of their own. Ingest normalises the
        // model-call ones to `gen_ai`, but leaves agent and tool spans at
        // `default`, so all three are derived here to the `gen_ai.<operation>`
        // shape Sentry's own AI processors write. Drop this once ingest covers
        // agent and tool spans too.
        if (span.op === undefined || span.op === "default") {
          const derived = GEN_AI_SPAN_OPS.find(([prefix]) =>
            span.description?.startsWith(prefix),
          );
          if (derived !== undefined) span.op = derived[1];
        }
        // eve names its agent span after the model it called, not the agent.
        if (span.op === "gen_ai.invoke_agent") {
          span.description = `invoke_agent ${AGENT_NAME}`;
          span.data["gen_ai.agent.name"] = AGENT_NAME;
        }
        const conv = conversationForTrace(span.trace_id);
        if (!conv) return span;
        const isConversationSpan =
          span.data["gen_ai.conversation.id"] !== undefined ||
          span.op?.startsWith("gen_ai") ||
          /^(chat|generate_content|invoke_agent|execute_tool|embed) /.test(span.description ?? "");
        if (!isConversationSpan) return span;
        span.data["gen_ai.conversation.id"] = conv.threadTs;
        if (conv.userId) span.data["user.id"] = conv.userId;
        return span;
      },
      // Logs are domain wide events only (meal.option.presented and
      // meal.pick.added in the tools) — the mechanical record (tool args,
      // tokens, models) already lives on the auto-instrumented spans; logs
      // add the business layer spans can't carry.
      enableLogs: envFlag("SENTRY_ENABLE_LOGS", true),
      // The VercelAI integration is a default one, and on this stack it is the
      // wrong producer. eve declares its own telemetry, which registers
      // @ai-sdk/otel and emits the full tree — so the integration's
      // diagnostics-channel subscriber opens a *second* gen_ai.* tree for the
      // same work, as a sibling of eve's under the same parent. The two are
      // not equivalent: eve's spans are the ones the model and tool HTTP calls
      // hang off, and the subscriber's copies are leaves. Both carry
      // gen_ai.operation.type:ai_client and identical gen_ai.usage.*, so
      // keeping both doubles every token in the spend dashboard and the AI
      // detectors.
      //
      // eve's telemetry cannot be switched off — `otelSettings` gates both
      // @ai-sdk/otel registration and eve's own tracer, and it is set by the
      // presence of this file (there is no isEnabled toggle) — so the
      // integration is what has to go.
      integrations: (defaults) =>
        defaults.filter((integration) => integration.name !== "VercelAI"),
    });
  },
  // eve's own capture switches (they gate what eve's telemetry puts on
  // spans) — driven by the same env flags as Sentry's dataCollection.genAI
  // so one setting governs content capture end to end.
  recordInputs,
  recordOutputs,
  // Wraps inbound Slack webhook requests in a SERVER span so each trace starts
  // at the HTTP edge instead of at the model call.
  traceChannelRequests: true,
  events: {
    "step.started"(input) {
      // Only a turn's first step arrives with kind channel:slack; the
      // continuation steps after each tool result are delivered through
      // eve's internal workflow queue with a different channel kind, so
      // their identity is cached per session — otherwise every span after
      // step 1 loses its conversation id and Explore > Conversations shows
      // only the beginning of each turn. In-process cache, keyed by session
      // and never pruned: one small entry per session for the process's life.
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
      // This callback runs on the same execution path as the step's model
      // call, so isolation-scope state set here lands on the AI spans that
      // follow. The Slack thread is the conversation: setConversationId stamps
      // gen_ai.conversation.id on every AI span (grouping the thread in
      // Explore > Conversations) and setUser fills that view's User column.
      // The matching tag puts the same id on error events, which carry tags
      // rather than span attributes.
      //
      // Every step rewrites all of it, the empty case included: one process
      // serves both Slack and the local TUI, and an isolation scope outlives
      // the turn that wrote to it, so anything left set here would label the
      // next turn with this one's thread and user.
      const isolationScope = Sentry.getIsolationScope();
      Sentry.setConversationId(threadTs ?? null);
      isolationScope.setTag("gen_ai.conversation.id", threadTs);
      if (userId === undefined) isolationScope.setUser(null);
      else trackSlackProfile(userId, isolationScope);
      // Handoff for beforeSendSpan above, which may run in eve's replay
      // context (separate module instance) where this scope isn't reachable.
      // A turn with no thread is recorded too — that record is what lets
      // beforeSendSpan strip a conversation id stamped before this ran.
      //
      // The channel id rides along for a second reader: it is the only
      // trusted destination the card tools have (activeSlackThread).
      const traceId = activeTraceId();
      if (traceId !== undefined) rememberConversation(traceId, { channelId, threadTs, userId });
      if (identity === undefined) return undefined;
      return {
        runtimeContext: {
          // Lands on every AI span namespaced by eve + Sentry as
          // vercel.ai.settings.context.slack.channel_id / .slack.user_id.
          "slack.channel_id": identity.channelId ?? "",
          "slack.user_id": identity.userId ?? "",
        },
      };
    },
  },
});
