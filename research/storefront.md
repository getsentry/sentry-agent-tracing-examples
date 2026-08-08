# Research: Next.js Commerce + AI SDK v7 + AI Elements + OpenRouter + Sentry

Research date: 2026-08-07. All package versions checked against npm on this date.
All code snippets are copied verbatim from official docs / repos unless marked
"(adapted)". Sources: github.com/vercel/commerce (cloned at commit `3761e52e`,
2026-06-10), raw MDX from github.com/vercel/ai (main = v7.0.56 docs),
github.com/vercel/ai-elements, docs.sentry.io (.md endpoints), nextjs.org/docs
(v16.3.0), OpenRouterTeam/ai-sdk-provider README, unpkg type definitions.

---

## 0. Version matrix (verified via `npm view` on 2026-08-07)

| Package | Version | Notes |
|---|---|---|
| `next` | **16.3.0** | Upgrade target for the template (see §1.6 — the template pins `15.6.0-canary.60` which breaks npm peer resolution) |
| `react` / `react-dom` | **19.2.8** | Template pins 19.0.0 — must bump (see gotchas) |
| `@types/react` | 19.2.18 | |
| `ai` | **7.0.56** | AI SDK v7. `engines.node >= 22` |
| `@ai-sdk/react` | **4.0.59** | Depends on `ai@7.0.56` exactly. Peer: `react ^18 \|\| ~19.0.1 \|\| ~19.1.2 \|\| ^19.2.1` |
| `zod` | **4.4.3** | `ai` peer allows `^3.25.76 \|\| ^4.1.8` |
| `@openrouter/ai-sdk-provider` | **3.0.0** | Peer: `ai ^7.0.0`, `zod ^3.25.76 \|\| ^4.1.8`. ESM-only, Node 22+ |
| `@sentry/nextjs` | **10.69.0** | Peer: `next ^13.2.0 \|\| ^14.0 \|\| ^15.0.0-rc.0 \|\| ^16.0.0-0` |
| `ai-elements` (CLI) | 1.9.0 | Thin wrapper over `shadcn add` (see §3.2) |
| `streamdown` | 2.5.0 | Pulled in by AI Elements `message` component |
| `use-stick-to-bottom` | 1.1.6 | Pulled in by `conversation` component |

Environment: Node v24.19.0 satisfies everything. Use **npm** in the demo dir
(standalone project, not part of the parent pnpm workspace).

---

## 1. Next.js Commerce template (`vercel/commerce`)

### 1.1 Acquisition (non-interactive)

```bash
git clone --depth 1 https://github.com/vercel/commerce.git storefront
rm -rf storefront/.git storefront/pnpm-lock.yaml
```

License: **MIT** (`license.md`, "Copyright (c) 2025 Vercel, Inc.") — free to
vendor and modify. Latest commit at research time: `3761e52e` (2026-06-10,
"Use the Shopify integration in this template").

### 1.2 Stack as shipped

`package.json` (verbatim, dependencies only):

```json
{
  "dependencies": {
    "@headlessui/react": "^2.2.0",
    "@heroicons/react": "^2.2.0",
    "clsx": "^2.1.1",
    "geist": "^1.3.1",
    "next": "15.6.0-canary.60",
    "react": "19.0.0",
    "react-dom": "19.0.0",
    "sonner": "^2.0.1"
  },
  "devDependencies": {
    "@tailwindcss/container-queries": "^0.1.1",
    "@tailwindcss/postcss": "^4.0.14",
    "@tailwindcss/typography": "^0.5.16",
    "@types/node": "22.13.10",
    "@types/react": "19.0.12",
    "@types/react-dom": "19.0.4",
    "postcss": "^8.5.3",
    "prettier": "3.5.3",
    "prettier-plugin-tailwindcss": "^0.6.11",
    "tailwindcss": "^4.0.14",
    "typescript": "5.8.2"
  }
}
```

- **Tailwind CSS v4** (CSS-first config via `@tailwindcss/postcss`; no
  `tailwind.config.*` file). `postcss.config.mjs` is just
  `plugins: { "@tailwindcss/postcss": {} }`.
- Package manager upstream: pnpm (there is a `pnpm-lock.yaml`; delete it and
  use npm for the demo).
- No test suite (`"test": "pnpm prettier:check"`), Prettier only.
- `next.config.ts` (verbatim):

```ts
export default {
  experimental: {
    ppr: true,
    inlineCss: true,
    useCache: true,
  },
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "cdn.shopify.com",
        pathname: "/s/files/**",
      },
    ],
  },
};
```

- `tsconfig.json` uses `"baseUrl": "."` and **no path aliases** — imports look
  like `import { getProducts } from "lib/shopify"` and
  `import Grid from "components/grid"`. There is **no `@/` alias** (needed
  later for AI Elements; see §3.4). `"moduleResolution": "node"`, `strict`,
  `noUncheckedIndexedAccess`.

### 1.3 Env vars (`.env.example`, verbatim)

```
COMPANY_NAME="Vercel Inc."
SITE_NAME="Next.js Commerce"
SHOPIFY_REVALIDATION_SECRET=""
SHOPIFY_STOREFRONT_ACCESS_TOKEN=""
SHOPIFY_STORE_DOMAIN="[your-shopify-store-subdomain].myshopify.com"
```

`SITE_NAME` is read in `app/layout.tsx` metadata (`SITE_NAME!` — non-null
asserted, so keep it set). `COMPANY_NAME` is used in the footer.
The three `SHOPIFY_*` vars die with the mock provider.

### 1.4 The data layer — the single seam to swap

**Everything commerce-related flows through `lib/shopify` (`lib/shopify/index.ts`
+ `lib/shopify/types.ts`).** The UI never talks to Shopify directly. Replacing
this one module (keeping names, signatures and re-exported types identical)
leaves every component untouched.

Files that import from `"lib/shopify"`:

| File | Imports |
|---|---|
| `app/layout.tsx` | `getCart` |
| `app/sitemap.ts` | `getCollections, getPages, getProducts` |
| `app/product/[handle]/page.tsx` | `getProduct, getProductRecommendations` |
| `app/search/page.tsx` | `getProducts` |
| `app/search/[collection]/page.tsx` | `getCollection, getCollectionProducts` |
| `app/search/[collection]/opengraph-image.tsx` | `getCollection` |
| `app/[page]/page.tsx`, `app/[page]/opengraph-image.tsx` | `getPage` |
| `app/api/revalidate/route.ts` | `revalidate` |
| `components/carousel.tsx` | `getCollectionProducts` |
| `components/grid/three-items.tsx` | `getCollectionProducts` |
| `components/layout/footer.tsx`, `components/layout/navbar/index.tsx` | `getMenu` |
| `components/layout/search/collections.tsx` | `getCollections` |
| `components/cart/actions.ts` | `addToCart, createCart, getCart, removeFromCart, updateCart` |

Components also import `Product`, `Cart`, `CartItem`, `ProductVariant`,
`Collection`, `Menu`, `Page`, `Image`, `Money` types from
`lib/shopify/types`.

#### Complete public function contract (exact signatures from `lib/shopify/index.ts`)

