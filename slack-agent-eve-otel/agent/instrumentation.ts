import { OTLPHttpProtoTraceExporter, registerOTel } from "@vercel/otel";
import { defineInstrumentation, isChannel } from "eve/instrumentation";
import slack from "./channels/slack";
import { AGENT_NAME } from "./lib/agent-name";
import { activeTraceId, rememberConversation } from "./lib/conversation";

interface SlackIdentity {
  channelId?: string;
  threadTs?: string;
  userId?: string;
}

const slackSessionIdentity = new Map<string, SlackIdentity>();

const DISABLED_FLAG_VALUES = new Set(["false", "0", "no", "off"]);

function envFlag(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  return !DISABLED_FLAG_VALUES.has(raw.trim().toLowerCase());
}

// The OTLP-only variant of ../slack-agent-eve. No Sentry SDK: eve's own
// OpenTelemetry spans go straight to Sentry's OTLP intake, as
// https://eve.dev/integrations/sentry-instrumentation describes. Everything
// the Sentry SDK did in the original (op derivation, beforeSendSpan renames,
// user and conversation scope, logs) is deliberately absent so the two
// projects show what each path produces on its own.
export default defineInstrumentation({
  // Same agent name as the SDK variant, so gen_ai.agent.name matches and the
  // only variable between the two projects is the export path.
  functionId: AGENT_NAME,
  setup: ({ agentName }) =>
    registerOTel({
      serviceName: agentName,
      traceExporter: new OTLPHttpProtoTraceExporter({
        url: process.env.SENTRY_OTLP_TRACES_ENDPOINT!,
        headers: {
          "x-sentry-auth": `sentry sentry_key=${process.env.SENTRY_PUBLIC_KEY}`,
        },
      }),
    }),
  recordInputs: envFlag("SENTRY_AI_RECORD_INPUTS", true),
  recordOutputs: envFlag("SENTRY_AI_RECORD_OUTPUTS", true),
  events: {
    // Kept from the SDK variant: the card tools need the Slack thread
    // (activeSlackThread) and the runtimeContext lands on spans in both
    // variants. The Sentry scope work that lived here is gone.
    "step.started"(input) {
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
      const conversationId =
        identity?.threadTs ?? input.session.parent?.rootSessionId ?? input.session.id;
      const traceId = activeTraceId();
      if (traceId !== undefined)
        rememberConversation(traceId, {
          conversationId,
          channelId: identity?.channelId,
          threadTs: identity?.threadTs,
          userId: identity?.userId,
        });
      if (identity === undefined) return undefined;
      return {
        runtimeContext: {
          "slack.channel_id": identity.channelId ?? "",
          "slack.user_id": identity.userId ?? "",
        },
      };
    },
  },
});
