# Macro Authoring Guide (for AI agents)

This document is the single source of truth for writing **Project M** macro
files. It is written for an LLM that needs to produce a valid `.json` macro
that the Tauri engine will execute on Windows. Read it once, end to end,
before generating any macro. If the rules below conflict with the editor UI
description or the README, **this file wins** — it is the most current spec.

The app is a node-graph macro runtime: every macro is a JSON file describing
nodes and connections. There is no scripting layer and no DSL — just nodes
wired together with `$variable` substitution.

---

## 1. What a macro file looks like

A macro is one JSON object saved by the app as
`%APPDATA%\com.macro.app\macros\{id}.json`. The shape:

```json
{
  "id": "auto-generated-uuid",
  "title": "Short human title",
  "description": "One-line description shown on the macro card.",
  "nodes": [
    { "id": "node-1", "type": "manual-start", "x": 100, "y": 200, "fields": {} },
    { "id": "node-2", "type": "mouse-click", "x": 100, "y": 320, "fields": { "button": "left", "count": "1", "delayMs": "16" } }
  ],
  "connections": [
    { "from": "node-1", "to": "node-2" }
  ],
  "icon": "auto",
  "madeByAi": true
}
```

Field rules:

- **`id`** *(required, string)* — unique per macro. The editor generates
  `node-${timestamp}-${random}`, but any unique string is fine. Node IDs are
  referenced by `connections[].from` and `connections[].to`.
- **`title`** *(required, string)*
- **`description`** *(required, string)*
- **`nodes[]`** *(required, array)* — every node in the graph. See §3.
- **`connections[]`** *(required, array)* — directed edges. The engine
  fans out across all outgoing connections of a node, in array order.
  See §2 for output ordering rules.
- **`icon`** *(optional, string)* — one of `"auto"`, `"mouse"`, `"keyboard"`,
  `"workflow"`, `"gamepad"`, `"timer"`, `"wrench"`, `"zap"`, `"circle"`,
  `"folder"`, `"sparkles"`. Use `"auto"` unless the user asked for a
  specific icon. Omit to mean `"auto"`.
- **`madeByAi`** *(optional, boolean)* — set `true` only if the user or
  another AI explicitly asked for it. If unsure, **omit the field**.

There is exactly **one** `manual-start` node per macro. It is the entry
point — the engine looks it up by type and walks the graph from there.

---

## 2. How execution works

Read this once. It is the single most important part of the spec.

1. The engine finds the `manual-start` node and calls `execute_node` on it.
2. `execute_node` clones the node, runs `$variable` substitution on its
   fields, then dispatches by `type` to a Rust implementation.
3. The implementation returns a list of **next node IDs**. The engine
   visits each of them in order, fully depth-first.
4. A node with no outgoing connections ends that branch.

Output ordering matters for two node types:

- **`pixel-scan`** has two outputs in array order:
  - `outgoing[0]` — taken when the scan finds ≥ `targetCount` matches
  - `outgoing[1]` — taken when it doesn't
  Add the "found" connection first, the "not found" second.

- **All other nodes** have a single logical output — all outgoing
  connections fire in array order.

Recursion guards: the engine tracks a per-call `active_path` set, so if a
graph contains a true cycle, the second visit to a node becomes a no-op.
**Do not design cycles on purpose.** Use a `loop` node for repetition.

Stop is global: setting `stop_requested` (the macro Stop button in the
app) aborts the next loop check inside any blocking node (delay, drag,
loop, if, while, pause, pixel-scan, etc.).

---

## 3. Node reference

Every node below lists its `type` string, what it does, its fields, and
its output behaviour. Field `default` is what the editor shows when the
field is empty. Field `type` is one of `text | number | select`.

Numeric fields are written as **strings** in JSON because they are stored
that way in the editor and parsed by the Rust helpers `field_u64` and
`field_i64`. Don't worry about quoting numbers — `"16"` is correct.

### Start group (exactly one entry point required)

#### `manual-start`
- Fields: none
- Output: all outgoing connections

This is the only allowed entry point. Always include exactly one.

#### `hotkey-trigger`
- Fields:
  - `key` *(text, default `"6"`)*
- Output: all outgoing (stub — currently blocks ~100 ms then continues)

