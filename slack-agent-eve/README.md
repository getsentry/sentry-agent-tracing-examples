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
2. `present_restaurant_options` posts the choices in-thread as a Block Kit
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
├── agent.ts                 model: OpenRouter anthropic/claude-sonnet-5
├── instructions.md          system prompt (Mealbot persona + both flows)
├── instrumentation.ts       Sentry.init + conversation id, user, Slack context per step
├── lib/dd.ts                dd-cli runner (local or Vercel Sandbox), search, budget, cart mapping
├── lib/conversation.ts      Slack thread id of a turn, keyed by the turn's trace id
├── lib/slack-blocks.ts      the Block Kit shapes the cards post, and chat.postMessage
├── lib/agent-name.ts        the agent's name in Sentry's AI views
├── channels/
│   ├── slack.ts             Slack channel; dispatches on group-cart links without a mention
│   └── eve.ts               HTTP channel auth (dev TUI / eve invoke)
└── tools/
    ├── find_restaurants.ts        nearby stores near the default address (search)
    ├── present_restaurant_options.ts  Block Kit card of the stores + Pick buttons
    ├── resolve_group_cart.ts      link → cart UUID + store + budget (cart list/show)
    ├── get_menu.ts                menu with prices + photos (menu --store-id)
    ├── get_item_details.ts        modifiers with per-option prices (restaurant-item-details)
    ├── estimate_nutrition.ts      nested OpenRouter generateObject call → calories/macros
    ├── present_meal_options.ts    Block Kit card (photos!) via chat.postMessage
    ├── add_to_cart.ts             code-enforced budget guard → cart add-items
    ├── preview_order.ts           read-only pricing (order preview)
    └── get_checkout_link.ts       the URL the person checks out with (order checkout-url)
```

### How the AI spans reach Sentry

`agent/instrumentation.ts` runs at server startup, and its `Sentry.init`
registers the global OpenTelemetry tracer provider. There is no official
Eve + Sentry integration; this composes both sides' documented primitives, and
two independent paths end up describing the same calls:

- Eve calls `registerTelemetry` with `@ai-sdk/otel`, so the AI SDK emits an
  OTel span per model call and tool call (`ai.eve.turn`, `ai.streamText`,
  `ai.toolCall`) through that provider.
- `ai` 7 also publishes the same telemetry to Node's `ai:telemetry`
  diagnostics channel. Sentry's `VercelAI` integration — on by default, and
  listed in `integrations` anyway so the AI wiring is readable in one place —
  subscribes to that channel and opens its own `gen_ai.*` spans. It also
  installs the span processors that map the OTel spans above onto matching
  `gen_ai.*` ops.

That mapping is what the AI product runs on: without it those spans still
arrive, but as `op:default`, invisible to Insights > AI Agents, to spend
queries, and to the AI detectors. Left alone, the processors attach only once
Sentry's `Modules` integration has found `ai` among the dependencies of the
`package.json` in the process's working directory — which a built server need
not be started from. `instrumentation.ts` passes
`Sentry.vercelAIIntegration({ force: true })` instead, which attaches them
unconditionally. (The other trigger — patching the `ai` module itself —
supports `ai` below 7 only, so it never fires here.)

The cost of running both paths is duplication: each model call and tool call
gets two spans, one from each. They are told apart by span origin —
`auto.vercelai.channel` for the diagnostics-channel copy,
`auto.vercelai.otel` for eve's. Both copies carry the same
`gen_ai.usage.*` token attributes, so a hand-written sum over every `gen_ai`
span in a trace doubles the token count; filter by origin when you query
spend directly.

The second non-obvious choice in that file is the **default segment trace
lifecycle**: spans are exported while the request is still open. Streaming
export (`traceLifecycle: "stream"`) buffers them instead, and a Vercel function
freezes the moment it responds, which loses whatever is still buffered.

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
  (`drd.sh/cart/<token>` → `doordash.com/dd/cart/<token>` — no cart UUID in
  the URL), so a link only resolves if the cart is on the account.
  Unresolvable links degrade to recommend-only: the bot still proposes
  options, people add their own picks via the link.

## Setup

1. `npm install`
2. `cp .env.example .env` and fill in:
   - `OPENROUTER_API_KEY` — agent model + nutrition-estimate model
   - `SENTRY_DSN` — Sentry project (Node.js platform), Settings > Client Keys
   - `SLACK_BOT_TOKEN` / `SLACK_SIGNING_SECRET` — only for the Slack surface
   - `MEAL_BUDGET_USD` — budget the add tool enforces (default 25); a group order's own spend limit wins

   `eve dev` reads `.env.development.local`, `.env.local`, `.env.development`
   and `.env`, in that order of precedence. One `.env` covers everything.

## Run

```bash
npm run dev          # eve dev — local server + TUI; exercises the full loop incl. dd-cli
npx eve invoke "Options for this group order please: https://drd.sh/cart/XXXX/"
npm run typecheck    # tsc --noEmit
npm run lint         # oxlint
```

In the TUI, paste a group-order link the signed-in account hosts. The bot
should resolve the cart, fetch the menu, and propose three options.

### Slack surface

Slack needs a public webhook URL, but dd-cli only runs where its keychain
credentials live — so for end-to-end testing run the agent locally and expose
it through a tunnel (Eve's own docs only cover deployed webhooks):

1. Create the Slack app from
   [`slack-app-manifest.yaml`](slack-app-manifest.yaml) ("From a manifest" at
   api.slack.com/apps) and install it. The request URL it carries points at
   the production deployment; leaving it there is fine for now, because
   manifest creation defers URL verification — but Slack delivers nothing to
   your machine until step 3 passes.
2. Put `SLACK_BOT_TOKEN` (xoxb-…) and `SLACK_SIGNING_SECRET` (Basic
   Information > App Credentials — not the xapp- app token) in `.env`, then
   start the agent (`npm run dev`) and a tunnel to its port, e.g.
   `cloudflared tunnel --url http://localhost:3000`.
