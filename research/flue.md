# Flue — research for the GitHub Action agent harness demo

Researched 2026-08-07 from https://flueframework.com/ and the published npm packages.
Doc pages are mirrored as raw markdown at `<page-url>/index.md` (e.g.
`https://flueframework.com/docs/guide/models/index.md`). The full docs are ALSO shipped inside the
`@flue/cli` npm package under `package/docs/` — `npx flue docs` searches them offline.

Flue is "the open agent framework, from the creators of Astro" (repo: `github.com/withastro/flue`).
TypeScript agents with a React-like hooks API, built on **Pi** (`pi.dev`), the open agent harness.
Version researched: **Flue 2.0.3** ("Flue 2.0 — Introducing Agent Hooks").

---

## 1. Packages + versions (verified on npm 2026-08-07)

| Package | Version | Role |
| --- | --- | --- |
| `@flue/runtime` | 2.0.3 | The framework runtime (hooks, dispatch, observe, instrument, sqlite adapter) |
| `@flue/cli` | 2.0.3 | `flue run` / `flue init` / `flue add` / `flue docs` (devDependency; bundles vite + @flue/vite as its own deps) |
| `@flue/opentelemetry` | 2.0.3 | OTel GenAI span/metric adapter — required by the Sentry integration when tracing is on |
| `@opentelemetry/api` | 1.9.1 | Peer dep of `@flue/opentelemetry` (`^1.9.0`) |
| `@sentry/node` | 10.69.0 | Sentry SDK (blueprint requires `^10.64.0` for `traceLifecycle: 'stream'` / `streamGenAiSpans`) |
| `valibot` | 1.4.2 | Schema lib Flue uses for tool input / typed results / initialData |
| `hono` | 4.13.1 | Only needed for a deployed HTTP server (`app.ts`) — NOT needed for a CLI/CI-only harness |
| `@flue/vite` + `vite` | 2.0.3 / 8.2.1 | Only needed for `vite dev` / `vite build` deploys — NOT needed for `flue run` (CLI carries its own) |
| `@earendil-works/pi-ai` | 0.84.1 | Pi provider factories — only needed if you register a custom provider via `setProvider()` |

Peer deps of `@flue/opentelemetry`: `@opentelemetry/api@^1.9.0`, `@flue/runtime@^2.0.3`.

**Prerequisite: Node.js `>=22.19.0`** (docs), scaffold uses `@types/node@^22.10.10`, `typescript@^7.0.2`.

### Minimal install for the CI harness demo (Node target, no HTTP server)

```bash
npm install @flue/runtime valibot
npm install -D @flue/cli @types/node typescript
# Sentry integration:
npm install @flue/opentelemetry @opentelemetry/api @sentry/node
```

(The official GitHub Actions guide's own install line is `npm install @flue/runtime valibot` +
`npm install -D @flue/cli`.)

---

## 2. Scaffold: project layout, config files, tsconfig

