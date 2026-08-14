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
    // A separate cheap model call, nested inside this tool's execute_tool
    // span. eve's own telemetry registration means every AI SDK call in the
    // process is covered; the span's gen_ai op comes from the beforeSendSpan
    // derivation in agent/instrumentation.ts, since this demo filters the
    // vercelAI integration out.
    //
    // functionId does not reach Sentry: eve stamps gen_ai.agent.name from the
    // harness scope it is running in (agent-otel-provider.js onModelCallStarted),
    // so this call arrives as the agent's own, and beforeSendSpan then rewrites
    // its description to `invoke_agent <agent>`. In Sentry the only things that
    // set it apart are the model id and its parent execute_tool span, so filter
    // on gen_ai.request.model to see it alone.
    const { object } = await generateObject({
      model: openrouter.chat(process.env.NUTRITION_MODEL ?? "openai/gpt-5.6-luna"),
      telemetry: { functionId: "nutrition-estimator" },
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
