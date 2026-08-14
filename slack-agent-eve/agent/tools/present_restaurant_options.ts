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

const choiceSchema = z.object({
  storeId: z.string().min(1).describe("storeId from find_restaurants, copied exactly"),
  name: z.string().min(1),
  blurb: z.string().min(1).describe("One-sentence reason this fits what they asked for"),
  detail: z
    .string()
    .nullish()
    .describe('Distance, delivery time, rating — e.g. "0.2 mi · 20 min · 4.4★"'),
  imageUrl: z.string().nullish().describe("imageUrl from find_restaurants; omit when it has none"),
});

const postedCards = new Map<string, string>();

// Alias, not interface: only aliases get the implicit index signature that
// Sentry.logger's Record<string, unknown> attribute bag requires.
type RestaurantOptionLog = {
  "meal.craving": string;
  "meal.option_index": number;
  "meal.store": string;
  "meal.store_id": string;
  "gen_ai.conversation.id"?: string;
  "user.id"?: string;
};

export default defineTool({
  description:
    "Post three restaurant choices into the Slack thread as a card with photo thumbnails and Pick buttons. Use this as the first step of a personal order, before any menu lookup. The card goes to the thread that triggered this turn; there is no way to send it anywhere else.",
  inputSchema: z.object({
    triggerMessageTs: z
      .string()
      .min(1)
      .describe("message_ts from the <slack_message> envelope of the message that triggered this"),
    craving: z.string().min(1).describe('What they asked for, echoed back — e.g. "sushi"'),
    choices: z.array(choiceSchema).min(2).max(4),
  }),
  async execute({ triggerMessageTs, craving, choices }) {
    const thread = activeSlackThread();
    if (thread === undefined) {
      return {
        posted: false,
        note: "This turn did not come from a Slack thread, so there is nowhere to post a card. List the choices in your reply text instead.",
      };
    }

    const dedupeKey = `${thread.channelId}:${triggerMessageTs}`;
    const alreadyPostedTs = postedCards.get(dedupeKey);
    if (alreadyPostedTs) {
      return {
        posted: false,
        messageTs: alreadyPostedTs,
        note: "A restaurant card for this request is already in the thread — ask for their pick instead of posting another.",
      };
    }

    const blocks: SlackBlock[] = [
      {
        type: "header",
        text: { type: "plain_text", text: `Where to order — ${craving}`.slice(0, 150) },
      },
      {
        type: "context",
        elements: [{ type: "mrkdwn", text: "Pick a spot and I'll build three options from its menu" }],
      },
      ...choices.map((choice, index): SlackBlock => ({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*${index + 1}. ${choice.name}*\n${choice.detail ?? ""}\n${choice.blurb}`.slice(0, 3000),
        },
        accessory: imageAccessory(choice.imageUrl, choice.name),
      })),
      {
        type: "actions",
        elements: choices.map((choice, index): SlackButtonElement => ({
          type: "button",
          action_id: `pick_restaurant_${index + 1}`,
          value: `${choice.name} (storeId ${choice.storeId})`.slice(0, 2000),
          text: { type: "plain_text", text: `Pick ${index + 1}` },
        })),
      },
    ];

    const posted = await postCard(
      thread,
      blocks,
      `Where to order — ${craving}: ${choices.map((c, i) => `${i + 1}. ${c.name}`).join(" · ")}`,
    );
    postedCards.set(dedupeKey, posted.ts ?? "posted");

    const conv = activeConversation();
    for (const [index, choice] of choices.entries()) {
      const attributes: RestaurantOptionLog = {
        "meal.craving": craving,
        "meal.option_index": index + 1,
        "meal.store": choice.name,
        "meal.store_id": choice.storeId,
      };
      if (conv?.threadTs) attributes["gen_ai.conversation.id"] = conv.threadTs;
      if (conv?.userId) attributes["user.id"] = conv.userId;
      Sentry.logger.info("meal.restaurant.presented", attributes);
    }

    return { posted: true, messageTs: posted.ts };
  },
});