#### `timer-trigger`
- Fields:
  - `mode` *(select, `"interval"` or `"clock"`, default `"interval"`)*
  - `intervalMs` *(number, default `"500"`) — shown when mode=interval*
  - `clockTime` *(text, default `"22:00"`) — shown when mode=clock, format `HH:MM`*
- Output: all outgoing (after the delay elapses)

### If group

#### `if`
Blocks until the condition becomes true, then continues. Reference any
`$variable` from a prior node and compare it against a value.
- Fields:
  - `variable` *(text, default `"$status"`) — the variable name to read (with or without leading `$`)*
  - `operator` *(select, one of `"equals" | "not equals" | "contains" | "greater than" | "less than"`, default `"equals"`)*
  - `value` *(text, default `""`) — comparison value*
  - `pollMs` *(number, default `"50"`) — how often to re-check the variable*
- Output: all outgoing, once the condition becomes true.
- Operator semantics:
  - `equals` / `not equals`: string compare
  - `contains`: substring check
  - `greater than` / `less than`: numeric compare if both sides parse as numbers, otherwise string compare

Example: `variable=$status, operator=equals, value=found, pollMs=20` blocks
until `$status` becomes `"found"`.

#### `while`
Blocks while the condition is true; continues as soon as it becomes false.
Same fields as `if`.
- Output: all outgoing, once the condition becomes false.

#### `pixel-scan`
Scans a rectangle for a color with per-channel RGB tolerance. Two outputs.
- Fields:
  - `fromX`, `fromY` *(number, default `0`, subscripts x₁/y₁)*
  - `toX`, `toY` *(number, default `100`, subscripts x₂/y₂)*
  - `color` *(text, default `"#FF0000"`)*
  - `rTol`, `gTol`, `bTol` *(number, default `10`, each clamped to 0–255)*
- Outputs (in this exact order):
  - `outgoing[0]` — **found**, when at least 1 pixel in the rectangle
    matches the target within tolerance
  - `outgoing[1]` — **not found**
- Public `$variable` outputs:
  - `$status` = `"found"` or `"not found"`
  - `$whereX`, `$whereY` = coords of the first matching pixel (absolute screen)
- Width/height are derived as `|toX − fromX|` × `|toY − fromY|`; origin is
  the min corner. **Swapping from/to just flips the rectangle, both work.**
- For single-pixel scans, set `fromX == toX` and `fromY == toY` (the engine
  clamps width/height to a minimum of 1).

#### `logic-gate`
- Fields:
  - `mode` *(select, `"and"` or `"or"`, default `"and"`)*
- Output: all outgoing. **This is a stub** — the mode field is not yet
  evaluated. Don't rely on AND/OR semantics; use pixel-scan's two outputs
  instead.

### Keyboard group

#### `key-press`
- Fields:
  - `key` *(text, default `"E"`)* — single key, letter/digit/Enter/etc.
- Output: all outgoing, after one key down+up.

#### `key-hold`
- Fields:
  - `key` *(text, default `"E"`)*
  - `durationMs` *(number, default `"500"`)*
- Output: all outgoing, after key down → sleep → key up.

#### `ipc-command`
Sends raw text to the AHK IPC window titled `AHK_IPC` via `WM_COPYDATA`.
The receiving AutoHotkey script is expected to parse the command string.
- Fields:
  - `command` *(text, default `"E"`)*
