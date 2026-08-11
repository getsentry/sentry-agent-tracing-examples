# LLM spend per user in Sentry: cost model, attribution, dashboards, fixtures, export

Research date: 2026-08-08. All claims traced to primary sources: docs.sentry.io,
develop.sentry.dev, and source on GitHub master for `getsentry/relay`,
`getsentry/sentry`, `getsentry/snuba`, `getsentry/sentry-javascript`,
`getsentry/sentry-conventions`, `sentry-demos/empower`. Line numbers are from
master at research time and will drift. Anything not confirmed from a primary
source is marked **UNVERIFIED**.

TL;DR

- Cost is computed **server-side by Relay** (processing mode) from a pricing
  table Sentry refreshes **every 30 minutes** from OpenRouter and models.dev.
  The SDK sends only token counts and model name.
- The cost attribute to sum is **`gen_ai.cost.total_tokens`** (USD, despite the
  name). Filter `gen_ai.operation.type:ai_client` to avoid double counting.
- Per-user grouping works via **`user.id`** (from `Sentry.setUser`), which the
  JS SDK stamps onto every streamed span and Relay stamps onto every
  transaction-embedded span.
- Backdating: transactions are **hard-dropped** if start/end fall outside
  `now - 5 days .. now + 60 s` (Relay's spans-namespace aggregator range);
  standalone EAP spans have no Relay-side past limit but Snuba can DLQ
  anything before the current ISO week's Monday 00:00 UTC.
- Export: `GET /api/0/organizations/{org}/events/?dataset=spans` (documented
  "Query Explore Events in Table Format"), Link-header cursor pagination,
  90-day standard retention.

---

## 1. Cost data model

### Who computes cost

**Sentry computes cost server-side.** The SDK never sends a cost attribute for
supported integrations; it sends token counts and the model name, and Relay
(running in processing mode, i.e. Sentry SaaS / the processing Relay of a
self-hosted install) computes USD costs during normalization.

- Docs: "Sentry calculates costs server-side by mapping token usage to pricing
  data" — https://docs.sentry.io/product/agents/costs/ (fetched as
  `/product/agents/costs.md`).
- Relay, transaction-embedded spans: `extract_ai_model_cost_data()` in
  `relay-event-normalization/src/normalize/span/ai.rs` (~lines 202–256)
  — doc comment: "Calculates the cost of an AI model based on the model cost
  and the tokens used. Calculated cost is in US dollars."
- Relay, standalone EAP spans: `normalize_ai_costs()` in
  `relay-event-normalization/src/eap/ai.rs` (~lines 157–225). Module doc
  (lines 11–21): "This aggressively overwrites existing AI attributes … an
  OTel user may be manually instrumenting AI request costs … in a local
  currency. Sentry's AI model requires a consistent cost value." So when Relay
  can compute a cost, it **overwrites** any SDK-supplied `gen_ai.cost.*`
  values; when it cannot (unknown model), SDK-supplied cost attributes are
  left as-is (see `test_normalize_ai_does_not_overwrite` in the same file).

### Input attributes (what the SDK must send)

Canonical names per https://develop.sentry.dev/sdk/telemetry/traces/modules/ai-agents/
and `getsentry/sentry-conventions` (`model/attributes/gen_ai/*.json`):

| Attribute | Meaning |
|---|---|
| `gen_ai.request.model` | Requested model (required on ai_client spans) |
| `gen_ai.response.model` | Actual response model; Relay defaults it to `gen_ai.request.model` if missing (`normalize_model()`, `relay-event-normalization/src/eap/ai.rs` ~lines 66–78). **Cost lookup is keyed on `gen_ai.response.model`.** |
| `gen_ai.usage.input_tokens` | Input tokens, **including** cached tokens |
| `gen_ai.usage.output_tokens` | Output tokens, **including** reasoning tokens |
| `gen_ai.usage.total_tokens` | input + output; Relay computes it if missing (`normalize_total_tokens()`) |
| `gen_ai.usage.cache_read.input_tokens` | Cached (cache-hit) input tokens — subset of input_tokens |
| `gen_ai.usage.cache_creation.input_tokens` | Cache-write input tokens — subset of input_tokens |
| `gen_ai.usage.reasoning.output_tokens` | Reasoning tokens — subset of output_tokens |