`flue init [dir] [--target <node|cloudflare>] [--deploy] [--force]` scaffolds a skeleton, writes
files only (no install). `--target node` answers the first prompt; **the deploy question may still
prompt interactively when its flag is omitted** ("Both are resolved from flags when passed, and
prompted for interactively otherwise") — for guaranteed non-interactive scaffolding either pass
both flags or scaffold manually (recommended here; the files are tiny).

### Layout (single-agent, CLI-run project — the CI shape)

```
my-flue-project/
├─ src/
│  └─ agents/
│     └─ triage.ts          # the agent module ('use agent' optional for CLI-only)
├─ .agents/
│  └─ skills/
│     └─ triage/SKILL.md    # sandbox-discovered skills (local() sandbox)
├─ AGENTS.md                 # sandbox-discovered global context (project root)
├─ package.json              # "type": "module"
├─ tsconfig.json
├─ flue.config.ts            # optional
├─ .env                      # loaded automatically by `flue run` (never commit)
└─ .env.example
```

Source-directory resolution order: `.flue/` → `src/` (recommended) → project root. First match
wins; no merging. `src/app.ts` is only "required" for the HTTP-server/deploy story — a CLI-only
project needs no `app.ts` at all ("This agent is never mounted over HTTP — it exists to be run
from the CLI, which is perfect for CI").

### `flue.config.ts` (optional; verbatim from docs)

```ts
import { defineConfig } from '@flue/runtime/config';

export default defineConfig({
	target: 'node', // or 'cloudflare'
});
```

`flue run` discovers `flue.config.*` from the cwd and honors only these fields: `target`, `app`,
`db`, `cloudflare`, `agents`.

### `tsconfig.json` — EXACT content `flue init` generates (extracted from @flue/cli@2.0.3 dist)

```json
{
	"compilerOptions": {
		"target": "ES2022",
		"module": "ESNext",
		"moduleResolution": "Bundler",
		"lib": ["ESNext"],
		"types": ["node"],
		"allowImportingTsExtensions": true,
		"verbatimModuleSyntax": true,
		"strict": true,
		"skipLibCheck": true,
		"noEmit": true
	},
	"include": ["src"]
}
```

Notes: `allowImportingTsExtensions` because Flue code imports with explicit `.ts` extensions
(`import { Assistant } from './agents/assistant.ts'`); `noEmit` because Vite/the CLI do the
building; scaffold's typecheck script is `"check:types": "tsc --noEmit"`.

### `.gitignore` the scaffold generates (node target)

```
node_modules/
dist/
.env
data/
```

### `package.json` shape the scaffold generates (node target, no deploy)

```json
{
	"name": "my-flue-project",
	"private": true,
	"type": "module",
	"scripts": {
		"check:types": "tsc --noEmit"
	},
	"dependencies": { "@flue/runtime": "^2.0.3" },
	"devDependencies": {
		"@flue/cli": "^2.0.3",
		"@types/node": "^22.10.10",
		"typescript": "^7.0.2"
	}
}
```

---

## 3. Agent definition + full hook API

An agent is a plain TypeScript function. Its return value is the system prompt. Hooks compose
capabilities. The function **re-renders before every model call** and re-runs its hooks; unlike
React, resource hooks may be added/removed conditionally (the runtime narrates set changes to the
model).

The `'use agent'` directive marks exported capitalized functions as registered agents **for the
Vite build**; `flue run` takes the module path directly and the directive is optional there
(verbatim: "The `'use agent'` directive matters only for building a deployable app with Vite;
`flue run` takes the module path directly.").

### First-agent example (verbatim, getting started)

```ts
// The `'use agent'` directive marks the Assistant() function below as a Flue agent.
'use agent';
import { useModel } from '@flue/runtime';

// This is your first agent: `Assistant`.
// It's return value is your agent's instructions, which become the agent's "system" instructions.
// Flue Hooks like `useModel()` allow you to customize and modify your agent abilities.
export function Assistant() {
	useModel('anthropic/claude-haiku-4-5');
	return 'You are a helpful assistant. Keep replies short.';
}
```

### Hook roster (all exported from `@flue/runtime`; verbatim signatures from the Agent Hooks API reference)

```ts
function useModel(model: string, options?: UseModelOptions): void;
interface UseModelOptions {
  thinkingLevel?: ThinkingLevel;
  compaction?: false | CompactionConfig;
}
type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
// NOTE: the Models *guide* also lists 'max'; the reference type stops at 'xhigh'. Stick to ≤'xhigh'.
interface CompactionConfig {
  reserveTokens?: number;    // default: model-aware, capped at 20000
  keepRecentTokens?: number; // default 8000
  model?: string;            // cheaper summarization model specifier
}

function useSandbox(sandbox: SandboxFactory, options?: { cwd?: string }): void;

function useTool(tool: ToolDefinition): void;

function useMcpConnection(definition: McpConnectionDefinition): void;

function useSkill(skill: Skill): void; // SkillReference (a SKILL.md import) or inline SkillDefinition

function useSubagent(subagent: SubagentDefinition): void;

function useInstruction(text: string): void;

function usePersistentState<T>(name: string, defaultValue: T): [T, StateSetter<T>];
function usePersistentState<T = unknown>(name: string): [T | undefined, StateSetter<T | undefined>];
type StateSetter<T> = (value: T | ((previous: T) => T)) => void;

function useInitialData<T = unknown>(): T;

function useDelivery(): DeliveredMessage;

function useDispatchMessage(): (message: DeliveredMessageInput) => Promise<DispatchReceipt>;

function useDataWriter<TSchema extends v.GenericSchema>(
  name: string,
  options: { schema: TSchema },
): (data: v.InferOutput<TSchema>) => void;
function useDataWriter(name: string): (data: unknown) => void;

function useAgentStart(run: (ctx: AgentStartContext) => void | Promise<void>): void;
interface AgentStartContext {
  readonly append: (message: AgentAppendMessage) => void;
  readonly harness: FlueHarness;
  readonly log: FlueLogger;
  readonly signal: AbortSignal;
}

function useAgentFinish(run: (ctx: AgentFinishContext) => void | Promise<void>): void;
interface AgentFinishContext {
  readonly response: {
    readonly toolCalls: readonly AgentResponseToolCall[];
    readonly usage: PromptUsage;
  };
  readonly append: (message: AgentAppendMessage) => void;
  readonly harness: FlueHarness;
  readonly log: FlueLogger;
  readonly signal: AbortSignal;
}

function useResponseStart(run: (ctx: ResponseStartContext) => Record<string, unknown> | void): void;
function useResponseFinish(run: (ctx: ResponseFinishContext) => Record<string, unknown> | void): void;
// Both are synchronous observers; returned objects deep-merge onto response metadata.
```

Rules of hooks (condensed from the reference):
- Hooks are only callable during a render (agent body or a custom `use*` function it calls).
- `useModel` is **required, exactly once per render**; the argument may change between renders
  (submission-scoped — a change latches for the NEXT submission), the call may not disappear.
- `useTool` / `useSkill` / `useSubagent` are conditional and reorderable; `useDataWriter` names
  must be identical every render; duplicate names throw everywhere.
- Renders are pure reads — state setters / writers / dispatchers throw during render; call them
  from tool `run` functions and event-hook callbacks.
- Subagent renders throw on `useModel`, `useSandbox`, `usePersistentState`, `useMcpConnection`,
  `useDataWriter`, `useDispatchMessage`, and all four event hooks.
- Event-hook callbacks run at-least-once — guard non-idempotent side effects with persistent state.

### `usePersistentState` example (verbatim, agent-hooks guide)

```ts
'use agent';
import { useModel, usePersistentState, useTool } from '@flue/runtime';

export function CaseAssistant() {
  useModel('anthropic/claude-haiku-4-5');
  const [phase, setPhase] = usePersistentState('phase', 'gathering');
  const [factsChecked, setFactsChecked] = usePersistentState('factsChecked', 0);

  useTool({
    name: 'check_fact',
    description: 'Verify one case fact.',
    async run() {
      setFactsChecked((previous) => previous + 1);
    },
  });
  useTool({
    name: 'begin_draft',
    description: 'Call once the case facts are verified.',
    async run() {
      setPhase('drafting');
    },
  });

  return `Current phase: ${phase}. Facts checked: ${factsChecked}.`;
}
```

Values are JSON-serializable, keyed by name, durable for the life of the conversation. Use the
updater form `(previous) => next` for derived writes.

### Conditional tools + escalation (verbatim, agent-hooks guide)

```ts
'use agent';
import { useModel, usePersistentState, useTool } from '@flue/runtime';
import refundTool from '../tools/refund.ts';

export function SupportAgent() {
  useModel('anthropic/claude-haiku-4-5');
  const [escalated, setEscalated] = usePersistentState('escalated', false);
  useTool({
    name: 'escalate',
    description: 'Escalate this conversation when the customer needs a refund.',
    async run() {
      setEscalated(true);
      return 'Escalated. The refund tool is now available.';
    },
  });
  if (escalated) {
    useTool(refundTool);
  }
  return 'Answer customer support questions clearly and accurately.';
}
```

### Tools: `defineTool` contract (verbatim signature, Agent API reference)

```ts
function defineTool<...>(options: {
  name: string;
  description: string;
  input?: ToolInputSchema;   // Valibot schema; top-level object
  output?: ToolOutputSchema; // Valibot schema
  harness?: boolean;
  durable?: boolean;
  run(context: ToolContext<...>): ToolRunEnvelope<Output> | string | void | Promise<ToolRunEnvelope<Output> | string | void>;
}): ToolDefinition;

type ToolContext<Input, Harness, Durable> = {
  readonly toolCallId: string;
  readonly signal?: AbortSignal;
  readonly log: FlueLogger;
} & {
  readonly data: v.InferOutput<Input>; // when `input` is declared
} & {
  readonly harness: FlueHarness; // when `harness: true`
} & {
  readonly step: ToolStep; // when `durable: true`
};

interface FlueLogger {
  info(message: string, attributes?: Record<string, unknown>): void;
  warn(message: string, attributes?: Record<string, unknown>): void;
  error(message: string, attributes?: Record<string, unknown>): void;
}
```

`useTool()` accepts a `defineTool(...)` value or the same object inline. `run` may return a bare
string (shorthand for `{ output: string }`), `{ output, terminate? }`, or void (only without an
`output` schema). Throwing inside `run` records a tool error the model sees — it does NOT fail the
submission. `ctx.log.*` lines become `log` runtime events (→ Sentry Logs); the model never sees them.

Harness tools (`harness: true`) get `harness.sandbox.exec(cmd)` → `{ stdout, stderr, exitCode }`
and `harness.prompt(text, opts)`; `prompt()` accepts a `result` Valibot schema and returns the
parsed value on `response.data`, fully typed:

```ts
import * as v from 'valibot';

// summary: string
const { data: summary } = await harness.prompt(`Summarize this diff:\n${diff}`, {
  result: v.string(),
});
```

### Skills and AGENTS.md (CI-relevant, verbatim from the GitHub Actions guide)

Skills are markdown files in `.agents/skills/`, auto-discovered from the project root by the
`local()` sandbox. `.agents/skills/triage/SKILL.md`:

```markdown
---
name: triage
description: Triage a GitHub issue — reproduce, assess severity, and optionally fix.
---

Given the issue number in the arguments:

1. Use `gh issue view` to fetch the issue details
2. Read the codebase to understand the relevant area
3. Attempt to reproduce the issue
4. Assess severity and write a summary
5. If the fix is straightforward, apply it and open a PR
```

`AGENTS.md` at the project root is discovered as global agent context. Skills can also be imported
explicitly (`import reviewChecklist from '../skills/review-checklist/SKILL.md'`) and mounted with
`useSkill(reviewChecklist)` — that path needs the Vite build's SKILL.md packaging; in CLI/CI
projects prefer the `.agents/skills/` sandbox discovery.

### Sandbox for CI (verbatim notes)

```ts
import { useModel, useSandbox } from '@flue/runtime';
import { local } from '@flue/runtime/node';

export function Triage() {
  useModel('anthropic/claude-opus-4-7');
  useSandbox(
    local({
      env: {
        GH_TOKEN: process.env.GH_TOKEN,
        NPM_TOKEN: process.env.NPM_TOKEN,
      },
    }),
  );
  return 'When given an issue number, run the `triage` skill on it and report severity, reproducibility, and a summary.';
}
```

`local()` runs against the host filesystem/shell — in CI that's the checked-out repo plus whatever
is on `$PATH` (`gh`, `git`, `npm`). **Only shell-essential env vars (PATH, HOME, locale…) are
inherited by default** — forward secrets explicitly via `local({ env: { ... } })`. Without
`useSandbox` the agent has no file/shell tools at all.

---

## 4. Model configuration + OpenRouter

`useModel('<provider-id>/<model-id>')` — everything before the FIRST `/` is the provider; the rest
is the provider's own model ID, which may itself contain slashes. Verbatim examples from the docs:

- `anthropic/claude-sonnet-4-6` — provider `anthropic`, model `claude-sonnet-4-6`
- `openai/gpt-5.5` — provider `openai`, model `gpt-5.5`
- `openrouter/moonshotai/kimi-k2.6` — provider `openrouter`, model `moonshotai/kimi-k2.6`

`useModel()` is a declaration, not a client — no SDK object, no API key in agent code. The runtime
resolves specifiers against Pi's built-in provider set (`anthropic`, `openai`, `google`,
`amazon-bedrock`, `google-vertex`, `groq`, `mistral`, `xai`, `deepseek`, `cerebras`, `together`,
`fireworks`, `openrouter`, and more). **An unknown specifier fails fast** — the run errors with the
unresolved provider and model ID before any request is sent.

### OpenRouter is a first-class built-in provider — this is the path for our demo

- Provider id: `openrouter`; API key env var: **`OPENROUTER_API_KEY`** (verified in Pi's provider
  table AND in `@earendil-works/pi-ai` source: `envApiKeyAuth("OpenRouter API key", ["OPENROUTER_API_KEY"])`).
- Base URL `https://openrouter.ai/api/v1`, OpenAI-completions wire API — all handled internally.
- **No `setProvider()` / custom-provider code needed.** Just set the env var and use
  `useModel('openrouter/<openrouter-model-id>')`.
- Model IDs must exist in Pi's OpenRouter catalog (335 models in pi-ai 0.84.1). Verified-present
  IDs useful for the demo (with `reasoning` flag from the catalog):
  - `openrouter/moonshotai/kimi-k2.6` (reasoning: true, ctx 262144) — the homepage's poster model family
  - `openrouter/moonshotai/kimi-k2` (reasoning: false, ctx 131072)
  - `openrouter/anthropic/claude-sonnet-4.6` (reasoning: true, ctx 1000000)
  - `openrouter/anthropic/claude-haiku-4.5` (reasoning: true, ctx 200000)
  - `openrouter/openai/gpt-5.5` (reasoning: true), `openrouter/openai/gpt-5-mini` (reasoning: true)
  - `openrouter/z-ai/glm-4.7` (reasoning: true), `openrouter/qwen/qwen3-coder` (reasoning: false)
- CAREFUL: OpenRouter catalog IDs use **dots** in Anthropic model names (`claude-haiku-4.5`) while
  the native `anthropic` provider uses **hyphens** (`claude-haiku-4-5`). Copy IDs exactly.

Example agent line for the demo:

```ts
useModel('openrouter/moonshotai/kimi-k2.6', { thinkingLevel: 'low' });
```

### Credentials (verbatim mechanics)

`.env` at the project root; `flue run` loads it automatically (shell-exported values win); pass
`--env <path>` for an alternate file. Deployed Node servers read only the real environment. Agent
code never touches keys.

`.env.example` for the demo:

```bash
# OpenRouter API key — all model calls route through OpenRouter.
OPENROUTER_API_KEY=""
# Sentry
SENTRY_DSN=""
SENTRY_TRACES_SAMPLE_RATE="1"
# Optional: record model/tool content in traces (off by default)
SENTRY_AI_RECORD_INPUTS="false"
SENTRY_AI_RECORD_OUTPUTS="false"
```

### Custom providers (fallback only — NOT needed for OpenRouter)

If a model is missing from the catalog, register a provider with Pi's `createProvider()` +
Flue's `setProvider()` (requires `npm install @earendil-works/pi-ai`). Verbatim Ollama example in
the Models guide; key placement caveat (verbatim): "flue run loads only the agent module, never
`app.ts` — when an agent must also work under `flue run`, put the registration in the agent module
instead."

### Changing models mid-conversation

Model/thinkingLevel/compaction are **submission-scoped** — read once when the agent wakes for an
accepted input; a value computed mid-run latches for the next submission. Escalation pattern
(persistent state flips the specifier) is verbatim in the Models guide.

---

## 5. Subagents (verbatim API)

```ts
'use agent';
import { useModel, useSubagent } from '@flue/runtime';

function Summarizer() {
  return 'You summarize support cases in three sentences.';
}

export function CaseAgent() {
  useModel('anthropic/claude-sonnet-4-6');
  useSubagent({
    name: 'summarizer',
    description: 'Summarizes one support case.',
    agent: Summarizer,
  });
  return 'Investigate the case. Delegate the summary to the `summarizer` subagent.';
}
```

- Three required fields: `name`, `description`, `agent` (a plain agent function). Keep delegate
  functions **unexported** inside `'use agent'` modules (every exported capitalized function
  becomes a registered top-level agent in the Vite build).
- Delegation is model-driven via a framework-owned `task` tool; declared delegates appear in an
  "Available Agents" section of the system prompt. Only the child's final message returns to the
  parent. Tool calls in one batch run in parallel → parallel child sessions.
- Definition overrides: `model` (a model specifier) and `thinkingLevel`; both inherit from the
  parent when omitted. A delegate render must NOT call `useModel`.
- The delegate inherits the parent's environment (sandbox, `AGENTS.md`, workspace skills) but
  nothing of the conversation. Shared files in the sandbox are the natural hand-off surface.
- `GeneralSubagent` (exported from `@flue/runtime`) mounts a blank general-purpose delegate under
  the reserved name `flue-general`: `useSubagent(GeneralSubagent)`.
- `defineSubagent({ name, description, agent })` validates at module load and returns a frozen,
  shareable definition; per-mount overrides spread:
  `useSubagent({ ...issueClassifier, model: 'anthropic/claude-haiku-4-5' })`.
- Delegation depth caps at four levels. Duplicate delegate names in one render throw.
- Subagent example with own model, verbatim from the demo-relevant deploy guide:

```ts
'use agent';
import { useModel, useSubagent } from '@flue/runtime';

function Reviewer() {
  return 'Focus on correctness, security, and project standards.';
}

export function Triage() {
  useSubagent({
    name: 'reviewer',
    description: 'Reviews a pull request for correctness, security, and project standards.',
    agent: Reviewer,
  });
  return 'Delegate PR reviews to the `reviewer` subagent via a task.';
}
```

Harness-driven orchestration alternative (deterministic, typed) — verbatim from the GitHub
Actions guide:

```ts
'use agent';
import { useModel, useSandbox, useTool } from '@flue/runtime';
import { local } from '@flue/runtime/node';
import * as v from 'valibot';

export function AutoTriage() {
  useModel('anthropic/claude-sonnet-4-6');
  useSandbox(local());
  useTool({
    name: 'triage-issue',
    description: 'Triage one GitHub issue and auto-fix critical reproducible ones.',
    input: v.object({ issueNumber: v.number() }),
    harness: true,
    async run({ harness, data }) {
      const { data: triage } = await harness.prompt(
        `Apply the triage skill to issue #${data.issueNumber}.`,
        {
          result: v.object({
            severity: v.picklist(['low', 'medium', 'high', 'critical']),
            reproducible: v.boolean(),
            summary: v.string(),
          }),
        },
      );

      if (triage.severity === 'critical' && triage.reproducible) {
        await harness.prompt(`Apply the auto-fix skill to issue #${data.issueNumber}.`, {
          result: v.object({ fix_applied: v.boolean(), pr_url: v.optional(v.string()) }),
        });
      }
      return { output: triage };
    },
  });
  return 'When given an issue number, call the `triage-issue` tool and report its result.';
}
```

---

## 6. One-shot / headless: `flue run` + GitHub Actions

Verbatim positioning: "CI is `flue run`'s home turf: one agent module, one message, no server, no
port. The command executes the agent transport-free and prints the reply to stdout, so a workflow
step can pipe it anywhere."

### `flue run` contract

```bash
flue run <path> --message <text> [--name <agent>] [--id <id>] [--data <json>] [--uid <uid> | --new] [--env <path>] [--json]
```

- Executes one agent module **in-process**: submits one message, streams activity to **stderr**,
  prints the final assistant reply to **stdout**, and exits. No server, no build artifacts. Only
  the agent module (and its imports) is loaded — **never `app.ts`**.
- `--id` continues a conversation across invocations (defaults to a fresh ULID printed on stderr).
- `--data '<json>'` seeds `useInitialData()` at instance creation only; `--new` rejects if the id
  exists (create-exactly-once for CI); `--name` picks one agent from a multi-agent module.
- `--json` prints one envelope to stdout:

```json
{
  "id": "support-4821",
  "agent": "hello",
  "submissionId": "…",
  "outcome": "completed",
  "message": "The final assistant reply.",
  "uid": "inst_…"
}
```

Outcomes: `completed` (carries `message`), `failed` / `aborted` (carry `error`), `error`
(pre-run setup/admission failure). Exit codes: `0` completed, `1` failed/setup error, `130` abort.

CI patterns (verbatim):

```bash
# CI: create exactly once, seed creation data, capture the envelope
flue run src/agents/triage.ts -m "Triage this." --id "issue-$N" --data '{"issue": 17307}' --new --json

