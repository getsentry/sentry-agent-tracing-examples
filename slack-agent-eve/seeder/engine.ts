import * as Sentry from "@sentry/node";
import { AGENT_NAME } from "../agent/lib/agent-name.ts";
import { MODEL_RATES, type ModelId, type Persona } from "./personas.ts";
import {
  SCENARIOS,
  SPIKE_SCENARIO,
  type JsonObject,
  type JsonValue,
  type Scenario,
  type ScenarioKey,
  type SeededToolName,
  type Turn,
} from "./scenarios.ts";

/**
 * Emits hand-built gen_ai spans following Sentry's AI-agents conventions
 * (develop.sentry.dev/sdk/telemetry/traces/modules/ai-agents/). Manual spans
 * instead of driving the ai SDK with a mock model for one reason: explicit
 * `startTime`/`end(timestamp)` lets a single run backfill days of history,
 * which OTel-clocked integration spans cannot do. Only token counts and the
 * OpenRouter model id are sent — Sentry's Relay computes the USD cost
 * attributes (gen_ai.cost.*) server-side from its own pricing feed.
 *
 * Backdating bounds: Relay drops transactions outside now-5d..now+60s, so the
 * seeder never reaches further back than 4.5 days.
 */

export interface SpendSample {
  day: string;
  user: string;
  model: ModelId;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  projectedUsd: number;
  turns: number;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;

const uniform = (rng: Rng, lo: number, hi: number) => lo + rng() * (hi - lo);
const randint = (rng: Rng, lo: number, hi: number) => Math.floor(uniform(rng, lo, hi + 1));

function pickWeighted<T>(rng: Rng, entries: Array<[T, number]>): T {
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let roll = rng() * total;
  for (const [value, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return value;
  }
  return entries[entries.length - 1][0];
}

/** ~4 chars per token, the usual rough English/JSON heuristic. */
const tokensFor = (value: JsonValue) => Math.ceil(JSON.stringify(value).length / 4);

const TOOL_LATENCY = {
  get_menu: [0.3, 1.2],
  get_item_details: [0.2, 0.8],
  // estimate_nutrition makes its own model call, hence the long tail
  estimate_nutrition: [1.5, 4.0],
  present_meal_options: [0.4, 1.5],
  add_to_cart: [0.15, 0.5],
  resolve_group_cart: [1.0, 3.0],
} satisfies Record<SeededToolName, [number, number]>;

interface ChatUsage {
  input: number;
  output: number;
  cacheRead: number;
}

function projectUsd(model: ModelId, usage: ChatUsage): number {
  const rates = MODEL_RATES[model];
  return (
    (usage.input - usage.cacheRead) * rates.input +
    usage.cacheRead * rates.cachedInput +
    usage.output * rates.output
  );
}

/**
 * gen_ai.input.messages / gen_ai.output.messages carry a JSON array of
 * role-plus-parts messages (@sentry/conventions attributes.d.ts).
 */
interface TextPart {
  type: "text";
  content: string;
}

interface ToolCallPart {
  type: "tool_call";
  id: string;
  name: SeededToolName;
  arguments: JsonObject;
}

interface ToolResponsePart {
  type: "tool_call_response";
  id: string;
  result: string;
}

interface GenAiMessage {
  role: "system" | "user" | "assistant" | "tool";
  parts: Array<TextPart | ToolCallPart | ToolResponsePart>;
  finish_reason?: string;
}

interface TurnContext {
  rng: Rng;
  persona: Persona;
  scenario: Scenario;
  model: ModelId;
  conversationId: string;
  seedRun: string;
  turnIndex: number;
  /** Input tokens of the previous turn's last chat, for warm-cache reads. */
  priorInput: number;
}

/**
 * Sentry's SpanTimeInput and OTel's TimeInput disagree on what a bare
 * number means (seconds vs milliseconds). Date is unambiguous in both, so
 * every startTime/end goes through this.
 */
const at = (sec: number) => new Date(sec * 1000);

interface ChatSpanInput {
  start: number;
  usage: ChatUsage;
  inputMessages: GenAiMessage[];
  outputMessages: GenAiMessage[];
}

// Written as a type alias, not an interface: Sentry's attributes bag is an
// index-signature type, and only type aliases get an implicit one.
type ChatSpanAttributes = {
  "gen_ai.operation.name": string;
  "gen_ai.provider.name": string;
  "gen_ai.request.model": string;
  "gen_ai.response.model": string;
  "gen_ai.usage.input_tokens": number;
  "gen_ai.usage.output_tokens": number;
  "gen_ai.usage.total_tokens": number;
  "gen_ai.usage.cache_read.input_tokens"?: number;
  "gen_ai.conversation.id": string;
  "gen_ai.input.messages": string;
  "gen_ai.output.messages": string;
  // Standalone gen_ai spans travel without the transaction's event-level
  // user, so the dashboard's group-by key rides on the span itself — the
  // live agent stamps the same attribute in beforeSendSpan.
  "user.id": string;
  "demo.seed_run": string;
};

function chatSpan(ctx: TurnContext, opts: ChatSpanInput): number {
  const { rng, model } = ctx;
  const duration =
    0.5 + opts.usage.output / uniform(rng, 30, 70) + uniform(rng, 0.2, 0.9);
  const end = opts.start + duration;
  const attributes: ChatSpanAttributes = {
    "gen_ai.operation.name": "chat",
    "gen_ai.provider.name": "openrouter",
    "gen_ai.request.model": model,
    "gen_ai.response.model": model,
    "gen_ai.usage.input_tokens": opts.usage.input,
    "gen_ai.usage.output_tokens": opts.usage.output,
    "gen_ai.usage.total_tokens": opts.usage.input + opts.usage.output,
    "gen_ai.conversation.id": ctx.conversationId,
    "gen_ai.input.messages": JSON.stringify(opts.inputMessages).slice(0, 4000),
    "gen_ai.output.messages": JSON.stringify(opts.outputMessages).slice(0, 4000),
    "user.id": ctx.persona.id,
    "demo.seed_run": ctx.seedRun,
  };
  if (opts.usage.cacheRead > 0) {
    attributes["gen_ai.usage.cache_read.input_tokens"] = opts.usage.cacheRead;
  }
  Sentry.startSpan(
    { op: "gen_ai.chat", name: `chat ${model}`, startTime: at(opts.start), attributes },
    (span) => span.end(at(end)),
  );
  return end;
}

interface ToolSpanInput {
  start: number;
  tool: SeededToolName;
  args: JsonObject;
  result: JsonValue;
  error?: string;
}

function toolSpan(ctx: TurnContext, opts: ToolSpanInput): number {
  const [lo, hi] = TOOL_LATENCY[opts.tool];
  const end = opts.start + uniform(ctx.rng, lo, hi);
  Sentry.startSpan(
    {
      op: "gen_ai.execute_tool",
      name: `execute_tool ${opts.tool}`,
      startTime: at(opts.start),
      attributes: {
        "gen_ai.operation.name": "execute_tool",
        "gen_ai.tool.name": opts.tool,
        "gen_ai.tool.type": "function",
        "gen_ai.tool.call.arguments": JSON.stringify(opts.args),
        "gen_ai.tool.call.result": JSON.stringify(opts.error ?? opts.result).slice(0, 4000),
        "gen_ai.conversation.id": ctx.conversationId,
        "user.id": ctx.persona.id,
        "demo.seed_run": ctx.seedRun,
      },
    },
    (span) => {
      if (opts.error) {
        span.setStatus({ code: 2, message: "internal_error" });
        // A live tool failure throws inside execute, and the ai:telemetry
        // subscriber turns that into an issue linked to the span. Capturing
        // here from inside the span gives the fixture the same link, so the
        // Tool Errors widget has an issue to open. The event timestamp is
        // "now" — only the spans are backdated.
        Sentry.withScope((scope) => {
          scope.setTag("gen_ai.conversation.id", ctx.conversationId);
          scope.setTag("gen_ai.tool.name", opts.tool);
          scope.setUser({ id: ctx.persona.id, username: ctx.persona.username });
          Sentry.captureException(new Error(opts.error));
        });
      }
      span.end(at(end));
    },
  );
  return end;
}

interface TurnOutcome {
  endSec: number;
  usage: ChatUsage;
  usd: number;
}

// Same reason as ChatSpanAttributes: assigned into Sentry's attributes bag.
type AgentSpanUsage = {
  "gen_ai.usage.input_tokens": number;
  "gen_ai.usage.output_tokens": number;
  "gen_ai.usage.total_tokens": number;
  "gen_ai.usage.cache_read.input_tokens"?: number;
  "gen_ai.output.messages": string;
};

const assistantText = (content: string): GenAiMessage[] => [
  { role: "assistant", parts: [{ type: "text", content }], finish_reason: "stop" },
];

/** One user message + the agent's tool loop = one trace, as in real eve. */
function runTurn(ctx: TurnContext, turn: Turn, startSec: number): TurnOutcome {
  const { rng, persona, scenario } = ctx;
  const base =
    Math.round(scenario.contextTokens * persona.contextScale * uniform(rng, 0.9, 1.15)) +
    ctx.turnIndex * Math.round(uniform(rng, 600, 1000));

  const totals: ChatUsage = { input: 0, output: 0, cacheRead: 0 };
  let usd = 0;
  let turnEnd = startSec;

  Sentry.startNewTrace(() => {
    Sentry.startSpan(
      {
        op: "http.server",
        name: "POST /eve/v1/slack",
        forceTransaction: true,
        startTime: at(startSec),
        attributes: {
          "http.request.method": "POST",
          "url.path": "/eve/v1/slack",
          "http.response.status_code": 200,
          "demo.seed_run": ctx.seedRun,
        },
      },
      (root) => {
        const agentStart = startSec + uniform(rng, 0.03, 0.15);
        Sentry.startSpan(
          {
            op: "gen_ai.invoke_agent",
            name: `invoke_agent ${AGENT_NAME}`,
            startTime: at(agentStart),
            attributes: {
              "gen_ai.operation.name": "invoke_agent",
              "gen_ai.agent.name": AGENT_NAME,
              "gen_ai.provider.name": "openrouter",
              "gen_ai.request.model": ctx.model,
              "gen_ai.conversation.id": ctx.conversationId,
              "user.id": ctx.persona.id,
              "demo.seed_run": ctx.seedRun,
            },
          },
          (agentSpan) => {
            let cursor = agentStart + uniform(rng, 0.05, 0.2);
            let input = base + tokensFor(turn.userText);
            let prevOutput = 0;
            const history: GenAiMessage[] = [
              {
                role: "system",
                parts: [{ type: "text", content: "You are Mealbot, the DoorDash ordering bot." }],
              },
              { role: "user", parts: [{ type: "text", content: turn.userText }] },
            ];

            const step = (usage: ChatUsage, opts: ChatSpanInput) => {
              totals.input += usage.input;
              totals.output += usage.output;
              totals.cacheRead += usage.cacheRead;
              usd += projectUsd(ctx.model, usage);
              cursor = chatSpan(ctx, opts) + uniform(rng, 0.02, 0.1);
            };

            for (let i = 0; i < turn.toolCalls.length; i++) {
              const call = turn.toolCalls[i];
              const callId = `call_seed_${ctx.turnIndex}_${i}`;
              const cacheRead =
                i === 0
                  ? ctx.turnIndex > 0
                    ? Math.round(ctx.priorInput * uniform(rng, 0.5, 0.75))
                    : 0
                  : Math.round(input * uniform(rng, 0.65, 0.85));
              const output = randint(rng, 35, 95);
              const toolCallPart: ToolCallPart = {
                type: "tool_call",
                id: callId,
                name: call.tool,
                arguments: call.args,
              };
              step(
                { input, output, cacheRead },
                {
                  start: cursor,
                  usage: { input, output, cacheRead },
                  inputMessages: [...history],
                  outputMessages: [
                    { role: "assistant", parts: [toolCallPart], finish_reason: "tool_calls" },
                  ],
                },
              );
              cursor = toolSpan(ctx, { start: cursor, tool: call.tool, args: call.args, result: call.result }) +
                uniform(rng, 0.02, 0.08);
              history.push({ role: "assistant", parts: [toolCallPart] });
              history.push({
                role: "tool",
                parts: [{ type: "tool_call_response", id: callId, result: "[result]" }],
              });
              prevOutput = output;
              input += tokensFor(call.result) + prevOutput + 20;
            }

            const finalOutput = Math.round(180 * turn.outputScale * uniform(rng, 0.8, 1.25));
            const finalCache =
              turn.toolCalls.length > 0
                ? Math.round(input * uniform(rng, 0.65, 0.85))
                : ctx.turnIndex > 0
                  ? Math.round(ctx.priorInput * uniform(rng, 0.5, 0.75))
                  : 0;
            step(
              { input, output: finalOutput, cacheRead: finalCache },
              {
                start: cursor,
                usage: { input, output: finalOutput, cacheRead: finalCache },
                inputMessages: [...history],
                outputMessages: assistantText(turn.finalText),
              },
            );

            ctx.priorInput = input;
            const usage: AgentSpanUsage = {
              "gen_ai.usage.input_tokens": totals.input,
              "gen_ai.usage.output_tokens": totals.output,
              "gen_ai.usage.total_tokens": totals.input + totals.output,
              "gen_ai.output.messages": JSON.stringify(assistantText(turn.finalText)).slice(0, 4000),
            };
            if (totals.cacheRead > 0) {
              usage["gen_ai.usage.cache_read.input_tokens"] = totals.cacheRead;
            }
            agentSpan.setAttributes(usage);
            turnEnd = cursor;
            agentSpan.end(at(cursor));
          },
        );
        root.end(at(turnEnd + uniform(rng, 0.02, 0.06)));
      },
    );
  });

  return { endSec: turnEnd, usage: totals, usd };
}

export function runConversation(opts: {
  rng: Rng;
  persona: Persona;
  startSec: number;
  seedRun: string;
  scenarioKey?: ScenarioKey;
}): SpendSample {
  const { rng, persona } = opts;
  const scenarioKey = opts.scenarioKey ?? pickWeighted(rng, persona.scenarioWeights);
  const scenario = SCENARIOS[scenarioKey];
  const model = pickWeighted(rng, persona.models);
  const conversationId = `${Math.floor(opts.startSec)}.${String(randint(rng, 100000, 999999))}`;

  const sample: SpendSample = {
    day: new Date(opts.startSec * 1000).toISOString().slice(0, 10),
    user: persona.username,
    model,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    projectedUsd: 0,
    turns: scenario.turns.length,
  };

  Sentry.withIsolationScope((scope) => {
    scope.setUser({ id: persona.id, username: persona.username, email: persona.email });
    const ctx: TurnContext = {
      rng,
      persona,
      scenario,
      model,
      conversationId,
      seedRun: opts.seedRun,
      turnIndex: 0,
      priorInput: 0,
    };
    let cursor = opts.startSec;
    for (let i = 0; i < scenario.turns.length; i++) {
      ctx.turnIndex = i;
      const { endSec, usage, usd } = runTurn(ctx, scenario.turns[i], cursor);
      sample.inputTokens += usage.input;
      sample.outputTokens += usage.output;
      sample.cacheReadTokens += usage.cacheRead;
      sample.projectedUsd += usd;
      // The user reads the reply, thinks, types the follow-up.
      cursor = endSec + uniform(rng, 30, 240);
    }
  });

  return sample;
}

/**
 * The anomaly-day story: estimate_nutrition times out, the agent keeps
 * retrying with the accumulated error transcript in context. Cache only
 * covers the stable system prefix — the churning tail is all full-price
 * input, which is exactly why runaway loops get expensive.
 */
export function runSpike(opts: {
  rng: Rng;
  persona: Persona;
  startSec: number;
  seedRun: string;
}): SpendSample {
  const { rng, persona } = opts;
  const model = persona.models[0][0];
  const conversationId = `${Math.floor(opts.startSec)}.${String(randint(rng, 100000, 999999))}`;
  const basePrefix = Math.round(SPIKE_SCENARIO.contextTokens * persona.contextScale);

  const sample: SpendSample = {
    day: new Date(opts.startSec * 1000).toISOString().slice(0, 10),
    user: persona.username,
    model,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    projectedUsd: 0,
    turns: 1,
  };

  Sentry.withIsolationScope((scope) => {
    scope.setUser({ id: persona.id, username: persona.username, email: persona.email });
    Sentry.startNewTrace(() => {
      Sentry.startSpan(
        {
          op: "http.server",
          name: "POST /eve/v1/slack",
          forceTransaction: true,
          startTime: at(opts.startSec),
          attributes: {
            "http.request.method": "POST",
            "url.path": "/eve/v1/slack",
            "http.response.status_code": 200,
            "demo.seed_run": opts.seedRun,
          },
        },
        (root) => {
          Sentry.startSpan(
            {
              op: "gen_ai.invoke_agent",
              name: `invoke_agent ${AGENT_NAME}`,
              startTime: at(opts.startSec + 0.1),
              attributes: {
                "gen_ai.operation.name": "invoke_agent",
                "gen_ai.agent.name": AGENT_NAME,
                "gen_ai.provider.name": "openrouter",
                "gen_ai.request.model": model,
                "gen_ai.conversation.id": conversationId,
                "user.id": persona.id,
                "demo.seed_run": opts.seedRun,
              },
            },
            (agentSpan) => {
              const ctx: TurnContext = {
                rng,
                persona,
                scenario: SCENARIOS["quick-menu"], // unused by chat/toolSpan; spike sizes its own context
                model,
                conversationId,
                seedRun: opts.seedRun,
                turnIndex: 0,
                priorInput: 0,
              };
              let cursor = opts.startSec + 0.3;
              let input = basePrefix + tokensFor(SPIKE_SCENARIO.userText);
              for (let attempt = 0; attempt <= SPIKE_SCENARIO.retries; attempt++) {
                const output = randint(rng, 40, 110);
                const cacheRead = attempt === 0 ? 0 : basePrefix;
                sample.inputTokens += input;
                sample.outputTokens += output;
                sample.cacheReadTokens += cacheRead;
                sample.projectedUsd += projectUsd(model, { input, output, cacheRead });
                cursor = chatSpan(ctx, {
                  start: cursor,
                  usage: { input, output, cacheRead },
                  inputMessages: [
                    {
                      role: "system",
                      parts: [
                        { type: "text", content: "You are Mealbot, the DoorDash ordering bot." },
                      ],
                    },
                    { role: "user", parts: [{ type: "text", content: SPIKE_SCENARIO.userText }] },
                    {
                      role: "assistant",
                      parts: [
                        {
                          type: "text",
                          content: `[retry ${attempt} of ${SPIKE_SCENARIO.retries}]`,
                        },
                      ],
                    },
                  ],
                  outputMessages: [
                    {
                      role: "assistant",
                      parts: [
                        {
                          type: "tool_call",
                          id: `call_seed_spike_${attempt}`,
                          name: SPIKE_SCENARIO.failingTool,
                          arguments: { itemId: "menu-sweep", attempt },
                        },
                      ],
                      finish_reason: "tool_calls",
                    },
                  ],
                });
                cursor = toolSpan(ctx, {
                  start: cursor,
                  tool: SPIKE_SCENARIO.failingTool,
                  args: { itemId: "menu-sweep", attempt },
                  result: null,
                  error: SPIKE_SCENARIO.toolError,
                }) + uniform(rng, 0.5, 2);
                // Each retry drags the full error transcript back into context.
                input += Math.round(uniform(rng, 2400, 3200)) + output;
              }
              const finalOutput = 220;
              sample.inputTokens += input;
              sample.outputTokens += finalOutput;
              sample.cacheReadTokens += basePrefix;
              sample.projectedUsd += projectUsd(model, {
                input,
                output: finalOutput,
                cacheRead: basePrefix,
              });
              cursor = chatSpan(ctx, {
                start: cursor,
                usage: { input, output: finalOutput, cacheRead: basePrefix },
                inputMessages: [
                  { role: "user", parts: [{ type: "text", content: SPIKE_SCENARIO.userText }] },
                ],
                outputMessages: assistantText(SPIKE_SCENARIO.finalText),
              });
              agentSpan.setAttributes({
                "gen_ai.usage.input_tokens": sample.inputTokens,
                "gen_ai.usage.output_tokens": sample.outputTokens,
                "gen_ai.usage.total_tokens": sample.inputTokens + sample.outputTokens,
                "gen_ai.usage.cache_read.input_tokens": sample.cacheReadTokens,
                "gen_ai.output.messages": JSON.stringify(
                  assistantText(SPIKE_SCENARIO.finalText),
                ).slice(0, 4000),
              });
              agentSpan.end(at(cursor));
              root.end(at(cursor + 0.05));
            },
          );
        },
      );
    });
  });

  return sample;
}

/**
 * Conversation start times for one persona-day. A lunch bot's traffic isn't
 * uniform: it piles up between 11:00 and 13:30, with a pre-lunch planning
 * bump and a light afternoon tail.
 */
export function planDay(rng: Rng, persona: Persona, dayStart: Date): number[] {
  const weekday = dayStart.getDay();
  const factor = weekday === 0 ? 0.15 : weekday === 6 ? 0.4 : 1;
  const [lo, hi] = persona.conversationsPerDay;
  const count = Math.round(uniform(rng, lo, hi) * factor);
  const times: number[] = [];
  for (let i = 0; i < count; i++) {
    const roll = rng();
    const hour =
      roll < 0.6
        ? uniform(rng, 11.0, 13.5)
        : roll < 0.85
          ? uniform(rng, 9.5, 11.0)
          : uniform(rng, 13.5, 16.5);
    times.push(dayStart.getTime() / 1000 + hour * 3600);
  }
  return times.sort((a, b) => a - b);
}
