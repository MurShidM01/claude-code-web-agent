const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "build",
  "coverage",
  ".turbo",
  ".cache",
  "out",
  "target",
  "__pycache__",
  ".venv",
  "venv",
]);

export function shouldSkipDir(name: string): boolean {
  return SKIP_DIRS.has(name) || name === ".kiln";
}

export class PathEscapeError extends Error {
  constructor(readonly input: string) {
    super(`Path escapes the workspace root: ${input}`);
    this.name = "PathEscapeError";
  }
}

function isAbs(value: string): boolean {
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value);
}

export function normalizePath(value: string): string {
  const slash = value.replace(/\\/g, "/");
  const absolute = isAbs(slash);
  const parts = slash.split("/");
  const stack: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (stack.length && stack[stack.length - 1] !== "..") stack.pop();
      else if (!absolute) stack.push("..");
      continue;
    }
    stack.push(part);
  }
  const prefix = absolute ? (slash.startsWith("/") ? "/" : `${parts[0]}/`) : "";
  if (absolute && /^[A-Za-z]:$/.test(parts[0] ?? "")) {
    return `${parts[0]}/${stack.slice(1).join("/")}`;
  }
  return `${prefix}${stack.join("/")}` || (absolute ? "/" : ".");
}

export function resolveInRoot(root: string, input: string): string {
  const base = normalizePath(root);
  const target = isAbs(input) ? normalizePath(input) : normalizePath(`${base}/${input || "."}`);
  const baseWith = base.endsWith("/") ? base : `${base}/`;
  if (target !== base && !target.startsWith(baseWith)) {
    throw new PathEscapeError(input || ".");
  }
  return target;
}

export function relativeToRoot(root: string, absolute: string): string {
  const base = normalizePath(root);
  const target = normalizePath(absolute);
  if (target === base) return ".";
  const prefix = base.endsWith("/") ? base : `${base}/`;
  if (!target.startsWith(prefix)) return target;
  return target.slice(prefix.length);
}

export function matchGlob(pattern: string, filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\.\//, "");
  const expression = globToRegExp(pattern.replace(/\\/g, "/"));
  return expression.test(normalized) || expression.test(normalized.split("/").pop() ?? normalized);
}

function globToRegExp(pattern: string): RegExp {
  let source = "";
  let i = 0;
  while (i < pattern.length) {
    const char = pattern[i];
    if (char === "*" && pattern[i + 1] === "*") {
      if (pattern[i + 2] === "/") {
        source += "(?:.*/)?";
        i += 3;
        continue;
      }
      source += ".*";
      i += 2;
      continue;
    }
    if (char === "*") {
      source += "[^/]*";
      i += 1;
      continue;
    }
    if (char === "?") {
      source += "[^/]";
      i += 1;
      continue;
    }
    if (".+^${}()|[]\\".includes(char ?? "")) source += `\\${char}`;
    else source += char;
    i += 1;
  }
  return new RegExp(`^${source}$`, "i");
}

export function languageFromPath(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    mjs: "javascript",
    cjs: "javascript",
    py: "python",
    rb: "ruby",
    go: "go",
    rs: "rust",
    java: "java",
    json: "json",
    md: "markdown",
    yml: "yaml",
    yaml: "yaml",
    css: "css",
    html: "html",
    sh: "bash",
    bash: "bash",
    sql: "sql",
    xml: "xml",
    toml: "toml",
  };
  return map[ext] ?? (ext || "text");
}
