import { slackChannel } from "eve/channels/slack";
import { CART_LINK_RE } from "../lib/dd";

// Credentials fall back to SLACK_BOT_TOKEN / SLACK_SIGNING_SECRET from the
// environment. Slack delivers events to /eve/v1/slack on the deployment.
export default slackChannel({
  threadContext: { since: "last-agent-reply" },
  // Mentions and DMs dispatch anonymously ({auth: null}) instead of through
  // eve's defaults, which attach a Slack auth context — a live 2026-08-08
  // mention was dropped without a turn or a log line on that default path,
  // while every {auth: null} dispatch has worked.
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
});
