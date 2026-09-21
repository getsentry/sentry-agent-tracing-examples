import * as Sentry from "@sentry/node";
import { AGENT_NAME, EVE_PROJECT_NAME } from "./agent-name";
import { conversationForTrace } from "./conversation";
import { envFlag, envRate } from "./env";

// Both instrumentation files import this module. A Nitro step bundle can
// inline a second copy of it, and a second init would replace the client that
// eve's sampler already holds.
if (Sentry.getClient() === undefined) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.VERCEL_ENV ?? "development",
    tracesSampleRate: envRate("SENTRY_TRACES_SAMPLE_RATE", 1.0),
    // No ignoreSpans on purpose: every span eve and Vercel Workflow emit is
    // kept so the full inventory is visible. The README lists what shows up
    // and what a future eve integration would want to drop.
    // Only the categories to switch off; the rest stay on. Inbound request
    // bodies also need httpIntegration's maxIncomingRequestBodySize.
    // https://docs.sentry.io/platforms/javascript/guides/node/configuration/options/#dataCollection
    // https://docs.sentry.io/platforms/javascript/guides/node/configuration/integrations/http/#maxincomingrequestbodysize
    dataCollection: {
      genAI: {
        inputs: envFlag("SENTRY_AI_RECORD_INPUTS", true),
        outputs: envFlag("SENTRY_AI_RECORD_OUTPUTS", true),
      },
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
    beforeSendSpan: (span) => {
      const attributes = span.attributes;
      if (!attributes) return span;
      // eve names its agent span after the model it called, not the agent.
      // The attribute holds the real one, including a delegated subagent's.
      if (span.name.startsWith("invoke_agent ")) {
        // Since eve 0.62 the root agent's span carries the package name and
        // ignores functionId, which the chat spans still use.
        const reported = attributes["gen_ai.agent.name"];
        const agent =
          typeof reported === "string" && reported !== EVE_PROJECT_NAME ? reported : AGENT_NAME;
        attributes["gen_ai.agent.name"] = agent;
        span.name = `invoke_agent ${agent}`;
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
    },
    // Logs are domain wide events only (meal.option.presented and
    // meal.pick.added in the tools) — the mechanical record (tool args,
    // tokens, models) already lives on the auto-instrumented spans; logs
    // add the business layer spans can't carry.
    // eve registers @ai-sdk/otel itself and emits the full gen_ai.* tree.
    // VercelAI, a default integration, subscribes to the same telemetry over
    // the ai:telemetry channel and opens a second tree beside it, carrying
    // the same gen_ai.usage.* — which doubles every token in the spend
    // dashboard and the AI detectors. eve's telemetry has no off switch
    // (`otelSettings` is enabled by this file existing), so this is the copy
    // that goes.
    // Outside development eve passes recordInputs: false and recordOutputs:
    // false on every model call, and a per-call value outranks
    // dataCollection.genAI. The integration options outrank the per-call value.
    integrations: [
      Sentry.vercelAIIntegration({
        recordInputs: envFlag("SENTRY_AI_RECORD_INPUTS", true),
        recordOutputs: envFlag("SENTRY_AI_RECORD_OUTPUTS", true),
      }),
    ],
  });
}

export const sentryClient = Sentry.getClient()!;
