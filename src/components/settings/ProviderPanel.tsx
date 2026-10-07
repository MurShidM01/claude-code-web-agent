"use client";

import { useState } from "react";
import { Check, ChevronDown, Cloud, Copy, ExternalLink, Hexagon, KeyRound, Plus, Server, Sparkles, Trash2 } from "lucide-react";
import { confirmed } from "@/components/ui/AlertDialog";
import type { AppController, AppState } from "@/lib/app/controller";
import type { EndpointStyle, ProviderAccount } from "@/lib/providers/types";

const ENDPOINTS: { id: EndpointStyle; label: string; detail: string }[] = [
  { id: "auto", label: "Auto-detect", detail: "Read it from the live models response" },
  { id: "chat-completions", label: "Chat completions", detail: "POST /chat/completions (OpenAI-style)" },
  { id: "messages", label: "Messages", detail: "Anthropic /v1/messages" },
  { id: "responses", label: "Responses", detail: "OpenAI /responses" },
];

export function ProviderPanel({ state, controller }: { state: AppState; controller: AppController }) {
  const flow = state.authFlow;
  const openai = state.settings.providers.filter((account) => account.kind === "openai-codex");
  const kiro = state.settings.providers.filter((account) => account.kind === "kiro");
  const custom = state.settings.providers.filter((account) => account.kind === "custom");
  return (
    <div className="provider-grid">
      <header className="settings-head">
        <h3>Providers</h3>
        <p>Sign in once and Kiln pulls that account's model list. Lists come from the live provider, never from a hardcoded catalog.</p>
      </header>
      {flow ? <AuthBanner flow={flow} onCancel={() => controller.cancelAuthFlow()} onPaste={(url) => void controller.completeOpenAICallback(url)} /> : null}

      <ProviderCard
        accent="puter"
        icon={<Cloud size={18} aria-hidden />}
        title="Puter"
        description="Browser sign-in. Models come from puter.ai.listModels(). The free path — most people start here."
        status={{
          live: state.auth.status === "signed-in",
          label: state.auth.status === "signed-in" ? state.auth.user?.username || "Signed in" : "Not signed in",
        }}
        actions={
          state.auth.status === "signed-in" ? (
            <>
              <button type="button" className="btn" onClick={() => void controller.switchAccount()}>Switch</button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  void confirmed(controller, {
                    title: "Sign out of Puter?",
                    message: "This browser will forget the Puter session. Other connected providers stay until you remove them.",
                    confirmLabel: "Sign out",
                    tone: "danger",
                  }, () => controller.signOut());
                }}
              >
                Sign out
              </button>
            </>
          ) : (
            <button type="button" className="btn primary" onClick={() => void controller.signIn()} disabled={state.auth.status === "signing-in"}>
              {state.auth.status === "signing-in" ? "Opening…" : "Sign in"}
            </button>
          )
        }
      />

      <ProviderCard
        accent="openai"
        icon={<Sparkles size={18} aria-hidden />}
        title="OpenAI Code"
        description="ChatGPT account chooser at auth.openai.com. Reads Codex models from the signed-in account."
        status={{
          live: openai.some((account) => account.enabled),
          label: openai[0]?.email || (openai.length ? "Connected" : "Not connected"),
        }}
        actions={
          <button type="button" className="btn primary" onClick={() => void controller.connectOpenAI()}>
            <ExternalLink size={13} aria-hidden />
            {openai.length ? "Add another account" : "Continue with OpenAI"}
          </button>
        }
      >
        {openai.length ? (
          <div className="account-list">
            {openai.map((account) => <AccountRow key={account.id} account={account} controller={controller} />)}
          </div>
        ) : null}
      </ProviderCard>

      <KiroCard accounts={kiro} controller={controller} />
      <CustomCard accounts={custom} controller={controller} />
    </div>
  );
}

