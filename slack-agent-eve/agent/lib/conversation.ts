/**
 * Cross-context handoff for conversation identity. instrumentation.ts (real
 * server context) writes the current Slack thread here at step.started; tool
 * code (which may run inside eve's workflow replay context, a different
 * module instance in the same process) reads it back. Symbol.for + globalThis
 * survive the module duplication. Single-process demo server: a TUI turn
 * right after a Slack turn inherits the stale thread — acceptable here.
 */
export const CONVERSATION_STASH = Symbol.for("doordash-agent.conversation");

export interface ConversationStash {
  threadTs?: string | null;
  userId?: string | null;
}

export function conversationStash(): ConversationStash | undefined {
  return (globalThis as Record<symbol, unknown>)[CONVERSATION_STASH] as
    | ConversationStash
    | undefined;
}
