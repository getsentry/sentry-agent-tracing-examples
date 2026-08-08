# Next steps (handoff — written 2026-08-07)

State: all three demos build/typecheck green, verified against live docs. **No live LLM call has been made yet** — nothing has real keys.

## 1. First local test pass (per-demo runbooks in ARCHITECTURE.md)

Each project needs `.env` from its `.env.example`: `OPENROUTER_API_KEY` + a Sentry DSN
(storefront uses `NEXT_PUBLIC_SENTRY_DSN`; flue harness also needs `SENTRY_TRACES_SAMPLE_RATE=1`).

Open verification items once traffic flows:

- **slack-agent-eve**: check the first trace for duplicated `ai.streamText` spans
  (eve calls the AI SDK's `registerTelemetry`; SDK-source analysis says no duplication
  on `@sentry/node` ^10, unverified live — details in that README). Also confirm
  Explore → Conversations groups turns via `Sentry.setConversationId`.
- **storefront-commerce**: confirm `db.query` spans nest under `gen_ai.execute_tool`
  and show in Insights → Queries; model-call spans render as `gen_ai.generate_content`
  (not `gen_ai.chat`) — expected, documented in ARCHITECTURE.md.
- **github-harness-flue**: `npm run demo` end-to-end; `@flue/runtime@2.0.3` bundles
  pi-ai 0.83.0 — both model IDs verified present in that catalog.

`research/` holds the four deep-dive files (eve, flue, storefront, sentry) the demos
were built from — verbatim API surfaces, exact versions, gotchas. Check there before
re-deriving anything.

## 2. DoorDash group-lunch agent (BUILT 2026-08-07 — slack-agent-eve is now this)

The planned flow is implemented: slack-agent-eve was rewritten from the
outdoor-gear support bot into "Lunchbot" (group-order link in Slack → 3
in-budget options with photos + tool-estimated calories → in-thread pick →
`add_to_group_cart` with a code-enforced budget guard). See that demo's
README for architecture, and `slack-app-manifest.yaml` for the Slack app.
Typecheck + `eve info` discovery green; dd-cli layer verified against the
live CLI (real search/menu/item/cart calls, temp group cart created and
deleted). **Not yet exercised with a live model key or a real Slack app.**

Findings that superseded the old probe notes (all verified live, v0.2.1):