# Extract just the reply text from the envelope
flue run src/agents/hello.ts -m "Run the demo." --json | jq -r .message
```

### GitHub Actions workflow (verbatim from the official deploy guide, ANTHROPIC key swapped for our env in the demo)

`.github/workflows/issue-triage.yml`:

```yaml
name: Issue Triage

on:
  issues:
    types: [opened]

jobs:
  triage:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    permissions:
      contents: read
      issues: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - name: Run triage agent
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          npx flue run src/agents/triage.ts \
            --message 'Triage issue #${{ github.event.issue.number }}'
```

For our demo the `env:` block becomes `OPENROUTER_API_KEY`, `SENTRY_DSN`,
`SENTRY_TRACES_SAMPLE_RATE: "1"` (+ optionally the record flags), `GH_TOKEN`.
`GITHUB_TOKEN` is provided automatically by GitHub Actions.

### Official GitHub *channel* (`@flue/github`) — different archetype, noted for completeness

`flue add channel github` — a webhook-ingress channel for a *deployed server* (Hono `app.ts`
mounts `channel.route()` at `/channels/github`; env: `GITHUB_WEBHOOK_SECRET`, `GITHUB_TOKEN`;
uses `@octokit/rest`; dispatches into agents with `dispatch(Assistant, { id, initialData,
message })`). Not what the CI harness demo uses — the Actions deploy guide (above) is the official
CI path, where the workflow event triggers `flue run` and the agent shells out to `gh`.

---

## 7. Observability: Sentry (primary) and OpenTelemetry (fallback)

### Concepts

- The **runtime event stream** (`observe()` from `@flue/runtime`) delivers typed events for
  everything agents do: `agent_start/agent_end/idle`, `submission_settled` (the reliable terminal
  signal), `operation_start/operation`, `turn_*` (model turns with `usage`: input/output/
  cacheRead/cacheWrite/totalTokens/cost), `message_*`, `tool_start/tool`, `task_start/task`
  (subagent delegation), `compaction_*`, `log`. Event format version `v: 3`; correlation fields:
  `agentName`, `conversationId`, `instanceId`, `submissionId`, `operationId`, `turnId`, `taskId`.
- Span-producing integrations register via `instrument(...)` — pairs an observer with an
  execution interceptor.
- **Placement caveat (critical for CI, verbatim):** "flue run loads only the agent module, never
  `app.ts` — register in the agent module when a subscriber must also run under the CLI." The same
  caveat is stated for `setProvider()`.

### Sentry integration — official setup

Official add-flow: `flue add tooling sentry` fetches a **blueprint** (a Markdown implementation
guide a coding agent applies — NOT a package installer). The full current blueprint is public at
`https://flueframework.com/cli/blueprints/sentry.md` (marker `flue-blueprint: tooling/sentry@1`,
dated 2026-06-15). What it does on Node:

