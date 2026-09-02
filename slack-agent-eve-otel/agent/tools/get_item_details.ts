import { defineTool } from "eve/tools";
import { z } from "zod";
import { ddItemDetails } from "../lib/dd";

export default defineTool({
  description:
    "Fetch full details for one menu item: authoritative price and every customization group (size, toppings, sides) with per-option prices and which groups are required. Call this before add_to_group_cart for any item with hasRequiredModifiers, or when the user asks about options.",
  inputSchema: z.object({
    storeId: z.string().min(1),
    menuId: z.string().min(1).describe("menuId from get_menu"),
    itemId: z.string().min(1).describe("itemId from get_menu"),
  }),
  async execute({ storeId, menuId, itemId }) {
    return await ddItemDetails(storeId, menuId, itemId);
  },
});
