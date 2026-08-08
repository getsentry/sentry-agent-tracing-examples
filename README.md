# Sentry Agent Tracing Demos

Three standalone demos showing how Sentry monitors agentic behavior via
[AI agent tracing](https://docs.sentry.io/product/agents/), one per real-world
archetype: a chat bot in Slack, an assistant embedded in a product, and a
headless agent in CI. Each demo is a complete, runnable app whose every model
call, tool execution, and (in the storefront) database query lands as one
trace in Sentry — three different frameworks, three different ways the same
`gen_ai.*` span model gets produced.

| Directory | Framework | Channel | Demonstrates |
| --- | --- | --- | --- |
| [`slack-agent-eve/`](slack-agent-eve/) | [Eve](https://eve.dev) (Vercel's agent framework) | Slack (group-order links, @mentions, DMs) + local TUI | A DoorDash group-lunch agent (via local `dd-cli`) traced through Eve's OTel hook + Sentry's `vercelAIIntegration`; a tool with its own nested LLM call; Slack threads as Sentry Conversations |
| [`storefront-commerce/`](storefront-commerce/) | Vercel AI SDK + AI Elements on Next.js Commerce | In-app chat panel | Agent tracing next to classic app tracing: `db.query` spans nesting under tool spans, generative UI, Queries insights, per-session Conversations |
| [`github-harness-flue/`](github-harness-flue/) | [Flue](https://flueframework.com) | GitHub Action (`flue run`) | A multi-agent CI harness (lead + 2 parallel subagents) traced via Flue's official Sentry blueprint; logs, issues, and `flue.*` cross-signal tags |

All LLM calls go through OpenRouter. Each demo is a self-contained npm project.

## Setup (per demo)

```bash
cd <demo>
npm install
cp .env.example .env        # .env.local for storefront-commerce
```

Then fill in the two keys every demo needs:

- `OPENROUTER_API_KEY` — from [openrouter.ai/keys](https://openrouter.ai/keys)
- `SENTRY_DSN` — a Sentry project's DSN (Settings → Client Keys); the
  storefront uses `NEXT_PUBLIC_SENTRY_DSN` so the browser SDK sees it too

Everything else in each `.env.example` is optional or channel-specific (Slack
tokens, GitHub token, model overrides, source-map upload). No secrets are ever
hardcoded; missing optional vars degrade gracefully.

## Where to look next

- **[ARCHITECTURE.md](ARCHITECTURE.md)** — per-demo architecture diagrams, the
  exact call stack → Sentry span tree mapping, runbooks for generating traffic
  and reading the results in Sentry, and a comparison of the three
  instrumentation approaches.
- Each demo's own `README.md` — setup, run commands, and demo-specific notes.
- [`research/`](research/) — the four framework deep-dives (Eve, Flue,
  AI SDK/Commerce, Sentry agent tracing) the demos were built from: verbatim API
  surfaces, exact versions, gotchas. Check here before re-deriving anything.
