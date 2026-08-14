import { z } from "zod";

// Models the assistant is allowed to run, as OpenRouter ids. Sentry refreshes
// its pricing table from OpenRouter, so an id listed at
// https://openrouter.ai/api/v1/models gets gen_ai.cost.* computed server-side;
// an invented one silently costs nothing.
export const SUPPORTED_MODELS = [
  "anthropic/claude-opus-5",
  "anthropic/claude-sonnet-5",
  "openai/gpt-5.6-sol",
  "openai/gpt-5.6-terra",
  "openai/gpt-5.6-luna",
  "x-ai/grok-4.6",
  "google/gemini-3.6-flash",
] as const;

export type SupportedModel = (typeof SUPPORTED_MODELS)[number];

export const DEFAULT_MODEL: SupportedModel = "anthropic/claude-sonnet-5";

const supportedModel = z.enum(SUPPORTED_MODELS);

// OPENROUTER_MODEL is an untrusted string, so it goes through a parse: an id
// outside the allow-list can never reach OpenRouter, where it would silently
// produce no gen_ai.cost.*.
export function resolveModel(): SupportedModel {
  const configured = supportedModel.safeParse(process.env.OPENROUTER_MODEL);
  return configured.success ? configured.data : DEFAULT_MODEL;
}
