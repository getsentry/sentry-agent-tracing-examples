// Branding falls back to the demo defaults so builds work without any env.
export const SITE_NAME = process.env.SITE_NAME ?? "Acme Store";
export const COMPANY_NAME = process.env.COMPANY_NAME ?? "Acme, Inc.";

// The `?sort=` values the search pages accept. Named here so the URL parser
// in lib/search-params and this table cannot drift apart.
export const SORT_SLUGS = [
  "trending-desc",
  "latest-desc",
  "price-asc",
  "price-desc",
] as const;

export type SortSlug = (typeof SORT_SLUGS)[number];

export type SortFilterItem = {
  title: string;
  slug: SortSlug | null;
  sortKey: "RELEVANCE" | "BEST_SELLING" | "CREATED_AT" | "PRICE";
  reverse: boolean;
};

export const defaultSort: SortFilterItem = {
  title: "Relevance",
  slug: null,
  sortKey: "RELEVANCE",
  reverse: false,
};

export const sorting: SortFilterItem[] = [
  defaultSort,
  {
    title: "Trending",
    slug: "trending-desc",
    sortKey: "BEST_SELLING",
    reverse: false,
  },
  {
    title: "Latest arrivals",
    slug: "latest-desc",
    sortKey: "CREATED_AT",
    reverse: true,
  },
  {
    title: "Price: Low to high",
    slug: "price-asc",
    sortKey: "PRICE",
    reverse: false,
  },
  {
    title: "Price: High to low",
    slug: "price-desc",
    sortKey: "PRICE",
    reverse: true,
  },
];

export const TAGS = {
  collections: "collections",
  products: "products",
  cart: "cart",
};

export const HIDDEN_PRODUCT_TAG = "nextjs-frontend-hidden";
export const DEFAULT_OPTION = "Default Title";