function KiroCard({ accounts, controller }: { accounts: ProviderAccount[]; controller: AppController }) {
  const [region, setRegion] = useState("");
  const [startUrl, setStartUrl] = useState("");
  const [open, setOpen] = useState(false);
  return (
    <ProviderCard
      accent="kiro"
      icon={<Hexagon size={18} aria-hidden />}
      title="Kiro"
      description="AWS Builder ID or Identity Center device login. The OAuth client is registered on the fly. Models come from ListAvailableModels."
      status={{
        live: accounts.some((account) => account.enabled),
        label: accounts[0]?.email || (accounts.length ? accounts[0]?.region || "Connected" : "Not connected"),
      }}
      actions={
        <button type="button" className="btn primary" onClick={() => { setOpen((value) => !value); void controller.connectKiro({ region: region.trim() || undefined, startUrl: startUrl.trim() || undefined }); }}>
          {accounts.length ? "Add another account" : "Sign in with Kiro"}
        </button>
      }
    >
      {open ? (
        <div className="kiro-form">
          <div className="kiro-form-row">
            <label className="field">
              <span>Region</span>
              <input value={region} placeholder="us-east-1 (Builder ID home)" spellCheck={false} onChange={(event) => setRegion(event.target.value)} />
            </label>
            <label className="field">
              <span>Start URL</span>
              <input value={startUrl} placeholder="https://view.awsapps.com/start" spellCheck={false} onChange={(event) => setStartUrl(event.target.value)} />
            </label>
          </div>
          <p className="meta">Region and start URL are optional. Default is the Builder ID home region. Identity Center users paste their portal URL.</p>
        </div>
      ) : null}
      {accounts.length ? (
        <div className="account-list">
          {accounts.map((account) => <AccountRow key={account.id} account={account} controller={controller} />)}
        </div>
      ) : null}
    </ProviderCard>
  );
}

