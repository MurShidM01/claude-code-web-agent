import { runAgentTurn, type PermissionAnswer } from "@/lib/agent/loop";
import { buildSystemPrompt, projectInstructionNote } from "@/lib/agent/prompt";
import { bundledCatalog, expandCommand, findAgent, findCommand, findSkill, mapAgentTools, mergeCatalogs, parseSlash } from "@/lib/commands/registry";
import type { CommandCatalog } from "@/lib/commands/types";
import { emptyTranscript, reduceEvent, type Block, type TranscriptState } from "@/lib/events/reducer";
import type { AgentEvent, Phase } from "@/lib/events/types";
import { createId } from "@/lib/id";
import { findModel, type ModelSort } from "@/lib/model/catalog";
import type { ModelCatalog } from "@/lib/model/types";
import { classifyAuthError, loadPuter, PuterModelTransport, type PuterUser } from "@/lib/model/puter";
import type { ModelMessage, ModelTransport } from "@/lib/model/types";
import { log, type LogEntry } from "@/lib/observability/log";
import { addSessionRule } from "@/lib/permissions/engine";
import type { SessionRule } from "@/lib/permissions/types";
import type { PermissionMode } from "@/lib/permissions/types";
import { createPersistence, type PersistedConversation, type Persistence } from "@/lib/persistence/db";
import { applyTheme, DEFAULT_SETTINGS, resolveTheme, type Settings, type ThemePreference } from "@/lib/persistence/settings";
import { createToolRegistry, toolsForSubagent } from "@/lib/tools/builtins";
import { BridgeClient, directTransport, proxiedTransport, type BridgeHealth } from "@/lib/workspace/bridge-client";
import { FileSystemAccessWorkspace, fileSystemAccessSupported } from "@/lib/workspace/fsa";
import { UnavailableWorkspace } from "@/lib/workspace/unavailable";
import type { WorkspacePort } from "@/lib/workspace/types";

export interface ConversationState {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  permissionMode: PermissionMode;
  modelId: string | null;
  provider: string | null;
  workspaceId: string | null;
  transcript: TranscriptState;
  modelMessages: ModelMessage[];
}

export interface AppState {
  booted: boolean;
  settings: Settings;
  sidebarOpen: boolean;
  explorerOpen: boolean;
  paletteOpen: boolean;
  settingsOpen: boolean;
  connectionOpen: boolean;
  previewPath: string | null;
  previewText: string | null;
  previewError: string | null;
  authDialog: { title: string; message: string } | null;
  notice: { title: string; message: string } | null;
  auth: { status: "checking" | "signed-out" | "signing-in" | "signed-in" | "error"; user: PuterUser | null; error?: string };
  models: { status: "idle" | "loading" | "ready" | "error"; catalog: ModelCatalog | null; error?: string; search: string; provider: string; sort: ModelSort };
  bridge: { status: "checking" | "connected" | "unavailable"; transport: "proxy" | "direct" | "none"; health: BridgeHealth | null; error?: string };
  workspace: { id: string | null; label: string | null; root: string | null; kind: "bridge" | "fsa" | "none"; capabilities: string[] };
  conversations: { id: string; title: string; updatedAt: number }[];
  activeId: string | null;
  permission: Extract<AgentEvent, { type: "permission_requested" }> | null;
  running: boolean;
  phase: Phase;
  phaseDetail: string;
  logs: LogEntry[];
  fsaSupported: boolean;
  catalog: CommandCatalog;
}

type Listener = () => void;

export class AppController {
  private listeners = new Set<Listener>();
  private snapshot: AppState;
  private persistence: Persistence;
  private conversations = new Map<string, ConversationState>();
  private sessionRules: SessionRule[] = [];
  private permissionWaiters = new Map<string, (answer: PermissionAnswer) => void>();
  private questionWaiters = new Map<string, (answers: Record<string, string> | null) => void>();
  private abort: AbortController | null = null;
  private bridgeClient: BridgeClient | null = null;
  private directToken: string | null = null;
  private fsa: FileSystemAccessWorkspace | null = null;
  private model: ModelTransport;
  private unsubscribeLog: (() => void) | null = null;

