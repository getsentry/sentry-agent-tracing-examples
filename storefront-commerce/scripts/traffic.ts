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
import { parseArgs } from "node:util";
import { PERSONAS, scenario } from "./scenarios.ts";

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

interface UIMessage {
  id: string;
  role: "user" | "assistant";
  parts: { type: "text"; text: string }[];
}

interface TurnResult {
  text: string;
  toolCalls: string[];
  toolErrors: number;
}

/** Reads the UI message stream to the end. The reply text is needed for the
 * next turn's history; the tool names are only for the console log. */
async function readStream(
  body: ReadableStream<Uint8Array>,
): Promise<TurnResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const result: TurnResult = { text: "", toolCalls: [], toolErrors: 0 };
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let cut: number;
    while ((cut = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      for (const rawLine of block.split("\n")) {
        if (!rawLine.startsWith("data:")) continue;
        const payload = rawLine.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        const chunk = JSON.parse(payload);
        if (chunk.type === "text-delta") result.text += chunk.delta;
        else if (chunk.type === "tool-input-available")
          result.toolCalls.push(chunk.toolName);
        else if (chunk.type === "tool-output-error") result.toolErrors += 1;
        else if (chunk.type === "error")
          throw new Error(`stream error: ${chunk.errorText}`);
      }
    }
  }
  return result;
}

async function runTurn(
  shopperId: string,
  model: string,
  chatId: string,
  messages: UIMessage[],
): Promise<TurnResult> {
  const response = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-demo-shopper": shopperId,
      "x-demo-model": model,
    },
    body: JSON.stringify({ id: chatId, messages }),
  });
  if (!response.ok || !response.body) {
    throw new Error(`${response.status} ${await response.text()}`);
  }
  return readStream(response.body);
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
        console.error(
          `  ✗ ${plan.username} ${plan.scenarioKey}: ${(error as Error).message.slice(0, 200)}`,
        );
      }
      await sleep(rng() * 1500);
    }
  }),
);

console.log(`\n${completed} conversations sent, ${failures} failed`);
process.exit(failures ? 1 : 0);
