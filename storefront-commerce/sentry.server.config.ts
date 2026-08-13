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

  // Supplying `dataCollection` at all switches the baseline from
  // sendDefaultPii to the SDK's DEFAULTS, which turn every category on. So
  // each category this demo produces is written out here rather than left to
  // that baseline, and the edge and client configs repeat the same set — one
  // posture across all three runtimes. The storefront shows only fictional
  // customers; a real app would start by turning cookies, headers, and
  // httpBodies off.
  dataCollection: {
    // Prompts, completions, and tool payloads, switched by
    // SENTRY_AI_RECORD_INPUTS / SENTRY_AI_RECORD_OUTPUTS. The vercelAI
    // integration reads this as its default, so no per-integration
    // recordInputs/recordOutputs.
    genAI: GEN_AI_CONTENT_CAPTURE,
    // Only auto-instrumented database integrations read this; the lib/db spans
    // are hand-built, so their attributes are sent either way.
    databaseQueryData: true,
    userInfo: true,
    cookies: true,
    httpHeaders: { request: true, response: true },
    httpBodies: [
      "incomingRequest",
      "outgoingRequest",
      "incomingResponse",
      "outgoingResponse",
    ],
    urlQueryParams: true,
    stackFrameVariables: true,
    frameContextLines: 5,
  },
  integrations: [
    // Turns the AI SDK's telemetry into gen_ai.* agent spans. ai >= 7 publishes
    // on the `ai:telemetry` diagnostics channel this integration subscribes to,
    // so no bundling or module-patching options are needed.
    Sentry.vercelAIIntegration(),
  ],
});