- Output: all outgoing. **Memory leak warning (TODO #13):** every IPC send
  leaks its command buffer; high-frequency IPC macros will grow RSS. Prefer
  `key-press` unless the user explicitly needs AHK IPC.

### Mouse group

#### `mouse-move`
- Fields:
  - `x`, `y` *(number, default `0`)*
- Output: all outgoing.

#### `mouse-click`
Clicks the current cursor position `count` times, with `delayMs` between
clicks. Chain with `mouse-move` first to click at a specific x/y.
- Fields:
  - `button` *(select, `"left" | "right" | "middle"`, default `"left"`)*
  - `count` *(number, default `"1"`)*
  - `delayMs` *(number, default `"16"` — Windows input floor)*
- Output: all outgoing. Note: `count=1000` produces ~1000 clicks, not 1999.

#### `mouse-drag`
Press, move (interpolated), release.
- Fields:
  - `fromX`, `fromY` *(number, default `0`, subscripts x₁/y₁)*
  - `toX`, `toY` *(number, default `100`, subscripts x₂/y₂)*
  - `button` *(select, default `"left"`)*
  - `durationMs` *(number, default `"300"`)*
- Output: all outgoing, after release.

#### `mouse-hold-sweep`
Move + hold a button + sweep + release. Used for "drag with hold" or
"spray" patterns. Same fields as `mouse-drag`.

### Tools group

#### `loop`
Repeats its body N times. Each iteration runs every outgoing node
depth-first, then waits `intervalMs` between iterations.
- Fields:
  - `intervalMs` *(number, default `"100"`)*
  - `loopCount` *(number, default `"1"`, `0` = infinite)*
- Output: nothing — the loop absorbs its outgoing connections as its body.

#### `break`
Exits the **nearest enclosing `loop`**. Does not abort the whole macro —
outer loops continue normally.
- Fields: none
- Output: none.

#### `variable`
Defines or overrides a named variable. **Defined variables are available
globally**, even if this node is not connected to anything — the engine
pre-loads every `variable` node on macro start.
- Fields:
  - `name` *(text, default `"counter"`)* — must match `[a-zA-Z_][a-zA-Z0-9_]*`
  - `value` *(text, default `"0"`)*
- Output: all outgoing.

#### `pause`
- Fields: none
- Output: all outgoing after the macro is stopped. **Pause only ends when
  Stop is pressed**, not by user keyboard. Use `delay` for timed pauses.

#### `delay`
- Fields:
  - `ms` *(number, default `"500"`)*
- Output: all outgoing after the delay.

#### `log`
Emits a `log` event to the frontend (visible in the Logs panel) and
prints to stderr.
- Fields:
  - `message` *(text, default `"Custom log"`)*
- Output: all outgoing. `$variable` references are substituted before
  emission.

#### `script`
Run sandboxed JavaScript inside an embedded QuickJS runtime. ~1 ms
cold-start, no installation (QuickJS is statically linked into the
binary). Use this when built-in nodes can't express the logic you need:
arithmetic over multiple outputs, conditional math, custom filtering,
state machines, etc.
- Fields:
  - `code` *(textarea, default is a small example)* — JavaScript source.
    Multiple lines. Return value (or last expression) becomes `$out.result`.
  - `timeoutMs` *(number, default `"5000"`)* — wall-clock cap. The script
    is aborted with an uncatchable exception if it runs longer.
  - `heapMb` *(number, default `"8"`, capped at 128)* — heap memory cap.
- Outputs (all dynamic, declared by what you assign in the script):
  - `status` — `"ok"` or `"error"`. Set automatically.
  - `result` — string form of the script's return value (or last expr).
  - Any name you write to `$out.<name>` becomes an output you can
    reference from later nodes as `$nodeId.<name>`.
- Sandbox: no `require`, no `fetch`, no `fs`, no `globalThis` leaks.
  The Context is `!Send`, so the engine is never borrowed from inside a
  JS callback — engine state is snapshotted into JS globals before eval,
  and writes you make through `$vars.*` / `$out.*` are drained back into
  the engine after eval completes.

**Exposed JS API** (set up by the prelude before your code runs):

| JS expression                         | What it does                              |
|---------------------------------------|-------------------------------------------|
| `$vars.<name>`                        | read a global variable (returns `undefined` if unset) |
| `$vars.<name> = <value>`              | write a global variable                   |
| `$out.<name> = <value>`               | declare a typed output on this node       |
| `$log(msg)`                           | push to the editor Logs panel             |
| `$sleep(ms)`                          | block this script for `ms` milliseconds (use `$sleep` between actions that need pacing) |
| `$engine.output("n-green.firstMatchX")` | read any other node's output            |
| `$engine.var("name")`                 | alias for `$vars.<name>`                  |
| `$stop()`                             | request the macro stop                    |

**Example:**
```js
// Read values the previous nodes wrote.
const gx = $vars.greenX;
const cx = $vars.centerX;

// Compute something the engine can't express directly.
const offset  = cx - gx;
const inRange = Math.abs(offset) < 5;

// Write back to globals AND declare outputs on this node.
$vars.lastOffset = offset;
$out.match    = inRange;
$out.offset   = offset;
$log(`gx=${gx} cx=${cx} offset=${offset} match=${inRange}`);

// Optional return value becomes $out.result.
return inRange ? "matched" : "missed";
```

A complete working preset lives at
`tools/presets/script-smoke.json`.

---

## 4. `$variable` substitution

Any **string** field value may contain `$...` references. They are
substituted at execution time against the in-memory variable + output
maps. Two reference forms are supported:

### `$name` — flat (variables only)

```json
"value": "$counter"
```

- Looks up `counter` in the **flat variables** map.
- Set by the `variable` node, or by `pixel-scan`'s `firstMatchXVar` /
  `firstMatchYVar` / `resultVar` fields.
- Variable names match `[a-zA-Z_][a-zA-Z0-9_-]*`.

### `$nodeId.outputName` — namespaced (any prior node's output)

```json
"value": "$n-green-pixel.status"
"value": "$n-green-pixel.whereX"
"value": "$n-red-pixel.status"
```

- Looks up `{nodeId}.{outputName}` in the **outputs** map.
- Every node declares typed outputs (see `outputs` on each entry in
  §3). After a node runs, its outputs are reachable from any later
  node's fields using `$nodeId.outputName`.
- Use this when more than one prior node produces the same output
  name (e.g. multiple `pixel-scan` nodes each setting `$status`). The
  flat form `$status` is no longer used for node outputs — namespacing
  is mandatory.
- IDs may include hyphens (e.g. `node-1749123456-a1b2`).

### Resolution rules

- Numeric fields are also substituted, but the result must parse as a
  number (otherwise the field's default is used).
- Unknown names are left literal (e.g. `$foo` stays `$foo`) so the field
  border in the editor lights up red — useful for catching typos.
- Strings are stored as JSON strings; numbers as JSON numbers. They
  round-trip cleanly through `field_u64`/`field_i64`/`field_str`.

### When to use which

- Use `$name` (flat) only for `variable` node values you explicitly
  defined.
- Use `$nodeId.outputName` for anything read from a node that produces
  outputs (pixel-scan, ipc-command, if/while, loop, mouse-*, key-*,
  delay, log, etc.).
- The `if` / `while` nodes' `variable` field accepts either form.

### Example — fish-bot with named references

```
n-green-pixel ──► n-red-pixel (fromX=$n-green-pixel.whereX, fromY=$n-green-pixel.whereY)
                  └─► n-log (message="green=$n-green-pixel.status red=$n-red-pixel.status")
```

The log message will literally read something like
`green=found red=not found` — it never reads the wrong node's status.
output ports to branch flow, and pass coordinates as separate `variable`
nodes whose values you also reference from the `mouse-move` node.)

---

## 5. Authoring rules (do not violate)

1. **Always include exactly one `manual-start`.** It is the engine's
   required entry point. Multiple start nodes is undefined behaviour.
2. **Don't rely on `logic-gate`, `break`, or `pause` for control flow.**
   They are stubs. Use pixel-scan's found/not-found branches instead.
3. **Numeric fields are JSON strings.** Always quote: `"16"`, `"0"`,
   `"100"`. The Rust helpers parse them.
4. **Color strings are `#RRGGBB`.** Case is ignored at match time
   (`#FF0000` == `#ff0000`). 6 hex digits only — 3-digit shorthand is
   not parsed.
5. **Coordinates can be negative** (multi-monitor) and may use any
   integer in the range the OS accepts. The Rust type is `i32` cast from
   `i64`, so anything in int64 works except values that overflow i32.
6. **`pixel-scan` output ordering matters.** Found branch first,
   not-found branch second.
7. **Don't construct cycles.** They are silently broken by the engine.
   Use a `loop` node.
8. **`mouse-click` delayMs floor is 16 ms.** That is the OS limit for
   `SendInput` injection rate. Lower values are clamped.
9. **`ipc-command` leaks memory per send** (TODO #13). For internal
   macros prefer `key-press` and friends.
10. **Set `madeByAi: true` only when the user or pipeline asked for it.**
    It changes the UI badge and forces the Sparkles icon. Omit by default.

---

## 6. Minimal example — periodic autoclicker

A macro that, every 100 ms, clicks at a fixed coordinate:

```json
{
  "id": "autoclicker-100ms",
  "title": "Autoclicker 100ms",
  "description": "Clicks at (500, 400) every 100ms until stopped.",
  "icon": "auto",
  "nodes": [
    { "id": "start", "type": "manual-start", "x": 100, "y": 100, "fields": {} },
    { "id": "move",  "type": "mouse-move",   "x": 100, "y": 220, "fields": { "x": "500", "y": "400" } },
    { "id": "loop",  "type": "loop",          "x": 100, "y": 360, "fields": { "intervalMs": "100", "loopCount": "0" } },
    { "id": "click", "type": "mouse-click",   "x": 100, "y": 500, "fields": { "button": "left", "count": "1", "delayMs": "16" } }
  ],
  "connections": [
    { "from": "start", "to": "move" },
    { "from": "move",  "to": "loop" },
    { "from": "loop",  "to": "click" }
  ]
}
```

`loopCount: "0"` = infinite. The body (the `click` node) re-executes
forever; Stop ends it.

---

## 7. Decision tree for choosing nodes

When designing a macro, walk this list:

- **Where does it start?** → `manual-start` (always exactly one).
- **Does it need to wait?** → `timer-trigger` (delay or clock) or
  `delay` (one-shot pause).
- **Does it need to react to something on screen?** → `pixel-scan`
  (rectangle scan with tolerance, with found/not-found branches). For
  "wait for X to appear" combine a `pixel-scan` inside a `loop` that
  breaks once `$status == "found"`.
- **Does it need to wait for a `$variable` to satisfy a condition?**
  → `if` (block until true) or `while` (block while true).
  Reference the variable name (with or without leading `$`).
- **What action?**
  - Move cursor → `mouse-move`
  - Click → `mouse-click` (often preceded by `mouse-move` for fixed x/y)
  - Drag → `mouse-drag`
  - Drag-while-holding → `mouse-hold-sweep`
  - Type a key → `key-press`
  - Hold a key → `key-hold`
  - Talk to an AutoHotkey script → `ipc-command`
- **Repeat something?** → `loop` with outgoing connections forming the
  body. Use `loopCount: "0"` for infinite.
- **Share a value across nodes?** → `variable` (definition) +
  `$name` references (consumption).
- **Debug?** → `log` to print to the Logs panel.

---

## 8. Output ports summary

| Node              | Outputs                                        |
|-------------------|------------------------------------------------|
| `manual-start`    | all outgoing (fan out by array order)          |
| `hotkey-trigger`  | all outgoing                                   |
| `timer-trigger`   | all outgoing                                   |
| `if`              | all outgoing, once condition is true           |
| `while`           | all outgoing, once condition becomes false     |
| `pixel-scan`      | `[0]`=found, `[1]`=not found (**order matters**) |
| `logic-gate`      | all outgoing (stub, mode not yet evaluated)    |
| `key-press`       | all outgoing                                   |
| `key-hold`        | all outgoing                                   |
| `ipc-command`     | all outgoing                                   |
| `mouse-move`      | all outgoing                                   |
| `mouse-click`     | all outgoing                                   |
| `mouse-drag`      | all outgoing                                   |
| `mouse-hold-sweep`| all outgoing                                   |
| `loop`            | outgoing connections = loop body (no next)     |
| `break`           | none — exits nearest enclosing `loop`          |
| `variable`        | all outgoing                                   |
| `pause`           | all outgoing, only after Stop                  |
| `delay`           | all outgoing, after delay                      |
| `log`             | all outgoing                                   |

---

## 9. Quick checklist before returning a macro

- [ ] Exactly one `manual-start` exists.
- [ ] Every node referenced in `connections` exists in `nodes`.
- [ ] Every node ID in `nodes` is unique.
- [ ] `pixel-scan` "found" branch is listed before "not found".
- [ ] Numeric fields are quoted strings.
- [ ] No cycles in `connections`.
- [ ] `logic-gate`, `break`, `pause` are not load-bearing.
- [ ] `madeByAi` is `true` only when explicitly requested.
- [ ] `icon` is `"auto"` unless the user asked for a specific icon.
- [ ] Coordinates are within `i32` range if you intend to use them as
      Rust numbers (any int64 works, but pixel-scan derives width/height
      as `i32`).