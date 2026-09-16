import * as Sentry from "@sentry/node";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 1.0,
  dataCollection: {
    genAI: { inputs: true, outputs: true },
    httpBodies: [],
    stackFrameVariables: false,
  },
});
