import { defineTool } from "eve/tools";
import { z } from "zod";
import { runDd, stripCatalogPrefix } from "../lib/dd";

interface RawMenuItem {
  item_id?: string;
  name?: string;
  description?: string | null;
  image_url?: string | null;
  price?: number;
  price_varies?: boolean;
  is_orderable?: boolean;
  has_required_modifiers?: boolean;
  category_name?: string | null;
}

export default defineTool({
  description:
    "Fetch a restaurant's menu by store id. Returns the menu id (needed for item details and cart adds) and orderable items with prices in USD, photo URLs, and whether an item requires customization choices before it can be added.",
  inputSchema: z.object({
    storeId: z.string().min(1).describe("Numeric store id from resolve_group_cart"),
  }),
  async execute({ storeId }) {
    const menu = await runDd(["menu", "--store-id", storeId]);
    const rawItems = (menu.items ?? []) as RawMenuItem[];
    // is_popular / popularity_rank are deliberately not surfaced: the CLI docs
    // ask agents not to base any decision on them.
    const items = rawItems
      .filter((item) => item.is_orderable !== false && item.item_id)
      .map((item) => ({
        itemId: stripCatalogPrefix(item.item_id!),
        name: item.name ?? "",
        description: item.description ?? null,
        priceUsd: item.price ?? null,
        priceVaries: item.price_varies ?? false,
        imageUrl: item.image_url ?? null,
        categoryName: item.category_name ?? null,
        hasRequiredModifiers: item.has_required_modifiers ?? false,
      }));
    return {
      menuId: String(menu.menu_id ?? ""),
      storeName: menu.store_name ?? null,
      storeIsOpen: menu.store_is_open ?? null,
      items,
    };
  },
});