  private pinnedBridge = false;

  constructor(options?: { persistence?: Persistence; model?: ModelTransport; bridge?: BridgeClient }) {
    this.persistence = options?.persistence ?? createPersistence();
    this.model = options?.model ?? new PuterModelTransport();
    if (options?.bridge) {
      this.bridgeClient = options.bridge;
      this.pinnedBridge = true;
    }
    this.snapshot = {
      booted: false,
      settings: { ...DEFAULT_SETTINGS },
      sidebarOpen: true,
      explorerOpen: false,
      paletteOpen: false,
      settingsOpen: false,
      connectionOpen: false,
      previewPath: null,
      previewText: null,
      previewError: null,
      authDialog: null,
      notice: null,
      auth: { status: "checking", user: null },
      models: { status: "idle", catalog: null, search: "", provider: "all", sort: "name" },
      bridge: { status: "checking", transport: "none", health: null },
      workspace: { id: null, label: null, root: null, kind: "none", capabilities: [] },
      conversations: [],
      activeId: null,
      permission: null,
      running: false,
      phase: "understanding",
      phaseDetail: "Ready",
      logs: [],
      fsaSupported: false,
      catalog: bundledCatalog(),
    };
  }

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  private set(patch: Partial<AppState>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.emit();
  }

  private emit() {
    for (const listener of this.listeners) listener();
  }

  async bootstrap() {
    const settings = await this.persistence.loadSettings();
    applyTheme(settings.theme);
    const saved = await this.persistence.listConversations();
    for (const item of saved) {
      this.conversations.set(item.id, {
        id: item.id,
        title: item.title,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        permissionMode: item.permissionMode,
        modelId: item.modelId,
        provider: item.provider,
        workspaceId: item.workspaceId,
        transcript: blocksFromPersisted(item),
        modelMessages: [],
      });
    }
    const active = saved[0];
    const isMobile = typeof window !== "undefined" && window.matchMedia("(max-width: 960px)").matches;
    this.set({
      booted: true,
      settings,
      sidebarOpen: isMobile ? false : this.snapshot.sidebarOpen,
      conversations: summaries(this.conversations),
      activeId: active?.id ?? null,
      fsaSupported: fileSystemAccessSupported(),
      phase: active ? this.conversations.get(active.id)!.transcript.phase : "understanding",
      phaseDetail: active ? this.conversations.get(active.id)!.transcript.phaseDetail : "Ready",
    });
    this.unsubscribeLog = log.subscribe(() => this.set({ logs: log.recent() }));
    await Promise.all([this.refreshAuth(), this.refreshBridge(), this.refreshCatalog(), this.refreshModels()]);
  }

  active(): ConversationState | null {
    return this.snapshot.activeId ? this.conversations.get(this.snapshot.activeId) ?? null : null;
  }

  blocks(): Block[] {
    return this.active()?.transcript.blocks ?? [];
  }

  async refreshAuth() {
    try {
      const puter = await loadPuter();
      if (!puter.auth.isSignedIn()) {
        this.set({ auth: { status: "signed-out", user: null } });
        return;
      }
      const user = await puter.auth.getUser();
      this.set({ auth: { status: "signed-in", user } });
    } catch (error) {
      this.set({ auth: { status: "signed-out", user: null, error: error instanceof Error ? error.message : undefined } });
    }
  }

  async signIn() {
    this.set({ auth: { ...this.snapshot.auth, status: "signing-in", error: undefined }, authDialog: null });
    try {
      const puter = await loadPuter();
      await puter.auth.signIn();
      const user = await puter.auth.getUser();
      this.set({ auth: { status: "signed-in", user } });
      await this.refreshModels();
    } catch (error) {
      const classified = classifyAuthError(error);
      this.set({
        auth: { status: "signed-out", user: null, error: classified.message },
        authDialog: { title: "Could not sign in", message: classified.message },
      });
    }
  }

