// One switch for gen_ai prompt and response content across all three runtimes
// (server, edge, browser). Both directions default to on: the point of this
// demo is to show real prompts and completions in Sentry.
//
// Next only inlines `NEXT_PUBLIC_*` names into the browser bundle, so
// next.config.ts mirrors the operator-facing pair into that namespace at build
// time and the browser half reads the mirror. Both names are written out as
// static member expressions because the bundler substitutes them literally — a
// computed `process.env[name]` lookup resolves to nothing in the browser.
// Server and edge keep reading the unprefixed names first, so a local restart
// applies a new value. The browser value is inlined at build time, so a
// deployment applies a new value only after a rebuild.

const DISABLED_FLAG_VALUES = new Set(["false", "0", "no", "off"]);

function recordsContent(value: string | undefined): boolean {
  if (value === undefined) return true;
  return !DISABLED_FLAG_VALUES.has(value.trim().toLowerCase());
}

export const GEN_AI_CONTENT_CAPTURE = {
  inputs: recordsContent(
    process.env.SENTRY_AI_RECORD_INPUTS ??
      process.env.NEXT_PUBLIC_SENTRY_AI_RECORD_INPUTS,
  ),
  outputs: recordsContent(
    process.env.SENTRY_AI_RECORD_OUTPUTS ??
      process.env.NEXT_PUBLIC_SENTRY_AI_RECORD_OUTPUTS,
  ),
};
