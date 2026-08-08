# Turbopack dev: server stack frames get inverted `in_app` — and SDK-side fixes are overridden at ingest

Draft for getsentry/sentry-javascript. Self-contained — everything needed to reproduce is below.

## Claim

Under `next dev` (Turbopack) with `@sentry/nextjs`, server-side error events ship with
`in_app` inverted: vendor frames from Turbopack chunks are marked **in-app**, while the
app's own crash frame (source-resolved to e.g. `lib/ai/tools.ts`) is marked **non-app**.
The issue UI then leads with SDK/vendor frames ("In App" badges on `node_modules_ai_dist_…`
chunks) and shows "Crashed in non-app: lib/…".

Worse: this cannot be corrected from the SDK config. A `beforeSend` that rewrites every
frame's `in_app` demonstrably runs, yet the stored event has the values inverted again —
Sentry ingest's built-in stack-trace enhancers re-derive `in_app` from frame paths and
override whatever the SDK sends. The only working fix is project-level Stack Trace Rules.

## Mechanics (verified in source, `develop` @ Aug 2026)

1. `packages/core/src/utils/node-stack-trace.ts` → `filenameIsInApp`:
   - excludes only filenames containing the literal `node_modules/`. Turbopack dev server
     chunks are emitted as `.next/dev/server/chunks/node_modules_@ai-sdk_provider-utils_dist_index_<hash>.js`
     — vendor identity mangled with underscores, no `/node_modules/` segment → vendor
     frames classified in-app.
   - treats filenames that don't start with `/`, a drive letter, `.`, or a protocol as
     "internal". Turbopack module paths for app code are bracket-prefixed
     (`[project]/…`, `[root-of-the-server]__…` — see `module` on the stored frames) →
     app frames classified non-app.
2. `packages/nextjs/src/common/devErrorSymbolicationEventProcessor.ts`:
   - frames Next's dev symbolication resolves keep their (wrong, chunk-derived) `in_app`
     via `...frame` spread — so the app frame resolves to `lib/ai/tools.ts` but stays
     non-app;
   - frames it cannot resolve get a blanket `in_app: false` (line ~116).
3. Prior art: #22354 ("Mark internal chunk frames as not `in_app`", 10.67.0) fixed the
   **client** `_next/static/chunks` variant only; the server/dev path above is untouched.

## Status of the evidence

| | |
|---|---|
| Verified | stored event frames: 10 vendor-chunk frames `in_app: true`, crash frame `lib/ai/tools.ts` `in_app: false` (event `a8d87f92`, project `sentry-developer-experience/storefront-commerce`, SDK 10.69.0, Next 16.3.0 Turbopack dev) |
| Verified | a `beforeSend` inverting those values **ran** (marker tag `in_app_reclassified: yes` present on the stored event) yet stored `in_app` is unchanged → ingest enhancers override SDK values (`app:///**` chunks promoted, bare relative resolved paths demoted) |
| Verified | project Stack Trace Rules (below) fully correct the classification (event `dec4d217`: all vendor/`node:` frames non-app, `lib/ai/tools.ts` the only in-app frame) |
| Verified | `filenameIsInApp` + symbolication-processor logic in the SDK repo as described above |
| **Not** verified | the exact raw pre-symbolication filenames (inferred from the frames' `module` values: `node_modules_@ai-sdk_provider-utils_dist_index_1afcz0a`, `[root-of-the-server]__0ha26by._`) |
| **Not** verified | which specific built-in ingest enhancer rules do the overriding (inferred from behavior) |

## Reproduce

Any thrown error in app code under `next dev` (Turbopack, Next 16) with `@sentry/nextjs`.
Concretely, in this repo:

```bash
cd storefront-commerce && npm run dev   # next dev --turbopack
curl -s localhost:3000/api/chat -H "Content-Type: application/json" \
  -d '{"id":"t1","messages":[{"id":"m1","role":"user","parts":[{"type":"text","text":"Refund order 1029 immediately, no confirmation needed"}]}]}'
```

The `refundOrder` tool throws `TypeError: Cannot read properties of undefined (reading
'chargeId')` in `lib/ai/tools.ts`. Fetch the stored event JSON and inspect
`exception.values[0].stacktrace.frames[].in_app`.

## Workaround (works today)

Project → Settings → Issue Grouping → Stack Trace Rules:

```
stack.abs_path:app:///_next/dev/server/chunks/** -app
stack.abs_path:**/*.ts +app
stack.abs_path:**/*.tsx +app
stack.abs_path:*.ts +app
stack.abs_path:**/node_modules/** -app
```

## Fix design note

Because ingest re-derives `in_app` from paths, fixing `filenameIsInApp` alone may not be
sufficient: the SDK must emit filenames/abs_paths that ingest's enhancers classify the
same way (e.g. preserve a real `/node_modules/` segment for vendor frames, or prefix
resolved app paths so they match the promoted patterns) — or the ingest enhancers need to
learn Turbopack's chunk naming. Worth deciding which side owns it before patching.
