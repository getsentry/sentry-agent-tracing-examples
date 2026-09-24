// Shapes here mirror dd-cli 0.2.2's --json-output payloads. The data exists
// so the agent can run without a DoorDash account.

interface FixtureRestaurant {
  storeId: string;
  name: string;
  category: string;
  rating: number;
  reviewCount: number;
  deliveryTime: string;
  deliveryFeeUsd: number;
  distance: string;
  imageUrl: string;
}

const RESTAURANTS: FixtureRestaurant[] = [
  {
    storeId: "fx-tacos",
    name: "Taqueria Norte",
    category: "Mexican",
    rating: 4.7,
    reviewCount: 812,
    deliveryTime: "20-30 min",
    deliveryFeeUsd: 0,
    distance: "0.8 mi",
    imageUrl: "https://images.fixture.dd/fx-tacos.jpg",
  },
  {
    storeId: "fx-ramen",
    name: "Ramen Koda",
    category: "Japanese",
    rating: 4.5,
    reviewCount: 540,
    deliveryTime: "30-40 min",
    deliveryFeeUsd: 2.99,
    distance: "1.4 mi",
    imageUrl: "https://images.fixture.dd/fx-ramen.jpg",
  },
  {
    storeId: "fx-greens",
    name: "Greenhouse Bowls",
    category: "Salads",
    rating: 4.6,
    reviewCount: 365,
    deliveryTime: "15-25 min",
    deliveryFeeUsd: 1.49,
    distance: "0.5 mi",
    imageUrl: "https://images.fixture.dd/fx-greens.jpg",
  },
];

interface FixtureMenuItem {
  itemId: string;
  name: string;
  description: string;
  price: number;
  categoryName: string;
  imageUrl: string;
}

const MENUS: Record<string, FixtureMenuItem[]> = {
  "fx-tacos": [
    {
      itemId: "fx-tacos-1",
      name: "Carne Asada Tacos (3)",
      description: "Grilled steak, onion, cilantro, corn tortillas.",
      price: 12.5,
      categoryName: "Tacos",
      imageUrl: "https://images.fixture.dd/fx-tacos-1.jpg",
    },
    {
      itemId: "fx-tacos-2",
      name: "Al Pastor Burrito",
      description: "Marinated pork, pineapple, rice, beans.",
      price: 11.75,
      categoryName: "Burritos",
      imageUrl: "https://images.fixture.dd/fx-tacos-2.jpg",
    },
    {
      itemId: "fx-tacos-3",
      name: "Chicken Quesadilla",
      description: "Grilled chicken, melted cheese, flour tortilla.",
      price: 9.5,
      categoryName: "Quesadillas",
      imageUrl: "https://images.fixture.dd/fx-tacos-3.jpg",
    },
    {
      itemId: "fx-tacos-4",
      name: "Veggie Bowl",
      description: "Rice, black beans, grilled veggies, salsa verde.",
      price: 10.25,
      categoryName: "Bowls",
      imageUrl: "https://images.fixture.dd/fx-tacos-4.jpg",
    },
  ],
  "fx-ramen": [
    {
      itemId: "fx-ramen-1",
      name: "Shoyu Ramen",
      description: "Soy-based broth, chashu pork, soft egg, scallions.",
      price: 14.5,
      categoryName: "Ramen",
      imageUrl: "https://images.fixture.dd/fx-ramen-1.jpg",
    },
    {
      itemId: "fx-ramen-2",
      name: "Spicy Miso Ramen",
      description: "Miso broth, chili oil, ground pork, bean sprouts.",
      price: 15.0,
      categoryName: "Ramen",
      imageUrl: "https://images.fixture.dd/fx-ramen-2.jpg",
    },
    {
      itemId: "fx-ramen-3",
      name: "Vegetable Gyoza (6)",
      description: "Pan-fried dumplings, ponzu dipping sauce.",
      price: 9.0,
      categoryName: "Appetizers",
      imageUrl: "https://images.fixture.dd/fx-ramen-3.jpg",
    },
    {
      itemId: "fx-ramen-4",
      name: "Chicken Karaage",
      description: "Japanese fried chicken, kewpie mayo.",
      price: 11.5,
      categoryName: "Appetizers",
      imageUrl: "https://images.fixture.dd/fx-ramen-4.jpg",
    },
  ],
  "fx-greens": [
    {
      itemId: "fx-greens-1",
      name: "Harvest Grain Bowl",
      description: "Quinoa, roasted squash, kale, tahini dressing.",
      price: 12.0,
      categoryName: "Bowls",
      imageUrl: "https://images.fixture.dd/fx-greens-1.jpg",
    },
    {
      itemId: "fx-greens-2",
      name: "Southwest Salad",
      description: "Romaine, black beans, corn, avocado, lime vinaigrette.",
      price: 10.5,
      categoryName: "Salads",
      imageUrl: "https://images.fixture.dd/fx-greens-2.jpg",
    },
    {
      itemId: "fx-greens-3",
      name: "Mediterranean Bowl",
      description: "Falafel, hummus, cucumber, tomato, tzatziki.",
      price: 13.25,
      categoryName: "Bowls",
      imageUrl: "https://images.fixture.dd/fx-greens-3.jpg",
    },
    {
      itemId: "fx-greens-4",
      name: "Green Goddess Salad",
      description: "Spinach, avocado, cucumber, green goddess dressing.",
      price: 9.75,
      categoryName: "Salads",
      imageUrl: "https://images.fixture.dd/fx-greens-4.jpg",
    },
  ],
};

