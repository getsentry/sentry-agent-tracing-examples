// Models the assistant is allowed to run, as OpenRouter ids. Sentry refreshes
// its pricing table from OpenRouter, so an id that exists there gets
// gen_ai.cost.* computed server-side; an invented one silently costs nothing.
// Current generation as of 2026-08-12, checked against
// https://openrouter.ai/api/v1/models by release date, not version number.
export const DEMO_MODELS = [
  "anthropic/claude-opus-5", // 2026-07-24 · $5 / $25 per Mtok
  "anthropic/claude-sonnet-5", // 2026-06-30 · $2 / $10
  "openai/gpt-5.6-sol", // 2026-07-09 · $5 / $30
  "openai/gpt-5.6-terra", // 2026-07-09 · $1 / $6
  "openai/gpt-5.6-luna", // 2026-07-09 · $0.10 / $0.60
  "x-ai/grok-4.6", // 2026-08-12 · $2 / $6
  "google/gemini-3.6-flash", // 2026-07-21 · $1.50 / $7.50
] as const;

export type DemoModel = (typeof DEMO_MODELS)[number];

export const DEFAULT_MODEL: DemoModel = "anthropic/claude-sonnet-5";

export function modelById(id: string | null | undefined): string {
  if (DEMO_MODELS.includes(id as DemoModel)) return id as DemoModel;
  return process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL;
}
