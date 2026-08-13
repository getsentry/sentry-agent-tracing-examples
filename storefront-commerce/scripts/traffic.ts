/**
 * Storefront traffic runner — drives real conversations through /api/chat so
 * the AI Agents views and the LLM-spend dashboard have a cast instead of one
 * shopper.
 *
 *   node scripts/traffic.ts --dry-run
 *   node scripts/traffic.ts --base-url http://localhost:4322   # portless port
 *   node scripts/traffic.ts --concurrency 4 --seed 42
 *
 * Nothing is faked: each turn is an HTTP request the running app answers, so
 * the traces carry the same spans a browser session produces — gen_ai chat,
 * tool executions, and the db.query spans underneath them.
 */
import {
  DefaultChatTransport,
  getToolName,
  isTextUIPart,
  isToolUIPart,
  readUIMessageStream,
} from "ai";
import { parseArgs } from "node:util";
import { PERSONAS, scenario } from "./scenarios.ts";

import type { UIMessage } from "ai";

const { values: args } = parseArgs({
  options: {
    "base-url": {
      type: "string",
      default: process.env.STOREFRONT_URL ?? "http://localhost:3000",
    },
    concurrency: { type: "string", default: "3" },
    seed: { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
});

const baseUrl = args["base-url"]!.replace(/\/$/, "");
const concurrency = Math.max(1, Number(args.concurrency));
const seedNum = args.seed ? Number(args.seed) : Date.now() % 2147483647;
const dryRun = args["dry-run"];
/** Sent as x-demo-run and tagged onto every span the route opens, so one batch
 * of seeded conversations can be told apart from real browser sessions. */
const seedRun = `traffic-${seedNum}`;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(seedNum);

function pickWeighted<T>(entries: Array<[T, number]>): T {
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = rng() * total;
  for (const [value, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return value;
  }
  return entries[entries.length - 1]![0];
}

const ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
/** Matches the 16-char ids the chat panel mints, so seeded and browser
 * conversations look alike in Sentry's Conversations view. */
const conversationId = () =>
  Array.from({ length: 16 }, () => ALPHABET[Math.floor(rng() * 62)]).join("");

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface TurnResult {
  text: string;
  toolCalls: string[];
  toolErrors: number;
}

// The same transport the browser chat panel uses, so the seeded turns exercise
// the SSE framing and chunk schema the app ships with instead of a copy that
// drifts when a chunk type is renamed.
const transport = new DefaultChatTransport<UIMessage>({
  api: `${baseUrl}/api/chat`,
});

/** Runs one turn and reads the assembled assistant message. The reply text is
 * needed for the next turn's history; the tool names are only for the console
 * log. */
async function runTurn(
  shopperId: string,
  model: string,
  chatId: string,
  messages: UIMessage[],
): Promise<TurnResult> {
  const stream = await transport.sendMessages({
    trigger: "submit-message",
    chatId,
    messageId: undefined,
    abortSignal: undefined,
    messages,
    headers: {
      "x-demo-shopper": shopperId,
      "x-demo-model": model,
      "x-demo-run": seedRun,
    },
  });

  let streamError: Error | null = null;
  let assistant: UIMessage | undefined;
  for await (const message of readUIMessageStream({
    stream,
    onError: (error) => {
      streamError = error instanceof Error ? error : new Error(String(error));
    },
    terminateOnError: true,
  })) {
    assistant = message;
  }
  if (streamError) throw streamError;

  const parts = assistant?.parts ?? [];
  return {
    text: parts
      .filter(isTextUIPart)
      .map((part) => part.text)
      .join(""),
    toolCalls: parts.filter(isToolUIPart).map(getToolName),
    toolErrors: parts.filter(
      (part) => isToolUIPart(part) && part.state === "output-error",
    ).length,
  };
}

interface Plan {
  shopperId: string;
  username: string;
  model: string;
  scenarioKey: string;
  turns: string[];
  chatId: string;
}

/** Draws distinct scenarios before it repeats any, so a single run covers
 * every script a persona owns — a missing scenario is a hole in the demo
 * dataset, and pure weighted draws leave one often. */
function drawScenarios(persona: (typeof PERSONAS)[number]): string[] {
  const pool = [...persona.scenarios];
  const picks: string[] = [];
  while (picks.length < persona.conversations && pool.length > 0) {
    const key = pickWeighted(pool);
    picks.push(key);
    pool.splice(
      pool.findIndex(([candidate]) => candidate === key),
      1,
    );
  }
  while (picks.length < persona.conversations) {
    picks.push(pickWeighted(persona.scenarios));
  }
  return picks;
}

const plans: Plan[] = PERSONAS.flatMap((persona) =>
  drawScenarios(persona).map((key) => {
    const chosen = scenario(key);
    return {
      shopperId: persona.shopper.id,
      username: persona.shopper.username,
      model: pickWeighted(persona.models),
      scenarioKey: chosen.key,
      turns: chosen.turns,
      chatId: conversationId(),
    };
  }),
);

// Interleave shoppers so the run reads like concurrent visitors rather than
// one persona at a time.
for (let i = plans.length - 1; i > 0; i--) {
  const j = Math.floor(rng() * (i + 1));
  [plans[i], plans[j]] = [plans[j]!, plans[i]!];
}

console.log(
  `${plans.length} conversations · ${plans.reduce((n, p) => n + p.turns.length, 0)} turns · seed ${seedNum} · ${baseUrl}`,
);

if (dryRun) {
  for (const plan of plans) {
    console.log(
      `  ${plan.username.padEnd(10)} ${plan.model.padEnd(26)} ${plan.scenarioKey} (${plan.turns.length} turns)`,
    );
  }
  process.exit(0);
}

let failures = 0;
let completed = 0;

async function runConversation(plan: Plan): Promise<void> {
  const messages: UIMessage[] = [];
  const started = Date.now();
  const tools: string[] = [];

  for (const [index, turn] of plan.turns.entries()) {
    messages.push({
      id: `${plan.chatId}-u${index}`,
      role: "user",
      parts: [{ type: "text", text: turn }],
    });
    const result = await runTurn(
      plan.shopperId,
      plan.model,
      plan.chatId,
      messages,
    );
    tools.push(...result.toolCalls);
    // An assistant message with no text parts fails convertToModelMessages on
    // the next turn, so only real replies go back into the history.
    if (result.text.trim()) {
      messages.push({
        id: `${plan.chatId}-a${index}`,
        role: "assistant",
        parts: [{ type: "text", text: result.text }],
      });
    }
    if (index < plan.turns.length - 1) await sleep(500 + rng() * 2500);
  }

  completed += 1;
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `  ✓ ${plan.username.padEnd(10)} ${plan.scenarioKey.padEnd(17)} ${plan.model.padEnd(26)} ${seconds}s  ${tools.join(",") || "no tools"}`,
  );
}

const queue = [...plans];
await Promise.all(
  Array.from({ length: concurrency }, async () => {
    for (let plan = queue.shift(); plan; plan = queue.shift()) {
      try {
        await runConversation(plan);
      } catch (error) {
        failures += 1;
        const message = error instanceof Error ? error.message : String(error);
        console.error(
          `  ✗ ${plan.username} ${plan.scenarioKey}: ${message.slice(0, 200)}`,
        );
      }
      await sleep(rng() * 1500);
    }
  }),
);

console.log(`\n${completed} conversations sent, ${failures} failed`);
process.exit(failures ? 1 : 0);
