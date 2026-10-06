# Project M

Visual macro builder for Windows. Chain triggers, inputs, and actions on a node graph, then run them with a single click.

Built with [Tauri 2](https://tauri.app) + React + Rust.

## Features

- **Node-graph editor** — drag-and-drop triggers, input automation, loops, conditions, pixel vision, AHK IPC, and a sandboxed JS/AHK script step.
- **JSON macro format** — each macro is a single `macro.json` file. Easy to back up, edit, and share.
- **Import macros** — import one or more `.json` macro files at a time.
- **Auto-update** — checks GitHub Releases on launch, downloads in the background, prompts to restart.
- **Force-stop hotkey** — global hotkey (default `F8`) halts any running macro from anywhere.

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
npm run tauri dev      # dev mode with HMR
npm run tauri build    # production installer
```

## Project layout

```
src/                       # React frontend
  components/              # UI components
    EditorPage.tsx         # node-graph editor + run/stop toolbar
    ViewMacroModal.tsx     # macro details / variables editor
  App.tsx                  # main app shell

src-tauri/                 # Rust backend
  src/
    main.rs                # Tauri builder, command handlers
    macros_fs.rs           # macro file I/O
    engine.rs              # macro runtime
    nodes/                 # one file per node type
  tauri.conf.json          # window config, bundle settings
  capabilities/default.json

tools/
  ipc-listener/            # AHK IPC listener (exe + ahk script)
```

## Configuration

Settings live in the OS app-data dir:

- Windows: `%APPDATA%\com.herra-atlas.project-m\`

`settings.json` contains:

- `forceStopKeybind` — global hotkey string (default `F8`)
- `window` — last position and size
- `kiloApiKey` — optional API key for AI features
- `aiSystemPrompt` — optional custom system prompt
- `aiPermissions` — mutation permissions

Macros are stored at:

- `%APPDATA%\com.herra-atlas.project-m\macros\<id>\macro.json`

Runtime logs per macro:

- `macros/<id>/logs.jsonl`

## Node types

| Node | Description |
|------|-------------|
| `manual-start` | Entry point |
| `hotkey-trigger` | Fires on key press |
| `timer-trigger` | Delay or clock-time trigger |
| `key-press` / `key-hold` | Keyboard input |
| `mouse-click` / `mouse-move` / `mouse-drag` / `mouse-hold-sweep` | Mouse input |
| `pixel-scan` / `pixel-watch` | Color detection in a region |
| `if` / `while` | Condition blocks |
| `loop` / `break` | Repetition |
| `variable` | Define/override a variable |
| `delay` / `pause` | Timing |
| `log` | Emit to Logs panel |
| `ipc-command` | Send to AHK `AHK_IPC` window |
| `script` | Sandboxed QuickJS |
| `logic-gate` | AND/OR stub |

## License

[MIT](LICENSE)
