import { TAGS } from "lib/constants";
import * as db from "lib/db";
import { cacheLife, cacheTag } from "next/cache";
import { cookies } from "next/headers";
import { Cart, Collection, Menu, Page, Product } from "./types";

// Same public API the template's Shopify provider exposed, backed by the
// in-memory database in lib/db instead of the Shopify Storefront API.

export async function createCart(): Promise<Cart> {
  return db.insertCart();
}

export async function addToCart(
  lines: { merchandiseId: string; quantity: number }[],
): Promise<Cart> {
  const cartId = (await cookies()).get("cartId")?.value!;
  return db.insertCartLines(cartId, lines);
}

export async function removeFromCart(lineIds: string[]): Promise<Cart> {
  const cartId = (await cookies()).get("cartId")?.value!;
  return db.deleteCartLines(cartId, lineIds);
}

export async function updateCart(
  lines: { id: string; merchandiseId: string; quantity: number }[],
): Promise<Cart> {
  const cartId = (await cookies()).get("cartId")?.value!;
  return db.updateCartLines(cartId, lines);
}

export async function getCart(): Promise<Cart | undefined> {
  "use cache: private";
  cacheTag(TAGS.cart);
  cacheLife("seconds");

  const cartId = (await cookies()).get("cartId")?.value;

  if (!cartId) {
    return undefined;
  }

  return db.selectCart(cartId);
}

export async function getCollection(
  handle: string,
): Promise<Collection | undefined> {
  "use cache";
  cacheTag(TAGS.collections);
  cacheLife("days");

  return db.selectCollection(handle);
}

export async function getCollectionProducts({
  collection,
  reverse,
  sortKey,
}: {
  collection: string;
  reverse?: boolean;
  sortKey?: string;
}): Promise<Product[]> {
  "use cache";
  cacheTag(TAGS.collections, TAGS.products);
  cacheLife("days");

  return db.selectProductsByCollection(collection, { sortKey, reverse });
}

export async function getCollections(): Promise<Collection[]> {
  "use cache";
  cacheTag(TAGS.collections);
  cacheLife("days");

  const collections = await db.selectCollections();

  return [
    {
      handle: "",
      title: "All",
      description: "All products",
      seo: {
        title: "All",
        description: "All products",
      },
      path: "/search",
      updatedAt: new Date().toISOString(),
    },
    // Collections that start with `hidden-*` only feed the homepage.
    ...collections.filter(
      (collection) => !collection.handle.startsWith("hidden"),
    ),
  ];
}

export async function getMenu(handle: string): Promise<Menu[]> {
  "use cache";
  cacheTag(TAGS.collections);
  cacheLife("days");

  return db.selectMenu(handle);
}

export async function getPage(handle: string): Promise<Page | undefined> {
  "use cache";
  cacheLife("days");

  return db.selectPage(handle);
}

export async function getPages(): Promise<Page[]> {
  "use cache";
  cacheLife("days");

  return db.selectPages();
}

export async function getProduct(handle: string): Promise<Product | undefined> {
  "use cache";
  cacheTag(TAGS.products);
  cacheLife("days");

  return db.selectProduct(handle);
}

export async function getProductRecommendations(
  productId: string,
): Promise<Product[]> {
  "use cache";
  cacheTag(TAGS.products);
  cacheLife("days");

  return db.selectRecommendations(productId);
}

export async function getProducts({
  query,
  reverse,
  sortKey,
}: {
  query?: string;
  reverse?: boolean;
  sortKey?: string;
}): Promise<Product[]> {
  "use cache";
  cacheTag(TAGS.products);
  cacheLife("days");

  return db.selectProducts({ search: query, sortKey, reverse });
}
