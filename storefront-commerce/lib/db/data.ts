import type {
  Collection,
  Customer,
  Order,
  Page,
  Product,
} from "lib/commerce/types";
import { DEMO_USER } from "lib/demo-user";

export type ProductRow = Product & {
  collections: string[];
  bestSellingRank: number;
  createdAt: string;
};

type ProductSeed = {
  id: string;
  handle: string;
  title: string;
  price: number;
  description: string;
  collections: string[];
  bestSellingRank: number;
  createdAt: string;
  sizes?: string[];
  imageCount?: number;
  tags?: string[];
};

const CURRENCY = "USD";

function product(seed: ProductSeed): ProductRow {
  const amount = seed.price.toFixed(2);
  const money = { amount, currencyCode: CURRENCY };
  const images = Array.from({ length: seed.imageCount ?? 1 }, (_, i) => ({
    url: `/products/${seed.handle}${i === 0 ? "" : `-${i + 1}`}.jpg`,
    altText: seed.title,
    width: 1200,
    height: 1200,
  }));

  const variants = seed.sizes
    ? seed.sizes.map((size) => ({
        id: `${seed.handle}-${size.toLowerCase()}`,
        title: size,
        availableForSale: true,
        selectedOptions: [{ name: "Size", value: size }],
        price: money,
      }))
    : [
        {
          id: `${seed.handle}-default`,
          title: "Default Title",
          availableForSale: true,
          selectedOptions: [{ name: "Title", value: "Default Title" }],
          price: money,
        },
      ];

  return {
    id: seed.id,
    handle: seed.handle,
    availableForSale: true,
    title: seed.title,
    description: seed.description,
    descriptionHtml: `<p>${seed.description}</p>`,
    options: seed.sizes
      ? [{ id: "size", name: "Size", values: seed.sizes }]
      : [],
    priceRange: { maxVariantPrice: money, minVariantPrice: money },
    variants,
    featuredImage: images[0]!,
    images,
    seo: { title: seed.title, description: seed.description },
    tags: seed.tags ?? [],
    updatedAt: "2026-08-01T00:00:00.000Z",
    collections: seed.collections,
    bestSellingRank: seed.bestSellingRank,
    createdAt: seed.createdAt,
  };
}

