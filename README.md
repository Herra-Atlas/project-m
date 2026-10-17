# Project M

Visual macro builder for Windows. Chain triggers, inputs, and actions on a node graph, then run them with a single click.

Built with [Tauri 2](https://tauri.app) + React + Rust.

## Features

- **Node-graph editor** — drag-and-drop triggers, input automation, loops, conditions, pixel vision, AHK IPC, and a sandboxed JavaScript script step.
- **JSON macro format** — each macro is a single `macro.json` file. Easy to back up, edit, and share.
- **Import macros** — import one or more `.json` macro files at a time.
- **MCP server (built in)** — AI agents like Claude can create, edit, validate, and delete macros over HTTP. Toggle in Settings → Advanced.
- **GitHub update checker** — checks [GitHub Releases](https://github.com/herra-atlas/project-m/releases) on launch and every 6 hours, shows a banner with a link to download the new version.
- **Force-stop hotkey** — global hotkey (default `F8`) halts any running macro from anywhere.
- **Live logs** — per-macro `logs.jsonl` plus a Logs panel in the editor while running.

## Installation

**Windows:** download the latest installer:

<p align="left">
  <a href="https://github.com/herra-atlas/project-m/releases/latest">
    <img alt="Download for Windows" src="https://img.shields.io/badge/Download-Windows%20%F0%9F%AA%9F-22C55E?style=for-the-badge&logo=windows&logoColor=white" />
  </a>
</p>

Click the badge to open the Releases page. Download `Project.M_<version>_x64-setup.exe`.

> The installer is **unsigned**, so Windows SmartScreen will warn the first time. Click **More info → Run anyway**.

## Development

Prerequisites:

- Node 20+
- Rust toolchain (`rustup`)
- Windows: Microsoft C++ Build Tools + WebView2

```bash
git clone https://github.com/herra-atlas/project-m
cd project-m
npm install
npm run tauri dev      # dev mode with HMR on http://localhost:43125
npm run tauri build    # production installer
```

Port map (v0.2.0+):

| Port | Use |
|---|---|
| 43125 | Vite dev server / frontend |
| 43126 | MCP server (`http://127.0.0.1:43126/mcp`) |

## Project layout

```
src/                       # React frontend
  components/              # UI components
    EditorPage.tsx         # node-graph editor + run/stop toolbar
    ViewMacroModal.tsx     # macro details / variables editor
    LogsPanel.tsx          # live log output for a running macro
    useUpdater.ts          # GitHub release check + update banner
  App.tsx                  # main app shell, settings tabs

src-tauri/                 # Rust backend
  src/
    main.rs                # Tauri builder, command handlers, settings
    macros_fs.rs           # macro file I/O (settings, macros dir)
    engine.rs              # macro runtime, variable substitution
    mcp_server.rs          # HTTP MCP server (axum, port 43126)
    nodes/                 # one file per node type
  tauri.conf.json          # window config, bundle settings
  capabilities/default.json

tools/
  ipc-listener/            # AHK IPC listener (exe + ahk script)
```

## Configuration

App data lives in the OS app-data dir:

- Windows: `%APPDATA%\com.herra-atlas.project-m\`

`settings.json` keys:

| Key | What it does |
|---|---|
| `forceStopKeybind` | Global Force Stop hotkey string (default `F8`) |
| `mcpEnabled` | Whether the MCP server starts on launch (default `true`) |
| `window` | Last window position and size |

Other settings tabs UI-only for now: Common holds the hotkey, Advanced holds the MCP toggle, System has "Check now" / "Open releases page" buttons, Security is a placeholder.

Macros are stored at:

- `%APPDATA%\com.herra-atlas.project-m\macros\<id>\macro.json`

Runtime logs per macro:

- `%APPDATA%\com.herra-atlas.project-m\macros\<id>\logs.jsonl`

## MCP server

A JSON-RPC MCP server runs inside the app on startup (unless disabled). Point your AI client at the Streamable HTTP endpoint:

```json
{
  "mcpServers": {
    "project-m": {
      "type": "http",
      "url": "http://127.0.0.1:43126/mcp"
    }
  }
}
```

Tools exposed:

| Tool | What it does |
|---|---|
| `list_macros` | List all macros with id, title, description |
| `get_macro` | Read a macro's full JSON (nodes, connections, fields) |
| `create_macro` | Create a new macro (id, optional title/description) |
| `save_macro` | Write the full macro body `{ id, title, description, nodes, connections }` |
| `delete_macro` | Delete a macro |
| `validate_macro` | Check for unknown node types, duplicate ids, dangling connections, missing `manual-start`; returns `{ errors, warnings, valid }` |
| `node_help` | Every node type and its `fields` keys, plus connection and `$variable` syntax |

Macros created or edited over MCP appear in the UI automatically (the app listens for change events and reloads the library). No restart needed.

### Macro JSON shape

```jsonc
{
  "id": "fishing-reel",          // sanitized to [a-zA-Z0-9_-] for the folder name
  "title": "Fishing reel",
  "description": "example",
  "nodes": [
    { "id": "start", "type": "manual-start", "x": 0, "y": 0, "fields": {} },
    { "id": "press", "type": "key-press", "x": 200, "y": 0, "fields": { "key": "F" } }
  ],
  "connections": [ { "from": "start", "to": "press" } ]
}
```

Variables: set a value with a `variable` node, then reference it anywhere with `$name` or `$nodeId.outputName`. Unresolved references are left as literal text.

## Node types

| Node | Description |
|------|-------------|
| `manual-start` | Entry point (required — macro won't run without one) |
| `hotkey-trigger` | Blocks until a global key press; the matched key is swallowed |
| `timer-trigger` | `interval` (ms) or `clock` ("HH:MM") trigger |
| `if` / `while` | Block on a `$variable` comparison (equals / not equals / contains / greater than / less than) |
| `pixel-scan` | Scan a region for a color with per-channel tolerance; outputs match coords and blob centroid |
| `pixel-watch` | Blocks until the color appears (max-GDI-speed polling, no sleep) with a timeout |
| `logic-gate` | AND/OR combine — currently a no-op stub |
| `key-press` / `key-hold` | Keyboard input |
| `ipc-command` | Send a command to the AHK `AHK_IPC` window (listener auto-prompts to start) |
| `mouse-move` / `mouse-click` / `mouse-drag` / `mouse-hold-sweep` | Mouse input |
| `loop` / `break` | Repeat a body n times (0 = infinite) / stop the nearest loop |
| `variable` | Define or override a variable |
| `delay` / `pause` | Timing |
| `log` | Emit to the Logs panel |
| `script` | Sandboxed QuickJS — read/write `$vars`, write `$out`, call `$log`, `$sleep`, see script node docs for the API |

## Release process

1. Bump `version` in `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml` so they all match.
2. `npm run tauri build` → the NSIS installer appears in `src-tauri/target/release/bundle/nsis/`.
3. Commit, push, then create a GitHub release named `v<version>` and upload the installer.

Users on older versions see an update banner automatically.

## License

[MIT](LICENSE)
