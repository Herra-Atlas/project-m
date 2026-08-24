# Project M

A visual macro builder for Windows. Chain together triggers, inputs, and actions
on a node graph — or describe what you want in plain English and let an LLM
draft the macro for you.

Built with [Tauri 2](https://tauri.app) + React + Rust. Targets Windows first;
the codebase is portable to macOS and Linux with no platform-specific UI.

## Features

- **Node-graph editor** — drag-and-drop triggers, input automation, loops,
  conditions, pixel vision, AHK IPC, and a JS/AHK script step.
- **Per-macro folders** — every macro is its own folder on disk, with a
  human-readable `macro.json`, an AI chat history (`ai-chat.json`), and an
  append-only log (`logs.jsonl`). Easy to back up, sync, and share.
- **Create with AI** — chat with any OpenAI-compatible model. The agent can
  create, edit, rename, delete, duplicate, and verify macros — gated behind
  per-action confirmations. Every mutating action shows a card with the diff;
  deletes always require explicit approval.
- **Fenced-block output protocol** — model-agnostic. Works with Kilo, OpenAI,
  Claude-via-OpenAI-compatible, and self-hosted endpoints like llama.cpp.
  The parser also auto-converts Qwen-style `<|tool_call|>` syntax and
  Mistral-style `<|content_invoke_tool_json|>` into the canonical form.
- **Auto-update** — every cold launch checks GitHub Releases for a newer
  version, downloads in the background, and prompts the user to restart.
- **Force-stop hotkey** — global hotkey (default F8) instantly halts any
  running macro from anywhere on the system.

## Installation

**Windows:** download the latest installer:

<p align="left">
  <a href="https://github.com/herra-atlas/project-m/releases/latest">
    <img alt="Download for Windows" src="https://img.shields.io/badge/Download-Windows%20%F0%9F%AA%9F-22C55E?style=for-the-badge&logo=windows&logoColor=white" />
  </a>
</p>

Click the badge above to open the Releases page. Pick the newest
release, then download the `Project.M_<version>_x64-setup.exe` asset.

> The installer is **unsigned**, so Windows SmartScreen will warn the
> first time. Click **More info → Run anyway**. After the first launch
> the app self-updates silently.

## Development

Prerequisites:

- Node 20+
- Rust toolchain (`rustup`)
- Windows: Microsoft C++ Build Tools + WebView2 (already on Windows 10/11)
- macOS: Xcode CLT
- Linux: `webkit2gtk`, `libayatana-appindicator3-dev`, `librsvg2-dev`, `libssl-dev`

```bash
git clone https://github.com/herra-atlas/project-m
cd project-m
npm install
npm run tauri dev      # dev mode with HMR
npm run tauri build    # production installer
```

## How it works

- `src/` — React frontend. The AI modal (`src/components/CreateWithAiModal.tsx`)
  parses ```create_macro``` / ```edit_macro``` / ```question``` / etc. fences
  and renders each as a confirmation card.
- `src/components/ai/protocol.ts` — fence parser, mechanical verifier,
  macro-summary helpers.
- `src/components/ai/prompts.ts` — default system prompt. Editable from
  Settings → AI in the running app.
- `src-tauri/` — Rust backend. `src-tauri/src/macros_fs.rs` owns the
  per-macro folder layout. `src-tauri/src/kilo.rs` streams chat completions
  from the Kilo gateway (OpenAI-compatible; swap for any other endpoint).

## Configuration

Settings live in the OS app-data dir:

- Windows: `%APPDATA%\com.herra-atlas.project-m\`
- macOS: `~/Library/Application Support/com.herra-atlas.project-m/`
- Linux: `~/.config/com.herra-atlas.project-m/`

`settings.json` contains:

- `kiloApiKey` — Kilo gateway API key (or any OpenAI-compatible key)
- `aiModel` — default model id (e.g. `openrouter/free`)
- `aiFavoriteModels` — favorited model ids
- `aiSystemPrompt` — overrides the default prompt
- `aiPermissions` — `{ allowMutations, autoApproveSafe }`
- `forceStopKeybind` — global hotkey string (e.g. `F8`, `ctrl+shift+k`)
- `window` — last position and size

`macros/<id>/macro.json` — the macro itself.

## Release process

1. Bump `version` in `package.json` and `src-tauri/tauri.conf.json`.
2. Commit, then `git tag v0.x.y && git push --tags`.
3. `.github/workflows/release.yml` builds the NSIS installer, signs it with
   the GitHub Actions secret `TAURI_SIGNING_PRIVATE_KEY`, and uploads it as a
   draft GitHub Release.
4. Edit the notes, then **Publish release**.

## License

[MIT](LICENSE). Contributions welcome — open a PR or an issue.

## Security

Found a vulnerability? Please email rather than filing a public issue —
see `SECURITY.md`.