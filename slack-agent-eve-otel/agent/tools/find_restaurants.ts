import { defineTool } from "eve/tools";
import { z } from "zod";
import { ddSearch, defaultDeliveryPoint, storeIsOpen } from "../lib/dd";
import type { Restaurant } from "../lib/dd";

// Long enough for a healthy probe round, short enough that a stalled one
// never holds up a reply in Slack.
const PROBE_BUDGET_MS = 6_000;

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
    // Over-fetch: closed stores are dropped below, so the search needs slack.
    const [candidates, point] = await Promise.all([
      ddSearch(query, Math.min(12, wanted + 4)),
      defaultDeliveryPoint(),
    ]);

    // Search cannot tell open from closed — only the menu endpoint reports
    // store_is_open — so each candidate costs a probe. The probes are capped
    // and time-boxed, and a store is dropped only when it is *known* closed:
    // an unfinished or failed probe leaves the store in, so a slow API costs
    // seconds rather than an empty answer.
    const probed: Restaurant[] = candidates.slice(0, 6);
    const open = await Promise.all(
      probed.map((store) =>
        Promise.race([
          storeIsOpen(store.storeId),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), PROBE_BUDGET_MS)),
        ]),
      ),
    );
    const restaurants = probed.filter((_, index) => open[index] !== false).slice(0, wanted);

    if (restaurants.length === 0) {
      return {
        found: false,
        reason:
          candidates.length === 0
            ? `No restaurants matched "${query}" near the saved address. Try a broader term.`
            : `Everything matching "${query}" near the saved address is closed right now. Try a different craving or a later time.`,
      };
    }
    return { found: true, deliveringTo: point.printable, restaurants };
  },
});
