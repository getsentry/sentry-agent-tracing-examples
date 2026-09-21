import { OTLPHttpProtoTraceExporter } from "@vercel/otel";
import { isChannel } from "eve/instrumentation";
import { otelIntegration } from "eve/instrumentation/otel";
import slack from "../channels/slack";
import { activeTraceId, rememberConversation } from "../lib/conversation";

interface SlackIdentity {
  channelId?: string;
  threadTs?: string;
  userId?: string;
}

const slackSessionIdentity = new Map<string, SlackIdentity>();

// The OTLP-only variant of ../slack-agent-eve. No Sentry SDK: eve's own
// OpenTelemetry spans go straight to Sentry's OTLP intake, as
// https://eve.dev/integrations/sentry-instrumentation describes. Everything
// the Sentry SDK did in the original (op derivation, beforeSendSpan renames,
// user and conversation scope, logs) is deliberately absent so the two
// projects show what each path produces on its own.
export default otelIntegration({
  traceExporter: new OTLPHttpProtoTraceExporter({
    url: process.env.SENTRY_OTLP_TRACES_ENDPOINT!,
    headers: {
      "x-sentry-auth": `sentry sentry_key=${process.env.SENTRY_PUBLIC_KEY}`,
    },
  }),
  // Kept from the SDK variant: the card tools need the Slack thread
  // (activeSlackThread) and the runtimeContext lands on spans in both
  // variants. The Sentry scope work that lived here is gone.
  runtimeContext(input) {
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
      "slack.channel_id": identity.channelId ?? "",
      "slack.user_id": identity.userId ?? "",
    };
  },
});