export const PRODUCTS: ProductRow[] = [
  product({
    id: "prod_01",
    handle: "acme-circles-tee",
    title: "Acme Circles T-Shirt",
    price: 20,
    description:
      "60% combed ringspun cotton, 40% polyester jersey tee with the classic Acme circles across the chest.",
    collections: ["apparel", "hidden-homepage-featured-items"],
    bestSellingRank: 1,
    createdAt: "2026-05-04T00:00:00.000Z",
    sizes: ["XS", "S", "M", "L", "XL"],
    imageCount: 2,
    tags: ["t-shirt", "cotton", "unisex"],
  }),
  product({
    id: "prod_02",
    handle: "acme-hoodie",
    title: "Acme Hoodie",
    price: 50,
    description:
      "Heavyweight fleece hoodie with a double-lined hood, front pouch pocket, and embroidered Acme circles.",
    collections: ["apparel", "hidden-homepage-featured-items"],
    bestSellingRank: 2,
    createdAt: "2026-04-18T00:00:00.000Z",
    sizes: ["S", "M", "L", "XL"],
    tags: ["hoodie", "fleece", "unisex"],
  }),
  product({
    id: "prod_03",
    handle: "acme-mug",
    title: "Acme Mug",
    price: 15,
    description:
      "12oz ceramic mug with a matte finish and a glossy Acme circles print. Dishwasher and microwave safe.",
    collections: ["desk", "hidden-homepage-featured-items"],
    bestSellingRank: 3,
    createdAt: "2026-03-02T00:00:00.000Z",
    tags: ["mug", "ceramic", "kitchen"],
  }),
  product({
    id: "prod_04",
    handle: "acme-cap",
    title: "Acme Cap",
    price: 22,
    description:
      "Six-panel unstructured dad cap in washed cotton twill with an adjustable strap and stitched circles logo.",
    collections: ["apparel", "hidden-homepage-carousel"],
    bestSellingRank: 6,
    createdAt: "2026-06-10T00:00:00.000Z",
    tags: ["cap", "hat"],
  }),
  product({
    id: "prod_05",
    handle: "acme-crewneck",
    title: "Acme Crewneck",
    price: 40,
    description:
      "Midweight loopback crewneck sweatshirt with ribbed cuffs and a tonal Acme circles chest print.",
    collections: ["apparel", "hidden-homepage-carousel"],
    bestSellingRank: 7,
    createdAt: "2026-06-24T00:00:00.000Z",
    sizes: ["S", "M", "L", "XL"],
    tags: ["sweatshirt", "crewneck", "unisex"],
  }),
  product({
    id: "prod_06",
    handle: "acme-socks",
    title: "Acme Socks",
    price: 10,
    description:
      "Ribbed crew socks in combed cotton with a knitted circles motif at the ankle. One pair per pack.",
    collections: ["apparel"],
    bestSellingRank: 5,
    createdAt: "2026-02-14T00:00:00.000Z",
    tags: ["socks", "cotton"],
  }),
  product({
    id: "prod_07",
    handle: "acme-water-bottle",
    title: "Acme Water Bottle",
    price: 18,
    description:
      "25oz double-wall insulated stainless steel bottle that keeps drinks cold for 24 hours. Leakproof lid.",
    collections: ["accessories", "hidden-homepage-carousel"],
    bestSellingRank: 8,
    createdAt: "2026-01-20T00:00:00.000Z",
    tags: ["bottle", "insulated", "steel"],
  }),
  product({
    id: "prod_08",
    handle: "acme-tote-bag",
    title: "Acme Tote Bag",
    price: 16,
    description:
      "Heavy canvas tote with reinforced handles and an interior pocket. Fits a 16-inch laptop with room to spare.",
    collections: ["accessories", "hidden-homepage-carousel"],
    bestSellingRank: 4,
    createdAt: "2026-03-30T00:00:00.000Z",
    tags: ["tote", "bag", "canvas"],
  }),
  product({
    id: "prod_09",
    handle: "acme-sticker-pack",
    title: "Acme Sticker Pack",
    price: 8,
    description:
      "Five die-cut vinyl stickers featuring the Acme circles in assorted colorways. Weatherproof and laptop-ready.",
    collections: ["accessories"],
    bestSellingRank: 9,
    createdAt: "2026-05-22T00:00:00.000Z",
    tags: ["stickers", "vinyl"],
  }),
  product({
    id: "prod_10",
    handle: "acme-notebook",
    title: "Acme Notebook",
    price: 12,
    description:
      "A5 dot-grid notebook with 160 pages of 100gsm paper, lay-flat binding, and an elastic closure.",
    collections: ["desk"],
    bestSellingRank: 10,
    createdAt: "2026-04-05T00:00:00.000Z",
    tags: ["notebook", "stationery"],
  }),
  product({
    id: "prod_11",
    handle: "acme-desk-mat",
    title: "Acme Desk Mat",
    price: 28,
    description:
      "900x400mm vegan leather desk mat with a non-slip base and a subtle debossed circles mark in the corner.",
    collections: ["desk", "hidden-homepage-carousel"],
    bestSellingRank: 11,
    createdAt: "2026-07-01T00:00:00.000Z",
    tags: ["desk", "mat"],
  }),
  product({
    id: "prod_12",
    handle: "acme-keycap-set",
    title: "Acme Keycap Set",
    price: 45,
    description:
      "PBT dye-sub keycap set in the Acme colorway, Cherry profile, with coverage for 65% through full-size boards.",
    collections: ["desk", "hidden-homepage-carousel"],
    bestSellingRank: 12,
    createdAt: "2026-07-15T00:00:00.000Z",
    tags: ["keycaps", "keyboard", "pbt"],
  }),
];

function collection(
  handle: string,
  title: string,
  description: string,
): Collection {
  return {
    handle,
    title,
    description,
    seo: { title, description },
    updatedAt: "2026-08-01T00:00:00.000Z",
    path: `/search/${handle}`,
  };
}

export const COLLECTIONS: Collection[] = [
  collection("apparel", "Apparel", "Tees, hoodies, and everything wearable."),
  collection("accessories", "Accessories", "Bags, bottles, and stickers."),
  collection("desk", "Desk", "Gear for your workspace."),
  // `hidden-*` collections drive the homepage grid and carousel and are
  // filtered out of the search sidebar, mirroring the upstream template.
  collection(
    "hidden-homepage-featured-items",
    "Homepage featured items",
    "Products shown in the homepage hero grid.",
  ),
  collection(
    "hidden-homepage-carousel",
    "Homepage carousel",
    "Products shown in the homepage carousel.",
  ),
];

export const MENUS: Record<string, { title: string; path: string }[]> = {
  "next-js-frontend-header-menu": [
    { title: "All", path: "/search" },
    { title: "Apparel", path: "/search/apparel" },
    { title: "Accessories", path: "/search/accessories" },
    { title: "Desk", path: "/search/desk" },
  ],
  "next-js-frontend-footer-menu": [
    { title: "Home", path: "/" },
    { title: "About", path: "/about" },
    { title: "FAQ", path: "/faq" },
    { title: "Shipping & Returns", path: "/shipping-returns" },
  ],
};