1. Install `@flue/opentelemetry` (matching the project's Flue version), `@opentelemetry/api@^1.9.0`,
   and `@sentry/node@^10.64.0`.
2. Create `src/sentry.ts` (full file below) and import it once: `import './sentry.ts';` from
   `app.ts` — **for our CLI/CI demo, import it from the agent module instead** (see caveat above).
3. Signals delivered, sharing one trace per conversation:
   - **Issues** — terminal failures only: `operation` events with `isError: true`, plus
     `submission_settled` with `outcome: 'failed'` not already captured (dedup via
     `capturedFailedSubmissions`) — one failure, one issue, with the throw-site stack from the
     live `errorInfo`.
   - **Logs** — every `log.info/warn/error` (tool `ctx.log`, hook `ctx.log`) as Sentry Logs at its
     level, scrubbed attributes, trace-correlated. `log.error` is a log, NOT an issue.
   - **Breadcrumbs** — `submission_recovery` events (category `flue.submission_recovery`).
   - **Traces** — when `SENTRY_TRACES_SAMPLE_RATE > 0`: Flue's OTel GenAI hierarchy
     `invoke_agent <Agent>` → `chat <model>` (with token usage) / `execute_tool <name>`; also
     `flue.operation shell` and `flue.compaction` spans. Sentry owns the global OTel tracer
     provider after `Sentry.init`, so Flue's spans land in Sentry with no extra wiring.
   - Sentry's own AI provider integrations (`Anthropic_AI`, `OpenAI`, `Google_GenAI`, `LangChain`,
     `LangGraph`, `VercelAI`) are filtered out so model calls aren't double-counted.
   - Everything is tagged with `flue.*` correlation tags (`flue.instance.id`, `flue.agent.name`,
     `flue.conversation.id`, `flue.submission.id`, `flue.session`, `flue.operation.id`,
     `flue.task.id`, …) — pivot on `flue.instance.id` to see every issue/log/span of one instance.

