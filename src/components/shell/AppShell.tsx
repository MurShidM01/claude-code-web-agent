"use client";

import { useEffect } from "react";
import { Folder, FolderOpen, Menu } from "lucide-react";
import { DiffCard, PlanCard, QuestionCard, ToolCard } from "@/components/activity/Cards";
import { ConnectionDialog } from "@/components/bridge/ConnectionDialog";
import { Composer } from "@/components/chat/Composer";
import { EmptyState } from "@/components/chat/EmptyState";
import { MarkdownView } from "@/components/chat/MarkdownView";
import { CommandPalette } from "@/components/palette/CommandPalette";
import { PermissionDialog } from "@/components/permissions/PermissionDialog";
import { AppProvider, useApp, useAppState } from "@/components/providers";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import { ErrorBoundary } from "@/components/shell/ErrorBoundary";
import { Sidebar } from "@/components/shell/Sidebar";
import { Dialog } from "@/components/ui/Dialog";
import { Explorer } from "@/components/workspace/Explorer";
import { PHASE_LABEL } from "@/lib/agent/phases";
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
      if (meta && event.shiftKey && event.key.toLowerCase() === "m") {
        event.preventDefault();
        window.dispatchEvent(new Event("kiln:open-model"));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [controller, running, state.paletteOpen]);

  const className = `app${state.sidebarOpen ? "" : " sidebar-closed"}${state.explorerOpen ? " with-explorer" : ""}`;
  return (
    <div className={className}>
      {state.sidebarOpen ? <div className="scrim" aria-hidden onClick={() => controller.toggleSidebar()} /> : null}
      <Sidebar
        state={state}
        onNew={() => controller.newConversation()}
        onSelect={(id) => controller.selectConversation(id)}
        onDelete={(id) => void controller.deleteConversation(id)}
        onClose={() => controller.toggleSidebar()}
        mode={mode}
        onMode={(next) => controller.setPermissionMode(next as PermissionMode)}
        onTheme={(theme) => controller.setTheme(theme)}
        onSettings={() => controller.setSettingsOpen(true)}
        onConnect={() => controller.setConnectionOpen(true)}
        onSignIn={() => void controller.signIn()}
        onSignOut={() => controller.signOut()}
        onSwitch={() => void controller.switchAccount()}
      />
      <main className="stage">
        <header className="topbar">
          <button
            type="button"
            className="icon-btn"
            aria-label={state.sidebarOpen ? "Close sidebar" : "Open sidebar"}
            aria-expanded={state.sidebarOpen}
            title="Toggle sidebar (Ctrl/⌘ B)"
            onClick={() => controller.toggleSidebar()}
          >
            <Menu size={17} aria-hidden />
          </button>
          <h2>{active?.title ?? "Kiln"}</h2>
          <div className={`phase ${running ? "live" : ""}`} title={state.phaseDetail}>
            <i />
            <span className="phase-text">{PHASE_LABEL[state.phase]}</span>
            <span className="meta">{state.phaseDetail}</span>
          </div>
          <div className="spacer" />
          <button
            type="button"
            className="chip"
            aria-pressed={state.explorerOpen}
            aria-label="Toggle file panel"
            title="Toggle file panel (Ctrl/⌘ \)"
            onClick={() => controller.toggleExplorer()}
          >
            {state.explorerOpen ? <FolderOpen size={15} aria-hidden /> : <Folder size={15} aria-hidden />}
            <span className="hide-sm">Files</span>
          </button>
        </header>
        <div className="thread">
          <div className="column">
            {blocks.length === 0 ? <EmptyState /> : null}
            {blocks.map((block) => {
              if (block.kind === "user") {
                return (
                  <div key={block.id} className="msg user-msg">
                    {block.text}
                    {block.attachments?.length ? <div className="meta">{block.attachments.map((item) => item.name).join(", ")}</div> : null}
                  </div>
                );
              }
              if (block.kind === "assistant") {
                return (
                  <div key={block.id} className="msg">
                    <MarkdownView text={block.text} streaming={block.streaming} />
                  </div>
                );
              }
              if (block.kind === "tool") return <ToolCard key={block.id} block={block} />;
              if (block.kind === "diff") {
                return (
                  <DiffCard
                    key={block.id}
                    block={block}
                    onOpen={(path) => void controller.openPreview(path)}
                    onRevert={(path, original) => void controller.revertDiff(path, original)}
                  />
                );
              }
              if (block.kind === "plan") return <PlanCard key={block.id} block={block} />;
              if (block.kind === "question") {
                return <QuestionCard key={block.id} block={block} onAnswer={(id, answers) => controller.answerQuestion(id, answers)} />;
              }
              if (block.kind === "error") {
                return (
                  <div key={block.id} className="card">
                    <div className="card-head">
                      <span className="badge bad">{block.source}</span>
                      <span className="summary">{block.message}</span>
                    </div>
                  </div>
                );
              }
              return null;
            })}
          </div>
        </div>
        <Composer state={state} controller={controller} permissionMode={mode} modelId={active?.modelId ?? null} />
      </main>
      {state.explorerOpen ? <div className="scrim" aria-hidden onClick={() => controller.toggleExplorer()} /> : null}
      <Explorer state={state} controller={controller} />
      <PermissionDialog request={state.permission} onDecide={(granted, remember) => controller.decidePermission(granted, remember)} />
      <SettingsDialog state={state} controller={controller} />
      <CommandPalette state={state} controller={controller} />
      <ConnectionDialog state={state} controller={controller} />
      <Dialog open={Boolean(state.authDialog)} title={state.authDialog?.title ?? ""} onClose={() => controller.dismissDialogs()}>
        <p>{state.authDialog?.message}</p>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={() => controller.dismissDialogs()}>
            Close
          </button>
          <button type="button" className="btn primary" onClick={() => void controller.signIn()}>
            Sign in
          </button>
        </div>
      </Dialog>
      <Dialog open={Boolean(state.notice)} title={state.notice?.title ?? ""} onClose={() => controller.dismissDialogs()}>
        <p>{state.notice?.message}</p>
        <div className="dialog-actions">
          <button type="button" className="btn primary" onClick={() => controller.dismissDialogs()}>
            OK
          </button>
        </div>
      </Dialog>
    </div>
  );
}
