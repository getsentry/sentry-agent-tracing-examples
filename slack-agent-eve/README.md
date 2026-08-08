# Lunchbot — DoorDash Group-Lunch Agent on Eve + Sentry

A Slack agent for team lunches, built with [Eve](https://eve.dev) (Vercel's
agent framework), with every model call and tool run traced into
[Sentry's AI Agents monitoring](https://docs.sentry.io/product/agents/).
Someone posts a DoorDash group-order link in Slack; the bot looks up the
restaurant via the local `dd-cli`, proposes three in-budget options —
protein-heavy, balanced, and junk — with photos and estimated calories, and
adds each person's pick to the shared group cart. It never checks out; the
group-order host does that.

## The flow

1. A group-order link (`drd.sh/cart/…` or `doordash.com/dd/cart/…`) lands in
   a channel the bot can read — no @mention needed; the link itself triggers
   dispatch (`onMessage` in `agent/channels/slack.ts`).
2. `resolve_group_cart` matches the link against the signed-in DoorDash
   account's open group carts (the share token is opaque, so matching runs
   through `cart list` → `cart show`'s `group_cart_url`). Returns cart UUID,
   store, and the per-person budget (`LUNCH_BUDGET_USD`, default $25).
3. `get_menu` pulls the store's menu; the model picks three in-budget
   candidates and calls `estimate_nutrition` — a dedicated cheap LLM call via
   OpenRouter that returns structured calories/macros (no nutrition numbers
   come from the agent's own weights).
4. The bot posts the three options in-thread as a Block Kit card
   (`present_lunch_options`) — real image blocks for the photos, prices,
   calories, protein. Bare URLs would never preview: eve hardcodes
   `unfurl_links`/`unfurl_media` off on every message it posts.
5. A person picks in the thread. Items with required modifiers go through
   `get_item_details` for the choice list; then `add_to_group_cart` re-prices
   the pick from DoorDash's own item details and **refuses in code** anything
   over the per-person budget before running `cart add-items`.

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
├── instructions.md          system prompt (Lunchbot persona + flow rules)
├── instrumentation.ts       Sentry.init + conversation id, user, Slack context per step
├── lib/dd.ts                dd-cli runner, link-token matching, budget, cart mapping
├── channels/
│   ├── slack.ts             Slack channel; dispatches on group-cart links without a mention
│   └── eve.ts               HTTP channel auth (dev TUI / eve invoke)
└── tools/
    ├── resolve_group_cart.ts   link → cart UUID + store + budget (cart list/show)
    ├── get_menu.ts             menu with prices + photos (menu --store-id)
    ├── get_item_details.ts     modifiers with per-option prices (restaurant-item-details)
    ├── estimate_nutrition.ts   nested OpenRouter generateObject call → calories/macros
    ├── present_lunch_options.ts Block Kit card (photos!) via eve's Card + callSlackApi
    └── add_to_group_cart.ts    code-enforced budget guard → cart add-items
```

Sentry wiring is unchanged from the support-bot iteration of this demo:
`agent/instrumentation.ts` runs at server startup; its `Sentry.init` registers
the global OpenTelemetry tracer provider Eve's AI SDK telemetry flows into,
and `vercelAIIntegration({ force: true })` rewrites those spans into
`gen_ai.*` spans. There is no official Eve + Sentry integration; this composes
both sides' documented primitives.

## Requirements

- Node.js >= 24.
- `dd-cli` (v0.2.1+) installed and signed in **on the machine running the
  agent** (`dd-cli login`; credentials live in the OS keychain). This is why
  the agent loop runs on a Mac/desktop, not on a Vercel deployment — see
  "Slack surface" below.
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
   - `LUNCH_BUDGET_USD` — per-person budget the add tool enforces (default 25)

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
4. Invite the bot to the lunch channel. Post a group-order link — the
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
   ├─ invoke_agent doordash-lunch-agent     gen_ai.invoke_agent — step 1
   │  ├─ generate_content anthropic/…       model decides to resolve the link
   │  └─ execute_tool resolve_group_cart    gen_ai.execute_tool (shells to dd-cli)
   ├─ invoke_agent doordash-lunch-agent     step 2 — get_menu
   ├─ invoke_agent doordash-lunch-agent     step 3
   │  └─ execute_tool estimate_nutrition
   │     └─ generate_content anthropic/claude-haiku-4.5   nested tool-internal LLM call
   └─ invoke_agent doordash-lunch-agent     final step — writes the Slack reply
```

Failed dd-cli invocations throw inside `execute`, so they land in the AI
Agents dashboard's Tool Errors widget and as linked Sentry issues.

## Notes and deviations

- **Budget is enforced in tool code, not instructions**: `add_to_group_cart`
  re-prices the pick from `restaurant-item-details` (base + selected options)
  and returns a refusal instead of calling `cart add-items` when it exceeds
  `LUNCH_BUDGET_USD`. Model-supplied prices are never trusted.
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
- **OpenRouter + Sentry wiring notes** (unchanged from the previous iteration
  of this demo): the provider instance bypasses the AI Gateway;
  `modelContextWindowTokens` is set because Eve can't resolve context windows
  for non-gateway models; `vercelAIIntegration({ force: true })` is required
  because Eve's nitro build bundles `ai`; verify the first trace for doubled
  `ai.streamText` spans before upgrading Sentry past 10.x.