Env contract:

| Variable | Purpose |
| --- | --- |
| `SENTRY_DSN` | Required for delivery; app still starts without it (all calls no-op) |
| `SENTRY_ENVIRONMENT` | Optional |
| `SENTRY_RELEASE` | Optional (e.g. commit SHA) |
| `SENTRY_TRACES_SAMPLE_RATE` | 0–1. **Default 0 = errors+logs only. Must be > 0 for AI traces.** |
| `SENTRY_AI_RECORD_INPUTS` | `true` → prompts, system instructions, tool definitions/arguments in spans |
| `SENTRY_AI_RECORD_OUTPUTS` | `true` → model output, tool results, exception messages/stacks in spans |

With both record flags off (default) the integration passes `content: false` to the OTel
instrumentation — spans carry timing, token usage, model IDs, correlation ids, and NO content.
With a flag on, content passes a transform that admits only that direction, scrubs sensitive keys,
and truncates to 16 KiB per attribute.

#### The complete generated `src/sentry.ts` (Node variant, verbatim from the blueprint)

```ts
// flue-blueprint: tooling/sentry@1

import {
  type ContentOption,
  createOpenTelemetryInstrumentation,
  type GenAIContentType,
  truncateContent,
} from '@flue/opentelemetry';
import { type FlueObservation, instrument } from '@flue/runtime';
import * as Sentry from '@sentry/node';

const recordInputs = process.env.SENTRY_AI_RECORD_INPUTS === 'true';
const recordOutputs = process.env.SENTRY_AI_RECORD_OUTPUTS === 'true';
const tracesSampleRate = clampRate(process.env.SENTRY_TRACES_SAMPLE_RATE, 0);

// Sentry ships integrations that patch AI provider SDKs directly. Flue's
// instrumentation already emits one `chat` span per model turn, so those
// integrations would double-count every model call.
const SENTRY_AI_PROVIDER_INTEGRATIONS = new Set([
  'Anthropic_AI',
  'OpenAI',
  'Google_GenAI',
  'LangChain',
  'LangGraph',
  'VercelAI',
]);

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: Boolean(process.env.SENTRY_DSN),
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
  release: process.env.SENTRY_RELEASE,
  tracesSampleRate,
  // Stream spans to Sentry as each one finishes, so gen_ai children that
  // complete after their parent span are not lost.
  traceLifecycle: 'stream',
  streamGenAiSpans: true,
  enableLogs: true,
  integrations: (defaults) =>
    defaults.filter((integration) => !SENTRY_AI_PROVIDER_INTEGRATIONS.has(integration.name)),
});

// `Sentry.init` registered Sentry as the global OTel tracer provider, so
// Flue's spans flow to Sentry without further wiring. Content capture is
// on by default in the adapter; `contentPolicy()` narrows it to what the
// record flags allow. The instrumentation is keyed, so a dev reload
// replaces the previous registration instead of stacking a duplicate.
if (tracesSampleRate > 0) {
  instrument(createOpenTelemetryInstrumentation({ content: contentPolicy() }));
}

// A failed submission emits a rich `operation` failure first (the original
// error, with the throw-site stack on the live `errorInfo`) and then a
// `submission_settled` whose durable `error` collapses non-Flue causes to a
// generic internal-error payload. Capture the operation and remember its
// submissionId so the settlement is skipped; a settlement with no captured
// operation (reconciled after a crash) is captured from its own `errorInfo`.
const capturedFailedSubmissions = new Set<string>();

// Best-effort flush of buffered events (notably Sentry Logs, which the SDK
// batches) on shutdown. Never call process.exit() here — Flue's generated
// server handles SIGINT/SIGTERM, awaits its lifecycle stop, and exits with
// the correct code; this listener only flushes within that window. It is not
// a delivery guarantee: the server exits as soon as its stop resolves and
// Node does not await promises started by signal listeners, so a flush still
// in flight can be cut short. Traces and issues are sent during the run;
// only very-recently-buffered logs are at risk.
const flush = () => void Sentry.flush(2000);
if (process.env.SENTRY_DSN) {
  process.on('SIGINT', flush);
  process.on('SIGTERM', flush);
}

instrument({
  // Keyed registration: on a dev reload this module re-evaluates while the
  // runtime's registry persists, and the newest install wins — the previous
  // bridge (and its signal listeners) is disposed, so no event is ever
  // double-reported.
  key: Symbol.for('flue.sentry.bridge'),
  observe(event) {
    if (event.type === 'operation' && event.isError) {
      captureTerminalFailure(event.errorInfo ?? event.error, correlationTags(event), {
        durationMs: event.durationMs,
        operationKind: event.operationKind,
      });
      if (event.submissionId) capturedFailedSubmissions.add(event.submissionId);
      return;
    }
    if (event.type === 'submission_settled') {
      const alreadyCaptured = capturedFailedSubmissions.delete(event.submissionId);
      if (event.outcome === 'failed' && !alreadyCaptured) {
        captureTerminalFailure(event.errorInfo ?? event.error, correlationTags(event));
      }
      return;
    }
    if (event.type === 'submission_recovery') {
      recordRecoveryBreadcrumb(event);
      return;
    }
    if (event.type === 'log') {
      Sentry.logger[event.level](event.message, logAttributes(event));
    }
  },
  interceptor: (_operation, _ctx, next) => next(),
  async dispose() {
    process.off('SIGINT', flush);
    process.off('SIGTERM', flush);
    await Sentry.flush(2000);
  },
});

// A coordinator retrying or reconciling a stuck submission — not yet a
// terminal outcome, and 'deferred'/'agent_unavailable' recur on every retry
// wake, so this stays a breadcrumb rather than a captured issue. The one
// terminal outcome, 'terminated', always co-occurs with a `submission_settled`
// outcome:'failed' event that the branch above already captures; recording it
// here too would duplicate that issue.
function recordRecoveryBreadcrumb(event: Extract<FlueObservation, { type: 'submission_recovery' }>): void {
  Sentry.addBreadcrumb({
    category: 'flue.submission_recovery',
    level: event.outcome === 'terminated' ? 'error' : 'warning',
    message: `${event.operation}: ${event.outcome}`,
    data: {
      ...correlationTags(event),
      'flue.recovery.operation': event.operation,
      'flue.recovery.outcome': event.outcome,
      ...(event.attemptCount !== undefined ? { 'flue.recovery.attempt_count': event.attemptCount } : {}),
      ...(event.maxAttempts !== undefined ? { 'flue.recovery.max_attempts': event.maxAttempts } : {}),
      ...(event.errorInfo ? { 'error.type': event.errorInfo.type } : {}),
    },
  });
}

function captureTerminalFailure(
  error: unknown,
  tags: Record<string, string>,
  context?: Record<string, unknown>,
): void {
  Sentry.withScope((scope) => {
    scope.setTags(tags);
    scope.setLevel('error');
    if (context) scope.setContext('flue.incident', context);
    Sentry.captureException(toError(error));
  });
}

// Tag keys use the `flue.*` prefix — the same names the trace spans carry —
// so pivoting on `flue.instance.id` in Sentry's search finds every issue,
// log, and span from a single agent instance.
function correlationTags(event: FlueObservation): Record<string, string> {
  const tags: Record<string, string> = {};
  if (event.instanceId) tags['flue.instance.id'] = event.instanceId;
  if (event.agentName) tags['flue.agent.name'] = event.agentName;
  if (event.conversationId) tags['flue.conversation.id'] = event.conversationId;
  if (event.submissionId) tags['flue.submission.id'] = event.submissionId;
  if (event.harness) tags['flue.harness'] = event.harness;
  if (event.session) tags['flue.session'] = event.session;
  if (event.parentSession) tags['flue.parent_session'] = event.parentSession;
  if (event.operationId) tags['flue.operation.id'] = event.operationId;
  if (event.taskId) tags['flue.task.id'] = event.taskId;
  return tags;
}

type LogAttribute = string | number | boolean;

function logAttributes(event: Extract<FlueObservation, { type: 'log' }>): Record<string, LogAttribute> {
  const attributes: Record<string, LogAttribute> = {};
  for (const [key, value] of Object.entries(correlationTags(event))) attributes[key] = value;
  for (const [key, value] of Object.entries(event.attributes ?? {})) {
    const scrubbed = scrub(value);
    attributes[`flue.log.${key}`] =
      typeof scrubbed === 'string' || typeof scrubbed === 'number' || typeof scrubbed === 'boolean'
        ? scrubbed
        : stringify(scrubbed);
  }
  return attributes;
}

// The content policy for trace spans. With both record flags off, no model
// or tool content reaches Sentry at all (`content: false`). With either flag
// on, the transform admits only the enabled direction, scrubs sensitive keys,
// and tightens the adapter's default 56 KiB budget to 16 KiB per attribute.
function contentPolicy(): ContentOption {
  if (!recordInputs && !recordOutputs) return false;
  return {
    transform(content, scope) {
      if (isInputContent(scope.contentType) && !recordInputs) return undefined;
      if (isOutputContent(scope.contentType) && !recordOutputs) return undefined;
      return truncateContent(scrub(content), { maxBytes: 16_384 });
    },
  };
}

function isInputContent(contentType: GenAIContentType): boolean {
  return (
    contentType === 'input_messages' ||
    contentType === 'system_instructions' ||
    contentType === 'tool_definitions' ||
    contentType === 'tool_description' ||
    contentType === 'tool_arguments'
  );
}

function isOutputContent(contentType: GenAIContentType): boolean {
  return (
    contentType === 'output_messages' ||
    contentType === 'tool_result' ||
    contentType === 'exception_message' ||
    contentType === 'exception_stacktrace'
  );
}

const SENSITIVE_KEY = /api[-_]?key|authorization|cookie|dsn|password|secret|token/i;

function scrub(value: unknown, seen = new WeakSet<object>(), depth = 0): unknown {
  if (depth > 8) return '[truncated]';
  if (value instanceof Error) return { name: value.name, message: value.message };
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => scrub(item, seen, depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      SENSITIVE_KEY.test(key) ? '[redacted]' : scrub(nested, seen, depth + 1),
    ]),
  );
}

function toError(value: unknown): Error {
  if (value instanceof Error) return value;
  if (value && typeof value === 'object') {
    const source = value as { name?: unknown; message?: unknown; stack?: unknown };
    const error = new Error(typeof source.message === 'string' ? source.message : stringify(value));
    if (typeof source.name === 'string') error.name = source.name;
    if (typeof source.stack === 'string') error.stack = source.stack;
    return error;
  }
  return new Error(typeof value === 'string' ? value : stringify(value));
}

function stringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function clampRate(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback;
}
```