```ts
export async function createCart(): Promise<Cart>
export async function addToCart(
  lines: { merchandiseId: string; quantity: number }[]
): Promise<Cart>                       // reads cartId from cookies()
export async function removeFromCart(lineIds: string[]): Promise<Cart>
export async function updateCart(
  lines: { id: string; merchandiseId: string; quantity: number }[]
): Promise<Cart>
export async function getCart(): Promise<Cart | undefined>
  // body starts with: "use cache: private"; cacheTag(TAGS.cart); cacheLife("seconds");
  // reads cartId from cookies(); returns undefined when absent
export async function getCollection(handle: string): Promise<Collection | undefined>
  // "use cache"; cacheTag(TAGS.collections); cacheLife("days");
export async function getCollectionProducts({ collection, reverse, sortKey }: {
  collection: string; reverse?: boolean; sortKey?: string;
}): Promise<Product[]>                 // "use cache"; tags: collections+products
export async function getCollections(): Promise<Collection[]>
  // "use cache"; always prepends a synthetic "All" collection
  // { handle: "", title: "All", description: "All products", path: "/search", ... }
  // and filters out handles starting with "hidden"
export async function getMenu(handle: string): Promise<Menu[]>
  // "use cache"; template calls it with handles "next-js-frontend-header-menu"
  // and "next-js-frontend-footer-menu" (navbar/footer)
export async function getPage(handle: string): Promise<Page>
export async function getPages(): Promise<Page[]>
export async function getProduct(handle: string): Promise<Product | undefined>
  // "use cache"; cacheTag(TAGS.products); cacheLife("days");
export async function getProductRecommendations(productId: string): Promise<Product[]>
export async function getProducts({ query, reverse, sortKey }: {
  query?: string; reverse?: boolean; sortKey?: string;
}): Promise<Product[]>                 // "use cache"
export async function revalidate(req: NextRequest): Promise<NextResponse>
  // Shopify webhook endpoint — delete along with app/api/revalidate/route.ts
```

`sortKey` values come from `lib/constants.ts` `sorting`:
`"RELEVANCE" | "BEST_SELLING" | "CREATED_AT" | "PRICE"` (+ `reverse`). The mock
provider must honor these (map BEST_SELLING to anything deterministic).

Cache tags (`lib/constants.ts`, verbatim):

```ts
export const TAGS = {
  collections: "collections",
  products: "products",
  cart: "cart",
};
export const HIDDEN_PRODUCT_TAG = "nextjs-frontend-hidden";
export const DEFAULT_OPTION = "Default Title";
```

#### Complete type contract (`lib/shopify/types.ts`)

The UI consumes these exact shapes (keep them verbatim in the mock provider —
you can drop the `Shopify*Operation` GraphQL types, but keep `ShopifyCart`,
`ShopifyCollection`, `ShopifyProduct` since `Cart`, `Collection`, `Product`
are derived from them):

```ts
export type Maybe<T> = T | null;
export type Connection<T> = { edges: Array<Edge<T>> };
export type Edge<T> = { node: T };

export type Cart = Omit<ShopifyCart, "lines"> & { lines: CartItem[] };

export type CartProduct = {
  id: string;
  handle: string;
  title: string;
  featuredImage: Image;
};

export type CartItem = {
  id: string | undefined;
  quantity: number;
  cost: { totalAmount: Money };
  merchandise: {
    id: string;
    title: string;
    selectedOptions: { name: string; value: string }[];
    product: CartProduct;
  };
};

export type Collection = ShopifyCollection & { path: string };

export type Image = {
  url: string;
  altText: string;
  width: number;
  height: number;
};

export type Menu = { title: string; path: string };
export type Money = { amount: string; currencyCode: string };

export type Page = {
  id: string;
  title: string;
  handle: string;
  body: string;
  bodySummary: string;
  seo?: SEO;
  createdAt: string;
  updatedAt: string;
};

export type Product = Omit<ShopifyProduct, "variants" | "images"> & {
  variants: ProductVariant[];
  images: Image[];
};

export type ProductOption = { id: string; name: string; values: string[] };

export type ProductVariant = {
  id: string;
  title: string;
  availableForSale: boolean;
  selectedOptions: { name: string; value: string }[];
  price: Money;
};

export type SEO = { title: string; description: string };

export type ShopifyCart = {
  id: string | undefined;
  checkoutUrl: string;
  cost: {
    subtotalAmount: Money;
    totalAmount: Money;
    totalTaxAmount: Money;
  };
  lines: Connection<CartItem>;   // NOTE: Cart flattens this to CartItem[]
  totalQuantity: number;
};

export type ShopifyCollection = {
  handle: string;
  title: string;
  description: string;
  seo: SEO;
  updatedAt: string;
};

export type ShopifyProduct = {
  id: string;
  handle: string;
  availableForSale: boolean;
  title: string;
  description: string;
  descriptionHtml: string;
  options: ProductOption[];
  priceRange: { maxVariantPrice: Money; minVariantPrice: Money };
  variants: Connection<ProductVariant>;
  featuredImage: Image;
  images: Connection<Image>;
  seo: SEO;
  tags: string[];
  updatedAt: string;
};
```

`Money.amount` is a **string** (e.g. `"20.00"`). `components/price.tsx`
formats it with `Intl.NumberFormat`.

#### Cart server actions (`components/cart/actions.ts`)

`addItem`, `removeItem`, `updateItemQuantity` (all `(prevState: any, payload)`
useActionState-style, returning an error string or nothing), plus:

```ts
export async function redirectToCheckout() {
  let cart = await getCart();
  redirect(cart!.checkoutUrl);
}

export async function createCartAndSetCookie() {
  let cart = await createCart();
  (await cookies()).set("cartId", cart.id!);
}
```

They call `updateTag(TAGS.cart)` (imported from `next/cache`) after mutations.
The cart is identified by the `cartId` cookie. **These actions are the perfect
place for `Sentry.withServerActionInstrumentation` (§6.5).**

`app/layout.tsx` passes an **unawaited promise** to the cart context:
`const cart = getCart();` → `<CartProvider cartPromise={cart}>` (React `use()`
on the client). Keep this working.

`components/cart/modal.tsx` calls `createCartAndSetCookie()` in a `useEffect`
when no cart exists — so `createCart()` runs on first page view.

#### Shopify-specific things to stub/remove

1. **Checkout redirect**: `Cart.checkoutUrl` — mock can point at a local
   `/checkout` stub page (or keep the field and render a "demo" page). The
   "Proceed to Checkout" button in `components/cart/modal.tsx` calls
   `redirectToCheckout`.
2. **Webhook revalidation**: delete `app/api/revalidate/route.ts` and the
   `revalidate()` function + `SHOPIFY_REVALIDATION_SECRET`.
3. **Image host**: `next.config.ts` whitelists `cdn.shopify.com`. Mock product
   images should be local files under `public/` (no `remotePatterns` needed) or
   update `remotePatterns` for whatever host you use.
4. **`lib/shopify/fragments|mutations|queries`** directories: GraphQL strings —
   delete entirely with the mock.
5. **`lib/type-guards.ts`** (`isShopifyError`) — only used by `shopifyFetch`;
   delete with it.
6. **`validateEnvironmentVariables()`** in `lib/utils.ts` throws when
   `SHOPIFY_STORE_DOMAIN` / `SHOPIFY_STOREFRONT_ACCESS_TOKEN` are missing; it
   is called from `app/sitemap.ts`. Remove the call (or the function) or the
   sitemap route 500s.