interface FixtureOption {
  optionId: string;
  name: string;
  priceUsd: number;
}

interface FixtureExtra {
  extraId: string;
  title: string;
  minNumOptions: number;
  maxNumOptions: number;
  numFreeOptions: number;
  options: FixtureOption[];
}

const PROTEIN_EXTRA: FixtureExtra = {
  extraId: "fx-extra-protein",
  title: "Protein",
  minNumOptions: 1,
  maxNumOptions: 1,
  numFreeOptions: 1,
  options: [
    { optionId: "fx-opt-chicken", name: "Chicken", priceUsd: 0 },
    { optionId: "fx-opt-steak", name: "Steak", priceUsd: 0 },
    { optionId: "fx-opt-shrimp", name: "Shrimp", priceUsd: 2 },
  ],
};

const SIZE_EXTRA: FixtureExtra = {
  extraId: "fx-extra-size",
  title: "Size",
  minNumOptions: 1,
  maxNumOptions: 1,
  numFreeOptions: 1,
  options: [
    { optionId: "fx-opt-regular", name: "Regular", priceUsd: 0 },
    { optionId: "fx-opt-large", name: "Large", priceUsd: 2 },
  ],
};

const OPTION_PRICES: Record<string, number> = Object.fromEntries(
  [PROTEIN_EXTRA, SIZE_EXTRA].flatMap((extra) =>
    extra.options.map((option) => [option.optionId, option.priceUsd]),
  ),
);

function extraForStore(storeId: string): FixtureExtra {
  return storeId === "fx-ramen" ? SIZE_EXTRA : PROTEIN_EXTRA;
}

function rawExtraFromFixture(extra: FixtureExtra) {
  return {
    extra_id: extra.extraId,
    title: extra.title,
    min_num_options: extra.minNumOptions,
    max_num_options: extra.maxNumOptions,
    num_free_options: extra.numFreeOptions,
    options: extra.options.map((option) => ({
      option_id: option.optionId,
      name: option.name,
      price: option.priceUsd,
    })),
  };
}

function findMenuItem(storeId: string, itemId: string): FixtureMenuItem | undefined {
  return (MENUS[storeId] ?? []).find((item) => item.itemId === itemId);
}

const DELIVERY_POINT = {
  lat: 37.7749,
  lng: -122.4194,
  printable_address: "1 Fixture Plaza, San Francisco, CA 94105",
  is_default: true,
};

