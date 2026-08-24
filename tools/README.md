# Project M

Tauri v2 desktop macro automation tool. Node-based custom macro editor with real OS-level execution through a Rust backend.

## Instructions

Working on this project — agents and humans:

- **Read only what you need to make the change.** Don't skim entire modules or reload the codebase into context. Open the file(s) you actually have to touch, plus any contract they declare (function signatures, IPC types, shared schemas).
- **Write only high quality code.** Clear naming, no dead/unused exports, no copy-paste duplication, idiomatic patterns for the language, minimal diff that does the job without touching unrelated code.
- **Tailwind for CSS.** Style components with Tailwind utility classes inline in JSX. Avoid separate CSS files unless one of the documented exceptions below applies.

  Allowed exceptions (separate `.css` only when unavoidable):
  - **Complex animations** — keyframes/transitions not expressible as utilities (e.g. chained multi-stage motion).
  - **Third-party library overrides** — forcing styles onto a vendor component that doesn't expose a className hook.
  - **Very custom styles** that would be cumbersome with utilities (rare; prefer a `@apply` block or an inline `style` prop first).
  - **Global styles** — fonts, CSS resets, body/html defaults — these belong in `src/index.css`.

- **Component layout.** UI components live in `src/components/`, one component per file, PascalCase filenames (`MacroCard.tsx`, `EditorCanvas.tsx`). Re-export from `src/components/index.ts` if grouping helps.

## Architecture

- **Frontend**: Single-page Vite app (React + TypeScript + Tailwind) rendered in WebView2
- **Backend**: Rust macro engine in Tauri — handles all OS input and pixel capture
- **IPC**: `invoke()` from frontend to Rust commands; WebView is UI-only
- **Execution model**: engine runs on a dedicated `std::thread`, talks to a multi-thread `tokio::Runtime`. Each node `run()` is `async fn` and returns a future. Children of any node are **spawned concurrently** via `tokio::task::JoinSet` — two outgoing lines from the same node run in parallel.
- **Shared state**: `Engine` is `Clone`; outputs/variables live in `Arc<Mutex<HashMap<…>>>`, stop flag in `Arc<AtomicBool>`, break signal in `Arc<AtomicUsize>`. Each parallel task gets its own clone of the shared state.

## Tech Stack

- **Tauri**: v2.11+
- **Rust**: edition 2021
- **Frontend**: Vite + React 18 + TypeScript + Tailwind 3
- **Input**: `enigo` (cross-platform keyboard/mouse)
- **Screen capture**: GDI `BitBlt` + `GetDIBits` with cached HDC/bitmap per thread (DXGI was unreliable for layered game windows)
- **Sandbox scripting**: QuickJS via `rquickjs` (statically linked, ~1 ms cold-start, no install)
- **Async**: `tokio` (multi-thread runtime, 4 workers)

## Project Structure