  async switchAccount() {
    this.set({ auth: { ...this.snapshot.auth, status: "signing-in" }, authDialog: null });
    try {
      const puter = await loadPuter();
      await puter.auth.signIn({ request_auth: true });
      const user = await puter.auth.getUser();
      this.set({ auth: { status: "signed-in", user }, models: { ...this.snapshot.models, catalog: null, status: "idle" } });
      await this.refreshModels();
    } catch (error) {
      const classified = classifyAuthError(error);
      this.set({ authDialog: { title: "Could not switch accounts", message: classified.message }, auth: { ...this.snapshot.auth, status: this.snapshot.auth.user ? "signed-in" : "signed-out", error: classified.message } });
    }
  }

  signOut() {
    try {
      const puter = (window as Window & { puter?: { auth: { signOut(): void } } }).puter;
      puter?.auth.signOut();
    } catch (error) {
      log.warn("sign out failed", { error: error instanceof Error ? error.message : "unknown" });
    }
    this.set({
      auth: { status: "signed-out", user: null },
      models: { ...this.snapshot.models, catalog: null, status: "idle", error: undefined },
    });
  }

  async refreshModels() {
    if (this.snapshot.auth.status !== "signed-in" && !(this.model instanceof PuterModelTransport)) {
      // Tests inject a transport that does not need Puter auth.
    }
    this.set({ models: { ...this.snapshot.models, status: "loading", error: undefined } });
    try {
      const [models, providers] = await Promise.all([
        this.model.listModels(),
        this.model.listProviders().catch(() => [] as string[]),
      ]);
      const catalog = {
        models,
        providers: [...new Set([...providers, ...models.map((model) => model.provider)])].sort(),
        loadedAt: Date.now(),
      };
      const active = this.active();
      const missing = active?.modelId ? !findModel(catalog, active.modelId, active.provider) : false;
      this.set({
        models: { ...this.snapshot.models, status: "ready", catalog, error: missing ? "The previously selected model is no longer in the Puter catalog." : undefined },
      });
      if (missing && active) {
        active.modelId = null;
        this.touch(active);
      }
    } catch (error) {
      this.set({
        models: {
          ...this.snapshot.models,
          status: "error",
          error: error instanceof Error ? error.message : "Could not load models from Puter.",
        },
      });
    }
  }

  setModelQuery(search: string) {
    this.set({ models: { ...this.snapshot.models, search } });
  }

  setModelProvider(provider: string) {
    this.set({ models: { ...this.snapshot.models, provider } });
  }

  setModelSort(sort: ModelSort) {
    this.set({ models: { ...this.snapshot.models, sort } });
  }

  selectModel(modelId: string, provider: string) {
    const conversation = this.ensureConversation();
    conversation.modelId = modelId;
    conversation.provider = provider;
    this.touch(conversation);
    this.persistSoon(conversation);
  }

  setPermissionMode(mode: PermissionMode) {
    const conversation = this.ensureConversation();
    conversation.permissionMode = mode;
    this.touch(conversation);
    this.persistSoon(conversation);
  }

  setTheme(theme: ThemePreference) {
    applyTheme(theme);
    const settings = { ...this.snapshot.settings, theme };
    this.set({ settings });
    void this.persistence.saveSettings(settings);
  }

  updateSettings(patch: Partial<Settings>) {
    const settings = { ...this.snapshot.settings, ...patch };
    if (patch.theme) applyTheme(patch.theme);
    this.set({ settings });
    void this.persistence.saveSettings(settings);
  }

  toggleSidebar() {
    this.set({ sidebarOpen: !this.snapshot.sidebarOpen });
  }

  toggleExplorer() {
    this.set({ explorerOpen: !this.snapshot.explorerOpen });
  }

  setPalette(open: boolean) {
    this.set({ paletteOpen: open });
  }

  setSettingsOpen(open: boolean) {
    this.set({ settingsOpen: open });
  }

  setConnectionOpen(open: boolean) {
    this.set({ connectionOpen: open });
  }

