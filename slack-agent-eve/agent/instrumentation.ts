import * as Sentry from "@sentry/node";
import { defineInstrumentation, isChannel } from "eve/instrumentation";
import slack from "./channels/slack";

const slackSessionIdentity = new Map<
  string,
  { channelId?: string; threadTs?: string; userId?: string }
>();

export default defineInstrumentation({
  // Runs at server startup, before any agent code. Sentry.init registers a
  // global OpenTelemetry tracer provider, so eve's AI SDK telemetry spans
  // (ai.eve.turn > ai.streamText > ai.toolCall) flow straight into Sentry.
  setup: () => {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.VERCEL_ENV ?? "development",
      tracesSampleRate: 1.0,
      integrations: [
        // force: true — eve's nitro build bundles the `ai` package, which
        // defeats Sentry's module detection; forcing keeps the processors that
        // rewrite AI SDK spans into gen_ai.* spans for the AI Agents dashboard.
        Sentry.vercelAIIntegration({
          force: true,
          recordInputs: true,
          recordOutputs: true,
        }),
      ],
    });
  },
  recordInputs: true,
  recordOutputs: true,
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
      if (slack_.userId) {
        Sentry.setUser({ id: slack_.userId });
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
