import * as Sentry from "@sentry/node";
import { callSlackApi } from "eve/channels/slack";
import { defineInstrumentation, isChannel } from "eve/instrumentation";
import { z } from "zod";
import slack from "./channels/slack";
import { AGENT_NAME } from "./lib/agent-name";
import { conversationStash, setConversationStash } from "./lib/conversation";

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
      if (!parsed.success || !parsed.data.ok) return;
      const user = parsed.data.user;
      if (!user) return;
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
      // One switch for gen_ai content capture — the integration reads these
      // as its defaults, so no per-integration recordInputs/recordOutputs.
      dataCollection: { genAI: { inputs: recordInputs, outputs: recordOutputs } },
      // Default segment export, which sends a turn's spans while the request
      // is still open — required on Vercel, where the function freezes as soon
      // as it responds and anything still buffered is lost. This only works
      // because eve >= 0.32 marks each step's restored context remote
      // (vercel/eve#1855), so every step forms its own exportable segment.
      //
      // A step's spans can still be created outside the isolation scope that
      // setConversationId below writes to, so the conversation id is stamped
      // here from the cross-context stash. Only gen_ai spans get stamped —
      // Conversations aggregates by this attribute.
      beforeSendSpan: (span) => {
        const conv = conversationStash();
        if (!conv?.threadTs) return span;
        const isGenAiSpan =
          span.op?.startsWith("gen_ai") ||
          /^(chat|generate_content|invoke_agent|execute_tool|embed) /.test(span.description ?? "");
        if (!isGenAiSpan) return span;
        span.data["gen_ai.conversation.id"] ??= conv.threadTs;
        if (conv.userId) span.data["user.id"] ??= conv.userId;
        return span;
      },
      // Logs are domain wide events only (meal.option.presented and
      // meal.pick.added in the tools) — the mechanical record (tool args,
      // tokens, models) already lives on the auto-instrumented spans; logs
      // add the business layer spans can't carry.
      enableLogs: envFlag("SENTRY_ENABLE_LOGS", true),
      integrations: [
        // Already a default integration; listed so the AI wiring is visible in
        // one place. It works on two fronts:
        //
        // 1. It subscribes to `ai` 7's `ai:telemetry` diagnostics channel and
        //    opens its own gen_ai.* spans (origin auto.vercelai.channel).
        // 2. It installs span processors that map eve's @ai-sdk/otel spans
        //    (ai.streamText, ai.toolCall, …) onto the same gen_ai.* ops.
        //    Without that mapping those spans arrive as op:default, invisible
        //    to Insights > AI Agents, the spend dashboard and the detectors.
        //
        // Front 2 otherwise waits for one of two triggers: the Modules
        // integration reading `ai` out of the dependencies of whatever
        // package.json sits in process.cwd(), or a patch of the `ai` module
        // that is capped at `<7` and so never fires on ai 7. `force: true`
        // attaches it outright, so the mapping does not depend on where the
        // built server happens to be started from.
        //
        // Both fronts running is why each model and tool call is described
        // twice in the waterfall, one span per origin.
        Sentry.vercelAIIntegration({ force: true }),
      ],
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
      // only the beginning of each turn. In-process cache; fine for the
      // single-process demo server.
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
      if (!identity) return undefined;
      // This callback runs on the same execution path as the step's model
      // call, so isolation-scope state set here lands on the AI spans that
      // follow. The Slack thread is the conversation: setConversationId stamps
      // gen_ai.conversation.id on every AI span (grouping the thread in
      // Explore > Conversations) and setUser fills that view's User column.
      // The matching tag puts the same id on error events, which carry tags
      // rather than span attributes.
      Sentry.setConversationId(identity.threadTs ?? null);
      if (identity.threadTs) {
        Sentry.getIsolationScope().setTag("gen_ai.conversation.id", identity.threadTs);
      }
      // Handoff for beforeSendSpan above, which may run in eve's replay
      // context (separate module instance) where this scope isn't reachable.
      setConversationStash({
        threadTs: identity.threadTs ?? null,
        userId: identity.userId ?? null,
      });
      if (identity.userId) {
        trackSlackProfile(identity.userId, Sentry.getIsolationScope());
      }
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