Legacy aliases (still accepted; marked `"deprecation": {"_status": "backfill"}`
in sentry-conventions, meaning Relay copies the value to the replacement key —
`relay-conventions/src/lib.rs` documents backfill semantics):

- `gen_ai.usage.input_tokens.cached` → `gen_ai.usage.cache_read.input_tokens`
- `gen_ai.usage.input_tokens.cache_write` → `gen_ai.usage.cache_creation.input_tokens`
- `gen_ai.usage.output_tokens.reasoning` → `gen_ai.usage.reasoning.output_tokens`

Note: @sentry/node v10 (including 10.69.0 pinned in this repo) still emits the
old names for Vercel AI; the rename to the new names is a **v11** change
(`getsentry/sentry-javascript/MIGRATION.md`, "The Vercel AI token attributes …
were renamed …"). Relay's backfill makes both work; Relay's cost math reads the
**new** keys (`UsedTokens::from_span_data`, `normalize/span/ai.rs` ~lines 32–48).

### Output attributes (what Relay writes)

From `relay-event-normalization/src/eap/ai.rs` (~lines 207–224) and
`normalize/span/ai.rs` (~lines 228–256), all `double`, all USD:

- `gen_ai.cost.input_tokens` — total input cost (raw + cached + cache-write)
- `gen_ai.cost.output_tokens` — total output cost (raw + reasoning)
- `gen_ai.cost.cache_read.input_tokens` — cached-input component (subset of input cost)
- `gen_ai.cost.cache_creation.input_tokens` — cache-write component (subset)
- `gen_ai.cost.reasoning.output_tokens` — reasoning component (subset of output cost)
- **`gen_ai.cost.total_tokens`** — input + output. Per
  `sentry-conventions/model/attributes/gen_ai/gen_ai__cost__total_tokens.json`:
  "Despite the name 'cost.total_tokens', this value is **cost in USD**, not a
  token count," and: "This attribute appears on both agent parent spans
  (aggregated totals) and LLM child spans (per-call values). When using sum()
  to calculate total cost, **filter to `gen_ai.operation.type:ai_client`** to
  avoid double-counting hierarchical spans." Legacy alias: `ai.total_cost`.

The older `gen_ai.usage.total_cost` attribute is **no longer written by Relay**
(changelog: "Remove `gen_ai_usage_total_cost` attribute and stop double
writing costs", https://github.com/getsentry/relay/pull/5471). It survives only
as a queryable alias for historical data in
`getsentry/sentry/src/sentry/search/eap/spans/attributes.py`
(`public_alias="gen_ai.usage.total_cost"`). The Sentry product UI itself now
queries `sum(gen_ai.cost.total_tokens)` (e.g.
`static/app/views/insights/pages/agents/components/tracesTable.tsx`) and
`sum_if(gen_ai.cost.total_tokens,gen_ai.operation.type,equals,ai_client)`
(`src/sentry/api/endpoints/organization_ai_conversations.py`).

### The cost formula

`calculate_costs()` in `relay-event-normalization/src/normalize/span/ai.rs`
(~lines 98–150), shared by both ingestion paths:

```
cache_read  = cache_read_tokens  * inputCachedPerToken
cache_write = cache_write_tokens * inputCacheWritePerToken
input  = (input_tokens - cache_read_tokens - cache_write_tokens) * inputPerToken
         + cache_read + cache_write
reasoning_rate = outputReasoningPerToken if > 0 else outputPerToken
output = (output_tokens - reasoning_tokens) * outputPerToken
         + reasoning_tokens * reasoning_rate
total  = input + output
```

Returns `None` (→ no cost attributes at all) if `input_tokens == 0 && output_tokens == 0`
(`UsedTokens::has_usage`).

### The pricing table

There is **no hardcoded model price list** in Sentry or Relay. The pipeline:

1. Celery beat task `sentry.tasks.ai_agent_monitoring.fetch_ai_model_metadata`
   (`getsentry/sentry/src/sentry/tasks/ai_agent_monitoring.py`) runs
   **every 30 minutes** (`crontab("*/30", ...)` under `fetch-ai-model-metadata`
   in `src/sentry/conf/server.py`, ~line 1226). It fetches
   `https://openrouter.ai/api/v1/models` and `https://models.dev/api.json`;
   "OpenRouter data takes precedence over models.dev data" (docstring,
   ~line 114). models.dev prices are per 1M tokens and divided down; models.dev
   provides no reasoning rate (set to 0.0 → falls back to output rate).
2. Result cached 30 days under `ai-model-metadata:v1`
   (`src/sentry/relay/config/ai_model_costs.py`; `AIModelCost` TypedDict:
   `inputPerToken`, `outputPerToken`, `outputReasoningPerToken`,
   `inputCachedPerToken`, `inputCacheWritePerToken`; optional `contextSize`).
3. Shipped to Relay in the **global config** key `aiModelMetadata`
   (`src/sentry/relay/globalconfig.py`; Relay removed the deprecated
   `aiModelCosts` key in https://github.com/getsentry/relay/pull/5862).
   Only processing Relays receive global config → SDKs and PoP relays never
   compute cost.

**Model-name matching** (`_add_glob_model_names` in ai_agent_monitoring.py):
for every model id the table also contains a *normalized* id (dates/versions
stripped via regex, e.g. `gpt-4-20241022-v1.0` → `gpt-4`) and a prefix-glob
`*<normalized-id>` (handles provider-prefixed ids like
`anthropic/claude-…` or `us.anthropic.claude-…`).

**Unknown / custom model names**: no table match → Relay increments
`gen_ai.cost_calculation.result = calculation_no_model_cost_available` and
writes **no cost attributes** (`normalize/span/ai.rs` ~lines 213–221; docs:
"If the model name in your spans doesn't match any model in models.dev or
OpenRouter, the cost will be zero" — https://docs.sentry.io/product/agents/costs/).
For the demo: **use real, current model names** (`gpt-4o`,
`claude-sonnet-4-5-20250929`, …) or cost will never appear.

**Self-hosted caveat**: with `SENTRY_AIR_GAP` the metadata config is `None`
(`ai_model_costs.py`) → no costs. Also, the JS SDK changelog for 10.61.0 warns
"Self-hosted Sentry users should opt out with `streamGenAiSpans: false`, since
streamed gen_ai spans may not be ingested by their Sentry instance."

Docs limits (https://docs.sentry.io/product/agents/costs/): token-based pricing
only — no web-search/image/audio surcharges, no volume/batch discounts.

Bonus attributes Relay derives for AI spans (`eap/ai.rs`):
`gen_ai.response.tokens_per_second`, `gen_ai.context.window_size` +
`gen_ai.context.utilization` (from `contextSize`), `gen_ai.operation.type`
(`agent` | `ai_client` | `tool` | `handoff` | `other`, inferred from
`gen_ai.operation.name`/span op via `infer_ai_operation_type()`,
`normalize/span/ai.rs` ~lines 168–200).

---

## 2. User attribution (grouping cost per user)

`Sentry.setUser({id, email, username})` reaches EAP span attributes on **both**
ingestion paths, and the queryable field is **`user.id`** (plus `user.email`,
`user.username`, `user`).

### Path A — streamed standalone gen_ai spans (default since @sentry/node 10.61.0)

Since 10.61.0, "The SDK now extracts all `gen_ai` spans out of a transaction
and sends them as v2 envelope items by default" (`streamGenAiSpans`,
introduced opt-in in 10.53.0 — sentry-javascript CHANGELOG entries for
10.61.0 / #21732 and 10.53.0 / #20785; flag removed in v11, always on).

The SDK stamps the scope's user onto **every** streamed span at capture time:
`commonSpanAttributes()` in
`packages/core/src/tracing/spans/captureSpan.ts` sets

- `user.id`  (`SEMANTIC_ATTRIBUTE_USER_ID`)
- `user.email` (`SEMANTIC_ATTRIBUTE_USER_EMAIL`)
- `user.ip_address` (`SEMANTIC_ATTRIBUTE_USER_IP_ADDRESS`)
- `user.name` (`SEMANTIC_ATTRIBUTE_USER_USERNAME`)

(constants in `packages/core/src/semanticAttributes.ts` lines 81–87), taken
from the combined isolation+current scope captured on the span. Existing
attributes are never overwritten (`safeSetSpanJSONAttributes`).
**Consequence for the demo: call `Sentry.setUser(...)` in the request's
isolation scope *before* the LLM call**, or the gen_ai spans go out without a
user.

### Path B — spans embedded in transactions

`event.user` (from `setUser`) is copied onto every extracted span by Relay:
`extract_shared_tags()` in
`relay-event-normalization/src/normalize/span/tag_extraction.rs` (~lines
324–360) fills span sentry_tags `user` (`id:<id>` format), `user.id`,
`user.email`, `user.ip`, `user.username`, `user.geo.*`; the v1→v2 conversion
maps them to EAP attributes (`relay-spans/src/v1_to_v2.rs`, ~lines 100–110:
`"user.id" => USER__ID`, etc.).

### Queryable fields

`getsentry/sentry/src/sentry/search/eap/spans/attributes.py` (~lines 548–557)
registers public aliases `user`, `user.id`, `user.email`, `user.username`,
`user.ip`, `user.geo.*` via `simple_sentry_field()` (public alias `x` →
internal `sentry.x`; `src/sentry/search/eap/columns.py` ~lines 769–781).
Naming is mid-migration: sentry-conventions now says canonical is `user.id`
with alias `sentry.user.id` (`model/attributes/user/user__id.json`;
`sentry/sentry__user__id.json` is deprecated in favor of `user.id`) — either
way, **query and group by `user.id`** in Trace Explorer / Dashboards / API.
Docs list `user.id`, `user.email`, `user.username` as searchable span
properties: https://docs.sentry.io/concepts/search/searchable-properties/spans/

---

## 3. Dashboards

### Can a widget do `sum(gen_ai.cost.total_tokens)` by user and by model? — Yes

- Trace Explorer explicitly supports aggregates over **custom numeric span
  attributes** — the docs' own examples are `sum(ai.token_use)` and
  `p50(cart.value)` — with Group By on any attribute, and "Save As" → Dashboard
  widget / Alert: https://docs.sentry.io/product/explore/trace-explorer/
- The widget builder's Spans dataset queries and aggregates spans; time-series
  visualizations support up to 20 group-by fields:
  https://docs.sentry.io/product/dashboards/widget-builder/
- Supported aggregate functions (from the documented timeseries API `yAxis`
  values, which the widget builder shares): `count()`, `count_unique()`,
  `avg()`, `sum()`, `min()`, `max()`, `p50/p75/p90/p95/p99/pXX()`, `epm()`,
  `eps()`, `failure_rate()`, `failure_count()`, plus equations:
  https://docs.sentry.io/api/explore/query-explore-events-in-timeseries-format/
- Sentry's own product does exactly this query shape:
  `sum(gen_ai.cost.total_tokens)` (frontend `tracesTable.tsx`) and
  `sum_if(gen_ai.cost.total_tokens,gen_ai.operation.type,equals,ai_client)`
  (`organization_ai_conversations.py`).

Recommended widget recipe (spend per user):

- Dataset: **Spans** — Filter: `gen_ai.operation.type:ai_client`
  (per the sentry-conventions double-counting warning)
- Visualize: `sum(gen_ai.cost.total_tokens)`
- Group by: `user.id` (table widget, sorted desc) — second widget grouped by
  `gen_ai.response.model`, third as time series grouped by `user.id`.
- Token companions: `sum(gen_ai.usage.total_tokens)`,
  `sum(gen_ai.usage.cache_read.input_tokens)`.

### Prebuilt AI Agents insights

https://docs.sentry.io/product/insights/agents/dashboard/ — three views:
**Overview** (agent runs, LLM calls, duration, LLM calls by model, tokens used,
tool calls, traces table including per-trace cost), **Models** (model cost —
"estimated costs based on token usage and model pricing" — tokens, token
types), **Tools** (calls, errors, durations). There is **no per-user breakdown**
in the prebuilt dashboards — per-user spend requires a custom dashboard/query
as above. There's also an AI Conversations view backed by
`gen_ai.conversation.id` (`src/sentry/api/endpoints/organization_ai_conversations.py`).

### Limitations

- **Sampling/extrapolation**: sums over sampled spans are extrapolated by
  sampling weight (span at 10% sample rate counts ×10). Extrapolated: count,
  avg, sum, percentiles, failure_rate; NOT extrapolated: min, max,
  count_unique. Low sample volume triggers low-confidence warnings; a toggle /
  `disableAggregateExtrapolation` disables it.
  https://docs.sentry.io/concepts/key-terms/extrapolation and
  https://develop.sentry.dev/application-architecture/dynamic-sampling/extrapolation/
  For a demo, set `tracesSampleRate: 1.0` so sums are exact.
- Cost exists **only** on gen_ai spans that carried token usage AND matched the
  pricing table; `sum()` silently treats missing as 0.
- Spans dropped for size/rate-limit reasons never contribute; span streaming
  (10.61+) was introduced precisely because large gen_ai spans were being
  dropped with oversized transactions (CHANGELOG 10.61.0).

---

## 4. Fixture / seed data for the demo

### Recommended: drive real code paths (Sentry's own demo practice)

Sentry's flagship demo monorepo `sentry-demos/empower` seeds data by running
**automated test traffic against the deployed demo apps on a cron**, not by
crafting envelopes: `_tda/` ("Test Data Automation — Runs automated tests
against Sentry demos on GCP, in order to generate errors and transactions to
be sent to Sentry.io", `_tda/README.md`), pytest + Selenium/Appium jobs
including `desktop_web/test_ai_agent.py`, deployed with `create_cron_job.sh` /
`loop.sh`. The repo also contains `agent/` — a FastAPI + OpenAI Agents SDK
demo. This "forward-looking" pattern sidesteps every backdating limit: run a
simulated-conversation driver (cron or GitHub Action) against real app code
with `tracesSampleRate: 1.0`, rotating through a cast of `Sentry.setUser`
identities and models, and let history accumulate at real time.

Other official tooling:

- `getsentry/sentry` `bin/load-mocks` — dev-environment mock data loader
  (errors/transactions oriented; not a gen_ai fixture tool).
- `getsentry/snuba` `scripts/generate_items.py` — generates EAP TraceItem Kafka
  messages (dev-only, bypasses Relay; not usable against SaaS).
- `sentry django send_fake_data` — **not present** in current
  `getsentry/sentry` source (code search finds nothing); treat as removed
  legacy tooling. (**UNVERIFIED when it was removed.**)

### The backdating limits (the constants)

Two different pipelines, two different rules:

**Transactions (and their embedded spans)** — the path used when
`streamGenAiSpans` is off, and always used for the surrounding request
transaction:

1. *Clamping*: event timestamps older than the project's event retention are
   not preserved — `EventValidationConfig { max_secs_in_past:
   Some(retention_days * 24 * 3600), max_secs_in_future:
   Some(ctx.config.max_secs_in_future()) }` with `retention_days` defaulting to
   `DEFAULT_EVENT_RETENTION: u16 = 90` (`relay-server/src/constants.rs`;
   wiring in `relay-server/src/processing/utils/event.rs` ~lines 227–240).
   Out-of-range timestamps trigger the `ClockDriftProcessor`, which shifts the
   event's timestamps toward the received time — the schema comment is
   explicit: "If the event's timestamp is older, the received timestamp is
   assumed" (`relay-event-normalization/src/validation.rs`, ~lines 19–30,
   `normalize_timestamps()` ~lines 86–132). So a 6-month-old timestamp is
   silently rewritten to ~now, not dropped.
2. *Hard drop* (the binding constraint): transaction `start_timestamp`/`timestamp`
   must both lie inside the spans-namespace metrics aggregator range
   `now - max_secs_in_past .. now + max_secs_in_future`, where the defaults are
   **`max_secs_in_past: 5 * 24 * 60 * 60` (5 days)** and
   **`max_secs_in_future: 60` (1 minute)**
   (`relay-metrics/src/aggregator/config.rs` — "The age in seconds of the
   oldest allowed bucket timestamp. Defaults to 5 days." / "Defaults to 1
   minute."; range built in `relay-config/src/aggregator.rs`
   `timestamp_range()`; wired via
   `transaction_timestamp_range: Some(transaction_aggregator_config.timestamp_range())`
   in `relay-server/src/processing/utils/event.rs`, with the comment "Inherit
   from spans, as transactions no longer produce metrics"). Violations are
   rejected as `InvalidTransaction("start/end timestamp is out of the valid
   range for metrics")` (`validation.rs` `validate_timestamps()` ~lines
   158–197) — the whole transaction is dropped.
   **UNVERIFIED**: whether Sentry SaaS overrides the 5-day default in its
   Relay deployment config (ops config is not public); the shipped default is
   5 days.

**Standalone EAP spans (span v2 envelope items — what @sentry/node ≥10.61
sends for gen_ai)**:

- Relay validates only `start_timestamp <= end_timestamp`
  (`validate_timestamps()` in `relay-server/src/processing/spans/process.rs`,
  ~lines 364–380). **No past/future clamp in Relay.**
- Downstream, Snuba's `eap_items` consumer has a runtime-config killswitch
  (`eap_items_dlq_grace_period_min:<storage>`): when set, any item whose
  timestamp falls **before the most recent Monday 00:00 UTC** (the ClickHouse
  weekly partition boundary, table partitioned by
  `(retention_days, toMonday(timestamp))`) is DLQed as `past_ts` once the
  grace window after the boundary has passed; next-week timestamps are DLQed
  as `future_ts` (`getsentry/snuba/rust_snuba/src/processors/eap_items.rs`,
  ~lines 23–42 and `should_dlq()` ~lines 182–203). **UNVERIFIED** whether the
  killswitch is currently enabled on SaaS (runtime config), but the mechanism
  exists and is presumably there to be used.

**Legacy 30-day constant** (for completeness): `MAX_SECS_IN_PAST = 2592000
# 30 days` in `getsentry/sentry/src/sentry/constants.py` (~line 700) feeds
`DEFAULT_STORE_NORMALIZER_ARGS`, i.e. the store normalizer for **error
events** — it is not the spans/transactions limit.

**Practical rule for fixtures**: backdate at most ~4 days (stays inside the
5-day transaction window and, Tue–Sun, inside the current weekly partition;
on Mondays keep backdating under 24 h to be safe), never more than a few
seconds into the future, and prefer generating data continuously going
forward. Crafting envelopes directly (transaction envelopes or span v2 items)
does work against `/api/{project}/envelope/` and still gets server-side cost
normalization — Relay computes costs regardless of how the envelope was
produced — but you must respect the same timestamp rules, keep
`sent_at`/`timestamp` consistent (clock-drift correction uses envelope
`sent_at`), and reproduce the attribute conventions by hand, which is why
driving real SDK code paths is the lower-risk option.

---

## 5. Export for online evals

### Endpoints (documented)

1. **Table queries** — `GET /api/0/organizations/{organization_id_or_slug}/events/`
   (docs: https://docs.sentry.io/api/explore/query-explore-events-in-table-format).
   - `dataset`: one of `errors`, `logs`, `profile_functions`, **`spans`**,
     `tracemetrics`, `uptime_results`.
   - `field` (repeated, max 20): attributes, functions, or `equation|…`.
   - `query`: search syntax (e.g.
     `gen_ai.operation.type:ai_client user.id:*`), `sort` (e.g. `-timestamp`),
     `statsPeriod` (`24h`, `7d`) or `start`/`end` (ISO-8601), `project`,
     `environment`, `per_page` (max 100), `cursor`.
   - Response: `{ data: [...rows], meta: { fields: {name: type/unit} } }`.
2. **Timeseries** — `GET /api/0/organizations/{org}/events-timeseries/`
   (docs: https://docs.sentry.io/api/explore/query-explore-events-in-timeseries-format/):
   `yAxis` aggregates, `interval`, `groupBy`, `topEvents` (1–10),
   `excludeOther`, `comparisonDelta`, and `disableAggregateExtrapolation` to
   get raw (non-extrapolated) sums.
3. **Attribute stats** — "Retrieve Trace Item Statistics"
   (https://docs.sentry.io/api/explore/retrieve-trace-item-statistics/).
4. Internal (not in the public API docs, subject to change — **UNVERIFIED as
   stable API**): the AI-conversations endpoints
   (`/organizations/{org}/ai-conversations/` and `…/ai-conversations/{id}/`,
   `src/sentry/api/endpoints/organization_ai_conversations*.py`) return
   conversation-shaped span data including `gen_ai.input.messages` /
   `gen_ai.output.messages` and costs; the EAP RPC (`snuba-rpc`) endpoints the
   frontend uses are likewise internal.

### Auth, pagination, rate limits, retention

- **Auth**: Bearer organization auth token (or internal-integration token)
  with `org:read` (docs list `org:read`/`org:write`/`org:admin`).
- **Pagination**: standard Sentry `Link` header with `cursor`, `rel=next`,
  `results="true|false"`; loop while `results="true"`
  (https://docs.sentry.io/api/pagination/).
- **Rate limits**: no published numbers; per-endpoint fixed windows plus
  concurrent limits, surfaced via `X-Sentry-Rate-Limit-Limit/-Remaining/
  -Reset/-ConcurrentLimit/-ConcurrentRemaining` headers; limits track caller
  identity, so extra tokens don't help (https://docs.sentry.io/api/ratelimits/).
  Back off on 429 using `-Reset`.
- **Retention**: 90 days standard on paid plans (30 days on free for errors);
  since **2025-08-27** Sentry additionally keeps a **downsampled span tier for
  13 months** (Sentry Help Center, "Data retention notice (August 27, 2025)":
  https://sentry.zendesk.com/hc/en-us/articles/40207939677083 — corroborated
  in source by `downsampled_retention_days` in
  `relay-server/src/processing/spans/store.rs` and snuba migration
  `0046_add_downsampled_retention_days.py`). Export well within 90 days.

### Exporter sketch (Braintrust / LangSmith)

```
GET /api/0/organizations/{org}/events/
  ?dataset=spans
  &query=gen_ai.operation.type:ai_client
  &field=id&field=trace&field=timestamp&field=span.description
  &field=user.id&field=user.email
  &field=gen_ai.response.model&field=gen_ai.operation.name
  &field=gen_ai.usage.input_tokens&field=gen_ai.usage.output_tokens
  &field=gen_ai.usage.cache_read.input_tokens
  &field=gen_ai.cost.total_tokens
  &sort=-timestamp&per_page=100
  &start=<last_cursor_ts>&end=<now>
```

- Incremental sync: window on `start`/`end` (timestamps are stable once
  ingested), page with `cursor`, dedupe on span `id`.
- To reconstruct full conversations for eval scoring, also pull
  `gen_ai.input.messages` / `gen_ai.output.messages` as fields — but note
  they are only populated when the integration records them (`recordInputs`/
  `recordOutputs`, default off without `sendDefaultPii`), they may be
  scrubbed by server-side PII rules (Relay's PII config explicitly targets
  `gen_ai.input.messages` etc., `relay-pii/src/convert.rs`), and are large.
- Mapping to Braintrust (`experiment/dataset insert` APIs) or LangSmith
  (`create run` API) is 1 span → 1 eval row: `input` = gen_ai.input.messages,
  `output` = gen_ai.output.messages, `metadata` = {user.id, model, tokens,
  cost, trace, span id}. (Eval-platform APIs are outside Sentry's docs —
  verify against their own references.)

---

## Appendix: @sentry/node version requirements (from sentry-javascript CHANGELOG / docs)

This repo pins `@sentry/node` **10.69.0** — everything below is available.

| Feature | Version |
|---|---|
| Vercel AI integration (`vercelAIIntegration`) | docs require Sentry SDK ≥ 10.6.0; supports `ai` >=3.0.0 <=7 (repo uses ai 7.0.56); enabled by default, no `experimental_telemetry` needed; `recordInputs`/`recordOutputs` off by default — https://docs.sentry.io/platforms/javascript/guides/node/configuration/integrations/vercelai/ |
| OpenAI integration | 9.40.0 (#17022) |
| Anthropic AI integration | 10.6.0 (#17348) |
| Google GenAI integration | 10.13.0 (#17625) |
| LangChain integration | 10.22.0 (#17955); LangChain v1 support 10.28.0 |
| LangGraph integration | 10.26.0 |
| `streamGenAiSpans` (standalone gen_ai span v2 items) | opt-in 10.53.0 (#20785); **default on 10.61.0** (#21732); flag removed in v11 |
| `gen_ai.conversation.id` on all AI spans | 10.37-ish (#18703/#19792 era) — powers AI Conversations view |
| v11 renames (already handled server-side via conventions backfill) | `gen_ai.system`→`gen_ai.provider.name`, `gen_ai.usage.input_tokens.cached`→`gen_ai.usage.cache_read.input_tokens`, `gen_ai.tool.input`→`gen_ai.tool.call.arguments`, etc. (MIGRATION.md) |

Manual instrumentation (for spans the integrations don't cover): follow
https://develop.sentry.dev/sdk/telemetry/traces/modules/ai-agents/ — set
`gen_ai.operation.name`, `gen_ai.request.model`, and the `gen_ai.usage.*`
token attributes on a span with op `gen_ai.{operation}`; Relay derives
`gen_ai.operation.type`, `gen_ai.response.model`, totals, and costs.

---

## Implementation log (2026-08-08)

Everything below was built and verified live against org `sentry-developer-experience`,
project `slack-agent-eve` (id 4511872415760384).

- **Seeder**: `slack-agent-eve/seeder/` (`npm run seed -- --days 4 --spike`;
  `--dry-run` prints client-side spend projections). Manual gen_ai spans per the
  AI-agents conventions, backdated via `startTime`/`end(Date)` — Date objects, not
  numbers, because Sentry (seconds) and OTel (millis) disagree on bare numbers.
  Every span carries `demo.seed_run:<id>`.
- **Dashboard**: "LLM Spend per User", id 9282577 —
  https://sentry-developer-experience.sentry.io/dashboard/9282577/
- **Alerts** (workflow engine — the legacy `/alert-rules/` payload is rejected on
  this org; use `POST /organizations/{org}/projects/{project}/detectors/`):
  - detector 8032382 "LLM spend rate high (Lunchbot)" — static, `sum(gen_ai.cost.total_tokens)`
    over 60 min, warning > $0.75, critical > $1.50
  - detector 8032383 "LLM spend anomaly (Lunchbot)" — dynamic (anomaly detection,
    medium sensitivity, auto seasonality)
  - workflow 3824647 emails user 3855940; detectors reference it via `workflowIds`.

Gotchas observed live:

1. **EAP ingestion lag for backdated spans is minutes, not seconds** — up to ~5 min
   before counts settle. Don't diagnose drops before then; `events-timeseries`
   responses are also cached (~minutes), so vary params to bust the cache.
2. **Rate limiting on bulk sends**: ~190 transaction envelopes in one flush got the
   tail silently dropped (two whole days missing). The seeder now flushes every 10
   conversations with a 2 s pause; `--only-days-back A-B` re-sends a partial range.
3. Backdating within `now-4.75d` works exactly as researched — 5-day-old spans
   ingest fine with server-side cost attached.
4. The `sentry` CLI's `alert metrics create` builds a legacy payload this org
   rejects (`dataSources`/`conditionGroup` validation errors) — detector API is the
   path. `dashboard create` treats the whole positional as the title; rename via
   `PUT /organizations/{org}/dashboards/{id}/`.
5. Repo moved to `@sentry/node@11.0.0-alpha.0` mid-build; seeder pins
   `traceLifecycle: "static"` so gen_ai spans ride the transaction envelope (the
   ingestion path with the documented 5-day backdating window).

### Double-counting audit + widget fixes (2026-08-08, later)

Cross-checked our widgets against ~/src/sentry:
`static/app/views/dashboards/utils/prebuiltConfigs/ai/aiAgentsModels.ts` uses
`AI_GENERATIONS_FILTER = gen_ai.operation.type:ai_client` on every cost/token
widget (same in aiAgentsOverview.ts; backend conversations endpoint uses
`sum_if(..., gen_ai.operation.type, equals, ai_client)`). Our widgets use the
identical filter. Live audit of cost-bearing spans in slack-agent-eve (6d):
ai_client spans $9.44 vs agent (invoke_agent parent) spans $9.40 — the filter
excludes the near-equal duplicate cost on parents, so no double counting.

Two real issues found and fixed:

1. `has:`/`:*` filters MATCH empty-string attributes. Sentry's conversations
   endpoint (`organization_ai_conversations.py`) filters
   `has:gen_ai.conversation.id` then drops falsy ids in Python. Widgets need
   the explicit form: `has:gen_ai.conversation.id !gen_ai.conversation.id:""`
   (applied to Most Expensive Conversations; same for gen_ai.response.model on
   Cost by Model).
2. Same-seed seeder reruns mint near-identical conversations at shifted
   timestamps → duplicate-looking rows. seed.ts now defaults to a
   time-derived seed (pass --seed to reproduce a plan), and demo.seed_run
   includes minutes so every run is distinguishable. The Aug 8 clones are
   immutable but age out of the dashboard window.

Note: rows with epoch-style conversation ids and no username are REAL eve
traffic (Slack thread ts format == the seeder's fake format); username is null
until eve's fire-and-forget Slack profile lookup resolves (users:read scope).