3. In App Settings, set both request URLs to
   `https://<tunnel-host>/eve/v1/slack` — Event Subscriptions (Slack sends its
   `url_verification` challenge on save, so the agent and tunnel must be
   running) and Interactivity & Shortcuts, which carries the Pick buttons.
4. Invite the bot to a channel. Post a group-order link — the
   manifest subscribes `message.channels`, so the link alone triggers it;
   @mentions and DMs also work.

## What you'll see in Sentry

One trace per agent turn under **Explore > Traces**, agent aggregates under
**Insights > AI Agents**, and each Slack thread grouped in
**Explore > Conversations** (`instrumentation.ts` sets the thread `ts` as
`gen_ai.conversation.id` and the Slack user id as the user). The span names of
one turn:

```
POST /eve/v1/slack                       http.server — inbound Slack webhook
└─ eve.turn                              eve's turn span — opened and ended inside step 1
   └─ invoke_agent mealbot               step 1
      ├─ generate_content anthropic/claude-sonnet-5   the model picks a tool
      └─ execute_tool find_restaurants                shells out to dd-cli

invoke_agent mealbot                     step 2 — its own segment of the same trace
├─ generate_content anthropic/claude-sonnet-5
└─ execute_tool get_menu

invoke_agent mealbot                     step 3
├─ generate_content anthropic/claude-sonnet-5
└─ execute_tool estimate_nutrition
   └─ invoke_agent nutrition-estimator   the tool's own OpenRouter call
      └─ generate_content openai/gpt-5.6-luna
```

Two shapes in there are worth knowing:

- Every `invoke_agent` / `generate_content` / `execute_tool` span appears
  **twice**, once per origin — see "How the AI spans reach Sentry" above. The
  tree lists each one once for readability.
- Only step 1 runs inside `eve.turn`. Each later step restores the turn's trace
  context as a *remote* parent, which makes it a local root: same trace, own
  segment, exported on its own. That is what lets a turn's later steps reach
  Sentry at all on a serverless runtime.

`estimate_nutrition` is the interesting one: its `execute_tool` span contains a
whole nested agent call, because eve's `registerTelemetry` covers every AI SDK
call in the process — including one a tool makes itself. Its own
`telemetry.functionId` keeps it out of the main loop's aggregates.

Tools also emit domain **logs** (`meal.restaurant.presented`,
`meal.option.presented`, `meal.pick.added`, `meal.checkout.offered`) carrying
item, price, calories, protein, the conversation id, and the user. Spans stay
the mechanical record; the logs are the business record a dashboard can sum.

Failed dd-cli invocations throw inside `execute`, so they land in the AI
Agents dashboard's Tool Errors widget and as linked Sentry issues.

## Notes and deviations

- **Budget is enforced in tool code, not instructions**: `add_to_cart`
  re-prices the pick from `restaurant-item-details` (base + selected options)
  and returns a refusal instead of calling `cart add-items` when it exceeds
  `MEAL_BUDGET_USD`. Model-supplied prices are never trusted.
- **Nutrition is a tool, not model knowledge**: `estimate_nutrition` makes its
  own structured OpenRouter call (`NUTRITION_MODEL`, default
  `openai/gpt-5.6-luna`). Nutritionix was the alternative; its free tier is
  discontinued.
- **dd-cli `--intent`**: every command sends a fixed, honest two-line intent
  (who the workflow serves and why). It deliberately never includes Slack
  message text, per the CLI's own guidance about other people's information.
- **No `.int()` in model-facing Zod schemas**: Zod 4 renders `.int()` (and
  int `.min()`/`.max()`) as JSON-Schema integer `minimum`/`maximum` bounds,
  which Azure-hosted models — where OpenRouter may route any call — reject in
  structured output (`AI_APICallError: … properties maximum, minimum are not
  supported`). Quantities and calories are plain `z.number()` with
  rounding/clamping in tool code.
- **Popularity data is ignored** (`is_popular` / `popularity_rank` stripped in
  `get_menu`) — the CLI docs ask agents not to use it.
- **Idempotency caveat**: Eve re-runs a tool step interrupted mid-execution,
  and `cart add-items` is append-only — a badly timed crash could double-add
  a pick. Acceptable for a demo; a real deployment would de-dupe against
  `cart show` first. The card-posting tools do de-dupe, on the triggering
  Slack message ts.
- **OpenRouter wiring notes**: the provider instance bypasses the AI Gateway,
  and `modelContextWindowTokens` is set because Eve can't resolve context
  windows for non-gateway models.