```
macro/
├── package.json                  # npm scripts
├── vite.config.ts                # Vite config
├── src/
│   └── index.html                # Frontend: node editor, macros page, modals
├── src-tauri/
│   ├── Cargo.toml                # Rust dependencies
│   ├── tauri.conf.json           # Window config, dev URL
│   └── src/
│       ├── main.rs               # Tauri entry, registers commands
│       ├── macro_data.rs         # Shared types: Node, Connection, MacroData
│       ├── engine.rs             # Engine: loads macro, runs nodes in parallel
│       ├── input.rs              # OS input wrapper: keyboard, mouse, pixel capture
│       ├── pick.rs               # WH_MOUSE_LL global hook for color picker
│       ├── overlay.rs            # Topmost click-through region highlight
│       ├── ahk_ipc.rs            # AutoHotkey IPC window messaging
│       └── nodes/                # One file per node type
│           ├── mod.rs            # Node registry / dispatcher
│           ├── manual_start.rs
│           ├── hotkey_trigger.rs # Polls GetAsyncKeyState (no global hook)
│           ├── timer_trigger.rs
│           ├── if_node.rs        # Block until $variable OP value matches
│           ├── while_node.rs     # Block while $variable OP value matches
│           ├── pixel_scan.rs     # One-shot pixel-color region scan
│           ├── pixel_watch.rs    # Background-thread low-latency pixel watcher
│           ├── logic_gate.rs     # AND/OR stub
│           ├── key_press.rs
│           ├── key_hold.rs
│           ├── ipc_command.rs    # AHK IPC window
│           ├── mouse_move.rs
│           ├── mouse_click.rs
│           ├── mouse_drag.rs
│           ├── mouse_hold_sweep.rs
│           ├── loop_node.rs      # Body children run in parallel
│           ├── break_node.rs     # Scoped: each loop consumes one signal
│           ├── variable.rs
│           ├── pause.rs
│           ├── delay.rs
│           ├── log.rs
│           └── script.rs         # Sandboxed QuickJS executor
├── dist/                         # Vite production output (gitignored)
└── tools/                        # Human/agent documentation
    ├── README.md                 # Project overview (was previously at repo root)
    ├── macro.md                  # How to author macros (for AI agents)
    └── presets/                  # Runnable example macro JSON files
        ├── kalastus.json         # Roblox fishing bot (green→red watch)
        ├── koksu.json            # Same pattern with shorter cycle
        ├── hold-lmb-until-6.json # Loop LMB clicks until "6" pressed
        └── script-smoke.json     # Variable → script → log
```

## Node Types

Every node declares `outputs: NodeOutput[]` (typed outputs with `$nodeId.outputName` references — see "Substitution" below). Outputs are how downstream nodes read prior node state.

| Node | Description |
|------|-------------|
| `manual-start` | Entry point for macro execution |
| `hotkey-trigger` | Polls `GetAsyncKeyState` every 20 ms, fires on rising edge of the configured key |
| `timer-trigger` | Delay or clock-time trigger |
| `if` | Block until `$variable OP value` becomes true, then continue |
| `while` | Block while `$variable OP value` is true; exit when false |
| `pixel-scan` | One-shot region scan for a colour with tolerance; emits `firstMatchX/Y` + optional `centerX/Y` |
| `pixel-watch` | Background-thread low-latency watcher for a colour match (no interval sleep) |
| `logic-gate` | AND / OR stub |
| `key-press` | Send one key press |
| `key-hold` | Hold a key for duration |
| `ipc-command` | Raw IPC command to AHK `AHK_IPC` window |
| `mouse-move` | Move cursor to coordinates |
| `mouse-click` | Left / right / middle click, with count and inter-click delay |
| `mouse-drag` | Press, move, release |
| `mouse-hold-sweep` | Move while holding button |
| `loop` | Repeat body N times (children run in parallel each iteration) |
| `break` | Scoped: increments `break_signal`; the innermost loop consumes one and exits |
| `variable` | Set a global variable |
| `pause` | Wait until resumed (no UI resume yet) |
| `delay` | Wait milliseconds |
| `log` | Emit a `log` event to the editor Logs panel |
| `script` | Sandboxed QuickJS executor — read/write globals, write typed outputs, log, sleep, stop |

## Substitution

Field values support `$variable` and `$nodeId.outputName` references, resolved at execution time:

- `$name` → looks up `name` in global variables, then in node outputs (legacy fallback)
- `$nodeId.outputName` → looks up the typed output of the named node (unambiguous)

Example: in a log node, `$n-green-pixel.firstMatchX` always reads the `firstMatchX` output of node `n-green-pixel`, regardless of which node ran most recently.

Special exception: `if` and `while` nodes re-resolve their `variable` field on every poll cycle so they can react to fresh output values from earlier in the chain.

## Execution semantics

- **Children run in parallel.** If a node has 2 outgoing connections, both branches fire concurrently. Same for the body of a `loop` node — its children all spawn into a `JoinSet` per iteration. Use this to interleave a long-running action (mouse-click loop) with a watcher (hotkey-trigger / pixel-watch) and react to it.
- **Cycle detection** is per-branch: each parallel task carries its own `Vec<String>` of visited nodes.
- **Stop propagation**: any task can set `stop_requested` and the JoinSet aborts the rest. `break_signal` is checked at the top of each loop iteration.
- **Variable pre-load**: `variable` nodes' `(name, value)` are loaded into the global `variables` map at `Engine::load()` so they're available even if the variable node is not in the execution flow.

