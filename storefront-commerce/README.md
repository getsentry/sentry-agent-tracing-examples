# Acme Store — AI Shopping Assistant, traced with Sentry

A real storefront with an AI shopping assistant embedded in it, instrumented
end to end with [Sentry AI agent monitoring](https://docs.sentry.io/product/agents/).
Open the assistant, ask for a hoodie or your recent orders, then open Sentry
and watch the whole turn unfold as one trace: agent → model calls → tool
executions → database queries.

Built on the [Next.js Commerce](https://github.com/vercel/commerce) template
(MIT © Vercel, Inc. — see `license.md`), keeping its storefront UI intact.

## Architecture

- **Storefront** — the Next.js Commerce template on Next 16 (App Router, PPR,
  `use cache`). Its Shopify data layer is replaced by `lib/commerce`, which
  exposes the exact same functions and types, so every template component
  works unchanged.
- **Fake database** — `lib/db` is an in-memory catalog (12 products, six
  customers, their orders). Every accessor is async with jittered 20–120 ms
  latency and wrapped in a Sentry `db.query` span with a parameterized SQL name
  (`SELECT * FROM products WHERE handle = ?`), so traces and Sentry's Queries
  insights look like a real database is behind the store.
- **Assistant** — a slide-over chat panel (AI Elements + `useChat`) streaming
  from `app/api/chat`, which runs the AI SDK's `streamText` with the
  OpenRouter provider and four tools: `searchProducts`, `getProduct`,
  `getAccountInfo`, and `refundOrder`. Tool results render as
  **generative UI** — real product cards linking into the storefront, and an
  account card with orders and loyalty status. `refundOrder` carries the
  demo's planted bug: orders that predate the June 2026 payments launch have
  no payment record, so refunding one throws mid-conversation while newer
  orders refund fine.
- **Shopper** — the store has no sign-in, so `lib/demo-user` holds the one
  fictional customer the browser is signed in as. Every Sentry error, trace,
  and replay carries them as the user.
- **Sentry** — `@sentry/nextjs`, which loads `vercelAIIntegration` on its own
  and turns the AI SDK's telemetry into `gen_ai.*` agent spans. `dataCollection` in the three
  `Sentry.init` files decides what is kept from them (prompts, completions,
  tool payloads); `SENTRY_AI_RECORD_INPUTS` / `SENTRY_AI_RECORD_OUTPUTS` switch
  the prompt and response half of that for server and browser — edge's copy is
  present but never runs — and are on when unset. The three files spell out
  the categories to switch off: headers, bodies, cookies, query params,
  GraphQL, and stack-frame variables. `databaseQueryData` stays on at its
  default, so `db.query` spans keep their parameters and results; supplying
  the key at all switches the baseline to the SDK's all-on defaults, so
  omitting a category is not safe. The chat route also sets the Sentry user and
  conversation ID so multi-turn chats group in **Explore → Conversations**, and
  the browser records a session replay for every session. The replay is
  unmasked, so it carries the rendered answers and account details whatever the
  two content switches say — they only cover span content. The store's one
  shopper is fictional; keep Replay's masking defaults where the customers are
  real.

## Setup

Requires Node.js >= 22.

```bash
npm install
cp .env.example .env.local   # then fill in:
#   OPENROUTER_API_KEY       — required for the assistant
#   NEXT_PUBLIC_SENTRY_DSN   — required to send traces to Sentry
```

Everything else in `.env.example` is optional (model override, source map
upload, branding). A deployment needs `SENTRY_AUTH_TOKEN`, which uploads
source maps — without it, stack traces in Sentry stay minified.

## Run

```bash
npm run dev
```

Browse the store, click the sparkles button (bottom right), and try:

- “Find me a hoodie” → `searchProducts` → product cards
- “Gift ideas for a desk setup” → the agent searches, then narrates
- “Where is my order?” → `getAccountInfo` → account card with live order status
- “Refund my last order” → `refundOrder` → confirmation, then a refund through
  the fake AcmePay gateway
- “Refund order 1029” → `refundOrder` throws on the pre-payments-launch
  order — the agent apologizes while Sentry gets the trace-connected error,
  linked to the session replay

## What you'll see in Sentry

One chat turn produces a single trace (AI spans appear in **Insights → AI
Agents**, DB spans in **Insights → Queries**):

```
POST /api/chat                                          http.server
└── invoke_agent shopping-assistant                     gen_ai.invoke_agent
    ├── generate_content anthropic/claude-sonnet-5      gen_ai.generate_content
    ├── execute_tool searchProducts                     gen_ai.execute_tool
    │   └── SELECT * FROM products WHERE …              db.query
    ├── generate_content anthropic/claude-sonnet-5      gen_ai.generate_content
    └── …more tool/model steps until the answer
```

- **gen_ai spans** carry the model, token usage (and derived cost), recorded
  prompts/outputs, and tool arguments/results.
- **db.query spans** nest under the tool that triggered them, named as
  parameterized SQL so Queries insights aggregates them.
- The **AI Agents dashboard** groups everything under the
  `shopping-assistant` agent (via `telemetry.functionId`), and each chat
  session appears as one conversation.

Storefront page loads produce ordinary Next.js traces whose `db.query` spans
come from the same fake database — so the demo also shows classic tracing
alongside agent tracing. Under `next dev` every navigation re-renders and
queries. A production build serves cached pages, so the same navigation can
produce no `db.query` spans.

## Choosing a model

`OPENROUTER_MODEL` picks the model, defaulting to
`anthropic/claude-sonnet-5`. It is parsed against the allow-list in
`lib/ai/models.ts`, which holds current OpenRouter ids only: Sentry derives
`gen_ai.cost.*` from OpenRouter's pricing feed, so an id that feed does not
carry silently costs nothing.