Blueprint verification checklist (abridged): one trace with `invoke_agent` + `chat` +
`execute_tool` and token usage; no content while record flags off; exactly ONE issue per terminal
failure (settlement dedup); `log.error` lands in Logs, never Issues; app starts without a DSN.

#### Wiring for the CI demo (deviation from the blueprint's app.ts import — justified by the docs)

The blueprint wires `import './sentry.ts';` into `app.ts`, but `flue run` **never loads `app.ts`**.
The observability guide's own instruction for CLI-run subscribers: "register in the agent module."
So the demo's agent module starts with:

```ts
import '../sentry.ts'; // must run before the agent — registers Sentry + instrumentation
```

Flush-on-exit under `flue run` is handled: verified in `@flue/cli@2.0.3` (`run-bootstrap.mjs`),
`flue run` creates an instrumentation owner around the agent-module load and **awaits
`instrumentationOwner.dispose()`** when the run closes — which invokes the bridge's
`dispose()` → `await Sentry.flush(2000)`. Traces/issues also stream during the run
(`traceLifecycle: 'stream'`).

### OpenTelemetry fallback (`@flue/opentelemetry` directly)

```sh
npm install @flue/opentelemetry @opentelemetry/api
```

Configure your own OTel SDK/exporter first, then:

```ts
import { createOpenTelemetryInstrumentation } from '@flue/opentelemetry';
import { instrument } from '@flue/runtime';

const instrumentation = createOpenTelemetryInstrumentation();
const disposeInstrumentation = instrument(instrumentation);
```