## Frontend Pages

- **Home**: Quick actions (New Macro)
- **Macros**: Grid of saved macro cards (title + description). Single Start/Stop toggle in the top-right; click-to-select, click-outside to deselect; right-click context menu (Run / Edit / View / Export / Delete); auto-detected icon from dominant node type (mouse / keyboard / workflow / folder); optional "Created with AI" badge.
- **Editor**: Node palette + canvas + toolbar (Save / Export / Import). Nodes drag from the palette to the canvas, pan/zoom the canvas, connect via port dots. Live `LogsPanel` docked at the bottom; `NodeInspector` slides up showing the selected node's typed outputs and their current values.
- **Settings**: Minimal settings placeholder

## IPC Commands

| Command | Input | Output | Description |
|---------|-------|--------|-------------|
| `run_macro` | `id: String`, `data: MacroData` | `Result<(), String>` | Starts macro execution in background; emits `macro-started` with the id |
| `stop_macro` | — | `Result<(), String>` | Signals running macro to stop |
| `is_running` | — | `bool` | Whether any macro is currently running |
| `get_running_macro_id` | — | `Option<String>` | Recovers running-macro id after frontend hot-reload |
| `get_mouse_info` | — | `(x, y, hex)` | Current cursor position + pixel colour under it |
| `check_ahk` | — | `bool` | Whether `AHK_IPC` window is currently listening |
| `save_macro` / `list_macros` / `delete_macro_file` | id / `payload: String` | `Result<(), String>` | Persist macros to `%APPDATA%\com.macro.app\macros\` |
| `save_settings` / `load_settings` | `payload: String` | `Result<(), String>` | Persist settings.json |
| `save_app_state` / `load_app_state` | `payload: String` | `Result<(), String>` | Persist state.json (open macros + current view) |
| `pick::start_pixel_pick` / `pick::stop_pixel_pick` | — | — | Install/uninstall `WH_MOUSE_LL` hook for the colour picker |
| `show_region_overlay` / `hide_region_overlay` | x1, y1, x2, y2 | — | Topmost click-through border around a pixel-scan region |

## Frontend Events (Tauri `listen`)

| Event | Payload | Description |
|-------|---------|-------------|
| `macro-started` | `String` (macro id) | Fires when `run_macro` spawns the engine thread |
| `macro-finished` | `String` (macro id) | Fires when the engine thread exits (success, error, panic, or stop) |
| `node-executing` | `{ nodeId: String }` | Emitted at the start of each node's `run()` |
| `node-outputs` | `{ nodeId, outputs: [(key, value)] }` | Snapshot of all outputs after each node completes |
| `log` | `{ message, nodeId? }` | Log node / script `$log` |
| `pick-pixel` | `{ x, y, hex, count }` | Colour picker (each right-click while picking) |

## Macro Data Format

```json
{
  "title": "My macro",
  "description": "Optional",
  "nodes": [
    {
      "id": "n-start",
      "type": "manual-start",
      "x": 80, "y": 240,
      "fields": {}
    },
    {
      "id": "n-click",
      "type": "mouse-click",
      "x": 320, "y": 240,
      "fields": { "button": "left", "count": "10000", "delayMs": "50" }
    }
  ],
  "connections": [
    { "from": "n-start", "to": "n-click" }
  ]
}
```

Connections are ordered — first outgoing connection from a node is port `[0]`, second is port `[1]`, etc. Use this for nodes that branch based on a condition (`pixel-scan`, `if`, `while`).

## Build

```powershell
# Debug (dev server + hot reload)
npm run tauri dev

