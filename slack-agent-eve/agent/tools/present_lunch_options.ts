import { callSlackApi } from "eve/channels/slack";
import { defineTool } from "eve/tools";
import { z } from "zod";

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

// Slack never unfurls links in eve-posted messages (the channel hardcodes
// unfurl_links/unfurl_media off), so photos only render as Block Kit images.
// Raw blocks rather than eve's cardToBlocks: an image inside a section
// `accessory` renders as a compact square thumbnail — consistent crop, short
// message — while eve's card path only emits full-width image blocks.
export default defineTool({
  description:
    "Post the lunch options into the Slack thread as a rich card with photo thumbnails, prices, and nutrition. Always use this instead of listing the options in reply text when the request came from Slack. Copy channelId and threadTs from the <slack_message> envelope of the triggering message.",
  inputSchema: z.object({
    channelId: z.string().min(1).describe("channel_id from the <slack_message> envelope"),
    threadTs: z.string().min(1).describe("thread_ts from the <slack_message> envelope"),
    storeName: z.string().min(1),
    budgetUsd: z.number().describe("budgetUsd from resolve_group_cart"),
    options: z.array(optionSchema).min(2).max(4),
  }),
  async execute({ channelId, threadTs, storeName, budgetUsd, options }) {
    const blocks: SlackBlock[] = [
      {
        type: "header",
        text: { type: "plain_text", text: `Lunch options — ${storeName}`.slice(0, 150) },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `Budget $${budgetUsd.toFixed(2)}/person · reply in this thread with your pick`,
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
        text: `Lunch options — ${storeName}: ${fallback}`,
      },
    });
    if (!response.ok) {
      throw new Error(`chat.postMessage failed: ${response.error ?? "unknown_error"}`);
    }
    return { posted: true, messageTs: (response.ts as string | undefined) ?? null };
  },
});
