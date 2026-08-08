import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import * as Sentry from "@sentry/nextjs";
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  toUIMessageStream,
} from "ai";
import { tools, type AssistantUIMessage } from "lib/ai/tools";
import { DEMO_USER } from "lib/demo-user";

export const maxDuration = 30;

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

const instructions =
  "You are the shopping assistant for Acme Store. " +
  "Use searchProducts to find products (search with product-type keywords " +
  'like "hoodie" or "mug", or browse a collection), getProduct for one ' +
  "specific product, and getAccountInfo for anything about the customer's " +
  "account, orders, or loyalty points. Use refundOrder when the customer " +
  "asks to refund or return an order - confirm which order first, then call " +
  "it with the order id. If refundOrder errors, apologize briefly and say " +
  "the team has been notified; never retry it. Tool results render as rich cards in " +
  "the chat, so never repeat prices or product details in your text - add " +
  "one short, helpful sentence around the cards instead. Prices are in USD. " +
  "Be concise and friendly.";

export async function POST(req: Request) {
  const { id, messages }: { id?: string; messages: AssistantUIMessage[] } =
    await req.json();

  // Attribute this turn to the demo customer and thread all turns of one
  // chat session into a single Sentry Conversation. Must happen before the
  // AI call so the gen_ai spans pick both up.
  Sentry.setUser(DEMO_USER);
  if (id) Sentry.setConversationId(id);

  const result = streamText({
    model: openrouter(process.env.OPENROUTER_MODEL ?? "openai/gpt-4o-mini"),
    instructions,
    messages: await convertToModelMessages(messages),
    tools,
    stopWhen: isStepCount(5),
    // functionId names the agent in Sentry's AI Agents dashboard;
    // recordInputs/recordOutputs make prompts and tool payloads visible.
    experimental_telemetry: {
      functionId: "shopping-assistant",
      recordInputs: true,
      recordOutputs: true,
    },
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream }),
  });
}
