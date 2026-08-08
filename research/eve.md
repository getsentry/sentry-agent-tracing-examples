# Eve (Vercel's agent framework) — research for the Sentry Slack-bot demo

Researched 2026-08-07 against the official docs (https://eve.dev/docs, all pages also served
as raw markdown at `<page>.md`), the `vercel/eve` GitHub source (main branch), the published
`eve@0.31.1` npm tarball, docs.sentry.io, and the npm registry. Anything not directly
verified is explicitly flagged.

Doc index: https://eve.dev/llms.txt (full page list), https://eve.dev/llms-full.txt,
repo: https://github.com/vercel/eve

---

## 1. What Eve is

Eve is Vercel's agent framework ("like Next.js for web apps, but for agents"). An agent is
described by files under an `agent/` directory: `instructions.md` (always-on system prompt),
`agent.ts` (model + runtime config), and capability directories (`tools/`, `skills/`,
`channels/`, `connections/`, `subagents/`, `schedules/`, `sandbox/`, `hooks/`, `lib/`).
Eve compiles these, runs a durable tool-loop harness on Vercel Workflows (or locally via
`eve dev`), and wires channels (Slack, Discord, HTTP, …) automatically.

- Requires **Node.js >= 24** (`eve` package `engines.node: ">=24"`). Our env has v24.19.0 — OK.
- Eve projects are ESM (`"type": "module"`).
- The runtime model API is the **Vercel AI SDK v7** (`ai` package; eve peer dep `ai@^7.0.38`).

## 2. Packages and versions (verified on npm, 2026-08-07)

| Package | Version | Notes |
|---|---|---|
| `eve` | **0.31.1** | deps: `nitro`, `undici`. Peer: `ai@^7.0.38`, optional `@opentelemetry/api@^1`. `engines.node >= 24` |
| `ai` | **7.0.56** | satisfies eve's `^7.0.38` peer |
| `zod` | **4.4.3** | exactly what eve's scaffold stamps |
| `@openrouter/ai-sdk-provider` | **3.0.0** | peer `ai@^7.0.0`, `zod@^3.25.76 \|\| ^4.1.8` — compatible |
| `@vercel/connect` | 0.6.1 latest (eve 0.31.1 scaffold stamps `0.4.3`) | only needed for Vercel-Connect-managed Slack credentials; **not needed** in env-credential mode |
| `typescript` | **7.0.2** | eve's own workspace catalog pins exactly `7.0.2`; scaffold stamps it |
| `@types/node` | scaffold writes `"24.x"` | matches the pinned Node major |
| `@sentry/node` | **10.69.0** | vercelAIIntegration requires >= 10.6.0; supports `ai` 3.x–7.x |
| `@vercel/otel` | 2.1.3 | only if using `registerOTel` instead of `Sentry.init` |

For the demo (npm): `npm install eve ai zod @openrouter/ai-sdk-provider @sentry/node`
plus dev deps `typescript @types/node`.

## 3. Scaffolding — `eve init` is interactive; scaffold manually