7. **`HIDDEN_PRODUCT_TAG`** filtering in `app/product/[handle]/page.tsx` — keep
   (harmless; mock products just never carry the tag).

#### What breaks without Shopify creds (as shipped)

`getCollectionProducts`, `getCollections`, `getMenu`, `getProduct` have
`if (!endpoint) { ...return empty }` guards, so the homepage renders empty. But
`getProducts`, `getPage`, `getPages`, `getProductRecommendations`, `createCart`
and all cart mutations have **no guard** — `/search`, product pages, the
sitemap and cart creation all throw. The mock provider replaces all of this,
so nothing depends on network at build time (a hard requirement since builds
must pass with no keys at all).

### 1.5 App/component tree (unchanged by the demo)

```
app/
  layout.tsx                 # Navbar + CartProvider(cartPromise) + Toaster
  page.tsx                   # ThreeItemGrid + Carousel + Footer
  [page]/page.tsx            # CMS-ish pages via getPage
  product/[handle]/page.tsx
  search/page.tsx, search/[collection]/page.tsx, search/layout.tsx, loading.tsx
  api/revalidate/route.ts    # DELETE (Shopify webhook)
  sitemap.ts, robots.ts, opengraph-image.tsx, error.tsx, globals.css
components/
  cart/ (actions.ts, modal.tsx, cart-context.tsx, add-to-cart.tsx, ...)
  grid/, layout/ (navbar, footer, search filters), product/ (gallery, variant-selector)
  carousel.tsx, price.tsx, prose.tsx, welcome-toast.tsx, loading-dots.tsx
lib/
  shopify/ (REPLACE with mock provider), constants.ts, utils.ts, type-guards.ts
fonts/ (Inter subset), public? (none — images come from Shopify CDN)
```

`app/globals.css` (verbatim, first lines):

```css
@import "tailwindcss";

@plugin "@tailwindcss/container-queries";
@plugin "@tailwindcss/typography";
```

Dark mode is **media-query based** (`@media (prefers-color-scheme: dark)`
sets `color-scheme: dark`, components use `dark:` variants) — relevant for the
shadcn CSS-variables install (§3.5).

### 1.6 Required upgrade: Next 16.3.0 (peer-dep math forces it)

The template pins `next@15.6.0-canary.60`. Verified with the semver CLI:
`15.6.0-canary.60` does **NOT** satisfy `@sentry/nextjs`'s peer range
`^15.0.0-rc.0` (npm prerelease-matching rule: a prerelease only matches a
comparator with the same `major.minor.patch` tuple). `npm install
@sentry/nextjs` in the untouched template therefore fails with ERESOLVE.
Upgrading to `next@16.3.0` (satisfies `^16.0.0-0`) is the clean fix, and the
template's canary features are exactly what Next 16 stabilized:

