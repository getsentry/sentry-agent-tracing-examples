// The demo storefront has no sign-in, so identity is fixed data rather than a
// session. SHOPPERS is the whole cast: each entry is both the Sentry user on
// every error, trace, and replay, and a customer row in lib/db.

export interface Shopper {
  id: string;
  username: string;
  email: string;
}

// Who the browser is signed in as. Server, edge, and client Sentry configs all
// start their scope here, so a page render carries a user even where no
// request handler calls Sentry.setUser.
export const DEMO_USER: Shopper = {
  id: "cust_01",
  username: "ada",
  email: "ada@example.com",
};

export const SHOPPERS: Shopper[] = [
  DEMO_USER,
  { id: "cust_02", username: "grace", email: "grace@example.com" },
  { id: "cust_03", username: "alan", email: "alan@example.com" },
  { id: "cust_04", username: "katherine", email: "katherine@example.com" },
  { id: "cust_05", username: "radia", email: "radia@example.com" },
  { id: "cust_06", username: "shafi", email: "shafi@example.com" },
];

/** Falls back to the signed-in shopper, so an unknown id can never widen
 * access beyond the six fictional customers. */
export function shopperById(id: string | null | undefined): Shopper {
  return SHOPPERS.find((shopper) => shopper.id === id) ?? DEMO_USER;
}