interface FixtureCartLine {
  itemId: string;
  name: string;
  quantity: number;
  priceUsd: number;
}

interface FixtureCart {
  storeId: string;
  lines: FixtureCartLine[];
}

const carts = new Map<string, FixtureCart>([["fx-cart-0001", { storeId: "", lines: [] }]]);

function cartToFixtureCart(cartUuid: string) {
  const cart = carts.get(cartUuid) ?? { storeId: "", lines: [] };
  const restaurant = RESTAURANTS.find((r) => r.storeId === cart.storeId);
  return {
    id: cartUuid,
    store_id: cart.storeId,
    store_name: restaurant?.name ?? "",
    is_group_cart: false,
    group_cart_url: `https://drd.sh/cart/${cartUuid}/`,
    spend_limit_cents: null,
    items: cart.lines.map((line) => ({
      name: line.name,
      quantity: line.quantity,
      price: line.priceUsd,
    })),
    items_count: cart.lines.length,
  };
}

function flagValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

function round2(amount: number): number {
  return Math.round(amount * 100) / 100;
}

function addressListFixture(): unknown {
  return { addresses: [DELIVERY_POINT] };
}

function searchFixture(args: string[]): unknown {
  const limit = Number(flagValue(args, "--limit")) || RESTAURANTS.length;
  return {
    stores: RESTAURANTS.slice(0, limit).map((r) => ({
      store_id: r.storeId,
      name: r.name,
      image_url: r.imageUrl,
      distance: r.distance,
      delivery_time: r.deliveryTime,
      rating: r.rating,
      review_count: r.reviewCount,
      is_link_out: false,
    })),
  };
}

function menuFixture(args: string[]): unknown {
  const storeId = flagValue(args, "--store-id") ?? "";
  const restaurant = RESTAURANTS.find((r) => r.storeId === storeId);
  const items = MENUS[storeId] ?? [];
  return {
    menu_id: `fx-menu-${storeId}`,
    store_name: restaurant?.name ?? null,
    store_is_open: true,
    items: items.map((item) => ({
      item_id: item.itemId,
      name: item.name,
      description: item.description,
      image_url: item.imageUrl,
      price: item.price,
      price_varies: false,
      is_orderable: true,
      has_required_modifiers: true,
      category_name: item.categoryName,
    })),
  };
}

function itemDetailsFixture(args: string[]): unknown {
  const storeId = flagValue(args, "--store-id") ?? "";
  const itemId = flagValue(args, "--item-id") ?? "";
  const item = findMenuItem(storeId, itemId);
  if (!item) {
    throw new Error(`dd-cli fixtures: no fixture item ${itemId} for store ${storeId}`);
  }
  return {
    item: {
      item_id: item.itemId,
      name: item.name,
      description: item.description,
      image_url: item.imageUrl,
      price: item.price,
      price_varies: false,
      extras: [rawExtraFromFixture(extraForStore(storeId))],
    },
  };
}

function cartListFixture(): unknown {
  return { carts: Array.from(carts.keys()).map((cart_uuid) => ({ cart_uuid })) };
}

function cartShowFixture(args: string[]): unknown {
  const cartUuid = flagValue(args, "--cart-uuid") ?? "";
  if (!carts.has(cartUuid)) carts.set(cartUuid, { storeId: "", lines: [] });
  return { cart: cartToFixtureCart(cartUuid) };
}

interface FixtureCartAddOption {
  id: string;
  quantity?: number;
  options?: FixtureCartAddOption[];
}

interface FixtureCartAddItem {
  item_id: string;
  item_name?: string;
  quantity?: number;
  nested_options?: FixtureCartAddOption[];
}

function optionsTotalUsd(options: FixtureCartAddOption[] | undefined): number {
  return (options ?? []).reduce((sum, option) => {
    const subtotal = (OPTION_PRICES[option.id] ?? 0) + optionsTotalUsd(option.options);
    return sum + subtotal * (option.quantity ?? 1);
  }, 0);
}

