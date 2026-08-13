import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Sandbox } from "@vercel/sandbox";

const execFileAsync = promisify(execFile);

// dd-cli requires --intent on every service command: a two-line statement of
// who the workflow serves and why, which DoorDash may review. Kept static and
// free of Slack message text so nothing about teammates leaks into it.
const INTENT = [
  "Summary: Help a person in Slack choose a meal within a set budget and build the DoorDash cart for it — either their own cart, which they check out themselves, or their pick inside a shared group order.",
  'user prompt/purpose: "A person asked the Slack food bot to suggest a meal and build a cart for it, or to add their pick to a posted DoorDash group order"',
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

export function mealBudgetUsd(): number {
  const parsed = Number(process.env.MEAL_BUDGET_USD);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 25;
}

interface DdEnvelope {
  content?: { type: string; text?: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

const DD_CLI_VERSION = "v0.2.2";
const DD_CLI_TARBALL = `https://github.com/doordash-oss/doordash-cli/releases/download/${DD_CLI_VERSION}/dd-cli-${DD_CLI_VERSION}-linux-amd64.tar.gz`;

/** A deployment has no dd-cli binary, no browser, and no OS keychain, so the
 * CLI runs in a Vercel Sandbox authenticated by DD_CLI_ACCESS_TOKEN. Local dev
 * keeps using the installed binary and its keychain sign-in. */
function runsInSandbox(): boolean {
  // DD_CLI_SANDBOX decides when set, because `eve deploy` rewrites .env.local
  // with Vercel's system variables — VERCEL=1 included — and a local dev server
  // would otherwise flip itself into sandbox mode.
  const explicit = process.env.DD_CLI_SANDBOX;
  if (explicit !== undefined && explicit !== "") return explicit !== "0" && explicit !== "false";
  return Boolean(process.env.VERCEL);
}

let sandboxPromise: Promise<Sandbox> | undefined;

function ddCliSandbox(): Promise<Sandbox> {
  // Named, so every function invocation of this deployment reuses one sandbox
  // instead of paying the install cost per tool call.
  sandboxPromise ??= Sandbox.getOrCreate({
    name: "doordash-cli",
    timeout: 30 * 60 * 1000,
    onCreate: async (sandbox) => {
      const install = await sandbox.runCommand({
        cmd: "bash",
        args: [
          "-lc",
          `set -euo pipefail
           curl -fsSL "${DD_CLI_TARBALL}" -o /tmp/dd-cli.tgz
           tar xzf /tmp/dd-cli.tgz -C /tmp
           mv "$(find /tmp -maxdepth 2 -type f -name 'dd-cli-*-linux-amd64' | head -1)" "$HOME/dd-cli"
           chmod +x "$HOME/dd-cli"`,
        ],
      });
      if (install.exitCode !== 0) {
        throw new Error(`dd-cli install in sandbox failed: ${await install.stderr()}`);
      }
    },
  }).catch((error) => {
    // A failed creation must not poison every later call.
    sandboxPromise = undefined;
    throw error;
  });
  return sandboxPromise;
}

async function runDdInSandbox(argv: string[]): Promise<string> {
  const token = process.env.DD_CLI_ACCESS_TOKEN;
  if (!token) {
    throw new Error(
      "DD_CLI_ACCESS_TOKEN is not set — mint one with `dd-cli export-token` and add it to the deployment's environment.",
    );
  }
  const sandbox = await ddCliSandbox();
  // Args go through "$@" rather than the command string so the multi-line
  // --intent value can't be re-split by the shell.
  const result = await sandbox.runCommand({
    cmd: "bash",
    args: ["-lc", 'exec "$HOME/dd-cli" "$@"', "dd-cli", ...argv],
    env: { DD_CLI_ACCESS_TOKEN: token },
  });
  if (result.exitCode !== 0) {
    throw new Error(`dd-cli ${argv[1]} failed in sandbox: ${await result.stderr()}`);
  }
  return result.stdout();
}

async function runDdLocally(argv: string[]): Promise<string> {
  const bin = process.env.DD_CLI_BIN ?? "dd-cli";
  const { stdout } = await execFileAsync(bin, argv, {
    maxBuffer: 64 * 1024 * 1024,
    timeout: 120_000,
  });
  return stdout;
}

/**
 * Runs a dd-cli command with --json-output and returns the structured payload.
 * dd-cli wraps every response in an MCP-style envelope; the real data lives
 * under structuredContent. Envelope-level errors throw so eve marks the tool
 * span failed (Sentry's Tool Errors widget); domain-level "not found" style
 * outcomes stay in the returned object for the model to relay.
 */
export async function runDd(args: string[]): Promise<Record<string, unknown>> {
  const argv = ["--json-output", ...args, "--intent", INTENT];
  const stdout = runsInSandbox() ? await runDdInSandbox(argv) : await runDdLocally(argv);
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
  /** The group order's own per-person limit, when the host set one. */
  spendLimitUsd: number | null;
  items: CartLine[];
  itemsCount: number;
}

interface RawCartObject {
  id?: string;
  store_id?: string | number;
  store_name?: string;
  is_group_cart?: boolean;
  group_cart_url?: string | null;
  spend_limit_cents?: number;
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
    spendLimitUsd:
      typeof cart.spend_limit_cents === "number" && cart.spend_limit_cents > 0
        ? cart.spend_limit_cents / 100
        : null,
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

export interface Restaurant {
  storeId: string;
  name: string;
  imageUrl: string | null;
  distance: string;
  deliveryTime: string;
  rating: number | null;
  reviewCount: number | null;
}

interface RawStore {
  store_id?: string | number;
  name?: string;
  image_url?: string | null;
  distance?: string;
  delivery_time?: string;
  rating?: number;
  review_count?: number;
  is_link_out?: boolean;
}

interface RawAddress {
  lat?: number;
  lng?: number;
  printable_address?: string;
  is_default?: boolean;
}

let cachedAddress: { lat: number; lng: number; printable: string } | undefined;

/** `search` ignores the account's saved address and needs coordinates, so the
 * default address supplies them. Cached — it changes far less often than a turn. */
export async function defaultDeliveryPoint(): Promise<{
  lat: number;
  lng: number;
  printable: string;
}> {
  if (cachedAddress) return cachedAddress;
  const listed = await runDd(["address", "list"]);
  const addresses = (listed.addresses ?? []) as RawAddress[];
  const chosen = addresses.find((a) => a.is_default) ?? addresses[0];
  if (!chosen || typeof chosen.lat !== "number" || typeof chosen.lng !== "number") {
    throw new Error("No saved DoorDash delivery address with coordinates — add one in the app first.");
  }
  cachedAddress = {
    lat: chosen.lat,
    lng: chosen.lng,
    printable: chosen.printable_address ?? "",
  };
  return cachedAddress;
}

export async function searchRestaurants(query: string, limit = 8): Promise<Restaurant[]> {
  const { lat, lng } = await defaultDeliveryPoint();
  const result = await runDd([
    "search",
    "--query",
    query,
    "--limit",
    String(limit),
    "--lat",
    String(lat),
    "--lng",
    String(lng),
  ]);
  return ((result.stores ?? []) as RawStore[])
    // Link-out stores hand off to DoorDash's own web flow, so the cart
    // commands can't build an order for them.
    .filter((store) => store.is_link_out !== true)
    .map((store) => ({
      storeId: String(store.store_id ?? ""),
      name: store.name ?? "",
      imageUrl: store.image_url ?? null,
      distance: store.distance ?? "",
      deliveryTime: store.delivery_time ?? "",
      rating: typeof store.rating === "number" ? store.rating : null,
      reviewCount: typeof store.review_count === "number" ? store.review_count : null,
    }));
}

/**
 * Search results carry no availability at all — a closed store is
 * indistinguishable from an open one until the menu is fetched, and only the
 * menu payload reports `store_is_open`. Returns null when the probe fails, so
 * callers can decide whether unknown counts as offerable.
 */
export async function storeIsOpen(storeId: string): Promise<boolean | null> {
  try {
    const menu = await runDd(["menu", "--store-id", storeId]);
    return typeof menu.store_is_open === "boolean" ? menu.store_is_open : null;
  } catch {
    return null;
  }
}
