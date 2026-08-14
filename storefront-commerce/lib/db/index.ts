import * as Sentry from "@sentry/nextjs";
import type {
  Cart,
  CartItem,
  Collection,
  Customer,
  Menu,
  Order,
  Page,
  Product,
  StoredCart,
} from "lib/commerce/types";
import {
  COLLECTIONS,
  CUSTOMERS,
  MENUS,
  ORDERS,
  PAGES,
  PAYMENTS,
  PRODUCTS,
  type MenuHandle,
  type Payment,
  type ProductRow,
} from "./data";

/**
 * Runs a fake query with realistic jittered latency inside a Sentry span
 * shaped like a real database call: `op: db.query`, a parameterized SQL
 * statement as the span name, and the current `db.*` attributes — what
 * Sentry's Queries insights need to parse and aggregate the span.
 */
function query<T>(sql: string, operation: string, run: () => T): Promise<T> {
  return Sentry.startSpan(
    {
      name: sql,
      op: "db.query",
      attributes: {
        "db.system.name": "sqlite",
        "db.operation.name": operation,
        "db.query.text": sql,
      },
    },
    async () => {
      await new Promise((resolve) =>
        setTimeout(resolve, 20 + Math.random() * 100),
      );
      return run();
    },
  );
}

// Drops the columns a row carries only so the fake queries can filter and
// sort; they are not part of the product the storefront renders.
const toProduct = ({
  collections: _collections,
  bestSellingRank: _bestSellingRank,
  createdAt: _createdAt,
  ...product
}: ProductRow): Product => product;

function sortProducts(
  rows: ProductRow[],
  sortKey?: string,
  reverse?: boolean,
): ProductRow[] {
  const sorted = [...rows];

  switch (sortKey) {
    case "PRICE":
      sorted.sort(
        (a, b) =>
          parseFloat(a.priceRange.minVariantPrice.amount) -
          parseFloat(b.priceRange.minVariantPrice.amount),
      );
      break;
    case "CREATED_AT":
      sorted.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      break;
    case "BEST_SELLING":
      sorted.sort((a, b) => a.bestSellingRank - b.bestSellingRank);
      break;
    // RELEVANCE (the default) keeps catalog order.
  }

  if (reverse) sorted.reverse();
  return sorted;
}

export function selectProducts(
  options: { search?: string; sortKey?: string; reverse?: boolean } = {},
): Promise<Product[]> {
  const { search, sortKey, reverse } = options;
  const sql = search
    ? "SELECT * FROM products WHERE title LIKE ? OR description LIKE ? OR tags LIKE ?"
    : "SELECT * FROM products";

  return query(sql, "SELECT", () => {
    const term = search?.toLowerCase().trim();
    const rows = term
      ? PRODUCTS.filter(
          (p) =>
            p.title.toLowerCase().includes(term) ||
            p.description.toLowerCase().includes(term) ||
            p.tags.some((tag) => tag.includes(term)),
        )
      : PRODUCTS;

    return sortProducts(rows, sortKey, reverse).map(toProduct);
  });
}

export function selectProductsByCollection(
  collectionHandle: string,
  options: { sortKey?: string; reverse?: boolean } = {},
): Promise<Product[]> {
  return query(
    "SELECT p.* FROM products p JOIN collection_products cp ON cp.product_id = p.id WHERE cp.collection_handle = ?",
    "SELECT",
    () => {
      const rows = PRODUCTS.filter((p) =>
        p.collections.includes(collectionHandle),
      );
      return sortProducts(rows, options.sortKey, options.reverse).map(
        toProduct,
      );
    },
  );
}

export function selectProduct(handle: string): Promise<Product | undefined> {
  return query("SELECT * FROM products WHERE handle = ?", "SELECT", () => {
    const row = PRODUCTS.find((p) => p.handle === handle);
    return row ? toProduct(row) : undefined;
  });
}

export function selectRecommendations(productId: string): Promise<Product[]> {
  return query(
    "SELECT * FROM products WHERE collection_handle IN (SELECT collection_handle FROM collection_products WHERE product_id = ?) AND id != ? LIMIT ?",
    "SELECT",
    () => {
      const current = PRODUCTS.find((p) => p.id === productId);
      const related = PRODUCTS.filter(
        (p) =>
          p.id !== productId &&
          p.collections.some(
            (c) => !c.startsWith("hidden") && current?.collections.includes(c),
          ),
      );
      const fallback = PRODUCTS.filter(
        (p) => p.id !== productId && !related.includes(p),
      );
      return [...related, ...fallback].slice(0, 4).map(toProduct);
    },
  );
}

export function selectCollections(): Promise<Collection[]> {
  return query("SELECT * FROM collections", "SELECT", () => [...COLLECTIONS]);
}

export function selectCollection(
  handle: string,
): Promise<Collection | undefined> {
  return query("SELECT * FROM collections WHERE handle = ?", "SELECT", () =>
    COLLECTIONS.find((c) => c.handle === handle),
  );
}

export function selectMenu(handle: MenuHandle): Promise<Menu[]> {
  return query(
    "SELECT title, path FROM menu_items WHERE menu_handle = ?",
    "SELECT",
    () => MENUS[handle],
  );
}

export function selectPage(handle: string): Promise<Page | undefined> {
  return query("SELECT * FROM pages WHERE handle = ?", "SELECT", () =>
    PAGES.find((p) => p.handle === handle),
  );
}

export function selectPages(): Promise<Page[]> {
  return query("SELECT * FROM pages", "SELECT", () => [...PAGES]);
}

export function selectCustomer(id: string): Promise<Customer | undefined> {
  return query("SELECT * FROM customers WHERE id = ?", "SELECT", () =>
    CUSTOMERS.find((c) => c.id === id),
  );
}

