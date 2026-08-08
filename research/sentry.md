# Sentry AI-Agent Monitoring — JS/TS Instrumentation Research

Researched 2026-08-07 against live docs.sentry.io (every page below was fetched as raw
markdown by appending `.md` to the URL — do the same to re-verify). Raw page dumps are in
`./raw/` next to this file.

**Doc URL note:** Sentry recently moved the AI docs. The old
`/product/insights/ai/agents` and `/tracing/instrumentation/ai-agents-module` URLs are
**dead**. Current locations:

- Product hub: https://docs.sentry.io/product/agents/ (Set Up, Dashboards, Naming, Costs, Sampling, Privacy, Conversations, MCP)
- Node.js agent tracing: https://docs.sentry.io/platforms/javascript/guides/node/agent-tracing/
- Node.js manual instrumentation: https://docs.sentry.io/platforms/javascript/guides/node/agent-tracing/manual-instrumentation/
- Next.js agent tracing: https://docs.sentry.io/platforms/javascript/guides/nextjs/agent-tracing/

## Package versions (checked on npm registry 2026-08-07)

| Package | Version | Use in our demos |
| --- | --- | --- |
| `@sentry/node` | `10.69.0` | Slack bot (Eve) + GitHub Action harness (Flue) |
| `@sentry/nextjs` | `10.69.0` | Shopping assistant (Next.js Commerce) |
| `@sentry/opentelemetry` | `10.69.0` | Only if we do a fully custom OTel setup (SentrySpanProcessor route) — usually NOT needed |
| `@sentry/node-core` | `10.69.0` | Lightweight mode + `otlpIntegration` — alternative OTel bridge, experimental |
| `@sentry/cloudflare` | `10.69.0` | Not needed (no Workers demo) |

Version floors that matter (from docs):

- `openAIIntegration` / `anthropicAIIntegration` auto-enabled in Node requires SDK `>= 10.28.0`
- `vercelAIIntegration` requires SDK `>= 10.6.0`; supports `ai` `>=3.0.0 <=7`
- `openai` SDK supported range: `>=4.0.0 <7`; `@anthropic-ai/sdk`: `>=0.19.2 <1.0.0`
- Streamed standalone `gen_ai` spans since SDK `10.61.0` (default on; `streamGenAiSpans: false` opts out — only needed for self-hosted Sentry)
- `dataCollection` init option since SDK `10.57.0` (`sendDefaultPii` is deprecated, removed in v11)
- Node `>= 18.19.0` required for ESM `--import` (we run Node 24, fine)

---

## 1. The data model: gen_ai span conventions

Source (captured verbatim):
https://docs.sentry.io/platforms/javascript/guides/node/agent-tracing/manual-instrumentation.md

### Span hierarchy

```
── invoke_agent My Agent          (gen_ai.invoke_agent)
   ├── chat gpt-4o                (gen_ai.chat)         ← 1st LLM call
   ├── execute_tool get_weather   (gen_ai.execute_tool)  ← tool run
   ├── chat gpt-4o                (gen_ai.chat)         ← 2nd LLM call
   └── ...
```

`gen_ai.invoke_agent` is the container. `gen_ai.chat` and `gen_ai.execute_tool` spans are
its children (siblings of each other). A `gen_ai.chat` span can also appear without an
agent parent for standalone LLM calls.

### Common attributes (set when the span STARTS, before the model/tool call, so head-based sampling can see them)

- `gen_ai.operation.name` — required; classifies the span (`chat`, `invoke_agent`, `execute_tool`, …)
- `gen_ai.provider.name` — e.g. `openai`, `anthropic`
- `gen_ai.request.model` — requested model (pass the **raw** provider string)
- `gen_ai.agent.name` / `gen_ai.tool.name` — when applicable

Complex values (messages, tool definitions, arrays) must be **JSON strings** — span
attributes only accept primitives. Do NOT set `[{"foo": "bar"}]` but rather the string
`'[{"foo": "bar"}]'` (must be parsable JSON).

For manual spans, prompt/response/tool content is whatever you set on the span. Omit
those attributes (or gate them yourself) when you don't want to capture content.

### 1a. AI Request Span (`gen_ai.chat`)

Rules (verbatim):

- The span `op` (transaction mode) or the span's `sentry.op` attribute (stream mode) MUST be `"gen_ai.{gen_ai.operation.name}"`. (e.g. `"gen_ai.chat"`)
- The span `name` SHOULD be `"{gen_ai.operation.name} {gen_ai.request.model}"`. (e.g. `"chat o3-mini"`)
- The `gen_ai.operation.name` attribute MUST be `"chat"`, `"embeddings"`, `"generate_content"` or `"text_completion"`.
- The `gen_ai.provider.name` attribute MUST be the Generative AI product as identified by the client or server instrumentation. (e.g. `"openai"`)
- The `gen_ai.request.model` attribute MUST be the requested model. (e.g. `"o3-mini"`)
- The `gen_ai.response.model` attribute MUST be the concrete model that responded. (e.g. `"gpt-4o-2024-08-06"`)
- If the request originates from an agent, `gen_ai.agent.name` SHOULD be set to the agent's name. (e.g. `"Weather Agent"`)
- If relevant, `gen_ai.pipeline.name` SHOULD be set to the name of the AI workflow or pipeline. (e.g. `"weather-pipeline"`)

Doc example (verbatim):