function cartAddFixture(args: string[]): unknown {
  const storeId = flagValue(args, "--store-id") ?? "";
  const cartUuid = flagValue(args, "--cart-uuid") ?? "fx-cart-0001";
  const itemsJson = flagValue(args, "--items-json") ?? "[]";
  const requested = JSON.parse(itemsJson) as FixtureCartAddItem[];

  const itemErrors: unknown[] = [];
  const newLines: FixtureCartLine[] = [];
  for (const requestedItem of requested) {
    const menuItem = findMenuItem(storeId, requestedItem.item_id);
    if (!menuItem) {
      itemErrors.push({
        item_id: requestedItem.item_id,
        reason: "not_found",
        message: `No item ${requestedItem.item_id} on this menu.`,
      });
      continue;
    }
    newLines.push({
      itemId: menuItem.itemId,
      name: requestedItem.item_name ?? menuItem.name,
      quantity: requestedItem.quantity ?? 1,
      priceUsd: menuItem.price + optionsTotalUsd(requestedItem.nested_options),
    });
  }

  if (itemErrors.length > 0) {
    return {
      success: false,
      item_errors: itemErrors,
      message: "One or more items could not be added.",
      cart_uuid: cartUuid,
      cart: cartToFixtureCart(cartUuid),
    };
  }

  const cart = carts.get(cartUuid) ?? { storeId, lines: [] };
  cart.storeId = storeId;
  cart.lines.push(...newLines);
  carts.set(cartUuid, cart);

  return {
    success: true,
    item_errors: [],
    message: null,
    cart_uuid: cartUuid,
    cart: cartToFixtureCart(cartUuid),
  };
}

function orderPreviewFixture(args: string[]): unknown {
  const cartUuid = flagValue(args, "--cart-uuid") ?? "";
  const cart = carts.get(cartUuid) ?? { storeId: "", lines: [] };
  const restaurant = RESTAURANTS.find((r) => r.storeId === cart.storeId);
  const subtotal = round2(
    cart.lines.reduce((sum, line) => sum + line.priceUsd * line.quantity, 0),
  );
  const deliveryFee = restaurant?.deliveryFeeUsd ?? 0;
  const serviceFee = round2(subtotal * 0.15);
  const tax = round2(subtotal * 0.08625);

  const line = (label: string, amountUsd: number) => ({
    charge_id: label.toLowerCase().replace(/\s+/g, "_"),
    label,
    final_money: {
      unit_amount: Math.round(amountUsd * 100),
      currency: "USD",
      display_string: `$${amountUsd.toFixed(2)}`,
    },
  });

  return {
    error_message: null,
    quote: {
      line_items: [
        line("Subtotal", subtotal),
        line("Delivery Fee", deliveryFee),
        line("Service Fee", serviceFee),
        line("Tax", tax),
      ],
    },
    eta: "25-35 min",
  };
}

function checkoutUrlFixture(args: string[]): unknown {
  const cartUuid = flagValue(args, "--cart-uuid") ?? "";
  return { checkout_url: `https://drd.sh/cart/${cartUuid}/checkout`, url: null };
}

export function fixtureResult(args: string[]): unknown {
  const [cmd, sub] = args;
  if (cmd === "address" && sub === "list") return addressListFixture();
  if (cmd === "search") return searchFixture(args);
  if (cmd === "menu") return menuFixture(args);
  if (cmd === "restaurant-item-details") return itemDetailsFixture(args);
  if (cmd === "cart" && sub === "list") return cartListFixture();
  if (cmd === "cart" && sub === "show") return cartShowFixture(args);
  if (cmd === "cart" && sub === "add-items") return cartAddFixture(args);
  if (cmd === "order" && sub === "preview") return orderPreviewFixture(args);
  if (cmd === "order" && sub === "checkout-url") return checkoutUrlFixture(args);
  throw new Error(`dd-cli fixtures: no fixture for ${args.join(" ")}`);
}
