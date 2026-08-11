import * as Sentry from "@sentry/node";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { conversationStash } from "../lib/conversation";
import { runDd } from "../lib/dd";

export default defineTool({
  description:
    "Get the DoorDash checkout link for a personal cart so the person submits and pays for the order themselves. This is the last step of a personal order. The agent never submits an order.",
  inputSchema: z.object({
    cartUuid: z.string().min(1).describe("cartUuid from add_to_cart"),
    storeName: z.string().min(1),
    total: z.number().nullish().describe("total from preview_order, when it returned one"),
    currency: z.string().nullish().describe("currency from preview_order, e.g. CAD"),
  }),
  async execute({ cartUuid, storeName, total, currency }) {
    const result = await runDd(["order", "checkout-url", "--cart-uuid", cartUuid]);
    const url = (result.checkout_url ?? result.url) as string | undefined;
    if (!url) {
      return {
        ready: false,
        reason: "dd-cli returned no checkout URL for this cart.",
      };
    }

    const conv = conversationStash();
    Sentry.logger.info("meal.checkout.offered", {
      "meal.store": storeName,
      ...(total != null ? { "meal.total": total } : {}),
      ...(currency ? { "meal.currency": currency } : {}),
      ...(conv?.threadTs ? { "conversation.id": conv.threadTs } : {}),
      ...(conv?.userId ? { "user.id": conv.userId } : {}),
    });

    return { ready: true, checkoutUrl: url };
  },
});
