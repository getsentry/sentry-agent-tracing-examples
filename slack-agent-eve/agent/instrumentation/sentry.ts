import * as Sentry from "@sentry/node";
import { defineInstrumentation } from "eve/instrumentation";
import "../lib/sentry";

export default defineInstrumentation({
  flush: async () => {
    await Sentry.flush(2000);
  },
});
