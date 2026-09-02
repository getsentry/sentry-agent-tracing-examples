# slack-agent-eve-otel

The OTLP-only twin of [`../slack-agent-eve`](../slack-agent-eve). Same agent,
same tools, same prompts. The one difference is how spans leave the process:

| | slack-agent-eve | slack-agent-eve-otel |
|---|---|---|
| Exporter | `@sentry/node` SDK, `traceLifecycle: "stream"` | `@vercel/otel` `OTLPHttpProtoTraceExporter` to Sentry's OTLP intake |
| Setup | `Sentry.init` in `agent/instrumentation.ts` | `registerOTel` per https://eve.dev/integrations/sentry-instrumentation |
| Sentry project | `slack-agent-eve` | `slack-agent-eve-otel` |
| `beforeSendSpan`, `Sentry.logger`, `captureException`, scope user | yes | none (no SDK) |

`functionId` and the `step.started` hook that records the Slack thread are kept
so `gen_ai.agent.name` and the card tools behave the same in both.

## Run both side by side

```bash
# terminal 1
cd ../slack-agent-eve && portless eve-sdk npx eve dev --no-ui
# terminal 2
cd ../slack-agent-eve-otel && portless eve-otel npx eve dev --no-ui
```

`eve invoke --url` treats a non-loopback URL as a Vercel deployment, so send the
prompt to the raw port each server prints (`server listening at http://127.0.0.1:<port>/`):

```bash
P='estimate the nutrition of a chicken burrito bowl, then tell me the protein in one sentence.'
npx eve invoke --url http://127.0.0.1:<sdk-port> "$P" &
npx eve invoke --url http://127.0.0.1:<otel-port> "$P" &
wait
```

## Compare the traces

Find each trace id in Explore (`has:gen_ai.operation.name`, one project at a
time), dump both with the `sentry` CLI, then print the AI span trees:

```bash
F="field=id&field=parent_span&field=span.op&field=span.name&field=span.description&field=span.duration&field=is_transaction&field=gen_ai.operation.name&field=gen_ai.request.model&field=gen_ai.usage.input_tokens&field=gen_ai.usage.output_tokens&field=gen_ai.agent.name&field=timestamp"
sentry api "/organizations/sentry-developer-experience/events/?dataset=spans&project=4511872415760384&statsPeriod=1h&per_page=100&query=trace:<sdk-trace>&$F" > /tmp/cmp/spans-sdk.json
sentry api "/organizations/sentry-developer-experience/events/?dataset=spans&project=4512019068682240&statsPeriod=1h&per_page=100&query=trace:<otel-trace>&$F" > /tmp/cmp/spans-otel.json
node scripts/compare-traces.mjs /tmp/cmp
```

## What the first comparison showed (2026-09-02)

Same span tree, same `gen_ai.*` attributes, same ops. Differences:

- **`span.description` is empty on every non-HTTP OTLP span.** The name lands in
  `span.name` only. Explore's default table and the AI Agents views key on the
  description, so those rows read as blank or as the bare op.
- **`invoke_agent` is named after the model in the OTLP path**
  (`invoke_agent anthropic/claude-sonnet-5`). The SDK path renames it to the
  agent (`invoke_agent mealbot`) in `beforeSendSpan`. `gen_ai.agent.name` is
  correct in both.
- **`gen_ai.conversation.id` and `user.id` exist only in the SDK path.** Both
  come from the SDK scope, so Explore > Conversations has nothing to group in
  the OTLP project.
- **SDK anomaly:** the second-step `invoke_agent mealbot` was ingested as its
  own segment with `span.op: http`, not `gen_ai.invoke_agent`. The OTLP path
  gave all three `invoke_agent` spans the right op.
- No `sentry.origin`, no logs, no error events in the OTLP path.
