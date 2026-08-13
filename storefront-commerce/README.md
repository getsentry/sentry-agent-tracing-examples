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
- **Shoppers** — the store has no sign-in, so `lib/demo-user` is the whole
  cast: six fictional customers, each with their own orders and loyalty
  status. The browser is always Ada; the traffic runner (below) picks any of
  them per request, which is what gives the spend dashboards more than one
  spender.
- **Sentry** — `@sentry/nextjs` with `vercelAIIntegration`, which turns the AI
  SDK's telemetry into `gen_ai.*` agent spans. `dataCollection` in the three
  `Sentry.init` files decides what is kept from them (prompts, completions,
  tool payloads); `SENTRY_AI_RECORD_INPUTS` / `SENTRY_AI_RECORD_OUTPUTS` switch
  the prompt and response half of that for server, edge, and browser at once,
  and are on when unset. The chat route also sets the Sentry user and
  conversation ID so multi-turn chats group in **Explore → Conversations**, and
  the browser records a session replay for every session.

## Setup

Requires Node.js >= 22.

```bash
npm install
cp .env.example .env.local   # then fill in:
#   OPENROUTER_API_KEY       — required for the assistant
#   NEXT_PUBLIC_SENTRY_DSN   — required to send traces to Sentry
```

Everything else in `.env.example` is optional (model override, source map
upload, branding). The build itself needs no env vars at all.

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
alongside agent tracing.

## Filling the dashboards

A demo dashboard with one user and one model reads as a bug. `scripts/traffic.ts`
replays scripted conversations against a running store — real HTTP requests,
so the traces are the same ones a browser session produces:

```bash
npm run dev
npm run traffic -- --dry-run          # show the plan, send nothing
npm run traffic                       # 20 conversations across six shoppers
npm run traffic -- --seed 42 --concurrency 4
npm run traffic -- --base-url http://localhost:4930   # dev server on another port
```

`scripts/scenarios.ts` holds both halves: the conversation scripts (gift
hunting, sizing, order status, refunds — including the one that trips the
planted bug) and the cast, weighted so spend is lopsided. Grace runs long
sessions on the priciest model and tops the spend table; Radia asks one-line
questions on the cheapest. Models come from `lib/ai/models.ts`, all current
OpenRouter ids, because Sentry derives `gen_ai.cost.*` from OpenRouter's
pricing feed — an id that feed does not carry silently costs nothing.

The runner picks the shopper and model with the `x-demo-shopper` and
`x-demo-model` request headers. Both resolve through an allow-list and fall
back to the defaults, so they only choose between fixtures.
