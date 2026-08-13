import * as Sentry from "@sentry/nextjs";
import { DEMO_USER } from "lib/demo-user";

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
  // One switch for gen_ai content capture — prompts, outputs, and tool
  // payloads. The integration reads this as its default, so no per-integration
  // recordInputs/recordOutputs.
  dataCollection: { genAI: { inputs: true, outputs: true } },
  integrations: [
    // Turns the AI SDK's telemetry into gen_ai.* agent spans. `force` keeps
    // the semantic span names even when the build bundles the `ai` package.
    Sentry.vercelAIIntegration({ force: true }),
  ],
});
