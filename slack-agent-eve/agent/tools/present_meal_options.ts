import * as Sentry from "@sentry/node";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { activeConversation, activeSlackThread } from "../lib/conversation";
import {
  imageAccessory,
  postCard,
  type SlackBlock,
  type SlackButtonElement,
} from "../lib/slack-blocks";

const optionSchema = z.object({
  lane: z.string().min(1).describe('Short lane label, e.g. "Protein-heavy", "Balanced", "Junk"'),
  title: z
    .string()
    .min(1)
    .describe('The pick, as menu item names — a combo joins them with " + " (e.g. "Burrito Asada + Birria broth")'),
  priceUsd: z.number().describe("Total price of everything in this option, from get_menu / get_item_details"),
  blurb: z.string().min(1).describe("One-sentence sell for this pick"),
  calories: z.number().nullish().describe("Combined, from estimate_nutrition; omit when unavailable"),
  proteinG: z.number().nullish().describe("Combined, from estimate_nutrition; omit when unavailable"),
  imageUrl: z.string().nullish().describe("imageUrl of the main item from get_menu; omit when it has none"),
});

// One card per triggering Slack message. Eve's workflow queue is
// at-least-once: a transport failure mid-turn redelivers and re-runs any step
// that had not checkpointed, and the re-generated tool call posts a second
// (and different) card. The trigger message_ts is stable across redeliveries,
// so it makes a natural idempotency key; a genuine "show me other options"
// arrives on a new message_ts and still posts.
const postedCards = new Map<string, string>();

// Alias, not interface: only aliases get the implicit index signature that
// Sentry.logger's Record<string, unknown> attribute bag requires.
type MealOptionLog = {
  "meal.store": string;
  "meal.option_index": number;
  "meal.lane": string;
  "meal.item": string;
  "meal.price_usd": number;
  "meal.budget_usd": number;
  "meal.calories"?: number;
  "meal.protein_g"?: number;
  "gen_ai.conversation.id"?: string;
  "user.id"?: string;
};

export default defineTool({
  description:
    "Post the meal options into the Slack thread as a rich card with photo thumbnails, prices, and nutrition. Always use this instead of listing the options in reply text when the request came from Slack. The card goes to the thread that triggered this turn; there is no way to send it anywhere else.",
  inputSchema: z.object({
    triggerMessageTs: z
      .string()
      .min(1)
      .describe("message_ts from the <slack_message> envelope of the message that triggered this request"),
    storeName: z.string().min(1),
    mealLabel: z
      .string()
      .nullish()
      .describe('Card heading for the meal, e.g. "Breakfast options", "Lunch options"; defaults to "Options"'),
    budgetUsd: z.number().describe("budgetUsd from resolve_group_cart, or the person's own budget"),
    options: z.array(optionSchema).min(2).max(4),
  }),
  async execute({ triggerMessageTs, storeName, mealLabel: rawMealLabel, budgetUsd, options }) {
    const thread = activeSlackThread();
    if (thread === undefined) {
      return {
        posted: false,
        note: "This turn did not come from a Slack thread, so there is nowhere to post a card. List the options in your reply text instead.",
      };
    }

    const mealLabel = rawMealLabel?.trim() || "Options";
    const overBudget = options.filter((option) => option.priceUsd > budgetUsd);
    if (overBudget.length > 0) {
      throw new Error(
        `Over budget, nothing posted: ${overBudget
          .map((o) => `"${o.title}" at $${o.priceUsd.toFixed(2)}`)
          .join(", ")} exceed${overBudget.length === 1 ? "s" : ""} the $${budgetUsd.toFixed(
          2,
        )} budget. Rebuild those options to total at or under the budget, then call this tool again.`,
      );
    }

    const dedupeKey = `${thread.channelId}:${triggerMessageTs}`;
    const alreadyPostedTs = postedCards.get(dedupeKey);
    if (alreadyPostedTs) {
      return {
        posted: false,
        messageTs: alreadyPostedTs,
        note: "A card for this request is already in the thread — do not post another; just reply asking for their pick.",
      };
    }

    const blocks: SlackBlock[] = [
      {
        type: "header",
        text: { type: "plain_text", text: `${mealLabel} — ${storeName}`.slice(0, 150) },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `Budget $${budgetUsd.toFixed(2)} · reply in this thread with your pick`,
          },
        ],
      },
      ...options.map((option, index): SlackBlock => {
        const stats = [
          `$${option.priceUsd.toFixed(2)}`,
          option.calories != null ? `~${Math.round(option.calories)} cal` : undefined,
          option.proteinG != null ? `${Math.round(option.proteinG)}g protein` : undefined,
        ]
          .filter(Boolean)
          .join(" · ");
        return {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${index + 1}. ${option.lane} — ${option.title}*\n${stats}\n${option.blurb}`.slice(0, 3000),
          },
          accessory: imageAccessory(option.imageUrl, option.title),
        };
      }),
      {
        type: "actions",
        elements: options.map((option, index): SlackButtonElement => ({
          type: "button",
          action_id: `pick_option_${index + 1}`,
          value: `${option.title} ($${option.priceUsd.toFixed(2)})`.slice(0, 2000),
          text: { type: "plain_text", text: `Pick ${index + 1}` },
        })),
      },
    ];

    const fallback = options
      .map((o, i) => `${i + 1}. ${o.lane}: ${o.title} — $${o.priceUsd.toFixed(2)}`)
      .join(" · ");

    const posted = await postCard(thread, blocks, `${mealLabel} — ${storeName}: ${fallback}`);
    postedCards.set(dedupeKey, posted.ts ?? "posted");

    // One domain event per offered option — lets dashboards compare what
    // was offered against what got picked (meal.pick.added), by lane,
    // price, and nutrition. The conversation id comes from the turn's own
    // trace, so it always matches the spans.
    const conv = activeConversation();
    for (const [index, option] of options.entries()) {
      const attributes: MealOptionLog = {
        "meal.store": storeName,
        "meal.option_index": index + 1,
        "meal.lane": option.lane,
        "meal.item": option.title,
        "meal.price_usd": option.priceUsd,
        "meal.budget_usd": budgetUsd,
      };
      if (option.calories != null) attributes["meal.calories"] = Math.round(option.calories);
      if (option.proteinG != null) attributes["meal.protein_g"] = Math.round(option.proteinG);
      if (conv?.threadTs) attributes["gen_ai.conversation.id"] = conv.threadTs;
      if (conv?.userId) attributes["user.id"] = conv.userId;
      Sentry.logger.info("meal.option.presented", attributes);
    }

    return { posted: true, messageTs: posted.ts };
  },
});
