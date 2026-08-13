import type { ScenarioKey } from "./scenarios.ts";

/**
 * The cast of demo users. Spend-per-user dashboards only tell a story when
 * the distribution is skewed, so the cast is deliberately lopsided: one
 * power user on the priciest model, a middle tier, and a long tail of
 * occasional users on budget models.
 *
 * Model ids are OpenRouter slugs — Sentry refreshes its pricing table from
 * that API every 30 minutes, so only ids that exist there get server-side
 * cost attributes (`gen_ai.cost.*`); a made-up name silently produces zero
 * cost. The roster is the same generation the storefront-commerce demo runs
 * (its lib/ai/models.ts is the shared source of truth), so seeded spend and
 * live spend compare like for like.
 */

export interface ModelRate {
  /** USD per token. */
  input: number;
  output: number;
  cachedInput: number;
}

// Input/output rates come from the shared roster; the cached-input column is
// a per-provider estimate and only feeds the local projection printed by
// --dry-run. Sentry computes the real cost server-side from OpenRouter.
export const MODEL_RATES = {
  "anthropic/claude-opus-5": { input: 5e-6, output: 25e-6, cachedInput: 0.5e-6 },
  "anthropic/claude-sonnet-5": { input: 2e-6, output: 10e-6, cachedInput: 0.2e-6 },
  "openai/gpt-5.6-sol": { input: 5e-6, output: 30e-6, cachedInput: 0.5e-6 },
  "openai/gpt-5.6-terra": { input: 1e-6, output: 6e-6, cachedInput: 0.1e-6 },
  "openai/gpt-5.6-luna": { input: 0.1e-6, output: 0.6e-6, cachedInput: 0.01e-6 },
  "x-ai/grok-4.6": { input: 2e-6, output: 6e-6, cachedInput: 0.3e-6 },
  "google/gemini-3.6-flash": { input: 1.5e-6, output: 7.5e-6, cachedInput: 0.15e-6 },
} satisfies Record<string, ModelRate>;

/** The only model ids the seeder can price, so a typo cannot cost $0. */
export type ModelId = keyof typeof MODEL_RATES;

export interface Persona {
  /** Slack-style member id — lands as user.id, the dashboard group-by key. */
  id: string;
  username: string;
  email: string;
  /** Weighted model choices: [openrouter model id, weight]. */
  models: Array<[ModelId, number]>;
  /** Conversations per weekday, [min, max]. Weekends are scaled down. */
  conversationsPerDay: [number, number];
  /**
   * Multiplier on per-chat context size. A heavy user who pastes whole
   * order threads at the bot burns more input tokens per call than someone
   * asking "what's for lunch".
   */
  contextScale: number;
  /** Weighted scenario keys (see scenarios.ts). */
  scenarioWeights: Array<[ScenarioKey, number]>;
}

export const PERSONAS: Persona[] = [
  {
    // The power user: runs the team's group orders on the flagship model.
    id: "U0DEMO1PRIYA",
    username: "priya.raman",
    email: "priya.raman@example.com",
    models: [
      ["anthropic/claude-opus-5", 4],
      ["anthropic/claude-sonnet-5", 1],
    ],
    conversationsPerDay: [4, 7],
    contextScale: 1.5,
    scenarioWeights: [
      ["group-order", 4],
      ["indecisive", 3],
      ["cart-resolve", 2],
      ["details", 1],
    ],
  },
  {
    id: "U0DEMO2MARCUS",
    username: "marcus.webb",
    email: "marcus.webb@example.com",
    models: [["openai/gpt-5.6-sol", 3], ["openai/gpt-5.6-luna", 1]],
    conversationsPerDay: [4, 6],
    contextScale: 1.6,
    scenarioWeights: [
      ["details", 3],
      ["group-order", 2],
      ["dietary", 2],
      ["quick-menu", 1],
    ],
  },
  {
    id: "U0DEMO3JULES",
    username: "jules.tan",
    email: "jules.tan@example.com",
    models: [["anthropic/claude-sonnet-5", 1]],
    conversationsPerDay: [4, 6],
    contextScale: 1.5,
    scenarioWeights: [
      ["nutrition-deep", 3],
      ["dietary", 3],
      ["details", 2],
      ["quick-menu", 1],
    ],
  },
  {
    id: "U0DEMO4SOFIA",
    username: "sofia.alvarez",
    email: "sofia.alvarez@example.com",
    models: [
      ["anthropic/claude-sonnet-5", 2],
      ["openai/gpt-5.6-terra", 3],
    ],
    conversationsPerDay: [2, 4],
    contextScale: 1.3,
    scenarioWeights: [
      ["quick-menu", 3],
      ["details", 2],
      ["cart-resolve", 1],
      ["chitchat", 1],
    ],
  },
  {
    id: "U0DEMO5DAN",
    username: "dan.kowalski",
    email: "dan.kowalski@example.com",
    models: [["x-ai/grok-4.6", 1]],
    conversationsPerDay: [1, 3],
    contextScale: 1.4,
    scenarioWeights: [
      ["details", 2],
      ["quick-menu", 2],
      ["dietary", 1],
    ],
  },
  {
    id: "U0DEMO6AMARA",
    username: "amara.osei",
    email: "amara.osei@example.com",
    models: [["google/gemini-3.6-flash", 1]],
    conversationsPerDay: [1, 3],
    contextScale: 1.0,
    scenarioWeights: [
      ["dietary", 3],
      ["quick-menu", 2],
      ["nutrition-deep", 1],
    ],
  },
  {
    id: "U0DEMO7TOM",
    username: "tom.nguyen",
    email: "tom.nguyen@example.com",
    models: [["openai/gpt-5.6-terra", 1]],
    conversationsPerDay: [0, 2],
    contextScale: 0.9,
    scenarioWeights: [
      ["quick-menu", 3],
      ["chitchat", 1],
      ["details", 1],
    ],
  },
  {
    id: "U0DEMO8LENA",
    username: "lena.fischer",
    email: "lena.fischer@example.com",
    models: [["openai/gpt-5.6-luna", 1]],
    conversationsPerDay: [0, 2],
    contextScale: 0.8,
    scenarioWeights: [
      ["quick-menu", 3],
      ["dietary", 1],
    ],
  },
  {
    id: "U0DEMO9RYAN",
    username: "ryan.oconnell",
    email: "ryan.oconnell@example.com",
    models: [
      ["openai/gpt-5.6-luna", 2],
      ["openai/gpt-5.6-terra", 1],
    ],
    conversationsPerDay: [0, 1],
    contextScale: 0.8,
    scenarioWeights: [
      ["quick-menu", 2],
      ["chitchat", 1],
    ],
  },
  {
    id: "U0DEMO10KEIKO",
    username: "keiko.sato",
    email: "keiko.sato@example.com",
    models: [["openai/gpt-5.6-luna", 1]],
    conversationsPerDay: [0, 1],
    contextScale: 0.9,
    scenarioWeights: [
      ["details", 1],
      ["quick-menu", 1],
    ],
  },
];
