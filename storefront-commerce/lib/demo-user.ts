// The store has no sign-in, so identity is fixed data rather than a session.
// This shopper is both the Sentry user on every error, trace, and replay, and
// the matching customer row in lib/db.

export interface Shopper {
  id: string;
  username: string;
  email: string;
}

// Server, edge, and client Sentry configs all start their scope here, so a page
// render carries a user even where no request handler calls Sentry.setUser.
export const DEMO_USER: Shopper = {
  id: "cust_01",
  username: "ada",
  email: "ada@example.com",
};
