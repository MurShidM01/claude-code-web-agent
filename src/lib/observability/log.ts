export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  level: LogLevel;
  message: string;
  at: number;
  fields?: Record<string, unknown>;
}

type Listener = (entry: LogEntry) => void;

const listeners = new Set<Listener>();
const buffer: LogEntry[] = [];
const SECRET_KEY = /token|secret|password|authorization|credential|cookie/i;

function scrub(value: unknown, depth = 0): unknown {
  if (depth > 4 || value == null) return value;
  if (typeof value === "string") {
    return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  }
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => scrub(item, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_KEY.test(key) ? "[redacted]" : scrub(item, depth + 1);
    }
    return out;
  }
  return value;
}

function write(level: LogLevel, message: string, fields?: Record<string, unknown>) {
  const entry: LogEntry = {
    level,
    message,
    at: Date.now(),
    fields: fields ? (scrub(fields) as Record<string, unknown>) : undefined,
  };
  buffer.push(entry);
  if (buffer.length > 200) buffer.shift();
  for (const listener of listeners) listener(entry);
  if (level === "error") console.error(`[kiln] ${message}`, entry.fields ?? "");
  else if (level === "warn") console.warn(`[kiln] ${message}`);
}

export const log = {
  debug: (message: string, fields?: Record<string, unknown>) => write("debug", message, fields),
  info: (message: string, fields?: Record<string, unknown>) => write("info", message, fields),
  warn: (message: string, fields?: Record<string, unknown>) => write("warn", message, fields),
  error: (message: string, fields?: Record<string, unknown>) => write("error", message, fields),
  recent: () => [...buffer],
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
