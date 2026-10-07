"use client";

import { useState } from "react";
import { Check, Cloud, Copy, ExternalLink, Hexagon, KeyRound, Plus, Server, Sparkles, Trash2 } from "lucide-react";
import { confirmed } from "@/components/ui/AlertDialog";
import type { AppController, AppState } from "@/lib/app/controller";
import type { EndpointStyle, ProviderAccount } from "@/lib/providers/types";

const ENDPOINTS: { id: EndpointStyle; label: string; detail: string }[] = [
  { id: "auto", label: "Auto", detail: "Detect from the live models response" },
  { id: "chat-completions", label: "Chat completions", detail: "POST /chat/completions" },
  { id: "messages", label: "Messages", detail: "Anthropic /v1/messages" },
  { id: "responses", label: "Responses", detail: "OpenAI /responses" },
];

export function ProviderPanel({ state, controller }: { state: AppState; controller: AppController }) {
  const flow = state.authFlow;
  const openai = state.settings.providers.filter((account) => account.kind === "openai-codex");
  const kiro = state.settings.providers.filter((account) => account.kind === "kiro");
  const custom = state.settings.providers.filter((account) => account.kind === "custom");
  return (
    <div className="settings-stack">
      <header className="settings-head">
        <h3>Providers</h3>
        <p>Sign in and Kiln loads that account’s models. Lists are fetched, not stored in the app.</p>
      </header>
      {flow ? <AuthBanner flow={flow} onCancel={() => controller.cancelAuthFlow()} onPaste={(url) => void controller.completeOpenAICallback(url)} /> : null}

      <article className="provider-card">
        <div className="provider-mark puter"><Cloud size={18} aria-hidden /></div>
        <div className="provider-copy">
          <div className="provider-title">
            <strong>Puter</strong>
            <Status live={state.auth.status === "signed-in"} label={state.auth.status === "signed-in" ? state.auth.user?.username || "Signed in" : "Not signed in"} />
          </div>
          <p>Browser sign-in. Models come from puter.ai.listModels().</p>
        </div>
        <div className="provider-actions">
          {state.auth.status === "signed-in" ? (
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
          )}
        </div>
      </article>

      <article className="provider-card">
        <div className="provider-mark openai"><Sparkles size={18} aria-hidden /></div>
        <div className="provider-copy">
          <div className="provider-title">
            <strong>OpenAI Code</strong>
            <Status live={openai.some((account) => account.enabled)} label={openai[0]?.email || (openai.length ? "Connected" : "Not connected")} />
          </div>
          <p>ChatGPT account chooser at auth.openai.com. Codex models are read from the signed-in account.</p>
        </div>
        <div className="provider-actions">
          <button type="button" className="btn primary" onClick={() => void controller.connectOpenAI()}>
            <ExternalLink size={14} aria-hidden />
            {openai.length ? "Add account" : "Continue with OpenAI"}
          </button>
        </div>
        {openai.map((account) => (
          <AccountRow key={account.id} account={account} controller={controller} />
        ))}
      </article>

      <KiroCard accounts={kiro} controller={controller} />

      <CustomCard accounts={custom} controller={controller} />
    </div>
  );
}

function KiroCard({ accounts, controller }: { accounts: ProviderAccount[]; controller: AppController }) {
  const [region, setRegion] = useState("");
  const [startUrl, setStartUrl] = useState("");
  return (
    <article className="provider-card">
      <div className="provider-mark kiro"><Hexagon size={18} aria-hidden /></div>
      <div className="provider-copy">
        <div className="provider-title">
          <strong>Kiro</strong>
          <Status live={accounts.some((account) => account.enabled)} label={accounts[0]?.email || (accounts.length ? accounts[0]?.region || "Connected" : "Not connected")} />
        </div>
        <p>AWS Builder ID or Identity Center device login. The client is registered on the fly. Models come from ListAvailableModels.</p>
      </div>
      <div className="provider-form">
        <label className="field">
          <span>Region</span>
          <input value={region} placeholder="us-east-1 — Builder ID home" spellCheck={false} onChange={(event) => setRegion(event.target.value)} />
        </label>
        <label className="field">
          <span>Start URL</span>
          <input value={startUrl} placeholder="https://view.awsapps.com/start" spellCheck={false} onChange={(event) => setStartUrl(event.target.value)} />
        </label>
      </div>
      <div className="provider-actions">
        <button type="button" className="btn primary" onClick={() => void controller.connectKiro({ region: region.trim() || undefined, startUrl: startUrl.trim() || undefined })}>
          Sign in with Kiro
        </button>
      </div>
      {accounts.map((account) => (
        <AccountRow key={account.id} account={account} controller={controller} />
      ))}
    </article>
  );
}