CLI reference (https://eve.dev/docs/reference/cli.md): "`eve init [target]` … **This command
is interactive by default.**" It also "offers to open a coding-agent REPL instead" when one
is detected. So we scaffold by hand. The file set below is copied from the scaffold
implementation (`packages/eve/src/setup/scaffold/create/project.ts` @ main) — it is exactly
what `npx eve@latest init` writes, with version tokens resolved from the published
`eve@0.31.1` package (`ai ^7.0.38`, `zod 4.4.3`, `@vercel/connect 0.4.3`, node `24.x`).

### Layout produced by init (minimal project)

```text
my-agent/
├── package.json
├── tsconfig.json
├── .gitignore
├── .vercelignore
├── AGENTS.md            (points coding agents at node_modules/eve/docs)
├── CLAUDE.md            (contains just "@AGENTS.md")
├── agent/
│   ├── agent.ts
│   ├── instructions.md
│   └── channels/
│       └── eve.ts       (HTTP channel auth policy)
└── evals/               (empty; referenced by the "#evals/*" import map)
```

### package.json (scaffold template, verbatim shape)

```json
{
  "name": "my-agent",
  "version": "0.0.0",
  "type": "module",
  "imports": {
    "#*": "./agent/*",
    "#evals/*": "./evals/*"
  },
  "scripts": {
    "build": "eve build",
    "dev": "eve dev",
    "start": "eve start",
    "typecheck": "tsc"
  },
  "dependencies": {
    "@vercel/connect": "0.4.3",
    "ai": "^7.0.38",
    "eve": "^0.31.1",
    "zod": "4.4.3"
  },
  "devDependencies": {
    "@types/node": "24.x",
    "typescript": "7.0.2"
  },
  "overrides": {
    "ai": "^7.0.38"
  },
  "engines": {
    "node": "24.x"
  }
}
```

Notes:
- The `overrides` block is scaffolded for npm only because `@vercel/connect`'s optional
  `ai` peer (`^6 || ^7`) excludes prereleases. With stable `ai` 7.x it is harmless; if you
  drop `@vercel/connect` (env-credential Slack mode does not import it) you can drop
  `overrides` too.
- The `imports` map (`#*` → `./agent/*`) is part of the scaffold; keep it.
- For the demo, prefer `"ai": "^7.0.56"` (current stable, satisfies eve's peer).

### tsconfig.json (verbatim from scaffold)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "esnext",
    "moduleResolution": "bundler",
    "types": ["node"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["agent/**/*.ts", "evals/**/*.ts"]
}
```

### .gitignore (verbatim from scaffold)

```text
node_modules
.env*
.eve
.vercel
.next
.output
.nitro
dist
.DS_Store
*.tsbuildinfo
```

`.env*` is ignored — note this also ignores `.env.example`; for the demo add an explicit
un-ignore (`!.env.example`) or use `.env` / `.env.local` patterns instead, since the
CONTEXT requires a committed `.env.example`.

### .vercelignore (verbatim from scaffold; comment from source: Vercel CLI ignores
.env.local by default but NOT bare .env — without this a source deploy uploads it)

```text
node_modules
.env*
.eve
.next
.output
.nitro
dist
```

### agent/instructions.md (scaffold default — replace with the demo persona)

```md
# Identity

You are a helpful assistant.
```

This file is "the agent's always-on system prompt" and is **required** at the root.

### agent/agent.ts (scaffold base template)

```ts
import { defineAgent } from "eve";

export default defineAgent({
  model: "anthropic/claude-sonnet-5",
});
```

(For OpenRouter, see §6 — the demo replaces this file.)

### agent/channels/eve.ts (verbatim from scaffold `web-template.ts`)

```ts
import { eveChannel } from "eve/channels/eve";
import { localDev, placeholderAuth, vercelOidc } from "eve/channels/auth";

export default eveChannel({
  auth: [
    // Lets the eve TUI and your Vercel deployments reach the deployed agent.
    vercelOidc(),
    // Open on localhost for `eve dev` and the REPL; ignored in production.
    localDev(),
    // This placeholder will not allow browser requests in production.
    // Replace it with your app's auth provider, like Auth.js or Clerk,
    // or use none() for a public demo.
    placeholderAuth(),
  ],
});
```

The HTTP channel is enabled by default even without this file; the file exists to set the
auth policy. Keep it — production routes 401 with `placeholderAuth()` by design.

## 4. Project structure rules (from /docs/project-structure.md and /docs/reference/project-layout.md)

- "eve builds an agent by walking the filesystem under `agent/`. Each directory is an
  authored slot, and the slot a file lands in determines how eve loads it."
- **Names derive from file paths.** `agent/tools/get_weather.ts` → tool `get_weather`;
  `agent/skills/summarize.md` → skill `summarize`; `agent/channels/slack.ts` → channel
  `slack`. "You do not add a duplicate `name` or `id` field to the definition." The root
  agent's name comes from `package.json` `name`.
- Slots: `agent.ts` (runtime config), `instructions.md` (system prompt, required at root),
  `instrumentation.ts` (root-only, auto-discovered), `channels/` (root-only),
  `connections/` (MCP/OpenAPI), `hooks/`, `skills/` (markdown playbooks), `lib/` (shared
  import-only code), `sandbox/`, `tools/`, `schedules/` (root-only), `subagents/`, and a
  top-level `evals/`.
- Debug discovery with `eve info`; artifacts land in `.eve/` (`diagnostics.json`,
  `agent-discovery-manifest.json`, `compiled-agent-manifest.json`).

## 5. Tools (verbatim from docs/tools/overview.mdx)

Tools are TypeScript modules in `agent/tools/`, default-exporting `defineTool` from
`eve/tools`. They run in the app runtime (full `process.env` access — this is the natural
manual-Sentry instrumentation point), not in the sandbox.

```ts
// agent/tools/get_weather.ts  →  tool name "get_weather"
import { defineTool } from "eve/tools";
import { z } from "zod";

export default defineTool({
  description: "Get the current weather for a city.",
  inputSchema: z.object({ city: z.string().min(1) }),
  async execute({ city }, ctx) {
    return { city, condition: "Sunny", temperatureF: 72 };
  },
});
```

Contract:
- `description` — written for the model. Required.
- `inputSchema` — Zod schema (or Standard Schema or plain JSON Schema). Required; use
  `z.object({})` for no input. Zod infers the `input` type in `execute`.
- `execute(input, ctx)` — sync, async, or async generator (each `yield` streams a
  preliminary snapshot; the final yield is the model-visible result). Return value must be
  JSON-serializable.
- Optional: `outputSchema`, `approval` (from `eve/tools/approval`: `always()`, `once()`,
  `never()`, or a policy — renders as Slack buttons via HITL), `toModelOutput(output)`
  (project rich output down to what the model sees; channels still get the full output).
- `ctx` carries: `ctx.session` (metadata, auth), `ctx.callId`, `ctx.toolName`,
  `ctx.abortSignal`, `ctx.getSandbox()`, `ctx.getSkill(id)`.
- Durability caveat from docs: "Completed steps never re-run; eve replays the recorded
  result. A step interrupted mid-execution re-runs" — make side effects idempotent.

Approval-gated example (verbatim):

```ts
import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { z } from "zod";

export default defineTool({
  description: "Refund a charge.",
  inputSchema: z.object({ chargeId: z.string(), amount: z.number() }),
  approval: always(), // or once() / never() / a policy
  async execute(input) {
    return refund(input);
  },
});
```

## 6. Model / provider configuration — OpenRouter wiring (VERIFIED)

From /docs/agent-config.md and the source type (`packages/eve/src/shared/agent-definition.ts`):

```ts
/** A concrete model handle: an AI Gateway model id string or an AI SDK `LanguageModel` instance. */
export type PublicAgentStaticModelDefinition = string | LanguageModel;
```

and the `model` field doc: "Language model used for agent turns. **Accepts an AI Gateway
model ID, any AI SDK-compatible language model**, or `defineDynamic({ fallback, events })`."
Routing is decided at compile time: a string routes through the **Vercel AI Gateway**
(needs `AI_GATEWAY_API_KEY` or `VERCEL_OIDC_TOKEN`); a provider instance is `external` and
"bypasses the gateway and talks to the provider's own endpoint."

**OpenRouter is therefore directly supported** via the community AI SDK provider
`@openrouter/ai-sdk-provider@3.0.0` (peer `ai@^7`, matching eve's AI SDK v7 runtime).
The provider reads `OPENROUTER_API_KEY` by default (verified in provider source:
`loadApiKey({ environmentVariableName: 'OPENROUTER_API_KEY' })`).

```ts
// agent/agent.ts — the demo's model wiring
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { defineAgent } from "eve";

const openrouter = createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY! });

