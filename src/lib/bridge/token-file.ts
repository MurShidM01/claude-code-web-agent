import { readFile } from "node:fs/promises";
import path from "node:path";

export interface BridgeTokenFile {
  version: number;
  host: string;
  port: number;
  token: string;
  code?: string;
  startedAt?: string;
}

export async function readBridgeTokenFile(): Promise<BridgeTokenFile | null> {
  const file = process.env.KILN_BRIDGE_TOKEN_FILE
    ? path.resolve(process.env.KILN_BRIDGE_TOKEN_FILE)
    : path.join(process.cwd(), ".kiln", "bridge.json");
  try {
    const raw = await readFile(file, "utf8");
    const parsed = JSON.parse(raw) as BridgeTokenFile;
    if (!parsed?.token || !parsed.port) return null;
    return parsed;
  } catch {
    return null;
  }
}
