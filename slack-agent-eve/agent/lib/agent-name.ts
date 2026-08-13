/**
 * The agent's name in Sentry's AI views. Exported so the live agent
 * (instrumentation.ts `functionId`) and the seeder's fixture spans
 * (`gen_ai.agent.name`) cannot drift apart — two names for one demo would
 * split Insights > AI Agents into two agents and keep seeded spend from
 * joining live spend.
 *
 * Without it eve falls back to the runtime agent name, which is the package
 * name (doordash-agent).
 */
export const AGENT_NAME = "mealbot";
