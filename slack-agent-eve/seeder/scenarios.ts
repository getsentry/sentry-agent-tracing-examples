/**
 * Conversation templates. Each scenario is a sequence of turns; a turn is
 * one user message followed by the agent's tool-call loop — which becomes
 * one trace of (chat → execute_tool)* → chat spans, mirroring how eve runs
 * a real Slack turn. The tool names are real ones from agent/tools/, so
 * seeded traces group with live traffic in the Tools insights view. The
 * arguments and results below are illustrative: they read like plausible
 * lunch traffic and are deliberately not copies of each tool's inputSchema.
 */

/** JSON as the fixtures carry it. `undefined` is admitted because that is
 * what an absent key reads as, and what JSON.stringify then drops. */
export type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;

export type JsonObject = { [key: string]: JsonValue | undefined };

/** The agent/tools/ names the fixtures are allowed to reference. */
export type SeededToolName =
  | "get_menu"
  | "get_item_details"
  | "estimate_nutrition"
  | "present_meal_options"
  | "add_to_cart"
  | "resolve_group_cart";

/** Every scenario the personas can be assigned. Keyed exhaustively below. */
export type ScenarioKey =
  | "quick-menu"
  | "details"
  | "dietary"
  | "nutrition-deep"
  | "group-order"
  | "cart-resolve"
  | "indecisive"
  | "chitchat";

export interface ToolCall {
  tool: SeededToolName;
  args: JsonObject;
  result: JsonValue;
}

export interface Turn {
  userText: string;
  toolCalls: ToolCall[];
  finalText: string;
  /** Multiplier on the final chat's output tokens (1 = ~180 tokens). */
  outputScale: number;
}

export interface Scenario {
  key: ScenarioKey;
  turns: Turn[];
  /** Base system+menu context in tokens before persona contextScale. */
  contextTokens: number;
}

const MENU = [
  { id: "thai-basil-bowl", name: "Thai Basil Chicken Bowl", price: 14.5, vendor: "Baan Thai" },
  { id: "banh-mi-tofu", name: "Lemongrass Tofu Banh Mi", price: 11.0, vendor: "Saigon Corner" },
  { id: "carnitas-burrito", name: "Carnitas Burrito", price: 13.25, vendor: "La Taqueria" },
  { id: "salmon-poke", name: "Salmon Poke Bowl", price: 16.75, vendor: "Ahi House" },
  { id: "harvest-salad", name: "Harvest Grain Salad", price: 12.5, vendor: "Greenhouse" },
  { id: "margherita-slice", name: "Margherita Slice (2pc)", price: 9.0, vendor: "Slice Society" },
];

const menuResult = { date: "2026-08-07", items: MENU, currency: "USD" };

const nutrition = (item: string, cal: number, protein: number) => ({
  item,
  calories: cal,
  protein_g: protein,
  carbs_g: Math.round(cal * 0.11),
  fat_g: Math.round(cal * 0.035),
  confidence: "estimate",
});

