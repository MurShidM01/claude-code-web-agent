# Kiln

Kiln is a browser coding agent. You sign in with [Puter](https://puter.com), pick a live model, connect a project, and describe the work in a conversation. The agent reads the project, edits files, runs commands, and shows the diffs and the output. It does not invent them.

The behavior is ported from the Claude Code sources in this repository: permission modes, tool discipline, command safety, skills, and slash commands. The chat interface, the TypeScript runtime, and the localhost bridge are new. This is not a terminal emulator and not a VS Code clone. Upstream documentation is preserved at [`docs/upstream-claude-code-readme.md`](docs/upstream-claude-code-readme.md). The license is unchanged in [`LICENSE.md`](LICENSE.md).

## Start

```bash
npm install
npm run dev:all
```

Open `http://localhost:3000`. Sign in, choose a model from the catalog Puter returns, and open a project (`sample-project` when you use `dev:all`) from the project row in the sidebar, the topbar chip, or Cmd/Ctrl+O. Ask Kiln to fix the failing test.

`npm run dev` starts only the website. `npm run bridge` starts only the execution bridge. Details, including how a hosted app pairs with a bridge on your machine, are in [`docs/using-kiln.md`](docs/using-kiln.md).

A remote deployment cannot access your computer. Shell, git, and process control exist only while a bridge you launched is connected. The page will say so instead of faking a terminal.

## How a turn works

1. The browser loads Puter.js, or you connect OpenAI Code, Kiro, or a custom endpoint. Models are fetched from that account. Nothing in the catalog is hardcoded.
2. You pick a permission mode. It is enforced in the tool layer before the tool runs.
3. The agent loop streams text and tool calls until the task is done, refused, failed, or you stop it.
4. File and command tools go through a workspace port. In local mode that port is the bridge, reached via `/api/bridge` so the pairing token stays on the machine. In deploy mode the same port is a bridge you pair directly.
5. Denials, missing capabilities, and command failures return structured tool results. The agent is expected to adapt, not to invent a success. If the model repeats the same failing tool call three times in a row, the loop refuses it and ends the turn with an explanation.

A turn never ends without a visible reason. An empty stream, a reasoning-only reply, an unknown model id, or an unreachable provider each produce a plain sentence in the transcript, and a failed turn also raises a dialog and a log line in Settings → Diagnostics. A model from a connected account is never quietly retried on Puter.

The bridge speaks a versioned JSON protocol. Paths are resolved inside the workspace root, shell output is capped, the process environment is filtered, and commands such as `rm -rf /` are rejected before spawn. Writes are atomic (staged in a temp file, then renamed), and stopping the bridge also stops the commands it started.

## Layout

| Path | Role |
| --- | --- |
| `src/lib/agent` | Turn loop, prompt, context compaction |
| `src/lib/permissions` | Mode matrix and one-shot grants |
| `src/lib/tools` | Tool schemas, edits, diffs |
| `src/lib/workspace` | Bridge client, folder picker, path jail |
| `src/lib/model` | Puter transport and catalog normalization |
| `bridge/src/server.ts` | Localhost execution bridge |
| `plugins/` | Upstream commands, skills, and agents, loaded as a catalog |
| `sample-project/` | A tiny project with one failing test |

## Verify

```bash
npm test
npm run typecheck
```

The tests cover permission decisions, tool schemas, path escape, the agent loop (including deny, retry, cancel, the repeated-failure breaker, and empty or reasoning-only replies), the folder-picker workspace's typed errors (including creating a new file), the file tools (`Write`, `Edit`, `MultiEdit`, `Stat`, `BashOutput`), the real bridge (atomic writes, typed `not_found` errors, move, delete, search), and a flow that loads a model catalog, connects a workspace, edits a file, runs a command, and persists the theme.

`src/lib/providers/chat-roundtrip.test.ts` additionally drives the whole bridged path — controller → routed transport → `/api/bridge/chat` → bridge → upstream SSE — against a stand-in provider, so request shaping and the SSE decoder are covered end to end. The interface has its own tests for the settings dialog, the model picker's provider filters, and the sidebar's truncation rules.
