// Fails when the installed Sentry and Mistral SDKs stop producing agent spans.
// It runs the example code against a mocked Mistral API, so it needs no keys.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as Sentry from "@sentry/node";

type Attributes = Record<string, unknown>;
const spans: Attributes[] = [];

Sentry.init({
  dsn: "https://public@sentry.invalid/1",
  tracesSampleRate: 1.0,
  dataCollection: { genAI: { inputs: true, outputs: true } },
  transport: () => ({ send: async () => ({}), flush: async () => true }),
  beforeSendSpan(span) {
    spans.push(span.attributes ?? {});
    return span;
  },
});

const usage = { prompt_tokens: 11, completion_tokens: 5, total_tokens: 16 };
globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  assert.equal(new URL(request.url).hostname, "api.mistral.ai");
  const body = await request.json();
  if (!body.stream) {
    return Response.json({
      id: "c1", object: "chat.completion", created: 1, model: body.model, usage,
      choices: [{
        index: 0, finish_reason: "tool_calls",
        message: {
          role: "assistant", content: "",
          tool_calls: [{ id: "call1", type: "function", function: { name: "lookup_order", arguments: '{"orderId":"ORD-1001"}' } }],
        },
      }],
    });
  }
  const chunk = (delta: object, extra: object = {}) =>
    `data: ${JSON.stringify({ id: "s1", object: "chat.completion.chunk", created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: null }], ...extra })}\n\n`;
  return new Response(
    chunk({ role: "assistant", content: "Your Kettle shipped." }) + chunk({ content: "" }, { usage }) + "data: [DONE]\n\n",
    { headers: { "content-type": "text/event-stream" } },
  );
};

process.env.MISTRAL_API_KEY = "test";
// Import after Sentry.init so the Mistral integration can instrument the SDK.
const { answer } = await import("./assistant.ts");
const { traceTurn, lookupOrder } = await import("./tracing.ts");

async function recordSpans(run: () => Promise<unknown>): Promise<Attributes[]> {
  spans.length = 0;
  await run();
  await Sentry.flush(2000);
  return [...spans];
}

test("the Mistral integration traces the tool request and the streamed reply", async () => {
  const recorded = await recordSpans(() => answer("Where is order ORD-1001?"));
  const chats = recorded.filter((span) => span["sentry.op"] === "gen_ai.chat");

  assert.equal(chats.length, 2, `expected 2 gen_ai.chat spans, got: ${recorded.map((s) => s["sentry.op"]).join(", ")}`);
  assert.match(String(chats[0]?.["gen_ai.response.tool_calls"]), /lookup_order/);
  assert.match(String(chats[1]?.["gen_ai.output.messages"]), /Your Kettle shipped\./);
  for (const chat of chats) assert.equal(chat["gen_ai.usage.input_tokens"], 11);
});

test("the optional helpers add agent and tool spans", async () => {
  const call = { id: "call1", function: { name: "lookup_order", arguments: '{"orderId":"ORD-1001"}' } };
  const recorded = await recordSpans(() => traceTurn(() => lookupOrder(call, false)));
  const agent = recorded.find((span) => span["sentry.op"] === "gen_ai.invoke_agent");
  const tool = recorded.find((span) => span["sentry.op"] === "gen_ai.execute_tool");

  assert.equal(agent?.["gen_ai.agent.name"], "Order Support");
  assert.equal(tool?.["gen_ai.agent.name"], "Order Support");
  assert.equal(tool?.["gen_ai.tool.name"], "lookup_order");
  assert.match(String(tool?.["gen_ai.tool.call.result"]), /shipped/);
});
