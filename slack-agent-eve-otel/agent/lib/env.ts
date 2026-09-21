const DISABLED_FLAG_VALUES = new Set(["false", "0", "no", "off"]);

export function envFlag(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  return !DISABLED_FLAG_VALUES.has(raw.trim().toLowerCase());
}