function page(
  handle: string,
  title: string,
  summary: string,
  body: string,
): Page {
  return {
    id: `page_${handle}`,
    title,
    handle,
    body,
    bodySummary: summary,
    seo: { title, description: summary },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

export const PAGES: Page[] = [
  page(
    "about",
    "About",
    "Acme Store is a demo storefront instrumented with Sentry.",
    `<p>Acme Store is a fictional storefront built on the Next.js Commerce template. Every product, order, and customer here lives in an in-memory database seeded at boot.</p>
     <p>The interesting part is invisible: the AI shopping assistant and the data layer are instrumented with Sentry, so every chat turn produces a full agent trace &mdash; model calls, tool executions, and the database queries underneath them.</p>`,
  ),
  page(
    "faq",
    "FAQ",
    "Frequently asked questions about the Acme Store demo.",
    `<h3>Is anything for sale?</h3>
     <p>No. Checkout is a stub &mdash; the cart works, but no money changes hands.</p>
     <h3>Where does the product data come from?</h3>
     <p>An in-memory catalog with simulated query latency. Each read is wrapped in a Sentry <code>db.query</code> span so traces look like a real database is involved.</p>
     <h3>What should I try?</h3>
     <p>Open the shopping assistant (bottom-right) and ask for gift ideas or your recent orders, then look at the trace in Sentry.</p>`,
  ),
  page(
    "shipping-returns",
    "Shipping & Returns",
    "Shipping and returns policy for the demo store.",
    `<p>Orders ship nowhere, arrive instantly, and can be returned by refreshing the page. Such is the life of demo data.</p>`,
  ),
];

// The one signed-in demo customer the assistant's getAccountInfo tool reads.
export const DEMO_CUSTOMER_ID = DEMO_USER.id;

export const CUSTOMERS: Customer[] = [
  {
    id: DEMO_CUSTOMER_ID,
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada@example.com",
    memberSince: "2024-03-12",
    loyalty: { tier: "Gold", points: 2450 },
  },
];

export type Payment = {
  orderId: string;
  chargeId: string;
  brand: string;
  last4: string;
};

// Payment records exist only for orders placed after the payments system
// launched in June 2026 — the backfill for older orders never ran. That gap
// is the demo's planted bug: refunding a pre-June order (1029) crashes the
// assistant's refundOrder tool on the missing row.
export const PAYMENTS: Payment[] = [
  { orderId: "1042", chargeId: "ch_8kF3q9Lm2Xw7", brand: "visa", last4: "4242" },
  { orderId: "1036", chargeId: "ch_5Rp1t8Kn4Yv2", brand: "mastercard", last4: "5100" },
];

export const ORDERS: Order[] = [
  {
    id: "1042",
    customerId: DEMO_CUSTOMER_ID,
    createdAt: "2026-07-28T14:32:00.000Z",
    status: "In transit",
    lines: [
      {
        productHandle: "acme-hoodie",
        title: "Acme Hoodie",
        variantTitle: "M",
        quantity: 1,
        price: { amount: "50.00", currencyCode: CURRENCY },
      },
      {
        productHandle: "acme-sticker-pack",
        title: "Acme Sticker Pack",
        variantTitle: "Default Title",
        quantity: 2,
        price: { amount: "8.00", currencyCode: CURRENCY },
      },
    ],
    total: { amount: "66.00", currencyCode: CURRENCY },
  },
  {
    id: "1036",
    customerId: DEMO_CUSTOMER_ID,
    createdAt: "2026-06-14T09:05:00.000Z",
    status: "Delivered",
    lines: [
      {
        productHandle: "acme-desk-mat",
        title: "Acme Desk Mat",
        variantTitle: "Default Title",
        quantity: 1,
        price: { amount: "28.00", currencyCode: CURRENCY },
      },
      {
        productHandle: "acme-mug",
        title: "Acme Mug",
        variantTitle: "Default Title",
        quantity: 1,
        price: { amount: "15.00", currencyCode: CURRENCY },
      },
    ],
    total: { amount: "43.00", currencyCode: CURRENCY },
  },
  {
    id: "1029",
    customerId: DEMO_CUSTOMER_ID,
    createdAt: "2026-05-02T18:47:00.000Z",
    status: "Delivered",
    lines: [
      {
        productHandle: "acme-circles-tee",
        title: "Acme Circles T-Shirt",
        variantTitle: "S",
        quantity: 2,
        price: { amount: "20.00", currencyCode: CURRENCY },
      },
    ],
    total: { amount: "40.00", currencyCode: CURRENCY },
  },
];