- `next.config.ts` — replace `experimental: { ppr: true, useCache: true }`
  with top-level **`cacheComponents: true`** (nextjs.org: "This flag controls
  the `ppr`, `useCache`, and `dynamicIO` flags as a single, unified
  configuration"; "the `experimental.ppr` configuration flag ... no longer
  necessary and have been removed"). `experimental.inlineCss` can stay under
  `experimental` or be dropped.
- `lib/shopify/index.ts` imports
  `unstable_cacheLife as cacheLife, unstable_cacheTag as cacheTag` from
  `next/cache`. **Next 16.3 no longer exports the `unstable_` names** (verified
  against `next@16.3.0/cache.d.ts`). Change to
  `import { cacheLife, cacheTag, revalidateTag } from "next/cache"`.
- `revalidateTag(tag, "seconds")` (2-arg) and `updateTag(tag)` are the stable
  Next 16 signatures — the template already uses them. In Next 16.3
  `revalidateTag` **requires** the second argument (profile string or
  `{ expire }`).
- `'use cache'` / `'use cache: private'` / `cacheLife` / `cacheTag` are stable
  under `cacheComponents: true` (both directive docs: "Version 16.0.0 —
  enabled with the Cache Components feature").
- Bump `react`/`react-dom` to `19.2.8` and `@types/react`/`@types/react-dom`
  to match. Required anyway: `@ai-sdk/react` peer is
  `^18 || ~19.0.1 || ~19.1.2 || ^19.2.1` — the template's `react@19.0.0`
  satisfies **none** of those ranges.
- Next 16 requires the Node runtime for cacheComponents (no `runtime = 'edge'`
  routes — the template has none). Keep the chat route on the Node runtime
  anyway for Sentry (§7).

Restriction to respect (verbatim from the `use cache: private` doc):
"**Good to know**: This directive is not available in Route Handlers." —
`getCart()` uses `'use cache: private'` and is called from layout/server
actions (fine), but the AI chat route handler must NOT call it. Give the chat
tools their own uncached read path into the mock DB (see §9).

---

## 2. AI SDK v7 — current APIs (verified against vercel/ai@main = 7.0.56)

Install for this demo:

```bash
npm install ai @ai-sdk/react zod @openrouter/ai-sdk-provider
```

### 2.1 What changed vs v5 (do NOT use v5 idioms)

Verified against `ai@7.0.56` `index.d.ts` and the current docs MDX:

- `system:` is **deprecated** → use **`instructions:`** (type def: "@deprecated
  Use `instructions` instead.").
- `result.toUIMessageStreamResponse()` is **deprecated** ("use
  `createUIMessageStreamResponse` helpers from 'ai' with `result.stream`
  instead. This method will be removed in the next major release."). Current
  pattern: `createUIMessageStreamResponse({ stream: toUIMessageStream({ stream: result.stream }) })`.
- Multi-step: `stopWhen: isStepCount(n)` — `stepCountIs` still exists as an
  alias export (`isStepCount as stepCountIs`), docs use `isStepCount`.
  Built-ins: `isStepCount(count)` (default `isStepCount(20)`),
  `hasToolCall(...toolNames)`, `isLoopFinished()`. `maxSteps` is gone.
- Telemetry: per-call option is now `telemetry:` (the `experimental_telemetry:`
  alias still exists in the type defs and is what Sentry's docs use). The AI
  SDK now also has `registerTelemetry(new OpenTelemetry())` from `@ai-sdk/otel`
  — **do NOT use that with Sentry** (§7: "produces duplicate spans").
- Tools: `inputSchema` (zod), `execute`, optional `description`, optional
  `strict: true`. Tool parts in UI messages are typed `tool-${toolName}` with
  states: `input-streaming`, `input-available`, `approval-requested`,
  `approval-responded`, `output-available`, `output-error`, `output-denied`.
- `useChat` from `@ai-sdk/react`: `transport: new DefaultChatTransport({ api })`,
  returns `{ messages, sendMessage, status, stop, error, regenerate, addToolOutput }`.
  `status` ∈ `submitted | streaming | ready | error`. Messages have `parts`
  (render `parts`, not `content`).

### 2.2 Basic chat route handler (verbatim, `04-ai-sdk-ui/02-chatbot.mdx`; `__MODEL__` placeholder replaced by OpenRouter — see §4)

```ts
// app/api/chat/route.ts
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  streamText,
  toUIMessageStream,
  UIMessage,
} from 'ai';

// Allow streaming responses up to 30 seconds
export const maxDuration = 30;

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  const result = streamText({
    model: /* __MODEL__ */ openrouter(process.env.OPENROUTER_MODEL ?? 'openai/gpt-4o-mini'),
    instructions: 'You are a helpful assistant.',
    messages: await convertToModelMessages(messages),
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream }),
  });
}
```

### 2.3 useChat client (verbatim from chatbot.mdx)

```tsx
'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useState } from 'react';

export default function Page() {
  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/chat',
    }),
  });
  const [input, setInput] = useState('');

  return (
    <>
      {messages.map(message => (
        <div key={message.id}>
          {message.role === 'user' ? 'User: ' : 'AI: '}
          {message.parts.map((part, index) =>
            part.type === 'text' ? <span key={index}>{part.text}</span> : null,
          )}
        </div>
      ))}

      <form
        onSubmit={e => {
          e.preventDefault();
          if (input.trim()) {
            sendMessage({ text: input });
            setInput('');
          }
        }}
      >
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          disabled={status !== 'ready'}
          placeholder="Say something..."
        />
        <button type="submit" disabled={status !== 'ready'}>
          Submit
        </button>
      </form>
    </>
  );
}
```

`status` values (verbatim): `submitted`, `streaming`, `ready`, `error`.
`stop()` aborts; `regenerate()` retries; `error` holds the fetch error.

### 2.4 Tool definitions with zod + multi-step (verbatim, tools-and-tool-calling.mdx)

```ts
import { z } from 'zod';
import { generateText, tool, isStepCount } from 'ai';

const result = await generateText({
  model: __MODEL__,
  tools: {
    weather: tool({
      description: 'Get the weather in a location',
      inputSchema: z.object({
        location: z.string().describe('The location to get the weather for'),
      }),
      execute: async ({ location }) => ({
        location,
        temperature: 72 + Math.floor(Math.random() * 21) - 10,
      }),
    }),
  },
  stopWhen: isStepCount(5),
  prompt: 'What is the weather in San Francisco?',
});
```

Doc statements (verbatim):

- "With the `stopWhen` setting, you can enable multi-step calls in
  `generateText` and `streamText`. When `stopWhen` is set and the model
  generates a tool call, the AI SDK will trigger a new generation passing in
  the tool result until there are no further tool calls or the stopping
  condition is met."
- "`isStepCount(count)` — stops after a specified number of steps (default:
  `isStepCount(20)`)"
- "The `stopWhen` conditions are only evaluated when the last step contains
  tool results."
- Steps access: `const { steps } = await generateText(...)`;
  `steps.flatMap(step => step.toolCalls)`; `onStepEnd` callback fires per step.
- `tool()` helper exists purely for type inference of `execute` params
  (`import { tool as createTool } from 'ai'` also seen in docs).

### 2.5 Generative UI — tools file + route + typed tool parts (verbatim, 04-generative-user-interfaces.mdx)

`ai/tools.ts`:

```ts
import { tool as createTool } from 'ai';
import { z } from 'zod';

export const weatherTool = createTool({
  description: 'Display the weather for a location',
  inputSchema: z.object({
    location: z.string().describe('The location to get the weather for'),
  }),
  execute: async function ({ location }) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    return { weather: 'Sunny', temperature: 75, location };
  },
});

export const tools = {
  displayWeather: weatherTool,
};
```

Route with tools + multi-step (verbatim):

```ts
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  isStepCount,
  streamText,
  toUIMessageStream,
  UIMessage,
} from 'ai';
import { tools } from '@/ai/tools';

export async function POST(request: Request) {
  const { messages }: { messages: UIMessage[] } = await request.json();

  const result = streamText({
    model: __MODEL__,
    instructions: 'You are a friendly assistant!',
    messages: await convertToModelMessages(messages),
    stopWhen: isStepCount(5),
    tools,
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({ stream: result.stream }),
  });
}
```

Rendering typed tool parts as custom components (verbatim client excerpt):

```tsx
{message.parts.map((part, index) => {
  if (part.type === 'text') {
    return <span key={index}>{part.text}</span>;
  }

  if (part.type === 'tool-displayWeather') {
    switch (part.state) {
      case 'input-available':
        return <div key={index}>Loading weather...</div>;
      case 'output-available':
        return (
          <div key={index}>
            <Weather {...part.output} />
          </div>
        );
      case 'output-error':
        return <div key={index}>Error: {part.errorText}</div>;
      default:
        return null;
    }
  }

  return null;
})}
```

Doc note (verbatim): "tool parts use typed naming: `tool-${toolName}` instead
of generic types." Full state list to handle exhaustively (from
chatbot-tool-usage.mdx): `input-streaming`, `input-available`,
`approval-requested`, `approval-responded`, `output-available`,
`output-error`, `output-denied`. `part.input` is the typed input,
`part.output` the typed output, `part.errorText` the error,
`part.toolCallId` the id.

Useful type exports from `ai`: `ToolUIPart`, `DynamicToolUIPart`,
`InferUITool`, `InferUITools`, `UIDataTypes`, `isToolUIPart`, `getToolName`.

### 2.6 Client-side tools / addToolOutput (only if needed)

From chatbot-tool-usage.mdx: `useChat({ sendAutomaticallyWhen:
lastAssistantMessageIsCompleteWithToolCalls, async onToolCall({ toolCall })
{ ... addToolOutput({ tool, toolCallId, output }) } })` — check
`if (toolCall.dynamic) return;` first. The storefront demo likely only needs
server-side tools, so this is optional.

### 2.7 Telemetry flags on streamText (for Sentry)

v7 telemetry doc: after a telemetry integration is registered, "all AI SDK
calls emit telemetry events by default. You can still pass `telemetry` to
attach metadata (like `functionId`) or to opt out". With **Sentry** you do NOT
register `@ai-sdk/otel` — Sentry's Node integration patches the module itself
(§7). On the Node runtime you only pass `experimental_telemetry` to set
`functionId` / recording options:

```ts
const result = streamText({
  // ...
  experimental_telemetry: {
    functionId: 'shopping-assistant',
    recordInputs: true,
    recordOutputs: true,
  },
});
```

(`functionId` appears on spans as `gen_ai.function_id`; Sentry docs use
`experimental_telemetry` — the alias is still valid in v7.)

---

## 3. AI Elements

### 3.1 What it is

From vercel/ai-elements README (verbatim): "AI Elements is a component library
built on top of shadcn/ui to help you build AI-native applications faster."
It is a **shadcn registry** — components are copied as source into
`components/ai-elements/` in your repo (not an npm dependency), fully
restyleable. Docs: https://elements.ai-sdk.dev (note: `ai-sdk.dev/elements/*`
308-redirects there).

Prerequisites (README, verbatim): "**Node.js** 18 or later; **Next.js**
project with AI SDK installed; **shadcn/ui** initialized in your project
(`npx shadcn@latest init`); **Tailwind CSS** configured (AI Elements supports
CSS Variables mode only)." Tailwind **v4 is fully supported** — the AI
Elements docs app itself uses Tailwind v4 with `"tailwind": { "config": "" }`
in its `components.json`, matching the commerce template's Tailwind v4 setup.

### 3.2 Install commands (verbatim from README)

```bash
# Use directly (recommended)
npx ai-elements@latest

# Or using shadcn cli
npx shadcn@latest add https://elements.ai-sdk.dev/api/registry/all.json
```

```bash
# Install a specific component
npx ai-elements@latest add message
npx ai-elements@latest add conversation
```

```bash
# shadcn CLI equivalent for a specific component
npx shadcn@latest add https://elements.ai-sdk.dev/api/registry/message.json
```

**Verified from `packages/cli/index.js` source: the `ai-elements` CLI is a
thin wrapper that literally spawns
`npx -y shadcn@latest add https://elements.ai-sdk.dev/api/registry/<name>.json`**
(one URL per component; no args → `all`). So the fully non-interactive path is
to call shadcn directly with `-y`:

```bash
npx -y shadcn@latest add -y -o \
  https://elements.ai-sdk.dev/api/registry/conversation.json \
  https://elements.ai-sdk.dev/api/registry/message.json \
  https://elements.ai-sdk.dev/api/registry/prompt-input.json \
  https://elements.ai-sdk.dev/api/registry/tool.json \
  https://elements.ai-sdk.dev/api/registry/suggestion.json
```

shadcn `add` flags (verified via `npx shadcn@latest add --help`):
`-y, --yes` (skip confirmation), `-o, --overwrite`, `-c, --cwd <cwd>`,
`-a, --all`, `-p, --path`, `-s, --silent`, `--dry-run`.

This requires `components.json` to already exist (see §3.4). `shadcn add`
resolves registry dependencies automatically (installs the shadcn `button`,
`badge`, `collapsible`, ... components and the npm deps below).

### 3.3 What each component pulls in (verified from registry JSON)

| Component | npm deps | shadcn registry deps |
|---|---|---|
| `conversation` | ai, lucide-react, use-stick-to-bottom | button |
| `message` | @streamdown/cjk, @streamdown/code, @streamdown/math, @streamdown/mermaid, ai, lucide-react, streamdown | button, button-group, tooltip |
| `prompt-input` | ai, lucide-react, nanoid | command, dropdown-menu, hover-card, input-group, select, spinner, tooltip |
| `tool` | ai, lucide-react | badge, collapsible, code-block (AI Elements) |
| `suggestion` | — | button, scroll-area |

`@ai-sdk/react` is **not** auto-installed — add it explicitly.

Component inventory (current, from elements.ai-sdk.dev/overview):
**Chatbot**: Attachments, Chain of Thought, Checkpoint, Confirmation, Context,
Conversation, Inline Citation, Message, Model Selector, Plan, Prompt Input,
Queue, Reasoning, Shimmer, Sources, Suggestion, Task, Tool.
**Code**: Agent, Artifact, Code Block, Commit, Environment Variables, File
Tree, JSX Preview, Package Info, Sandbox, Schema Display, Snippet, Stack
Trace, Terminal, Test Results, Web Preview. **Voice**: Audio Player, Mic
Selector, Persona, Speech Input, Transcription, Voice Selector. **Workflow**:
Canvas, Connection, Controls, Edge, Node, Panel, Toolbar. **Utilities**:
Image, Open In Chat.

Note: there is **no standalone `Response` or `Loader` component anymore** —
markdown rendering is `MessageResponse` (exported from
`components/ai-elements/message`, powered by streamdown), and the loading
shimmer is the `Shimmer` component / `spinner` shadcn primitive.
For the chat panel you need: `conversation`, `message`, `prompt-input`,
`tool`, `suggestion` (+ optional `shimmer`).

### 3.4 Non-interactive shadcn setup inside the commerce template

The commerce template has no shadcn. `shadcn init` flags (verified via
`npx shadcn@latest init --help`): `-y/--yes` (default true), `-b, --base
<base>` (component library: base, radix, aria), `-p, --preset [name]`,
`-t, --template`, `-f, --force`, `-c, --cwd`, `--css-variables` (default
true), `--no-monorepo`, `-s, --silent`. Because current `init` may still
prompt for preset choices in an existing app, the **fully deterministic route
is to author `components.json` by hand** (documented schema) and let
`shadcn add` do the rest. Mirror the AI Elements docs app's own
`components.json` (verbatim below, adjusted paths for commerce):

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "app/globals.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "iconLibrary": "lucide",
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  }
}
```

shadcn docs: "For Tailwind CSS v4, leave this blank" (the `tailwind.config`
path).

Also add the `@/*` path alias to the template's `tsconfig.json` (it currently
only has `baseUrl: "."`):

```json
"paths": { "@/*": ["./*"] }
```

This coexists with the template's bare `components/...` imports.
Watch out: commerce already has `lib/utils.ts` with its own exports —
`shadcn add` will want to write the `cn` helper to `lib/utils.ts` (alias
`utils`). Either point the `utils` alias at a different file or merge `cn`
(`clsx` + `tailwind-merge`) into the existing `lib/utils.ts` manually first
and run add with care (`--overwrite` would clobber it — prefer NOT passing
`-o` on the first run and check the diff, or pre-create `cn` so the file
matches).

### 3.5 CSS variables (required — "CSS Variables mode only")

shadcn Tailwind v4 structure (from ui.shadcn.com/docs/tailwind-v4, structure
verbatim; use the full neutral palette from shadcn — `npx shadcn init` writes
it, or copy from https://ui.shadcn.com/docs/theming):

```css
@import "tailwindcss";
@import "tw-animate-css";

@custom-variant dark (&:is(.dark *));

:root {
  --background: hsl(0 0% 100%);
  --foreground: hsl(0 0% 3.9%);
  /* ...card, popover, primary, secondary, muted, accent, destructive,
     border, input, ring, radius ... */
}

