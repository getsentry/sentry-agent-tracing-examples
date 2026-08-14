/**
 * Conversation identity of a turn, keyed by that turn's trace id.
 * instrumentation.ts writes the Slack thread at step.started; tool code and
 * beforeSendSpan read it back.
 *
 * The trace id is the only key both sides can agree on. beforeSendSpan runs
 * while serializing a finished segment — outside the turn's async context, and
 * possibly in eve's workflow replay context (a second module instance) — so it
 * has no scope to read; what it does have is `span.trace_id`. eve restores the
 * turn's span context on every continuation step (`eve.harness.turnTrace` in
 * its tool loop), so one turn is one trace id across all of its steps, and two
 * turns never share one. A Slack turn and a local TUI turn in the same process
 * therefore cannot read each other's entry.
 *
 * The map hangs off globalThis because a Nitro step bundle can inline a second
 * copy of this module; a module-level variable would not be shared with it.
 */

import * as Sentry from "@sentry/node";

// A recorded turn with no `threadTs` is a turn that has no Slack conversation
// (the local TUI, `eve invoke`). It is recorded rather than deleted so that
// beforeSendSpan can tell "this turn is not a Slack thread" apart from "this
// trace is unknown", and strip a `gen_ai.conversation.id` an earlier turn left
// on the isolation scope the SDK stamps from.
export interface Conversation {
  threadTs?: string;
  userId?: string;
}

// Nothing marks a turn finished from in here — its spans are still being
// serialized after it returns — so entries expire by cap, not by lifecycle.
// Far above the steps one turn takes, so a turn in flight is never evicted.
const MAX_TRACKED_TURNS = 256;

declare global {
  var doordashAgentConversations: Map<string, Conversation> | undefined;
}

function conversations(): Map<string, Conversation> {
  const existing = globalThis.doordashAgentConversations;
  if (existing !== undefined) return existing;
  const created = new Map<string, Conversation>();
  globalThis.doordashAgentConversations = created;
  return created;
}

const UNSET_TRACE_ID = /^0+$/;

/** Trace id of the turn in flight, or undefined when nothing is being traced. */
export function activeTraceId(): string | undefined {
  const traceId = Sentry.getActiveSpan()?.spanContext().traceId;
  if (traceId === undefined || UNSET_TRACE_ID.test(traceId)) return undefined;
  return traceId;
}

export function rememberConversation(traceId: string, conversation: Conversation): void {
  const tracked = conversations();
  // Re-inserting moves the key to the back of the eviction order, so a long
  // turn survives while shorter turns come and go.
  tracked.delete(traceId);
  tracked.set(traceId, conversation);
  if (tracked.size > MAX_TRACKED_TURNS) {
    const oldest = tracked.keys().next();
    if (!oldest.done) tracked.delete(oldest.value);
  }
}

export function conversationForTrace(traceId: string): Conversation | undefined {
  return conversations().get(traceId);
}

/** Conversation of the turn in flight — for tools, which run inside its trace. */
export function activeConversation(): Conversation | undefined {
  const traceId = activeTraceId();
  return traceId === undefined ? undefined : conversationForTrace(traceId);
}