function CustomCard({ accounts, controller }: { accounts: ProviderAccount[]; controller: AppController }) {
  const [open, setOpen] = useState(accounts.length === 0);
  const [label, setLabel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [endpoint, setEndpoint] = useState<EndpointStyle>("auto");
  return (
    <ProviderCard
      accent="custom"
      icon={<Server size={18} aria-hidden />}
      title="Custom provider"
      description="Base URL, key, and wire format. Models are fetched from the provider's models endpoint. Add an id yourself if the catalog returns nothing."
      status={{ live: accounts.some((account) => account.enabled), label: accounts.length ? `${accounts.length} connected` : "Not connected" }}
      actions={
        <button type="button" className="btn" onClick={() => setOpen((value) => !value)}>
          <KeyRound size={13} aria-hidden />
          {open ? "Hide form" : "Add a provider"}
        </button>
      }
    >
      {open ? (
        <div className="custom-form">
          <div className="custom-form-row">
            <label className="field">
              <span>Display name</span>
              <input value={label} placeholder="Local, Groq, gateway…" onChange={(event) => setLabel(event.target.value)} />
            </label>
            <label className="field">
              <span>Base URL</span>
              <input value={baseUrl} placeholder="https://api.example.com/v1" spellCheck={false} onChange={(event) => setBaseUrl(event.target.value)} />
            </label>
            <label className="field">
              <span>API key</span>
              <input value={apiKey} type="password" placeholder="Optional for local" spellCheck={false} autoComplete="off" onChange={(event) => setApiKey(event.target.value)} />
            </label>
          </div>
          <div className="endpoint-grid">
            {ENDPOINTS.map((item) => (
              <button key={item.id} type="button" className="endpoint" aria-pressed={endpoint === item.id} onClick={() => setEndpoint(item.id)}>
                <strong>{item.label}</strong>
                <span>{item.detail}</span>
              </button>
            ))}
          </div>
          <div className="custom-form-actions">
            <button
              type="button"
              className="btn primary"
              disabled={!baseUrl.trim()}
              onClick={() => {
                controller.addCustomProvider({ label, baseUrl, apiKey, endpoint });
                setLabel("");
                setBaseUrl("");
                setApiKey("");
                setOpen(false);
              }}
            >
              <Plus size={14} aria-hidden />
              Save and fetch models
            </button>
          </div>
        </div>
      ) : null}
      {accounts.length ? (
        <div className="account-list">
          {accounts.map((account) => <AccountRow key={account.id} account={account} controller={controller} />)}
        </div>
      ) : null}
    </ProviderCard>
  );
}

function ProviderCard({
  accent,
  icon,
  title,
  description,
  status,
  actions,
  children,
}: {
  accent: "puter" | "openai" | "kiro" | "custom";
  icon: React.ReactNode;
  title: string;
  description: string;
  status: { live: boolean; label: string };
  actions: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <article className={`provider-card accent-${accent}`}>
      <div className={`provider-mark accent-${accent}`}>{icon}</div>
      <div className="provider-body">
        <header className="provider-head">
          <div className="provider-title">
            <strong>{title}</strong>
            <span className={`pill ${status.live ? "ok" : ""}`}>
              <i />
              {status.label}
            </span>
          </div>
          <div className="provider-actions">{actions}</div>
        </header>
        <p className="provider-desc">{description}</p>
        {children}
      </div>
    </article>
  );
}

function AccountRow({ account, controller }: { account: ProviderAccount; controller: AppController }) {
  return (
    <div className="account-row">
      <div className="account-info">
        <strong>{account.label}</strong>
        <span className="meta">
          {account.email ? `${account.email}` : ""}
          {account.baseUrl || account.region ? ` · ${account.baseUrl || account.region}` : ""}
          {account.detectedEndpoint ? ` · ${account.detectedEndpoint}` : ""}
        </span>
      </div>
      <div className="account-actions">
        <button type="button" className="chip" aria-pressed={account.enabled} onClick={() => controller.setProviderEnabled(account.id, !account.enabled)}>
          {account.enabled ? "Enabled" : "Disabled"}
        </button>
        <button
          type="button"
          className="icon-btn ghost"
          aria-label={`Remove ${account.label}`}
          title="Remove account"
          onClick={() => {
            void confirmed(controller, {
              title: `Remove ${account.label}?`,
              message: "The saved token or key for this provider is deleted from this browser. You can connect it again later.",
              confirmLabel: "Remove",
              tone: "danger",
            }, () => controller.removeProvider(account.id));
          }}
        >
          <Trash2 size={14} aria-hidden />
        </button>
      </div>
    </div>
  );
}

function AuthBanner({
  flow,
  onCancel,
  onPaste,
}: {
  flow: NonNullable<AppState["authFlow"]>;
  onCancel: () => void;
  onPaste: (url: string) => void;
}) {
  const [callback, setCallback] = useState("");
  const [copied, setCopied] = useState(false);
  return (
    <div className={`auth-banner ${flow.phase}`}>
      <div className="auth-banner-head">
        <strong>{flow.phase === "error" ? "Sign-in needs attention" : flow.phase === "done" ? "Connected" : "Waiting for the provider"}</strong>
        <ChevronDown size={14} aria-hidden className="auth-banner-chev" />
      </div>
      <p>{flow.message}</p>
      {flow.userCode ? (
        <div className="user-code-row">
          <span className="meta">Device code</span>
          <code>{flow.userCode}</code>
          <button
            type="button"
            className="icon-btn ghost"
            aria-label="Copy device code"
            onClick={() => {
              void navigator.clipboard?.writeText(flow.userCode || "").then(() => setCopied(true));
            }}
          >
            {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
          </button>
        </div>
      ) : null}
      <div className="auth-banner-actions">
        {flow.authorizeUrl ? <a className="btn" href={flow.authorizeUrl} target="_blank" rel="noreferrer">Open account chooser</a> : null}
        {flow.verificationUrl ? <a className="btn" href={flow.verificationUrl} target="_blank" rel="noreferrer">Open verification</a> : null}
        {flow.phase !== "done" ? (
          <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        ) : null}
      </div>
      {flow.provider === "openai-codex" && flow.phase === "waiting" ? (
        <label className="field">
          <span>Callback URL, if the window could not close itself</span>
          <span className="paste-row">
            <input value={callback} placeholder="http://localhost:1455/auth/callback?code=…&state=…" spellCheck={false} onChange={(event) => setCallback(event.target.value)} />
            <button type="button" className="btn" disabled={!callback.trim()} onClick={() => onPaste(callback)}>Use</button>
          </span>
        </label>
      ) : null}
    </div>
  );
}