export default defineAgent({
  model: openrouter.chat("anthropic/claude-sonnet-4.5"),
  // Escape hatch documented on PublicAgentDefinition: set this when eve cannot
  // resolve the model's context window from the AI Gateway model catalog
  // (custom/unlisted model ids). Used for compaction thresholds.
  modelContextWindowTokens: 200_000,
});
```

- `openrouter.chat("<creator>/<model>")` (or `openrouter("<id>")`) returns an AI SDK
  `LanguageModel` — exactly what `defineAgent` accepts.
- With an external model, **no `AI_GATEWAY_API_KEY` is required** anywhere (dev or prod).
- Other `defineAgent` options (all optional): `reasoning` (`"none" | "minimal" | "low" |
  "medium" | "high" | "xhigh" | "provider-default"`), `compaction: { thresholdPercent }`
  (default 0.9), `limits: { maxInputTokensPerSession, maxOutputTokensPerSession,
  sessionTimeoutMs }`, `modelOptions.providerOptions`, `outputSchema`,
  `build.externalDependencies` (string[] of packages kept external in hosted builds).
- Default model when `agent.ts` is absent: `anthropic/claude-sonnet-5` via gateway. When
  `agent.ts` exists, `model` is required.
- Alternative the scaffold offers (NOT needed for OpenRouter, documented for completeness):
  gateway BYOK, which forwards your upstream provider key through the AI Gateway:

  ```ts
  export default defineAgent({
    model: "anthropic/claude-sonnet-5",
    modelOptions: {
      providerOptions: {
        gateway: { byok: { anthropic: [{ apiKey: process.env.ANTHROPIC_API_KEY! }] } },
      },
    },
  });
  ```

  BYOK provider slugs are gateway upstream providers; OpenRouter is not one of them — use
  the external-provider path above for OpenRouter.

## 7. Slack channel (from docs/channels/slack.mdx + eve source, both verified)

The Slack channel answers `@mentions` and DMs, replies in threads, shows typing
indicators, and renders HITL approvals as Slack buttons. Inbound events arrive by webhook
at **`/eve/v1/slack`** on the deployment (`SLACK_CHANNEL_DEFAULT_ROUTE` in source;
overridable via the channel's `route` option). Handled events: `app_mention`,
`message.im`, plus any other Events API callback via `onEvent`. Eve automatically drops
messages authored by the installed app (no self-reply loops).

### Two credential modes

**A. Environment credentials (what the demo should use — no Vercel Connect dependency).**
Verified in source (`SlackChannelCredentials` in `slackChannel.ts`): `botToken` "Falls back
to `process.env.SLACK_BOT_TOKEN` when omitted"; `signingSecret` "Falls back to
`process.env.SLACK_SIGNING_SECRET`". `credentials` itself is optional. `eve add
channel/slack` in environment mode writes exactly this file (verbatim template
`SLACK_ENV_TEMPLATE` from `setup/scaffold/update/channels.ts`):

```ts
// agent/channels/slack.ts
import { slackChannel } from "eve/channels/slack";

