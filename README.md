# Sentry Agent Tracing Demos

Three runnable apps that show how Sentry traces agentic behaviour with
[AI agent monitoring](https://docs.sentry.io/product/agents/). Each one uses a
different agent framework and runs in a different place, and each one produces
the same `gen_ai.*` span model.

| Directory | Framework | Runs in | Shows |
| --- | --- | --- | --- |
| [`slack-agent-eve/`](slack-agent-eve/) | [Eve](https://eve.dev) 0.34, `@sentry/node` | Slack, plus the local `eve dev` TUI | A DoorDash ordering agent driving `dd-cli` (in a Vercel Sandbox when deployed). Eve's AI SDK telemetry maps onto `gen_ai.*` spans; a Slack thread is one Sentry Conversation; the `estimate_nutrition` tool makes its own nested model call; each pick is a `meal.pick.added` log with calories and protein. |
| [`storefront-commerce/`](storefront-commerce/) | AI SDK 7 on Next.js 16, `@sentry/nextjs` | Browser chat panel in a storefront | Agent tracing beside ordinary app tracing: hand-built `db.query` spans nest under the tool that opened them, tool results render as generative UI, one chat session is one Conversation, and `refundOrder` has a planted bug that raises a real issue. |
| [`github-harness-flue/`](github-harness-flue/) | [Flue](https://flueframework.com) 2.0, `@sentry/node` | GitHub Action (`flue run`) | A headless PR reviewer: the `review-lead` agent delegates to two parallel subagents (`correctness-reviewer`, `style-reviewer`). Wired with Flue's `tooling/sentry@1` blueprint plus local deltas, which send spans, logs, and issues with matching `flue.*` tags. |

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

## Working in the repo

Each demo has `npm run lint` (oxlint with the local anti-slop plugin in
`tools/oxlint/`) and `npm run typecheck`. Run both from the demo directory.

## Where to look next

- **[ARCHITECTURE.md](ARCHITECTURE.md)** — the call stack to span tree mapping
  for each demo, and a comparison of the three instrumentation approaches.
- Each demo's own `README.md` — how to run it and what to look at in Sentry.