export function selectOrder(
  customerId: string,
  orderId: string,
): Promise<Order | undefined> {
  return query(
    "SELECT * FROM orders WHERE customer_id = ? AND id = ? LIMIT 1",
    "SELECT",
    () => ORDERS.find((o) => o.customerId === customerId && o.id === orderId),
  );
}

// The demo's planted bug: orders that predate the payments launch (see
// PAYMENTS in data.ts) have no row here, so a refund of a legacy order fails.
export function selectPayment(orderId: string): Promise<Payment> {
  return query(
    "SELECT * FROM payments WHERE order_id = ? LIMIT 1",
    "SELECT",
    () => {
      const payment = PAYMENTS.find((p) => p.orderId === orderId);
      if (!payment) {
        throw new Error(
          `Order ${orderId} predates the payments launch and has no charge to refund`,
        );
      }
      return payment;
    },
  );
}

export function selectOrders(
  customerId: string,
  limit: number = 10,
): Promise<Order[]> {
  return query(
    "SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC LIMIT ?",
    "SELECT",
    () =>
      ORDERS.filter((o) => o.customerId === customerId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit),
  );
}

// Carts are the only mutable table. They live for the lifetime of the server
// process, keyed by the id stored in the visitor's `cartId` cookie.
const carts = new Map<string, CartItem[]>();
let nextLineId = 1;

function findVariant(merchandiseId: string) {
  for (const product of PRODUCTS) {
    const variant = product.variants.find((v) => v.id === merchandiseId);
    if (variant) return { product, variant };
  }
  return undefined;
}

function computeCart(id: string, lines: CartItem[]): StoredCart {
  const subtotal = lines.reduce(
    (sum, line) => sum + parseFloat(line.cost.totalAmount.amount),
    0,
  );
  const money = (amount: number) => ({
    amount: amount.toFixed(2),
    currencyCode: "USD",
  });

  return {
    id,
    checkoutUrl: "/checkout",
    cost: {
      subtotalAmount: money(subtotal),
      totalAmount: money(subtotal),
      totalTaxAmount: money(0),
    },
    lines,
    totalQuantity: lines.reduce((sum, line) => sum + line.quantity, 0),
  };
}

// The cookie may reference a cart from a previous server process; recreate the
// row instead of failing so stale cookies don't break the cart UI.
function getOrCreateLines(cartId: string): CartItem[] {
  const existing = carts.get(cartId);
  if (existing) return existing;
  const lines: CartItem[] = [];
  carts.set(cartId, lines);
  return lines;
}

function buildLine(
  merchandiseId: string,
  quantity: number,
): CartItem | undefined {
  const match = findVariant(merchandiseId);
  if (!match) return undefined;
  const { product, variant } = match;

  return {
    id: `line_${nextLineId++}`,
    quantity,
    cost: {
      totalAmount: {
        amount: (parseFloat(variant.price.amount) * quantity).toFixed(2),
        currencyCode: variant.price.currencyCode,
      },
    },
    merchandise: {
      id: variant.id,
      title: variant.title,
      selectedOptions: variant.selectedOptions,
      product: {
        id: product.id,
        handle: product.handle,
        title: product.title,
        featuredImage: product.featuredImage,
      },
    },
  };
}

export function insertCart(): Promise<StoredCart> {
  return query("INSERT INTO carts (id) VALUES (?)", "INSERT", () => {
    const id = crypto.randomUUID();
    carts.set(id, []);
    return computeCart(id, []);
  });
}

export function selectCart(id: string): Promise<Cart | undefined> {
  return query("SELECT * FROM carts WHERE id = ?", "SELECT", () => {
    const lines = carts.get(id);
    return lines ? computeCart(id, lines) : undefined;
  });
}

export function insertCartLines(
  cartId: string,
  newLines: { merchandiseId: string; quantity: number }[],
): Promise<Cart> {
  return query(
    "INSERT INTO cart_lines (cart_id, merchandise_id, quantity) VALUES (?, ?, ?)",
    "INSERT",
    () => {
      const lines = getOrCreateLines(cartId);

      for (const { merchandiseId, quantity } of newLines) {
        const existing = lines.find(
          (line) => line.merchandise.id === merchandiseId,
        );
        const replacement = buildLine(
          merchandiseId,
          (existing?.quantity ?? 0) + quantity,
        );
        if (!replacement) continue;

        if (existing) {
          replacement.id = existing.id;
          lines[lines.indexOf(existing)] = replacement;
        } else {
          lines.push(replacement);
        }
      }

      return computeCart(cartId, lines);
    },
  );
}

export function updateCartLines(
  cartId: string,
  updates: { id: string; merchandiseId: string; quantity: number }[],
): Promise<Cart> {
  return query(
    "UPDATE cart_lines SET merchandise_id = ?, quantity = ? WHERE cart_id = ? AND id = ?",
    "UPDATE",
    () => {
      const lines = getOrCreateLines(cartId);

      for (const { id, merchandiseId, quantity } of updates) {
        const index = lines.findIndex((line) => line.id === id);
        const replacement = buildLine(merchandiseId, quantity);
        if (index === -1 || !replacement) continue;
        replacement.id = id;
        lines[index] = replacement;
      }

      return computeCart(cartId, lines);
    },
  );
}

export function deleteCartLines(
  cartId: string,
  lineIds: string[],
): Promise<Cart> {
  return query(
    "DELETE FROM cart_lines WHERE cart_id = ? AND id IN (?)",
    "DELETE",
    () => {
      const remaining = getOrCreateLines(cartId).filter(
        (line) => !lineIds.includes(line.id!),
      );
      carts.set(cartId, remaining);
      return computeCart(cartId, remaining);
    },
  );
}