.dark {
  --background: hsl(0 0% 3.9%);
  --foreground: hsl(0 0% 98%);
  /* ... */
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  /* ...map every variable to a --color-* token... */
}
```

**Dark-mode conflict**: shadcn's `@custom-variant dark (&:is(.dark *))`
switches Tailwind's `dark:` variant from media-query to `.dark`-class —
which would silently kill the commerce template's system-preference dark
styling. Two clean options: (a) omit the `@custom-variant` line and put the
dark variable overrides inside `@media (prefers-color-scheme: dark) { :root
{ ... } }` so both systems stay media-based; or (b) add the class strategy +
a theme toggle. For a demo, (a) is least invasive.

**streamdown requirement** (message.mdx, verbatim): "After adding the
component, you'll need to add the following to your `globals.css` file:
`@source "../node_modules/streamdown/dist/*.js";` This is **required** for
the MessageResponse component to work properly." (Path is relative to the CSS
file — from `app/globals.css` it's `../node_modules/streamdown/dist/*.js`.)

### 3.6 Chat panel usage (verbatim from AI Elements docs MDX)

Conversation + Message + PromptInput skeleton (from message.mdx):

```tsx
"use client";

import { useState } from "react";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  type PromptInputMessage,
  PromptInputTextarea,
  PromptInputSubmit,
} from "@/components/ai-elements/prompt-input";
import { useChat } from "@ai-sdk/react";
import { Fragment } from "react";

const ActionsDemo = () => {
  const [input, setInput] = useState("");
  const { messages, sendMessage, status } = useChat();

  const handleSubmit = (message: PromptInputMessage) => {
    if (message.text.trim()) {
      sendMessage({ text: message.text });
      setInput("");
    }
  };

  return (
    <div className="flex flex-col h-full">
      <Conversation>
        <ConversationContent>
          {messages.map((message) => (
            <Fragment key={message.id}>
              {message.parts.map((part, i) => {
                switch (part.type) {
                  case "text":
                    return (
                      <Message from={message.role} key={`${message.id}-${i}`}>
                        <MessageContent>
                          <MessageResponse>{part.text}</MessageResponse>
                        </MessageContent>
                      </Message>
                    );
                  default:
                    return null;
                }
              })}
            </Fragment>
          ))}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <PromptInput
        onSubmit={handleSubmit}
        className="mt-4 w-full max-w-2xl mx-auto relative"
      >
        <PromptInputTextarea
          value={input}
          placeholder="Say something..."
          onChange={(e) => setInput(e.currentTarget.value)}
          className="pr-12"
        />
        <PromptInputSubmit
          status={status === "streaming" ? "streaming" : "ready"}
          disabled={!input.trim()}
          className="absolute bottom-1 right-1"
        />
      </PromptInput>
    </div>
  );
};
```

(Also available: `ConversationEmptyState` with `icon`/`title`/`description`
props, `ConversationDownload messages={messages}`.)

Tool rendering (tool.mdx, verbatim excerpt — pair with typed tool parts):

```tsx
import { DefaultChatTransport, type ToolUIPart } from "ai";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";

// ...
{weatherTool && (
  <Tool defaultOpen={true}>
    <ToolHeader
      type="tool-fetch_weather_data"
      state={weatherTool.state}
    />
    <ToolContent>
      <ToolInput input={weatherTool.input} />
      <ToolOutput
        output={
          <MessageResponse>
            {formatWeatherResult(weatherTool.output)}
          </MessageResponse>
        }
        errorText={weatherTool.errorText}
      />
    </ToolContent>
  </Tool>
)}
```

`ToolHeader` props: `type` (`ToolUIPart["type"]`), `state`
(`ToolUIPart["state"]`), optional `title`. `ToolOutput.output` is
`React.ReactNode` — **this is where custom React components for tool results
plug in** (a product-card grid for a `searchProducts` tool output, etc.).
Tool badge labels by state: input-streaming = "Pending", input-available =
"Running", output-available = "Completed", output-error = "Error".

Suggestions (suggestion.mdx, verbatim excerpt):

```tsx
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";

<Suggestions>
  {suggestions.map((suggestion) => (
    <Suggestion
      key={suggestion}
      onClick={handleSuggestionClick}
      suggestion={suggestion}
    />
  ))}
</Suggestions>
// onClick receives the suggestion string: (suggestion: string) => void
```

Note: several AI Elements doc examples still show the deprecated
`result.toUIMessageStreamResponse()` and a stray `parameters:` key — the docs
lag `ai@7`; use the §2.2 route pattern and `inputSchema` only.

---

## 4. OpenRouter provider

Package: `@openrouter/ai-sdk-provider@3.0.0`. README (verbatim): "This release
line supports `ai@^7.0.0`, requires Node.js 22 or newer, and is ESM-only."
(Legacy: `@2.9.1` for AI SDK v6, `@1.5.4` for v5.) Peer deps verified:
`{ ai: '^7.0.0', zod: '^3.25.76 || ^4.1.8' }` — compatible with `ai@7.0.56`
and `zod@4.4.3`.

Usage (README, verbatim):

```ts
import { createOpenRouter } from '@openrouter/ai-sdk-provider';

const openrouter = createOpenRouter({ apiKey: 'your-api-key' });
const model = openrouter('anthropic/claude-3.7-sonnet:thinking');
```

There is also a default instance: `import { openrouter } from
'@openrouter/ai-sdk-provider'` — **verified in the package source that it
reads the `OPENROUTER_API_KEY` environment variable** (throws a descriptive
error if missing at call time). For the demo, either works; explicit is
self-documenting:

```ts
import { createOpenRouter } from '@openrouter/ai-sdk-provider';

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

export const model = openrouter(process.env.OPENROUTER_MODEL ?? 'openai/gpt-4o-mini');
```

Model ids are OpenRouter slugs (`openai/gpt-4o`, `anthropic/claude-sonnet-4`,
etc. — https://openrouter.ai/models). `openrouter.chat(id)` also exists.
Provider-specific options go through `providerOptions: { openrouter: {...} }`
or `extraBody`.

`.env.example` entries for the demo:

```
OPENROUTER_API_KEY=
# optional override, defaults in code:
OPENROUTER_MODEL=
```

---

## 5. Sentry on Next.js App Router — manual setup (no wizard)

Source: docs.sentry.io `platforms/javascript/guides/nextjs/manual-setup.md`
(fetched 2026-08-07; the guide targets "Next.js 15+ with Turbopack and App
Router" — Next 16's default build is Turbopack, so this is the right variant).

```bash
npm install @sentry/nextjs --save
```

### 5.1 `next.config.ts` (verbatim, merged with commerce config)

```ts
import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  // Your existing Next.js configuration
};

export default withSentryConfig(nextConfig, {
  org: "<your-org-slug>",
  project: "<your-project-slug>",

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // Pass the auth token
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Upload a larger set of source maps for prettier stack traces
  widenClientFileUpload: true,
});
```

**Builds without SENTRY_AUTH_TOKEN**: the docs list Source Maps as
"(Optional)" — `withSentryConfig` only uploads when `authToken` is present;
with `authToken: process.env.SENTRY_AUTH_TOKEN` unset the build still
succeeds (it logs a warning unless `silent`). For the demo, read org/project
from env too (`process.env.SENTRY_ORG`, `process.env.SENTRY_PROJECT`) so
nothing is hardcoded. Optional hardening: `sourcemaps: { disable: true }`
when no token — not required for a passing build.

### 5.2 `instrumentation.ts` (project root, verbatim)

```ts
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Capture errors from Server Components, middleware, and proxies
export const onRequestError = Sentry.captureRequestError;
```

(Doc: "The `onRequestError` hook requires `@sentry/nextjs` version `8.28.0` or
higher and Next.js 15.")

### 5.3 `instrumentation-client.ts` (verbatim; DSN swapped to env)

```ts
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  // Capture 100% in dev, 10% in production
  // Adjust based on your traffic volume
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,

  // Enable logs to be sent to Sentry
  enableLogs: true,
});

// This export will instrument router navigations
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
```

Docs tip (verbatim): "Include your DSN directly in these files, or use a
*public* environment variable like `NEXT_PUBLIC_SENTRY_DSN`."
(The doc's full example also shows optional `replayIntegration()` /
`feedbackIntegration({ colorScheme: "system" })` with
`replaysSessionSampleRate: 0.1`, `replaysOnErrorSampleRate: 1.0`, and a
`dataCollection: {}` block — all optional; Replay is nice-to-have for the
demo but not required. Note the `dataCollection: {}` caveat in §7.)

### 5.4 `sentry.server.config.ts` (adapted: DSN via env + AI agent recording, see §7)

```ts
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,
  enableLogs: true,
  integrations: [
    Sentry.vercelAIIntegration({
      recordInputs: true,
      recordOutputs: true,
    }),
  ],
});
```

### 5.5 `sentry.edge.config.ts` (verbatim shape; DSN via env)

```ts
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: process.env.NODE_ENV === "development" ? 1.0 : 0.1,
  enableLogs: true,
});
```

### 5.6 `app/global-error.tsx` (verbatim)

```tsx
"use client";

import * as Sentry from "@sentry/nextjs";
import NextError from "next/error";
import { useEffect } from "react";

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html>
      <body>
        {/* `NextError` is the default Next.js error page component. Its type
        definition requires a `statusCode` prop. However, since the App Router
        does not expose status codes for errors, we simply pass 0 to render a
        generic error message. */}
        <NextError statusCode={0} />
      </body>
    </html>
  );
}
```

### 5.7 Server Actions (verbatim — wrap the cart actions with this)

```ts
"use server";
import * as Sentry from "@sentry/nextjs";
import { headers } from "next/headers";

