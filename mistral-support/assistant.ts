import { Mistral } from "@mistralai/mistralai";
import type { ChatCompletionRequest } from "@mistralai/mistralai/models/components";
import { orderTool, lookupOrder } from "./orders.ts";

const mistral = new Mistral({ apiKey: process.env.MISTRAL_API_KEY });
const model = process.env.MISTRAL_MODEL || "mistral-small-latest";

export const history: ChatCompletionRequest["messages"] = [{
  role: "system",
  content: "You help with order status. Use lookup_order for each question. " +
    "Use only the returned order data. Keep answers to two short sentences.",
}];

export async function answer(question: string, failLookup = false): Promise<string> {
  const messages: ChatCompletionRequest["messages"] = [...history, { role: "user", content: question }];
  const response = await mistral.chat.complete({
    model, messages, tools: [orderTool],
    toolChoice: "any", parallelToolCalls: false,
  });
  const message = response.choices?.[0]?.message;
  const call = message?.toolCalls?.[0];
  if (!message || !call?.id || message.toolCalls?.length !== 1) {
    throw new Error("Expected one order lookup");
  }

  messages.push({ role: "assistant", content: message.content, toolCalls: message.toolCalls });
  const result = await lookupOrder(call, failLookup);
  messages.push({ role: "tool", toolCallId: call.id, content: result });

  const stream = await mistral.chat.stream({ model, messages });
  let reply = "";
  for await (const event of stream) {
    const content = event.data.choices?.[0]?.delta.content;
    const text = typeof content === "string" ? content : (content ?? [])
      .filter((part) => part.type === "text")
      .map((part) => part.text).join("");
    reply += text;
    process.stdout.write(text);
  }
  process.stdout.write("\n");
  history.push(...messages.slice(history.length), { role: "assistant", content: reply });
  return reply;
}
