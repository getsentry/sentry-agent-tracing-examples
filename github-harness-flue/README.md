# PR Review Harness — Flue + Sentry Agent Monitoring

A pull-request review agent built with [Flue](https://flueframework.com) that runs headless in a
GitHub Action, with every model turn, tool call, and subagent delegation traced in
[Sentry's AI Agent Monitoring](https://docs.sentry.io/product/agents/).

## Architecture

One `flue run` invocation executes the `ReviewLead` agent against a unified diff. The lead reads
the diff with a `read_diff` tool, then delegates two parallel review passes to focused subagents —
`correctness-reviewer` and `style-reviewer`, each running a cheaper model — synthesizes their
reports into a single review, and publishes it with a `post_review` tool. In demo mode the review
lands in `review.md`; with `POST_TO_GITHUB=true` it becomes a PR comment via the GitHub API.

When `SENTRY_ACCESS_TOKEN`, `SENTRY_ORG_SLUG`, and `SENTRY_APP_PROJECT_SLUG` are set, the lead
also runs a **Sentry impact check** over the hosted [Sentry MCP server](https://mcp.sentry.dev)
(`useMcpConnection`, authenticated with an `Authorization: Sentry-Bearer <token>` header —
Flue's standard `auth` field would send `Bearer` and trigger OAuth instead). It searches the
app's project for unresolved issues, compares their stack traces against the diff, resolves the
issues the diff genuinely fixes, and reports a "Sentry impact" section in the review. Two Sentry
projects are involved on purpose: the agent's own telemetry goes to one project (`SENTRY_DSN`),
while the issues it reasons about live in the app's project (`SENTRY_APP_PROJECT_SLUG`).

All model calls route through OpenRouter (Flue's built-in `openrouter/…` provider — the only
credential needed is `OPENROUTER_API_KEY`). Sentry is wired via Flue's official integration
(`src/sentry.ts`, the `tooling/sentry` blueprint): `Sentry.init` owns the global OpenTelemetry
tracer provider and Flue's OTel GenAI adapter emits the spans. Because `flue run` never loads
`app.ts`, the agent module imports `src/sentry.ts` itself. The CLI disposes instrumentation on
exit, which awaits `Sentry.flush` — nothing is lost when the short-lived CI process ends.

```
src/agents/review.ts    ReviewLead agent + both subagents + tools + Sentry MCP connection
src/sentry.ts           Flue's official Sentry blueprint (traces, logs, issues)
fixtures/sample.diff    A diff with seeded correctness and style problems
fixtures/fix.diff       A diff that FIXES those problems (drives the Sentry impact demo)
github-workflow/review.yml   The GitHub Actions workflow
```

## Setup

Requires Node >= 22.19.0.

```sh
npm install
cp .env.example .env   # then fill in OPENROUTER_API_KEY and SENTRY_DSN
```

## Run

```sh
npm run demo
```

This runs the whole harness against `fixtures/sample.diff` (the fixture hides an off-by-one retry
loop, a dropped `response.ok` check, and assorted style problems for the subagents to find) and
writes the finished review to `review.md`. Progress streams to stderr; the final verdict prints to
stdout. Exit code 0 means the submission completed — a failed agent fails the CI step naturally.

### In GitHub Actions

Copy `github-workflow/review.yml` to `.github/workflows/review.yml` of the repository you want
reviewed (it belongs there — GitHub only picks workflows up from that directory) and add
`OPENROUTER_API_KEY`, `SENTRY_DSN`, and `SENTRY_ACCESS_TOKEN` as repository secrets (the org and
app-project slugs are plain env vars in the workflow). On every PR the workflow exports the
diff with `gh pr diff`, runs the agent, and posts the review as a PR comment using the
workflow-provided `GITHUB_TOKEN`.

## What you'll see in Sentry

One trace per review, in the AI Agents dashboard. The span tree for a run against the fixture
looks like this (turn count varies with the model's plan):

```
invoke_agent ReviewLead
├── chat moonshotai/kimi-k2.6            plans, asks for the diff
├── execute_tool read_diff               loads fixtures/sample.diff
├── chat moonshotai/kimi-k2.6            delegates both review passes in one batch
├── invoke_agent correctness-reviewer    ┐ parallel subagent tasks
│   └── chat anthropic/claude-haiku-4.5  │ finds the off-by-one + swallowed HTTP errors
├── invoke_agent style-reviewer          │
│   └── chat anthropic/claude-haiku-4.5  ┘ flags var and the magic backoff numbers
├── execute_tool mcp__sentry__search_issues        ┐ Sentry impact check (when the
├── execute_tool mcp__sentry__get_sentry_resource  │ MCP env vars are set) — each
├── execute_tool mcp__sentry__update_issue         ┘ with a POST mcp.sentry.dev child
├── chat moonshotai/kimi-k2.6            synthesizes the combined review
├── execute_tool post_review             writes review.md / comments on the PR
└── chat moonshotai/kimi-k2.6            closing verdict
```

Every `chat` span carries token usage and cost (priced from the raw OpenRouter model IDs); the
`gen_ai.agent.name` on each span attributes usage to the lead vs. each subagent. The tools'
`ctx.log.info` lines land in Sentry Logs, trace-correlated. A terminal failure (bad API key,
unresolvable model) becomes exactly one Sentry Issue. Everything is tagged `flue.*`
(`flue.instance.id`, `flue.agent.name`, …), so one search pivots across the run's spans, logs, and
issues.

MCP tools trace like any other tool: each `mcp__sentry__*` call is an `execute_tool` span under
`invoke_agent ReviewLead`, with the transport's `POST https://mcp.sentry.dev/mcp` as its
`http.client` child. The one cosmetic wrinkle: the MCP *connection setup* requests
(initialize/tools-list, made while the connection resolves outside any tool span) appear as
their own short traces rather than under the agent trace.

Prompt/response content on spans is controlled by `SENTRY_AI_RECORD_INPUTS` /
`SENTRY_AI_RECORD_OUTPUTS` (on in `.env.example` so the demo shows full conversations; both
default off, and content is scrubbed and truncated to 16 KiB per attribute when enabled).
`SENTRY_TRACES_SAMPLE_RATE` must be > 0 or you get errors and logs only.
