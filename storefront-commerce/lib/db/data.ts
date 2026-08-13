import type {
  Collection,
  Customer,
  Menu,
  Order,
  OrderLine,
  Page,
  Product,
} from "lib/commerce/types";

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

export type MenuHandle =
  "next-js-frontend-header-menu" | "next-js-frontend-footer-menu";

export const MENUS = {
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
} satisfies Record<MenuHandle, Menu[]>;

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

// One customer row per shopper in lib/demo-user. The chat route resolves which
// one a request belongs to, so getAccountInfo and refundOrder answer with that
// shopper's own orders.
export const CUSTOMERS: Customer[] = [
  {
    id: "cust_01",
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada@example.com",
    memberSince: "2024-03-12",
    loyalty: { tier: "Gold", points: 2450 },
  },
  {
    id: "cust_02",
    firstName: "Grace",
    lastName: "Hopper",
    email: "grace@example.com",
    memberSince: "2023-09-30",
    loyalty: { tier: "Platinum", points: 5120 },
  },
  {
    id: "cust_03",
    firstName: "Alan",
    lastName: "Turing",
    email: "alan@example.com",
    memberSince: "2025-06-23",
    loyalty: { tier: "Silver", points: 780 },
  },
  {
    id: "cust_04",
    firstName: "Katherine",
    lastName: "Johnson",
    email: "katherine@example.com",
    memberSince: "2024-08-26",
    loyalty: { tier: "Gold", points: 1890 },
  },
  {
    id: "cust_05",
    firstName: "Radia",
    lastName: "Perlman",
    email: "radia@example.com",
    memberSince: "2026-02-14",
    loyalty: { tier: "Bronze", points: 210 },
  },
  {
    id: "cust_06",
    firstName: "Shafi",
    lastName: "Goldwasser",
    email: "shafi@example.com",
    memberSince: "2025-01-08",
    loyalty: { tier: "Silver", points: 640 },
  },
];

export type Payment = {
  orderId: string;
  chargeId: string;
  brand: string;
  last4: string;
};

function line(
  handle: string,
  quantity: number,
  variantTitle?: string,
): OrderLine {
  const item = PRODUCTS.find((p) => p.handle === handle)!;
  return {
    productHandle: handle,
    title: item.title,
    variantTitle: variantTitle ?? "Default Title",
    quantity,
    price: item.priceRange.minVariantPrice,
  };
}

function order(seed: Omit<Order, "total">): Order {
  const total = seed.lines.reduce(
    (sum, l) => sum + Number(l.price.amount) * l.quantity,
    0,
  );
  return {
    ...seed,
    total: { amount: total.toFixed(2), currencyCode: CURRENCY },
  };
}

