// The one signed-in demo customer, shared by the Sentry configs (browser,
// server, edge) and the seed data so every error, trace, and replay carries
// the same user identity.
export const DEMO_USER = {
  id: "cust_01",
  email: "ada@example.com",
  username: "ada",
};
