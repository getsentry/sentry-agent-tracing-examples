import { defineTool } from "eve/tools";
import { z } from "zod";
import { lunchBudgetUsd, runDd, stripCatalogPrefix, toCartSummary } from "../lib/dd";

// Quantities avoid .int()/.min()/.max(): Zod 4 renders them as JSON-Schema
// integer bounds, which Azure-hosted models behind OpenRouter reject.
// normalizeQuantity clamps in code instead.
const subOptionSchema = z.object({
  id: z.string().min(1).describe("optionId from get_item_details"),
  name: z.string().min(1),
  quantity: z.number().describe("Whole number, at least 1"),
});

const optionSchema = z.object({
  id: z.string().min(1).describe("optionId from get_item_details"),
  name: z.string().min(1),
  quantity: z.number().describe("Whole number, at least 1"),
  options: z
    .array(subOptionSchema)
    .optional()
    .describe("Sub-choices when this option has its own required selections (combo meals)"),
});

interface RawOption {
  option_id?: string;
  price?: number;
  extras?: RawExtra[];
}

interface RawExtra {
  options?: RawOption[];
}

function normalizeQuantity(value: number, max = Number.MAX_SAFE_INTEGER) {
  return Math.min(max, Math.max(1, Math.round(value)));
}

function collectOptionPrices(extras: RawExtra[] | undefined, prices: Map<string, number>) {
  for (const extra of extras ?? []) {
    for (const option of extra.options ?? []) {
      if (option.option_id) {
        prices.set(stripCatalogPrefix(option.option_id), option.price ?? 0);
      }
      collectOptionPrices(option.extras, prices);
    }
  }
}

export default defineTool({
  description:
    "Add one picked item (with any customization options) to the resolved group cart. Enforces the per-person lunch budget against DoorDash's own prices — an over-budget item is refused, not added. Returns the updated cart contents on success, or the required customization groups if DoorDash rejects the item for missing choices.",
  inputSchema: z.object({
    cartUuid: z.string().min(1).describe("cartUuid from resolve_group_cart"),
    storeId: z.string().min(1),
    menuId: z.string().min(1).describe("menuId from get_menu"),
    itemId: z.string().min(1).describe("itemId from get_menu"),
    itemName: z.string().min(1),
    quantity: z.number().default(1).describe("Whole number, 1 to 5"),
    nestedOptions: z
      .array(optionSchema)
      .optional()
      .describe("Selected customization options, from get_item_details"),
  }),
  async execute({ cartUuid, storeId, menuId, itemId, itemName, quantity: rawQuantity, nestedOptions: rawNestedOptions }) {
    const budgetUsd = lunchBudgetUsd();
    const bareItemId = stripCatalogPrefix(itemId);
    const quantity = normalizeQuantity(rawQuantity, 5);
    const nestedOptions = rawNestedOptions?.map((option) => ({
      ...option,
      quantity: normalizeQuantity(option.quantity),
      options: option.options?.map((sub) => ({ ...sub, quantity: normalizeQuantity(sub.quantity) })),
    }));

    // Budget guard, enforced in code: price the pick from DoorDash's own item
    // details rather than trusting model-supplied numbers.
    const details = await runDd([
      "restaurant-item-details",
      "--store-id",
      storeId,
      "--menu-id",
      menuId,
      "--item-id",
      bareItemId,
    ]);
    const item = (details.item ?? {}) as { price?: number; extras?: RawExtra[] };
    const optionPrices = new Map<string, number>();
    collectOptionPrices(item.extras, optionPrices);

    let unitPriceUsd = item.price ?? 0;
    const selections = (nestedOptions ?? []).flatMap((option) => [
      option,
      ...(option.options ?? []),
    ]);
    for (const selection of selections) {
      const bareId = stripCatalogPrefix(selection.id);
      const price = optionPrices.get(bareId);
      if (price === undefined) {
        return {
          added: false,
          reason: `Option id ${selection.id} ("${selection.name}") is not on this item — re-check get_item_details and use its optionId values.`,
        };
      }
      unitPriceUsd += price * selection.quantity;
    }

    const itemTotalUsd = Math.round(unitPriceUsd * quantity * 100) / 100;
    if (itemTotalUsd > budgetUsd) {
      return {
        added: false,
        overBudget: true,
        itemTotalUsd,
        budgetUsd,
        reason: `"${itemName}" comes to $${itemTotalUsd.toFixed(2)} with the selected options, over the $${budgetUsd.toFixed(2)} per-person budget. Offer cheaper options instead.`,
      };
    }

    const itemsJson = JSON.stringify([
      {
        item_id: bareItemId,
        item_name: itemName,
        quantity,
        ...(nestedOptions?.length
          ? {
              nested_options: nestedOptions.map((option) => ({
                id: stripCatalogPrefix(option.id),
                name: option.name,
                quantity: option.quantity,
                ...(option.options?.length
                  ? {
                      options: option.options.map((sub) => ({
                        id: stripCatalogPrefix(sub.id),
                        name: sub.name,
                        quantity: sub.quantity,
                      })),
                    }
                  : {}),
              })),
            }
          : {}),
      },
    ]);

    const result = await runDd([
      "cart",
      "add-items",
      "--store-id",
      storeId,
      "--menu-id",
      menuId,
      "--cart-uuid",
      cartUuid,
      "--items-json",
      itemsJson,
    ]);

    const itemErrors = (result.item_errors ?? []) as Record<string, unknown>[];
    if (result.success !== true || itemErrors.length > 0) {
      // required_options entries list the choices DoorDash needs — surface
      // them so the model can ask the person and retry with nestedOptions.
      return { added: false, itemErrors, message: result.message ?? null };
    }

    return {
      added: true,
      itemTotalUsd,
      budgetUsd,
      cart: toCartSummary(
        String(result.cart_uuid ?? cartUuid),
        (result.cart ?? {}) as Parameters<typeof toCartSummary>[1],
      ),
    };
  },
});