export const SCENARIOS = {
  "quick-menu": {
    key: "quick-menu",
    contextTokens: 3200,
    turns: [
      {
        userText: "what's on the lunch menu today?",
        toolCalls: [{ tool: "get_menu", args: { date: "today" }, result: menuResult }],
        finalText:
          "Today's spread: Thai Basil Chicken Bowl ($14.50), Lemongrass Tofu Banh Mi ($11), Carnitas Burrito ($13.25), Salmon Poke ($16.75), Harvest Grain Salad ($12.50), and Margherita slices ($9). Want details on any of these?",
        outputScale: 1,
      },
    ],
  },

  details: {
    key: "details",
    contextTokens: 3600,
    turns: [
      {
        userText: "menu please",
        toolCalls: [{ tool: "get_menu", args: { date: "today" }, result: menuResult }],
        finalText: "Six options today, from $9 pizza slices to a $16.75 salmon poke bowl. Anything catch your eye?",
        outputScale: 0.8,
      },
      {
        userText: "tell me more about the poke bowl",
        toolCalls: [
          {
            tool: "get_item_details",
            args: { itemId: "salmon-poke" },
            result: {
              ...MENU[3],
              ingredients: ["sushi rice", "salmon", "edamame", "cucumber", "ponzu", "nori"],
              allergens: ["fish", "soy", "gluten"],
              pickupWindow: "11:45-12:15",
            },
          },
        ],
        finalText:
          "The Salmon Poke Bowl from Ahi House is sushi rice, fresh salmon, edamame, cucumber, ponzu and nori — allergens: fish, soy, gluten. $16.75, pickup 11:45–12:15. Want me to add it to the group cart?",
        outputScale: 1.1,
      },
    ],
  },

  dietary: {
    key: "dietary",
    contextTokens: 3800,
    turns: [
      {
        userText: "anything vegan today that's under 600 calories?",
        toolCalls: [
          { tool: "get_menu", args: { date: "today", filter: "vegan" }, result: menuResult },
          {
            tool: "estimate_nutrition",
            args: { itemId: "banh-mi-tofu" },
            result: nutrition("Lemongrass Tofu Banh Mi", 540, 21),
          },
        ],
        finalText:
          "The Lemongrass Tofu Banh Mi is your best bet — vegan and ~540 calories with 21g protein. The Harvest Grain Salad also works if you drop the feta. Want either in the cart?",
        outputScale: 1,
      },
    ],
  },

  "nutrition-deep": {
    key: "nutrition-deep",
    contextTokens: 4200,
    turns: [
      {
        userText: "I'm tracking macros — compare the poke bowl and the thai bowl for me",
        toolCalls: [
          {
            tool: "estimate_nutrition",
            args: { itemId: "salmon-poke" },
            result: nutrition("Salmon Poke Bowl", 620, 38),
          },
          {
            tool: "estimate_nutrition",
            args: { itemId: "thai-basil-bowl" },
            result: nutrition("Thai Basil Chicken Bowl", 710, 42),
          },
        ],
        finalText:
          "Poke: ~620 cal / 38g protein / 68g carbs. Thai basil chicken: ~710 cal / 42g protein / 78g carbs. Per calorie they're close; poke wins on fat, thai wins on protein per dollar. Both hit 35g+ protein.",
        outputScale: 1.4,
      },
      {
        userText: "ok go with the poke",
        toolCalls: [
          {
            tool: "add_to_cart",
            args: { itemId: "salmon-poke", quantity: 1 },
            result: { ok: true, item: "Salmon Poke Bowl", subtotal: 16.75, budgetLeft: 8.25 },
          },
        ],
        finalText: "Salmon Poke Bowl added — $16.75, leaving $8.25 of today's budget. 🐟",
        outputScale: 0.7,
      },
    ],
  },

  "group-order": {
    key: "group-order",
    contextTokens: 5200,
    turns: [
      {
        userText: "let's do a team lunch order — show everyone the options",
        toolCalls: [
          { tool: "get_menu", args: { date: "today" }, result: menuResult },
          {
            tool: "present_meal_options",
            args: { channel: "#lunch", itemIds: MENU.map((m) => m.id) },
            result: { ok: true, posted: 6, channel: "#lunch", messageTs: "1786530000.001200" },
          },
        ],
        finalText:
          "Posted all six options to #lunch with vote buttons. I'll collect picks and keep a running cart — deadline is 11:45 so the order makes the 12:15 pickup.",
        outputScale: 1.2,
      },
      {
        userText: "add a carnitas burrito for me and a banh mi for dana",
        toolCalls: [
          {
            tool: "add_to_cart",
            args: { itemId: "carnitas-burrito", forUser: "self", quantity: 1 },
            result: { ok: true, item: "Carnitas Burrito", subtotal: 13.25, cartSize: 4 },
          },
          {
            tool: "add_to_cart",
            args: { itemId: "banh-mi-tofu", forUser: "dana", quantity: 1 },
            result: { ok: true, item: "Lemongrass Tofu Banh Mi", subtotal: 11.0, cartSize: 5 },
          },
        ],
        finalText: "Done — burrito for you, banh mi for Dana. Cart is at 5 items, $63.75 total.",
        outputScale: 0.9,
      },
    ],
  },

  "cart-resolve": {
    key: "cart-resolve",
    contextTokens: 4600,
    turns: [
      {
        userText: "close it out and place the order",
        toolCalls: [
          {
            tool: "resolve_group_cart",
            args: { confirm: true },
            result: {
              ok: true,
              orderId: "DD-88213-A",
              items: 7,
              total: 91.5,
              eta: "12:10",
              perPerson: [
                { user: "priya", total: 16.75 },
                { user: "marcus", total: 13.25 },
                { user: "dana", total: 11.0 },
              ],
            },
          },
        ],
        finalText:
          "Order DD-88213-A placed: 7 items, $91.50, ETA 12:10 at the lobby. I posted the per-person split in the thread — nobody went over budget. 🎉",
        outputScale: 1.3,
      },
    ],
  },

  indecisive: {
    key: "indecisive",
    contextTokens: 4400,
    turns: [
      {
        userText: "hmm what should I get today",
        toolCalls: [{ tool: "get_menu", args: { date: "today" }, result: menuResult }],
        finalText:
          "Depends on the vibe: hearty (carnitas burrito), light (harvest salad), or you've-earned-it (salmon poke). What are you leaning toward?",
        outputScale: 1,
      },
      {
        userText: "how big is the burrito really? and is the salad filling?",
        toolCalls: [
          {
            tool: "get_item_details",
            args: { itemId: "carnitas-burrito" },
            result: { ...MENU[2], sizeOz: 14, ingredients: ["carnitas", "rice", "beans", "salsa verde"] },
          },
          {
            tool: "estimate_nutrition",
            args: { itemId: "harvest-salad" },
            result: nutrition("Harvest Grain Salad", 480, 14),
          },
        ],
        finalText:
          "The burrito is a 14oz commitment (~900 cal). The salad is ~480 cal with farro and squash, so genuinely filling. Burrito for hunger, salad for a functional afternoon.",
        outputScale: 1.2,
      },
      {
        userText: "salad. no wait. burrito. final answer",
        toolCalls: [
          {
            tool: "add_to_cart",
            args: { itemId: "carnitas-burrito", quantity: 1 },
            result: { ok: true, item: "Carnitas Burrito", subtotal: 13.25, budgetLeft: 11.75 },
          },
        ],
        finalText: "Burrito locked in — $13.25. Respect for the journey. 🌯",
        outputScale: 0.6,
      },
    ],
  },

  chitchat: {
    key: "chitchat",
    contextTokens: 2800,
    turns: [
      {
        userText: "thanks for handling the order yesterday, the team loved it",
        toolCalls: [],
        finalText: "Anytime! The poke bowls were the clear winner — I'll surface Ahi House earlier next time. 🙌",
        outputScale: 0.6,
      },
    ],
  },
} satisfies Record<ScenarioKey, Scenario>;

export interface SpikeScenario {
  key: string;
  contextTokens: number;
  userText: string;
  failingTool: SeededToolName;
  toolError: string;
  retries: number;
  finalText: string;
}

/**
 * The runaway turn behind the anomaly-alert demo: estimate_nutrition starts
 * timing out, the agent retries with the growing error transcript in
 * context, and one turn burns more input tokens than a normal week. The
 * time-series widget shows the spike; the trace shows exactly why.
 */
export const SPIKE_SCENARIO = {
  key: "nutrition-retry-storm",
  contextTokens: 6000,
  userText: "macro check on the whole menu for the wellness challenge please",
  failingTool: "estimate_nutrition",
  toolError: "UpstreamTimeout: nutrition model call exceeded 30000ms (attempt logged to thread)",
  retries: 18,
  finalText:
    "I couldn't finish the macro sheet — the nutrition service kept timing out, so I've posted what I had for 2 of 6 items and flagged the rest. Will retry after lunch.",
} satisfies SpikeScenario;
