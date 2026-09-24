// Env-first configuration, so the same file works from local dev to a real
// deployment without edits. Absent vars fall back to demo-friendly defaults.
// Same spellings the other two demos accept, so one documented value turns a
// direction off in every app.
const DISABLED_FLAG_VALUES = new Set(["false", "0", "no", "off"]);

export function envFlag(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  return !DISABLED_FLAG_VALUES.has(raw.trim().toLowerCase());
}

export function envRate(name: string, fallback: number): number {
  const raw = process.env[name];
  // `Number("")` is 0, so an empty assignment would otherwise read as "sample
  // nothing" and silently switch tracing off.
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback;
}
