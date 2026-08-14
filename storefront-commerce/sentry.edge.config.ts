import * as Sentry from "@sentry/nextjs";
import { DEMO_USER } from "lib/demo-user";
import { GEN_AI_CONTENT_CAPTURE } from "lib/sentry-content-capture";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 1.0,
  enableLogs: true,
  // Same set as sentry.server.config.ts — see the note there for why each
  // category is spelled out.
  dataCollection: {
    genAI: GEN_AI_CONTENT_CAPTURE,
    userInfo: true,
    databaseQueryData: true,
    frameContextLines: 5,
    httpHeaders: { request: false, response: false },
    httpBodies: [],
    cookies: false,
    urlQueryParams: false,
    graphQL: { document: false, variables: false },
    stackFrameVariables: false,
  },
  // The signed-in shopper as a fallback only — see sentry.server.config.ts
  // for why this is not `initialScope`.
  beforeSend(event) {
    if (!event.user?.id) event.user = DEMO_USER;
    return event;
  },
  beforeSendTransaction(event) {
    if (!event.user?.id) event.user = DEMO_USER;
    return event;
  },
});
