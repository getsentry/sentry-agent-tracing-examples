import * as Sentry from "@sentry/node";
import { callSlackApi } from "eve/channels/slack";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { conversationStash } from "../lib/conversation";

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

type SlackBlock = Record<string, unknown>;

// One card per triggering Slack message. Eve's workflow queue is
// at-least-once: a transport failure mid-turn redelivers and re-runs any
// step that had not checkpointed, and the re-generated tool call posts a
// second (different!) card — observed live 2026-08-08 ("TypeError: fetch
// failed" at the queue loop). The trigger message_ts is stable across
// redeliveries, so it makes a natural idempotency key; a genuine
// "show me other options" arrives on a new message_ts and still posts.
const postedCards = new Map<string, string>();

// Slack never unfurls links in eve-posted messages (the channel hardcodes
// unfurl_links/unfurl_media off), so photos only render as Block Kit images.
// Raw blocks rather than eve's cardToBlocks: an image inside a section
// `accessory` renders as a compact square thumbnail — consistent crop, short
// message — while eve's card path only emits full-width image blocks.
export default defineTool({
  description:
    "Post the meal options into the Slack thread as a rich card with photo thumbnails, prices, and nutrition. Always use this instead of listing the options in reply text when the request came from Slack. Copy channelId and threadTs from the <slack_message> envelope of the triggering message.",
  inputSchema: z.object({
    channelId: z.string().min(1).describe("channel_id from the <slack_message> envelope"),
    threadTs: z.string().min(1).describe("thread_ts from the <slack_message> envelope"),
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
  async execute({
    channelId,
    threadTs,
    triggerMessageTs,
    storeName,
    mealLabel: rawMealLabel,
    budgetUsd,
    options,
  }) {
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

    const dedupeKey = `${channelId}:${triggerMessageTs}`;
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
      ...options.map((option, index) => {
        const stats = [
          `$${option.priceUsd.toFixed(2)}`,
          option.calories != null ? `~${Math.round(option.calories)} cal` : undefined,
          option.proteinG != null ? `${Math.round(option.proteinG)}g protein` : undefined,
        ]
          .filter(Boolean)
          .join(" · ");
        const section: SlackBlock = {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*${index + 1}. ${option.lane} — ${option.title}*\n${stats}\n${option.blurb}`.slice(0, 3000),
          },
        };
        if (option.imageUrl && option.imageUrl.length <= 3000) {
          section.accessory = {
            type: "image",
            image_url: option.imageUrl,
            alt_text: option.title.slice(0, 2000),
          };
        }
        return section;
      }),
      {
        type: "actions",
        elements: options.map((option, index) => ({
          type: "button",
          // The eve_input: action_id prefix is reserved for eve's HITL
          // pipeline; anything else is forwarded to our onInteraction hook.
          action_id: `pick_option_${index + 1}`,
          value: `${option.title} ($${option.priceUsd.toFixed(2)})`.slice(0, 2000),
          text: { type: "plain_text", text: `Pick ${index + 1}` },
        })),
      },
    ];

    const fallback = options
      .map((o, i) => `${i + 1}. ${o.lane}: ${o.title} — $${o.priceUsd.toFixed(2)}`)
      .join(" · ");

    const response = await callSlackApi({
      botToken: undefined, // resolves process.env.SLACK_BOT_TOKEN, same as the channel
      operation: "chat.postMessage",
      body: {
        channel: channelId,
        thread_ts: threadTs,
        blocks,
        text: `${mealLabel} — ${storeName}: ${fallback}`,
      },
    });
    if (!response.ok) {
      throw new Error(`chat.postMessage failed: ${response.error ?? "unknown_error"}`);
    }
    const messageTs = (response.ts as string | undefined) ?? null;
    postedCards.set(dedupeKey, messageTs ?? "posted");

    // One domain event per offered option — lets dashboards compare what
    // was offered against what got picked (meal.pick.added), by lane,
    // price, and nutrition.
    const conv = conversationStash();
    for (const [index, option] of options.entries()) {
      Sentry.logger.info("meal.option.presented", {
        "meal.store": storeName,
        "meal.option_index": index + 1,
        "meal.lane": option.lane,
        "meal.item": option.title,
        "meal.price_usd": option.priceUsd,
        "meal.budget_usd": budgetUsd,
        ...(option.calories != null ? { "meal.calories": Math.round(option.calories) } : {}),
        ...(option.proteinG != null ? { "meal.protein_g": Math.round(option.proteinG) } : {}),
        "conversation.id": threadTs,
        ...(conv?.userId ? { "user.id": conv.userId } : {}),
      });
    }

    return { posted: true, messageTs };
  },
});
