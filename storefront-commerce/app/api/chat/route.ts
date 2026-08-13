import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import * as Sentry from "@sentry/nextjs";
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  toUIMessageStream,
} from "ai";
import { modelById } from "lib/ai/models";
import { createTools, type AssistantUIMessage } from "lib/ai/tools";
import { shopperById } from "lib/demo-user";

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

  // The demo store has no sign-in, so the shopper and the model come off the
  // request. Both resolve through an allow-list (lib/demo-user, lib/ai/models)
  // and fall back to the defaults, so the headers only pick between fixtures.
  const shopper = shopperById(req.headers.get("x-demo-shopper"));
  const model = modelById(req.headers.get("x-demo-model"));

  // Attribute this turn to the shopper and thread all turns of one chat
  // session into a single Sentry Conversation. Must happen before the AI call
  // so the gen_ai spans pick both up.
  Sentry.setUser(shopper);
  if (id) Sentry.setConversationId(id);

  const result = streamText({
    model: openrouter(model),
    instructions,
    messages: await convertToModelMessages(messages),
    tools: createTools(shopper.id),
    stopWhen: isStepCount(5),
    // functionId names the agent in Sentry's AI Agents dashboard. The AI SDK
    // records inputs and outputs by default; what Sentry keeps of them is set
    // once by dataCollection.genAI in sentry.server.config.ts.
    telemetry: { functionId: "shopping-assistant" },
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream }),
  });
}
