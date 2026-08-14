import * as Sentry from "@sentry/nextjs";
import { DEMO_USER } from "lib/demo-user";
import { GEN_AI_CONTENT_CAPTURE } from "lib/sentry-content-capture";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  // Sample every trace — this is a demo; dial down for real traffic.
  tracesSampleRate: 1.0,
  enableLogs: true,
  // Page renders and server actions never call Sentry.setUser, so they fall
  // back to the signed-in shopper. A fallback and not `initialScope`, because
  // initialScope lands on the scope a root span captures, which is merged
  // after the isolation scope Sentry.setUser writes to — it would silently
  // overwrite the per-request shopper the chat route resolved.
  beforeSend(event) {
    if (!event.user?.id) event.user = DEMO_USER;
    return event;
  },
  beforeSendTransaction(event) {
    if (!event.user?.id) event.user = DEMO_USER;
    return event;
  },
  // Note on stack-trace in-app frames: under `next dev` (Turbopack) the SDK
  // misclassifies frames and Sentry ingest overrides any client-side
  // correction, so the fix lives in the project's Stack Trace Rules
  // (Settings → Issue Grouping), not here. See
  // https://github.com/getsentry/sentry-javascript/issues/23176

  // Only the categories to switch off; the rest stay on. Inbound request
  // bodies also need httpIntegration's maxIncomingRequestBodySize.
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#dataCollection
  // https://docs.sentry.io/platforms/javascript/guides/node/configuration/integrations/http/#maxincomingrequestbodysize
  dataCollection: {
    genAI: GEN_AI_CONTENT_CAPTURE,
    httpHeaders: { request: false, response: false },
    httpBodies: [],
    cookies: false,
    urlQueryParams: false,
    graphQL: { document: false, variables: false },
    stackFrameVariables: false,
  },
  integrations: [
    // Turns the AI SDK's telemetry into gen_ai.* agent spans. ai >= 7 publishes
    // on the `ai:telemetry` diagnostics channel this integration subscribes to,
    // so no bundling or module-patching options are needed.
    Sentry.vercelAIIntegration(),
  ],
});
