# Flue Sentry blueprint vs current Sentry JS SDK idioms

Researched 2026-08-08 against primary sources only: docs.sentry.io, develop.sentry.dev,
getsentry/sentry-javascript (source at tags `10.64.0` / `10.69.0` / `11.0.0-alpha.0` and the
`develop` branch, CHANGELOG, migration docs, PRs), getsentry/sentry-docs source, blog.sentry.io,
and the npm registry. SDK state at time of research: **`@sentry/node` latest = 10.69.0**,
**`next` dist-tag = 11.0.0-alpha.0** (npm registry, checked 2026-08-08).

Files compared:

- Playground copy: `/Users/sergiydybskiy/src/playground/agents/flue/src/sentry.ts`
- Stock blueprint: mirrored verbatim in
  `/Users/sergiydybskiy/src/playground/agents/sentry-demos/research/flue.md` (§ "The complete
  generated `src/sentry.ts`", lines 741–996), also public at
  https://flueframework.com/cli/blueprints/sentry.md

## Summary of verdicts

| # | Blueprint pattern | Current idiom (v10.69.0 / v11 direction) | Verdict |
|---|---|---|---|
| 1 | `submission_recovery` → `Sentry.addBreadcrumb` | Docs now carry a warning banner steering manual breadcrumbs to Logs; no API deprecation; no auto-mirror affordance exists | **Discuss → recommend update** to `Sentry.logger.warn/error(message, attributes)` (optionally dual-write the breadcrumb) |
| 2 | `log` events → `Sentry.logger[level](msg, attrs)` | Exactly matches current logger API (`trace/debug/info/warn/error/fatal(message, attributes?, {scope}?)` + `logger.fmt`) | **Keep** |
| 3 | Env flags `SENTRY_AI_RECORD_INPUTS/OUTPUTS` → hand-rolled `contentPolicy()` | SDK now has `dataCollection.genAI.{inputs,outputs}` (added 10.54.0; `sendDefaultPii` deprecated 10.57.0, removed in v11); resolvable at runtime via `Sentry.getClient().getDataCollectionOptions().genAI` | **Update (partially)**: keep transform/scrub/truncate; default the flags from the SDK's `dataCollection` so one config surface governs both. Watch the v11 default flip (genAI capture ON by default) |
| 4 | `enableLogs: true` | Correct top-level name since 9.41.0; default `false` in v10, default `true` in v11 | **Keep** (needed in v10; becomes harmless-redundant in v11) |
| 5 | `traceLifecycle: 'stream'` | Valid option; v10 default `'static'`, v11 default `'stream'` | **Keep** for v10 (drop when moving to v11) |
| 6 | `streamGenAiSpans: true` | Default `true` since **10.61.0**; option **removed** in v11 | **Update: delete** — redundant at the pinned `^10.64.0`, breaks nothing today but is dead weight and gone in v11 |
| 7 | `integrations: (defaults) => defaults.filter(...)` by name | Still the documented idiom (docs + v11 migration guide use the same pattern); no `disabledIntegrations` option exists | **Keep**; all six name strings verified in v10 source. Minor: `'WorkersAI'` integration also exists and is not filtered |
| 8 | Pin `@sentry/node@^10.64.0` | Latest 10.69.0; v11 in alpha with majors that matter to this file (OTel provider no longer registered by default!) | **Keep pin; plan v11 work** — the blueprint's core premise ("Sentry.init owns the global OTel tracer provider") breaks under v11 defaults |
| 9 | *(playground-only)* unwrapped `beforeSendSpan` added next to `traceLifecycle: 'stream'` | In all of v10 (verified at 10.64.0 and 10.69.0) an unwrapped callback makes `spanStreamingIntegration` **silently downgrade the SDK to the static lifecycle** | **Update (playground bug)**: wrap with `Sentry.withStreamedSpan()` and stamp `span.attributes`, or accept static mode knowingly |

---

## 1. Local diff: playground `sentry.ts` vs stock blueprint

Method: extracted the fenced block from `research/flue.md` and ran `diff -u`, then a
comment-stripped structural diff. Everything below `logAttributes` (i.e. `contentPolicy`,
`isInputContent`, `isOutputContent`, `scrub`, `toError`, `stringify`, `clampRate`) is
**identical** apart from one comment re-wrap.

### Code differences — all three documented in the playground header comment

1. **`tracesSampleRate` default**: `clampRate(env, 1)` vs stock `clampRate(env, 0)`.
   Documented ("blueprint default is 0").
2. **`environment` fallback**: `?? 'flue'` vs stock `?? process.env.NODE_ENV` (plus an added
   one-line comment referencing "PRD §6"). Documented.
3. **Scenario correlation machinery** (all new in playground, documented as one delta):
   - `scenarioTags` const built from `SCENARIO` / `RUN_STAMP` env vars (+ 2-line comment);
   - `beforeSendSpan(span) { span.data = { ...span.data, ...scenarioTags }; return span; }`
     inside `Sentry.init` (+ 2-line comment);
   - post-init loop setting the same tags on `Sentry.getGlobalScope()` (+ 1-line comment).

### Comment-only / formatting differences — NOT documented in the header

4. **Header preamble**: playground adds 15 lines (blueprint description + "Playground deltas"
   list). This is itself the documentation for items 1–3.
5. **Dropped sentence** before `instrument(createOpenTelemetryInstrumentation(...))`: stock has
   "Content capture is on by default in the adapter; `contentPolicy()` narrows it to what the
   record flags allow." — removed in the playground copy.
6. **Flush comment reworded**: "Never call process.exit() here" → "Never calls process.exit";
   "It is not a delivery guarantee" → "It is NOT a delivery guarantee"; the clause "this
   listener only flushes within that window" was dropped.
7. **Keyed-registration comment**: "a dev reload" → "a `vite dev` reload"; added sentence
   "This replaces the beta file's hand-rolled globalThis-Symbol teardown."
8. **`recordRecoveryBreadcrumb` comment**: trailing clause "; recording it here too would
   duplicate that issue." dropped.
9. **`correlationTags` comment**: added "Note the v2 vocabulary: runs are gone, so the beta's
   `flue.run.id` / `flue.dispatch.id` are replaced by `flue.instance.id` and
   `flue.submission.id`."
10. **Formatting only** (printWidth difference): `recordRecoveryBreadcrumb` and
    `logAttributes` signatures wrapped to multiple lines; the two `attemptCount`/`maxAttempts`
    conditional spreads wrapped; `contentPolicy` comment re-wrapped. No semantic change.

### Undocumented *semantic* consequence of the documented delta (see §4.5)

The playground's added `beforeSendSpan` is not wrapped with `Sentry.withStreamedSpan`. On every
v10 release (verified at 10.64.0 and 10.69.0), `ServerRuntimeClient` auto-registers
`spanStreamingIntegration` when `traceLifecycle === 'stream'`
(`packages/core/src/server-runtime-client.ts`), and that integration's `setup()` does:

```ts
if (beforeSendSpan && !isStreamedBeforeSendSpanCallback(beforeSendSpan)) {
  clientOptions.traceLifecycle = 'static';
  DEBUG_BUILD && debug.warn(...); // visible only with debug enabled
  return;
}
```

(`packages/core/src/integrations/spanStreaming.ts`, tags 10.64.0 and 10.69.0.) So the playground
copy silently runs in the **static** trace lifecycle, contradicting its own
`traceLifecycle: 'stream'` and its comment about not losing late-finishing gen_ai children.
Mitigations in practice: gen_ai spans are still extracted from the transaction and sent as v2
span items (`extractGenAiSpansFromEvent` in `client.ts#sendEvent`, because `streamGenAiSpans`
defaults to true), and the unwrapped `beforeSendSpan` *does* run over the transaction's spans
(root + children, `client.ts` ~L1652–1707) before that extraction, so the scenario stamping
works. But gen_ai children that finish after the root span ends are back to being droppable
(inference from static-lifecycle semantics; the loss-prevention claim is the blueprint's own
comment). Fix: `beforeSendSpan: Sentry.withStreamedSpan((span) => { span.attributes = {...span.attributes, ...scenarioTags}; return span; })`
— `withStreamedSpan` exists at the pinned 10.64.0
(`packages/core/src/tracing/spans/beforeSendSpan.ts`, HTTP 200 at that tag). Note the streamed
format uses `attributes`, not `data`.

---

## 2. Logs vs breadcrumbs — current Sentry guidance (priority)

### 2.1 Official positioning: docs actively steer manual breadcrumbs to Logs

**Verified in docs + docs source.** Every platform breadcrumbs docs page (including the Node
guide the blueprint targets) now renders a warning-level banner:

> **"Hey... did you mean Logs? Sentry has them now!"**
> "Manual breadcrumbs had a good run, but Sentry's got logs. Structured, searchable, and way
> easier to alert or query on. Check them out!"

- Rendered page: https://docs.sentry.io/platforms/javascript/guides/node/enriching-events/breadcrumbs/
- Source of truth: getsentry/sentry-docs
  `platform-includes/enriching-events/breadcrumbs-banner/_default.mdx` (master) — an
  `<Alert level="warning">` include applied across platforms.
- The product-level breadcrumbs page carries the same banner:
  https://docs.sentry.io/product/issues/issue-details/breadcrumbs/ (source:
  `docs/product/issues/issue-details/breadcrumbs/index.mdx`).

