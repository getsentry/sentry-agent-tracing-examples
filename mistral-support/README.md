# Mistral Support Agent

A terminal support assistant that looks up two fictional orders. Sentry's native
Mistral integration traces the model calls; the baseline app has no manual
application spans.

The integration is enabled by default when tracing is enabled. See
[Versions](#versions) for the supported SDK versions.

## Before You Start

You need Node.js 24.12 or later, pnpm, a Sentry DSN, and a Mistral API key for a
model that supports tool calling.

```bash
pnpm install
cp .env.example .env
```

Set `SENTRY_DSN` and `MISTRAL_API_KEY` in `.env`, then run:

```bash
pnpm typecheck
pnpm start
```

Ask about `ORD-1001` or `ORD-1002`. Use `/fail` to fail the next lookup, then
ask the question again to retry. Use `/quit` to exit.

## What Sentry Records Automatically

Each successful turn produces two automatic Mistral spans:

1. `chat <model>` records the prompt, tool definition, and `lookup_order` request.
2. `chat <model>` records the returned tool data and streamed reply.

Both calls share the conversation ID printed by the app. Without the optional
helpers, they can be in separate traces. The local lookup has no execution span.

## Optional Agent and Tool Spans

`tracing.ts` is inactive by default. To connect it, replace the existing import
from `orders.ts` in `assistant.ts` with these two imports:

```ts
import { orderTool } from "./orders.ts";
import { lookupOrder } from "./tracing.ts";
```

In `app.ts`, add the `traceTurn` import and replace the existing
`await answer(question, failNextTurn)` call inside the `try` block:

```ts
import { traceTurn } from "./tracing.ts";

await traceTurn(() => answer(question, failNextTurn));
```

Restart the app. The agent span groups the turn, and the tool span measures the
local lookup. With `/fail`, the first Mistral call completes, the tool fails,
and the second model call does not start. The next question retries normally.

## Privacy

This demo records inputs and outputs because all order data is fictional.
Set `dataCollection.genAI.inputs` and `dataCollection.genAI.outputs` to `false`
in `instrument.ts` to exclude that content. HTTP body and local-variable capture
are disabled separately. If you connect `tracing.ts`, omit or redact its tool argument and
result attributes separately; the integration options do not control them.

## Files

- `instrument.ts` initializes Sentry before Mistral loads.
- `orders.ts` defines the tool and in-memory order lookup.
- `assistant.ts` makes the two native Mistral calls.
- `app.ts` runs the terminal conversation.
- `tracing.ts` contains the optional agent and tool helpers.
- `spans.test.ts` checks the spans against a mocked Mistral API.

## Versions

`package.json` sets the minimum versions: Sentry JavaScript SDK 11.11.0 or
later, which traces Mistral SDK 3.x. `pnpm install` uses `pnpm-lock.yaml`, which
records the latest combination that passed the checks. The
[supported versions](https://docs.sentry.io/platforms/javascript/guides/node/configuration/integrations/mistral/#supported-versions)
page lists every Mistral version that the integration traces.

`pnpm test` runs the example against a mocked Mistral API, with no API keys.
It fails if the installed SDKs do not produce the model, agent, and tool spans
that this README describes. CI runs it on every change. Each week, Dependabot
refreshes the lockfile, and CI repeats the test with the latest release of each
SDK, so a new major version fails in CI before it reaches readers.
