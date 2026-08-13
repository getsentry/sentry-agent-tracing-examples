import * as Sentry from "@sentry/node";
import { callSlackApi } from "eve/channels/slack";
import { defineInstrumentation, isChannel } from "eve/instrumentation";
import slack from "./channels/slack";
import { CONVERSATION_STASH, conversationStash } from "./lib/conversation";

const slackSessionIdentity = new Map<
  string,
  { channelId?: string; threadTs?: string; userId?: string }
>();

// Env-first configuration, so the same file works from local dev to a real
// deployment without edits. Absent vars fall back to demo-friendly defaults.
function envFlag(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return raw !== "false" && raw !== "0";
}

function envRate(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback;
}

const recordInputs = envFlag("SENTRY_RECORD_INPUTS", true);
const recordOutputs = envFlag("SENTRY_RECORD_OUTPUTS", true);

// Slack user id → profile for Sentry.setUser enrichment. A `null` entry is
// the failure cache: a missing users:read scope fails once per user per
// process, not once per step.
const slackUserProfiles = new Map<
  string,
  { username?: string; email?: string } | null
>();

// Isolation scopes whose users.info call has not come back yet.
const slackProfileWaiters = new Map<string, Set<Sentry.Scope>>();

function applySlackUser(scope: Sentry.Scope, userId: string): void {
  const profile = slackUserProfiles.get(userId);
  scope.setUser({
    id: userId,
    // `username` is what the Logs pipeline emits as user.name and what the
    // Conversations/Issues User column prefers over the raw id.
    ...(profile?.username ? { username: profile.username } : {}),
    ...(profile?.email ? { email: profile.email } : {}),
  });
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
      const user = (
        response as {
          ok: boolean;
          user?: {
            name?: string;
            profile?: { display_name?: string; real_name?: string; email?: string };
          };
        }
      ).user;
      if (!response.ok || !user) return;
      slackUserProfiles.set(userId, {
        username: user.profile?.display_name || user.profile?.real_name || user.name,
        email: user.profile?.email,
      });
    })
    .catch(() => {
      // id-only user context still applies
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
  // Names the agent in Sentry's AI views. Without it eve falls back to the
  // runtime agent name, which is the package name (doordash-agent).
  functionId: "mealbot",
  // Runs at server startup, before any agent code. Sentry.init registers a
  // global OpenTelemetry tracer provider, so eve's AI SDK telemetry spans
  // (ai.eve.turn > ai.streamText > ai.toolCall) flow straight into Sentry.
  setup: () => {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.SENTRY_ENVIRONMENT ?? process.env.VERCEL_ENV ?? "development",
      tracesSampleRate: envRate("SENTRY_TRACES_SAMPLE_RATE", 1.0),
      // One switch for gen_ai content capture — the integration reads these
      // as its defaults, so no per-integration recordInputs/recordOutputs.
      dataCollection: { genAI: { inputs: recordInputs, outputs: recordOutputs } },
      // Default segment export, which sends a turn's spans while the request
      // is still open — required on Vercel, where the function freezes as soon
      // as it responds and anything still buffered is lost. This only works
      // because eve 0.32 marks each step's restored context remote
      // (vercel/eve#1855), so every step forms its own exportable segment.
      //
      // A step's spans can still be created outside the isolation scope that
      // setConversationId below writes to, so the conversation id is stamped
      // here from the cross-context stash. Only AI-shaped spans get stamped —
      // Conversations aggregates by this attribute.
      beforeSendSpan: (span) => {
        const conv = conversationStash();
        if (!conv?.threadTs) return span;
        const aiShaped =
          span.op?.startsWith("gen_ai") ||
          /^(chat|generate_content|invoke_agent|execute_tool|embed) /.test(span.description ?? "");
        if (!aiShaped) return span;
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
        // Required for the AI Agents views: without it every model and tool
        // span still arrives, but as op:default instead of gen_ai.*, so it is
        // invisible to Sentry's AI product, the spend dashboard, and the
        // detectors (verified live 2026-08-11 17:32 to 2026-08-12 23:34).
        //
        // It also emits its own spans off the `ai:telemetry` diagnostics
        // channel, so each model call is described twice in the waterfall:
        // once here (origin auto.vercelai.channel) and once by eve's
        // @ai-sdk/otel span (origin manual, left at op:default). Spend is
        // still counted once, because every gen_ai query matches only the
        // first. force: true because eve's nitro build bundles `ai`, which
        // defeats Sentry's module detection.
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
      // only the beginning of each turn (observed live 2026-08-08).
      // In-process cache; fine for the single-process demo server.
      let slack_: { channelId?: string; threadTs?: string; userId?: string } | undefined;
      if (isChannel(input.channel, slack)) {
        const { channelId, threadTs, triggeringUserId } = input.channel.metadata;
        slack_ = {
          channelId: channelId ?? undefined,
          threadTs: threadTs ?? undefined,
          userId: triggeringUserId ?? undefined,
        };
        slackSessionIdentity.set(input.session.id, slack_);
      } else {
        slack_ = slackSessionIdentity.get(input.session.id);
      }
      if (!slack_) return undefined;
      // This callback runs on the same execution path as the step's model
      // call, so isolation-scope state set here lands on the AI spans that
      // follow. The Slack thread is the conversation: setConversationId stamps
      // gen_ai.conversation.id on every AI span (grouping the thread in
      // Explore > Conversations) and setUser fills that view's User column.
      Sentry.setConversationId(slack_.threadTs ?? null);
      // Handoff for tracedExecute, which may run in eve's replay context
      // (separate module instance) where this scope isn't reachable.
      (globalThis as Record<symbol, unknown>)[CONVERSATION_STASH] = {
        threadTs: slack_.threadTs ?? null,
        userId: slack_.userId ?? null,
      };
      if (slack_.userId) {
        trackSlackProfile(slack_.userId, Sentry.getIsolationScope());
      }
      return {
        runtimeContext: {
          // Lands on every AI span namespaced by eve + Sentry as
          // vercel.ai.settings.context.slack.channel_id / .slack.user_id.
          "slack.channel_id": slack_.channelId ?? "",
          "slack.user_id": slack_.userId ?? "",
        },
      };
    },
  },
});
