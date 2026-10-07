"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, FolderOpen, FolderPlus, Menu as MenuIcon, PanelRight } from "lucide-react";
import { DiffCard, PlanCard, QuestionCard, ToolCard } from "@/components/activity/Cards";
import { ConnectionDialog } from "@/components/bridge/ConnectionDialog";
import { AssistantBubble, UserBubble } from "@/components/chat/MessageBubble";
import { Composer } from "@/components/chat/Composer";
import { EmptyState } from "@/components/chat/EmptyState";
import { CommandPalette } from "@/components/palette/CommandPalette";
import { PermissionDialog } from "@/components/permissions/PermissionDialog";
import { AppProvider, useApp, useAppState } from "@/components/providers";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import { ErrorBoundary } from "@/components/shell/ErrorBoundary";
import { Sidebar } from "@/components/shell/Sidebar";
import { AlertDialog, ConfirmDialog, confirmed } from "@/components/ui/AlertDialog";
import { Explorer } from "@/components/workspace/Explorer";
import { PHASE_LABEL } from "@/lib/agent/phases";
import type { AppState } from "@/lib/app/controller";
import type { PermissionMode } from "@/lib/permissions/types";

export function AppShell() {
  return (
    <AppProvider>
      <ErrorBoundary>
        <Shell />
      </ErrorBoundary>
    </AppProvider>
  );
}