export async function submitForm(formData: FormData) {
  return Sentry.withServerActionInstrumentation(
    "submitForm", // Action name for Sentry
    {
      headers: await headers(), // Connect client and server traces
      formData, // Attach form data to events
      recordResponse: true, // Include response data
    },
    async () => {
      // Your server action logic
      const result = await processForm(formData);
      return { success: true, data: result };
    },
  );
}
```

Tunneling (optional, verbatim): `tunnelRoute: "/sentry-tunnel"` in the
`withSentryConfig` options — skip for the demo unless wanted.

`.env.example` entries:

```
NEXT_PUBLIC_SENTRY_DSN=
SENTRY_ORG=
SENTRY_PROJECT=
# optional — enables source map upload during build:
SENTRY_AUTH_TOKEN=
```

---

## 6. Sentry AI agent tracing (`vercelAIIntegration`)

Source: docs.sentry.io
`platforms/javascript/guides/nextjs/configuration/integrations/vercelai.md`
(fetched 2026-08-07). Key verbatim statements:

- "The `vercelAIIntegration` adds instrumentation for the `ai` SDK by Vercel
  to capture spans using the AI SDK's built-in telemetry."
- "**Don't use the AI SDK's `registerTelemetry` API (AI SDK v7 and above)
  together with this integration.** `vercelAIIntegration` already instruments
  the AI SDK, so registering telemetry separately produces duplicate spans."
- Supported versions: "`ai`: `>=3.0.0 <=7`", "Sentry SDK: `10.6.0`+",
  "Edge runtime: `ai` v7 is not supported. Use v6 or below, or run the call
  in the Node runtime." → **keep the chat route on the Node runtime** (do not
  export `runtime = 'edge'`; cacheComponents requires Node anyway).

Runtime matrix (verbatim):

|                                   | Node runtime            | Edge runtime                        |
| --------------------------------- | ----------------------- | ----------------------------------- |
| Enabled by default                | Yes                     | No — add it to `sentry.edge.config` |
| `experimental_telemetry` per call | Not needed              | Required, or no spans are created   |
| Record inputs and outputs         | Integration or per call | Per call only                       |
| `force`                           | Available               | Not available — always active       |
| AI SDK v7                         | Supported               | Not supported                       |

Node runtime setup (verbatim): "The integration is enabled by default. No
setup code is needed beyond enabling tracing." Recording prompts/completions
is off by default; enable globally:

```javascript
Sentry.init({
  dsn: "https://<key>@o<orgId>.ingest.sentry.io/<projectId>",
  tracesSampleRate: 1.0,
  integrations: [
    Sentry.vercelAIIntegration({
      recordInputs: true,
      recordOutputs: true,
    }),
  ],
});
```

Resolution order (verbatim): "1. The integration option — applies to every
call. 2. The call's `experimental_telemetry` — applies to that call.
3. `dataCollection.genAI` — applies to every call." and "The integration
option wins over the call".

Per-call labeling (verbatim): "Spans carry the AI SDK function name, not
yours ... Set `functionId` to label the call site. It appears on the span as
`gen_ai.function_id`":

```javascript
const result = await generateText({
  model: openai("gpt-4o"),
  experimental_telemetry: {
    functionId: "summarize-ticket",
  },
});
```

Supported operations: `generateText()`, `streamText()`, `generateObject()`,
`streamObject()`, `embed()`, `embedMany()`, `rerank()` (+ `ToolLoopAgent`
`generate()`/`stream()`).

Deployment gotcha (verbatim, Troubleshooting): "When deploying to Vercel, you
may notice that AI SDK spans have raw names like `ai.toolCall` or
`ai.streamText` instead of the expected semantic names like
`gen_ai.execute_tool` ... This happens because the `ai` package is bundled
(not externalized) in Next.js production builds ... To fix this, explicitly
enable the integration with `force: true` in your `sentry.server.config.ts`":

```javascript
Sentry.init({
  dsn: "https://<key>@o<orgId>.ingest.sentry.io/<projectId>",
  integrations: [Sentry.vercelAIIntegration({ force: true })],
});
```

For the demo's `sentry.server.config.ts`, combine:
`Sentry.vercelAIIntegration({ force: true, recordInputs: true, recordOutputs: true })`
— safe on Node, guarantees gen_ai span names even when `ai` gets bundled.
Tool `execute` calls become `gen_ai.execute_tool` child spans automatically
(with `gen_ai.tool.call.arguments` / `gen_ai.tool.call.result` when recording
is on) — this is what populates Sentry's **AI Agents insights** dashboard.

---

## 7. Sentry manual DB spans (mock database instrumentation)

Sources: docs.sentry.io Queries insights
(`/product/insights/queries/`), custom instrumentation
(`/platforms/javascript/guides/nextjs/tracing/instrumentation/custom-instrumentation/`),
develop.sentry.dev span operations list.

Requirements for spans to show up in **Queries insights** (doc, verbatim):

- "The span `op` field is set to an eligible value" — eligible database ops
  (develop.sentry.dev): `db`, `db.query`, `db.sql.query`, `db.sql.execute`,
  `db.sql.transaction`, `db.sql.prisma`, `db.sql.active_record`, `db.redis`.
- "The span's description contains the full, parameterized query (e.g.
  `"SELECT * FROM users WHERE id = ?"`). Supported placeholder values for SQL
  are `%s`, `?`, `:c0` (e.g. `:c0`, `:c1`) and `$1` (e.g. `$1`, `$2`)."
  (For `Sentry.startSpan` the `name` is the description.)
- "The `db.system` span data value is set to the correct identifier (e.g.,
  `"postgresql"` or `"mongodb"`)." — identifiers follow OTel database
  semantic conventions (`sqlite`, `postgresql`, `mysql`, `mongodb`, ...).

`Sentry.startSpan` API (custom-instrumentation doc, verbatim):

```javascript
const result = await Sentry.startSpan(
  { name: "Important Function" },
  async () => {
    const res = await doSomethingAsync();
    return updateRes(res);
  },
);
```

Attributes are passed via `attributes: { ... }` in the span options, or
`span.setAttribute(...)` on `Sentry.getActiveSpan()`.

Combined pattern for the fake in-memory DB (adapted from the above verbatim
pieces — this is the wrapper to put around every mock query):

```ts
import * as Sentry from "@sentry/nextjs";

