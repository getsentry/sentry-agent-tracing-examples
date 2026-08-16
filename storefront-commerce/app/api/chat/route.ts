import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import * as Sentry from "@sentry/nextjs";
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  toUIMessageStream,
} from "ai";
import { resolveModel } from "lib/ai/models";
import { createTools, type AssistantUIMessage } from "lib/ai/tools";
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

  // Attribute this turn to the shopper and thread all turns of one chat
  // session into a single Sentry Conversation. Must happen before the AI call
  // so the gen_ai spans pick both up.
  Sentry.setUser(DEMO_USER);
  if (id) {
    Sentry.setConversationId(id);
    // setConversationId only reaches gen_ai spans (it registers a spanStart
    // handler). The tag puts the same id on this request's errors, which is
    // what makes an issue searchable back to its chat.
    Sentry.getIsolationScope().setTag("gen_ai.conversation.id", id);
  }

  const result = streamText({
    // The single-argument call resolves to the provider's completion overload;
    // .chat is the one that matches this route's message-based prompt.
    model: openrouter.chat(resolveModel()),
    instructions,
    messages: await convertToModelMessages(messages),
    tools: createTools(DEMO_USER.id, id),
    stopWhen: isStepCount(5),
    // functionId names the agent in Sentry's AI Agents dashboard.
    telemetry: {
      functionId: "shopping-assistant",
    },
    // streamText resolves rather than throws when the model or the provider
    // fails, and Sentry's vercel-ai subscriber only fails the span, so without
    // this a bad key or a provider 5xx creates no issue.
    onError: ({ error }) => {
      Sentry.captureException(error);
    },
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      // Tool errors reach this callback too, and the VercelAI integration
      // already captures those — so this only decides what the client is
      // told. Stream errors are captured by streamText's onError above.
      onError: () => "The shopping assistant hit an error. Please try again.",
    }),
  });
}
