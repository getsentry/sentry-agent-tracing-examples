import * as Sentry from "@sentry/node";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { activeConversation } from "../lib/conversation";
import {
  ddCartAddItems,
  ddItemDetails,
  mealBudgetUsd,
  showCart,
  stripCatalogPrefix,
  type ItemExtra,
} from "../lib/dd";

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

/** One customization choice after quantity clamping, at any nesting depth. */
interface SelectedOption {
  id: string;
  name: string;
  quantity: number;
  options?: SelectedOption[];
}

/** dd-cli's --items-json body, in its own snake_case wire shape. */
interface CartAddOption {
  id: string;
  name: string;
  quantity: number;
  options?: CartAddOption[];
}

interface CartAddItem {
  item_id: string;
  item_name: string;
  quantity: number;
  nested_options?: CartAddOption[];
}

// Alias, not interface: only aliases get the implicit index signature that
// Sentry.logger's Record<string, unknown> attribute bag requires.
type MealPickLog = {
  "meal.item": string;
  "meal.quantity": number;
  "meal.price_usd": number;
  "meal.budget_usd": number;
  "meal.calories"?: number;
  "meal.protein_g"?: number;
  "gen_ai.conversation.id"?: string;
  "user.id"?: string;
};

function normalizeQuantity(value: number, max = Number.MAX_SAFE_INTEGER) {
  return Math.min(max, Math.max(1, Math.round(value)));
}

function collectOptionPrices(extras: ItemExtra[], prices: Map<string, number>) {
  for (const extra of extras) {
    for (const option of extra.options) {
      prices.set(option.optionId, option.priceUsd);
      collectOptionPrices(option.extras, prices);
    }
  }
}

function toCartAddOption(option: SelectedOption): CartAddOption {
  const payload: CartAddOption = {
    id: stripCatalogPrefix(option.id),
    name: option.name,
    quantity: option.quantity,
  };
  if (option.options?.length) payload.options = option.options.map(toCartAddOption);
  return payload;
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
    const nestedOptions: SelectedOption[] = (rawNestedOptions ?? []).map((option) => ({
      id: option.id,
      name: option.name,
      quantity: normalizeQuantity(option.quantity),
      options: option.options?.map((sub) => ({
        id: sub.id,
        name: sub.name,
        quantity: normalizeQuantity(sub.quantity),
      })),
    }));

    // Budget guard, enforced in code: price the pick from DoorDash's own item
    // details rather than trusting model-supplied numbers.
    const details = await ddItemDetails(storeId, menuId, bareItemId);
    const optionPrices = new Map<string, number>();
    collectOptionPrices(details.extras, optionPrices);

    let unitPriceUsd = details.basePriceUsd ?? 0;
    const selections = nestedOptions.flatMap((option) => [option, ...(option.options ?? [])]);
    for (const selection of selections) {
      const price = optionPrices.get(stripCatalogPrefix(selection.id));
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

    const body: CartAddItem = { item_id: bareItemId, item_name: itemName, quantity };
    if (nestedOptions.length > 0) body.nested_options = nestedOptions.map(toCartAddOption);

    const outcome = await ddCartAddItems(
      storeId,
      menuId,
      cartUuid ?? undefined,
      JSON.stringify([body]),
    );
    if (!outcome.added) {
      // required_options entries list the choices DoorDash needs — surface
      // them so the model can ask the person and retry with nestedOptions.
      return { added: false, itemErrors: outcome.itemErrors, message: outcome.message };
    }

    // The domain event: WHO ate WHAT — item, price, and nutrition per pick.
    // Opinionated split: spans stay the auto-instrumented system record;
    // this log wide event is the business record, with numeric attributes
    // so Explore/dashboards/alerts can sum calories and protein per user.
    const conv = activeConversation();
    const attributes: MealPickLog = {
      "meal.item": itemName,
      "meal.quantity": quantity,
      "meal.price_usd": itemTotalUsd,
      "meal.budget_usd": budgetUsd,
    };
    if (caloriesEstimate != null) {
      attributes["meal.calories"] = Math.round(caloriesEstimate * quantity);
    }
    if (proteinGEstimate != null) {
      attributes["meal.protein_g"] = Math.round(proteinGEstimate * quantity);
    }
    if (conv?.threadTs) attributes["gen_ai.conversation.id"] = conv.threadTs;
    if (conv?.userId) attributes["user.id"] = conv.userId;
    Sentry.logger.info("meal.pick.added", attributes);

    return { added: true, itemTotalUsd, budgetUsd, cart: outcome.cart };
  },
});
