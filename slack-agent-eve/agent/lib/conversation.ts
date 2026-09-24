/**
 * Slack identity of a session, recorded by the Slack channel's event handlers
 * (agent/channels/slack.ts) and read by the card tools and agent/hooks/sentry.ts.
 *
 * eve keeps one durable session per Slack thread, and the Sentry provider in
 * agent/instrumentation/sentry.ts sets the session id as the conversation id
 * on every step, so the session id is the conversation id everywhere. A
 * session that did not come from Slack (the local TUI, `eve invoke`) has no
 * entry here; its conversation is still its session id.
 *
 * The map hangs off globalThis because a Nitro step bundle can inline a second
 * copy of this module; a module-level variable would not be shared with it.
 */

interface SlackIdentity {
  channelId?: string;
  threadTs?: string;
  userId?: string;
}

export interface Conversation extends SlackIdentity {
  conversationId: string;
}

/** Where a card may be posted. Only `activeSlackThread` can supply one. */
export interface SlackThread {
  channelId: string;
  threadTs: string;
}

/** The part of eve's tool and hook context this module reads. */
export interface SessionScoped {
  readonly session: { readonly id: string };
}

// Nothing marks a session finished from in here, so entries expire by cap.
// Far above the sessions one process serves at once.
const MAX_TRACKED_SESSIONS = 256;

declare global {
  var doordashAgentSlackSessions: Map<string, SlackIdentity> | undefined;
}

function sessions(): Map<string, SlackIdentity> {
  const existing = globalThis.doordashAgentSlackSessions;
  if (existing !== undefined) return existing;
  const created = new Map<string, SlackIdentity>();
  globalThis.doordashAgentSlackSessions = created;
  return created;
}

export function rememberSlackSession(
  sessionId: string,
  state: { channelId: string | null; threadTs: string | null; triggeringUserId?: string | null },
): void {
  const tracked = sessions();
  // Re-inserting moves the key to the back of the eviction order, so a busy
  // thread survives while quiet ones come and go.
  tracked.delete(sessionId);
  tracked.set(sessionId, {
    channelId: state.channelId ?? undefined,
    threadTs: state.threadTs ?? undefined,
    userId: state.triggeringUserId ?? undefined,
  });
  if (tracked.size > MAX_TRACKED_SESSIONS) {
    const oldest = tracked.keys().next();
    if (!oldest.done) tracked.delete(oldest.value);
  }
}

/** Conversation of the session a tool or hook runs in. */
export function activeConversation(ctx: SessionScoped): Conversation {
  return { conversationId: ctx.session.id, ...sessions().get(ctx.session.id) };
}

/**
 * Slack thread of the session a tool runs in, or undefined when the session
 * came from somewhere else (the local TUI, `eve invoke`).
 *
 * This is the only trusted destination for an outbound message. A tool
 * argument is model output: the model reads the channel and thread out of the
 * `<slack_message>` envelope, so anything a user writes in that thread can ask
 * it to write a different pair, and the bot token would post wherever it can
 * reach. The channel's own event handlers know the real pair, so tools never
 * have to ask the model for it.
 */
export function activeSlackThread(ctx: SessionScoped): SlackThread | undefined {
  const { channelId, threadTs } = activeConversation(ctx);
  if (channelId === undefined || threadTs === undefined) return undefined;
  return { channelId, threadTs };
}