  dismissDialogs() {
    this.set({ authDialog: null, notice: null });
  }

  newConversation() {
    const id = createId("conv");
    const conversation: ConversationState = {
      id,
      title: "New conversation",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      permissionMode: this.snapshot.settings.defaultPermissionMode,
      modelId: this.active()?.modelId ?? null,
      provider: this.active()?.provider ?? null,
      workspaceId: this.snapshot.workspace.id,
      transcript: emptyTranscript(),
      modelMessages: [],
    };
    this.conversations.set(id, conversation);
    this.sessionRules = [];
    this.set({
      activeId: id,
      conversations: summaries(this.conversations),
      phase: "understanding",
      phaseDetail: "Ready",
      permission: null,
    });
    this.persistSoon(conversation);
    return id;
  }

  selectConversation(id: string) {
    const conversation = this.conversations.get(id);
    if (!conversation) return;
    this.set({
      activeId: id,
      phase: conversation.transcript.phase,
      phaseDetail: conversation.transcript.phaseDetail,
      sidebarOpen: typeof window !== "undefined" && window.innerWidth < 960 ? false : this.snapshot.sidebarOpen,
    });
  }

  async deleteConversation(id: string) {
    this.conversations.delete(id);
    await this.persistence.deleteConversation(id);
    const next = [...this.conversations.values()].sort((a, b) => b.updatedAt - a.updatedAt)[0];
    this.set({ activeId: next?.id ?? null, conversations: summaries(this.conversations) });
  }

  async refreshBridge() {
    if (this.pinnedBridge && this.bridgeClient) {
      const health = await this.bridgeClient.health();
      this.set({ bridge: { status: "connected", transport: "direct", health, error: undefined } });
      return;
    }
    this.set({ bridge: { ...this.snapshot.bridge, status: "checking", error: undefined } });
    try {
      const client = new BridgeClient(proxiedTransport());
      const health = await client.health();
      this.bridgeClient = client;
      this.set({ bridge: { status: "connected", transport: "proxy", health, error: undefined } });
      return;
    } catch (error) {
      log.info("colocated bridge unavailable", { error: error instanceof Error ? error.message : "unavailable" });
    }
    if (this.directToken) {
      const ok = await this.tryDirect();
      if (ok) return;
    }
    this.bridgeClient = null;
    this.set({
      bridge: {
        status: "unavailable",
        transport: "none",
        health: null,
        error: "The local execution bridge is not running. Chat still works. File and shell tools need a bridge on this machine, or a folder picked with the File System Access API.",
      },
    });
  }

  async pairDirect(code: string) {
    const host = this.snapshot.settings.bridgeHost;
    const port = this.snapshot.settings.bridgePort;
    try {
      const anonymous = new BridgeClient(directTransport(host, port, ""));
      const paired = await anonymous.pair(code.trim());
      this.directToken = paired.token;
      sessionStorage.setItem("kiln.bridgeToken", paired.token);
      const ok = await this.tryDirect();
      if (!ok) throw new Error("Paired, but the bridge health check failed.");
      this.set({ connectionOpen: false });
    } catch (error) {
      this.set({
        notice: {
          title: "Could not pair with the local bridge",
          message: error instanceof Error ? error.message : "Pairing failed. Check that the bridge is running on this computer and the code matches.",
        },
      });
    }
  }

  private async tryDirect(): Promise<boolean> {
    const token = this.directToken ?? sessionStorage.getItem("kiln.bridgeToken");
    if (!token) return false;
    try {
      const client = new BridgeClient(directTransport(this.snapshot.settings.bridgeHost, this.snapshot.settings.bridgePort, token));
      const health = await client.health();
      this.bridgeClient = client;
      this.directToken = token;
      this.set({ bridge: { status: "connected", transport: "direct", health, error: undefined } });
      return true;
    } catch {
      return false;
    }
  }

