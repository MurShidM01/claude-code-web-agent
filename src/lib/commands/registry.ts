import bundled from "@/content/catalog.json";
import type { CatalogEntry, CommandCatalog } from "@/lib/commands/types";

const TOOL_MAP: Record<string, string> = {
  Read: "Read",
  Write: "Write",
  Edit: "Edit",
  Glob: "Glob",
  Grep: "Grep",
  LS: "LS",
  Bash: "Bash",
  WebFetch: "WebFetch",
  WebSearch: "WebSearch",
  TodoWrite: "TodoWrite",
  NotebookRead: "Read",
  NotebookEdit: "NotebookEdit",
  KillShell: "TaskStop",
  Agent: "Agent",
};

export function bundledCatalog(): CommandCatalog {
  return bundled as CommandCatalog;
}

export function mergeCatalogs(base: CommandCatalog, extra: CommandCatalog): CommandCatalog {
  const merge = (left: CatalogEntry[], right: CatalogEntry[]) => {
    const map = new Map<string, CatalogEntry>();
    for (const item of [...left, ...right]) map.set(`${item.kind}:${item.name}`, item);
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  };
  return {
    commands: merge(base.commands, extra.commands),
    skills: merge(base.skills, extra.skills),
    agents: merge(base.agents, extra.agents),
  };
}

export function findCommand(catalog: CommandCatalog, name: string): CatalogEntry | null {
  const cleaned = name.replace(/^\//, "");
  return catalog.commands.find((command) => command.name === cleaned) ?? null;
}

export function findSkill(catalog: CommandCatalog, name: string): CatalogEntry | null {
  return catalog.skills.find((skill) => skill.name === name) ?? catalog.commands.find((command) => command.name === name) ?? null;
}

export function findAgent(catalog: CommandCatalog, name: string): CatalogEntry | null {
  return catalog.agents.find((agent) => agent.name === name) ?? null;
}

export function mapAgentTools(tools: string[] | undefined): string[] | undefined {
  if (!tools?.length) return undefined;
  const mapped = tools.map((tool) => TOOL_MAP[tool.split("(")[0]!.trim()] ?? tool).filter(Boolean);
  return [...new Set(mapped)];
}

export function expandCommand(entry: CatalogEntry, args: string): string {
  const substituted = entry.body.replace(/!`([^`]+)`/g, (_match, command: string) => {
    return `\nRun this with the Bash tool and use its output before continuing: \`${command.trim()}\`\n`;
  });
  const toolNote = entry.tools?.length
    ? `\n\nFor this command, prefer only these tools: ${entry.tools.join(", ")}. The permission mode still applies.`
    : "";
  return [`The user invoked /${entry.name}${args ? ` ${args}` : ""}.`, `Source: ${entry.source}`, "", substituted, toolNote, args ? `\nArguments: ${args}` : ""]
    .filter(Boolean)
    .join("\n");
}

export function parseSlash(text: string): { name: string; args: string } | null {
  const match = text.match(/^\/([a-zA-Z0-9:_-]+)(?:\s+([\s\S]*))?$/);
  if (!match) return null;
  return { name: match[1]!, args: (match[2] ?? "").trim() };
}
