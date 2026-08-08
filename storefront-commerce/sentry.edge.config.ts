import * as Sentry from "@sentry/nextjs";
import { DEMO_USER } from "lib/demo-user";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 1.0,
  enableLogs: true,
  // Every event from the demo belongs to the one signed-in customer.
  initialScope: { user: DEMO_USER },
});
