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
├── instrumentation/
│   └── sentry.ts            Sentry.eveInstrumentation: Sentry.init at startup, conversation id per step, flush before idle
├── hooks/
│   └── sentry.ts            Slack user and conversation tag on the Sentry scope, once per step
├── lib/env.ts               env flag and sample rate parsing
├── lib/dd.ts                dd-cli runner (local or Vercel Sandbox), search, budget, cart mapping
├── lib/conversation.ts      Slack thread and user of a session, recorded by the channel, read by the card tools
├── lib/slack-user.ts        Slack display name lookup for Sentry's User column
├── lib/slack-blocks.ts      the Block Kit shapes the cards post, and chat.postMessage
├── channels/
│   ├── slack.ts             Slack channel; dispatches on group-cart links without a mention
│   └── eve.ts               HTTP channel auth (dev TUI / eve invoke)
└── tools/
    ├── find_restaurants.ts        nearby stores near the default address (search)
    ├── present_restaurant_options.ts  Block Kit card of the stores + Pick buttons
    ├── resolve_group_cart.ts      link → cart UUID + store + budget (cart list/show)
    ├── get_menu.ts                menu with prices + photos (menu --store-id)
    ├── get_item_details.ts        modifiers with per-option prices (restaurant-item-details)
    ├── estimate_nutrition.ts      nested OpenRouter generateText call → calories/macros
    ├── present_meal_options.ts    Block Kit card (photos!) via chat.postMessage
    ├── add_to_cart.ts             code-enforced budget guard → cart add-items
    ├── preview_order.ts           read-only pricing (order preview)
    └── get_checkout_link.ts       the URL the person checks out with (order checkout-url)
```

### How the AI spans reach Sentry

`@sentry/node` 11 ships an eve provider. `agent/instrumentation/sentry.ts`
passes `Sentry.eveInstrumentation(options)` to `defineInstrumentation`. eve
loads every file in `agent/instrumentation/` at server startup, so the
provider's `setup` runs `Sentry.init` before the agent and its tools load. The
provider's `turn.started` and `step.attempt.started` handlers set the eve
session id as the Sentry conversation id on every step, and its `flush` drains
the span buffer before a session idles.

The SDK owns the OpenTelemetry setup. There is no `otel.ts` beside it: with no
`otel()` or `otelIntegration()` file in `agent/instrumentation/`, eve registers
no tracer provider of its own, and Sentry's `vercelAIIntegration` reads the AI
SDK's telemetry directly. One model call is one `gen_ai.*` tree. Measured on a
two-turn `eve dev` run on 2026-09-24 (eve 0.63.0, `@sentry/node` 11.0.0): 151
spans, 4 of them AI, one `invoke_agent mealbot` and one `generate_content
anthropic/claude-sonnet-5` per turn, both carrying the session id as
`gen_ai.conversation.id`. The other 147 are `http.client` and `http.server`
spans from `httpIntegration`; 108 of them are the dev server's calls to its own
event store at `/eve/v1/dev/internal/workflow-world`, which a deployment does
not make. eve's own `workflow.*` and `ai.eve.turn` spans belong to the eve
tracer provider and do not appear.

Three options in the file matter for agent tracing.

**Content capture.** `SENTRY_AI_RECORD_INPUTS` and `SENTRY_AI_RECORD_OUTPUTS`
set `dataCollection.genAI` and `vercelAIIntegration({ recordInputs,
recordOutputs })`. Outside `eve dev`, eve passes `recordInputs: false` and
`recordOutputs: false` to every AI SDK call, and the per-call value wins over
`dataCollection`. The integration option is what keeps prompts and completions
on a deployment.

**Spans stream** (`traceLifecycle: "stream"`), leaving one at a time as they
end rather than bundled into the enclosing transaction. That is the ingest
path that reads `gen_ai.operation.name` off a span and gives it a matching
`gen_ai.*` op, and that op is what puts the span in Insights > AI Agents, in
spend queries, and in front of the AI detectors.

**Every span is kept** (no `ignoreSpans`), so the full inventory is visible.
With `traceLifecycle: "stream"` the SDK evaluates `ignoreSpans` when a span
*starts*, so a rule sees the start-time name and attributes: a fetch span
starts as plain `POST` with no `op`, and only an `attributes` rule on
`url.full` can match it.

**One conversation is one Slack thread.** eve keeps one durable session per
Slack thread, and the provider sets the session id as `gen_ai.conversation.id`
on every step, so the whole thread is one row in Explore > Conversations. A
turn from the local TUI or `eve invoke` has a session too. The Slack user comes
from the channel: `agent/channels/slack.ts` records the thread and the
triggering user per session on `turn.started` and `actions.requested`, from
the channel state eve hydrates on every event, and `agent/hooks/sentry.ts`
sets that user on the Sentry scope at every `step.started`. The card tools
read the same record through `activeSlackThread(ctx)`, so the destination of a
card never comes from a tool argument.

## Running it deployed

`dd-cli` signs in through a browser and keeps its token in the OS keychain,
neither of which exists on Vercel. So `lib/dd.ts` runs the CLI in a **named
Vercel Sandbox** when deployed, authenticated by `DD_CLI_ACCESS_TOKEN` from
`dd-cli export-token`; one sandbox is reused across invocations. Set
`DD_CLI_SANDBOX=0` locally to force the installed binary — `eve deploy`
rewrites `.env.local` with Vercel's system variables, `VERCEL=1` included.
Note that the exported token expires after a few days. Set `DD_CLI_FIXTURES=1`
on the deployment to skip the sandbox and the token altogether.

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

1. `pnpm install`
2. `cp .env.example .env` and fill in:
   - `OPENROUTER_API_KEY` — agent model + nutrition-estimate model
   - `SENTRY_DSN` — Sentry project (Node.js platform), Settings > Client Keys
   - `SLACK_BOT_TOKEN` / `SLACK_SIGNING_SECRET` — only for the Slack surface
   - `MEAL_BUDGET_USD` — budget the add tool enforces (default 25); a group order's own spend limit wins

   `eve dev` reads `.env.development.local`, `.env.local`, `.env.development`
   and `.env`, in that order of precedence. One `.env` covers everything.

## Run

```bash
pnpm dev          # eve dev — local server + TUI; exercises the full loop incl. dd-cli
pnpm eve invoke "Options for this group order please: https://drd.sh/cart/XXXX/"  # one-shot

