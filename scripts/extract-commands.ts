import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CatalogEntry, CommandCatalog } from "../src/lib/commands/types";

const ROOT = process.cwd();
const MAX_BODY = 40_000;

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else files.push(full);
  }
  return files;
}

function parseFrontmatter(raw: string): { data: Record<string, string>; body: string } {
  if (!raw.startsWith("---")) return { data: {}, body: raw };
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return { data: {}, body: raw };
  const header = raw.slice(3, end).trim();
  const body = raw.slice(end + 4).replace(/^\r?\n/, "");
  const data: Record<string, string> = {};
  for (const line of header.split("\n")) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (match) data[match[1]!] = match[2]!.replace(/^["']|["']$/g, "");
  }
  return { data, body };
}

function clip(body: string): string {
  return body.length > MAX_BODY ? `${body.slice(0, MAX_BODY)}\n\n…[command body truncated at ${MAX_BODY} characters]` : body;
}

async function main() {
  const files = [
    ...(await walk(path.join(ROOT, "plugins"))),
    ...(await walk(path.join(ROOT, ".claude"))),
  ];
  const commands: CatalogEntry[] = [];
  const skills: CatalogEntry[] = [];
  const agents: CatalogEntry[] = [];
  const used = new Set<string>();

  for (const file of files) {
    const rel = path.relative(ROOT, file);
    const isCommand = /[/\\]commands[/\\][^/\\]+\.md$/.test(rel);
    const isSkill = rel.endsWith(`${path.sep}SKILL.md`) || rel.endsWith("/SKILL.md");
    const isAgent = /[/\\]agents[/\\][^/\\]+\.md$/.test(rel);
    if (!isCommand && !isSkill && !isAgent) continue;
    const raw = await readFile(file, "utf8");
    const { data, body } = parseFrontmatter(raw);
    const plugin = rel.startsWith("plugins/") ? rel.split("/")[1] : undefined;
    const fallback = path.basename(file, ".md");
    let name = (data.name || fallback).trim();
    if (isCommand && used.has(`command:${name}`)) name = `${plugin ?? "local"}:${name}`;
    const entry: CatalogEntry = {
      kind: isSkill ? "skill" : isAgent ? "agent" : "command",
      name,
      description: data.description || "Workspace command",
      argumentHint: data["argument-hint"],
      body: clip(body),
      source: rel,
      plugin,
      tools: data.tools
        ?.split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    };
    if (isSkill) skills.push(entry);
    else if (isAgent) agents.push(entry);
    else {
      used.add(`command:${name}`);
      commands.push(entry);
    }
  }

  const catalog: CommandCatalog = {
    commands: commands.sort((a, b) => a.name.localeCompare(b.name)),
    skills: skills.sort((a, b) => a.name.localeCompare(b.name)),
    agents: agents.sort((a, b) => a.name.localeCompare(b.name)),
  };
  await writeFile(path.join(ROOT, "src/content/catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`);
  console.log(`Extracted ${commands.length} commands, ${skills.length} skills, ${agents.length} agents.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
