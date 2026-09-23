import * as Sentry from "@sentry/node";
import { defineInstrumentation } from "eve/instrumentation";

export default defineInstrumentation(
  Sentry.eveInstrumentation({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.VERCEL_ENV ?? "development",
    tracesSampleRate: 1.0,
    traceLifecycle: "stream",
  }),
);
