export interface CatalogEntry {
  kind: "command" | "skill" | "agent";
  name: string;
  description: string;
  argumentHint?: string;
  body: string;
  source: string;
  plugin?: string;
  tools?: string[];
}

export interface CommandCatalog {
  commands: CatalogEntry[];
  skills: CatalogEntry[];
  agents: CatalogEntry[];
}
