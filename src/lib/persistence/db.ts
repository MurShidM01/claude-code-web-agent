import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { PermissionMode } from "@/lib/permissions/types";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/persistence/settings";

export interface PersistedBlock {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
}

export interface PersistedConversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  workspaceId: string | null;
  workspaceLabel: string | null;
  permissionMode: PermissionMode;
  modelId: string | null;
  provider: string | null;
  blocks: PersistedBlock[];
}

export interface PersistedWorkspace {
  id: string;
  label: string;
  root: string | null;
  kind: "bridge" | "fsa" | "none";
  permissionMode: PermissionMode;
  modelId: string | null;
  provider: string | null;
  updatedAt: number;
}

interface KilnDB extends DBSchema {
  settings: { key: string; value: Settings };
  conversations: { key: string; value: PersistedConversation; indexes: { "by-updated": number } };
  workspaces: { key: string; value: PersistedWorkspace };
  handles: { key: string; value: FileSystemDirectoryHandle };
}

export interface Persistence {
  loadSettings(): Promise<Settings>;
  saveSettings(settings: Settings): Promise<void>;
  listConversations(): Promise<PersistedConversation[]>;
  saveConversation(conversation: PersistedConversation): Promise<void>;
  deleteConversation(id: string): Promise<void>;
  saveWorkspace(workspace: PersistedWorkspace): Promise<void>;
  listWorkspaces(): Promise<PersistedWorkspace[]>;
  saveHandle(id: string, handle: FileSystemDirectoryHandle): Promise<void>;
  loadHandle(id: string): Promise<FileSystemDirectoryHandle | null>;
}

export class MemoryPersistence implements Persistence {
  settings: Settings = { ...DEFAULT_SETTINGS };
  conversations = new Map<string, PersistedConversation>();
  workspaces = new Map<string, PersistedWorkspace>();
  handles = new Map<string, FileSystemDirectoryHandle>();

  async loadSettings() {
    return this.settings;
  }
  async saveSettings(settings: Settings) {
    this.settings = settings;
  }
  async listConversations() {
    return [...this.conversations.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }
  async saveConversation(conversation: PersistedConversation) {
    this.conversations.set(conversation.id, conversation);
  }
  async deleteConversation(id: string) {
    this.conversations.delete(id);
  }
  async saveWorkspace(workspace: PersistedWorkspace) {
    this.workspaces.set(workspace.id, workspace);
  }
  async listWorkspaces() {
    return [...this.workspaces.values()];
  }
  async saveHandle(id: string, handle: FileSystemDirectoryHandle) {
    this.handles.set(id, handle);
  }
  async loadHandle(id: string) {
    return this.handles.get(id) ?? null;
  }
}

export class IndexedDbPersistence implements Persistence {
  private dbPromise: Promise<IDBPDatabase<KilnDB>> | null = null;

  private db() {
    if (!this.dbPromise) {
      this.dbPromise = openDB<KilnDB>("kiln", 1, {
        upgrade(db) {
          db.createObjectStore("settings");
          const conversations = db.createObjectStore("conversations", { keyPath: "id" });
          conversations.createIndex("by-updated", "updatedAt");
          db.createObjectStore("workspaces", { keyPath: "id" });
          db.createObjectStore("handles");
        },
      });
    }
    return this.dbPromise;
  }

  async loadSettings() {
    const db = await this.db();
    return (await db.get("settings", "app")) ?? { ...DEFAULT_SETTINGS };
  }

  async saveSettings(settings: Settings) {
    const db = await this.db();
    await db.put("settings", settings, "app");
  }

  async listConversations() {
    const db = await this.db();
    const all = await db.getAll("conversations");
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async saveConversation(conversation: PersistedConversation) {
    const db = await this.db();
    await db.put("conversations", compactConversation(conversation));
  }

  async deleteConversation(id: string) {
    const db = await this.db();
    await db.delete("conversations", id);
  }

  async saveWorkspace(workspace: PersistedWorkspace) {
    const db = await this.db();
    await db.put("workspaces", workspace);
  }

  async listWorkspaces() {
    const db = await this.db();
    return db.getAll("workspaces");
  }

  async saveHandle(id: string, handle: FileSystemDirectoryHandle) {
    const db = await this.db();
    await db.put("handles", handle, id);
  }

  async loadHandle(id: string) {
    const db = await this.db();
    return (await db.get("handles", id)) ?? null;
  }
}

export function compactConversation(conversation: PersistedConversation): PersistedConversation {
  return {
    ...conversation,
    blocks: conversation.blocks.map((block) => {
      if (block.kind !== "tool" && block.kind !== "diff") return block;
      const payload = { ...block.payload };
      if (typeof payload.stdout === "string" && payload.stdout.length > 4_000) {
        payload.stdout = `${payload.stdout.slice(0, 4_000)}\n…[output trimmed in saved history]`;
      }
      if (typeof payload.stderr === "string" && payload.stderr.length > 2_000) {
        payload.stderr = `${payload.stderr.slice(0, 2_000)}\n…[trimmed]`;
      }
      if (payload.original && typeof payload.original === "string" && payload.original.length > 1_000) {
        payload.original = null;
        payload.revertAvailable = false;
      }
      return { ...block, payload };
    }),
  };
}

export function createPersistence(): Persistence {
  if (typeof indexedDB === "undefined") return new MemoryPersistence();
  return new IndexedDbPersistence();
}
