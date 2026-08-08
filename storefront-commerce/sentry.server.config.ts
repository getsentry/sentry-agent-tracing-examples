import * as Sentry from "@sentry/nextjs";
import { DEMO_USER } from "lib/demo-user";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  // Sample every trace — this is a demo; dial down for real traffic.
  tracesSampleRate: 1.0,
  enableLogs: true,
  // Every event from the demo belongs to the one signed-in customer, so
  // page renders and server actions carry the user even where no request
  // handler calls Sentry.setUser (the chat route still does, as the
  // realistic per-request pattern).
  initialScope: { user: DEMO_USER },
  // Note on stack-trace in-app frames: under `next dev` (Turbopack) the SDK
  // misclassifies frames and Sentry ingest overrides any client-side
  // correction, so the fix lives in the project's Stack Trace Rules
  // (Settings → Issue Grouping), not here. See ISSUE-turbopack-dev-in-app.md
  // at the repo root.
  integrations: [
    // Turns the AI SDK's telemetry into gen_ai.* agent spans. `force` keeps
    // the semantic span names even when the build bundles the `ai` package;
    // recordInputs/recordOutputs capture prompts, outputs, and tool payloads.
    Sentry.vercelAIIntegration({
      force: true,
      recordInputs: true,
      recordOutputs: true,
    }),
  ],
});
