import type { PermissionMode } from "@/lib/permissions/types";
import type { CustomModelEntry, ModelOverride, ProviderAccount, SettingsTab } from "@/lib/providers/types";

export type ThemePreference = "light" | "dark" | "system";
export type { SettingsTab };

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
  /** Session switches. The composer icons flip these. */
  reasoningEnabled: boolean;
  streamingEnabled: boolean;
  visionEnabled: boolean;
  toolsEnabled: boolean;
  providers: ProviderAccount[];
  modelOverrides: ModelOverride[];
  customModels: CustomModelEntry[];
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
  reasoningEnabled: true,
  streamingEnabled: true,
  visionEnabled: true,
  toolsEnabled: true,
  providers: [],
  modelOverrides: [],
  customModels: [],
};

export const THEME_STORAGE_KEY = "kiln.theme";

export function normalizeSettings(raw: Partial<Settings> | null | undefined): Settings {
  const source = raw && typeof raw === "object" ? raw : {};
  const theme = source.theme === "light" || source.theme === "dark" || source.theme === "system" ? source.theme : DEFAULT_SETTINGS.theme;
  const mode = source.defaultPermissionMode === "ask" || source.defaultPermissionMode === "auto-edit" || source.defaultPermissionMode === "full"
    ? source.defaultPermissionMode
    : DEFAULT_SETTINGS.defaultPermissionMode;
  return {
    theme,
    defaultPermissionMode: mode,
    temperature: typeof source.temperature === "number" && Number.isFinite(source.temperature) ? source.temperature : null,
    maxTokens: typeof source.maxTokens === "number" && source.maxTokens > 0 ? source.maxTokens : null,
    maxIterations: clampInt(source.maxIterations, 1, 48, DEFAULT_SETTINGS.maxIterations),
    commandTimeoutMs: clampInt(source.commandTimeoutMs, 1_000, 600_000, DEFAULT_SETTINGS.commandTimeoutMs),
    extraDenyPatterns: Array.isArray(source.extraDenyPatterns) ? source.extraDenyPatterns.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [],
    bridgePort: clampInt(source.bridgePort, 1, 65535, DEFAULT_SETTINGS.bridgePort),
    bridgeHost: typeof source.bridgeHost === "string" && source.bridgeHost.trim() ? source.bridgeHost.trim() : DEFAULT_SETTINGS.bridgeHost,
    persistenceEnabled: source.persistenceEnabled !== false,
    outputLimitChars: clampInt(source.outputLimitChars, 1_000, 200_000, DEFAULT_SETTINGS.outputLimitChars),
    reasoningEnabled: source.reasoningEnabled !== false,
    streamingEnabled: source.streamingEnabled !== false,
    visionEnabled: source.visionEnabled !== false,
    toolsEnabled: source.toolsEnabled !== false,
    providers: Array.isArray(source.providers) ? source.providers.filter(isAccount) : [],
    modelOverrides: Array.isArray(source.modelOverrides) ? source.modelOverrides.filter(isOverride) : [],
    customModels: Array.isArray(source.customModels) ? source.customModels.filter(isCustomModel) : [],
  };
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function isAccount(value: unknown): value is ProviderAccount {
  if (!value || typeof value !== "object") return false;
  const record = value as ProviderAccount;
  return typeof record.id === "string" && (record.kind === "openai-codex" || record.kind === "kiro" || record.kind === "custom") && typeof record.label === "string";
}

function isOverride(value: unknown): value is ModelOverride {
  return Boolean(value && typeof value === "object" && typeof (value as ModelOverride).key === "string");
}

function isCustomModel(value: unknown): value is CustomModelEntry {
  if (!value || typeof value !== "object") return false;
  const record = value as CustomModelEntry;
  return typeof record.id === "string" && typeof record.providerId === "string";
}

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
