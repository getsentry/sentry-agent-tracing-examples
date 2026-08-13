/**
 * The cast and the scripts the traffic runner replays against /api/chat.
 *
 * Turns are written the way a shopper types, not with fixture ids baked in:
 * "the oldest order on my account" makes the assistant call getAccountInfo
 * first, so the same script produces a different tool chain for every shopper.
 */
import { SHOPPERS, type Shopper } from "../lib/demo-user.ts";

export interface Scenario {
  key: string;
  turns: string[];
}

export const SCENARIOS: Scenario[] = [
  {
    key: "gift-under-30",
    turns: [
      "I need a gift for a coworker and I want to stay under $30 — what do you have?",
      "The mug looks right. Is it dishwasher safe?",
    ],
  },
  {
    key: "hoodie-sizing",
    turns: [
      "Do you sell hoodies?",
      "What sizes does the Acme Hoodie come in, and how heavy is the fleece?",
    ],
  },
  {
    key: "desk-setup",
    turns: [
      "Show me everything you have for a desk setup",
      "Which of those is your best seller?",
    ],
  },
  {
    key: "order-status",
    turns: ["Where is my most recent order?"],
  },
  {
    key: "loyalty-balance",
    turns: ["What loyalty tier am I on and how many points do I have?"],
  },
  {
    key: "reorder",
    turns: [
      "What did I order last time?",
      "I want the same thing again — is it still in stock?",
    ],
  },
  {
    key: "compare-apparel",
    turns: [
      "What is the difference between the Acme Circles T-Shirt and the Acme Crewneck?",
      "Which one works better for autumn?",
    ],
  },
  {
    key: "stickers",
    turns: ["Do you sell stickers?", "What is in the sticker pack?"],
  },
  {
    key: "bundle-price",
    turns: ["I want a mug and a desk mat as a set — what would that cost me?"],
  },
  {
    key: "apparel-browse",
    turns: ["Show me apparel under $50"],
  },
  {
    key: "cold-drinks",
    turns: [
      "I need a bottle that keeps drinks cold all day at my desk",
      "How much is it?",
    ],
  },
  {
    key: "refund-recent",
    turns: [
      "I want to return my most recent delivered order",
      "Yes, please refund it",
    ],
  },
  {
    // Hits the planted bug: orders placed before the June 2026 payments launch
    // have no payment row, so refundOrder throws and the trace shows a failed
    // tool span next to the Sentry issue.
    key: "refund-legacy",
    // Two turns because the assistant is told to confirm the order before it
    // refunds anything — a one-turn script stops at the question.
    turns: [
      "I want to refund the oldest order on my account",
      "Yes, that is the one — refund it please",
    ],
  },
];

const scenario = (key: string): Scenario => {
  const found = SCENARIOS.find((s) => s.key === key);
  if (!found) throw new Error(`Unknown scenario ${key}`);
  return found;
};

export interface Persona {
  shopper: Shopper;
  /** Weighted model choices: [OpenRouter model id, weight]. */
  models: Array<[string, number]>;
  /** How many conversations this shopper starts per run. */
  conversations: number;
  /** Weighted scenario keys. */
  scenarios: Array<[string, number]>;
}

const shopper = (username: string): Shopper => {
  const found = SHOPPERS.find((s) => s.username === username);
  if (!found) throw new Error(`Unknown shopper ${username}`);
  return found;
};

/**
 * Spend-per-user only tells a story when the distribution is lopsided, so the
 * cast is: one power user on the priciest model, a middle tier, and a tail of
 * light users on budget models.
 */
export const PERSONAS: Persona[] = [
  {
    // The power user, and the one the "who is burning the budget" story lands
    // on: long browsing sessions on the most expensive model in the roster.
    shopper: shopper("grace"),
    models: [
      ["anthropic/claude-opus-5", 4],
      ["openai/gpt-5.6-sol", 1],
    ],
    conversations: 6,
    scenarios: [
      ["desk-setup", 3],
      ["compare-apparel", 2],
      ["reorder", 2],
      ["bundle-price", 1],
      ["refund-recent", 1],
    ],
  },
  {
    // The signed-in shopper the browser demo uses, on the default model.
    shopper: shopper("ada"),
    models: [["anthropic/claude-sonnet-5", 1]],
    conversations: 4,
    scenarios: [
      ["gift-under-30", 2],
      ["order-status", 2],
      ["hoodie-sizing", 1],
      ["refund-legacy", 1],
    ],
  },
  {
    shopper: shopper("alan"),
    models: [
      ["openai/gpt-5.6-sol", 1],
      ["openai/gpt-5.6-terra", 2],
    ],
    conversations: 3,
    scenarios: [
      ["apparel-browse", 2],
      ["compare-apparel", 1],
      ["loyalty-balance", 1],
    ],
  },
  {
    shopper: shopper("katherine"),
    models: [
      ["x-ai/grok-4.6", 2],
      ["google/gemini-3.6-flash", 1],
    ],
    conversations: 3,
    scenarios: [
      ["cold-drinks", 2],
      ["order-status", 1],
      ["refund-legacy", 1],
    ],
  },
  {
    // Newest member, lightest spend: one cheap model, short questions.
    shopper: shopper("radia"),
    models: [["openai/gpt-5.6-luna", 1]],
    conversations: 2,
    scenarios: [
      ["stickers", 2],
      ["loyalty-balance", 1],
    ],
  },
  {
    shopper: shopper("shafi"),
    models: [
      ["google/gemini-3.6-flash", 2],
      ["openai/gpt-5.6-terra", 1],
    ],
    conversations: 2,
    scenarios: [
      ["order-status", 1],
      ["gift-under-30", 1],
    ],
  },
];

export { scenario };
