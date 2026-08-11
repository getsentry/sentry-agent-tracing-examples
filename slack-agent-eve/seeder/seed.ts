/**
 * Mealbot spend seeder — fixture telemetry for the "LLM spend per user"
 * dashboard demo.
 *
 *   node --env-file=.env.local seeder/seed.ts --dry-run --days 4
 *   node --env-file=.env.local seeder/seed.ts --days 4 --spike
 *   node --env-file=.env.local seeder/seed.ts            # small burst, last 3h
 *
 * --days N backfills N days before today plus today; capped at 4 because
 * Relay hard-drops transactions older than 5 days (see engine.ts header).
 * --spike adds one runaway retry-storm conversation two days back (or the
 * oldest seeded day), giving the anomaly alert something to fire on.
 * Every span carries demo.seed_run:<run-id> so a bad batch is identifiable
 * in Explore; reruns with the same --seed are deterministic apart from it.
 */
import { parseArgs } from "node:util";
import * as Sentry from "@sentry/node";
import { PERSONAS } from "./personas.ts";
import { mulberry32, planDay, runConversation, runSpike, type SpendSample } from "./engine.ts";

const { values: args } = parseArgs({
  options: {
    days: { type: "string", default: "0" },
    // Regenerate a sub-range of days (inclusive, in days-back terms) without
    // duplicating the rest — for re-sending a partially rate-limited run.
    "only-days-back": { type: "string" },
    seed: { type: "string" },
    spike: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    environment: { type: "string", default: "development" },
  },
});

const days = Math.min(Number(args.days), 4);
const onlyDaysBack = args["only-days-back"]
  ? args["only-days-back"].split("-").map(Number)
  : null;
const dayIncluded = (back: number) =>
  !onlyDaysBack || (back <= Math.max(...onlyDaysBack) && back >= Math.min(...onlyDaysBack));
const dryRun = args["dry-run"];
// Default to a time-derived seed so a rerun never replays the same rng
// stream — same-seed reruns mint near-identical conversations at shifted
// timestamps, which read as duplicate rows in conversation tables (observed
// 2026-08-08 after seeding the same day three times). Pass --seed to
// reproduce a specific plan deliberately.
const seedNum = args.seed ? Number(args.seed) : Date.now() % 2147483647;
const rng = mulberry32(seedNum);
const seedRun = `seed-${seedNum}-${new Date()
  .toISOString()
  .slice(0, 16)
  .replace(/[-:T]/g, "")}`;
const now = Date.now() / 1000;

if (!dryRun) {
  if (!process.env.SENTRY_DSN) {
    console.error("SENTRY_DSN not set — run with --env-file=.env.local");
    process.exit(1);
  }
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: args.environment,
    debug: Boolean(process.env.SEED_DEBUG),
    tracesSampleRate: 1.0,
    // Keep each turn's gen_ai spans inside its transaction envelope: one
    // ingestion path (the one with the documented 5-day backdating window)
    // instead of transaction + streamed-span halves that could land
    // inconsistently when backdated.
    streamGenAiSpans: false, // segment export, matching the agent
    defaultIntegrations: false,
  });
}

const samples: SpendSample[] = [];
let sentSinceFlush = 0;

// A single flush of ~200 backdated transactions trips Relay's rate limiting
// and the SDK then silently drops the rest of the queue (observed live
// 2026-08-08: days 3-4 of a --days 4 run never arrived). Draining every few
// conversations keeps the send rate under the limit.
async function pace(): Promise<void> {
  sentSinceFlush += 1;
  if (dryRun || sentSinceFlush < 10) return;
  sentSinceFlush = 0;
  await Sentry.flush(15_000);
  await new Promise((resolve) => setTimeout(resolve, 2_000));
}

for (let back = days; back >= 0; back--) {
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  dayStart.setDate(dayStart.getDate() - back);

  for (const persona of PERSONAS) {
    const times =
      back === 0 && days === 0
        ? // No-args mode: a light burst over the last three hours.
          planDay(rng, persona, dayStart)
            .slice(0, 2)
            .map((_, i) => now - (3 - i) * 3600 * (0.4 + rng() * 0.5))
        : planDay(rng, persona, dayStart);
    for (const startSec of times) {
      if (!dayIncluded(back)) continue; // still consume rng so plans stay stable
      if (startSec > now - 900) continue; // today's tail: stay clear of "now"
      if (startSec < now - 4.75 * 86400) continue; // Relay's 5-day drop window
      // In --dry-run Sentry.init never ran, so the span calls inside are
      // no-ops but the token/spend model still runs — projections stay honest.
      samples.push(runConversation({ rng, persona, startSec, seedRun }));
      await pace();
    }
  }

  // The anomaly story lands two days back (or as far back as we seeded), at
  // 12:40 — right in the lunch rush.
  if (args.spike && back === Math.min(2, days) && dayIncluded(back)) {
    const spikeStart = dayStart.getTime() / 1000 + 12.66 * 3600;
    if (spikeStart < now - 900) {
      samples.push(runSpike({ rng, persona: PERSONAS[0], startSec: spikeStart, seedRun }));
      await pace();
    }
  }
}

function tabulate(rows: Map<string, { usd: number; tokens: number; convos: number }>): void {
  const sorted = [...rows.entries()].sort((a, b) => b[1].usd - a[1].usd);
  for (const [key, v] of sorted) {
    console.log(
      `  ${key.padEnd(34)} $${v.usd.toFixed(2).padStart(7)}  ${String(v.tokens).padStart(9)} tok  ${v.convos} convos`,
    );
  }
}

const byUser = new Map<string, { usd: number; tokens: number; convos: number }>();
const byModel = new Map<string, { usd: number; tokens: number; convos: number }>();
const byDay = new Map<string, { usd: number; tokens: number; convos: number }>();
for (const s of samples) {
  for (const [map, key] of [
    [byUser, s.user],
    [byModel, s.model],
    [byDay, s.day],
  ] as const) {
    const row = map.get(key) ?? { usd: 0, tokens: 0, convos: 0 };
    row.usd += s.projectedUsd;
    row.tokens += s.inputTokens + s.outputTokens;
    row.convos += 1;
    map.set(key, row);
  }
}

const total = samples.reduce((sum, s) => sum + s.projectedUsd, 0);
console.log(`\n${dryRun ? "[dry-run] " : ""}run ${seedRun}: ${samples.length} conversations`);
console.log(`projected spend (client-side estimate; Sentry prices server-side): $${total.toFixed(2)}\n`);
console.log("by user:");
tabulate(byUser);
console.log("\nby model:");
tabulate(byModel);
console.log("\nby day:");
tabulate(byDay);

if (!dryRun) {
  console.log("\nflushing to Sentry…");
  const flushed = await Sentry.flush(30_000);
  console.log(flushed ? "flushed." : "flush timed out — some envelopes may not have sent.");
}