function dbSpan<T>(sql: string, fn: () => T | Promise<T>): Promise<T> {
  return Sentry.startSpan(
    {
      name: sql,                       // full parameterized query, e.g.
                                       // "SELECT * FROM products WHERE handle = ?"
      op: "db.query",
      attributes: {
        "db.system": "sqlite",         // pick a real OTel identifier so the
                                       // Queries module parses/groups it
        "db.operation": "SELECT",      // optional, OTel semconv
        "server.address": "in-memory", // optional
      },
    },
    async () => fn(),
  );
}
```

Notes: `db.system` must be a known identifier for correct grouping —
`"sqlite"` is the honest closest match for an in-process store (the demo
README can say "in-memory, SQLite-flavored spans"). Parameterized `?`
placeholders in the span name are what make Sentry aggregate identical
queries. These spans nest naturally inside the `gen_ai.execute_tool` spans
when tools query the DB, producing the desired waterfall:
`POST /api/chat` → `gen_ai.invoke_agent/streamText` → `gen_ai.execute_tool searchProducts` → `db.query SELECT ...`.

---

## 8. Suggested demo layout (builder's blueprint, not from docs)

```
sentry-demos/storefront/
  .env.example                 # OPENROUTER_API_KEY, OPENROUTER_MODEL,
                               # NEXT_PUBLIC_SENTRY_DSN, SENTRY_ORG, SENTRY_PROJECT,
                               # SENTRY_AUTH_TOKEN, COMPANY_NAME, SITE_NAME
  next.config.ts               # cacheComponents:true + withSentryConfig
  instrumentation.ts, instrumentation-client.ts,
  sentry.server.config.ts, sentry.edge.config.ts
  components.json              # §3.4
  app/                         # from template, minus api/revalidate
    api/chat/route.ts          # streamText + tools + stopWhen (Node runtime)
    global-error.tsx           # §5.6
  components/                  # template components untouched
    ai-elements/               # generated by shadcn add
    ui/                        # generated shadcn primitives
    assistant/                 # chat panel + tool-result cards (product cards
                               # reusing GridTileImage/Price for polish)
  lib/
    db/                        # in-memory product/cart store + dbSpan wrapper (§7)
    shopify/ → lib/commerce/?  # mock provider with identical exports; keep the
                               # import path "lib/shopify" OR rename module +
                               # rewrite ~15 import lines (renaming is cleaner;
                               # keep exact function names/signatures either way)
    ai/tools.ts                # searchProducts / getProductDetails / addToCart ...