  async selectBridgeWorkspace(root: string) {
    if (!this.bridgeClient) {
      this.set({ notice: { title: "Bridge unavailable", message: "Start the local execution bridge, then connect it before choosing a workspace path." } });
      return;
    }
    try {
      const info = await this.bridgeClient.selectWorkspace(root);
      this.fsa = null;
      this.set({
        workspace: {
          id: `bridge:${info.root}`,
          label: info.name,
          root: info.root,
          kind: "bridge",
          capabilities: ["read", "write", "search", "shell", "git", "process"],
        },
        connectionOpen: false,
        explorerOpen: true,
      });
      const active = this.active();
      if (active) {
        active.workspaceId = `bridge:${info.root}`;
        this.touch(active);
      }
    } catch (error) {
      this.set({ notice: { title: "Could not open that workspace", message: error instanceof Error ? error.message : "The bridge rejected the path." } });
    }
  }

  async pickFolder() {
    if (!fileSystemAccessSupported()) {
      this.set({
        notice: {
          title: "This browser cannot pick a local folder",
          message: "The File System Access API is available in Chromium-based browsers. You can still connect the local execution bridge for full shell and git access.",
        },
      });
      return;
    }
    try {
      const handle = await window.showDirectoryPicker({ mode: "readwrite" });
      const permission = handle.requestPermission ? await handle.requestPermission({ mode: "readwrite" }) : "granted";
      if (permission !== "granted") {
        this.set({ notice: { title: "Folder access was not granted", message: "Kiln cannot read or edit that folder without permission." } });
        return;
      }
      this.fsa = new FileSystemAccessWorkspace(handle);
      await this.persistence.saveHandle(handle.name, handle);
      this.set({
        workspace: {
          id: `fsa:${handle.name}`,
          label: handle.name,
          root: handle.name,
          kind: "fsa",
          capabilities: ["read", "write", "search"],
        },
        explorerOpen: true,
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      if (name === "AbortError") return;
      this.set({ notice: { title: "Could not open the folder", message: error instanceof Error ? error.message : "Folder selection failed." } });
    }
  }

  workspacePort(): WorkspacePort {
    if (this.snapshot.workspace.kind === "bridge" && this.bridgeClient?.info()) return this.bridgeClient;
    if (this.snapshot.workspace.kind === "fsa" && this.fsa) return this.fsa;
    return new UnavailableWorkspace();
  }

  async refreshCatalog() {
    try {
      const response = await fetch("/api/catalog");
      if (!response.ok) return;
      const extra = (await response.json()) as CommandCatalog;
      this.set({ catalog: mergeCatalogs(bundledCatalog(), extra) });
    } catch {
      this.set({ catalog: bundledCatalog() });
    }
  }

  async send(text: string, attachments: { name: string; mediaType: string; text?: string; dataUrl?: string }[] = []) {
    const trimmed = text.trim();
    if (!trimmed && !attachments.length) return;
    if (this.snapshot.running) return;
    if (this.snapshot.auth.status !== "signed-in" && this.model instanceof PuterModelTransport) {
      this.set({ authDialog: { title: "Sign in to use a model", message: "Kiln uses your Puter account for model access. Sign in, then choose a model from the live catalog." } });
      return;
    }
    const conversation = this.ensureConversation();
    if (!conversation.modelId || !findModel(this.snapshot.models.catalog, conversation.modelId, conversation.provider)) {
      this.set({
        notice: {
          title: "Choose a model",
          message: this.snapshot.models.error || "Load the Puter catalog and pick a model. Kiln does not fall back to a hardcoded model.",
        },
      });
      return;
    }
    const slash = parseSlash(trimmed);
    let userText = trimmed;
    if (slash?.name === "help") {
      this.apply(conversation, {
        type: "user_message",
        id: createId("user"),
        conversationId: conversation.id,
        text: trimmed,
        createdAt: Date.now(),
      });
      this.apply(conversation, {
        type: "assistant_message_complete",
        messageId: createId("msg"),
        text: helpText(this.snapshot.catalog),
      });
      this.touch(conversation);
      return;
    }
    if (slash) {
      const command = findCommand(this.snapshot.catalog, slash.name);
      if (command) userText = expandCommand(command, slash.args);
      else if (slash.name !== "help") {
        userText = `The user typed /${slash.name}. That command is not in the catalog. Say so, and list a few real commands they can run.`;
      }
    }
    if (attachments.length) {
      const notes = attachments
        .filter((item) => item.text)
        .map((item) => `Attached file ${item.name}:\n${item.text!.slice(0, 20_000)}`)
        .join("\n\n");
      if (notes) userText = `${userText}\n\n${notes}`;
    }
    const images = attachments.filter((item) => item.dataUrl && item.mediaType.startsWith("image/")).map((item) => ({ mediaType: item.mediaType, dataUrl: item.dataUrl! }));
    this.apply(conversation, {
      type: "user_message",
      id: createId("user"),
      conversationId: conversation.id,
      text: trimmed,
      attachments: attachments.map((item) => ({ name: item.name, mediaType: item.mediaType })),
      createdAt: Date.now(),
    });
    if (conversation.title === "New conversation") conversation.title = titleFrom(trimmed);
    this.set({ running: true });
    const controller = new AbortController();
    this.abort = controller;
    const registry = createToolRegistry();
    const instructions = await this.loadProjectInstructions();
    try {
      const result = await runAgentTurn({
        model: this.model,
        registry,
        workspace: this.workspacePort(),
        mode: conversation.permissionMode,
        getMode: () => this.active()?.permissionMode ?? conversation.permissionMode,
        sessionRules: this.sessionRules,
        denyPatterns: this.snapshot.settings.extraDenyPatterns,
        emit: (event) => this.apply(conversation, event),
        requestPermission: (request) => this.waitForPermission(request),
        requestClarification: (request) => this.waitForQuestion(request),
        signal: controller.signal,
        modelId: conversation.modelId,
        provider: conversation.provider ?? undefined,
        temperature: this.snapshot.settings.temperature ?? undefined,
        maxTokens: this.snapshot.settings.maxTokens ?? undefined,
        maxIterations: this.snapshot.settings.maxIterations,
        outputLimit: this.snapshot.settings.outputLimitChars,
        systemPrompt: buildSystemPrompt({
          mode: conversation.permissionMode,
          workspaceLabel: this.snapshot.workspace.root,
          capabilities: this.snapshot.workspace.capabilities,
          instructions,
          skills: this.snapshot.catalog.skills.map((skill) => ({ name: skill.name, description: skill.description })),
          commands: this.snapshot.catalog.commands.map((command) => ({ name: command.name, description: command.description })),
          agents: [
            { name: "explore", description: "Read-only codebase exploration" },
            { name: "plan", description: "Read-only planning" },
            { name: "general", description: "Bounded side task with the parent tools except Agent" },
            ...this.snapshot.catalog.agents.map((agent) => ({ name: agent.name, description: agent.description })),
          ],
        }),
        history: conversation.modelMessages,
        userText,
        images,
        loadSkill: (name) => {
          const skill = findSkill(this.snapshot.catalog, name);
          return skill ? { name: skill.name, body: skill.body } : null;
        },
        fetchText: this.model.fetchText
          ? async (url) => {
              const fetched = await this.model.fetchText!(url, controller.signal);
              return { status: fetched.status, text: fetched.text };
            }
          : undefined,
        spawnAgent: async ({ description, prompt, subagentType }) => {
          const plugin = findAgent(this.snapshot.catalog, subagentType);
          const allow = plugin?.tools ? mapAgentTools(plugin.tools) : toolsForSubagent(subagentType, registry);
          const nested = await runAgentTurn({
            model: this.model,
            registry,
            workspace: this.workspacePort(),
            mode: conversation.permissionMode,
            getMode: () => this.active()?.permissionMode ?? conversation.permissionMode,
            sessionRules: this.sessionRules,
            denyPatterns: this.snapshot.settings.extraDenyPatterns,
            emit: (event) => this.apply(conversation, event),
            requestPermission: (request) => this.waitForPermission(request),
            requestClarification: (request) => this.waitForQuestion(request),
            signal: controller.signal,
            modelId: conversation.modelId!,
            provider: conversation.provider ?? undefined,
            temperature: this.snapshot.settings.temperature ?? undefined,
            maxTokens: this.snapshot.settings.maxTokens ?? undefined,
            maxIterations: Math.min(8, this.snapshot.settings.maxIterations),
            outputLimit: this.snapshot.settings.outputLimitChars,
            systemPrompt: `${plugin?.body ?? `You are a ${subagentType} subagent. ${description}`}\n\nReturn a concise factual report. Do not pretend you edited files unless a tool result says so.`,
            history: [],
            userText: prompt,
            toolAllowlist: allow,
            depth: 1,
            loadSkill: (name) => {
              const skill = findSkill(this.snapshot.catalog, name);
              return skill ? { name: skill.name, body: skill.body } : null;
            },
          });
          return nested.text || "The subagent finished without a written report.";
        },
      });
      conversation.modelMessages = result.messages.filter((message) => message.role !== "system");
    } catch (error) {
      this.apply(conversation, {
        type: "error",
        id: createId("err"),
        message: error instanceof Error ? error.message : "The turn failed.",
        source: "app",
      });
    } finally {
      this.abort = null;
      this.set({ running: false, permission: null });
      this.touch(conversation);
      await this.persist(conversation);
    }
  }

  cancel() {
    this.abort?.abort();
    for (const [id, resolve] of this.permissionWaiters) {
      resolve({ granted: false, remember: false, reason: "Cancelled." });
      this.permissionWaiters.delete(id);
    }
    for (const [id, resolve] of this.questionWaiters) {
      resolve(null);
      this.questionWaiters.delete(id);
    }
    this.set({ running: false, permission: null, phase: "cancelled", phaseDetail: "Stopped" });
  }

  decidePermission(granted: boolean, remember: boolean) {
    const pending = this.snapshot.permission;
    if (!pending) return;
    const resolve = this.permissionWaiters.get(pending.requestId);
    this.permissionWaiters.delete(pending.requestId);
    if (remember && !granted) {
      this.sessionRules = addSessionRule(this.sessionRules, {
        signature: pending.signature,
        decision: "deny",
        label: pending.summary,
        createdAt: Date.now(),
      });
    }
    resolve?.({ granted, remember, reason: granted ? undefined : "The user denied this action. Do not retry it. Adapt or ask a concise question." });
    this.set({ permission: null });
  }

  answerQuestion(questionId: string, answers: Record<string, string>) {
    const resolve = this.questionWaiters.get(questionId);
    this.questionWaiters.delete(questionId);
    resolve?.(answers);
  }

  async revertDiff(path: string, original: string | null) {
    if (original == null) {
      this.set({ notice: { title: "Cannot revert", message: "The original contents were not kept for this change." } });
      return;
    }
    try {
      await this.workspacePort().writeFile(path, original);
      this.set({ notice: { title: "Reverted", message: `${path} was restored to the contents from before that edit.` } });
    } catch (error) {
      this.set({ notice: { title: "Revert failed", message: error instanceof Error ? error.message : "Could not restore the file." } });
    }
  }

  async openPreview(path: string) {
    this.set({ previewPath: path, previewText: null, previewError: null, explorerOpen: true });
    try {
      const file = await this.workspacePort().readFile(path, 1, 400);
      this.set({ previewText: file.numbered || file.content, previewError: file.binary ? "Binary file. Preview omitted." : null });
    } catch (error) {
      this.set({ previewError: error instanceof Error ? error.message : "Could not read the file." });
    }
  }

  closePreview() {
    this.set({ previewPath: null, previewText: null, previewError: null });
  }

  async listRoot(): Promise<{ name: string; path: string; kind: string }[]> {
    try {
      const tree = await this.workspacePort().listDirectory(".", 1);
      return (tree.children ?? []).map((child) => ({ name: child.name, path: child.path, kind: child.kind }));
    } catch {
      return [];
    }
  }

  private waitForPermission(request: Extract<AgentEvent, { type: "permission_requested" }>) {
    this.set({ permission: request, phase: "waiting", phaseDetail: "Waiting for approval" });
    return new Promise<PermissionAnswer>((resolve) => {
      this.permissionWaiters.set(request.requestId, resolve);
    });
  }

  private waitForQuestion(request: Extract<AgentEvent, { type: "clarification_requested" }>) {
    return new Promise<Record<string, string> | null>((resolve) => {
      this.questionWaiters.set(request.questionId, resolve);
    });
  }

  private apply(conversation: ConversationState, event: AgentEvent) {
    conversation.transcript = reduceEvent(conversation.transcript, event);
    conversation.updatedAt = Date.now();
    if (this.snapshot.activeId === conversation.id) {
      this.set({
        phase: conversation.transcript.phase,
        phaseDetail: conversation.transcript.phaseDetail,
        conversations: summaries(this.conversations),
      });
    }
  }

  private ensureConversation(): ConversationState {
    const existing = this.active();
    if (existing) return existing;
    const id = this.newConversation();
    return this.conversations.get(id)!;
  }

  private touch(conversation: ConversationState) {
    conversation.updatedAt = Date.now();
    this.set({ conversations: summaries(this.conversations), activeId: conversation.id });
  }

  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private persistSoon(conversation: ConversationState) {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => void this.persist(conversation), 250);
  }

  private async persist(conversation: ConversationState) {
    if (!this.snapshot.settings.persistenceEnabled) return;
    const persisted: PersistedConversation = {
      id: conversation.id,
      title: conversation.title,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      workspaceId: conversation.workspaceId,
      workspaceLabel: this.snapshot.workspace.label,
      permissionMode: conversation.permissionMode,
      modelId: conversation.modelId,
      provider: conversation.provider,
      blocks: conversation.transcript.blocks.map((block) => ({ id: block.id, kind: block.kind, payload: block as unknown as Record<string, unknown> })),
    };
    await this.persistence.saveConversation(persisted);
  }

  private async loadProjectInstructions(): Promise<string | null> {
    const port = this.workspacePort();
    if (!port.info()) return null;
    const files: { path: string; content: string }[] = [];
    for (const name of ["CLAUDE.md", "AGENTS.md"]) {
      try {
        const file = await port.readFile(name);
        if (!file.binary) files.push({ path: name, content: file.content });
      } catch {
        // Missing instruction files are normal.
      }
    }
    return projectInstructionNote(files);
  }

  destroy() {
    this.unsubscribeLog?.();
    this.abort?.abort();
  }
}

function summaries(conversations: Map<string, ConversationState>) {
  return [...conversations.values()]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((conversation) => ({ id: conversation.id, title: conversation.title, updatedAt: conversation.updatedAt }));
}

function titleFrom(text: string): string {
  const clean = text.replace(/^\/\S+\s*/, "").replace(/\s+/g, " ").trim();
  return clean.length > 48 ? `${clean.slice(0, 45)}…` : clean || "New conversation";
}

function blocksFromPersisted(item: PersistedConversation): TranscriptState {
  const blocks = item.blocks.map((block) => block.payload as unknown as Block);
  return { blocks, phase: "finished", phaseDetail: "Saved conversation" };
}

function helpText(catalog: CommandCatalog): string {
  const commands = catalog.commands.slice(0, 12).map((command) => `- /${command.name} — ${command.description}`).join("\n");
  return `Kiln is a coding agent. Describe the task in plain language, or use a slash command.\n\nShortcuts: Enter sends, Shift+Enter adds a line, Esc stops a running turn, Cmd/Ctrl+B toggles the sidebar, Cmd/Ctrl+K opens the command palette, Cmd/Ctrl+Shift+M focuses models, Cmd/Ctrl+, opens settings.\n\nCommands from this repository:\n${commands || "- none loaded"}`;
}

export function systemIsDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function currentTheme(settings: Settings): "light" | "dark" {
  return resolveTheme(settings.theme, systemIsDark());
}