- Group carts DO exist in dd-cli: `cart add-items --group-cart` creates one
  (response + `cart show` carry `group_cart_url`; `--cart-uuid` at another
  consumer's group cart attaches the caller). The old "no group-order
  commands" blocking test is resolved — group carts appear in `cart list`.
- BUT share links are opaque: `https://drd.sh/cart/<token>/` 301s to
  `doordash.com/dd/cart/<token>/` — no cart UUID in the URL. Resolution =
  match the posted link against each open cart's `group_cart_url`
  (`cart list` → `cart show`). Consequence: the signed-in account must host
  or have joined the group order; otherwise recommend-only fallback.
- Menu/item shapes: prices are dollars floats; ids prefixed (`i_`/`o_`/`e_`,
  strip before use); `restaurant-item-details` nests under `.item`;
  `extras[].min_num_options>0` = required group; search without `--lat/--lng`
  falls into an address-picker state (`needs_address: true`) — resolve
  coords via `address list` first.

Open verification (needs OPENROUTER_API_KEY + Slack app):

- First live Slack turn ran 2026-08-08: `gen_ai` spans confirmed in the
  project (invoke_agent / execute_tool / generate_content), and the Slack
  thread appears in Explore > Conversations (conversation id = thread `ts`,
  first input `<slack_message>…`). STILL unverified: the nested
  `generate_content` inside `execute_tool estimate_nutrition` — the tool
  errored on that turn (see canned demo error below); re-check on the next
  successful turn. Doubled `ai.streamText` spans also still unchecked.
- ~~The local `eve dev` + tunnel Slack story~~ VERIFIED 2026-08-07: a signed
  url_verification challenge sent through cloudflared to the local
  /eve/v1/slack route came back 200 with the challenge echoed; unsigned
  POSTs get 401. Also: Slack defers request_url verification for
  manifest-created apps — the app installs fine with a placeholder URL, but
  delivers no events until the URL is verified in Event Subscriptions.
- `order preview --include-work-benefits` — still unexplored; relevant if
  lunches run on DoorDash for Work.

Canned demo error (currently FIXED in code — keep for the Sentry error story):

- The first live turn produced `AI_APICallError: [Azure]
  output_config.format.schema: For 'integer' type, properties maximum,
  minimum are not supported` — Zod 4 renders `.int()` (and int
  `.min()`/`.max()`) as JSON-Schema integer bounds; OpenRouter routed the
  estimate_nutrition Haiku call to an Azure-hosted provider that rejects
  them. Captured as issue SLACK-AGENT-EVE-2 (12 events: SDK retries × two
  queue deliveries), Slack user attached, linked to the turn traces.
- Bonus side effect worth demoing: the crash mid-turn made eve's workflow
  queue redeliver and re-run the turn ("Re-executing inline steps owned by
  this queue message"), double-posting the Slack reply — the append-only
  idempotency caveat from the README, live.
- To re-trigger on demand: revert `calories: z.number()` to
  `z.number().int()` in `agent/tools/estimate_nutrition.ts` (the
  quantity fields in add_to_group_cart got the same fix — leave those),
  restart, post a group-order link. Caveat: it only fires when OpenRouter
  routes to Azure, which is nondeterministic — it did on every attempt that
  night (12/12), but a guaranteed-error fallback is setting NUTRITION_MODEL
  to a bogus slug. Reverting makes SLACK-AGENT-EVE-2 regress, which is
  itself a good demo beat (resolve it first, then regress it).

Slack polish — BUILT 2026-08-08 (`present_lunch_options` tool), verify live:

- Root cause was eve hardcoding `unfurlLinks:false, unfurlMedia:false` in
  `buildPostMessageOptions` (packages/eve/src/public/channels/slack/api.ts;
  not configurable, no docs/issues/discussions explain it — Block Kit cards
  are clearly the intended rich path: docs mention `initialMessage` Card,
  HITL renders Block Kit).
- The fix uses only public eve 0.31.1 exports from `eve/channels/slack`:
  `Card`/`CardText`/`Image`/`Divider` + `cardToBlocks`/`cardToFallbackText`
  + `callSlackApi` (chat.postMessage; botToken undefined falls back to env
  SLACK_BOT_TOKEN). Issue vercel/eve#351 asks for more helper exports, but
  these already exist. Tools get no thread handle (ToolContext has no
  channel access), so the model passes channelId/threadTs — reliable
  because eve's `<slack_message>` envelope in the prompt includes
  `channel_id:` and `thread_ts:` lines (verified in
  dist model-context.js).
- Card VERIFIED live 2026-08-08 (photos rendered, one-line reply, nutrition
  numbers present — nutrition fix held). Feedback round 2 (built, verify):
  raw Block Kit sections with `accessory` image thumbnails replace
  full-width image blocks (eve's cardToBlocks has no accessory support —
  that's why the tool now emits raw blocks); instructions now build combo
  options targeting 70–100% of budget (guard note: add_to_group_cart
  enforces per-item price in code; combo-total discipline is
  instructions-only so far).
- Buttons on the options (open): eve supports interactivity — `onAction` /
  `onInteraction` hooks on slackChannel, Actions/Button card elements,
  interactions route. Needs `interactivity` + request_url added to the app
  manifest and a handler mapping button clicks to turns. Not started.
- Mentions dropped (found + fixed, verify): a live channel mention took
  eve's defaultOnAppMention path (dispatches with a Slack auth context) and
  produced no turn, no log line; link messages via our onMessage
  ({auth: null}) always worked. slack.ts now defines onAppMention +
  onDirectMessage returning {auth: null}. Also: eve routes mention-bearing
  channel messages ONLY to onAppMention (onMessage explicitly excludes
  texts containing <@botId>), and Slack sends no events at all for
  mentions of a bot not yet in the channel.
- Conversations truncation (found + fixed, verify): only each turn's first
  step carried gen_ai.conversation.id — continuation steps arrive via
  eve's workflow queue with a non-slack channel kind, so the
  instrumentation isChannel guard skipped them (span query proved it:
  3 untagged vs 1 tagged per op). instrumentation.ts now caches
  channel/thread/user per session id and tags every step.
