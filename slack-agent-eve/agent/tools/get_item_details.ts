import { defineTool } from "eve/tools";
import { z } from "zod";
import { runDd, stripCatalogPrefix } from "../lib/dd";

interface RawOption {
  option_id?: string;
  name?: string;
  price?: number;
  extras?: RawExtra[];
}

interface RawExtra {
  extra_id?: string;
  title?: string;
  min_num_options?: number;
  max_num_options?: number;
  num_free_options?: number;
  options?: RawOption[];
}

export interface ItemExtra {
  title: string;
  required: boolean;
  minNumOptions: number;
  maxNumOptions: number;
  numFreeOptions: number;
  options: {
    optionId: string;
    name: string;
    priceUsd: number;
    extras: ItemExtra[];
  }[];
}

function mapExtras(extras: RawExtra[] | undefined): ItemExtra[] {
  return (extras ?? []).map((extra) => ({
    title: extra.title ?? "",
    required: (extra.min_num_options ?? 0) > 0,
    minNumOptions: extra.min_num_options ?? 0,
    maxNumOptions: extra.max_num_options ?? 0,
    numFreeOptions: extra.num_free_options ?? 0,
    options: (extra.options ?? [])
      .filter((option) => option.option_id)
      .map((option) => ({
        optionId: stripCatalogPrefix(option.option_id!),
        name: option.name ?? "",
        priceUsd: option.price ?? 0,
        extras: mapExtras(option.extras),
      })),
  }));
}

export default defineTool({
  description:
    "Fetch full details for one menu item: authoritative price and every customization group (size, toppings, sides) with per-option prices and which groups are required. Call this before add_to_group_cart for any item with hasRequiredModifiers, or when the user asks about options.",
  inputSchema: z.object({
    storeId: z.string().min(1),
    menuId: z.string().min(1).describe("menuId from get_menu"),
    itemId: z.string().min(1).describe("itemId from get_menu"),
  }),
  async execute({ storeId, menuId, itemId }) {
    const details = await runDd([
      "restaurant-item-details",
      "--store-id",
      storeId,
      "--menu-id",
      menuId,
      "--item-id",
      stripCatalogPrefix(itemId),
    ]);
    const item = (details.item ?? {}) as {
      item_id?: string;
      name?: string;
      description?: string | null;
      image_url?: string | null;
      price?: number;
      price_varies?: boolean;
      extras?: RawExtra[];
    };
    return {
      itemId: stripCatalogPrefix(item.item_id ?? itemId),
      name: item.name ?? "",
      description: item.description ?? null,
      imageUrl: item.image_url ?? null,
      basePriceUsd: item.price ?? null,
      priceVaries: item.price_varies ?? false,
      extras: mapExtras(item.extras),
    };
  },
});
