import * as Sentry from "@sentry/node";
import { defineInstrumentation } from "eve/instrumentation";
import { envFlag, envRate } from "../lib/env";

const recordInputs = envFlag("SENTRY_AI_RECORD_INPUTS", true);
const recordOutputs = envFlag("SENTRY_AI_RECORD_OUTPUTS", true);

// eve loads this file at server startup. The provider's setup runs Sentry.init
// with these options, and its turn and step handlers set the eve session id
// as the Sentry conversation id.
const sentry = Sentry.eveInstrumentation({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.VERCEL_ENV ?? "development",
  tracesSampleRate: envRate("SENTRY_TRACES_SAMPLE_RATE", 1.0),
  // Only the categories to switch off; the rest stay on. Supplying
  // dataCollection at all moves the baseline to the SDK defaults, which are
  // all on, so every category is written out.
  // https://docs.sentry.io/platforms/javascript/guides/node/configuration/options/#dataCollection
  dataCollection: {
    genAI: { inputs: recordInputs, outputs: recordOutputs },
    httpHeaders: { request: false, response: false },
    httpBodies: [],
    cookies: false,
    urlQueryParams: false,
    graphQL: { document: false, variables: false },
    stackFrameVariables: false,
  },
  // Only streamed spans reach the ingest path that derives gen_ai.* ops from
  // span attributes.
  traceLifecycle: "stream",
  // Outside `eve dev`, eve passes recordInputs: false and recordOutputs: false
  // to every AI SDK call, and the per-call value wins over dataCollection.genAI.
  // The integration option is what keeps prompts and completions on a deployment.
  integrations: [Sentry.vercelAIIntegration({ recordInputs, recordOutputs })],
});

export default defineInstrumentation({
  ...sentry,
  // eve awaits flush() before a session idles. Streamed spans otherwise wait
  // in the SDK buffer, and a serverless isolate that is reclaimed loses them.
  flush: async () => {
    await Sentry.flush(2000);
  },
});