- Implements the Development OTel GenAI conventions (pinned at commit
  `4c8addb53718b544134be47e256237026fe88875`). Trace model: prompt/skill operation →
  `invoke_agent <agent>`; delegated task → its own `invoke_agent`; provider inference →
  `chat <requested-model>` client span; tool → `execute_tool <name>`; shell →
  `flue.operation shell`; compaction → `flue.compaction`. `gen_ai.conversation.id` identifies the
  persisted session; extra correlation under `flue.*` attributes.
- **Content is ON by default** (deviation from OTel convention) — pass
  `createOpenTelemetryInstrumentation({ content: false })` or a `content.transform(content, scope)`
  policy (`truncateContent(content, { maxBytes })` exported for budgets; 56 KiB per-span in-band
  budget enforced after the transform).
- Emits client-operation, token-usage, agent-invocation, and tool-duration histogram metrics;
  logs require explicit Logger injection.
- It does NOT configure an SDK, exporter, sampling, or flushing — that's yours. (The Sentry
  integration is exactly this adapter + Sentry as the global tracer provider + the event bridge.)

---

## 8. Durability / session persistence (matters for CI)

- Storage is a **Node concern** configured by one optional file, `src/db.ts`, default-exporting a
  persistence adapter. Discovered by convention by `vite dev`, `vite build`, AND `flue run`.
- What's stored: append-only canonical conversation streams (messages, tool calls/results,
  compaction, recovery facts), accepted submissions (recorded durably BEFORE processing — that's
  what makes work recoverable), and every `usePersistentState` write. NOT stored: sandbox files,
  external side effects, credentials.