```javascript
const messages = [
  { role: "user", parts: [{ type: "text", content: "Tell me a joke" }] },
];
const tools = [
  { name: "get_weather", description: "Get weather for a city" },
];

await Sentry.startSpan(
  {
    op: "gen_ai.chat",
    name: "chat o3-mini",
    attributes: {
      "gen_ai.operation.name": "chat",
      "gen_ai.request.model": "o3-mini",
      "gen_ai.provider.name": "openai",
      "gen_ai.agent.name": "Weather Agent", // when this call is under an agent
      "gen_ai.system_instructions": "You are a helpful assistant.",
      "gen_ai.tool.definitions": JSON.stringify(tools),
      "gen_ai.input.messages": JSON.stringify(messages),
    },
  },
  async (span) => {
    // Call your model provider; map its response into span attributes below
    const result = await yourLLMClient.chat({
      model: "o3-mini",
      messages,
    });

    span.setAttributes({
      "gen_ai.response.model": result.model,
      "gen_ai.response.id": result.id,
      "gen_ai.output.messages": JSON.stringify([
        {
          role: "assistant",
          parts: [{ type: "text", content: result.text }],
        },
      ]),
      "gen_ai.response.finish_reasons": JSON.stringify([
        result.finishReason,
      ]),
      "gen_ai.usage.input_tokens": result.usage.inputTokens,
      "gen_ai.usage.output_tokens": result.usage.outputTokens,
    });
    // If the provider reports cached tokens, record them as a subset of input tokens
    if (result.usage.cachedInputTokens != null) {
      span.setAttribute(
        "gen_ai.usage.cache_read.input_tokens",
        result.usage.cachedInputTokens,
      );
    }
    return result;
  },
);
```

Keep system prompts in `gen_ai.system_instructions`, not inside `gen_ai.input.messages`.
Conversation titles are derived from the first user message in the input messages.

#### Request attributes table (verbatim)

| Data Attribute | Type | Requirement Level | Description | Example |
| --- | --- | --- | --- | --- |
| `gen_ai.input.messages` | string | optional | List of message objects sent to the LLM. **[0]**, **[1]** | `'[{"role": "user", "parts": [{"type": "text", "content": "..."}]}]'` |
| `gen_ai.tool.definitions` | string | optional | List of objects describing the available tools. **[0]** | `'[{"name": "random_number", "description": "..."}]'` |
| `gen_ai.system_instructions` | string | optional | The system instructions passed to the model. | `"You are a helpful assistant."` |
| `gen_ai.request.frequency_penalty` | float | optional | Model configuration parameter. | `0.5` |
| `gen_ai.request.max_tokens` | int | optional | Model configuration parameter. | `500` |
| `gen_ai.request.seed` | string | optional | Seed for reproducible outputs. | `"12345"` |
| `gen_ai.request.temperature` | float | optional | Model configuration parameter. | `0.1` |
| `gen_ai.request.top_k` | int | optional | Limits model to K most likely next tokens. | `40` |
| `gen_ai.request.top_p` | float | optional | Model configuration parameter. | `0.7` |
| `gen_ai.request.presence_penalty` | float | optional | Model configuration parameter. | `0.5` |
| `gen_ai.request.reasoning.level` | string | optional | The reasoning or thinking effort level requested for a GenAI model. Supported values vary by provider. | `"medium"` |
| `gen_ai.request.messages` | string | optional | **Deprecated.** Use `gen_ai.input.messages` instead. | `'[{"role": "system", "content": "..."}]'` |
| `gen_ai.request.available_tools` | string | optional | **Deprecated.** Use `gen_ai.tool.definitions` instead. | `'[{"name": "random_number", "description": "..."}]'` |

#### Response attributes table (verbatim)

| Data Attribute | Type | Requirement Level | Description | Example |
| --- | --- | --- | --- | --- |
| `gen_ai.response.model` | string | required | The concrete model that responded (may differ from `gen_ai.request.model`). | `"gpt-4o-2024-08-06"` |
| `gen_ai.output.messages` | string | optional | Stringified array of message objects representing the model's output. **[0]**, **[1]** | `'[{"role": "assistant", "parts": [{"type": "text", "content": "..."}]}]'` |
| `gen_ai.response.finish_reasons` | string | optional | Stringified array of reasons the model stopped generating. **[0]** | `'["stop"]'` |
| `gen_ai.response.id` | string | optional | Unique identifier for the completion. | `"chatcmpl-abc123"` |
| `gen_ai.response.streaming` | boolean | optional | Whether the response was streamed. | `true` |
| `gen_ai.response.time_to_first_chunk` | double | optional | Seconds until first response chunk in streaming. | `0.5` |
| `gen_ai.response.text` | string | optional | **Deprecated.** Use `gen_ai.output.messages` instead. | `"The weather in Paris is rainy"` |
| `gen_ai.response.tool_calls` | string | optional | **Deprecated.** Use `gen_ai.output.messages` instead. **[0]** | `'[{"name": "random_number", "type": "function_call", "arguments": "..."}]'` |
| `gen_ai.response.time_to_first_token` | double | optional | **Deprecated.** Use `gen_ai.response.time_to_first_chunk` instead. | `0.5` |

#### Token usage table (verbatim — same table applies to invoke_agent spans)

| Data Attribute | Type | Requirement Level | Description | Example |
| --- | --- | --- | --- | --- |
| `gen_ai.usage.input_tokens` | int | optional | The number of tokens used in the AI input (prompt), including cached tokens. **[2]** | `60` |
| `gen_ai.usage.cache_read.input_tokens` | int | optional | The number of cached tokens used in the AI input (prompt). | `50` |
| `gen_ai.usage.cache_creation.input_tokens` | int | optional | Tokens written to cache when processing input. | `20` |
| `gen_ai.usage.output_tokens` | int | optional | The number of tokens used in the AI output, including reasoning tokens. **[3]** | `130` |
| `gen_ai.usage.reasoning.output_tokens` | int | optional | The number of tokens used for reasoning. | `30` |
| `gen_ai.usage.total_tokens` | int | optional | The sum of `gen_ai.usage.input_tokens` and `gen_ai.usage.output_tokens`. | `190` |
| `gen_ai.usage.input_tokens.cached` | int | optional | **Deprecated.** Use `gen_ai.usage.cache_read.input_tokens`. | `50` |
| `gen_ai.usage.input_tokens.cache_write` | int | optional | **Deprecated.** Use `gen_ai.usage.cache_creation.input_tokens`. | `20` |
| `gen_ai.usage.output_tokens.reasoning` | int | optional | **Deprecated.** Use `gen_ai.usage.reasoning.output_tokens`. | `30` |

