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
import { GEN_AI_CONTENT_CAPTURE } from "lib/sentry-content-capture";

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
  const seedRun = req.headers.get("x-demo-run");

  // Attribute this turn to the shopper and thread all turns of one chat
  // session into a single Sentry Conversation. Must happen before the AI call
  // so the gen_ai spans pick both up.
  Sentry.setUser(shopper);
  if (id) {
    Sentry.setConversationId(id);
    // setConversationId only reaches gen_ai spans (it registers a spanStart
    // handler). The tag puts the same id on the errors and transactions of
    // this request, which is what makes an issue searchable back to its chat.
    Sentry.getIsolationScope().setTag("gen_ai.conversation.id", id);
  }
  // Set by scripts/traffic.ts so a seeded batch can be filtered out of, or
  // isolated in, the same views as real browser sessions.
  if (seedRun) Sentry.getIsolationScope().setTag("demo.seed_run", seedRun);

  const result = streamText({
    // The single-argument call resolves to the provider's completion overload;
    // .chat is the one that matches this route's message-based prompt.
    model: openrouter.chat(model),
    instructions,
    messages: await convertToModelMessages(messages),
    tools: createTools(shopper.id, id),
    stopWhen: isStepCount(5),
    // functionId names the agent in Sentry's AI Agents dashboard. The AI SDK
    // emits prompts and completions on its telemetry channel, and
    // dataCollection.genAI decides what Sentry keeps of them; both sides read
    // the same pair so a disabled direction is never emitted in the first
    // place.
    telemetry: {
      functionId: "shopping-assistant",
      recordInputs: GEN_AI_CONTENT_CAPTURE.inputs,
      recordOutputs: GEN_AI_CONTENT_CAPTURE.outputs,
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
