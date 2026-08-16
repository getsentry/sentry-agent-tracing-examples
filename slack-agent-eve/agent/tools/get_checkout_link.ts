import * as Sentry from "@sentry/node";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { activeConversation } from "../lib/conversation";
import { ddCheckoutUrl } from "../lib/dd";

// Alias, not interface: only aliases get the implicit index signature that
// Sentry.logger's Record<string, unknown> attribute bag requires.
type CheckoutOfferedLog = {
  "meal.store": string;
  "meal.total"?: number;
  "meal.currency"?: string;
  "gen_ai.conversation.id"?: string;
  "user.id"?: string;
};

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
    const url = await ddCheckoutUrl(cartUuid);
    if (!url) {
      return {
        ready: false,
        reason: "dd-cli returned no checkout URL for this cart.",
      };
    }

    const conv = activeConversation();
    const attributes: CheckoutOfferedLog = { "meal.store": storeName };
    if (total != null) attributes["meal.total"] = total;
    if (currency) attributes["meal.currency"] = currency;
    if (conv?.conversationId) attributes["gen_ai.conversation.id"] = conv.conversationId;
    if (conv?.userId) attributes["user.id"] = conv.userId;
    Sentry.logger.info("meal.checkout.offered", attributes);

    return { ready: true, checkoutUrl: url };
  },
});
