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
├── lib/conversation.ts      conversation id of a turn (Slack thread, else session id), keyed by the turn's trace id
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
Eve + Sentry integration; this composes both sides' documented primitives.

Eve calls `registerTelemetry` with `@ai-sdk/otel`, so the AI SDK emits an OTel
span per model call and tool call (`ai.eve.turn`, `ai.streamText`,
`ai.toolCall`) through that provider. Three settings in that file make those
spans usable.

**Only one producer.** `ai` 7 also publishes the same telemetry to Node's
`ai:telemetry` diagnostics channel, and Sentry's `VercelAI` integration is on
by default and subscribes to it. That opens a second `gen_ai.*` tree beside
eve's for the same work — same `gen_ai.usage.*` on both copies, so every model
call counts twice in the spend dashboard and the AI detectors. Eve's telemetry
has no off switch (`otelSettings` is enabled by this file existing), so the
integration is what `integrations` filters out.

**Spans stream** (`traceLifecycle: "stream"`), leaving one at a time as they
end rather than bundled into the enclosing transaction. That is the ingest
path that reads `gen_ai.operation.name` off a span and gives it a matching
`gen_ai.*` op — and that op is what puts the span in Insights > AI Agents, in
spend queries, and in front of the AI detectors. Confirmed in Sentry for both
an `eve dev` run and a Slack turn on the deployment.

Streamed spans leave through a buffer that drains on a five-second timer, on
size, or on an explicit `Sentry.flush()`. Eve's config-layout instrumentation
ends at `step.started`, so there is no end-of-turn hook to flush from: on a
serverless host the last spans of a turn wait for the next invocation to thaw
the function, and an isolate that is reclaimed instead of reused loses them.
Eve's provider layout (`experimental.instrumentationProviders`) adds a `flush()`
hook that eve awaits before a session idles. The two layouts are exclusive, and
no provider event carries the Slack thread, channel, or user, so moving to it
buys the flush and costs the conversation grouping and user attribution below.
This demo keeps the config layout for that reason.

**One span per HTTP call** (`ignoreSpans`). Vercel Workflow, vendored inside
eve, opens its own CLIENT and SERVER spans around every workflow request and
stream write. Sentry rewrites the name of any CLIENT or SERVER span that
carries `http.request.method` to `METHOD target`, and a `manual` origin does
not exempt it. Sentry's `httpIntegration` and `nativeNodeFetchIntegration`
already cover those same calls through Node's diagnostics channel, so each
request arrives twice under one name, the second copy nested inside the first.
`ignoreSpans` drops eve's copy. It matches the names eve gives the spans, not
the rewritten ones, because the test runs when the span starts — which needs
`traceLifecycle: "stream"`. Children of a dropped span are re-linked to its
parent, so nothing is orphaned. Measured on one `workflowEntry` run in
production: 44 spans without it, 34 with it, same tree otherwise. Removing the
two HTTP integrations instead also removes the pairs, but it takes the model
call, both endpoints, and trace propagation with them.

Comparing both halves of a pair in production, the dropped span carries one
attribute the kept one does not — `peer.service`, which repeats
`server.address`. Everything that carries eve's own meaning stays:
`workflow.execute`, `step.execute`, `world.events.create`,
`workflow.stream.flush`, `hook.resume`, `queue.publish`, `workflow.route.init`.
Eve's `traceChannelRequests` is left off for the same reason, with one known
cost: it is the only span source for the SSE stream route, which
`httpIntegration` does not cover.

**One conversation is one Slack thread.** `beforeSendSpan` stamps
`gen_ai.conversation.id` on the AI spans, which is what groups them in
Explore > Conversations. A Slack turn uses its thread, so the whole thread is
one conversation; anything else (the local TUI, `eve invoke`) falls back to
eve's session id, which likewise spans every turn of that conversation. A
delegated subagent runs in its own session and is attributed to the root, so
delegating does not split a conversation in two. The value is resolved in
`step.started` and handed over by trace id, because `beforeSendSpan` can run
in eve's replay context where the scope that recorded it is not reachable.
Only a turn's first step carries the Slack thread, so the thread is cached per
session in this process: a continuation step that lands in a cold isolate falls
back to the session id and opens a second row for the same thread. Carrying the
thread in eve's durable session state would remove that.

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
npx eve invoke "Options for this group order please: https://drd.sh/cart/XXXX/"  # one-shot

npm run typecheck    # tsc --noEmit
npm run lint         # oxlint
```

`eve invoke` kills its own server child before the SDK can flush, so a one-shot
run can lose spans. `npm run dev` and a deployment do not.

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
one Slack turn:

```
POST /eve/v1/slack                       http.server — inbound Slack webhook
└─ eve.turn                              eve's turn span — opened and ended inside step 1
   └─ invoke_agent mealbot               step 1
      ├─ chat anthropic/claude-sonnet-5               the model picks a tool
      └─ execute_tool find_restaurants                shells out to dd-cli

invoke_agent mealbot                     step 2 — its own segment of the same trace
├─ chat anthropic/claude-sonnet-5
└─ execute_tool get_menu

invoke_agent mealbot                     step 3
├─ chat anthropic/claude-sonnet-5
└─ execute_tool estimate_nutrition
   └─ invoke_agent nutrition-estimator   the tool's own OpenRouter call
      └─ chat openai/gpt-5.6-luna
```

Only step 1 runs inside `eve.turn`. Each later step restores the turn's trace
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
`terminate()`, which runs no exit handler; eve's flush hooks in this config
layout are empty; and `@sentry/node` registers no drain on process exit. One
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
`beforeSendSpan`, or on `client.on("spanEnd")` — and never by what reaches
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
