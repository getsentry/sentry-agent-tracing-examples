import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// dd-cli requires --intent on every service command: a two-line statement of
// who the workflow serves and why, which DoorDash may review. Kept static and
// free of Slack message text so nothing about teammates leaks into it.
const INTENT = [
  "Summary: Help a Slack team pick group-lunch options within a set per-person budget and add each person's pick to their shared DoorDash group cart.",
  'user prompt/purpose: "A team member asked the Slack lunch bot to suggest or add items for a posted DoorDash group order"',
].join("\n");

// Matches DoorDash group-cart share links: dd-cli returns them as
// https://drd.sh/cart/<token>/ which 301s to https://www.doordash.com/dd/cart/<token>/.
// The token is an opaque short id — it does NOT contain the cart UUID, so
// resolving a link means matching it against `cart show`'s group_cart_url.
export const CART_LINK_RE =
  /(?:drd\.sh|(?:www\.)?doordash\.com)\/(?:dd\/)?cart\/([A-Za-z0-9]+)/i;

export function cartLinkToken(link: string): string | undefined {
  return CART_LINK_RE.exec(link)?.[1];
}

// Catalog ids come prefixed by kind (i_ item, o_ option, e_ extra); every
// command that consumes them wants the bare numeric id.
export function stripCatalogPrefix(id: string): string {
  return id.replace(/^[a-z]_/, "");
}

export function lunchBudgetUsd(): number {
  const parsed = Number(process.env.LUNCH_BUDGET_USD);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 25;
}

interface DdEnvelope {
  content?: { type: string; text?: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

/**
 * Runs a dd-cli command with --json-output and returns the structured payload.
 * dd-cli wraps every response in an MCP-style envelope; the real data lives
 * under structuredContent. Envelope-level errors throw so eve marks the tool
 * span failed (Sentry's Tool Errors widget); domain-level "not found" style
 * outcomes stay in the returned object for the model to relay.
 */
export async function runDd(args: string[]): Promise<Record<string, unknown>> {
  const bin = process.env.DD_CLI_BIN ?? "dd-cli";
  const { stdout } = await execFileAsync(
    bin,
    ["--json-output", ...args, "--intent", INTENT],
    { maxBuffer: 64 * 1024 * 1024, timeout: 120_000 },
  );
  const envelope = JSON.parse(stdout) as DdEnvelope;
  if (envelope.isError) {
    const text = envelope.content?.find((c) => c.text)?.text;
    throw new Error(`dd-cli ${args[0]} failed: ${text ?? "unknown error"}`);
  }
  return envelope.structuredContent ?? {};
}

export interface CartLine {
  name?: string;
  quantity?: number;
  price?: number;
}

export interface CartSummary {
  cartUuid: string;
  storeId: string;
  storeName: string;
  isGroupCart: boolean;
  groupCartUrl: string | null;
  items: CartLine[];
  itemsCount: number;
}

interface RawCartObject {
  id?: string;
  store_id?: string | number;
  store_name?: string;
  is_group_cart?: boolean;
  group_cart_url?: string | null;
  items?: { name?: string; quantity?: number; price?: number }[];
  items_count?: number;
}

export function toCartSummary(cartUuid: string, cart: RawCartObject): CartSummary {
  return {
    cartUuid,
    storeId: String(cart.store_id ?? ""),
    storeName: cart.store_name ?? "",
    isGroupCart: cart.is_group_cart ?? false,
    groupCartUrl: cart.group_cart_url ?? null,
    items: (cart.items ?? []).map((item) => ({
      name: item.name,
      quantity: item.quantity,
      price: item.price,
    })),
    itemsCount: cart.items_count ?? cart.items?.length ?? 0,
  };
}

export async function showCart(cartUuid: string): Promise<CartSummary> {
  const shown = await runDd(["cart", "show", "--cart-uuid", cartUuid]);
  return toCartSummary(cartUuid, (shown.cart ?? {}) as RawCartObject);
}
