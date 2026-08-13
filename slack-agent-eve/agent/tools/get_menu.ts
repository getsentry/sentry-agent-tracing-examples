import { defineTool } from "eve/tools";
import { z } from "zod";
import { ddMenu } from "../lib/dd";

export default defineTool({
  description:
    "Fetch a restaurant's menu by store id. Returns the menu id (needed for item details and cart adds) and orderable items with prices in USD, photo URLs, and whether an item requires customization choices before it can be added.",
  inputSchema: z.object({
    storeId: z.string().min(1).describe("Numeric store id from resolve_group_cart"),
  }),
  async execute({ storeId }) {
    return await ddMenu(storeId);
  },
});
