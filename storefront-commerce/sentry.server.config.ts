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

  // Supplying `dataCollection` at all switches the baseline from the
  // sendDefaultPii bridge to the SDK's DEFAULTS, which turn every category on
  // (@sentry/core resolveDataCollectionOptions). This demo has to supply it —
  // gen_ai content is the whole point — so every other category is written out
  // too: an omitted one would inherit that all-on baseline, not the
  // conservative bridge. The edge and client configs repeat the same set, and
  // so do the other two demos in this repo.
  dataCollection: {
    // Prompts, completions, and tool payloads, switched by
    // SENTRY_AI_RECORD_INPUTS / SENTRY_AI_RECORD_OUTPUTS. The vercelAI
    // integration reads this as its default, so no per-integration
    // recordInputs/recordOutputs.
    genAI: GEN_AI_CONTENT_CAPTURE,
    // The shoppers are fictional (lib/demo-user), so the User column is safe
    // to populate.
    userInfo: true,
    // Only auto-instrumented database integrations read this; the lib/db spans
    // are hand-built, so their attributes are sent either way.
    databaseQueryData: true,
    frameContextLines: 5,
    // The transport layer, all off. Turning any of it on only redacts keys
    // whose *name* matches a fixed substring denylist (SENSITIVE_KEY_SNIPPETS
    // in @sentry/core filterKeyValueData) — so `authorization` is caught, but
    // a vendor-specific key header or a body field named anything else is sent
    // verbatim, and this demo calls OpenRouter on every chat turn.
    httpHeaders: { request: false, response: false },
    httpBodies: [],
    cookies: false,
    urlQueryParams: false,
    // `graphqlIntegration` is one of the Node SDK's defaults, but no `graphql`
    // package is installed for it to patch, so this collects nothing today.
    // Stated anyway, so the category is never inherited from the DEFAULTS
    // baseline.
    graphQL: { document: false, variables: false },
    // Frame locals get no name filtering at all, and a frame in an API client
    // holds whatever it was called with.
    stackFrameVariables: false,
  },
  integrations: [
    // Turns the AI SDK's telemetry into gen_ai.* agent spans. ai >= 7 publishes
    // on the `ai:telemetry` diagnostics channel this integration subscribes to,
    // so no bundling or module-patching options are needed.
    Sentry.vercelAIIntegration(),
  ],
});
