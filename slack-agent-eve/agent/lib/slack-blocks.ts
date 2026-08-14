import { callSlackApi } from "eve/channels/slack";
import { z } from "zod";
import type { SlackThread } from "./conversation";

/**
 * The slice of Slack's Block Kit contract the option cards use. Eve's
 * cardToBlocks only emits full-width image blocks, so these cards are built
 * as raw blocks to get the compact `accessory` thumbnail — which means the
 * shapes Slack validates have to live somewhere. They live here.
 */

export interface SlackPlainText {
  type: "plain_text";
  text: string;
}

export interface SlackMrkdwnText {
  type: "mrkdwn";
  text: string;
}

export interface SlackImageAccessory {
  type: "image";
  image_url: string;
  alt_text: string;
}

export interface SlackButtonElement {
  type: "button";
  /** The eve_input: prefix is reserved for eve's HITL pipeline; anything
   * else is forwarded to the channel's onInteraction hook. */
  action_id: string;
  value: string;
  text: SlackPlainText;
}

export interface SlackHeaderBlock {
  type: "header";
  text: SlackPlainText;
}

export interface SlackContextBlock {
  type: "context";
  elements: SlackMrkdwnText[];
}

export interface SlackSectionBlock {
  type: "section";
  text: SlackMrkdwnText;
  accessory?: SlackImageAccessory;
}

export interface SlackActionsBlock {
  type: "actions";
  elements: SlackButtonElement[];
}

export type SlackBlock =
  | SlackHeaderBlock
  | SlackContextBlock
  | SlackSectionBlock
  | SlackActionsBlock;

/** Slack rejects an accessory whose image_url exceeds this. */
const IMAGE_URL_MAX = 3000;

export function imageAccessory(
  imageUrl: string | null | undefined,
  altText: string,
): SlackImageAccessory | undefined {
  if (!imageUrl || imageUrl.length > IMAGE_URL_MAX) return undefined;
  return { type: "image", image_url: imageUrl, alt_text: altText.slice(0, 2000) };
}

const postMessageSchema = z.looseObject({
  ok: z.boolean(),
  ts: z.string().optional(),
  error: z.string().optional(),
});

export interface PostedCard {
  /** Null when Slack accepted the post but returned no message ts. */
  ts: string | null;
}

/**
 * Posts a Block Kit card into a thread. Slack never unfurls links in
 * eve-posted messages (the channel hardcodes unfurl_links/unfurl_media off),
 * so photos only render through these blocks.
 *
 * The destination comes from `activeSlackThread`, never from a tool argument —
 * see the note there.
 */
export async function postCard(
  thread: SlackThread,
  blocks: SlackBlock[],
  fallbackText: string,
): Promise<PostedCard> {
  const response = await callSlackApi({
    botToken: undefined, // resolves process.env.SLACK_BOT_TOKEN, same as the channel
    operation: "chat.postMessage",
    body: { channel: thread.channelId, thread_ts: thread.threadTs, blocks, text: fallbackText },
  });
  const posted = postMessageSchema.parse(response);
  if (!posted.ok) {
    throw new Error(`chat.postMessage failed: ${posted.error ?? "unknown_error"}`);
  }
  return { ts: posted.ts ?? null };
}
