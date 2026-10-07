# Using Kiln

Kiln is a conversational coding agent. The chat is the product. A file panel exists only so you can look at what the agent touched.

The agentic behavior — tool use, permission modes, command safety, skills, and slash commands — is ported from the Claude Code tree in this repository. The interface, the TypeScript runtime, and the local execution bridge are an original implementation. Upstream notes are kept in `docs/upstream-claude-code-readme.md`. The license remains `LICENSE.md`.

## What the browser can and cannot do

A page cannot inspect your disk, start processes, or run git. Kiln never pretends otherwise.

- **Local mode.** Run the Next.js app and the bridge on the same machine. The app proxies tool calls to `127.0.0.1` and keeps the pairing token out of the browser.
- **Deploy mode.** The Next.js app can be hosted anywhere. Chat and Puter model access still work. Files, shell, git, and processes work only after you pair a bridge that you started on your computer. A remote deployment cannot reach your machine by itself.

The File System Access API, in Chromium, can read and write a folder you pick. It still cannot run commands. Shell and git stay on the bridge.

## Start locally

```bash
npm install
npm run dev:all
```

That starts the bridge on `127.0.0.1:3939` and the app on `http://localhost:3000`, suggesting `sample-project` as the workspace. Open the app, sign in with Puter, choose a model from the live catalog, and confirm the workspace path.

Useful scripts:

| Script | What it does |
| --- | --- |
| `npm run dev` | Next.js only, bound to `0.0.0.0:3000` |
| `npm run bridge` | Local execution bridge |
| `npm run dev:all` | Both, with the sample project suggested |
| `npm run typecheck` | TypeScript |
| `npm test` | Unit, integration, and flow tests |
| `npm run extract-commands` | Refresh `src/content/catalog.json` from `plugins/` |

The bridge prints a pairing code. Local mode does not need it, because the app reads `.kiln/bridge.json`. Deploy mode does: open a project, enter the code, then choose the path. The token file is mode `0600` and is gitignored.

## Open a project

The agent works inside one project folder. Open it from any of these, all of which open the same dialog:

- The project row at the top of the sidebar.
- The project chip in the topbar, or in the composer bar.
- The card in the empty state, or the notice above the composer when nothing is open.
- The file panel, the command palette, or Cmd/Ctrl+O.

The dialog lists the projects you have connected before, so reopening is one click. A bridge that already has a project selected is adopted on load, so a local Kiln comes back up connected instead of asking again.

Three ways to connect:

| Method | Files | Shell and git |
| --- | --- | --- |
| Path on this machine | Yes | Yes, through the bridge |
| Folder picker (Chromium) | Yes | No |
| Paired remote bridge | Yes | Yes, on that machine |

Recent projects and folder handles are stored in this browser. Nothing is uploaded, and a folder handle never works in a different browser or profile.

## Deploy

```bash
npm run build
npm start
```

Set `KILN_BRIDGE_TOKEN_FILE` only on a machine that should proxy to a local bridge. Do not commit `.kiln/` or `.env`. Kiln has no model API key of its own. Model calls go through Puter.js in the browser and are billed to the signed-in Puter user.

A hosted Kiln cannot see the visitor's computer. To edit a local project from a hosted app, the visitor runs `npm run bridge` on that computer and pairs the browser with the code the bridge prints.

## Permission modes

The mode is stored per conversation and enforced in the tool layer immediately before the tool runs. The buttons are not the enforcement.

- **Ask Every Time.** Approval before every mutating or privileged action.
- **Auto-Edit Only.** File creates and edits proceed. Shell, delete, rename, git writes, installs, and network calls still ask.
- **Full Access.** The loop continues. Catastrophic commands are blocked. Dangerous ones, such as force-push or `git reset --hard`, still ask.

A denial comes back to the model as a tool error with code `permission_denied`. The agent is instructed not to retry that action. Remembering an allow stores a session rule for that exact command or path. It does not survive a reload.

## Tools

The agent has a fixed tool set. File tools create parent directories, and every backend — bridge, folder picker, in-memory — reports the same typed errors (`not_found`, `path_escape`, `already_exists`, `forbidden`), so the model sees one vocabulary no matter how the project is connected.

- Files: `Read`, `Write`, `Edit`, `MultiEdit` (several exact replacements in one atomic pass), `Delete`, `Move`, `Glob`, `Grep`, `LS`, `Stat`
- Shell and git: `Bash` (foreground or background), `BashOutput`, `TaskStop`, `GitStatus`, `GitDiff`, `GitLog`
- Planning and help: `TodoWrite`, `AskUserQuestion`, `Agent` (explore, plan, or general subagents), `Skill`, `ReportFindings`
- Web: `WebFetch`, `WebSearch`

Bridge writes are atomic: content is staged in a temp file and renamed over the target, so a crash mid-write cannot leave a half-written file. Stopping the bridge (Ctrl+C or a supervisor signal) also stops the commands it started. If the model repeats the exact same failing tool call three times in a row, the loop refuses it and ends the turn with an explanation instead of retrying forever.

## What gets stored

Conversation titles, messages, and compact tool cards live in IndexedDB in this browser. Large command output and original file contents are trimmed before save. File contents are not sent to a model unless the agent reads them for the task. Environment variables are filtered by the bridge, and secret-like command output is redacted before the model sees it.

## Shortcuts

Enter sends. Shift+Enter adds a line. Escape stops the turn. Cmd/Ctrl+O opens a project. Cmd/Ctrl+B toggles the sidebar. Cmd/Ctrl+K opens the palette. Cmd/Ctrl+\\ toggles the file panel. Cmd/Ctrl+, opens settings. Cmd/Ctrl+Shift+M opens the model picker.
