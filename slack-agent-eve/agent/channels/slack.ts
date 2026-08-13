import * as Sentry from "@sentry/node";
import { slackChannel } from "eve/channels/slack";
import { CART_LINK_RE } from "../lib/dd";

// Credentials fall back to SLACK_BOT_TOKEN / SLACK_SIGNING_SECRET from the
// environment. Slack delivers events to /eve/v1/slack on the deployment.
export default slackChannel({
  threadContext: { since: "last-agent-reply" },
  // Mentions and DMs dispatch anonymously ({auth: null}) instead of through
  // eve's defaults, which attach a Slack auth context: mentions on that
  // default path were dropped without a turn or a log line, while every
  // {auth: null} dispatch runs.
  async onAppMention(_ctx, message) {
    return message.author?.isBot ? null : { auth: null };
  },
  async onDirectMessage(_ctx, message) {
    return message.author?.isBot ? null : { auth: null };
  },
  // Dispatch on any channel message carrying a DoorDash group-cart link — the
  // whole point is that posting the link is the trigger, no @mention needed.
  // Requires the message.channels event + channels:history scope
  // (message.groups + groups:history for private channels). Eve routes
  // mention-bearing messages to onAppMention, never here.
  async onMessage(ctx, message) {
    if (message.author?.isBot) return null;
    const hasGroupOrderLink = CART_LINK_RE.test(message.text);
    return hasGroupOrderLink || (await ctx.isSubscribed()) ? { auth: null } : null;
  },
  // "Pick N" buttons on the restaurant and meal cards. Slack POSTs
  // block_actions to the same webhook route; eve forwards non-HITL actions
  // here. ctx.send dispatches a user message into the thread's session, so a
  // click becomes a normal turn the agent handles per the instructions.
  async onInteraction(action, ctx) {
    const isPick =
      action.actionId.startsWith("pick_option_") || action.actionId.startsWith("pick_restaurant_");
    if (!isPick) return;
    const pick = action.value ?? action.label ?? "their option";
    // Slack voids the click unless the block_actions POST is acked within 3
    // seconds, and on eve's local queue ctx.send runs the triggered turn
    // inline — so the send must not be awaited here.
    void ctx
      .send(
        `<@${action.user.id}> clicked ${action.label ?? "a pick button"} on the options card — their pick is ${pick}.`,
        { auth: null },
      )
      .catch((error) => {
        // The click was already acked, so a failure here is silent to the
        // person: nothing else would ever report it. The console integration
        // only makes a breadcrumb, hence the explicit capture.
        Sentry.captureException(error);
        console.error("[slack] pick dispatch failed", error);
      });
  },
});