pnpm typecheck    # tsc --noEmit
pnpm lint         # oxlint
```

`eve invoke` kills its own server child before the SDK can flush, so a one-shot
run can lose spans. `pnpm dev` and a deployment do not.

`DD_CLI_FIXTURES=1` answers every dd-cli call from `agent/lib/dd-fixtures.ts` instead of the
CLI: three restaurants, their menus, and an in-memory cart. Use it to run the agent, the cards
and the Sentry spans with no DoorDash account. Everything else, model calls included, stays
real.

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
   start the agent (`pnpm dev`) and a tunnel to its port, e.g.
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
**Explore > Conversations** (the eve session id, one per Slack thread, is
`gen_ai.conversation.id`; `hooks/sentry.ts` sets the Slack user). The span
names of one Slack turn:

```
POST /eve/v1/slack                       http.server — inbound Slack webhook
invoke_agent mealbot                     step 1
├─ generate_content anthropic/claude-sonnet-5               the model picks a tool
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

Each step is its own segment of the same trace, exported on its own — that is
what lets a turn's later steps reach Sentry at all on a serverless runtime.

`estimate_nutrition` is the interesting one: its `execute_tool` span contains a
whole nested agent call, because Sentry's `vercelAIIntegration` covers every AI
SDK call in the process — including one a tool makes itself. Its own
`telemetry.functionId` keeps it out of the main loop's aggregates.

Tools also emit domain **logs** (`meal.restaurant.presented`,
`meal.option.presented`, `meal.pick.added`, `meal.checkout.offered`) carrying
item, price, calories, protein, the conversation id, and the user. Spans stay
the mechanical record; the logs are the business record a dashboard can sum.

Failed dd-cli invocations throw inside `execute`, so they land in the AI
Agents dashboard's Tool Errors widget and as linked Sentry issues.

### Why a local run and the deployment do not show the same thing

Three mechanisms make local telemetry differ from deployed telemetry. None of
them is a Sentry setting, so none can be tuned away.

**The workflow world changes.** Eve picks its world adapter from
`WORKFLOW_TARGET_WORLD`, and falls back to `vercel` when `VERCEL_DEPLOYMENT_ID`
is set and `local` when it is not. The local world keeps run state in process.
The Vercel world keeps it in a service, and calls that service over HTTP for
every event, stream write, and hook. A local trace therefore has no
`vercel-workflow.com` client spans at all. Anything about the client side of a
trace — including the duplicate spans above — is invisible until you deploy.

**A one-shot process delivers nothing.** Streamed spans queue in a buffer that
drains on a five-second timer, on size, or on `Sentry.flush()`. The timer is
unref'd, so it never keeps the process alive; `eve invoke` ends its worker with
`terminate()`, which runs no exit handler; eve calls the provider's `flush`
before a session idles, not before the process exits; and `@sentry/node`
registers no drain on process exit. One
`eve invoke` turn created 989 spans and sent 0. The same code with
`traceLifecycle` left at its default sent them, because a static transaction is
built and sent at the end of the request rather than queued per span. The line
is one-shot process against long-lived server, not local against deployed:
`eve dev` holds the process open and delivers, and a serverless isolate that is
reclaimed instead of reused drops its tail the same way `eve invoke` does.

**A local run labels itself `production`.** The SDK stamps that environment
when none is given, so local spans land beside deployed ones unless you set
`SENTRY_ENVIRONMENT`.

To compare configurations locally, count spans where they are made — in
`vercelAIIntegration`, or on `client.on("spanEnd")` — and never by what reaches
Sentry. To check the shape of a whole trace, read it from the deployment.

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