Footnotes (verbatim):

- **[0]:** Span attributes only allow primitive data types → stringify JSON.
- **[1]:** Messages use the format `{role, parts}` where `parts` is an array of typed
  objects: `[{"role": "user", "parts": [{"type": "text", "content": "..."}]}]`. The
  `role` must be `"user"`, `"assistant"`, `"tool"`, or `"system"`. Each part has a
  `type`; common types include `"text"` (user-visible content), `"reasoning"` (internal
  thinking/chain-of-thought), `"tool_call"`, and `"tool_call_response"`. Use
  `{"type": "reasoning", "content": "..."}` for the model's thinking output — Sentry
  surfaces it separately and filters it out of the user-facing Conversations view, so do
  not represent thinking content as a `"text"` part. For backwards compatibility, the
  legacy format `{role, content}` is also accepted.
- **[2]:** Cached tokens are a subset of input tokens; `gen_ai.usage.input_tokens` includes `gen_ai.usage.cache_read.input_tokens`.
- **[3]:** Reasoning tokens are a subset of output tokens; `gen_ai.usage.output_tokens` includes `gen_ai.usage.reasoning.output_tokens`.

#### Tool calls inside messages — link request and result with the same `id` (verbatim)

```javascript
// Model asked to call a tool
span.setAttribute(
  "gen_ai.output.messages",
  JSON.stringify([
    {
      role: "assistant",
      parts: [
        {
          type: "tool_call",
          id: "call_abc",
          name: "get_weather",
          arguments: { location: "Paris" },
        },
      ],
    },
  ]),
);

// Later chat span: tool result fed back to the model
const inputWithTool = [
  {
    role: "user",
    parts: [{ type: "text", content: "Weather in Paris?" }],
  },
  {
    role: "assistant",
    parts: [
      {
        type: "tool_call",
        id: "call_abc",
        name: "get_weather",
        arguments: { location: "Paris" },
      },
    ],
  },
  {
    role: "tool",
    parts: [
      {
        type: "tool_call_response",
        id: "call_abc",
        name: "get_weather",
        content: '{"temp_c": 18}',
      },
    ],
  },
];
span.setAttribute("gen_ai.input.messages", JSON.stringify(inputWithTool));
```

### 1b. Invoke Agent Span (`gen_ai.invoke_agent`)

Rules (verbatim):

- The span `op` (transaction mode) or the span's `sentry.op` attribute (stream mode) MUST be `"gen_ai.invoke_agent"`.
- The span `name` SHOULD be `"invoke_agent {gen_ai.agent.name}"`.
- The `gen_ai.operation.name` attribute MUST be `"invoke_agent"`.
- The `gen_ai.agent.name` attribute SHOULD be set to the agent's name. (e.g. `"Weather Agent"`)
- If relevant, `gen_ai.pipeline.name` SHOULD be set to the name of the AI workflow or pipeline the agent belongs to.

Child `gen_ai.chat` spans should also set `gen_ai.agent.name` so model usage can be
attributed per agent.

Doc example (verbatim):

```javascript
const messages = [
  {
    role: "user",
    parts: [{ type: "text", content: "What's the weather in Paris?" }],
  },
];
const tools = [
  { name: "get_weather", description: "Get weather for a city" },
];

await Sentry.startSpan(
  {
    op: "gen_ai.invoke_agent",
    name: "invoke_agent Weather Agent",
    attributes: {
      "gen_ai.operation.name": "invoke_agent",
      "gen_ai.agent.name": "Weather Agent",
      "gen_ai.provider.name": "openai",
      "gen_ai.request.model": "o3-mini",
      "gen_ai.system_instructions": "You are a weather assistant.",
      "gen_ai.tool.definitions": JSON.stringify(tools),
      "gen_ai.input.messages": JSON.stringify(messages),
    },
  },
  async (span) => {
    // myAgent is your agent runner; expect { output, usage: { inputTokens, outputTokens } }
    const result = await myAgent.run();

    span.setAttribute(
      "gen_ai.output.messages",
      JSON.stringify([
        {
          role: "assistant",
          parts: [{ type: "text", content: String(result.output) }],
        },
      ]),
    );
    span.setAttribute(
      "gen_ai.usage.input_tokens",
      result.usage.inputTokens,
    );
    span.setAttribute(
      "gen_ai.usage.output_tokens",
      result.usage.outputTokens,
    );
    return result;
  },
);
```

Invoke-agent request attributes: `gen_ai.input.messages`, `gen_ai.tool.definitions`,
`gen_ai.system_instructions`, `gen_ai.pipeline.name` (all optional strings; same
footnotes). Response attributes: `gen_ai.output.messages` (optional). Token usage: same
table as above.

### 1c. Execute Tool Span (`gen_ai.execute_tool`)

Rules (verbatim):

- The span `op` (transaction mode) or the span's `sentry.op` attribute (stream mode) MUST be `"gen_ai.execute_tool"`.
- The span `name` SHOULD be `"execute_tool {gen_ai.tool.name}"`. (e.g. `"execute_tool query_database"`)
- The `gen_ai.operation.name` attribute MUST be `"execute_tool"`.
- The `gen_ai.tool.name` attribute SHOULD be set to the name of the tool. (e.g. `"query_database"`)

Doc example (verbatim):

```javascript
await Sentry.startSpan(
  {
    op: "gen_ai.execute_tool",
    name: "execute_tool get_weather",
    attributes: {
      "gen_ai.operation.name": "execute_tool",
      "gen_ai.tool.name": "get_weather",
      "gen_ai.tool.description": "Get weather for a city",
      "gen_ai.tool.call.arguments": JSON.stringify({ location: "Paris" }),
    },
  },
  async (span) => {
    try {
      const result = await getWeather({ location: "Paris" });
      span.setAttribute("gen_ai.tool.call.result", JSON.stringify(result));
      return result;
    } catch (error) {
      span.setStatus({ code: 2, message: "internal_error" });
      span.setAttribute(
        "error.type",
        error instanceof Error ? error.constructor.name : "Error",
      );
      throw error;
    }
  },
);
```