- Built-in adapter (no extra deps — uses Node's `node:sqlite`):

```ts
import { sqlite } from '@flue/runtime/node';

export default sqlite('./data/flue.db');
```

  Creates the file + parent dirs on first boot, WAL mode. `sqlite()` with no arg or `':memory:'`
  is in-memory.
- **Without `db.ts`, `flue run` uses a project-local cache file
  `node_modules/.cache/flue/run.db` — never reset, so `--id` continues conversations across
  invocations** on the same machine. (`vite dev` → `node_modules/.cache/flue/dev.db`; a built
  server without db.ts is memory-only.)
- In GitHub Actions the runner is ephemeral, so each workflow run starts fresh. Options for the
  demo (my note, not docs): a fresh `--id` per issue/PR run is the natural fit; if cross-run
  continuity is wanted, add `src/db.ts` with `sqlite('./data/flue.db')` and persist `data/` with
  `actions/cache` or an artifact.
- Ecosystem adapters via blueprints (`flue add database postgres`): `@flue/postgres`,
  `@flue/libsql`, `@flue/mysql`, `@flue/mongodb`, `@flue/redis` — bring-your-own-driver runners.
  Overkill for the demo.
- Recovery model: submissions settle `completed | failed | aborted` (`submission_settled` is "the
  reliable terminal signal"); event hooks and tools are at-least-once with durable outcomes
  committed atomically; `durable: true` tools get `step.do(name, fn)` exactly-once-recorded steps.

---

## 9. Gotchas

1. **`flue run` never loads `app.ts`.** Sentry/instrumentation/`setProvider()`/`observe()` wiring
   must be imported from the *agent module* for the CI harness (`import '../sentry.ts';` at the top
   of the agent module). The blueprint's `app.ts` import only covers the server path.
2. **Traces are off by default.** `SENTRY_TRACES_SAMPLE_RATE` defaults to 0 (errors + logs only).
   The demo workflow must set it (e.g. `"1"`) to get `invoke_agent`/`chat`/`execute_tool` spans.
3. **Span content is off by default in the Sentry integration.** Set
   `SENTRY_AI_RECORD_INPUTS=true` / `SENTRY_AI_RECORD_OUTPUTS=true` to see prompts/outputs in
   spans (scrubbed + truncated to 16 KiB/attribute). Conversely, the raw
   `createOpenTelemetryInstrumentation()` adapter has content ON by default — don't mix up the two
   defaults.
4. **OpenRouter model IDs must exist in Pi's catalog** ("an unknown specifier fails fast", before
   any request). Use verified IDs (Section 4). Watch the dot-vs-hyphen trap:
   `openrouter/anthropic/claude-haiku-4.5` but `anthropic/claude-haiku-4-5`.
5. **`local()` sandbox strips the environment.** Only PATH/HOME/locale-class vars are inherited;
   forward `GH_TOKEN` etc. explicitly via `local({ env: { GH_TOKEN: process.env.GH_TOKEN } })`.
   Without `useSandbox(local())` the agent has no file/shell tools at all.
6. **`useModel` is required exactly once per render** and throws inside subagent renders
   (delegates set `model` on their `useSubagent`/`defineSubagent` definition instead).
   `thinkingLevel`: use `'off'…'xhigh'` (the reference type omits the guide's `'max'`).
7. **Do not export subagent delegate functions from a `'use agent'` module** — every exported
   capitalized function becomes a registered top-level agent in the Vite build.
8. **stdout is only the final reply** (or the `--json` envelope); all progress goes to stderr.
   Exit codes: 0 completed / 1 failed / 130 aborted — a failed agent fails the CI step naturally.
9. **tsconfig needs `allowImportingTsExtensions` + `noEmit`** — Flue imports use explicit `.ts`
   extensions; the scaffold's exact tsconfig is in Section 2. `"type": "module"` in package.json.
10. **Node >= 22.19.0** (`node:sqlite` powers the default storage; workflow uses
    `actions/setup-node` with `node-version: 22` or 24).
11. **`flue add` is not an installer** — it prints a Markdown blueprint for a coding agent to apply.
    Non-interactive-safe with `--print`. `flue init` writes files only; with only `--target` passed
    it may still prompt for the deploy choice — scaffold manually or pass both flags.
12. **Tool `run` throws are model-visible tool errors, not crashes** — they do NOT fail the
    submission and will NOT raise Sentry issues. To demo a Sentry issue, fail terminally (e.g.
    throw from a `useAgentStart` callback, or make the model's turn fail); to demo Sentry Logs,
    call `ctx.log.error(...)` in a tool.
13. **Double-instrumentation guard**: keep the blueprint's `Symbol.for('flue.sentry.bridge')` key
    and its `SENTRY_AI_PROVIDER_INTEGRATIONS` filter (prevents double-counting model calls).
14. **Conversation continuity in CI** comes from `--id` + storage. Default `flue run` storage is
    `node_modules/.cache/flue/run.db` (ephemeral on CI runners). Add `src/db.ts` with
    `sqlite('./data/flue.db')` if the demo wants an inspectable/persistable session file.
15. `@flue/cli` bundles `vite`/`@flue/vite` as its own dependencies — a CLI-only project does not
    add them, and does not need `hono` either.
16. Sentry flush on CLI exit is handled (verified in `run-bootstrap.mjs`: instrumentation owner
    disposed on close → bridge `dispose()` awaits `Sentry.flush(2000)`), but the blueprint calls
    shutdown flushing "best-effort" — very-recently-buffered logs can be cut short on abnormal
    termination.

---

## 10. Doc URLs used (all fetchable as raw markdown by appending `index.md`)

- https://flueframework.com/docs/guide/getting-started/
- https://flueframework.com/docs/guide/project-layout/
- https://flueframework.com/docs/guide/agent-hooks/
- https://flueframework.com/docs/guide/models/
- https://flueframework.com/docs/guide/subagents/
- https://flueframework.com/docs/guide/observability/
- https://flueframework.com/docs/guide/database/
- https://flueframework.com/docs/cli/run/ , /docs/cli/init/ , /docs/cli/add/
- https://flueframework.com/docs/ecosystem/deploy/github-actions/
- https://flueframework.com/docs/ecosystem/tooling/sentry/
- https://flueframework.com/docs/ecosystem/tooling/opentelemetry/
- https://flueframework.com/docs/ecosystem/channels/github/
- https://flueframework.com/cli/blueprints/sentry.md (full Sentry blueprint)
- https://pi.dev/docs/latest/providers (provider → env-var table; OpenRouter = `OPENROUTER_API_KEY`)
- Reference docs shipped in `@flue/cli` npm package under `package/docs/reference/`
  (agent-hooks-api.md, agent-api.md, events.md, provider-api.md, configuration.md)
