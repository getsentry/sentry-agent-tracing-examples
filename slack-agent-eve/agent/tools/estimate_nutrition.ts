import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateObject } from "ai";
import { defineTool } from "eve/tools";
import { z } from "zod";

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY!,
});

const estimatesSchema = z.object({
  estimates: z.array(
    z.object({
      name: z.string(),
      // Not .int(): Zod 4 renders it as JSON-Schema integer with safe-int
      // minimum/maximum bounds, which Azure-hosted models behind OpenRouter
      // reject in structured output. Rounded in execute instead.
      calories: z.number(),
      proteinG: z.number(),
      carbsG: z.number(),
      fatG: z.number(),
      confidence: z
        .enum(["low", "medium", "high"])
        .describe("How standardized this dish is across restaurants"),
    }),
  ),
});

export default defineTool({
  description:
    "Estimate calories and macros (protein/carbs/fat in grams) for up to 10 menu items in one call. Estimates come from a dedicated model call, not from your own knowledge — always use this tool for any nutrition number you present.",
  inputSchema: z.object({
    items: z
      .array(
        z.object({
          name: z.string().min(1),
          description: z.string().nullish().describe("Menu description, for portion hints"),
        }),
      )
      .min(1)
      .max(10),
  }),
  async execute({ items }) {
    // A separate cheap model call: it shows up in the trace as its own
    // gen_ai.generate_content span nested inside this tool's execute_tool span
    // (eve's registerTelemetry covers every AI SDK call in the process).
    const { object } = await generateObject({
      model: openrouter.chat(process.env.NUTRITION_MODEL ?? "anthropic/claude-haiku-4.5"),
      schema: estimatesSchema,
      prompt: [
        "Estimate the nutrition of each restaurant menu item below as typically served (one serving, as delivered).",
        "Use the description for portion and ingredient hints. Round calories to the nearest 10.",
        "",
        JSON.stringify(items, null, 2),
      ].join("\n"),
    });
    return {
      estimates: object.estimates.map((e) => ({ ...e, calories: Math.round(e.calories) })),
    };
  },
});
