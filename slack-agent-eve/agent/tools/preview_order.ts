import { defineTool } from "eve/tools";
import { z } from "zod";
import { ddOrderPreview } from "../lib/dd";

export default defineTool({
  description:
    "Price a personal cart before checkout: subtotal, delivery, fees and tax, and the total, with no charge. Read-only. Run this once the person's items are in their own cart, then hand them the checkout link — never place the order.",
  inputSchema: z.object({
    cartUuid: z.string().min(1).describe("cartUuid from add_to_cart"),
  }),
  async execute({ cartUuid }) {
    const quote = await ddOrderPreview(cartUuid);
    if (quote.lines.length === 0) {
      return {
        previewed: false,
        reason: quote.errorMessage ?? "dd-cli returned no pricing for this cart.",
      };
    }

    // dd-cli quotes each charge separately and never emits a total line, so
    // sum the minor units. Currency follows the store, not the account.
    const currency = quote.lines.find((line) => line.currency)?.currency ?? "";
    const totalMinorUnits = quote.lines.reduce((sum, line) => sum + line.amountMinorUnits, 0);

    return {
      previewed: true,
      cartUuid,
      currency,
      lines: quote.lines.map((line) => ({ label: line.label, amount: line.amountDisplay })),
      total: totalMinorUnits / 100,
      totalDisplay: `${currency} ${(totalMinorUnits / 100).toFixed(2)}`.trim(),
      note: "Pricing only — nothing is charged. Give the person the checkout link so they submit it themselves.",
    };
  },
});
