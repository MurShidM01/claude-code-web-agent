import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { bundledCatalog } from "@/lib/commands/registry";
import type { CatalogEntry, CommandCatalog } from "@/lib/commands/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const live = await readLiveCatalog();
    return Response.json(live);
  } catch {
    return Response.json(bundledCatalog());
  }
}

async function readLiveCatalog(): Promise<CommandCatalog> {
  const roots = [path.join(process.cwd(), "plugins"), path.join(process.cwd(), ".claude")];
  const commands: CatalogEntry[] = [];
  const skills: CatalogEntry[] = [];
  const agents: CatalogEntry[] = [];
  for (const root of roots) {
    const files = await walk(root);
    for (const file of files) {
      const rel = path.relative(process.cwd(), file);
      const isCommand = /[/\\]commands[/\\][^/\\]+\.md$/.test(rel);
      const isSkill = rel.endsWith("SKILL.md");
      const isAgent = /[/\\]agents[/\\][^/\\]+\.md$/.test(rel);
      if (!isCommand && !isSkill && !isAgent) continue;
      const raw = await readFile(file, "utf8");
      const parsed = parse(raw);
      const plugin = rel.startsWith(`plugins${path.sep}`) ? rel.split(path.sep)[1] : undefined;
      const entry: CatalogEntry = {
        kind: isSkill ? "skill" : isAgent ? "agent" : "command",
        name: parsed.data.name || path.basename(file, ".md"),
        description: parsed.data.description || "Workspace command",
        argumentHint: parsed.data["argument-hint"],
        body: parsed.body.slice(0, 40_000),
        source: rel,
        plugin,
        tools: parsed.data.tools?.split(",").map((item) => item.trim()).filter(Boolean),
      };
      if (isSkill) skills.push(entry);
      else if (isAgent) agents.push(entry);
      else commands.push(entry);
    }
  }
  return { commands, skills, agents };
}

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else files.push(full);
  }
  return files;
}

function parse(raw: string): { data: Record<string, string>; body: string } {
  if (!raw.startsWith("---")) return { data: {}, body: raw };
  const end = raw.indexOf("\n---", 3);
  if (end < 0) return { data: {}, body: raw };
  const data: Record<string, string> = {};
  for (const line of raw.slice(3, end).split("\n")) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (match) data[match[1]!] = match[2]!.replace(/^["']|["']$/g, "");
  }
  return { data, body: raw.slice(end + 4) };
}
