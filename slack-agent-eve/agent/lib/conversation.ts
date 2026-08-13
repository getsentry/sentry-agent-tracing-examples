/**
 * Cross-context handoff for conversation identity. instrumentation.ts (real
 * server context) writes the current Slack thread here at step.started; tool
 * code and beforeSendSpan (which may run inside eve's workflow replay context,
 * a different module instance in the same process) read it back. A global
 * survives that module duplication where a module-level variable would not.
 * Single-process demo server: a TUI turn right after a Slack turn inherits the
 * stale thread — acceptable here.
 */

export interface ConversationStash {
  threadTs?: string | null;
  userId?: string | null;
}

declare global {
  var doordashAgentConversation: ConversationStash | undefined;
}

export function conversationStash(): ConversationStash | undefined {
  return globalThis.doordashAgentConversation;
}

export function setConversationStash(stash: ConversationStash): void {
  globalThis.doordashAgentConversation = stash;
}
