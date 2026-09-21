import { otel } from "eve/instrumentation/otel";
import { AGENT_NAME } from "../lib/agent-name";
import { envFlag } from "../lib/env";

const recordInputs = envFlag("SENTRY_AI_RECORD_INPUTS", true);
const recordOutputs = envFlag("SENTRY_AI_RECORD_OUTPUTS", true);

export default otel({
  // Same agent name as the SDK variant, so gen_ai.agent.name matches and the
  // only variable between the two projects is the export path.
  functionId: AGENT_NAME,
  // Without an explicit decision eve records metadata only outside
  // development, because a Slack audience counts as private.
  tracePolicy: () => ({ emit: true, recordInputs, recordOutputs }),
});