export default slackChannel();
```

…and appends to `.env.example`:

```bash
SLACK_BOT_TOKEN=
SLACK_SIGNING_SECRET=
```

The setup flow's own instruction text: "Set SLACK_BOT_TOKEN and SLACK_SIGNING_SECRET in
.env.local (listed in .env.example)."

**B. Vercel Connect (managed).** `npm install @vercel/connect`, then:

```ts
import { connectSlackCredentials } from "@vercel/connect/eve";
import { slackChannel } from "eve/channels/slack";

export default slackChannel({
  credentials: connectSlackCredentials("slack/my-agent"),
});
```

with connector provisioning via:

```bash
npm install -g vercel@latest
vercel connect create slack --triggers
vercel connect detach <uid> --yes
vercel connect attach <uid> --triggers --trigger-path /eve/v1/slack --yes
```

### Slack app requirements (env-credential mode)

The docs do not ship a full manifest; they name these scopes/events piecemeal:
- Mentions: `app_mention` event (delivered to `/eve/v1/slack`).
- DMs: `message.im` event + `im:history` scope; ephemeral/DM delivery of HITL auth
  challenges needs `im:write`.
- Replying/posting requires a bot token (`chat:write` is the standard Slack scope for
  posting; the docs assume a working bot token rather than listing it).
- Un-mentioned channel messages (for `onMessage`/`isSubscribed` thread continuation):
  `message.channels` event + `channels:history` scope; private channels additionally
  `message.groups` + `groups:history`. `threadContext` and `listParticipants()` also
  "require the matching Slack history scope" (they call `conversations.replies`).
- "Add every desired event and required OAuth scope to the Slack app's Event Subscriptions
  configuration; eve can only handle events Slack sends." Event Subscriptions request URL =
  `https://<deployment>/eve/v1/slack`; the signing secret verifies inbound requests.

### Channel options (SlackChannelConfig, from source + docs)

`credentials?`, `botName?`, `route?` (default `/eve/v1/slack`), `uploadPolicy?`,
`threadContext?: { since: "thread-root" | "last-agent-reply" | (msg) => boolean }`,
`onMessage(ctx, message)`, `onAppMention(ctx, message)`, `onDirectMessage(ctx, message)`,
`onInteraction(action, ctx)`, `onEvent(ctx, event)`, `events` (e.g.
`"message.completed"`, `"reasoning.appended"`, `"authorization.required"`),
`initialMessage`. Handler precedence table (verbatim):

| Incoming event | Handler order |
|---|---|
| App mention | `onAppMention` → `onMessage` → `onEvent` → built-in mention default |
| Direct message | `onDirectMessage` → `onMessage` → `onEvent` → built-in DM default |
| Other Slack message | `onMessage` → `onEvent` → ignore |
| Other Events API event | `onEvent` → ignore |

Message hooks return `{ auth }` to dispatch, `null` to drop. Docs example for continuing
threads without repeated mentions (verbatim, minus Connect credentials):

```ts
export default slackChannel({
  async onMessage(ctx, message) {
    if (message.author?.isBot) return null;
    const isDirectMessage = message.raw.channel_type === "im";
    return isDirectMessage || ctx.isBotMentioned() || (await ctx.isSubscribed())
      ? { auth: null }
      : null;
  },
});
```