export const ORDERS: Order[] = [
  order({
    id: "1042",
    customerId: "cust_01",
    createdAt: "2026-07-28T14:32:00.000Z",
    status: "In transit",
    lines: [line("acme-hoodie", 1, "M"), line("acme-sticker-pack", 2)],
  }),
  order({
    id: "1036",
    customerId: "cust_01",
    createdAt: "2026-06-14T09:05:00.000Z",
    status: "Delivered",
    lines: [line("acme-desk-mat", 1), line("acme-mug", 1)],
  }),
  order({
    id: "1029",
    customerId: "cust_01",
    createdAt: "2026-05-02T18:47:00.000Z",
    status: "Delivered",
    lines: [line("acme-circles-tee", 2, "S")],
  }),
  order({
    id: "1051",
    customerId: "cust_02",
    createdAt: "2026-08-04T11:12:00.000Z",
    status: "Processing",
    lines: [line("acme-keycap-set", 1), line("acme-desk-mat", 1)],
  }),
  order({
    id: "1044",
    customerId: "cust_02",
    createdAt: "2026-07-19T16:40:00.000Z",
    status: "Delivered",
    lines: [line("acme-crewneck", 1, "L"), line("acme-socks", 3)],
  }),
  order({
    id: "1031",
    customerId: "cust_02",
    createdAt: "2026-05-21T08:15:00.000Z",
    status: "Delivered",
    lines: [line("acme-water-bottle", 2), line("acme-notebook", 1)],
  }),
  order({
    id: "1049",
    customerId: "cust_03",
    createdAt: "2026-08-01T19:03:00.000Z",
    status: "In transit",
    lines: [line("acme-cap", 1), line("acme-tote-bag", 1)],
  }),
  order({
    id: "1033",
    customerId: "cust_03",
    createdAt: "2026-05-30T13:28:00.000Z",
    status: "Delivered",
    lines: [line("acme-mug", 2)],
  }),
  order({
    id: "1053",
    customerId: "cust_04",
    createdAt: "2026-08-08T07:55:00.000Z",
    status: "Processing",
    lines: [line("acme-hoodie", 1, "S"), line("acme-notebook", 2)],
  }),
  order({
    id: "1046",
    customerId: "cust_04",
    createdAt: "2026-07-22T15:19:00.000Z",
    status: "Delivered",
    lines: [line("acme-desk-mat", 1), line("acme-keycap-set", 1)],
  }),
  order({
    id: "1027",
    customerId: "cust_04",
    createdAt: "2026-04-11T10:02:00.000Z",
    status: "Delivered",
    lines: [line("acme-circles-tee", 1, "M"), line("acme-socks", 2)],
  }),
  order({
    id: "1050",
    customerId: "cust_05",
    createdAt: "2026-08-02T20:41:00.000Z",
    status: "Delivered",
    lines: [line("acme-sticker-pack", 3)],
  }),
  order({
    id: "1026",
    customerId: "cust_05",
    createdAt: "2026-03-27T12:36:00.000Z",
    status: "Delivered",
    lines: [line("acme-tote-bag", 1), line("acme-mug", 1)],
  }),
  order({
    id: "1052",
    customerId: "cust_06",
    createdAt: "2026-08-06T09:47:00.000Z",
    status: "In transit",
    lines: [line("acme-water-bottle", 1), line("acme-cap", 1)],
  }),
  order({
    id: "1030",
    customerId: "cust_06",
    createdAt: "2026-05-09T17:24:00.000Z",
    status: "Delivered",
    lines: [line("acme-crewneck", 1, "M")],
  }),
];

// Payment records exist only for orders placed after the payments system
// launched in June 2026 — the backfill for older orders never ran. That gap is
// the demo's planted bug: with no row to charge against, the assistant's
// refundOrder tool fails on any pre-June order, whichever shopper asks.
export const PAYMENTS: Payment[] = [
  {
    orderId: "1042",
    chargeId: "ch_8kF3q9Lm2Xw7",
    brand: "visa",
    last4: "4242",
  },
  {
    orderId: "1036",
    chargeId: "ch_5Rp1t8Kn4Yv2",
    brand: "mastercard",
    last4: "5100",
  },
  {
    orderId: "1051",
    chargeId: "ch_2Wq7v4Hs9Cd1",
    brand: "visa",
    last4: "1881",
  },
  {
    orderId: "1044",
    chargeId: "ch_6Ln3b8Mk5Tz4",
    brand: "amex",
    last4: "0005",
  },
  {
    orderId: "1049",
    chargeId: "ch_9Dx4m2Pw7Rb8",
    brand: "visa",
    last4: "7702",
  },
  {
    orderId: "1053",
    chargeId: "ch_3Ky8n5Vt2Qh6",
    brand: "mastercard",
    last4: "3399",
  },
  {
    orderId: "1046",
    chargeId: "ch_7Fs2j9Ln4Wg3",
    brand: "visa",
    last4: "6410",
  },
  {
    orderId: "1050",
    chargeId: "ch_4Hb6r3Zx8Nm2",
    brand: "visa",
    last4: "2255",
  },
  {
    orderId: "1052",
    chargeId: "ch_1Tq5w7Gd3Jp9",
    brand: "mastercard",
    last4: "8813",
  },
];
