import * as Sentry from "@sentry/nextjs";
import { DEMO_USER } from "lib/demo-user";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 1.0,
  enableLogs: true,
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