Thread context injection (recommended for a Slack bot demo):

```ts
export default slackChannel({
  threadContext: { since: "last-agent-reply" },
});
```

Default delivery behavior: replies in-thread; posts `Thinking…` on inbound, `Working…` on
`turn.started`, a truncated reasoning snippet on `reasoning.appended`, and an action label
on `actions.requested` (tool name + most telling argument). HITL approvals render as
buttons; responding resumes the parked durable session.

### Local development for the Slack channel

The Slack docs cover deployment only; there is **no documented local-tunnel flow**. The
practical demo story: the full agent loop (model + tools) runs locally in the `eve dev`
TUI; the Slack surface is exercised on a Vercel deployment (Slack needs a public webhook
URL). `eve dev --url <deployment>` attaches the TUI to a deployed server.

## 8. Local development and deployment (from /docs/reference/cli.md, /docs/installation.md, /docs/guides/deployment/vercel.md)

- `eve` binary auto-loads `.env` / `.env.local` from the app root. Bare `eve` = `eve dev`.
- `npm run dev` → `eve dev`: local development server + interactive terminal UI; the agent
  loop genuinely runs locally (only model credentials needed — for us,
  `OPENROUTER_API_KEY`). Options: `--no-ui`, `--input <text>`, `-u/--url <url>` (attach to
  an existing server), rendering modes.
- `eve invoke [prompt]`: one non-interactive turn, JSON output (`--resume`,
  `--json-schema`). Good for smoke tests without the TUI.
- `eve info`: resolved config — tools, skills, channels, routes; `--json` for machine
  output. Use to verify discovery after scaffolding.
- `eve build`: compiles into `.output/`. `eve start`: serves the built output locally.
- `eve traces` / `eve traces ls`: local span trees from `.eve/traces/v1` (recorded when no
  `instrumentation.ts` exists); `/traces` view in the dev TUI.
