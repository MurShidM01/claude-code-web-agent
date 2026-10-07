export function createId(prefix = "id"): string {
  const raw =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${raw.replace(/-/g, "").slice(0, 20)}`;
}

export function now(): number {
  return Date.now();
}
