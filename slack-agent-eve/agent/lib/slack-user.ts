import * as Sentry from "@sentry/node";
import { callSlackApi } from "eve/channels/slack";
import { z } from "zod";

interface SlackUserProfile {
  username?: string;
  email?: string;
}

// Slack user id → profile for Sentry.setUser enrichment. A `null` entry is
// the failure cache: a missing users:read scope fails once per user per
// process, not once per step.
const slackUserProfiles = new Map<string, SlackUserProfile | null>();

// Isolation scopes whose users.info call has not come back yet.
const slackProfileWaiters = new Map<string, Set<Sentry.Scope>>();

const usersInfoSchema = z.looseObject({
  ok: z.boolean(),
  // Slack reports `missing_scope` and friends here, with HTTP 200 and ok:false.
  error: z.string().optional(),
  user: z
    .looseObject({
      name: z.string().optional(),
      profile: z
        .looseObject({
          display_name: z.string().optional(),
          real_name: z.string().optional(),
          email: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
});

// Alias, not interface: only aliases get the implicit index signature that
// Sentry.Scope.setUser's Record<string, unknown>-shaped User requires.
type SlackUserContext = {
  id: string;
  username?: string;
  email?: string;
};

function applySlackUser(scope: Sentry.Scope, userId: string): void {
  const profile = slackUserProfiles.get(userId);
  const user: SlackUserContext = { id: userId };
  // `username` is what the Logs pipeline emits as user.name and what the
  // Conversations/Issues User column prefers over the raw id.
  if (profile?.username) user.username = profile.username;
  if (profile?.email) user.email = profile.email;
  scope.setUser(user);
}

// The step hook runs before the step's model call and does not await, so
// users.info cannot be awaited before the turn's first spans open. It does
// not need to be: Sentry reads a span's isolation scope when the span ends,
// so re-applying the profile on arrival still puts the display name on spans
// that were already in flight. This matters for the first turn a process
// handles — Explore > Conversations takes its User column from the earliest
// span alone, so losing that one span shows the whole conversation under a
// raw Slack id.
export function setSlackUser(scope: Sentry.Scope, userId: string): void {
  applySlackUser(scope, userId);
  if (slackUserProfiles.has(userId)) return;

  const waiting = slackProfileWaiters.get(userId);
  if (waiting) {
    waiting.add(scope);
    return;
  }
  slackProfileWaiters.set(userId, new Set([scope]));

  void callSlackApi({
    botToken: undefined, // falls back to env SLACK_BOT_TOKEN
    operation: "users.info",
    body: { user: userId },
  })
    .then((response) => {
      const parsed = usersInfoSchema.safeParse(response);
      if (!parsed.success) throw new Error("users.info returned an unrecognised shape");
      if (!parsed.data.ok) throw new Error(`users.info failed: ${parsed.data.error ?? "unknown"}`);
      const user = parsed.data.user;
      if (!user) throw new Error("users.info returned ok with no user");
      slackUserProfiles.set(userId, {
        username: user.profile?.display_name || user.profile?.real_name || user.name,
        email: user.profile?.email,
      });
    })
    .catch((error) => {
      // Non-fatal: id-only user context still applies. Captured because a
      // missing users:read scope is otherwise invisible — every user would
      // just keep showing up under a raw Slack id.
      Sentry.captureException(error);
    })
    .finally(() => {
      if (!slackUserProfiles.has(userId)) slackUserProfiles.set(userId, null);
      for (const waiter of slackProfileWaiters.get(userId) ?? []) {
        // A scope that has moved on to another turn is left alone: the step
        // hook rewrites the user on every step, and this reply can land after it.
        if (waiter.getUser()?.id !== userId) continue;
        applySlackUser(waiter, userId);
      }
      slackProfileWaiters.delete(userId);
    });
}
