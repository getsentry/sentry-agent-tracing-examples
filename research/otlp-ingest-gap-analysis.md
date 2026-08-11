# eve → Sentry OTLP: two conversion gaps

2026-08-10 · lunchbot (`slack-agent-eve`) · org `sentry-developer-experience` · for the OTLP ingestion team

We ran a Slack agent through
[eve's Sentry OTLP integration](https://eve.dev/integrations/sentry-instrumentation)
and recorded each export request before Sentry received it. Sentry accepts and
stores everything. Two conversion gaps degrade specific surfaces.

## The problem

Ingest already derives the important AI attributes from the
[GenAI semantic convention](https://opentelemetry.io/docs/specs/semconv/gen-ai/)
data on these spans: `gen_ai.operation.type` (agent / ai_client / tool),
`gen_ai.agent.name`, and `gen_ai.cost.total_tokens`. Because the agent surfaces
select on those attributes, they work. Two conversions do not happen: the OTel
span name does not become `span.description`, and the ops stay `gen_ai` /
`default` instead of the dotted `gen_ai.*` ops the SDK path produces.
Everything that reads a description or filters on an op degrades.

Example traces from the run:
[agent turn 1](https://sentry-developer-experience.sentry.io/explore/traces/trace/80252eb2e173b3f9d9789d0f2f5e967a/?timestamp=1786374750) ·
[turn 2](https://sentry-developer-experience.sentry.io/explore/traces/trace/9b9b2ec76055bbd8e6b1203a00fdff0c/?timestamp=1786375190) ·
[turn 3](https://sentry-developer-experience.sentry.io/explore/traces/trace/4e477d1fc933b8acafef1251d4bbc364/?timestamp=1786375230)

## Impact by surface

| Surface | State | Why |
| --- | --- | --- |
| Agent monitoring (Insights → Agents) | works | Selects on `gen_ai.operation.type` and agent name (`insights/pages/agents/utils/query.tsx`). Ingest derives both. |
| Agent Timeline (trace view) | works, wrong labels | Finds the AI spans via attributes. The span detail panel titles the span `default` — the op — because the description is empty (Gap 1). |
| Trace waterfall | unreadable | Rows are labeled by description. Empty description falls back to the root transaction name, so every row reads `workflow.route.flow` (Gap 1). |
| Explore (spans) | attributes only | Queries on `gen_ai.*` attributes (tokens, cost, model) work. `span.description` columns are empty and `span.op:gen_ai.chat`-style filters match nothing (Gaps 1 + 2). |
| Dashboards & alerts | attributes only | Widgets and alert rules that aggregate `gen_ai.*` attributes work. Any that filter on dotted ops return no data (Gap 2). |
| Conversations (Explore) | empty | Groups AI spans by the `gen_ai.conversation.id` attribute (`explore/conversations/`). No span on this path carries it — see below. |

## Gap 1: `span.description` stays empty

Sentry stores the OTel span name in `span.name` but does not copy it into
`span.description`. Result in the waterfall
([turn 1](https://sentry-developer-experience.sentry.io/explore/traces/trace/80252eb2e173b3f9d9789d0f2f5e967a/?timestamp=1786374750)):

```
└─ http.server — POST /.well-known/workflow/v1/flow
   └─ message — workflow.route.flow
      ├─ default — workflow.route.flow   ← span.name: invoke_agent claude-sonnet-4.5
      ├─ default — workflow.route.flow   ← span.name: chat claude-sonnet-4.5
      ├─ default — workflow.route.flow   ← span.name: execute_tool present_lunch_options
      …
```

Expected: copy the OTel span name into the description, as the SDK path does.

## Gap 2: ops do not map to `gen_ai.*`

| `gen_ai.operation.name` (emitted) | `span.op` (stored) | `span.op` (SDK path) |
| --- | --- | --- |
| `chat` | `gen_ai` | `gen_ai.chat` |
| `invoke_agent` | `gen_ai` | `gen_ai.invoke_agent` |
| `execute_tool` | `default` | `gen_ai.execute_tool` |

Ingest classifies these spans correctly — the derived `gen_ai.operation.type`
says agent / ai_client / tool — but the op does not get the same treatment. The
`execute_tool` spans land on op `default` with full `gen_ai.tool.*` attributes
attached. Every op-based filter, group-by, dashboard widget, and alert built
for the SDK convention finds nothing.

## Conversations and `gen_ai.conversation.id`

The Conversations view groups AI spans across traces by one span attribute:
`gen_ai.conversation.id`. The attribute comes from the app, not from ingest. On
the SDK path the app calls `Sentry.setConversationId(threadId)` and the SDK
stamps the attribute on the AI spans of that thread. The OTLP path has no
equivalent: eve's template registers only an exporter and gives no hook to add
span attributes. So no span carries the attribute, and the view has nothing to
group. Fix options: eve exposes a span-attribute hook, or ingest derives a
conversation id from another field.

## Setup

`agent/instrumentation.ts` is the unchanged output of
`eve add instrumentation/sentry`
([template source](https://github.com/vercel/eve/blob/main/apps/docs/registry/instrumentation/sentry.ts)).
The app has no other Sentry code. The exporter is `OTLPHttpProtoTraceExporter`
from [@vercel/otel](https://github.com/vercel/otel); the gen_ai spans come from
[@ai-sdk/otel](https://github.com/vercel/ai/tree/main/packages/otel), which eve
registers.

```ts
export default defineInstrumentation({
  setup: ({ agentName }) =>
    registerOTel({
      serviceName: agentName,
      traceExporter: new OTLPHttpProtoTraceExporter({
        url: process.env.SENTRY_OTLP_TRACES_ENDPOINT!, // /api/<project>/integration/otlp/v1/traces
        headers: { "x-sentry-auth": `sentry sentry_key=${process.env.SENTRY_PUBLIC_KEY}` },
      }),
    }),
});
```

## Notes

- No errors and no logs arrive on this path. That is expected: the template
  configures a trace exporter only.
  [Sentry's OTLP intake](https://docs.sentry.io/concepts/otlp/) also accepts
  logs; eve does not send them.
- eve-side, not ingest: eve does not propagate trace context across its
  internal queue hops, so one conversation splits into many traces (each agent
  turn stays one connected trace). eve also names every step wrapper span
  `step 1`.

## Raw capture

`otlp-raw-capture.tar.gz`: the protobuf request bodies + decoded JSON, auth
headers excluded, recorded by a tee proxy that forwarded each request
unmodified.
