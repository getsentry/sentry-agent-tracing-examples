# Model selection for the PR-review orchestrator — agentic/tool-calling benchmarks (Aug 2026)

Researched 2026-08-08 against primary sources: provider release blogs and model cards
(kimi.com, huggingface.co/moonshotai, x.ai, api-docs.deepseek.com, z.ai, minimax.io,
qwen, anthropic.com), the live leaderboard sites (gorilla.cs.berkeley.edu BFCL V4 —
rendered via browser, livebench.ai, tbench.ai, taubench.com, vals.ai,
artificialanalysis.ai), and the OpenRouter models API (`/api/v1/models`, fetched
2026-08-08). Aggregator mirrors (benchlm.ai) are used only where the primary table was
not renderable, and are labeled as such. Anything not directly verified is flagged.

Task profile being selected for: a PR-review orchestrator agent that must (a) follow a
multi-step system prompt in order, (b) call tools with correct JSON arguments including
MCP tools, (c) dispatch parallel reviewer subagent tasks, and (d) synthesize a Markdown
review. Candidate models are evaluated **as served on OpenRouter**.

---

## 1. State of the agentic benchmarks (which ones are usable in Aug 2026)

Not all of the requested benchmarks still cover current models. Status check first,
because absence of a score is usually the benchmark's fault, not the model's:

| Benchmark | Status Aug 2026 | Coverage of our candidates |
|---|---|---|
| **BFCL V4** (gorilla.cs.berkeley.edu) | Last updated **2026-04-12** (page header) | Only Claude Haiku 4.5. No Kimi K2.6/K3, Grok 4.5, DeepSeek V4, GLM-5.2, Qwen3.7/3.8, MiniMax M3 |
| **tau2-bench** | Sierra has moved on to **τ³** domains (taubench.com); AA still runs a tau2-telecom board | GLM-5.2 verified on the primary board; others only via BenchLM's mirror of AA data |
| **τ³-Banking** (tau successor) | Live: part of AA Intelligence Index v4.1.1 and Sierra's taubench.com | Qwen3.8 Max #1 (55.2%), Grok 4.5 #3 (47.9%) on taubench.com |
| **SWE-bench Verified** | Fragmented: swebench.com official + vals.ai independent + provider-published; numbers differ by harness | Broad but inconsistent — see §4 |
| **Terminal-Bench 2.0/2.1** (tbench.ai) | Live | 2.1: only Grok 4.5 among candidates. 2.0: only older siblings (Kimi K2.5, GLM 5, MiniMax M2) |
| **LiveBench 2026-06-25** (livebench.ai) | Live, includes an **Agentic Coding** category | **Best single cross-model source: 8 of 10 candidates present** |
| **AgentBench** | Dormant — "run cold since 2025," last tracked update 2026-04-16, led by a Qwen2.5-32B fine-tune | None of the candidates |
| **AA Intelligence Index v4.1.1** (artificialanalysis.ai) | Live; 9 evals incl. τ³-Banking, Terminal-Bench v2.1 (Terminus 2 harness, e2b, pass@1×3), GDPval-AA | 7 of 10 candidates |

