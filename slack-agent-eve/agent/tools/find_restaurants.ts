import { defineTool } from "eve/tools";
import { z } from "zod";
import { defaultDeliveryPoint, searchRestaurants } from "../lib/dd";

export default defineTool({
  description:
    "Find nearby restaurants that deliver to the account's default address. Use this to start a personal order when someone asks for food without posting a group-order link. Returns storeId values for get_menu.",
  inputSchema: z.object({
    query: z
      .string()
      .min(1)
      .describe('What they want, e.g. "sushi", "burrito", "high protein bowls", "breakfast"'),
    limit: z.number().nullish().describe("How many to consider, 3 to 10; defaults to 8"),
  }),
  async execute({ query, limit }) {
    const wanted = Math.min(10, Math.max(3, Math.round(limit ?? 8)));
    const [restaurants, point] = await Promise.all([
      searchRestaurants(query, wanted),
      defaultDeliveryPoint(),
    ]);
    if (restaurants.length === 0) {
      return {
        found: false,
        reason: `No orderable restaurants matched "${query}" near the saved address. Try a broader term.`,
      };
    }
    return { found: true, deliveringTo: point.printable, restaurants };
  },
});