- Deploy: `eve deploy` (runs `eve link` first if needed; link pulls AI Gateway credentials
  into `.env.local` — irrelevant with OpenRouter) or plain Vercel CLI:
  `VERCEL_USE_EXPERIMENTAL_FRAMEWORKS=1 vercel deploy --prod` ("lets the Vercel CLI
  recognize eve as a framework during the build"). Deployment provisions web runtime,
  Vercel Workflow, Vercel Cron, Vercel Sandbox.
- Env vars for the deployment go in the Vercel project settings (model provider keys, tool
  keys, `SLACK_*`, `SENTRY_DSN`).

## 9. Observability — Eve's surfaces and how Sentry wires in

### 9.1 What Eve provides natively (from /docs/guides/instrumentation.md, verified against source)

`agent/instrumentation.ts` is auto-discovered, root-only, and runs at server startup
before any agent code. **Its presence implicitly enables telemetry** (no `isEnabled`
toggle). Authored contract (`InstrumentationDefinition`, verbatim from
`packages/eve/src/public/instrumentation/index.ts`):

- `setup?: (context: { agentName }) => void` — "Use it to call `registerOTel` or other
  OTel provider setup". `agentName` resolves from `package.json` name.
- `recordInputs?: boolean` — record full model inputs on step spans (default `true`).
- `recordOutputs?: boolean` — record model outputs (default `true`).
- `functionId?: string` — overrides `ai.telemetry.functionId` (defaults to agent name).
- `traceChannelRequests?: boolean` — wrap inbound channel HTTP requests in an OTel
  `SERVER` span (default `false`); low-cardinality, adopts incoming `traceparent`.
- `events: { "step.started"(input) }` — return `{ runtimeContext: {...} }` to attach
  per-model-call attributes to the AI SDK spans (keys beginning `eve.` are dropped).
  `input` carries `session`, `turn`, `step`, `channel` (use
  `isChannel(input.channel, slackChannelModule)` for typed metadata — the Slack channel
  projects `{ channelId, teamId, threadTs, triggeringUserId }`), and `modelInput`.

How spans are emitted (verified in source, `packages/eve/src/harness/otel-integration.ts`
and `tool-loop.ts`): when an instrumentation config exists, eve calls the AI SDK v7 API
`registerTelemetry(new OpenTelemetry({ runtimeContext: true }))` (from `@ai-sdk/otel`) and
creates its own parent span per turn via `trace.getTracer("eve")`. Everything flows through
the **global OpenTelemetry tracer provider registered by your `setup` callback**. Trace
shape (verbatim from docs):

```text
ai.eve.turn  {eve.session.id}
  +-- ai.streamText                           step 1
  |     +-- ai.streamText.doStream            model call
  |     +-- ai.toolCall  {toolName: search}   tool exec
  +-- ai.streamText                           step 2
```

with framework attributes `eve.version`, `eve.session.id`, `eve.environment`,
`eve.turn.id`, `eve.turn.sequence`, `eve.step.index`, `eve.channel.kind`.

Independently, eve tags every Vercel Workflow run with `$eve.*` attributes (`$eve.type`,
`$eve.root`, `$eve.model`, `$eve.input_tokens`, `$eve.output_tokens`, `$eve.tool_count`, …)
— visible in the Vercel Workflow dashboard only, not on OTel spans. On Vercel, an "Agent
Runs" tab exists under Observability (team-gated). Without `instrumentation.ts`, `eve dev`
records local traces to `.eve/traces/v1` (viewable via `eve traces` / TUI `/traces`);
writing `instrumentation.ts` replaces local recording.

### 9.2 No official Sentry+Eve integration exists

Searched eve docs and docs.sentry.io (2026-08-07): eve's docs name Braintrust, PostHog,
Raindrop, Arize, Honeycomb, Datadog, Jaeger as OTel backends; Sentry has no Eve-specific
guide. The wiring below is composed from both sides' verified primitives.

### 9.3 Recommended wiring: `Sentry.init` inside eve's `setup` callback

`@sentry/node` (v10.69.0) installs a global OTel `NodeTracerProvider` when `Sentry.init`
runs — exactly the role eve's `setup` callback plays for `registerOTel`. Eve's AI SDK
spans (`ai.eve.turn`, `ai.streamText`, `ai.toolCall`) then flow through Sentry. Sentry's
`vercelAIIntegration` (docs:
https://docs.sentry.io/platforms/javascript/guides/node/configuration/integrations/vercelai/)
converts AI SDK telemetry spans into `gen_ai.*` spans for Sentry's AI-Agents dashboards.
Verified in the released v10.69.0 source: the integration is (a) a module patch that
auto-enables per-call telemetry, plus (b) `addVercelAiProcessors(client)` which transforms
AI SDK spans arriving through Sentry's OTel pipeline. **`force: true` makes (b)
unconditional** — required here because eve bundles the `ai` package (nitro build), which
"defeats automatic detection" (per Sentry docs) and makes the module patch a no-op.

```ts
// agent/instrumentation.ts
import * as Sentry from "@sentry/node";
import { defineInstrumentation } from "eve/instrumentation";

export default defineInstrumentation({
  setup: ({ agentName }) => {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.VERCEL_ENV ?? "development",
      tracesSampleRate: 1.0,
      integrations: [
        Sentry.vercelAIIntegration({
          force: true,
          recordInputs: true,
          recordOutputs: true,
        }),
      ],
    });
  },
  // eve-side capture settings for the AI SDK spans (default true; explicit for clarity)
  recordInputs: true,
  recordOutputs: true,
  traceChannelRequests: true,
});
```

Sentry option semantics (verbatim-adjacent from Sentry docs): integration-level
`recordInputs`/`recordOutputs` apply globally and take precedence over per-call
`experimental_telemetry` settings; both default to `true` only when `sendDefaultPii: true`.
`enableTruncation` defaults to `true`.

Enriching spans with Slack context via eve's runtime-context hook (pattern verbatim from
eve docs, adapted to the Slack channel):

```ts
import { defineInstrumentation, isChannel } from "eve/instrumentation";
import slack from "./channels/slack";

// inside defineInstrumentation({ ... })
events: {
  "step.started"(input) {
    if (!isChannel(input.channel, slack)) return undefined;
    return {
      runtimeContext: {
        "slack.channel_id": input.channel.metadata.channelId ?? "",
        "slack.thread_ts": input.channel.metadata.threadTs ?? "",
        "slack.user_id": input.channel.metadata.triggeringUserId ?? "",
      },
    };
  },
},
```

**Duplicate-span caveat (must be verified at build time):** Sentry's vercelai docs warn
"Do not combine this integration with the AI SDK's `registerTelemetry` API … resulting in
duplicate spans if both are active", and eve itself calls `registerTelemetry` (that is the
only reason spans exist at all here). In the released v10 implementation the module patch
cannot bind to eve's bundled `ai`, so eve's registration should be the only span source and
`addVercelAiProcessors` merely transforms — no duplication. Verify empirically: run
`eve dev`, send one message, and check the Sentry trace for doubled `ai.streamText` spans.
If duplicates appear, drop `force: true` and/or disable the integration's instrumentation
half by relying on manual spans (§9.4). (Sentry's develop branch is moving to a
`node:diagnostics_channel` subscriber, which would genuinely double up with eve's
registration — pin `@sentry/node@^10` and re-verify before upgrading to 11.)

