import * as Sentry from "@sentry/nextjs";
import { DEMO_USER } from "lib/demo-user";
import { GEN_AI_CONTENT_CAPTURE } from "lib/sentry-content-capture";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  // Sample every trace — this is a demo; dial down for real traffic.
  tracesSampleRate: 1.0,
  // The v11 default, and the one that suits agent tracing: each span is sent on
  // its own, so a failed tool span keeps its failure reason instead of being
  // rebuilt from a finished transaction.
  // https://github.com/getsentry/sentry-agent-tracing-examples/issues/15
  traceLifecycle: "stream",
  enableLogs: true,
  // In-app stack frames: under `next dev` (Turbopack) the SDK misclassifies
  // them and ingest overrides any client-side correction. Stack Trace Rules
  // (Settings → Issue Grouping) fix it, but they rewrite deployed events too.
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
});

// Page renders and server actions never call Sentry.setUser, so they fall back
// to the signed-in shopper. The global scope is the base every event and span
// merges onto, so the chat route's per-request setUser still wins.
Sentry.getGlobalScope().setUser(DEMO_USER);
