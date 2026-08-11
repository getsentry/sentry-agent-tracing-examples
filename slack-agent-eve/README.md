# Mealbot — DoorDash Ordering Agent on Eve + Sentry

A Slack agent that orders food, built with [Eve](https://eve.dev) (Vercel's
agent framework), with every model call and tool run traced into
[Sentry's AI Agents monitoring](https://docs.sentry.io/product/agents/).
It does two jobs: order a meal for one person, or add your pick to a shared
group order someone else started. Every pick is logged with its calories and
protein, so a dashboard can track what you ate across the day.

**It never submits an order.** A personal order ends with a DoorDash checkout
link that you complete and pay for; a group order ends at the shared cart,
which the host checks out.

## Personal order

1. Someone asks for food ("find me sushi for dinner"). `find_restaurants`
   searches near the DoorDash account's default delivery address — `search`
   ignores the saved address, so the coordinates come from `address list`.
2. `present_restaurant_options` posts three choices in-thread as a Block Kit
   card with photos and Pick buttons.
3. On a pick, the flow continues through **Choosing a meal** below.
4. `add_to_cart` runs without a `cartUuid`, which creates a personal cart at
   that store.
5. `preview_order` prices it — dd-cli quotes each charge separately and emits
   no total line, so the tool sums the minor units and reports the store's own
   currency.
6. `get_checkout_link` posts the DoorDash URL. The agent stops there.

## Group order

1. A group-order link (`drd.sh/cart/…` or `doordash.com/dd/cart/…`) lands in
   a channel the bot can read — no @mention needed; the link itself triggers
   dispatch (`onMessage` in `agent/channels/slack.ts`).
2. `resolve_group_cart` matches the link against the signed-in DoorDash
   account's open group carts (the share token is opaque, so matching runs
   through `cart list` → `cart show`'s `group_cart_url`). Returns cart UUID,
   store, and the host's per-person spend limit.
3. Continue through **Choosing a meal**, then `add_to_cart` **with** the group
   `cartUuid`.

## Choosing a meal

1. `get_menu` pulls the store's menu; the model picks three in-budget
   candidates and calls `estimate_nutrition` — a dedicated cheap LLM call via
   OpenRouter that returns structured calories/macros (no nutrition numbers
   come from the agent's own weights).
2. The bot posts the three options in-thread as a Block Kit card
   (`present_meal_options`) — real image blocks for the photos, prices,
   calories, protein. Bare URLs would never preview: eve hardcodes
   `unfurl_links`/`unfurl_media` off on every message it posts.
3. A person picks in the thread or with a button. Items with required
   modifiers go through `get_item_details` for the choice list; then
   `add_to_cart` re-prices the pick from DoorDash's own item details and
   **refuses in code** anything over the budget before running `cart
   add-items`. The budget is the group order's own spend limit when there is
   one, else `MEAL_BUDGET_USD` (default $25).

## Architecture

Eve builds the agent from the filesystem: `agent/instructions.md` is the
system prompt, `agent/agent.ts` wires the model (an OpenRouter provider
instance, bypassing the Vercel AI Gateway), and each file in `agent/tools/`
becomes a tool named after the file. Tools shell out to `dd-cli`
(`--json-output`; data under the envelope's `structuredContent`) with a fixed,
sanitized `--intent` string — Slack message text never goes into it.

```
agent/
├── agent.ts                 model: OpenRouter anthropic/claude-sonnet-4.5
├── instructions.md          system prompt (Mealbot persona + both flows)
├── instrumentation.ts       Sentry.init + conversation id, user, Slack context per step
├── lib/dd.ts                dd-cli runner (local or Vercel Sandbox), search, budget, cart mapping
├── lib/conversation.ts      cross-context stash for the Slack thread id
├── channels/
│   ├── slack.ts             Slack channel; dispatches on group-cart links without a mention
│   └── eve.ts               HTTP channel auth (dev TUI / eve invoke)
└── tools/
    ├── find_restaurants.ts        nearby stores near the default address (search)
    ├── present_restaurant_options.ts  Block Kit card of three stores + Pick buttons
    ├── resolve_group_cart.ts      link → cart UUID + store + budget (cart list/show)
    ├── get_menu.ts                menu with prices + photos (menu --store-id)
    ├── get_item_details.ts        modifiers with per-option prices (restaurant-item-details)
    ├── estimate_nutrition.ts      nested OpenRouter generateObject call → calories/macros
    ├── present_meal_options.ts    Block Kit card (photos!) via eve's Card + callSlackApi
    ├── add_to_cart.ts             code-enforced budget guard → cart add-items
    ├── preview_order.ts           read-only pricing (order preview)
    └── get_checkout_link.ts       the URL the person checks out with (order checkout-url)
```

`agent/instrumentation.ts` runs at server startup; its `Sentry.init`
registers the global OpenTelemetry tracer provider. Eve registers
`@ai-sdk/otel` with the AI SDK, so model and tool calls arrive as `gen_ai.*`
spans through that provider — no Sentry AI integration is involved. There is
no official Eve + Sentry integration; this composes both sides' documented
primitives.

Two non-obvious choices live in that file, both of which cost real telemetry
when they are wrong:

- **Sentry's `VercelAI` integration is filtered out of the defaults.** `ai` 7
  exposes the same telemetry through both the integration list on `globalThis`
  (where Eve registers `@ai-sdk/otel`) and the `ai:telemetry` diagnostics
  channel (which that integration subscribes to). Keeping both records every
  call twice and doubles token and cost sums. It is a *default* integration,
  so leaving it out of the `integrations` array does nothing — it has to be
  filtered by name.
- **The default segment trace lifecycle.** An earlier version used
  `traceLifecycle: "stream"` to work around
  [vercel/eve#1854](https://github.com/vercel/eve/issues/1854); Eve 0.32 fixed
  that, and streaming had to go, because it buffers spans and a Vercel
  function freezes as soon as it responds — a deployment reported no AI spans
  at all.

## Running it deployed

`dd-cli` signs in through a browser and keeps its token in the OS keychain,
neither of which exists on Vercel. So `lib/dd.ts` runs the CLI in a **named
Vercel Sandbox** when deployed, authenticated by `DD_CLI_ACCESS_TOKEN` from
`dd-cli export-token`; one sandbox is reused across invocations. Set
`DD_CLI_SANDBOX=0` locally to force the installed binary — `eve deploy`
rewrites `.env.local` with Vercel's system variables, `VERCEL=1` included.
Note that the exported token expires after a few days.

## Requirements

- Node.js >= 24.
- `dd-cli` (v0.2.2+) installed and signed in for local development
  (`dd-cli login`; credentials live in the OS keychain). Deployments don't
  need the binary — see "Running it deployed" above.
- The DoorDash account signed into dd-cli must **host the group order or join
  it in the DoorDash app**. Share links are opaque short tokens
  (`drd.sh/cart/<token>` → `doordash.com/dd/cart/<token>`, verified — no cart
  UUID in the URL), so a link only resolves if the cart is on the account.
  Unresolvable links degrade to recommend-only: the bot still proposes
  options, people add their own picks via the link.

## Setup

1. `npm install`
2. `cp .env.example .env` and fill in:
   - `OPENROUTER_API_KEY` — agent model + nutrition-estimate model
   - `SENTRY_DSN` — Sentry project (Node.js platform), Settings > Client Keys
   - `SLACK_BOT_TOKEN` / `SLACK_SIGNING_SECRET` — only for the Slack surface
   - `MEAL_BUDGET_USD` — budget the add tool enforces (default 25); a group order's own spend limit wins

## Run

```bash
npm run dev          # eve dev — local server + TUI; exercises the full loop incl. dd-cli
npx eve invoke "Options for this group order please: https://drd.sh/cart/XXXX/"
npm run typecheck    # tsc --noEmit
```

In the TUI, paste a group-order link the signed-in account hosts. The bot
should resolve the cart, fetch the menu, and propose three options.

### Slack surface

Slack needs a public webhook URL, but dd-cli only runs where its keychain
credentials live — so for end-to-end testing run the agent locally and expose
it through a tunnel (the undocumented-but-plausible path; Eve's docs only
cover deployed webhooks):

1. Create the Slack app from
   [`slack-app-manifest.yaml`](slack-app-manifest.yaml) ("From a manifest" at
   api.slack.com/apps) and install it. The placeholder request URL is fine at
   this point — manifest creation defers URL verification — but Slack delivers
   no events until step 3 passes.
2. Put `SLACK_BOT_TOKEN` (xoxb-…) and `SLACK_SIGNING_SECRET` (Basic
   Information > App Credentials — not the xapp- app token) in `.env`, then
   start the agent (`npm run dev`) and a tunnel to its port, e.g.
   `cloudflared tunnel --url http://localhost:3000`.
3. In App Settings > Event Subscriptions, set the request URL to
   `https://<tunnel-host>/eve/v1/slack`. Slack sends its `url_verification`
   challenge on save, so the agent and tunnel must be running.
4. Invite the bot to a channel. Post a group-order link — the
   manifest subscribes `message.channels`, so the link alone triggers it;
   @mentions and DMs also work.

## What you'll see in Sentry

One trace per agent turn under **Explore > Traces**, agent aggregates under
**Insights > AI Agents**, and each Slack thread grouped in
**Explore > Conversations** (`instrumentation.ts` sets the thread `ts` as
`gen_ai.conversation.id` and the Slack user id as the user). The interesting
new span shape is `estimate_nutrition`: its `execute_tool` span contains a
nested `gen_ai.generate_content` child — the tool's own OpenRouter
`generateObject` call — because Eve's `registerTelemetry` covers every AI SDK
call in the process:

```
POST /eve/v1/slack                          http.server — inbound Slack webhook
└─ ai.eve.turn
   ├─ invoke_agent anthropic/claude-sonnet-4.5   step 1
   │  ├─ chat anthropic/claude-sonnet-4.5        model decides which tool to call
   │  └─ execute_tool find_restaurants           shells to dd-cli
   ├─ invoke_agent anthropic/claude-sonnet-4.5   step 2 — get_menu
   ├─ invoke_agent anthropic/claude-sonnet-4.5   step 3
   │  └─ execute_tool estimate_nutrition
   │     └─ chat anthropic/claude-haiku-4.5      nested tool-internal LLM call
   └─ invoke_agent anthropic/claude-sonnet-4.5   final step — writes the Slack reply
```

Failed dd-cli invocations throw inside `execute`, so they land in the AI
Agents dashboard's Tool Errors widget and as linked Sentry issues.

## Notes and deviations

- **Budget is enforced in tool code, not instructions**: `add_to_cart`
  re-prices the pick from `restaurant-item-details` (base + selected options)
  and returns a refusal instead of calling `cart add-items` when it exceeds
  `MEAL_BUDGET_USD`. Model-supplied prices are never trusted.
- **Nutrition is a tool, not model knowledge**: `estimate_nutrition` makes its
  own structured OpenRouter call (`NUTRITION_MODEL`, default
  `anthropic/claude-haiku-4.5`). Nutritionix was rejected — its free tier is
  discontinued.
- **dd-cli `--intent`**: every command sends a fixed, honest two-line intent
  (who the workflow serves and why). It deliberately never includes Slack
  message text, per the CLI's own guidance about other people's information.
- **No `.int()` in model-facing Zod schemas**: Zod 4 renders `.int()` (and
  int `.min()`/`.max()`) as JSON-Schema integer `minimum`/`maximum` bounds,
  which Azure-hosted models — where OpenRouter may route any call — reject in
  structured output (`AI_APICallError: … properties maximum, minimum are not
  supported`, seen live on the first Slack turn). Quantities and calories are
  plain `z.number()` with rounding/clamping in tool code.
- **Popularity data is ignored** (`is_popular` / `popularity_rank` stripped in
  `get_menu`) — the CLI docs ask agents not to use it.
- **Idempotency caveat**: Eve re-runs a tool step interrupted mid-execution,
  and `cart add-items` is append-only — a badly timed crash could double-add
  a pick. Acceptable for a demo; a real deployment would de-dupe against
  `cart show` first.
- **OpenRouter wiring notes**: the provider instance bypasses the AI Gateway,
  and `modelContextWindowTokens` is set because Eve can't resolve context
  windows for non-gateway models.