ESM/startup caveat: eve executes `instrumentation.ts` "at server startup before any agent
code", which is early enough for tracer-provider registration and the span processors, but
too late for Sentry's require/import hooks to patch already-loaded modules (also mostly
moot under nitro bundling). Auto-instrumentation of `http` etc. may be partial; agent
tracing — the demo's point — does not depend on it. If the hosted build has trouble
bundling Sentry, add `build: { externalDependencies: ["@sentry/node"] }` to `defineAgent`
("Prefer this when a package is sensitive to bundling", per the type docs).

### 9.4 Manual `gen_ai` spans and error capture in tools (guaranteed-to-work layer)

Tools are plain TypeScript running in the app runtime, so standard Sentry APIs work
inside `execute`. Sentry's manual agent-tracing spec
(https://docs.sentry.io/platforms/javascript/guides/node/agent-tracing/manual-instrumentation/):
span ops `gen_ai.invoke_agent` (container), `gen_ai.chat` (LLM request),
`gen_ai.execute_tool` (tool run); attributes like `gen_ai.agent.name`,
`gen_ai.request.model`, `gen_ai.usage.input_tokens` / `gen_ai.usage.output_tokens`
(cached/reasoning tokens are *subsets* of totals, not separate counts); complex attribute
values must be `JSON.stringify`-ed; set attributes before the call; "Marking failed tools
with an error status populates the Tool Errors widget"; use `Sentry.startInactiveSpan` for
streaming. Example shape for a tool:

```ts
import * as Sentry from "@sentry/node";
import { defineTool } from "eve/tools";
import { z } from "zod";

export default defineTool({
  description: "Look up an order by id.",
  inputSchema: z.object({ orderId: z.string() }),
  execute: ({ orderId }) =>
    Sentry.startSpan(
      {
        op: "gen_ai.execute_tool",
        name: "execute_tool lookup_order",
        attributes: {
          "gen_ai.tool.name": "lookup_order",
          "gen_ai.tool.input": JSON.stringify({ orderId }),
        },
      },
      async (span) => {
        try {
          const order = await fetchOrder(orderId);
          span.setAttribute("gen_ai.tool.output", JSON.stringify(order));
          return order;
        } catch (err) {
          span.setStatus({ code: 2, message: "internal_error" });
          Sentry.captureException(err);
          throw err;
        }
      },
    ),
});
```

Note: if §9.3 works as expected, eve's own `ai.toolCall` spans already cover tool
execution — manual `gen_ai.execute_tool` spans are then redundant; keep manual
instrumentation to `Sentry.captureException` + domain attributes, or use it as the
fallback if the automatic path double-counts.

### 9.5 Alternatives (documented, heavier)

- **OTel Collector + Sentry Exporter**: `registerOTel` (from `@vercel/otel`) with an OTLP
  exporter pointed at an `otelcol-contrib` (>= 0.145.0) collector running the `sentry`
  exporter (`SENTRY_ORG_SLUG` + `SENTRY_AUTH_TOKEN`). Works, but requires running a
  collector — poor fit for a minimal demo.
- **Direct OTLP ingest to Sentry**: open beta (https://docs.sentry.io/concepts/otlp/);
  traces/logs only, no metrics; endpoint/auth details live behind the beta docs.
- `@sentry/node-core/light` + `otlpIntegration` for pure-OTel apps.

## 10. Environment variables (all via `.env.example`, never literals)

```bash
# .env.example
OPENROUTER_API_KEY=        # OpenRouter key; read by @openrouter/ai-sdk-provider
SENTRY_DSN=                # Sentry project DSN; read in agent/instrumentation.ts
SLACK_BOT_TOKEN=           # Slack bot token (xoxb-...); slackChannel() env fallback
SLACK_SIGNING_SECRET=      # Slack app signing secret; verifies /eve/v1/slack webhooks
```

Not needed with the OpenRouter external model: `AI_GATEWAY_API_KEY`, `VERCEL_OIDC_TOKEN`.
`eve dev` auto-loads `.env` and `.env.local`.

## 11. Gotchas

1. `npx eve@latest init` is interactive (and may hand off to a coding-agent REPL) — never
   run it in automation; scaffold the §3 files manually.
2. The scaffold's `.gitignore` pattern `.env*` would also ignore `.env.example` — add
   `!.env.example` (or restrict the pattern) so the example file can be committed.
3. Node 24 is a hard floor (`engines`), and eve projects must be `"type": "module"` with
   the `#*` imports map; eve's TS catalog is TypeScript 7.0.2 (`tsc --noEmit` via
   `npm run typecheck`).
4. Tool identity comes from the filename (`agent/tools/lookup_order.ts` → `lookup_order`);
   adding a `name` field is wrong per docs.
5. `model` is required whenever `agent.ts` exists; a bare string routes through the AI
   Gateway (needs gateway credentials) — for OpenRouter always pass the provider instance.
6. With a non-gateway model, eve cannot look up the context window in the gateway catalog;
   set `modelContextWindowTokens` explicitly so compaction math is sane.
7. Writing `agent/instrumentation.ts` (a) enables AI SDK telemetry, (b) disables the local
   `.eve/traces` recorder — use `eve traces` only before adding the Sentry file.
8. Sentry: use `vercelAIIntegration({ force: true })` because eve's nitro build bundles
   `ai`, breaking module detection; verify one trace for duplicated `ai.streamText` spans
   (eve calls the AI SDK's `registerTelemetry`, which Sentry's docs warn about combining);
   stay on `@sentry/node@^10`.
9. Slack setup: Event Subscriptions must point at `https://<deployment>/eve/v1/slack`, and
   "eve can only handle events Slack sends" — subscribe `app_mention` (+ `message.im` with
   `im:history` for DMs). No documented local-tunnel story; demo Slack against a Vercel
   deployment, and demo the agent loop locally via the `eve dev` TUI / `eve invoke`.
10. Deploying with plain Vercel CLI requires `VERCEL_USE_EXPERIMENTAL_FRAMEWORKS=1`;
    `eve deploy` sets it for you.
11. Interrupted tool steps re-run on resume — keep tool side effects idempotent.
12. `@vercel/connect` is only needed for Connect-managed Slack credentials; in env mode
    (`slackChannel()` + `SLACK_BOT_TOKEN`/`SLACK_SIGNING_SECRET`) it can be omitted, along
    with the npm `overrides` block.

## Sources

- https://vercel.com/eve — product overview
- https://eve.dev/docs/getting-started.md, /docs/installation.md, /docs/project-structure.md,
  /docs/tutorial/first-agent.md, /docs/agent-config.md, /docs/tools.md,
  /docs/channels/overview.md, /docs/channels/slack.md, /docs/guides/instrumentation.md,
  /docs/reference/cli.md, /docs/reference/project-layout.md, /docs/reference/typescript-api.md,
  /docs/guides/deployment/vercel.md, /docs/install-integrations.md
- https://github.com/vercel/eve — verified source: `packages/eve/src/setup/scaffold/create/project.ts`
  (scaffold templates), `setup/scaffold/create/web-template.ts` (eve.ts channel),
  `setup/scaffold/update/channels.ts` (Slack env template + `.env.example` keys),
  `setup/integrations/slack/setup.ts`, `public/channels/slack/slackChannel.ts`
  (`SlackChannelCredentials`, `SlackChannelConfig`), `shared/agent-definition.ts`
  (`model: string | LanguageModel`), `public/instrumentation/index.ts`
  (`InstrumentationDefinition`), `harness/otel-integration.ts` (+ `tool-loop.ts`)
  (`registerTelemetry` gating), `docs/channels/slack.mdx`, `docs/tools/overview.mdx`,
  `docs/guides/instrumentation.md`, `pnpm-workspace.yaml` (TS 7.0.2 catalog)
- npm registry (versions + peers): eve, ai, zod, @openrouter/ai-sdk-provider,
  @vercel/connect, @sentry/node, @vercel/otel, typescript; `eve@0.31.1` tarball
  (stamped scaffold versions)
- https://docs.sentry.io/platforms/javascript/guides/node/configuration/integrations/vercelai/
- https://docs.sentry.io/platforms/javascript/guides/node/agent-tracing/manual-instrumentation/
- https://docs.sentry.io/concepts/otlp/
- https://github.com/getsentry/sentry-javascript @ 10.69.0 —
  `packages/node/src/integrations/tracing/vercelai/*` (force + `addVercelAiProcessors`
  mechanics); develop branch `packages/server-utils/src/vercel-ai/*` (diagnostics_channel
  future)
- https://ai-sdk.dev/providers/community-providers/openrouter and
  https://github.com/OpenRouterTeam/ai-sdk-provider (default `OPENROUTER_API_KEY`)
