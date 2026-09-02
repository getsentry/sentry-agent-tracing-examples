import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { defineAgent } from "eve";

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY!,
});

export default defineAgent({
  // A provider instance (rather than a model id string) makes eve talk to
  // OpenRouter directly, bypassing the Vercel AI Gateway — no AI_GATEWAY_API_KEY.
  model: openrouter.chat("anthropic/claude-sonnet-5"),
  // Eve resolves context windows from the AI Gateway catalog, which it cannot
  // do for external models; this keeps its compaction thresholds sane.
  modelContextWindowTokens: 200_000,
});