Marking failed tools with an error status populates the Tool Errors widget.

Execute-tool attribute table (verbatim):

| Data Attribute | Type | Requirement Level | Description | Example |
| --- | --- | --- | --- | --- |
| `gen_ai.tool.name` | string | optional | Name of the tool executed. | `"random_number"` |
| `gen_ai.tool.call.arguments` | string | optional | Arguments of the tool call (stringified JSON). | `"{\"max\":10}"` |
| `gen_ai.tool.call.result` | string | optional | Result of the tool call (stringified). | `"7"` |
| `gen_ai.tool.description` | string | optional | Description of the tool executed. | `"Tool returning a random number"` |
| `gen_ai.tool.type` | string | optional | The type of the tools. | `"function"`; `"extension"`; `"datastore"` |
| `gen_ai.tool.input` | string | optional | **Deprecated.** Use `gen_ai.tool.call.arguments`. | `"{\"max\":10}"` |
| `gen_ai.tool.output` | string | optional | **Deprecated.** Use `gen_ai.tool.call.result`. | `"7"` |

### 1d. Streaming responses (manual)

Set `gen_ai.response.streaming: true`, `gen_ai.response.time_to_first_chunk` (seconds),
optionally `gen_ai.response.tokens_per_second`; set output messages/usage/response.model
once the stream completes. Use `Sentry.startInactiveSpan` so the span outlives the
initial call, `Sentry.withActiveSpan(span, () => ...)` so children nest, and `span.end()`
on stream end/error. (Full verbatim example in `raw/node-agent-tracing-manual.md`,
"Streaming Responses" section.)

### 1e. Token/cost gotchas (verbatim summary)

`gen_ai.usage.input_tokens` is the **total** input token count that already includes any
cached tokens; `gen_ai.usage.output_tokens` already includes reasoning tokens. Sentry
subtracts the cached/reasoning counts from the totals — reporting the non-cached count as
`input_tokens` produces wrong or **negative** costs. Sentry derives model cost from the
model name + token counts (pricing data comes from **models.dev and OpenRouter**). You do
not need to set `gen_ai.cost.*`. Pass the raw provider model string unchanged so pricing
can resolve.

### 1f. Naming agents (product/agents/naming)

Sentry uses `gen_ai.agent.name` to identify agents in the AI Agents Dashboard. Without a
name you can't filter/group/alert per agent.

- **Vercel AI SDK (JS):** set `experimental_telemetry: { functionId: "weather_agent" }` on
  `generateText`/`streamText` or on the `ToolLoopAgent` constructor — Sentry uses
  `functionId` as the agent identifier (appears on spans as `gen_ai.function_id`).
- **Manual/raw clients:** wrap the loop in a `gen_ai.invoke_agent` span and set
  `gen_ai.agent.name` (example above).

### 1g. Conversations (beta) + user attribution

- Group multi-turn chats via the `gen_ai.conversation.id` span attribute. Set it with
  `Sentry.setConversationId("conv_abc123")` at the start of **every request/operation
  that makes AI calls**, before those calls run; it applies to AI spans on the current
  isolation scope (request-scoped). Pass `null` to unset. Reuse the same session ID
  across messages of one chat (e.g. Slack thread ts, chat session UUID). Use a short
  opaque ID (UUID or `conv_...`), never free-form text.
- `Sentry.setUser({ id, email, username })` once per request/session before AI calls
  populates the User column in Explore > Conversations. Any one field is sufficient.
- Conversation titles come from the first user message in `gen_ai.input.messages`.

---

## 2. Automatic instrumentation in @sentry/node and @sentry/nextjs

### 2a. vercelAIIntegration (`Sentry.vercelAIIntegration`)

Source: https://docs.sentry.io/platforms/javascript/guides/node/configuration/integrations/vercelai.md
(and the nextjs variant, which adds runtime-difference docs)

- Instruments the `ai` package via the AI SDK's built-in telemetry. **Enabled by default**
  in Node once tracing is on — zero setup:

  ```javascript
  Sentry.init({
    dsn: "https://<key>@o<orgId>.ingest.sentry.io/<projectId>",
    tracesSampleRate: 1.0,
  });
  ```

- Do NOT use the AI SDK's `registerTelemetry` API (AI SDK v7+) together with this
  integration — duplicate spans.
- Captures: `generateText()`, `streamText()`, `generateObject()`, `streamObject()`,
  `embed()`, `embedMany()`, `rerank()`, plus `generate()`/`stream()` on `ToolLoopAgent`
  (each agent call becomes an agent span with LLM requests and tool executions as
  children — the AI SDK tool loop gives you the full tree automatically).
- **Prompts/completions are NOT captured until you opt in.** Resolution order for
  `recordInputs`/`recordOutputs` (first one set wins):
  1. The integration option — applies to every call.
  2. The call's `experimental_telemetry` — applies to that call.
  3. `dataCollection.genAI` — applies to every call.
  The integration option wins over the call; `recordInputs: false` on the integration
  cannot be re-enabled per call.

  ```javascript
  Sentry.init({
    dsn: "https://<key>@o<orgId>.ingest.sentry.io/<projectId>",
    tracesSampleRate: 1.0,
    integrations: [
      Sentry.vercelAIIntegration({
        recordInputs: true,
        recordOutputs: true,
      }),
    ],
  });
  ```

