/**
 * The agent's name in Sentry's AI views, set as `functionId` in
 * instrumentation/otel.ts. Without it eve falls back to the runtime agent name,
 * which is the package name (doordash-agent).
 */
export const AGENT_NAME = "mealbot";
