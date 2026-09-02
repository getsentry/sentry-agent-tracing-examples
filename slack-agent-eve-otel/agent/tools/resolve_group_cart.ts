import { defineTool } from "eve/tools";
import { z } from "zod";
import { cartLinkToken, ddCartList, mealBudgetUsd, showCart, type CartSummary } from "../lib/dd";

export default defineTool({
  description:
    "Resolve a DoorDash group-order link (drd.sh/cart/… or doordash.com/dd/cart/…) to the group cart it points at: cart UUID, store, current items, and the per-person lunch budget. Call this first when a group-order link is posted. Omit the link to list all open group carts on the account.",
  inputSchema: z.object({
    groupOrderLink: z
      .string()
      .optional()
      .describe("The group-order share link as posted in Slack"),
  }),
  async execute({ groupOrderLink }) {
    const fallbackBudgetUsd = mealBudgetUsd();
    const cartUuids = await ddCartList();

    // The share link is an opaque short token, not the cart UUID, so the only
    // resolution path is comparing it against each open cart's group_cart_url
    // (cart list omits that field; cart show carries it).
    const groupCarts: CartSummary[] = [];
    for (const cartUuid of cartUuids) {
      const summary = await showCart(cartUuid);
      if (summary.isGroupCart) groupCarts.push(summary);
    }

    const token = groupOrderLink ? cartLinkToken(groupOrderLink) : undefined;
    const matched = token
      ? groupCarts.find((cart) => cart.groupCartUrl?.includes(`/cart/${token}`))
      : groupCarts.length === 1
        ? groupCarts[0]
        : undefined;

    if (!matched) {
      return {
        found: false,
        budgetUsd: fallbackBudgetUsd,
        openGroupCarts: groupCarts.map(({ cartUuid, storeName, itemsCount, groupCartUrl }) => ({
          cartUuid,
          storeName,
          itemsCount,
          groupCartUrl,
        })),
        note:
          "No open group cart on the signed-in DoorDash account matches this link. Group-cart links can't be decoded directly — the signed-in account must be the group-order host, or must first join the group order in the DoorDash app. Until then, only recommendations are possible; a human has to add items via the link.",
      };
    }

    // The group order's own spend limit (set by the host in DoorDash) is the
    // real budget; MEAL_BUDGET_USD only covers carts created without one.
    return {
      found: true,
      budgetUsd: matched.spendLimitUsd ?? fallbackBudgetUsd,
      budgetSource:
        matched.spendLimitUsd != null ? "group-order spend limit" : "MEAL_BUDGET_USD fallback",
      cart: matched,
    };
  },
});
