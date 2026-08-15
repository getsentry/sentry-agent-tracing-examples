# Sentry Agent Tracing Demos

Three runnable apps that show how Sentry traces agentic behaviour with
[AI agent monitoring](https://docs.sentry.io/product/agents/). Each one uses a
different agent framework and runs in a different place, and each one produces
the same `gen_ai.*` span model.

| Directory | Framework | Runs in | Shows |
| --- | --- | --- | --- |
| [`slack-agent-eve/`](slack-agent-eve/) | [Eve](https://eve.dev) 0.34, `@sentry/node` | Slack, plus the local `eve dev` TUI | A DoorDash ordering agent driving `dd-cli` (in a Vercel Sandbox when deployed). Eve's AI SDK telemetry maps onto `gen_ai.*` spans; a Slack thread is one Sentry Conversation; the `estimate_nutrition` tool makes its own nested model call; each pick is a `meal.pick.added` log with calories and protein. |
| [`storefront-commerce/`](storefront-commerce/) | AI SDK 7 on Next.js 16, `@sentry/nextjs` | Browser chat panel in a storefront | Agent tracing beside ordinary app tracing: hand-built `db.query` spans nest under the tool that opened them, tool results render as generative UI, one chat session is one Conversation, and `refundOrder` has a planted bug that raises a real issue. |
| [`github-harness-flue/`](github-harness-flue/) | [Flue](https://flueframework.com) 2.0, `@sentry/node` | GitHub Action (`flue run`) | A headless PR reviewer: the `review-lead` agent delegates to two parallel subagents (`correctness-reviewer`, `style-reviewer`). One file wires Sentry end to end — spans, logs, and issues that all carry matching `flue.*` tags — and the agent code holds no Sentry calls of its own. |

Every model call goes through OpenRouter. Each demo is a self-contained npm
project — there is no workspace root.

## What the three have in common

- `gen_ai.conversation.id` is the conversation key on all three signals in
  every demo: `gen_ai` span attributes, the logs the agent writes, and a tag on
  errors. One conversation id pivots from Explore > Conversations to the logs
  and issues of the same run.
- Each agent has a fixed, lowercase kebab-case name in Sentry's AI views:
  `mealbot` (with the `nutrition-estimator` tool call), `shopping-assistant`,
  and `review-lead` with its two subagents (`correctness-reviewer`,
  `style-reviewer`).
- Content capture is spelled the same way in all three:
  `SENTRY_AI_RECORD_INPUTS` and `SENTRY_AI_RECORD_OUTPUTS`. Both directions are
  on when the variable is unset; set one to `false` to stop sending it. Each
  demo passes the pair to `dataCollection.genAI` on `Sentry.init` and to its
  framework's own content switch, so the two never disagree.
- Prompts and completions are the only content the SDK collects on its own.
  Cookies, HTTP headers, HTTP bodies, URL query parameters and stack-frame
  variables are turned off in all five app `Sentry.init` blocks — the
  storefront's server, edge and browser configs, Eve, and Flue — so nothing from
  an outbound call to OpenRouter, Slack or GitHub is collected. The SDK redacts
  keys whose name matches its sensitive-key denylist, but that is a denylist,
  not a guarantee. Each category is written out explicitly: supplying
  `dataCollection` at all switches the baseline to the SDK's defaults, which are
  all-on.
- Session Replay is the exception, and only in the storefront browser. It
  records the rendered page with `maskAllText: false` and `blockAllMedia: false`,
  so the assistant's replies, product cards and account details reach Sentry as
  recorded DOM even when `SENTRY_AI_RECORD_OUTPUTS=false` keeps them off the
  spans. The two switches cover span content, not the replay. Unmasking is safe
  here because the only shopper is fictional; keep Replay's masking defaults in
  an app with real customers.

## One emitter per app

Whoever emits the `gen_ai.*` spans decides every other tracing setting. Two
emitters produce two span trees for one run, each carrying `gen_ai.usage.*`, so
every token is counted twice in the spend dashboard and the AI detectors.

| App | Emitter | Sentry AI integrations |
| --- | --- | --- |
| `storefront-commerce` | Sentry's `vercelAIIntegration()` | on by default — it is the emitter |
| `slack-agent-eve` | Eve's `@ai-sdk/otel` | `VercelAI` filtered off |
| `github-harness-flue` | `@flue/opentelemetry` | all seven filtered off |

All three set `traceLifecycle: "stream"`, the default from v11. Use it for agent
tracing: `static` rebuilds each `gen_ai.*` span from a finished transaction and
drops the failure reason, so a failed tool call arrives with `span.status:
error` and an empty `span.status.message`. It also means `beforeSendTransaction`
and `ignoreTransactions` are never called — use `beforeSendSpan` and
`ignoreSpans`.

## Setup

```bash
cd <demo>
npm install
cp .env.example .env        # storefront-commerce: .env.local
```

Two values every demo needs:

- `OPENROUTER_API_KEY` — from [openrouter.ai/keys](https://openrouter.ai/keys)
- `SENTRY_DSN` — a Sentry project DSN (Settings > Client Keys). The storefront
  uses `NEXT_PUBLIC_SENTRY_DSN` instead, so the browser SDK also sees it.

Everything else in each `.env.example` is optional or channel-specific: Slack
tokens, a GitHub token, `dd-cli` credentials, model overrides, and source-map
upload. Missing optional variables degrade gracefully.

## A dashboard for the spans

[`dashboards/llm-spend-per-user.sh`](dashboards/llm-spend-per-user.sh) builds an
LLM spend dashboard and two spend alerts with the
[Sentry CLI](https://docs.sentry.io/cli/):

```bash
./dashboards/llm-spend-per-user.sh <org-slug> <project-slug>
```

Eight widgets — spend and tokens over time, top spenders, cost by model, most
expensive conversations — all from the `gen_ai.*` attributes the three demos
send, so the script works against any project that sends them.

## Working in the repo

Each demo has `npm run lint` (oxlint) and `npm run typecheck`. Run both from
the demo directory.

## Where to look next

Each demo's own `README.md` — how to run it, the span tree one agent turn
produces, and what to look at in Sentry.
