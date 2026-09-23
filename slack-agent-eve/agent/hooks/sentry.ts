import * as Sentry from "@sentry/node";
import { defineHook } from "eve/hooks";
import { activeConversation } from "../lib/conversation";
import { setSlackUser } from "../lib/slack-user";

// The Sentry provider in ../instrumentation/sentry.ts sets the conversation id
// on each step. This hook puts the Slack user and a matching tag beside it on
// the same isolation scope, so the AI spans carry user.id, Explore >
// Conversations fills its User column, and error events, which carry tags
// rather than span attributes, hold the same conversation id.
//
// Every step rewrites all of it, the empty user included: one process serves
// both Slack and the local TUI, and an isolation scope outlives the turn that
// wrote to it.
export default defineHook({
  events: {
    "step.started": (_event, ctx) => {
      const { conversationId, userId } = activeConversation(ctx);
      const scope = Sentry.getIsolationScope();
      scope.setTag("gen_ai.conversation.id", conversationId);
      if (userId === undefined) scope.setUser(null);
      else setSlackUser(scope, userId);
    },
  },
});