This is the strongest official "prefer logs over manual breadcrumbs" signal, and it is aimed
precisely at the blueprint's use case (manually authored `Sentry.addBreadcrumb` calls).

Supporting positioning:

- Logs product docs (https://docs.sentry.io/product/explore/logs/): logs are searchable
  (message text + default/custom attributes), trace-correlated ("click directly from any log
  entry to see the full trace waterfall"), alertable and dashboard-able; query windows 7 days
  (Developer) / 14 (Team) / 30 (Business).
- Logs GA announcement, blog.sentry.io, **2025-09-03**:
  https://blog.sentry.io/logs-generally-available/ — GA with live tail, log-based alerts,
  dashboards; positioning "trace connected from day one".
- v11 direction: **logs are enabled by default** in SDK v11 ("The default value of `enableLogs`
  is now `true`", opt-in-by-usage model; `MIGRATION.md` on `develop`, § "Logs are enabled by
  default").

### 2.2 Breadcrumb deprecation signals in the JS SDK

**None found (verified in source).** On the `develop` branch (v11 line), `beforeBreadcrumb`,
`maxBreadcrumbs` and the breadcrumbs plumbing remain in `packages/core/src/types/options.ts`
with no `@deprecated` tag; `Sentry.addBreadcrumb` is unchanged. The develop.sentry.dev Logs SDK
spec (https://develop.sentry.dev/sdk/telemetry/logs/) contains **no statement** about
breadcrumbs — no forwarding requirement, no deprecation plan (checked explicitly). The push is
docs/product-level steering, not API deprecation.

### 2.3 Mirror/forward affordance between breadcrumbs and logs

**Not found (searched).** GitHub code search across the `getsentry` org for
`breadcrumbsAsLogs`, `breadcrumbs_as_logs`, `logsAsBreadcrumbs`, `sendLogsAsBreadcrumbs` — no
hits; nothing in `packages/core/src/logs/` of sentry-javascript converts breadcrumbs↔logs.
The only de-facto bridge is the console: Node's default console breadcrumb integration and the
opt-in `consoleLoggingIntegration()` (docs:
https://docs.sentry.io/platforms/javascript/guides/node/logs/) both observe `console.*` calls,
so console-routed events can land in both systems. For a bridge like Flue's, mirroring means
calling both APIs yourself.

### 2.4 Recommendation for the blueprint's `submission_recovery` events

Current-guidance answer: **yes, `Sentry.logger.warn(message, attributes)` (and
`Sentry.logger.error` for `outcome === 'terminated'`) is what Sentry's own docs now steer
toward** for exactly this kind of manually recorded, structured, recurring event. The
blueprint's event is a natural fit: it already builds a flat attribute bag
(`flue.recovery.operation`, `flue.recovery.outcome`, `attempt_count`, `max_attempts`,
correlation tags) that maps 1:1 onto log attributes, and the file already enables logs and
flushes them on shutdown.

Trade-offs to state in the blueprint docs:

- **Breadcrumb (status quo)**: attaches to a *future* error event in the same process/scope —
  ideal context when the recovery escalates to the `submission_settled` failure the bridge
  captures as an issue. But invisible if no error ever happens, capped by the breadcrumb ring
  buffer, not searchable, not alertable, and now docs-discouraged for manual use.
- **Log (recommended)**: standalone + searchable (`flue.recovery.outcome:agent_unavailable`),
  alertable (log-based alerts are GA), trace-correlated, retained 7–30 days by plan. Recurring
  `deferred`/`agent_unavailable` retry-wake events become a queryable time series instead of
  ephemeral crumbs. Cost: logs are billed per GB ($0.50/GB past the free 5GB — GA blog), and a
  log does **not** appear in the issue's breadcrumb trail.
- **Dual-write** is the only way to get both (no SDK affordance, §2.3): reasonable here since
  recovery events are low-volume relative to `log` events.

Verdict: **update** — switch `recordRecoveryBreadcrumb` to `Sentry.logger.warn/error` with the
same attributes (keeping the level split on `outcome === 'terminated'`), optionally keeping the
breadcrumb write alongside for issue-trail context. Levels note: Sentry logger has no
`'warning'` level — logs use `warn` (spec: develop.sentry.dev/sdk/telemetry/logs/), while
`addBreadcrumb` uses `'warning'`; the mapping must change if switching.

---

## 3. `dataCollection` vs the blueprint's hand-rolled `contentPolicy`

### 3.1 What `dataCollection` is (verified in source + docs)

Top-level `Sentry.init` option `dataCollection?: DataCollection` on `ClientOptions`
(`packages/core/src/types/options.ts`; type in `packages/core/src/types/datacollection.ts`,
both verified at tag 10.69.0 and on `develop`). Publicly documented at
https://docs.sentry.io/platforms/javascript/guides/node/configuration/options/ ("Controls which
categories of data the SDK collects automatically…").

Shape (10.69.0):

```ts
interface DataCollection {
  userInfo?: boolean;                          // auto user.* population
  cookies?: CollectBehavior;                   // true | false | {allow} | {deny}
  httpHeaders?: { request?: CollectBehavior; response?: CollectBehavior };
  httpBodies?: HttpBodyCollectionTarget[];     // incoming/outgoing request/response
  urlQueryParams?: CollectBehavior;
  graphQL?: { document?: boolean; variables?: boolean };
  genAI?: { inputs?: boolean; outputs?: boolean };   // ← the AI content gate
  databaseQueryData?: boolean;
  stackFrameVariables?: boolean | CollectBehavior;
  frameContextLines?: number;
}
```

Timeline (CHANGELOG.md at tag 10.69.0, all `@sentry/*` v10 releases):

- **10.54.0** — `dataCollection` client option added (PR #20965).
- **10.55.0–10.56.0** — request data, metrics, span-streaming envelope, Supabase, trpc migrated
  onto it (#21071, #21078, #21080, #21085, #21072).
- **10.57.0** — **`sendDefaultPii` deprecated in favor of `dataCollection`** (PR #21277):
  "`sendDefaultPii` is deprecated and will be removed in v11. … `sendDefaultPii: true` still
  works and maps to enabling all `dataCollection` categories."
- **10.66.0** — `dataCollection.graphQL` (#22221) and `databaseQueryData` (#22219) added.
- **v11 (develop / 11.0.0-alpha.0)** — `sendDefaultPii` **removed** (PR #22918, merged
  2026-08-04); data collection **enabled by default per spec** (PR #22917, merged 2026-08-03).

Resolution precedence in v10 (`packages/core/src/utils/data-collection/resolveDataCollectionOptions.ts`
@10.69.0): explicit `dataCollection` fields → (if `dataCollection` absent) `sendDefaultPii`
bridge → spec defaults. Key subtlety: in v10, providing *any* `dataCollection` object opts you
into the permissive defaults (`genAI: { inputs: true, outputs: true }`, `userInfo: true`);
leaving it unset keeps legacy restrictive behavior. In **v11** the permissive defaults apply
even when unset — the migration guide flags this loudly: "In v10, leaving `sendDefaultPii`
unset behaved like `sendDefaultPii: false` (restrictive). In v11, leaving `dataCollection`
unset collects the categories below **by default**", with `genAI` going from "inputs + outputs
not collected" to collected (`docs/migration/v11-end-state.md` on develop, § "`sendDefaultPii`
is replaced by `dataCollection`").

### 3.2 Interaction with per-integration `recordInputs` / `recordOutputs`

Verified in `packages/core/src/tracing/ai/utils.ts` @10.69.0:

```ts
/** Precedence: explicit option > dataCollection.genAI > sendDefaultPii > false */
export function resolveAIRecordingOptions(options) {
  const genAI = getClient()?.getDataCollectionOptions().genAI;
  return { ...options,
    recordInputs:  options?.recordInputs  ?? genAI?.inputs  ?? false,
    recordOutputs: options?.recordOutputs ?? genAI?.outputs ?? false };
}
```

Matching public docs (https://docs.sentry.io/platforms/javascript/guides/node/configuration/integrations/openai/):
`recordInputs`/`recordOutputs` are per-integration overrides, "enabled by default when
`dataCollection.genAI.inputs` is true … or when the deprecated `sendDefaultPii` is enabled."
The `DataCollection.genAI` JSDoc confirms: "Integration-level options, when set, take
precedence over these values."

So the current recommended way to control gen_ai content capture in the JS SDK is:
**`dataCollection: { genAI: { inputs, outputs } }` globally, `recordInputs`/`recordOutputs` on
the specific AI integration to override.**

### 3.3 Should the blueprint read the SDK's settings? (assessment)

The blueprint's Flue instrumentation is third-party OTel-based, so `dataCollection.genAI`
does **not** gate it automatically — that resolution only runs inside Sentry's own AI
integrations. The env-flag + `transform` + `scrub` + `truncateContent` approach therefore still
*works* and remains the only way to get direction-selective admission, key scrubbing, and a
byte budget (the SDK offers none of those for third-party gen_ai span attributes; in fact the
SDK's own truncation is now disabled by default on the streaming path — `shouldEnableTruncation`
in `tracing/ai/utils.ts`, CHANGELOG 10.59.0/#21603 — and `enableTruncation` is removed in v11).

But for **consistency** the blueprint should default its flags from the SDK config rather than
only from bespoke env vars. The exact affordance exists and is public API at the pinned
version: `Client.getDataCollectionOptions(): ResolvedDataCollection`
(`packages/core/src/client.ts` @10.69.0; present at 10.64.0 too — verified). I.e.:

```ts
const genAI = Sentry.getClient()?.getDataCollectionOptions().genAI;
const recordInputs  = envFlag('SENTRY_AI_RECORD_INPUTS')  ?? genAI?.inputs  ?? false;
const recordOutputs = envFlag('SENTRY_AI_RECORD_OUTPUTS') ?? genAI?.outputs ?? false;
```

That mirrors the SDK's own precedence (explicit > dataCollection.genAI > off) and means a user
who sets `dataCollection.genAI` once gets consistent behavior from Sentry's integrations *and*
Flue's spans. Two caveats to document:

- Ordering: `getClient()` must be read **after** `Sentry.init` (the blueprint already calls
  `instrument(...)` post-init, so this is fine).
- **v11 divergence**: the SDK's default flips to *collect* gen_ai content; the blueprint's
  default is *off*. Deferring to `getDataCollectionOptions()` in v11 would flip the blueprint's
  default on too. That is arguably "consistent with the SDK", but it's a privacy-posture
  change the blueprint must make deliberately (and can counter by shipping
  `dataCollection: { genAI: { inputs: false, outputs: false } }` in its `Sentry.init` when the
  env flags are unset).

Verdict: **update (partially)** — keep `contentPolicy()`'s transform/scrub/truncation; source
its on/off defaults from `getDataCollectionOptions().genAI` with the env flags as explicit
overrides; revisit the default when adopting v11.

---

## 4. Other idiom drift (quick audit)

### 4.1 `enableLogs: true` — correct, still needed on v10

- History: `_experiments.enableLogs` introduced 9.10.0; top-level `enableLogs`/`beforeSendLog`
  promoted and experimental variants deprecated in **9.41.0** (PR #17092); experimental options
  removed in **10.0.0** (PR #17063). (CHANGELOG.md @10.69.0.)
- v10.69.0: top-level `enableLogs`, `@default false` (`packages/core/src/types/options.ts`);
  docs agree (Node options page).
- v11 (`develop` options.ts): `@default true`; `MIGRATION.md` § "Logs are enabled by default"
  (opt-in-by-usage; set `enableLogs: false` to opt out).
- Verdict: **keep**. Required on v10; harmless-redundant after a v11 move.

### 4.2 `traceLifecycle: 'stream'` + `streamGenAiSpans: true`

- `traceLifecycle?: 'static' | 'stream'` — verified in options.ts at 10.64.0 and 10.69.0 with
  `@default 'static'`; on `develop` the default is `'stream'` ("Span streaming is now the
  default", `docs/migration/v11-end-state.md`). The feature line began with
  `spanStreamingIntegration` (PR #19218, first commit 2026-02-19); exact introducing release of
  the option not pinned (see "Not found" below).
- `streamGenAiSpans` — added **10.53.0** (PR #20785), **default flipped to `true` in 10.61.0**
  (PR #21732: "The SDK now extracts all gen_ai spans out of a transaction and sends them as v2
  envelope items by default… To keep the previous behavior, set `streamGenAiSpans: false`.";
  self-hosted users told to opt out). Option **removed in v11**: "The `enableTruncation` and
  `streamGenAiSpans` flags were removed. The new default is no truncation and to always stream
  gen AI spans." (`docs/migration/v11-end-state.md`, § AI integrations.)
- Verdict: `traceLifecycle: 'stream'` — **keep** on v10 (it is the non-default there; becomes
  redundant in v11). `streamGenAiSpans: true` — **delete**: already the default at the
  blueprint's own `^10.64.0` pin, and the option no longer exists in v11.
- Related v10 footgun the blueprint escapes but the playground hits: any `beforeSendSpan`
  passed alongside `traceLifecycle: 'stream'` must be wrapped in `Sentry.withStreamedSpan`,
  else v10 silently falls back to the static lifecycle (§1, verified at 10.64.0/10.69.0). In
  v11 the failure mode changes to "mismatched callback is never invoked" (migration doc).

### 4.3 Filtering AI provider integrations

- The functional form `integrations: (defaults) => defaults.filter(i => i.name !== '…')` is
  still the **documented** way to remove default integrations
  (https://docs.sentry.io/platforms/javascript/guides/node/configuration/integrations/ shows
  exactly this filter-by-`integration.name` pattern; the only alternative is the nuclear
  `defaultIntegrations: false`). No `disabledIntegrations` option exists in the JS SDK
  (checked docs + options.ts). The v11 migration guide itself uses the same idiom
  (`integrations: integrations => [...integrations.filter(i => i.name !== 'Postgres'), …]`).
- All six blueprint name strings verified in v10.69.0 source: `'OpenAI'`
  (`tracing/openai/constants.ts`), `'Anthropic_AI'` (`tracing/anthropic-ai/constants.ts`),
  `'Google_GenAI'` (`tracing/google-genai/constants.ts`), `'LangChain'`, `'LangGraph'`
  (respective `constants.ts`), `'VercelAI'` (`tracing/vercel-ai/index.ts`,
  `getIntegrationByName('VercelAI')`).
- Small gaps worth noting: a `'WorkersAI'` integration also exists
  (`tracing/workers-ai/constants.ts`) and is not in the blueprint's filter set (relevant only
  for Cloudflare Workers AI users). The name-constant exports
  (`OPENAI_INTEGRATION_NAME` etc.) are removed from the public API in v11 (migration doc), but
  the blueprint uses literal strings, so it is unaffected. Alternative worth considering
  instead of removal: Sentry's AI integrations accept `recordInputs/recordOutputs: false`, but
  that only strips content — the double-span problem remains, so filtering by name stays the
  right call.
- Verdict: **keep** (optionally add `'WorkersAI'`).

### 4.4 `Sentry.logger.info(message, attributes)` API shape

- Verified in `packages/core/src/logs/public-api.ts` @10.69.0: `trace/debug/info/warn/error/
  fatal(message: ParameterizedString, attributes?: Log['attributes'], { scope }? )`. Matches
  the develop.sentry.dev logs spec ("SDKs MUST expose … `Sentry.logger.trace` … `fatal`").
  `Sentry.logger.fmt` template tag exists for parameterized messages (docs:
  https://docs.sentry.io/platforms/javascript/guides/node/logs/ — "Values are automatically
  extracted as searchable attributes"); it is optional sugar, not a replacement for the
  `(message, attributes)` form. `beforeSendLog` is the filtering hook.
- The blueprint's `Sentry.logger[event.level](event.message, logAttributes(event))` is exactly
  the current shape — assuming Flue's `event.level` values are within
  `trace|debug|info|warn|error|fatal` (note: `warn`, not `warning`).
- Verdict: **keep**.

### 4.5 Version pin `^10.64.0` and the v11 outlook

- npm (2026-08-08): `@sentry/node` latest **10.69.0**; dist-tags `next: 11.0.0-alpha.0`,
  `v9: 9.47.1`. `^10.64.0` resolves to 10.69.0 — fine today.
- v11 items that hit this file directly (`docs/migration/v11-end-state.md` +
  `MIGRATION.md` on develop, cross-checked with `11.0.0-alpha.0` source where noted):
  1. **OTel tracer provider no longer registered by default** — "By default, v11 no longer
     sets up an OpenTelemetry tracer provider for most SDKs"; `skipOpenTelemetrySetup` default
     flipped to `true` for `@sentry/node`. The blueprint's central claim ("`Sentry.init`
     registered Sentry as the global OTel tracer provider, so Flue's spans flow to Sentry
     without further wiring") is **false under v11 defaults**. Options: set
     `skipOpenTelemetrySetup: false` (OTel-compatible mode; spans created via
     `@opentelemetry/api` become native Sentry spans), or run a real OTel pipeline exporting to
     Sentry's OTLP endpoint via `Sentry.getOtlpTracesEndpoint()` + `Sentry.otlpIntegration()`.
  2. `beforeSendSpan` receives `StreamedSpanJSON` (`name`/`attributes`/`end_timestamp`, not
     `description`/`data`) — affects the playground's stamping hook.
  3. `sendDefaultPii` removed; `dataCollection` defaults become permissive (gen_ai content ON).
  4. `enableLogs` default true; `streamGenAiSpans`/`enableTruncation` removed (§4.1/§4.2).
  5. AI integrations move to `@sentry/server-utils` internally (no impact — blueprint filters
     by name only); AI integrations dropped from the browser SDK.
  6. Node minimum becomes 20.19.0.
- Verdict: **keep the ^10 pin for now**; the v11 upgrade is not mechanical for this blueprint —
  it needs an explicit `skipOpenTelemetrySetup: false` (or an OTLP pipeline) to keep Flue's
  spans flowing, plus items 2–4.

---

## Verification ledger

**Verified in source/docs** (every claim above tagged with its file@tag or URL):
npm dist-tags; `dataCollection` type/resolution/`getDataCollectionOptions` at 10.64.0, 10.69.0
and develop; `resolveAIRecordingOptions` precedence; changelog entries 9.10.0, 9.41.0, 10.0.0,
10.53.0, 10.54.0, 10.57.0, 10.59.0, 10.61.0, 10.66.0; PRs #20965, #21277, #21732, #20785,
#22917, #22918, #19218; spanStreaming downgrade at 10.64.0 and 10.69.0;
`extractGenAiSpansFromEvent` call order in `client.ts#sendEvent`; options defaults
(`traceLifecycle`, `streamGenAiSpans`, `enableLogs`, `sendDefaultPii`) at 10.64.0/10.69.0 vs
develop; v11 migration docs (`docs/migration/v11-end-state.md`, `MIGRATION.md`); breadcrumbs
banner text in sentry-docs source; logger public API at 10.69.0; develop.sentry.dev logs spec;
Logs product/JS logs/OpenAI-integration/integrations/options docs pages; Logs GA blog
(2025-09-03); all six AI integration name strings.

**Not found / inconclusive:**
- No deprecation of breadcrumb APIs anywhere in the JS SDK (v10 or develop) — steering is
  docs-level only.
- No SDK affordance to mirror breadcrumbs↔logs (org-wide code search for
  `breadcrumbsAsLogs` / `breadcrumbs_as_logs` / `logsAsBreadcrumbs` / `sendLogsAsBreadcrumbs`:
  zero hits); develop.sentry.dev logs spec is silent on breadcrumbs.
- Exact v10.x release that introduced the `traceLifecycle` option: not pinned (no changelog
  entry names the option; the span-streaming feature line starts with PR #19218, 2026-02-19).
  Present with default `'static'` at 10.64.0, which is what matters for the pin.
- Whether late-finishing gen_ai children are actually dropped in static mode at 10.69.0 is
  inferred from static-lifecycle semantics and the blueprint's own comment, not re-verified
  against a running SDK.
