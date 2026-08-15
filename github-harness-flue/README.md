# PR Review Harness — Flue + Sentry Agent Monitoring

A pull-request review agent built with [Flue](https://flueframework.com) that runs headless in a
GitHub Action, with every model turn, tool call, and subagent delegation traced in
[Sentry's AI Agent Monitoring](https://docs.sentry.io/product/agents/).

## Architecture

One `flue run` invocation executes the `review-lead` agent against a unified diff. The lead reads
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
(`src/sentry.ts`, described under [The Sentry bridge](#the-sentry-bridge) below):
`Sentry.init` owns the global OpenTelemetry tracer provider and Flue's OTel GenAI adapter emits
the spans. Because `flue run` never loads `app.ts`, the agent module imports `src/sentry.ts`
itself. The CLI disposes instrumentation on exit, so the bridge can flush.

```
src/agents/review.ts    review-lead agent + both subagents + tools + Sentry MCP connection
src/sentry.ts           The whole Sentry setup (traces, logs, issues)
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
npm run demo             # review fixtures/sample.diff
npm run demo:fix         # review fixtures/fix.diff — the Sentry impact path
npm run demo:tool-error  # review a path that does not exist — the tool-failure path
```

`npm run demo` runs the whole harness against `fixtures/sample.diff` (the fixture hides an
off-by-one retry loop, a dropped `response.ok` check, and assorted style problems for the subagents
to find) and writes the finished review to `review.md`. Progress streams to stderr; the final
verdict prints to stdout. Exit code 0 means the submission completed — a failed agent fails the CI
step naturally.

`npm run demo:fix` reviews the diff that repairs those defects. With the three `SENTRY_*` MCP
variables set, the lead matches the changed lines against the open issues of
`SENTRY_APP_PROJECT_SLUG` and resolves the ones this diff fixes, so the trace carries
`mcp__sentry__update_issue` spans and the review carries a populated "Sentry impact" section.

`npm run demo:tool-error` asks for `fixtures/latest.diff`, which does not exist. The `read_diff`
tool throws, and the failure lands in three places: the `execute_tool` span ends with error status
and `exception.*` attributes, the error text goes back to the model as the tool result, and the
agent recovers by falling back to `fixtures/sample.diff`. No Sentry Issue is raised — this harness
raises issues only for a failed operation or a failed submission, and a recovered tool call is
neither.

### In GitHub Actions

Copy `github-workflow/review.yml` to `.github/workflows/review.yml` of the repository you want
reviewed (it belongs there — GitHub only picks workflows up from that directory) and add
`OPENROUTER_API_KEY`, `SENTRY_DSN`, and `SENTRY_ACCESS_TOKEN` as repository secrets (the org and
app-project slugs are plain env vars in the workflow). On every PR the workflow exports the
diff with `gh pr diff`, runs the agent, and posts the review as a PR comment using the
workflow-provided `GITHUB_TOKEN`.

## What you'll see in Sentry

One trace per review, in the AI Agents dashboard. The tree below is a local `npm run demo`
against the fixture (turn count varies with the model's plan). The workflow tags its runs
`environment: ci`.

```
invoke_agent review-lead
├── chat x-ai/grok-4.5                   plans, asks for the diff
├── execute_tool read_diff               loads fixtures/sample.diff
├── chat x-ai/grok-4.5                   delegates both review passes in one batch
├── invoke_agent correctness-reviewer    ┐ parallel subagent tasks
│   └── chat anthropic/claude-haiku-4.5  │ finds the off-by-one + swallowed HTTP errors
├── invoke_agent style-reviewer          │
│   └── chat anthropic/claude-haiku-4.5  ┘ flags var and the magic backoff numbers
├── execute_tool mcp__sentry__search_issues        ┐ Sentry impact check (when the
├── execute_tool mcp__sentry__get_sentry_resource  │ MCP env vars are set) — each
├── execute_tool mcp__sentry__update_issue         ┘ with a POST mcp.sentry.dev child
├── chat x-ai/grok-4.5                   synthesizes the combined review
├── execute_tool post_review             writes review.md / comments on the PR
└── chat x-ai/grok-4.5                   closing verdict
```

Every `chat` span carries token usage and cost (priced from the raw OpenRouter model IDs); the
`gen_ai.agent.name` on each span attributes usage to the lead vs. each subagent. The tools'
`log.info` lines land in Sentry Logs, trace-correlated. A terminal failure (bad API key,
unresolvable model) usually surfaces as one Sentry Issue, not one per nested operation it
unwinds through. Issues and logs carry the same `flue.*` tag keys the spans carry as attributes
(`flue.instance.id`, `flue.session.name`, …), plus the run's root `gen_ai.conversation.id`, so one
search pivots across the run's spans, logs, and issues, and an issue links back to
Explore > Conversations.

MCP tools trace like any other tool: each `mcp__sentry__*` call is an `execute_tool` span under
`invoke_agent review-lead`, with the transport's `POST https://mcp.sentry.dev/mcp` as its
`http.client` child. The one cosmetic wrinkle: the MCP *connection setup* requests
(initialize/tools-list, made while the connection resolves outside any tool span) appear as
their own short traces rather than under the agent trace.

Prompt/response content on spans is controlled by `SENTRY_AI_RECORD_INPUTS` /
`SENTRY_AI_RECORD_OUTPUTS`. Each direction is on unless you set it to `false`, so the local demo
scripts show full conversations, while `github-workflow/review.yml` sets both to `false`. The
pair feeds both `Sentry.init`'s `dataCollection.genAI` and
the OTel adapter's own capture switch — the adapter reads no Sentry option, so it has to be told
the same values. Whatever is recorded is scrubbed of sensitive keys and truncated to 16 KiB per
attribute. `SENTRY_TRACES_SAMPLE_RATE` must be > 0 or you get errors and logs only; unset it
defaults to 1, and a value outside 0–1 warns and falls back to 1.

That gen_ai content is the only content this harness sends. `Sentry.init` switches off cookies,
HTTP headers, HTTP bodies, URL query parameters, GraphQL documents and variables, and stack-frame
variables, so nothing from the calls to GitHub and OpenRouter is collected — the SDK's redaction of
sensitive key names is a denylist, and frame locals are not filtered at all. Supplying
`dataCollection` does not switch the unlisted categories off; they keep the SDK's defaults.

## The Sentry bridge

`src/sentry.ts` is the entire Sentry setup for this harness. The agent code contains no Sentry
calls at all. Read it as a baseline: everything a Flue agent needs to be observable end to end,
and nothing past that.

- **Traces.** `Sentry.init` owns the global OpenTelemetry tracer provider, so Flue's
  `@flue/opentelemetry` adapter needs no exporter of its own. Sentry's provider integrations —
  the ones that patch the Anthropic, OpenAI or Vercel AI SDKs directly — are filtered out,
  because the adapter already emits one `chat` span per model turn and both would count it.
- **AI views.** Spans stream to Sentry one at a time (`traceLifecycle: 'stream'`). That is the
  ingest path that reads `gen_ai.operation.name` off a span and gives it a matching `gen_ai.*`
  op, and that op is what puts the span in the AI Agents views.
- **One review is one conversation.** A delegation opens a *child* conversation with its own id,
  and Sentry's Conversations view groups strictly by `gen_ai.conversation.id` — so one review
  would split into three rows. The bridge pins the first conversation of a submission as the
  root and writes it onto every span, keeping the child id as `flue.conversation.id`. It also
  restores each subagent's own name, which only `task_start` knows.
- **Issues.** A terminal failure usually raises one issue, not one per nested operation as the
  error unwinds. Each issue carries the same `flue.*` and `gen_ai.conversation.id` tags the spans
  carry, so one search term pivots between them.
- **Logs.** Flue's log events and its submission-recovery events become Sentry Logs with those
  same tags, so a retry or reconciliation is searchable on its own rather than only surviving
  attached to a later issue.
- **Content.** `SENTRY_AI_RECORD_INPUTS` and `SENTRY_AI_RECORD_OUTPUTS` drive both
  `dataCollection.genAI` and the adapter's own transform, which never see each other's config.
  Payloads are redacted by key name and capped at 16 KiB.
- **Flush.** The bridge registers before the adapter, so the runtime disposes it after. The
  adapter closes its open spans, then the bridge awaits `Sentry.flush` with a 2 second cap. A
  send that takes longer is not awaited.