- Options: `recordInputs?: boolean`, `recordOutputs?: boolean`,
  `enableTruncation: boolean = true` (truncates recorded input messages to stay within
  span size limits; inputs only), `force: boolean = false` (registers span processors
  even when the `ai` module can't be detected — needed when the build bundles `ai`).
- Per-call control via `experimental_telemetry` on any `ai` function:
  `{ isEnabled, recordInputs, recordOutputs, functionId }`. `functionId` labels the call
  site → `gen_ai.function_id` and is the agent name Sentry shows.
- `ToolLoopAgent` takes `experimental_telemetry` on the **constructor**, not on
  `generate()`/`stream()`.

**Next.js runtime differences (from the nextjs page — important for the commerce demo):**

|  | Node runtime | Edge runtime |
| --- | --- | --- |
| Enabled by default | Yes | No — add it to `sentry.edge.config` |
| `experimental_telemetry` per call | Not needed | Required (`isEnabled: true`), or no spans are created |
| Record inputs and outputs | Integration or per call | Per call only (integration options silently ignored) |
| `force` | Available | Not available — always active |
| AI SDK v7 | Supported | Not supported |

**Vercel deployment gotcha (verbatim from troubleshooting):** on Vercel/Next.js
production builds the `ai` package is bundled (not externalized), which defeats module
detection — spans show raw names like `ai.toolCall` instead of `gen_ai.execute_tool`.
Fix: in `sentry.server.config.ts`:

```javascript
Sentry.init({
  dsn: "https://<key>@o<orgId>.ingest.sentry.io/<projectId>",
  integrations: [Sentry.vercelAIIntegration({ force: true })],
});
```

### 2b. openAIIntegration (`Sentry.openAIIntegration`)

Source: https://docs.sentry.io/platforms/javascript/guides/node/configuration/integrations/openai.md

- Wraps the `openai` SDK (`>=4.0.0 <7`). Enabled by default in Node runtimes (SDK
  `>= 10.28.0`). Instruments `chat.completions.create()` and `responses.create()`
  (both produce op `gen_ai.chat`, name `chat <model>`). Streaming auto-detected.
- Options: `recordInputs` / `recordOutputs` — each defaults to `true` if
  `dataCollection.genAI.inputs`/`.outputs` is `true` (which is the default when using
  `dataCollection`), or if the deprecated `sendDefaultPii` is `true`.

  ```javascript
  Sentry.init({
    dsn: "...",
    // Tracing must be enabled for agent tracing to work
    tracesSampleRate: 1.0,
    integrations: [
      Sentry.openAIIntegration({
        recordInputs: true,
        recordOutputs: true,
      }),
    ],
  });
  ```

- **The OpenAI SDK does not run your tools** — so the integration does NOT create
  `gen_ai.execute_tool` spans. To get the full agent tree
  (`gen_ai.invoke_agent` → `gen_ai.chat` + `gen_ai.execute_tool`), wrap your tool loop
  with manual instrumentation (section 4). Tool definitions passed as `tools` and the
  model's returned `tool_calls` ARE recorded on the chat span.
- **Streaming token usage:** you must pass `stream_options: { include_usage: true }` to
  OpenAI streaming calls or token usage will be missing (OpenAI API behavior):

  ```javascript
  const stream = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: "Hello!" }],
    stream: true,
    stream_options: { include_usage: true },
  });
  ```

- The Conversations page notes the "OpenAI SDK for Node" integration automatically
  infers `gen_ai.conversation.id` (for others set it manually).

### 2c. anthropicAIIntegration (`Sentry.anthropicAIIntegration`)

Source: https://docs.sentry.io/platforms/javascript/guides/node/configuration/integrations/anthropic.md

- Wraps `@anthropic-ai/sdk` (`>=0.19.2 <1.0.0`). Enabled by default in Node (SDK
  `>= 10.28.0`). Instruments `messages.create()`, `messages.stream()`,
  `messages.countTokens()`, `models.get()`, `completions.create()`,
  `models.retrieve()`, `beta.messages.create()`.
- Same `recordInputs`/`recordOutputs` defaults as the OpenAI integration.

Also available (same pattern, not needed for our demos): `googleGenAIIntegration`,
LangChain, LangGraph integrations.

### 2d. OpenRouter interplay (for all three demos)

- **Vercel AI SDK route (shopping assistant, and Eve if it uses the AI SDK):**
  `vercelAIIntegration` hooks the `ai` package's telemetry, which is
  provider-agnostic — using `@openrouter/ai-sdk-provider` (or any provider) changes
  nothing about the instrumentation. This is the cleanest path.
- **OpenAI-SDK-with-baseURL route:** OpenRouter is OpenAI-API-compatible; pointing the
  `openai` npm package at `baseURL: "https://openrouter.ai/api/v1"` keeps
  `openAIIntegration` working because it wraps the SDK's methods, not the endpoint.
  (Inference from how the integration is described — the docs don't mention custom
  baseURLs explicitly. `gen_ai.provider.name` will report `openai`.)
- **Cost tracking:** Sentry's pricing database includes **OpenRouter** model slugs
  (`product/agents/costs`), so raw OpenRouter model strings like
  `openai/gpt-4o-mini` should resolve to prices. Pass them through unchanged.
- **Bonus, zero-code:** OpenRouter's **Broadcast** feature (beta) can forward traces
  for every OpenRouter request directly to Sentry's OTLP endpoint — configured in
  OpenRouter Settings > Broadcast with the project's OTLP Traces Endpoint
  (`https://o<orgId>.ingest.sentry.io/api/<projectId>/integration/otlp/v1/traces`) and
  DSN. Docs: https://docs.sentry.io/product/drains/openrouter.md. Worth a README
  mention; not a substitute for in-process agent spans.

---

## 3. Plain Node/TS process setup (GitHub Action harness)

Source: https://docs.sentry.io/platforms/javascript/guides/node.md and
`/install/esm.md`, `/configuration/apis.md`, `/configuration/options.md`

### Install

```bash
npm install @sentry/node
```

### instrument.mjs (must run before anything else)

```javascript
import * as Sentry from "@sentry/node";

// Ensure to call this before importing any other modules!
Sentry.init({
  dsn: "https://<key>@o<orgId>.ingest.sentry.io/<projectId>",

  // Add Tracing by setting tracesSampleRate
  // We recommend adjusting this value in production
  tracesSampleRate: 1.0,
});
```

For the demos, use env-driven config instead of literals — the SDK reads `SENTRY_DSN`,
`SENTRY_ENVIRONMENT`, `SENTRY_RELEASE` from the environment automatically (see section 6),
so `Sentry.init({ tracesSampleRate: 1.0, ... })` without a `dsn` key also works.

### ESM `--import` pattern (required for ESM; Node >= 18.19.0)

```bash
node --import ./instrument.mjs app.mjs
```

or when you can't touch the node invocation (e.g. inside npm scripts / GitHub Actions):

```bash
NODE_OPTIONS="--import ./instrument.mjs" npm run start
```

CJS alternative: `require("./instrument")` as the first line of the entry file, or
`node --require ./instrument.js app.js`.

Why so early: the SDK wraps ESM imports via `import-in-the-middle` loader hooks; modules
imported before `Sentry.init()` (including `openai`, `@anthropic-ai/sdk`, `ai`) are not
instrumented. If loader hooks cause syntax errors, `registerEsmLoaderHooks: false`
disables them (also disables tracing auto-instrumentation).

For a TypeScript CLI run with `tsx`, the same pattern applies:
`node --import tsx --import ./src/instrument.ts src/main.ts` — keep `Sentry.init` in its
own module imported first. (tsx specifics are not from Sentry docs; verify at build time.)

### Flushing before exit — critical for short-lived CI processes

```
function flush(timeout?: number): Promise<boolean>
```

"Flushes all pending events. Maximum time in ms the client should wait to flush its
event queue. Omitting this parameter will cause the client to wait until all events are
sent before resolving the promise."

```
function close(timeout?: number): Promise<boolean>
```

"Flushes all pending events and disables the SDK. … only call `close` immediately before
shutting down the application."

Recommended pattern for the Action harness:

```javascript
try {
  await runAgent();
} finally {
  await Sentry.flush(5000); // or Sentry.close(5000) right before process exit
}
```

Related option: `shutdownTimeout` (default `2000` ms) — how long the background queue is
given to drain; "Setting this value too low may cause problems for sending events from
command line applications."

Note: with SDK >= 10.61.0, `gen_ai` spans are sent as **standalone envelope items**
("stream mode", `streamGenAiSpans` default true) — flushing before exit matters for
these too, same API.

### Next.js file layout (shopping assistant)

`npm install @sentry/nextjs --save`, then:

- `next.config.ts` — wrap with `withSentryConfig(nextConfig, { org, project, silent: !process.env.CI })`
- `instrumentation-client.ts` — client init (only needed if we want client-side Sentry; use `NEXT_PUBLIC_SENTRY_DSN`); export `onRouterTransitionStart = Sentry.captureRouterTransitionStart`
- `sentry.server.config.ts` — server init: DSN + `tracesSampleRate` + `vercelAIIntegration({ recordInputs: true, recordOutputs: true, force: true })`
- `sentry.edge.config.ts` — edge init (needed only if AI routes run on edge; prefer Node runtime for the chat route)
- `instrumentation.ts` — `register()` imports server/edge config by `process.env.NEXT_RUNTIME`; `export const onRequestError = Sentry.captureRequestError;` (requires `@sentry/nextjs >= 8.28.0`, Next 15)
- `app/global-error.tsx` — captureException in a client error boundary

(Full verbatim file contents in `raw/nextjs-manual-setup.md`.)

---

## 4. Manual span API (wrapping an agent loop so spans nest)

Source: https://docs.sentry.io/platforms/javascript/guides/node/tracing/instrumentation.md

Three functions:

- `Sentry.startSpan(options, callback)` — active span, auto-ends when the (sync or
  async) callback finishes; rejected promise / thrown error marks the span failed.
  **Spans started inside the callback automatically become children** — this is what
  makes the agent loop nest correctly: start `gen_ai.invoke_agent` with `startSpan`,
  and inside its callback start `gen_ai.chat` / `gen_ai.execute_tool` spans.
- `Sentry.startSpanManual(options, (span) => ...)` — active, but you call `span.end()`.
- `Sentry.startInactiveSpan(options)` — no children auto-attached; combine with
  `Sentry.withActiveSpan(span, () => ...)` to parent children explicitly (used for
  streaming).

Span options: `name` (required), `op`, `startTime`, `attributes`
(`Record<string, Primitive>` — string/number/boolean or non-mixed arrays thereof),
`parentSpan`, `onlyIfParent`, `forceTransaction`.

Nesting example (verbatim):

```javascript
const result = await Sentry.startSpan(
  {
    name: "Important Function",
  },
  async () => {
    const res = await Sentry.startSpan({ name: "Child Span" }, () => {
      return expensiveAsyncFunction();
    });

    return updateRes(res);
  },
);
```

Utilities: `Sentry.getActiveSpan()`, `span.setAttribute(s)`,
`Sentry.updateSpanName(span, name)`, span status
`span.setStatus({ code: 2, message: "internal_error" })` (0 unknown / 1 ok / 2 error).

For the agent-shaped examples with the exact gen_ai ops and attributes, see section 1 —
those snippets are the canonical way to wrap a loop.

---

## 5. OpenTelemetry route (Flue / frameworks that emit OTel spans)

Ranked by fit for a demo that already runs `@sentry/node`:

### Option A (default, simplest): just use @sentry/node — it IS an OTel SDK

Source: https://docs.sentry.io/platforms/javascript/guides/node/opentelemetry.md and
`/opentelemetry/using-opentelemetry-apis.md`

> "The Sentry SDK uses OpenTelemetry under the hood. This means that any OpenTelemetry
> instrumentation that emits spans will automatically be picked up by Sentry without any
> further configuration."

> "Sentry supports OpenTelemetry APIs out of the box. Any spans started using
> OpenTelemetry APIs will be automatically captured by Sentry, while any spans started
> using the Sentry SDK will be automatically propagated to OpenTelemetry."

So if Flue creates spans via `@opentelemetry/api` (`tracer.startActiveSpan(...)`), a
plain `Sentry.init({ tracesSampleRate: 1.0 })` in `instrument.mjs` captures them —
no exporter, no collector, no extra packages. If Flue's spans follow the OTel `gen_ai.*`
semconv, they land with those attributes; wrap the run in our own
`gen_ai.invoke_agent` `Sentry.startSpan` for the agent container and set any missing
`gen_ai.*` attributes manually.

Extra hooks if needed:

```javascript
Sentry.init({
  dsn: "...",
  tracesSampleRate: 1.0,
  // Add additional OpenTelemetry instrumentation:
  openTelemetryInstrumentations: [new GenericPoolInstrumentation()],
  // Add additional OpenTelemetry SpanProcessors:
  openTelemetrySpanProcessors: [new MySpanProcessor()],
});
```

Also: `Sentry.getClient()?.tracer` (Sentry's tracer for native OTel APIs) and
`Sentry.getClient()?.traceProvider`.

### Option B: framework owns the TracerProvider → SentrySpanProcessor

Source: https://docs.sentry.io/platforms/javascript/guides/node/opentelemetry/custom-setup.md
Only if the framework insists on constructing its own `NodeTracerProvider`. Requires
`@sentry/opentelemetry` (v10.69.0):

```javascript
const Sentry = require("@sentry/node");
const {
  SentrySpanProcessor,
  SentryPropagator,
  SentrySampler,
} = require("@sentry/opentelemetry");

const { NodeTracerProvider } = require("@opentelemetry/sdk-trace-node");

const sentryClient = Sentry.init({
  dsn: "https://<key>@o<orgId>.ingest.sentry.io/<projectId>",
  skipOpenTelemetrySetup: true,

  // The SentrySampler will use this to determine which traces to sample
  tracesSampleRate: 1.0,
});

// Note: This could be BasicTracerProvider or any other provider depending on
// how you are using the OpenTelemetry SDK
const provider = new NodeTracerProvider({
  // Ensure the correct subset of traces is sent to Sentry
  // This also ensures trace propagation works as expected
  sampler: sentryClient ? new SentrySampler(sentryClient) : undefined,
  spanProcessors: [
    // Ensure spans are correctly linked & sent to Sentry
    new SentrySpanProcessor(),
    // Add additional processors here
  ],
});

provider.register({
  // Ensure trace propagation works
  // This relies on the SentrySampler for correct propagation
  propagator: new SentryPropagator(),
  // Ensure context & request isolation are correctly managed
  contextManager: new Sentry.SentryContextManager(),
});

// Validate that the setup is correct
Sentry.validateOpenTelemetrySetup();
```

### Option C: OTLP — no Sentry SDK in the loop at all (beta)

Source: https://docs.sentry.io/concepts/otlp/direct/traces.md
Point any OTel SDK exporter at the project's OTLP endpoint:

```bash
export OTEL_EXPORTER_OTLP_TRACES_ENDPOINT="https://o<orgId>.ingest.sentry.io/api/<projectId>/integration/otlp/v1/traces"
export OTEL_EXPORTER_OTLP_TRACES_HEADERS="x-sentry-auth=sentry sentry_key=<your-public-key>"
```

(The endpoint + public key are shown in Project Settings > Client Keys (DSN) >
OpenTelemetry tab.) Limitations: span events dropped; span links and array attributes
not searchable. OTLP ingest is open beta. There is also an experimental middle path:
`@sentry/node-core/light` + `otlpIntegration()` (auto-derives the OTLP endpoint from the
DSN) — see `raw/node-lightweight.md`.

**Recommendation for the Flue demo:** Option A. One `instrument.mjs`, zero OTel wiring,
and manual `gen_ai.*` spans (section 1) for the agent/tool tree; Flue's own OTel spans
come along for free in the same trace.

---

## 6. PII flags + env vars for the demos

### Make prompts/responses visible (this is a demo — we want content ON)

Modern switch (SDK >= 10.57.0) is `dataCollection`; `sendDefaultPii` is deprecated
(removed in v11; if both set, `dataCollection` wins).

```javascript
Sentry.init({
  dsn: "https://<key>@o<orgId>.ingest.sentry.io/<projectId>",
  tracesSampleRate: 1.0,
  dataCollection: {},
});
```

- Passing `dataCollection` (even `{}`) opts into the **permissive defaults**: genAI
  inputs+outputs on, plus user info, cookies, headers, HTTP bodies, query params,
  stack-frame locals (all scrubbed against the built-in sensitive-key denylist).
- To keep AI content on but tighten the rest, set categories explicitly, e.g.:

  ```javascript
  dataCollection: {
    genAI: { inputs: true, outputs: true },
    userInfo: false,
    httpBodies: [],
  }
  ```

- To turn AI content off: `dataCollection: { genAI: { inputs: false, outputs: false } }`.
- Per-integration override: `recordInputs` / `recordOutputs` on
  `vercelAIIntegration` / `openAIIntegration` / `anthropicAIIntegration` (integration
  option > per-call `experimental_telemetry` > `dataCollection.genAI`).
- **vercelAIIntegration is the odd one out**: inputs/outputs are OFF until you opt in
  via one of those three levels; the openai/anthropic integrations default ON as soon
  as any `dataCollection` config exists.
- Manual spans ignore all of this — content is whatever you set on the span; gate it
  yourself if needed.
- Server-side scrubbing does NOT protect `gen_ai.input.messages`,
  `gen_ai.tool.call.arguments`, `gen_ai.tool.call.result`, `gen_ai.output.messages`,
  `gen_ai.response.object` by default; org/project Advanced Data Scrubbing rules of the
  form `$span.data.'<span attribute>'` can be added if wanted.

### Env vars to standardize on (read automatically by the SDK — no code needed)

| Env var | Read by | Notes |
| --- | --- | --- |
| `SENTRY_DSN` | `Sentry.init` (server SDKs) | Docs explicitly recommend env var over hardcoding |
| `SENTRY_ENVIRONMENT` | `environment` option | Defaults to `development`/`production` by packaging; case-sensitive, no newlines/spaces/slashes, ≤64 chars |
| `SENTRY_RELEASE` | `release` option | Optional |
| `NEXT_PUBLIC_SENTRY_DSN` | Next.js client bundle | Only if client-side Sentry is wanted; reference it in `instrumentation-client.ts` |
| `SENTRY_AUTH_TOKEN` | `withSentryConfig` source-map upload | Optional; CI only, never committed |

Suggested `.env.example` block for every demo (values are placeholders, never real):

```bash
# Sentry — create a project at sentry.io, DSN under Settings > Client Keys
SENTRY_DSN=
SENTRY_ENVIRONMENT=development
OPENROUTER_API_KEY=
```

`tracesSampleRate: 1.0` for demos (either `tracesSampleRate` or `tracesSampler` must be
defined or tracing is disabled entirely — and with it all gen_ai spans). The Next.js
docs' production suggestion is `process.env.NODE_ENV === "development" ? 1.0 : 0.1`, but
for a demo keep 1.0 everywhere.

---

## 7. Gotchas (collected)

1. **Tracing must be enabled** (`tracesSampleRate` or `tracesSampler`) or NO gen_ai
   spans are created at all — the AI integrations ride on tracing.
2. **Init order**: `Sentry.init` must run before `openai`/`@anthropic-ai/sdk`/`ai` are
   imported (ESM: `--import instrument.mjs` or `NODE_OPTIONS`). Late init = silent loss
   of auto-instrumentation (the SDK logs "<lib> is not instrumented" warnings).
3. **Short-lived processes (GitHub Action)**: `await Sentry.flush()` (or `close()`)
   before exit or spans/events are lost; `shutdownTimeout` defaults to 2000 ms.
4. **vercelAIIntegration records no prompts/outputs by default** — set
   `recordInputs/recordOutputs` on the integration, or per call, or use
   `dataCollection`. The integration option overrides per-call, not vice versa.
5. **Vercel/Next.js bundling breaks `ai` module detection** → spans named `ai.toolCall`
   instead of `gen_ai.execute_tool`. Fix: `vercelAIIntegration({ force: true })` in
   `sentry.server.config.ts`.
6. **Edge runtime**: integration disabled by default, must add to `sentry.edge.config`,
   AND every call needs `experimental_telemetry: { isEnabled: true, recordInputs,
   recordOutputs }` (integration recording options are silently ignored); AI SDK v7
   unsupported on edge. Prefer the Node runtime for AI routes.
7. **openAI/anthropic integrations never create `gen_ai.execute_tool` spans** (the SDKs
   don't run your tools) — wrap your own tool loop with manual `gen_ai.execute_tool` /
   `gen_ai.invoke_agent` spans to get the full agent tree.
8. **OpenAI streaming**: pass `stream_options: { include_usage: true }` or no token
   counts.
9. **Complex attribute values must be JSON.stringify'd** — objects/arrays of objects are
   dropped otherwise (span attributes are primitives only).
10. **Token subsets**: `input_tokens` must INCLUDE cached tokens, `output_tokens` must
    INCLUDE reasoning tokens, or Sentry computes negative costs.
11. **Model names**: pass the raw provider string unchanged; pricing resolves via
    models.dev + OpenRouter. Unknown model string → cost shows $0.
12. **`dataCollection: {}` is permissive** — it also turns on bodies/cookies/user info
    etc. Set categories explicitly if that's not wanted. `sendDefaultPii` is deprecated.
13. **Agent naming**: without `gen_ai.agent.name` (manual) or
    `experimental_telemetry.functionId` (AI SDK) the dashboard can't filter/group/alert
    per agent.
14. **`setConversationId()` + `setUser()` must run per request, before AI calls**, on
    the isolation scope — set them at the top of the request handler / Slack event
    handler. Conversations is beta.
15. **`registerTelemetry` (AI SDK v7) + vercelAIIntegration = duplicate spans** — don't
    combine.
16. **Don't use the old doc URLs** (`/tracing/instrumentation/ai-agents-module`) — they
    404; use `/agent-tracing/` paths (see header).
17. **Self-hosted Sentry only**: may need `streamGenAiSpans: false` if standalone
    gen_ai envelope items aren't ingested. Irrelevant for sentry.io SaaS.
18. **Deprecated attribute names** (`gen_ai.request.messages`,
    `gen_ai.response.text`, `gen_ai.usage.input_tokens.cached`, `gen_ai.tool.input`, …)
    still appear in older blog posts — use the current ones from the tables above.

## Source URLs (all verified live 2026-08-07)

- https://docs.sentry.io/product/agents/ (+ getting-started, dashboards, naming, costs, sampling, privacy, conversations, mcp)
- https://docs.sentry.io/platforms/javascript/guides/node/agent-tracing/
- https://docs.sentry.io/platforms/javascript/guides/node/agent-tracing/manual-instrumentation/
- https://docs.sentry.io/platforms/javascript/guides/nextjs/agent-tracing/
- https://docs.sentry.io/platforms/javascript/guides/node/configuration/integrations/vercelai/ (+ nextjs variant)
- https://docs.sentry.io/platforms/javascript/guides/node/configuration/integrations/openai/
- https://docs.sentry.io/platforms/javascript/guides/node/configuration/integrations/anthropic/
- https://docs.sentry.io/platforms/javascript/guides/node/ (quickstart)
- https://docs.sentry.io/platforms/javascript/guides/node/install/esm/
- https://docs.sentry.io/platforms/javascript/guides/node/install/lightweight/
- https://docs.sentry.io/platforms/javascript/guides/node/configuration/apis/ (flush/close)
- https://docs.sentry.io/platforms/javascript/guides/node/configuration/options/ (dataCollection, tracesSampleRate, shutdownTimeout, env vars)
- https://docs.sentry.io/platforms/javascript/guides/node/tracing/instrumentation/ (startSpan API)
- https://docs.sentry.io/platforms/javascript/guides/node/opentelemetry/ (+ custom-setup, using-opentelemetry-apis)
- https://docs.sentry.io/concepts/otlp/ (+ direct/traces, sentry-with-otel)
- https://docs.sentry.io/product/drains/openrouter/
- https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/