function CustomCard({ accounts, controller }: { accounts: ProviderAccount[]; controller: AppController }) {
  const [open, setOpen] = useState(accounts.length === 0);
  const [label, setLabel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [endpoint, setEndpoint] = useState<EndpointStyle>("auto");
  return (
    <article className="provider-card">
      <div className="provider-mark custom"><Server size={18} aria-hidden /></div>
      <div className="provider-copy">
        <div className="provider-title">
          <strong>Custom provider</strong>
          <Status live={accounts.some((account) => account.enabled)} label={accounts.length ? `${accounts.length} saved` : "None"} />
        </div>
        <p>Base URL, key, and wire format. Models are fetched from the provider’s models endpoint. Add an id yourself if it has none.</p>
      </div>
      {open ? (
        <div className="provider-form">
          <label className="field">
            <span>Name</span>
            <input value={label} placeholder="Local, Groq, gateway…" onChange={(event) => setLabel(event.target.value)} />
          </label>
          <label className="field">
            <span>Base URL</span>
            <input value={baseUrl} placeholder="https://api.example.com/v1" spellCheck={false} onChange={(event) => setBaseUrl(event.target.value)} />
          </label>
          <label className="field">
            <span>API key</span>
            <input value={apiKey} type="password" placeholder="Optional for a local server" spellCheck={false} autoComplete="off" onChange={(event) => setApiKey(event.target.value)} />
          </label>
          <div className="field">
            <span>Endpoint</span>
            <div className="endpoint-grid">
              {ENDPOINTS.map((item) => (
                <button key={item.id} type="button" className="endpoint" aria-pressed={endpoint === item.id} onClick={() => setEndpoint(item.id)}>
                  <strong>{item.label}</strong>
                  <span>{item.detail}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="provider-actions">
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
      ) : (
        <div className="provider-actions">
          <button type="button" className="btn" onClick={() => setOpen(true)}>
            <KeyRound size={14} aria-hidden />
            Add provider
          </button>
        </div>
      )}
      {accounts.map((account) => (
        <AccountRow key={account.id} account={account} controller={controller} />
      ))}
    </article>
  );
}

function AccountRow({ account, controller }: { account: ProviderAccount; controller: AppController }) {
  return (
    <div className="account-row">
      <div>
        <strong>{account.label}</strong>
        <span className="meta">
          {account.email ? `${account.email} · ` : ""}
          {account.baseUrl || account.region || account.kind}
          {account.detectedEndpoint ? ` · ${account.detectedEndpoint}` : ""}
        </span>
      </div>
      <button type="button" className="chip" aria-pressed={account.enabled} onClick={() => controller.setProviderEnabled(account.id, !account.enabled)}>
        {account.enabled ? "Enabled" : "Disabled"}
      </button>
      <button
        type="button"
        className="icon-btn"
        aria-label={`Remove ${account.label}`}
        title="Remove"
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
      <div>
        <strong>{flow.phase === "error" ? "Sign-in needs attention" : flow.phase === "done" ? "Connected" : "Waiting for the provider"}</strong>
        <p>{flow.message}</p>
      </div>
      {flow.userCode ? (
        <div className="user-code-row">
          <code>{flow.userCode}</code>
          <button
            type="button"
            className="icon-btn"
            aria-label="Copy device code"
            onClick={() => {
              void navigator.clipboard?.writeText(flow.userCode || "").then(() => setCopied(true));
            }}
          >
            {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
          </button>
        </div>
      ) : null}
      <div className="provider-actions">
        {flow.authorizeUrl ? (
          <a className="btn" href={flow.authorizeUrl} target="_blank" rel="noreferrer">Open account chooser</a>
        ) : null}
        {flow.verificationUrl ? (
          <a className="btn" href={flow.verificationUrl} target="_blank" rel="noreferrer">Open verification</a>
        ) : null}
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

function Status({ live, label }: { live: boolean; label: string }) {
  return (
    <span className={`pill ${live ? "ok" : ""}`}>
      <i />
      {label}
    </span>
  );
}
