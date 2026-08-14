import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as Sentry from "@sentry/node";
import { Sandbox } from "@vercel/sandbox";
import { z } from "zod";

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

const ddEnvelopeSchema = z.looseObject({
  content: z.array(z.looseObject({ type: z.string(), text: z.string().optional() })).optional(),
  structuredContent: z.unknown().optional(),
  isError: z.boolean().optional(),
});

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
 * Runs a dd-cli command with --json-output and parses the structured payload
 * against `payload`. This module is the process's only dd-cli boundary: every
 * command below owns a schema, so no caller ever handles raw CLI output.
 *
 * dd-cli wraps every response in an MCP-style envelope; the real data lives
 * under structuredContent. Envelope-level errors throw so eve marks the tool
 * span failed (Sentry's Tool Errors widget); domain-level "not found" style
 * outcomes stay in the parsed payload for the model to relay.
 */
async function runDd<T>(args: string[], payload: z.ZodType<T>): Promise<T> {
  const argv = ["--json-output", ...args, "--intent", INTENT];
  const stdout = runsInSandbox() ? await runDdInSandbox(argv) : await runDdLocally(argv);
  const envelope = ddEnvelopeSchema.parse(JSON.parse(stdout));
  if (envelope.isError) {
    const text = envelope.content?.find((c) => c.text)?.text;
    throw new Error(`dd-cli ${args[0]} failed: ${text ?? "unknown error"}`);
  }
  return payload.parse(envelope.structuredContent ?? {});
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

const cartSchema = z.looseObject({
  id: z.string().optional(),
  store_id: z.union([z.string(), z.number()]).optional(),
  store_name: z.string().optional(),
  is_group_cart: z.boolean().optional(),
  group_cart_url: z.string().nullish(),
  spend_limit_cents: z.number().nullish(),
  items: z
    .array(
      z.looseObject({
        name: z.string().optional(),
        quantity: z.number().optional(),
        price: z.number().optional(),
      }),
    )
    .optional(),
  items_count: z.number().optional(),
});

type Cart = z.infer<typeof cartSchema>;

function toCartSummary(cartUuid: string, cart: Cart): CartSummary {
  const spendLimitCents = cart.spend_limit_cents ?? 0;
  return {
    cartUuid,
    storeId: String(cart.store_id ?? ""),
    storeName: cart.store_name ?? "",
    isGroupCart: cart.is_group_cart ?? false,
    groupCartUrl: cart.group_cart_url ?? null,
    spendLimitUsd: spendLimitCents > 0 ? spendLimitCents / 100 : null,
    items: (cart.items ?? []).map((item) => ({
      name: item.name,
      quantity: item.quantity,
      price: item.price,
    })),
    itemsCount: cart.items_count ?? cart.items?.length ?? 0,
  };
}

const cartListSchema = z.looseObject({
  carts: z.array(z.looseObject({ cart_uuid: z.string().optional() })).optional(),
});

/** UUIDs of every open cart on the signed-in account. */
export async function ddCartList(): Promise<string[]> {
  const listed = await runDd(["cart", "list"], cartListSchema);
  return (listed.carts ?? []).flatMap((cart) => (cart.cart_uuid ? [cart.cart_uuid] : []));
}

const cartShowSchema = z.looseObject({ cart: cartSchema.optional() });

export async function showCart(cartUuid: string): Promise<CartSummary> {
  const shown = await runDd(["cart", "show", "--cart-uuid", cartUuid], cartShowSchema);
  return toCartSummary(cartUuid, shown.cart ?? {});
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

const searchSchema = z.looseObject({
  stores: z
    .array(
      z.looseObject({
        store_id: z.union([z.string(), z.number()]).optional(),
        name: z.string().optional(),
        image_url: z.string().nullish(),
        distance: z.string().optional(),
        delivery_time: z.string().optional(),
        rating: z.number().optional(),
        review_count: z.number().optional(),
        is_link_out: z.boolean().optional(),
      }),
    )
    .optional(),
});

const addressListSchema = z.looseObject({
  addresses: z
    .array(
      z.looseObject({
        lat: z.number().optional(),
        lng: z.number().optional(),
        printable_address: z.string().optional(),
        is_default: z.boolean().optional(),
      }),
    )
    .optional(),
});

export interface DeliveryPoint {
  lat: number;
  lng: number;
  printable: string;
}

let cachedAddress: DeliveryPoint | undefined;

/** `search` ignores the account's saved address and needs coordinates, so the
 * default address supplies them. Cached — it changes far less often than a turn. */
export async function defaultDeliveryPoint(): Promise<DeliveryPoint> {
  if (cachedAddress) return cachedAddress;
  const listed = await runDd(["address", "list"], addressListSchema);
  const addresses = listed.addresses ?? [];
  const chosen = addresses.find((a) => a.is_default) ?? addresses[0];
  if (chosen?.lat === undefined || chosen.lng === undefined) {
    throw new Error("No saved DoorDash delivery address with coordinates — add one in the app first.");
  }
  cachedAddress = {
    lat: chosen.lat,
    lng: chosen.lng,
    printable: chosen.printable_address ?? "",
  };
  return cachedAddress;
}

export async function ddSearch(query: string, limit = 8): Promise<Restaurant[]> {
  const { lat, lng } = await defaultDeliveryPoint();
  const result = await runDd(
    [
      "search",
      "--query",
      query,
      "--limit",
      String(limit),
      "--lat",
      String(lat),
      "--lng",
      String(lng),
    ],
    searchSchema,
  );
  return (result.stores ?? [])
    // Link-out stores hand off to DoorDash's own web flow, so the cart
    // commands can't build an order for them.
    .filter((store) => store.is_link_out !== true)
    .map((store) => ({
      storeId: String(store.store_id ?? ""),
      name: store.name ?? "",
      imageUrl: store.image_url ?? null,
      distance: store.distance ?? "",
      deliveryTime: store.delivery_time ?? "",
      rating: store.rating ?? null,
      reviewCount: store.review_count ?? null,
    }));
}

export interface MenuItem {
  itemId: string;
  name: string;
  description: string | null;
  priceUsd: number | null;
  priceVaries: boolean;
  imageUrl: string | null;
  categoryName: string | null;
  hasRequiredModifiers: boolean;
}

export interface StoreMenu {
  menuId: string;
  storeName: string | null;
  /** Null when dd-cli omitted the flag; only the menu payload reports it. */
  storeIsOpen: boolean | null;
  items: MenuItem[];
}

const menuSchema = z.looseObject({
  menu_id: z.union([z.string(), z.number()]).optional(),
  store_name: z.string().nullish(),
  store_is_open: z.boolean().optional(),
  items: z
    .array(
      z.looseObject({
        item_id: z.string().optional(),
        name: z.string().optional(),
        description: z.string().nullish(),
        image_url: z.string().nullish(),
        price: z.number().optional(),
        price_varies: z.boolean().optional(),
        is_orderable: z.boolean().optional(),
        has_required_modifiers: z.boolean().optional(),
        category_name: z.string().nullish(),
      }),
    )
    .optional(),
});

export async function ddMenu(storeId: string): Promise<StoreMenu> {
  const menu = await runDd(["menu", "--store-id", storeId], menuSchema);
  // is_popular / popularity_rank are deliberately not surfaced: the CLI docs
  // ask agents not to base any decision on them.
  const items = (menu.items ?? []).flatMap((item): MenuItem[] =>
    item.is_orderable === false || !item.item_id
      ? []
      : [
          {
            itemId: stripCatalogPrefix(item.item_id),
            name: item.name ?? "",
            description: item.description ?? null,
            priceUsd: item.price ?? null,
            priceVaries: item.price_varies ?? false,
            imageUrl: item.image_url ?? null,
            categoryName: item.category_name ?? null,
            hasRequiredModifiers: item.has_required_modifiers ?? false,
          },
        ],
  );
  return {
    menuId: String(menu.menu_id ?? ""),
    storeName: menu.store_name ?? null,
    storeIsOpen: menu.store_is_open ?? null,
    items,
  };
}

/**
 * Search results carry no availability at all — a closed store is
 * indistinguishable from an open one until the menu is fetched, and only the
 * menu payload reports `store_is_open`. Returns null when the probe fails, so
 * callers can decide whether unknown counts as offerable.
 */
export async function storeIsOpen(storeId: string): Promise<boolean | null> {
  try {
    return (await ddMenu(storeId)).storeIsOpen;
  } catch (error) {
    // Deliberate capture: the caller degrades to "unknown, keep the store",
    // so without this the probe failure would never reach Sentry.
    Sentry.captureException(error);
    return null;
  }
}

export interface ItemOption {
  optionId: string;
  name: string;
  priceUsd: number;
  extras: ItemExtra[];
}

export interface ItemExtra {
  title: string;
  required: boolean;
  minNumOptions: number;
  maxNumOptions: number;
  numFreeOptions: number;
  options: ItemOption[];
}

export interface ItemDetails {
  itemId: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  basePriceUsd: number | null;
  priceVaries: boolean;
  extras: ItemExtra[];
}

interface RawExtra {
  extra_id?: string;
  title?: string;
  min_num_options?: number;
  max_num_options?: number;
  num_free_options?: number;
  options?: RawOption[];
}

interface RawOption {
  option_id?: string;
  name?: string;
  price?: number;
  extras?: RawExtra[];
}

// Customization groups nest without a documented depth limit (a combo meal's
// side has its own size options), so the two schemas reference each other.
const rawExtraSchema: z.ZodType<RawExtra> = z.lazy(() =>
  z.looseObject({
    extra_id: z.string().optional(),
    title: z.string().optional(),
    min_num_options: z.number().optional(),
    max_num_options: z.number().optional(),
    num_free_options: z.number().optional(),
    options: z.array(rawOptionSchema).optional(),
  }),
);

const rawOptionSchema: z.ZodType<RawOption> = z.lazy(() =>
  z.looseObject({
    option_id: z.string().optional(),
    name: z.string().optional(),
    price: z.number().optional(),
    extras: z.array(rawExtraSchema).optional(),
  }),
);

const itemDetailsSchema = z.looseObject({
  item: z
    .looseObject({
      item_id: z.string().optional(),
      name: z.string().optional(),
      description: z.string().nullish(),
      image_url: z.string().nullish(),
      price: z.number().optional(),
      price_varies: z.boolean().optional(),
      extras: z.array(rawExtraSchema).optional(),
    })
    .optional(),
});

function toItemExtras(extras: RawExtra[] | undefined): ItemExtra[] {
  return (extras ?? []).map((extra) => ({
    title: extra.title ?? "",
    required: (extra.min_num_options ?? 0) > 0,
    minNumOptions: extra.min_num_options ?? 0,
    maxNumOptions: extra.max_num_options ?? 0,
    numFreeOptions: extra.num_free_options ?? 0,
    options: (extra.options ?? []).flatMap((option): ItemOption[] =>
      option.option_id
        ? [
            {
              optionId: stripCatalogPrefix(option.option_id),
              name: option.name ?? "",
              priceUsd: option.price ?? 0,
              extras: toItemExtras(option.extras),
            },
          ]
        : [],
    ),
  }));
}

export async function ddItemDetails(
  storeId: string,
  menuId: string,
  itemId: string,
): Promise<ItemDetails> {
  const bareItemId = stripCatalogPrefix(itemId);
  const details = await runDd(
    [
      "restaurant-item-details",
      "--store-id",
      storeId,
      "--menu-id",
      menuId,
      "--item-id",
      bareItemId,
    ],
    itemDetailsSchema,
  );
  const item = details.item ?? {};
  return {
    itemId: item.item_id ? stripCatalogPrefix(item.item_id) : bareItemId,
    name: item.name ?? "",
    description: item.description ?? null,
    imageUrl: item.image_url ?? null,
    basePriceUsd: item.price ?? null,
    priceVaries: item.price_varies ?? false,
    extras: toItemExtras(item.extras),
  };
}

const cartItemErrorSchema = z.json();

/**
 * dd-cli's per-item rejection payload. Its fields are undocumented and vary by
 * rejection reason (required_options entries, catalog errors), so it is carried
 * as JSON and relayed to the model verbatim rather than given an invented shape.
 */
export type CartItemError = z.infer<typeof cartItemErrorSchema>;

export interface CartAddOutcome {
  added: boolean;
  itemErrors: CartItemError[];
  message: string | null;
  cart: CartSummary;
}

const cartAddSchema = z.looseObject({
  success: z.boolean().optional(),
  item_errors: z.array(cartItemErrorSchema).optional(),
  message: z.string().nullish(),
  cart_uuid: z.string().optional(),
  cart: cartSchema.optional(),
});

export async function ddCartAddItems(
  storeId: string,
  menuId: string,
  cartUuid: string | undefined,
  itemsJson: string,
): Promise<CartAddOutcome> {
  const result = await runDd(
    [
      "cart",
      "add-items",
      "--store-id",
      storeId,
      "--menu-id",
      menuId,
      // Without --cart-uuid dd-cli appends to this store's open cart, or
      // creates one — which is what a personal order wants.
      ...(cartUuid ? ["--cart-uuid", cartUuid] : []),
      "--items-json",
      itemsJson,
    ],
    cartAddSchema,
  );
  const itemErrors = result.item_errors ?? [];
  return {
    added: result.success === true && itemErrors.length === 0,
    itemErrors,
    message: result.message ?? null,
    cart: toCartSummary(result.cart_uuid ?? cartUuid ?? "", result.cart ?? {}),
  };
}

export interface QuoteLine {
  label: string;
  amountDisplay: string;
  amountMinorUnits: number;
  currency: string | null;
}

export interface OrderQuote {
  lines: QuoteLine[];
  errorMessage: string | null;
}

const orderPreviewSchema = z.looseObject({
  error_message: z.string().nullish(),
  quote: z
    .looseObject({
      line_items: z
        .array(
          z.looseObject({
            charge_id: z.string().optional(),
            label: z.string().optional(),
            final_money: z
              .looseObject({
                unit_amount: z.number().optional(),
                currency: z.string().optional(),
                display_string: z.string().optional(),
              })
              .optional(),
          }),
        )
        .optional(),
    })
    .optional(),
});

export async function ddOrderPreview(cartUuid: string): Promise<OrderQuote> {
  const result = await runDd(["order", "preview", "--cart-uuid", cartUuid], orderPreviewSchema);
  const lines = (result.quote?.line_items ?? []).map((line) => ({
    label: line.label ?? line.charge_id ?? "",
    amountDisplay: line.final_money?.display_string ?? "",
    amountMinorUnits: line.final_money?.unit_amount ?? 0,
    currency: line.final_money?.currency ?? null,
  }));
  return { lines, errorMessage: result.error_message ?? null };
}

const checkoutUrlSchema = z.looseObject({
  checkout_url: z.string().nullish(),
  url: z.string().nullish(),
});

export async function ddCheckoutUrl(cartUuid: string): Promise<string | null> {
  const result = await runDd(["order", "checkout-url", "--cart-uuid", cartUuid], checkoutUrlSchema);
  return result.checkout_url ?? result.url ?? null;
}
