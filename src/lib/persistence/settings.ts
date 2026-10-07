import type { PermissionMode } from "@/lib/permissions/types";

export type ThemePreference = "light" | "dark" | "system";

export interface Settings {
  theme: ThemePreference;
  defaultPermissionMode: PermissionMode;
  temperature: number | null;
  maxTokens: number | null;
  maxIterations: number;
  commandTimeoutMs: number;
  extraDenyPatterns: string[];
  bridgePort: number;
  bridgeHost: string;
  persistenceEnabled: boolean;
  outputLimitChars: number;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  defaultPermissionMode: "ask",
  temperature: null,
  maxTokens: null,
  maxIterations: 24,
  commandTimeoutMs: 120_000,
  extraDenyPatterns: [],
  bridgePort: 3939,
  bridgeHost: "127.0.0.1",
  persistenceEnabled: true,
  outputLimitChars: 24_000,
};

export const THEME_STORAGE_KEY = "kiln.theme";

export function resolveTheme(theme: ThemePreference, systemDark: boolean): "light" | "dark" {
  if (theme === "system") return systemDark ? "dark" : "light";
  return theme;
}

export function applyTheme(theme: ThemePreference) {
  if (typeof document === "undefined") return;
  const dark = resolveTheme(theme, window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark === "dark");
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Private mode can reject storage. The in-memory setting still applies.
  }
}
