import { defineTool } from "eve/tools";
import { z } from "zod";
import { runDd } from "../lib/dd";

interface Money {
  unit_amount?: number;
  currency?: string;
  display_string?: string;
}

interface LineItem {
  charge_id?: string;
  label?: string;
  final_money?: Money;
}

export default defineTool({
  description:
    "Price a personal cart before checkout: subtotal, delivery, fees and tax, and the total, with no charge. Read-only. Run this once the person's items are in their own cart, then hand them the checkout link — never place the order.",
  inputSchema: z.object({
    cartUuid: z.string().min(1).describe("cartUuid from add_to_cart"),
  }),
  async execute({ cartUuid }) {
    const result = await runDd(["order", "preview", "--cart-uuid", cartUuid]);
    const quote = (result.quote ?? {}) as { line_items?: LineItem[] };
    const lineItems = quote.line_items ?? [];
    if (lineItems.length === 0) {
      return {
        previewed: false,
        reason: (result.error_message as string | undefined) ?? "dd-cli returned no pricing for this cart.",
      };
    }

    // dd-cli quotes each charge separately and never emits a total line, so
    // sum the minor units. Currency follows the store, not the account.
    const currency = lineItems.find((li) => li.final_money?.currency)?.final_money?.currency ?? "";
    const totalMinorUnits = lineItems.reduce(
      (sum, li) => sum + (li.final_money?.unit_amount ?? 0),
      0,
    );

    return {
      previewed: true,
      cartUuid,
      currency,
      lines: lineItems.map((li) => ({
        label: li.label ?? li.charge_id ?? "",
        amount: li.final_money?.display_string ?? "",
      })),
      total: totalMinorUnits / 100,
      totalDisplay: `${currency} ${(totalMinorUnits / 100).toFixed(2)}`.trim(),
      note: "Pricing only — nothing is charged. Give the person the checkout link so they submit it themselves.",
    };
  },
});