# Release
npm run tauri build
```

## Requirements

- Windows 10 1809+ / Windows 11 (WebView2)
- Rust 1.70+ (`rustup default stable`)
- Node.js 18+ / npm
- `C:\Program Files\Git\usr\bin\patch.exe` on PATH for `rquickjs-sys` build script

## Notes

- WebView is UI-only; all macro execution happens in Rust
- Pixel capture uses GDI `BitBlt(SRCCOPY | CAPTUREBLT)` to include hardware-accelerated / DirectX layers (standard `BitBlt` skips them)
- `enigo` uses `SendInput` for low-latency keyboard/mouse
- Engine runs macros on a dedicated OS thread with its own multi-thread `tokio::Runtime`; parallel node children are scheduled on the runtime's worker threads
- Logs go to `%LOCALAPPDATA%\com.macro.app\logs\Project M.log` via `tauri_plugin_log`
- Tauri `identifier` is `com.macro.app` (must stay — installer / WebView2 / appdata paths depend on it)

## Known Issues / TODO

Already-fixed or non-issues, kept for historical reference:

1. ~~`engine.rs:97` — creates a new `tokio::Runtime` per node~~ → fixed in `Engine::new`; one multi-thread runtime per macro run.
2. ~~`engine.rs:64` — `active_path: HashSet` cycle detection silently returns `Ok`~~ → replaced with per-task `Vec<String>` path stack.
3. ~~`input.rs:69` — `get_pixel_color` uses `screenshots::Screen::from_point` while `get_mouse_info` uses raw GDI~~ → both now use raw GDI; `screenshots` crate dropped.
4. ~~`input.rs:79` — `capture_region` (raw GDI `BitBlt` + `GetDIBits`) appears unused~~ → heavily used by `pixel_scan.rs` and `pixel_watch.rs` with per-thread cached HDC/bitmap.
5. `macro_data.rs:9` — `Node { x, y }` typed as `i32`; rounding happens in `App.tsx` before invoke. Cosmetic.
6. `vite.config.ts:6` — `outDir: '../src-tauri/../dist'`. Cosmetic.
7. `index.html` — three overlapping canvas `pointerdown` handlers; works but fragile. Cosmetic.
8. `index.html` — two duplicate `Escape` keydown handlers. Cosmetic.
9. ~~`index.html` — `pixel-scan` missing from Node Types table~~ → now in this README.
10. `engine.rs` — `node-executing` is emitted before `run_node` runs; the inspector's live-value flash only happens at node start. Cosmetic.
11. `main.rs` — `GetPixel(HWND_DESKTOP, …)` may return `CLR_INVALID` on DWM-composed / DPI-mixed multi-monitor setups; helper panel colour read is best-effort.
12. Macros list is persisted only via the auto-saved `state.json`; no library-wide export/import (only per-macro).
13. `src-tauri/src/nodes/ipc_command.rs:40` — `Box::leak(command_utf16.into_boxed_slice())` permanently leaks the message buffer on every IPC send. High-frequency IPC macros grow RSS without bound.
14. `src-tauri/src/input.rs:148` — `Input::type_text` is dead code. Either wire a `type-text` node to it or delete.

---

### Pending — author approval required

**If author accepts to fix these ONLY then you may fix them** (do not touch without an explicit go-ahead):

- Item **5** (i32 → f32 positions): cosmetic, low priority.
- Item **6** (`outDir` cleanup): cosmetic.
- Items **7**, **8**, **10** (DOM handler dedup, render-time node-executing): cosmetic / refactor.
- Item **11** (`GetPixel` DWM fallback): fallback to `BitBlt` + `GetDIBits` if `GetPixel` returns `CLR_INVALID`.
- Item **12** (library-wide import/export): not blocking, can wait.
- Item **13** (`Box::leak` in `ipc_command.rs`) — requires deciding between (a) keep the buffer alive with a reusable `Vec<u16>` in the node's local state, or (b) copy into `WM_COPYDATA` via a stack buffer + `GlobalAlloc`/`GlobalFree` round-trip, or (c) switch to a pipe / shared-memory channel. Author should pick the trade-off.
- Item **14** (`type_text`) — author decides whether to add a `type-text` node type or just delete the method.