function Shell() {
  const controller = useApp();
  const state = useAppState();
  const active = controller.active();
  const blocks = active?.transcript.blocks ?? [];
  const mode = active?.permissionMode ?? state.settings.defaultPermissionMode;
  const running = state.running;

  const stageRef = useRef<HTMLElement>(null);
  const threadRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
  const [pinned, setPinned] = useState(true);
  const [projectHintDismissed, setProjectHintDismissed] = useState(false);
  const stick = useRef(true);

  /* Keep the thread's bottom padding in step with the floating composer. */
  useLayoutEffect(() => {
    const stage = stageRef.current;
    const dock = dockRef.current;
    if (!stage || !dock) return;
    const sync = () => stage.style.setProperty("--composer-space", `${Math.round(dock.getBoundingClientRect().height)}px`);
    sync();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(sync);
    observer.observe(dock);
    return () => observer.disconnect();
  }, []);

  /* Follow the stream unless the reader scrolled away on purpose. */
  useEffect(() => {
    const node = threadRef.current;
    if (!node) return;
    const onScroll = () => {
      const distance = node.scrollHeight - node.scrollTop - node.clientHeight;
      stick.current = distance < 90;
      setPinned(stick.current);
      setScrolled(node.scrollTop > 8);
    };
    onScroll();
    node.addEventListener("scroll", onScroll, { passive: true });
    return () => node.removeEventListener("scroll", onScroll);
  }, [state.activeId]);

  const last = blocks[blocks.length - 1];
  const growth =
    last?.kind === "assistant" || last?.kind === "user" ? last.text.length : last?.kind === "tool" ? `${last.status}${last.stdout.length}` : "";
  /* The thread already shows progress while a tool runs or tokens stream.
     This row only covers the gaps: the model request itself, and the pause
     between an assistant message and the next tool call. */
  const streamingSomething =
    last?.kind === "assistant" ? Boolean(last.text) || Boolean(last.reasoning) : last?.kind === "tool" ? last.status === "requested" || last.status === "running" : false;
  useLayoutEffect(() => {
    const node = threadRef.current;
    if (!node || !stick.current) return;
    node.scrollTop = node.scrollHeight;
  }, [blocks.length, growth, state.activeId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      if (event.key === "Escape" && running) {
        event.preventDefault();
        controller.cancel();
      }
      if (meta && event.key.toLowerCase() === "b") {
        event.preventDefault();
        controller.toggleSidebar();
      }
      if (meta && event.key.toLowerCase() === "k") {
        event.preventDefault();
        controller.setPalette(!state.paletteOpen);
      }
      if (meta && event.key === "\\") {
        event.preventDefault();
        controller.toggleExplorer();
      }
      if (meta && event.key === ",") {
        event.preventDefault();
        controller.setSettingsOpen(true);
      }
      if (meta && event.key.toLowerCase() === "o") {
        event.preventDefault();
        controller.setConnectionOpen(true);
      }
      if (meta && event.shiftKey && event.key.toLowerCase() === "m") {
        event.preventDefault();
        window.dispatchEvent(new Event("kiln:open-model"));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [controller, running, state.paletteOpen]);

  const jumpToLatest = useCallback(() => {
    const node = threadRef.current;
    if (!node) return;
    stick.current = true;
    setPinned(true);
    node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  }, []);

  const hasProject = state.workspace.kind !== "none";
  const className = `app${state.sidebarOpen ? "" : " sidebar-closed"}${state.explorerOpen ? " with-explorer" : ""}`;
  return (
    <div className={className}>
      {state.sidebarOpen ? <div className="scrim" aria-hidden onClick={() => controller.toggleSidebar()} /> : null}
      <Sidebar
        state={state}
        onNew={() => controller.newConversation()}
        onSelect={(id) => controller.selectConversation(id)}
        onDelete={(id) => {
          const title = state.conversations.find((item) => item.id === id)?.title ?? "This conversation";
          void confirmed(controller, {
            title: "Delete this conversation?",
            message: `“${title}” will be removed from this browser. This cannot be undone.`,
            confirmLabel: "Delete",
            tone: "danger",
          }, () => controller.deleteConversation(id));
        }}
        onClose={() => controller.toggleSidebar()}
        mode={mode}
        onMode={(next) => controller.setPermissionMode(next as PermissionMode)}
        onTheme={(theme) => controller.setTheme(theme)}
        onSettings={() => controller.openSettings("appearance")}
        onProviders={() => controller.openSettings("providers")}
        onConnect={() => controller.setConnectionOpen(true)}
        onSignIn={() => void controller.signIn()}
        onSignOut={() => {
          void confirmed(controller, {
            title: "Sign out of Puter?",
            message: "This browser will forget the Puter session. Connected OpenAI, Kiro, and custom providers stay until you remove them.",
            confirmLabel: "Sign out",
            tone: "danger",
          }, () => controller.signOut());
        }}
        onSwitch={() => void controller.switchAccount()}
      />
      <main className="stage" ref={stageRef}>
        <header className={`topbar${scrolled ? " scrolled" : ""}`}>
          <button
            type="button"
            className="icon-btn ghost"
            aria-label={state.sidebarOpen ? "Close sidebar" : "Open sidebar"}
            aria-expanded={state.sidebarOpen}
            title="Toggle sidebar (Ctrl/⌘ B)"
            onClick={() => controller.toggleSidebar()}
          >
            <MenuIcon size={17} aria-hidden />
          </button>
          <h2>{active?.title ?? "Kiln"}</h2>
          <div className={`phase ${running ? "live" : ""}${state.phase === "waiting" ? " wait" : ""}${state.phase === "failed" ? " error" : ""}`} title={state.phaseDetail}>
            <i />
            <span className="phase-text">{PHASE_LABEL[state.phase]}</span>
            <span className="meta">{state.phaseDetail}</span>
          </div>
          <div className="spacer" />
          <button
            type="button"
            className={`chip solid project-chip${hasProject ? "" : " alert"}`}
            title={hasProject ? `${state.workspace.root ?? state.workspace.label} — change project` : "Open the project the agent should work in (Ctrl/⌘ O)"}
            aria-label={hasProject ? `Project ${state.workspace.label}` : "Open a project"}
            onClick={() => controller.setConnectionOpen(true)}
          >
            {hasProject ? <FolderOpen size={15} aria-hidden /> : <FolderPlus size={15} aria-hidden />}
            <span className="chip-label hide-sm">{hasProject ? state.workspace.label : "Open project"}</span>
          </button>
          <button
            type="button"
            className="icon-btn ghost"
            aria-pressed={state.explorerOpen}
            aria-label="Toggle file panel"
            title="Toggle file panel (Ctrl/⌘ \)"
            onClick={() => controller.toggleExplorer()}
          >
            <PanelRight size={17} aria-hidden />
          </button>
        </header>
        <div className={`thread${blocks.length === 0 ? " is-empty" : ""}`} ref={threadRef}>
          <div className="column">
            {blocks.length === 0 ? <EmptyState state={state} onOpenProject={() => controller.setConnectionOpen(true)} /> : null}
            {blocks.map((block) => {
              if (block.kind === "user") return <UserBubble key={block.id} block={block} controller={controller} running={running} />;
              if (block.kind === "assistant") return <AssistantBubble key={block.id} block={block} controller={controller} running={running} />;
              if (block.kind === "tool") return <ToolCard key={block.id} block={block} />;
              if (block.kind === "diff") {
                return (
                  <DiffCard
                    key={block.id}
                    block={block}
                    onOpen={(path) => void controller.openPreview(path)}
                    onRevert={(path, original) => {
                      void confirmed(controller, {
                        title: "Revert this change?",
                        message: `${path} will be restored to the contents from before that edit.`,
                        confirmLabel: "Revert",
                        tone: "danger",
                      }, () => controller.revertDiff(path, original));
                    }}
                  />
                );
              }
              if (block.kind === "plan") return <PlanCard key={block.id} block={block} />;
              if (block.kind === "question") {
                return <QuestionCard key={block.id} block={block} onAnswer={(id, answers) => controller.answerQuestion(id, answers)} />;
              }
              if (block.kind === "error") {
                return (
                  <button
                    key={block.id}
                    type="button"
                    className="card alert-card"
                    onClick={() => controller.notify(block.source === "model" ? "The model stopped" : "Something went wrong", block.message, "danger")}
                  >
                    <span className="card-head">
                      <span className="badge bad">{block.source}</span>
                      <span className="summary">{block.message}</span>
                    </span>
                  </button>
                );
              }
              return null;
            })}
            {running && !streamingSomething ? <WorkingRow state={state} /> : null}
          </div>
        </div>
        <div className="dock" ref={dockRef}>
          {!pinned && blocks.length > 0 ? (
            <button type="button" className="jump" onClick={jumpToLatest}>
              <ArrowDown size={13} aria-hidden />
              {running ? "Follow along" : "Latest"}
            </button>
          ) : null}
          <Composer
            state={state}
            controller={controller}
            permissionMode={mode}
            modelId={active?.modelId ?? null}
            onOpenProject={() => controller.setConnectionOpen(true)}
          />
        </div>
      </main>
      {state.explorerOpen ? <div className="scrim" aria-hidden onClick={() => controller.toggleExplorer()} /> : null}
      <Explorer state={state} controller={controller} />
      <PermissionDialog request={state.permission} onDecide={(granted, remember) => controller.decidePermission(granted, remember)} />
      <SettingsDialog state={state} controller={controller} />
      <CommandPalette state={state} controller={controller} />
      <ConnectionDialog state={state} controller={controller} />
      <AlertDialog
        open={Boolean(state.authDialog)}
        title={state.authDialog?.title ?? ""}
        message={state.authDialog?.message ?? ""}
        tone={state.authDialog?.tone ?? "warning"}
        onClose={() => controller.dismissDialogs()}
        actions={
          <>
            <button type="button" className="btn" onClick={() => controller.dismissDialogs()}>
              Close
            </button>
            <button type="button" className="btn" onClick={() => controller.openSettings("providers")}>
              Other providers
            </button>
            <button type="button" className="btn primary" data-autofocus onClick={() => void controller.signIn()}>
              Sign in with Puter
            </button>
          </>
        }
      />
      <AlertDialog
        open={Boolean(state.notice)}
        title={state.notice?.title ?? ""}
        message={state.notice?.message ?? ""}
        tone={state.notice?.tone}
        onClose={() => controller.dismissDialogs()}
      />
      <AlertDialog
        open={state.booted && state.bridge.status !== "checking" && state.workspace.kind === "none" && !projectHintDismissed && !state.connectionOpen && !state.settingsOpen && !state.paletteOpen && !state.notice && !state.authDialog && !state.confirm}
        title="No project open"
        message="Kiln can talk, but it will not invent file changes or command output until you import a folder."
        tone="warning"
        onClose={() => setProjectHintDismissed(true)}
        actions={
          <>
            <button type="button" className="btn" data-autofocus onClick={() => setProjectHintDismissed(true)}>
              Keep chatting
            </button>
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                setProjectHintDismissed(true);
                controller.setConnectionOpen(true);
              }}
            >
              Import a folder
            </button>
          </>
        }
      />
      <ConfirmDialog request={state.confirm} onConfirm={() => controller.answerConfirm(true)} onCancel={() => controller.answerConfirm(false)} />
    </div>
  );
}

/**
 * The quiet gap between "you sent a message" and the first token, or between
 * a tool finishing and the model picking up the result. Without it a slow
 * provider looks like a frozen page.
 */
function WorkingRow({ state }: { state: AppState }) {
  return (
    <div className="working" role="status" aria-live="polite">
      <span className="working-dots" aria-hidden>
        <i />
        <i />
        <i />
      </span>
      <span className="working-text">{state.phaseDetail || PHASE_LABEL[state.phase]}</span>
      <span className="working-phase">{PHASE_LABEL[state.phase]}</span>
    </div>
  );
}
