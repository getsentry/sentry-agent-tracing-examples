import { z } from "zod";

// Models the assistant is allowed to run, as OpenRouter ids. Sentry refreshes
// its pricing table from OpenRouter, so an id listed at
// https://openrouter.ai/api/v1/models gets gen_ai.cost.* computed server-side;
// an invented one silently costs nothing. The prices below are what makes the
// spend split in scripts/scenarios.ts lopsided enough to read as a story.
export const DEMO_MODELS = [
  "anthropic/claude-opus-5", // $5 / $25 per Mtok in/out
  "anthropic/claude-sonnet-5", // $2 / $10
  "openai/gpt-5.6-sol", // $5 / $30
  "openai/gpt-5.6-terra", // $1 / $6
  "openai/gpt-5.6-luna", // $0.10 / $0.60
  "x-ai/grok-4.6", // $2 / $6
  "google/gemini-3.6-flash", // $1.50 / $7.50
] as const;

export type DemoModel = (typeof DEMO_MODELS)[number];

export const DEFAULT_MODEL: DemoModel = "anthropic/claude-sonnet-5";

const demoModel = z.enum(DEMO_MODELS);

// Both the request header and OPENROUTER_MODEL are untrusted strings, so both
// go through the same parse: an id outside the allow-list can never reach
// OpenRouter, where it would silently produce no gen_ai.cost.*.
export function modelById(id: string | null | undefined): DemoModel {
  const requested = demoModel.safeParse(id);
  if (requested.success) return requested.data;

  const configured = demoModel.safeParse(process.env.OPENROUTER_MODEL);
  return configured.success ? configured.data : DEFAULT_MODEL;
}
