import * as Sentry from "@sentry/node";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { conversationStash } from "../lib/conversation";
import { mealBudgetUsd, runDd, showCart, stripCatalogPrefix, toCartSummary } from "../lib/dd";

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
    "Add one picked item (with any customization options) to a cart. Pass cartUuid from resolve_group_cart to add to a shared group order; omit it for a personal order and a new cart is created at this store. Enforces the budget against DoorDash's own prices — an over-budget item is refused, not added. Returns the updated cart contents on success, or the required customization groups if DoorDash rejects the item for missing choices.",
  inputSchema: z.object({
    cartUuid: z
      .string()
      .nullish()
      .describe("cartUuid from resolve_group_cart for a group order; omit for a personal order"),
    storeId: z.string().min(1),
    menuId: z.string().min(1).describe("menuId from get_menu"),
    itemId: z.string().min(1).describe("itemId from get_menu"),
    itemName: z.string().min(1),
    quantity: z.number().default(1).describe("Whole number, 1 to 5"),
    caloriesEstimate: z
      .number()
      .nullish()
      .describe("Estimated calories for one of this item, copied exactly from estimate_nutrition; omit if unavailable"),
    proteinGEstimate: z
      .number()
      .nullish()
      .describe("Estimated protein grams for one of this item, copied exactly from estimate_nutrition; omit if unavailable"),
    nestedOptions: z
      .array(optionSchema)
      .optional()
      .describe("Selected customization options, from get_item_details"),
  }),
  async execute({ cartUuid, storeId, menuId, itemId, itemName, quantity: rawQuantity, caloriesEstimate, proteinGEstimate, nestedOptions: rawNestedOptions }) {
    // A group order carries the host's own per-person limit; a personal order
    // has none, so the configured budget applies.
    const budgetUsd = cartUuid
      ? ((await showCart(cartUuid)).spendLimitUsd ?? mealBudgetUsd())
      : mealBudgetUsd();
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
        reason: `"${itemName}" comes to $${itemTotalUsd.toFixed(2)} with the selected options, over the $${budgetUsd.toFixed(2)} budget. Offer cheaper options instead.`,
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
      // Without --cart-uuid dd-cli appends to this store's open cart, or
      // creates one — which is what a personal order wants.
      ...(cartUuid ? ["--cart-uuid", cartUuid] : []),
      "--items-json",
      itemsJson,
    ]);

    const itemErrors = (result.item_errors ?? []) as Record<string, unknown>[];
    if (result.success !== true || itemErrors.length > 0) {
      // required_options entries list the choices DoorDash needs — surface
      // them so the model can ask the person and retry with nestedOptions.
      return { added: false, itemErrors, message: result.message ?? null };
    }

    // The domain event: WHO ate WHAT — item, price, and nutrition per pick.
    // Opinionated split: spans stay the auto-instrumented system record;
    // this log wide event is the business record, with numeric attributes
    // so Explore/dashboards/alerts can sum calories and protein per user.
    const conv = conversationStash();
    Sentry.logger.info("meal.pick.added", {
      "meal.item": itemName,
      "meal.quantity": quantity,
      "meal.price_usd": itemTotalUsd,
      "meal.budget_usd": budgetUsd,
      ...(caloriesEstimate != null
        ? { "meal.calories": Math.round(caloriesEstimate * quantity) }
        : {}),
      ...(proteinGEstimate != null
        ? { "meal.protein_g": Math.round(proteinGEstimate * quantity) }
        : {}),
      ...(conv?.threadTs ? { "conversation.id": conv.threadTs } : {}),
      ...(conv?.userId ? { "user.id": conv.userId } : {}),
    });

    return {
      added: true,
      itemTotalUsd,
      budgetUsd,
      cart: toCartSummary(
        String(result.cart_uuid ?? cartUuid ?? ""),
        (result.cart ?? {}) as Parameters<typeof toCartSummary>[1],
      ),
    };
  },
});
