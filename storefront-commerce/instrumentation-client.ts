import * as Sentry from "@sentry/nextjs";
import { DEMO_USER } from "lib/demo-user";
import { GEN_AI_CONTENT_CAPTURE } from "lib/sentry-content-capture";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  // Sample every trace and record every session — this is a demo; dial down
  // for real traffic.
  tracesSampleRate: 1.0,
  replaysSessionSampleRate: 1.0,
  replaysOnErrorSampleRate: 1.0,
  enableLogs: true,
  // Same set as sentry.server.config.ts. `userInfo` stays on, so ingest infers
  // the visitor's IP and user agent — switch it off for real visitors.
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
    // Unmasked because the storefront shows no real user data; keep the
    // defaults in apps with actual PII. This outranks GEN_AI_CONTENT_CAPTURE
    // above: a replay records answers as they are painted, so switching span
    // content off does not stop a completion reaching Sentry through here.
    Sentry.replayIntegration({ maskAllText: false, blockAllMedia: false }),
  ],
});

// The storefront has exactly one signed-in customer, so identify her up
// front — replays and browser errors then join server events under one user.
Sentry.setUser(DEMO_USER);

// Instruments App Router navigations so client traces connect to server ones.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