```

Assistant tools that make a good Sentry demo: `searchProducts` (DB span),
`getProductDetails`, `addToCart` (cart mutation + `updateTag`),
`getCart` — each with zod `inputSchema`, server-side `execute`, results
rendered as custom React product cards via typed `tool-*` parts (§2.5 + §3.6).

---

## 9. Gotchas (all verified above)

1. **AI SDK is v7 now, not v5.** `system` → `instructions`;
   `result.toUIMessageStreamResponse()` → deprecated (use
   `createUIMessageStreamResponse({ stream: toUIMessageStream({ stream:
   result.stream }) })`); `stepCountIs` → `isStepCount` (alias kept);
   `maxSteps` gone. Many AI Elements doc snippets still show v5-isms
   (`toUIMessageStreamResponse()`, a `parameters:` key) — ignore those,
   follow §2.
2. **Do NOT `registerTelemetry(new OpenTelemetry())` / install `@ai-sdk/otel`**
   — Sentry's `vercelAIIntegration` patches `ai` itself on the Node runtime;
   combining both "produces duplicate spans" (Sentry docs, verbatim).
3. **Chat route must run on the Node runtime.** Sentry Edge runtime does not
   support `ai` v7 at all, and `cacheComponents` requires Node anyway. Do not
   add `export const runtime = "edge"` anywhere.
4. **Peer-dep traps with npm**: template's `react@19.0.0` fails
   `@ai-sdk/react`'s peer range (`~19.0.1 || ~19.1.2 || ^19.2.1`) → bump
   react/react-dom to 19.2.8. Template's `next@15.6.0-canary.60` fails
   `@sentry/nextjs`'s `^15.0.0-rc.0` (prerelease semver rule) → upgrade to
   `next@16.3.0`. Avoid `--legacy-peer-deps`; fix versions instead.
5. **Next 16 migration specifics**: `experimental.ppr`/`experimental.useCache`
   → `cacheComponents: true`; `unstable_cacheLife`/`unstable_cacheTag` exports
   are gone in 16.3 — import `cacheLife`/`cacheTag` from `next/cache`;
   `revalidateTag` now requires a second argument (template already passes
   `"seconds"`).
6. **`'use cache: private'` is "not available in Route Handlers"** (Next
   docs, verbatim). `getCart()` uses it — fine from layouts/server actions,
   but the `/api/chat` route handler's tools must read the mock DB through
   their own uncached functions (also gives cleaner `db.query` spans).
7. **`ai@7` and `@openrouter/ai-sdk-provider@3` require Node >= 22** and the
   OpenRouter provider is ESM-only. Node 24 locally is fine; mention the
   floor in the README.
8. **AI Elements**: requires shadcn + "CSS Variables mode only". The CLI is
   non-interactive-able only via `npx -y shadcn@latest add -y <registry
   URLs>` with a pre-authored `components.json` (§3.4). Add tsconfig
   `paths: {"@/*": ["./*"]}`. Don't let shadcn clobber the template's
   existing `lib/utils.ts` (pre-add the `cn` helper; check before using
   `--overwrite`). `@ai-sdk/react` must be installed explicitly.
9. **streamdown CSS**: add `@source "../node_modules/streamdown/dist/*.js";`
   to `app/globals.css` or MessageResponse renders unstyled (AI Elements
   docs call this **required**).
10. **Dark mode variant conflict**: shadcn's standard
    `@custom-variant dark (&:is(.dark *))` breaks the template's
    media-query-based `dark:` styling — omit it and scope shadcn's dark
    variables inside `@media (prefers-color-scheme: dark)` instead (§3.5).
11. **Sentry builds without a token**: keep `authToken:
    process.env.SENTRY_AUTH_TOKEN` — upload is skipped when unset and the
    build passes. Never hardcode DSN/org/project; use
    `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT` env refs.
12. **`vercelAIIntegration({ force: true })`** is the documented fix when the
    bundled `ai` package defeats module detection (raw `ai.streamText` span
    names instead of `gen_ai.*`); harmless to set proactively together with
    `recordInputs/recordOutputs: true`.
13. **Queries insights only parses spans that look like DB queries**: op from
    the eligible list (`db.query`), span *name* = parameterized SQL with
    `?`/`$1`-style placeholders, `db.system` attribute set to a real OTel
    identifier (e.g. `sqlite`). Random names like "fetch products" won't
    aggregate.
14. **Template uses `pnpm` upstream** — delete `pnpm-lock.yaml` so the
    standalone demo installs with npm and doesn't entangle with the parent
    pnpm workspace. Keep `SITE_NAME` set (non-null asserted in
    `app/layout.tsx` metadata).
15. **`app/sitemap.ts` calls `validateEnvironmentVariables()`** which throws
    without Shopify env vars — remove that call when mocking, or the sitemap
    route 500s even with a mock provider.