Sources: BFCL header "Last Updated: 2026-04-12" (https://gorilla.cs.berkeley.edu/leaderboard.html, browser-rendered 2026-08-08);
tau2→τ³ transition and τ³ boards (https://github.com/sierra-research/tau2-bench, https://taubench.com);
Terminal-Bench boards (https://www.tbench.ai/leaderboard/terminal-bench/2.1, https://www.tbench.ai/leaderboard/terminal-bench/2.0);
LiveBench release 2026-06-25 (https://livebench.ai);
AgentBench dormancy (https://benchmarkingagents.com/agentbench/, https://leaderboard.steel.dev/leaderboards/agentbench/);
AA index composition (https://artificialanalysis.ai/models).

**Consequence:** there is no single leaderboard where all ten candidates appear. The
most decision-useful sources for this task are LiveBench's Agentic Coding split
(uniform harness, 8/10 candidates), AA's Intelligence/Agentic index (7/10), and
provider-published agentic evals (per-model, non-comparable harnesses).

---

## 2. Cross-model: LiveBench 2026-06-25 (uniform harness, primary source)

Fetched from livebench.ai (browser-rendered 2026-08-08). Cost = LiveBench's "cost per
successful task." Sorted by Overall. (https://livebench.ai)

| Model (as listed) | Overall | Coding | **Agentic Coding** | Instruction Following | Cost/successful task |
|---|---|---|---|---|---|
| Claude Fable 5 Max Effort (frontier ref) | 83.0 | 86.0 | 62.2 | 75.8 | $1.439 |
| **Kimi K3** (open) | 79.2 | 81.4 | **62.2** | 71.4 | $0.348 |
| **Qwen 3.8 Max** | 78.5 | 72.9 | **64.6** ← best of all 38 models on this split with Fable 5 ≈62 | 74.1 | $0.275 |
| **Grok 4.5** | 75.8 | 68.6 | 56.5 | 71.5 | $0.131 |
| **DeepSeek V4 Flash 0731** (open) | 74.2 | 75.0 | 46.8 | 65.5 | $0.060 |
| **GLM-5.2** (open) | 73.2 | 79.7 | 51.8 | 62.3 | $0.225 |
| **DeepSeek V4 Pro** (open) | 71.6 | 70.0 | 42.6 | 62.4 | $0.050 |
| **Kimi K2.6 Thinking** (open) | 70.5 | 78.6 | 46.9 | 64.4 | $0.169 |
| **MiniMax M3** | 67.3 | 68.2 | 40.7 | 57.5 | $0.060 |
| DeepSeek V4 Flash (pre-0731) (open) | 65.5 | 69.2 | 37.6 | 63.1 | $0.016 |

Not on LiveBench 2026-06-25: **Qwen 3.7 Flash** and **Claude Haiku 4.5** (full 38-row
table checked; Qwen 3.7 appears only as "Qwen 3.7 Max": 73.1 overall / 43.6 agentic).

Notable within-family fact: **DeepSeek V4 Flash "0731" scores +8.7 overall and +9.2
agentic-coding over the pre-0731 Flash row** — the snapshot suffix matters; the
OpenRouter `deepseek-v4-flash-0731` ID is the good one. (https://livebench.ai)

---

## 3. Cross-model: function calling and tau-style tool use

### BFCL V4 (primary table, browser-rendered 2026-08-08 — last updated 2026-04-12)

Only one candidate is listed. Relevant rows (Overall Acc / Agentic-WebSearch / Memory /
Multi-turn / eval cost / mean latency): (https://gorilla.cs.berkeley.edu/leaderboard.html)

| Rank | Model | Overall | Web Search | Memory | Multi-turn | Cost | Latency |
|---|---|---|---|---|---|---|---|
| 1 | Claude-Opus-4-5 (FC) | 77.47 | 84.5 | 73.76 | 68.38 | $86.55 | 4.38s |
| 4 | GLM-4.6 (FC thinking) — GLM-5.2's predecessor | 72.38 | 77.5 | 55.7 | 68.0 | $4.64 | 4.34s |
| 5 | Grok-4.1-fast-reasoning (FC) | 69.57 | 82.5 | 53.98 | 58.87 | $17.26 | 6.74s |
| **6** | **Claude-Haiku-4-5 (FC)** | **68.7** | 83.5 | 54.41 | 53.62 | **$14.23** | **1.68s** |
| 11 | Moonshotai-Kimi-K2-Instruct (FC) — two generations behind K2.6 | 59.06 | 66.5 | 29.03 | 50.63 | $6.19 | 6.4s |
| 12 | Grok-4.1-fast-non-reasoning (FC) | 58.29 | 75.0 | 26.24 | 46.75 | $16.27 | 2.29s |

Haiku 4.5 at rank 6 with the lowest latency in the top 10 is the strongest *verified*
function-calling datapoint among the candidates — but the board predates every other
candidate, so **BFCL cannot rank them: "not listed" for all nine non-Anthropic
candidates.**

### tau2 / τ³ (Sierra + Artificial Analysis)

- Sierra's official τ³-Banking (knowledge retrieval) top-3: **Qwen 3.8 Max 55.2%**,
  Claude Opus 5 48.7%, **Grok 4.5 47.9%** — two candidates in the global top-3
  (https://taubench.com). Kimi, DeepSeek, GLM-5.2, MiniMax M3 absent from the visible
  top-3 boards.
- AA tau2-bench-telecom (independently run): **GLM-5.2 (max) 99.1% — tied #1 of 440
  models** with JT-35B-Flash (https://artificialanalysis.ai/evaluations/tau2-bench).
- BenchLM's mirror of AA tau2 telecom rows (secondary; GLM-5.2 value cross-checks
  against the AA primary above): Kimi K2.6 95.9, DeepSeek V4 Pro 96.2, MiniMax M3
  88.9, Kimi K3 / Grok 4.5 / DeepSeek V4 Flash / Qwen3.8 Max / Qwen3.7 Flash /
  Haiku 4.5 not listed (https://benchlm.ai/benchmarks/tau2-bench). Treat the mirrored
  numbers as AA-derived but second-hand. Note tau2-telecom is near-saturated at the
  top (99.1 ceiling), which is why Sierra moved to τ³.

### Terminal-Bench (official tbench.ai)

- 2.1: **Grok 4.5 is the only candidate present — 79.3% via Cursor CLI, rank 4 of 17**,
  behind Claude Code + Fable 5 (83.8%) and Codex + GPT-5.5 (83.1%)
  (https://www.tbench.ai/leaderboard/terminal-bench/2.1).
- 2.0 (142 entries): no candidates; nearest siblings under the Terminus 2 harness:
  GLM 5 52.4%, Kimi K2.5 43.2%, DeepSeek-V3.2 39.6%, MiniMax M2 30.0%
  (https://www.tbench.ai/leaderboard/terminal-bench/2.0).
- Moonshot self-reports Terminal-Bench 2.1 = 88.3 for Kimi K3 **with its own Kimi Code
  harness** (https://huggingface.co/moonshotai/Kimi-K3) — not comparable to tbench.ai
  rows, and K3 does not appear on the official board.

### SWE-bench Verified (harness-fragmented — do not mix columns across sources)

- vals.ai (independent run, updated 2026-08-06): Claude Opus 5 97.0%, GPT-5.6 Sol
  96.2%, Claude Fable 5 95.0%, **Kimi K3 93.4%** (https://www.vals.ai/benchmarks/swebench).
  Other candidates not in the visible top rows.
- BenchLM mirror of published results (secondary, mixed provenance): DeepSeek V4 Pro
  (max effort) 80.6, MiniMax M3 80.5, **Kimi K2.6 80.2** (matches Moonshot's own
  number below), DeepSeek V4 Flash (max) 79.0, GLM-5 77.8, **Claude Haiku 4.5 73.3**
  (https://benchlm.ai/benchmarks/sweVerified).

### MCP-specific tool use (MCPMark / MCP Atlas)

Directly relevant since the orchestrator calls MCP tools. Coverage is thin but
consistent:

- MCPMark (llm-stats mirror of the public board): **Qwen3.7 Max 60.8%**, **Kimi K2.6
  55.9%** (corroborates Moonshot's self-reported 55.9), Qwen3.6 Plus 48.2%; no rows
  for GLM-5.2, MiniMax M3, Grok 4.5 (https://llm-stats.com/benchmarks/mcp-mark).
- MCPMark-Verified: Kimi K3 **94.5** (provider-published,
  https://huggingface.co/moonshotai/Kimi-K3) — different task subset than plain
  MCPMark; not comparable to the 55.9/60.8 rows.
- MCP Atlas (BenchLM, Jul 2026): **GLM-5.2 76.8%**, Qwen3.7 Max 76.4%, MiniMax M3
  74.2% (https://benchlm.ai/benchmarks/mcpAtlas).

### AA Intelligence Index v4.1.1 (9 evals: GDPval-AA v2, τ³-Banking, Terminal-Bench
v2.1, SciCode, HLE, GPQA-D, CritPt, AA-Omniscience, AA-LCR; browser-rendered 2026-08-08)

| Model | AA Index | Cost to run full index |
|---|---|---|
| Claude Opus 5 (max) / Fable 5 | 63 / 62 | $2.34 / $3.14 per task (weighted avg cost/task) |
| **Kimi K3 (max)** | **60** — #1 open-weights | $0.84/task; $2,425 total, 130M output tokens |
| **Qwen3.8 Max** | 58 | — |
| **Grok 4.5 (high)** | 56 | $0.36/task |
| **GLM-5.2 (max)** | 53 | $0.31/task |
| **DeepSeek V4 Flash 0731 (max)** | 52 | **$0.03/task** (cheapest of the 24-model board) |
| **MiniMax-M3** | 45 | $0.14/task |
| **Claude 4.5 Haiku** | 30 | — |

(https://artificialanalysis.ai/models — "Intelligence" and cost-per-task highlight
charts; Kimi K3 detail incl. token counts: https://artificialanalysis.ai/models/kimi-k3)

The Haiku 4.5 = 30 vs MiniMax M3 = 45 gap on AA's index vs Haiku's *stronger* showing
on BFCL is a reminder these indices weight long-horizon reasoning heavily, not raw
function-call correctness.

---

## 4. Per-model notes (provider-published numbers; OpenRouter serving facts)

Provider-published numbers are self-reported on the provider's own harness — comparable
within a model's row, not across vendors.

### 4a. Kimi K2.6 (`moonshotai/kimi-k2.6`) — current incumbent

- Released/open-sourced 2026-04-20; 1T-param MoE (32B active), 256K context, "native
  multimodal agentic model" aimed at long-horizon coding and swarm orchestration
  (Agent Swarm: up to 300 sub-agents / 4,000 coordinated steps)
  (https://huggingface.co/moonshotai/Kimi-K2.6, https://www.kimi.com/blog/kimi-k2-6).
- Provider-published agentic/coding: SWE-bench Verified **80.2**; SWE-bench Pro 58.6;
  Terminal-Bench 2.0 66.7; LiveCodeBench v6 89.6; **Toolathlon 50.0**; **MCPMark
  55.9** (MCP-server tool use — relevant to our MCP tools); HLE-Full w/ tools 54.0
  (https://huggingface.co/moonshotai/Kimi-K2.6, https://www.kimi.com/blog/kimi-k2-6).
- tau/tau2, BFCL, AgentBench: **not published** by Moonshot for K2.6. Third-party:
  AA-mirrored tau2-telecom 95.9 (https://benchlm.ai/benchmarks/tau2-bench); LiveBench
  70.5 overall / 46.9 agentic coding (as "Kimi K2.6 Thinking", https://livebench.ai).
- Modes: Thinking (default, benchmarks run in this mode, temp 1.0) and Instant
  (temp 0.6); **no published Thinking-vs-Instant agentic deltas**
  (https://huggingface.co/moonshotai/Kimi-K2.6).
- OpenRouter: $0.5795/$2.44 is the cheapest-endpoint (Baidu) price, flagged "39% off";
  other endpoints run up to $1.20/$4.60; Moonshot's own platform lists $0.95 in
  (cache-miss) / $4.00 out (https://openrouter.ai/moonshotai/kimi-k2.6,
  https://openrouter.ai/api/v1/models/moonshotai/kimi-k2.6/endpoints,
  https://platform.kimi.ai/docs/pricing/chat-k26). **Price-drift risk if the discount
  endpoint disappears.**
- Caveat from AA: K2.6 burned 170M output tokens / $841 to run AA's index — a
  token-hungry model (https://artificialanalysis.ai/models/kimi-k2-6).

### 4b. Kimi K3 (`moonshotai/kimi-k3`)

- Released 2026-07-16/17 (blog says Jul 17, OpenRouter and press say Jul 16); weights
  (2.8T MoE, 104B active, 1M context) published 2026-07-27
  (https://www.kimi.com/blog/kimi-k3, https://openrouter.ai/moonshotai/kimi-k3,
  https://huggingface.co/moonshotai/Kimi-K3).
- Provider-published agentic (max effort): Terminal-Bench 2.1 **88.3 (own Kimi Code
  harness)**; **MCPMark-Verified 94.5**; **Toolathlon-Verified 76.5**; OSWorld-Verified
  84.8; BrowseComp 91.2; APEX-Agents 41.0; HLE 43.5→56.0 with tools
  (https://huggingface.co/moonshotai/Kimi-K3). SWE-bench Verified 76.8 appears in
  launch-coverage tables but I could not render the primary row (flagged)
  (https://wan27.org/blog/kimi-k3-benchmarks).
- Independent: vals.ai SWE-bench Verified **93.4%** (4th overall, top open-weights)
  (https://www.vals.ai/benchmarks/swebench); AA Intelligence Index **60, #1
  open-weights** (https://artificialanalysis.ai/models/kimi-k3); LiveBench 79.2
  overall / 62.2 agentic coding — matches Claude Fable 5's agentic split at 1/4 the
  cost-per-task (https://livebench.ai).
- Always-on thinking, `reasoning_effort` low/high/max (default max; only max live at
  launch; no per-effort published deltas)
  (https://platform.kimi.ai/docs/guide/use-reasoning-effort,
  https://simonwillison.net/2026/Jul/16/kimi-k3/). Willison measured ~13.2K reasoning
  tokens for a 3.4K-token answer — budget accordingly at $15/M out.
- OpenRouter: $3/$15 list (headline shows $2.80/$14 cheapest endpoint); tools supported
  on the Moonshot endpoint, **not on DeepInfra's** — pin the provider
  (https://openrouter.ai/api/v1/models/moonshotai/kimi-k3/endpoints).

### 4c. DeepSeek V4 Flash 0731 (`deepseek/deepseek-v4-flash-0731`)

- Released 2026-07-31 as the official (public-beta) release superseding the April
  preview; same size, "only re-post-trained," "significantly enhanced agent
  capabilities, with benchmark results far exceeding V4-Pro-Preview"
  (https://api-docs.deepseek.com/updates/). 284B MoE / 13B active, 1M context
  (https://openrouter.ai/deepseek/deepseek-v4-flash-0731; HF card says 304B —
  unresolved discrepancy, https://huggingface.co/deepseek-ai/DeepSeek-V4-Flash-0731).
- Provider-published (0731, reasoning effort max, minimal-mode DeepSeek Harness):
  **Terminal-Bench 2.1: 82.7**; Toolathlon-Verified 70.3; DeepSWE 54.4; Cybergym
  76.7; NL2Repo 54.2 (https://huggingface.co/deepseek-ai/DeepSeek-V4-Flash-0731).
  tau2, BFCL, SWE-bench Verified: **not published for 0731**. The April preview's
  tech report has SWE-V 79.0 / Terminal-Bench 2.0 56.9 at max effort
  (https://arxiv.org/pdf/2606.19348, Table 7); a third-party paper measured the
  preview at τ³ ReAct pass^1 Telecom 99.1 / Retail 87.6 / Airline 81.6 and SWE-V
  77.4 (https://arxiv.org/pdf/2606.14790).
- Not on any official third-party board (taubench.com, BFCL, tbench.ai, swebench.com
  — checked individually, 2026-08-08). LiveBench (uniform harness): 74.2 overall /
  46.8 agentic coding (https://livebench.ai). AA index 52 at max effort vs **29 for
  the non-reasoning variant** (https://artificialanalysis.ai/models/deepseek-v4-flash,
  https://artificialanalysis.ai/models/deepseek-v4-flash-non-reasoning).
- Pricing: OpenRouter $0.0896/$0.1792 (36%-discount headline, confirms ≈$0.09/$0.18);
  first-party API $0.14/$0.28 with a **stated plan to raise prices** "in the near
  future" (https://api-docs.deepseek.com/quick_start/pricing/). OpenRouter offers an
  "Exacto (highest tool-calling accuracy)" routing variant
  (https://openrouter.ai/deepseek/deepseek-v4-flash-0731).

### 4d. DeepSeek V4 Pro (`deepseek/deepseek-v4-pro`)

- Announced 2026-04-24 as V4 Preview (1.6T MoE / 49B active, 1M ctx, MIT); "Open-source
  SOTA in Agentic Coding" (https://api-docs.deepseek.com/news/news260424/). No GA entry
  in the changelog since — still the April model; endpoints serve
  `deepseek-v4-pro-20260423` (https://openrouter.ai/api/v1/models/deepseek/deepseek-v4-pro/endpoints).
- Provider-published (max thinking): SWE-bench Verified **80.6**; Terminal-Bench 2.0
  67.9; MCPAtlas Public 73.6; Toolathlon 51.8; BrowseComp 83.4
  (https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro). tau2/BFCL: not published.
- **Publishes the best thinking-mode ablation of any candidate** (see §5).
- Not on any official third-party board. LiveBench: 71.6 overall / **42.6 agentic
  coding — below Flash 0731's 46.8** (https://livebench.ai). The newer re-post-trained
  Flash beats Pro on agentic tasks; Pro's advantage is raw reasoning (LiveCodeBench
  93.5, Codeforces 3206, https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro).
- Pricing: the $0.435/$0.87 returned by the OpenRouter API is the **DeepSeek
  first-party endpoint**; cheapest endpoint headline is $0.1096/$0.2192 (StreamLake
  fp8, 93.7% discount); Fireworks/Together run $1.74/$3.48
  (https://openrouter.ai/api/v1/models/deepseek/deepseek-v4-pro/endpoints).

### 4e. GLM-5.2 (`z-ai/glm-5.2`)

- Released 2026-06-16/17; "flagship model for long-horizon tasks"; 744B-A40B
  sparse-attention MoE (IndexShare, 2.9× FLOP cut at 1M ctx), 1M context, MIT
  (https://huggingface.co/blog/zai-org/glm-52-blog, https://huggingface.co/zai-org/GLM-5.2,
  https://github.com/zai-org/GLM-5; canonical z.ai/blog/glm-5.2 is a JS shell —
  content verified via the HF mirrors).
- Provider-published: **Terminal-Bench 2.1: 81.0 (Terminus-2) / 82.7 best-reported**;
  MCP-Atlas Public **76.8**; Tool-Decathlon 48.2; SWE-bench Pro 62.1; FrontierSWE
  74.4; HLE-with-tools 54.7 (https://huggingface.co/zai-org/GLM-5.2). tau2, BFCL,
  SWE-bench Verified: **not published for 5.2** (GLM-5 tech report has tau2 89.7
  aggregate and SWE-V 77.8, https://arxiv.org/pdf/2602.15763).
- Independently verified highlight: **AA tau2-telecom 99.1%, tied #1 of 440**
  (https://artificialanalysis.ai/evaluations/tau2-bench); AA Intelligence Index 53;
  AA named it "the new leading open weights model" at launch
  (https://artificialanalysis.ai/articles/glm-5-2-is-the-new-leading-open-weights-model-on-the-artificial-analysis-intelligence-index).
  LiveBench: 73.2 overall / 51.8 agentic coding / 79.7 coding (https://livebench.ai).
  Sobering third-party datapoint: GLM-**5.1** scored only 58.7% on official
  Terminal-Bench 2.1 via Claude Code — a large gap vs Z.ai's self-reported 81.0 for
  5.2, which no official board has verified
  (https://www.tbench.ai/leaderboard/terminal-bench/2.1).
- Thinking: toggleable (`enable_thinking`), efforts high/max — **no published
  thinking-on/off deltas** (https://github.com/zai-org/GLM-5).
- Pricing caveat: $0.182/$0.572 is the **cheapest-of-~30-providers floor**
  (StreamLake); Z.AI's own endpoint (and Fireworks/Together/Cloudflare) is
  **$1.40/$4.40** (https://openrouter.ai/api/v1/models/z-ai/glm-5.2/endpoints).
  Budget on the floor price only if you're comfortable with discount-provider routing;
  `parallel_tool_calls` supported (https://openrouter.ai/api/v1/models, 2026-08-08).

### 4f. MiniMax M3 (`minimax/minimax-m3`)

- Released 2026-06-01; "frontier model built to serve more users" — agentic reasoning,
  tool use, coding, 1M ctx, native multimodal; ~428B/~23B active
  (https://www.minimax.io/blog/minimax-m3, https://huggingface.co/MiniMaxAI/MiniMax-M3).
- Provider-published (official benchmark figure): SWE-bench Verified **80.5** (Claude
  Code scaffold, avg of 4); Terminal-Bench 2.1 66.0 (Terminus 2); **MCP Atlas 74.2**;
  OSWorld-Verified 75.2; BrowseComp 83.5; Apex-Agents 27.7
  (https://raw.githubusercontent.com/MiniMax-AI/MiniMax-M3/main/figures/benchmark.jpeg
  via https://github.com/MiniMax-AI/MiniMax-M3). tau2, BFCL: not published. Press
  noted the frontier claims were unverified at launch
  (https://www.techtimes.com/articles/317532/20260601/minimax-m3-open-weight-coding-model-frontier-claims-unverified-benchmarks.htm).
- Not on any official third-party board (M2.5 has SWE-V 75.8 on swebench.com; no M3,
  https://www.swebench.com/). LiveBench: 67.3 overall / 40.7 agentic coding — last
  among the candidates present (https://livebench.ai). AA index 45.
- Thinking: `thinking` = enabled / **adaptive** (model decides per request) /
  disabled, same price either way (https://huggingface.co/MiniMaxAI/MiniMax-M3);
  docs **require** passing `<think>` reasoning content back between tool-call turns
  (https://platform.minimax.io/docs/guides/text-m3-function-call) — see §5 for why.
- Pricing: $0.30/$1.20 base confirmed; currently a promo $0.24/$0.96 on the page; a
  `:batch` variant exists at $0.15/$0.60 (https://openrouter.ai/minimax/minimax-m3,
  https://openrouter.ai/api/v1/models).

### 4g. Grok 4.5 (`x-ai/grok-4.5`)

- Announced 2026-07-16: "smartest model built for coding, agentic tasks, and knowledge
  work... trained alongside Cursor"; RL on "hundreds of thousands of tasks, centered
  on multi-step software engineering"; ~80 TPS serving; claims "roughly 2x the token
  efficiency of comparable leading models" (https://x.ai/news/grok-4-5). (OpenRouter
  dates it Jul 8 — consistent with early Cursor availability; exact date conflict
  flagged, https://openrouter.ai/x-ai/grok-4.5.)
- Provider-published: Terminal-Bench 2.1 **83.3**; SWE-bench Pro 64.7; SWE Marathon
  **29.0 — listed above Opus 4.8 (26.0) and Fable max (24.0)**; DeepSWE 1.0 62.0;
  token efficiency **15,954 avg output tokens per SWE-bench-Pro task vs Opus 4.8's
  67,020 ("4.2× fewer")** (https://x.ai/news/grok-4-5). tau2, BFCL, SWE-bench
  Verified: not published by xAI.
- Independently verified: official Terminal-Bench 2.1 **79.3% (rank 4, Cursor CLI,
  effort high, −9.0% hacks adjustment, $134 run cost)** — ~4 pts below the
  self-report (https://www.tbench.ai/leaderboard/terminal-bench/2.1); Sierra
  **τ³-Banking 47.9%, rank 3** (reasoning high)
  (https://taubench.com/leaderboard/?benchmark=knowledge); LiveBench 75.8 overall /
  56.5 agentic coding / $0.131 per successful task — the token-efficiency claim shows
  up as the lowest cost-per-task among the $2-class models (https://livebench.ai);
  AA index 56 (https://artificialanalysis.ai/models/grok-4-5).
- Reasoning effort low/medium/high (default high); tools incl. function calling +
  server-side web/X search + code execution; **no published per-effort deltas**
  (https://docs.x.ai/developers/grok-4-5).
- Pricing: $2/$6 on OpenRouter (500K ctx); xAI direct doubles to $4/$12 for prompts
  ≥200K tokens — watch long-context orchestrator transcripts
  (https://docs.x.ai/developers/models).

### 4h. Qwen3.8 Max (`qwen/qwen3.8-max`)

- Announced 2026-08-02 ("A New Bar for Coding and Cowork"), live on QwenCloud Aug 3;
  2.4T MoE / 95B active, 1M ctx, hybrid thinking default-on; first Qwen-Max-class
  model with **open weights promised** ("next week" as of the post)
  (https://qwen.ai/blog?id=qwen3.8, https://docs.qwencloud.com/changelog/models).
  Marquee demos are exactly our workload shape: multi-week autonomous repo
  maintenance (265 commits / 127 PRs / 151 issues on oh-my-cli) and a ~125-hour
  autonomous research reproduction (https://qwen.ai/blog?id=qwen3.8).
- Provider-published: Terminal-Bench 2.1 **86.6** (Claude Code harness, avg@10);
  Toolathlon-Verified 72.5; OSWorld-Verified **86.1 — above Fable 5's 85.0**;
  SWE-bench Pro 67.7; DeepSWE 1.1 56.6; IFBench 82.8 (https://qwen.ai/blog?id=qwen3.8).
  tau2, BFCL, SWE-bench Verified: not published for 3.8 (the *3.7-Max* post
  self-reported BFCL-V4 75.0 — matching the top of the BenchLM BFCL mirror —
  and SWE-V 80.4, https://qwen.ai/blog?id=qwen3.7).
- Independently verified — the strongest agentic profile of all ten candidates:
  **Sierra τ³-Banking rank 1 (55.2%, reasoning xhigh)** — ahead of Claude Opus 5
  (https://taubench.com/leaderboard/?benchmark=knowledge); **LiveBench Agentic Coding
  64.6 — best of all 38 models on the board**, overall 78.5, IF 74.1 (top of the
  candidate set), $0.275/successful task (https://livebench.ai); AA index 58 — #2
  candidate behind K3 (https://artificialanalysis.ai/models).
- Reasoning: `reasoning_effort` xhigh (default)/medium/low; **`preserve_thinking`
  enabled by default for all workloads** — i.e. Qwen ships the interleaved-thinking
  behavior MiniMax showed is critical, as the default (https://qwen.ai/blog?id=qwen3.8).
  No published per-effort deltas. AA notes it is "very verbose"
  (https://artificialanalysis.ai/models/qwen3-8-max).
- Pricing: $2/$6 confirmed (OpenRouter + QwenCloud; cache reads $0.25)
  (https://openrouter.ai/qwen/qwen3.8-max, https://www.qwencloud.com/models/qwen3.8-max).

### 4i. Qwen3.7 Flash (`qwen/qwen3.7-flash`)

- Released 2026-07-25 (IDs `qwen3.7-flash` / `-2026-07-15`); a native
  vision-language Flash model with "upgraded multimodal agent capabilities for Search
  Agent and CI Agent scenarios" (https://docs.qwencloud.com/changelog/models). No
  dedicated release blog.
- Benchmarks: **none published anywhere** — no provider numbers on the changelog or
  model page, and absent from BFCL V4, Terminal-Bench 2.1, SWE-bench Verified,
  Sierra τ²/τ³, and LiveBench (all checked 2026-08-08;
  https://www.qwencloud.com/models/qwen3.7-flash and the leaderboard URLs cited in §1).
  **Zero evidence basis for a reviewer role beyond price.**
- Thinking toggleable (`enable_thinking`); function calling + built-in tools; 1M ctx
  (https://www.qwencloud.com/models/qwen3.7-flash).
- Pricing: $0.03/$0.13 is the 0–32K input tier; rises to $0.10/$0.40 (32K–256K) and
  $0.20/$0.80 (256K–1M) (https://docs.qwencloud.com/developer-guides/getting-started/pricing).

### 4j. Claude Haiku 4.5 (`anthropic/claude-haiku-4.5`) — reference point

- Released 2025-10-15; "fastest and most efficient model, delivering near-frontier
  intelligence" (https://www.anthropic.com/news/claude-haiku-4-5).
- Provider-published: SWE-bench Verified 73.3% (50-trial avg, 128K thinking);
  **tau2-bench Retail 83.2 / Airline 63.6 / Telecom 83.0** (10-run avg, 128K
  thinking) — the only candidate with provider-published tau2 splits; Terminal-Bench
  41.0; OSWorld 50.7 (https://www.anthropic.com/news/claude-haiku-4-5).
- Independently verified: **BFCL V4 rank 6 (68.7 overall), lowest mean latency in the
  top 10 (1.68s)** (https://gorilla.cs.berkeley.edu/leaderboard.html); swebench.com
  common-harness (mini-SWE-agent v2): 66.60% at $0.33/run (https://www.swebench.com/).
  Not on LiveBench 2026-06-25 or Terminal-Bench 2.1. AA index 30 — the index is now
  dominated by long-horizon evals where a 10-month-old efficiency model trails.
- Thinking A/B (provider-published): Terminal-Bench **40.21 without thinking vs 41.75
  with a 32K budget** — a modest +1.5 (https://www.anthropic.com/news/claude-haiku-4-5).
- Pricing: $1/$5, 200K ctx — the smallest context in the candidate set
  (https://openrouter.ai/anthropic/claude-haiku-4.5).

---

## 5. Does reasoning/thinking effort change tool-calling reliability?

Yes — three independent published datapoints, all pointing the same way, plus one
counterpoint:

1. **Same-model A/B on the BFCL V4 primary board:** Grok-4.1-fast **reasoning 69.57
   vs non-reasoning 58.29 overall** (+11.3 pts). The gap concentrates exactly in the
   agentic sub-columns: Memory 53.98 vs 26.24, Multi-turn 58.87 vs 46.75
   (https://gorilla.cs.berkeley.edu/leaderboard.html, table of 2026-04-12).
2. **MiniMax (provider-published, M2 tech note):** retaining the thinking state
   between tool calls ("interleaved thinking") vs discarding it: **tau2-bench 87 vs
   64 (+23)**, BrowseComp 44.0 vs 31.4, GAIA 75.7 vs 67.9, SWE-bench Verified 69.4 vs
   67.2. Their guidance: persist reasoning content across tool-call turns or agentic
   reliability collapses (https://www.minimax.io/news/why-is-interleaved-thinking-important-for-m2).
   Directly actionable for us: **when running MiniMax through an orchestrator, the
   harness must pass `reasoning_details` back between steps.**
3. **DeepSeek's mode ablations (the only candidate vendor publishing full
   Non-Think/High/Max tables):**
   - V4 Pro model card (Non-Think | High | Max): Terminal-Bench 2.0 **59.1 | 63.3 |
     67.9**; SWE-bench Verified **73.6 | 79.4 | 80.6**; MCPAtlas 69.4 | **74.2 |
     73.6** (High beats Max on MCP tool use); Toolathlon 46.3 | 49.0 | 51.8
     (https://huggingface.co/deepseek-ai/DeepSeek-V4-Pro).
   - V4 Flash Preview tech report Table 7: SWE-V 73.7 / 78.6 / 79.0; Terminal-Bench
     2.0 49.1 / 56.6 / 56.9; MCPAtlas 64.0 / 67.4 / 69.0; BrowseComp jumps 53.5 →
     73.2 from High→Max (https://arxiv.org/pdf/2606.19348, p. 39).
   - Pattern: Non-Think→High is worth +5–8 points on agentic/tool tasks; High→Max is
     marginal except on browse/search-heavy tasks. AA corroborates at the index
     level: V4 Flash 0731 scores 52 with max reasoning vs 29 as the non-reasoning
     variant (https://artificialanalysis.ai/models/deepseek-v4-flash,
     https://artificialanalysis.ai/models/deepseek-v4-flash-non-reasoning).
4. **Counterpoints — thinking is not free or uniformly positive:**
   - On BFCL's *agentic* split, DeepSeek V3.2-Exp scores **higher without thinking**:
     FC 61.85 vs Prompt+Thinking 51.04 (https://gorilla.cs.berkeley.edu/data_agentic.csv).
   - arXiv 2602.07796 ("Thinking Makes LLM Agents Introverted") finds mandatory
     thinking can *degrade* user-engaged agent performance on τ-Retail / τ-Airline
     (https://arxiv.org/pdf/2602.07796). Thinking reliably helps long-horizon tool
     orchestration; it can hurt chatty dual-control tasks. A PR-review orchestrator
     is the former type.
   - GLM-5.2 and MiniMax M3 expose thinking toggles but publish **no on/off deltas**
     (https://github.com/zai-org/GLM-5, https://huggingface.co/MiniMaxAI/MiniMax-M3);
     a circulating "GLM high ≈ 95% of max at 50% tokens" claim could not be verified
     on any primary page.
   - Haiku 4.5's published A/B is nearly flat on short-horizon terminal work:
     Terminal-Bench 40.21 without thinking vs 41.75 with a 32K budget
     (https://www.anthropic.com/news/claude-haiku-4-5).
5. **Vendors are converging on the MiniMax lesson:** Qwen3.8 Max ships
   `preserve_thinking` (carry reasoning across tool turns) **enabled by default for
   all workloads** (https://qwen.ai/blog?id=qwen3.8), and Grok 4.5 / Kimi K3 default
   to their highest reasoning effort (https://docs.x.ai/developers/grok-4-5,
   https://huggingface.co/moonshotai/Kimi-K3).

Also relevant: Kimi K3 cannot be run without thinking at all ("always has thinking
enabled"; `reasoning_effort` low/high/max, default max — only max was live at launch,
and Moonshot publishes no per-effort benchmark deltas)
(https://huggingface.co/moonshotai/Kimi-K3, https://platform.kimi.ai/docs/guide/use-reasoning-effort,
https://simonwillison.net/2026/Jul/16/kimi-k3/).

**Takeaway:** for this workload, prefer thinking-enabled variants/modes, and make sure
the Flue harness preserves reasoning content across tool-call rounds (this matters
most for MiniMax M3, and is free reliability for every hybrid model).

---

## 6. OpenRouter serving facts (fetched 2026-08-08 from `/api/v1/models`)

| Model ID | Context | $/M in | $/M out |
|---|---|---|---|
| moonshotai/kimi-k2.6 | 262,144 | 0.5795 | 2.44 |
| moonshotai/kimi-k3 | 1,048,576 | 3.00 | 15.00 |
| x-ai/grok-4.5 | 500,000 | 2.00 | 6.00 |
| deepseek/deepseek-v4-flash-0731 | 1,048,576 | 0.09 | 0.18 |
| deepseek/deepseek-v4-pro | 1,048,576 | 0.435 | 0.87 |
| z-ai/glm-5.2 | 1,048,576 | 0.182 | 0.572 |
| qwen/qwen3.8-max | 1,000,000 | 2.00 | 6.00 |
| qwen/qwen3.7-flash | 1,000,000 | 0.03 | 0.13 |
| minimax/minimax-m3 | 1,048,576 | 0.30 | 1.20 |
| anthropic/claude-haiku-4.5 | 200,000 | 1.00 | 5.00 |

All user-supplied prices confirmed as the OpenRouter headline, **but three of them are
cheapest-endpoint floors, not what the model "costs"**:

- `glm-5.2` $0.182/$0.572 is the StreamLake floor; Z.AI's own endpoint (and
  Fireworks/Together/Cloudflare) is $1.40/$4.40
  (https://openrouter.ai/api/v1/models/z-ai/glm-5.2/endpoints).
- `kimi-k2.6` $0.5795/$2.44 is a discounted Baidu endpoint ("39% off"); other
  endpoints run to $1.20/$4.60; Moonshot's platform lists $0.95/$4.00
  (https://openrouter.ai/api/v1/models/moonshotai/kimi-k2.6/endpoints,
  https://platform.kimi.ai/docs/pricing/chat-k26).
- `deepseek-v4-pro`'s API row ($0.435/$0.87) is DeepSeek first-party; the page
  headline is a $0.1096/$0.2192 discount endpoint; premium hosts are $1.74/$3.48
  (https://openrouter.ai/api/v1/models/deepseek/deepseek-v4-pro/endpoints).
- DeepSeek has stated it plans to **raise** first-party prices "in the near future"
  (https://api-docs.deepseek.com/quick_start/pricing/).

`glm-5.2` and `kimi-k2.6` additionally expose `parallel_tool_calls`; all ten expose
`reasoning`/`include_reasoning`. Tool support can differ per endpoint (e.g. Kimi K3
tools work on the Moonshot endpoint but not DeepInfra's) — pin providers in
production. (Source: https://openrouter.ai/api/v1/models, retrieved 2026-08-08;
per-model endpoint lists as cited.)

---

## 7. Price-performance and role recommendations

Two cost lenses matter more than list price: LiveBench's measured **cost per
successful task** (captures verbosity/reasoning overhead under a uniform harness,
https://livebench.ai) and AA's **cost to run its index** (long-horizon agentic mix,
https://artificialanalysis.ai/models). Both are cited per row above; the synthesis:

| Model | $/M in/out (OpenRouter) | LiveBench agentic coding | LiveBench $/successful task | AA index ($/task) |
|---|---|---|---|---|
| Qwen3.8 Max | 2.00 / 6.00 | **64.6** | $0.275 | 58 (—) |
| Kimi K3 | 3.00 / 15.00 | 62.2 | $0.348 | **60** ($0.84) |
| Grok 4.5 | 2.00 / 6.00 | 56.5 | **$0.131** | 56 ($0.36) |
| GLM-5.2 | 0.182 / 0.572 (floor; $1.40/$4.40 first-party) | 51.8 | $0.225 | 53 ($0.31) |
| Kimi K2.6 (incumbent) | 0.5795 / 2.44 | 46.9 | $0.169 | — |
| DeepSeek V4 Flash 0731 | 0.09 / 0.18 | 46.8 | $0.060 | 52 (**$0.03**) |
| DeepSeek V4 Pro | 0.435 / 0.87 (first-party) | 42.6 | $0.050 | — |
| MiniMax M3 | 0.30 / 1.20 | 40.7 | $0.060 | 45 ($0.14) |
| Qwen3.7 Flash | 0.03 / 0.13 (≤32K tier) | not benchmarked anywhere | — | — |
| Claude Haiku 4.5 | 1.00 / 5.00 | not on LiveBench | — | 30 (—) |

### (a) Lead orchestrator — **Qwen3.8 Max**, with **Kimi K3** as the capability ceiling

- **Qwen3.8 Max** is the best evidence-backed fit for exactly this job description:
  the only candidate with an *independently verified #1* on a policy-following
  tool-use benchmark (Sierra τ³-Banking 55.2%, ahead of Claude Opus 5,
  https://taubench.com/leaderboard/?benchmark=knowledge); the best Agentic Coding
  score of all 38 models on LiveBench (64.6) plus the best instruction-following
  score in the candidate set (74.1) (https://livebench.ai); `preserve_thinking`
  interleaved reasoning on by default (https://qwen.ai/blog?id=qwen3.8); 1M context
  for long review transcripts at $2/$6 (https://openrouter.ai/qwen/qwen3.8-max).
  Risks: five days old at time of writing, provider numbers self-reported, AA calls
  it verbose — cap `max_tokens` and consider `reasoning_effort: medium` for the
  synthesis step.
- **Kimi K3** if we want the strongest open-weights model overall: AA index 60 (#1
  open weights, https://artificialanalysis.ai/models/kimi-k3), independently
  measured SWE-bench Verified 93.4% (https://www.vals.ai/benchmarks/swebench), and
  the only strong MCP-specific number in the set (MCPMark-Verified 94.5,
  https://huggingface.co/moonshotai/Kimi-K3). Despite $3/$15 list, its measured
  LiveBench cost/successful task is only 26% above Qwen's ($0.348 vs $0.275) — but
  always-on max thinking (~4× reasoning-token overhead per Willison's measurement,
  https://simonwillison.net/2026/Jul/16/kimi-k3/) makes it the slowest option, and
  tools don't work on every OpenRouter endpoint (pin Moonshot).
- Grok 4.5 is the honorable mention: the only candidate *verified* on official
  Terminal-Bench 2.1 (79.3%) and by far the most token-efficient ($0.131/task), but
  it trails Qwen on agentic coding (56.5 vs 64.6) and IF, and xAI direct doubles the
  price above 200K-token prompts (https://docs.x.ai/developers/models).
- Versus the incumbent: Kimi K2.6 sits at 46.9 LiveBench agentic vs Qwen's 64.6 and
  55.9 MCPMark vs the Qwen family's 60.8 — the upgrade case is real, not just
  novelty.

### (b) Cheap parallel reviewer subagent — **DeepSeek V4 Flash 0731**, with **GLM-5.2** as the quality upgrade

- **DeepSeek V4 Flash 0731** is the value outlier of the entire field: $0.09/$0.18
  (25× cheaper than the orchestrator picks), yet 74.2 LiveBench overall / 75.0
  coding — above GLM-5.2 overall and within 5 of Kimi K3 — at $0.060 per successful
  task, and the cheapest model on AA's board at $0.03/task
  (https://livebench.ai, https://artificialanalysis.ai/models/deepseek-v4-flash).
  Its modest agentic-coding split (46.8) matters little for bounded single-review
  tasks, and OpenRouter's "Exacto" variant explicitly optimizes tool-calling
  accuracy (https://openrouter.ai/deepseek/deepseek-v4-flash-0731). Run it at
  `reasoning_effort: high` (the published mode tables show Non-Think→High is where
  the agentic gains are; High→Max is marginal, https://arxiv.org/pdf/2606.19348).
  Risk: DeepSeek has announced a first-party price rise
  (https://api-docs.deepseek.com/quick_start/pricing/).
- **GLM-5.2** when review depth matters more than absolute floor cost: the best
  LiveBench *coding* split in the candidate set below the frontier tier (79.7), MCP
  Atlas 76.8 (best of the set), and the only candidate with a verified #1 on AA's
  tau2-telecom (99.1%) (https://livebench.ai, https://benchlm.ai/benchmarks/mcpAtlas,
  https://artificialanalysis.ai/evaluations/tau2-bench). Caveat: the $0.182/$0.572
  price is a discount-endpoint floor — first-party is $1.40/$4.40 — so the value
  case depends on accepting StreamLake-class routing
  (https://openrouter.ai/api/v1/models/z-ai/glm-5.2/endpoints).
- Not recommended for this role: Qwen3.7 Flash (cheapest, but zero published
  benchmarks anywhere — experiment-only); MiniMax M3 (bottom of every measured
  board among the candidates, and requires interleaved-thinking plumbing to work at
  all); Haiku 4.5 (the verified-function-calling, lowest-latency fallback — BFCL
  rank 6, 1.68s mean latency — but 5–10× the cost of Flash 0731 with a weaker 2026
  agentic profile).

### Bottom line

Replace Kimi K2.6 with **Qwen3.8 Max** as the lead orchestrator (fall back to Kimi
K3 if we hit orchestration-quality limits and can absorb latency), and run the
parallel reviewers on **DeepSeek V4 Flash 0731** (upgrade lane: GLM-5.2). At list
prices this configuration costs less per review than the all-K2.6 incumbent setup
whenever reviewer tokens dominate, while moving the orchestrator from mid-pack to
top-of-board on every agentic measure that exists.
