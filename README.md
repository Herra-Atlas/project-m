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
npm run tauri build    # production installer (writes to src-tauri/target/release/bundle/nsis/)
```

## Project layout

```
src/                       # React frontend
  components/              # reusable widgets (Modal, Button, EditorPage, CreateWithAiModal, ...)
    ai/                    # AI protocol + prompts
      prompts.ts           # default system prompt — also editable from Settings → AI
      protocol.ts          # fence parser, mechanical verifier, macro-summary helpers
    cache.ts               # generic invoke-cache hook + shared cache singletons
    CreateWithAiModal.tsx  # AI chat modal — parses fences, renders confirm cards
    EditorPage.tsx         # node-graph editor + run/stop toolbar
    useUpdater.ts          # tauri-plugin-updater wrapper (used by App.tsx)
  App.tsx                  # top-level UI; mounts lazy CreateWithAiModal + EditorPage

src-tauri/                 # Rust backend
  src/
    main.rs                # Tauri builder, plugin registration, command handlers
    macros_fs.rs           # per-macro folder layout, list_macros / read / write / delete
    kilo.rs                # streaming chat-completions client (OpenAI-compatible)
    engine.rs              # macro runtime (parses MacroData, walks node graph)
    nodes/                 # one file per node type
  capabilities/default.json  # Tauri ACL — incl. `updater:default`, `dialog:allow-open`
  tauri.conf.json          # identifier, version, bundle.targets, plugins.updater
  Cargo.toml               # incl. tauri-plugin-{updater,dialog,log,global-shortcut}

.github/workflows/
  release.yml              # tag-triggered: build NSIS, sign, publish draft

keys/                      # PRIVATE SIGNING KEY (gitignored). DO NOT COMMIT.
                           # Use `npx tauri signer generate` to create a new one.

SECURITY.md                # how to report vulnerabilities
LICENSE                    # MIT
```

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
- `__aiConvoSnapshot` — last AI conversation snapshot (auto-restored on next open)

`macros/<id>/macro.json` — the macro itself.
`macros/<id>/ai-chat.json` — AI chat history for that macro.
`macros/<id>/logs.jsonl` — append-only runtime log.
`macros/<id>/assets/` — reserved for future per-macro assets.

## How auto-update works

1. The app starts. `src/components/useUpdater.ts` calls
   `check()` from `@tauri-apps/plugin-updater`.
2. `tauri-plugin-updater` (Rust, registered in `src-tauri/src/main.rs`) fetches
   `https://github.com/herra-atlas/project-m/releases/latest/download/latest.json`
   (URL is configured in `src-tauri/tauri.conf.json` under `plugins.updater.endpoints`).
3. `latest.json` is constructed by `.github/workflows/release.yml` during each
   tagged release. It contains the new `version`, a `pub_date`, and a
   `platforms.windows-x86_64` object with a download URL and a base64 signature.
4. The client compares versions. If newer, it surfaces an `Update` object.
5. The user clicks **Restart to update** in the banner → `downloadAndInstall()`
   streams the `.exe`, verifies the signature against the `pubkey` baked into
   `src-tauri/tauri.conf.json`, then spawns the installer and exits.

This means: **the only thing that prevents a malicious party from shipping
fake updates is the `pubkey` in `tauri.conf.json`.** Never edit it casually —
see the maintenance guide below.

## Maintenance guide — shipping a new release from cold start

If you've never done a release before and your predecessor isn't around,
follow these steps exactly. Order matters.

#### 0. First-time setup (only if `keys/project-m.key` is missing)

The repo only carries the **public** half of the signing keypair, baked
into `src-tauri/tauri.conf.json` under `plugins.updater.pubkey`. The
**private** key lives in two places:

1. Your local `keys/project-m.key` (gitignored; never commit).
2. The GitHub Actions secret `TAURI_SIGNING_PRIVATE_KEY` (so CI can sign).

If either is missing:

```bash
npx tauri signer generate --ci
# prints a Private + Public key.
# 1. Save the Private key to ./keys/project-m.key (create the dir if needed).
# 2. Copy the Public key into src-tauri/tauri.conf.json -> plugins.updater.pubkey.
# 3. Add the Private key as a GitHub repo secret named TAURI_SIGNING_PRIVATE_KEY
#    at https://github.com/herra-atlas/project-m/settings/secrets/actions/new
#    (use the literal base64 string).
# 4. Commit the pubkey change. Do NOT commit the private key.
```

If you lose the private key, auto-update will silently break for every
existing user. Recovering is impossible — you'd need a new keypair and a
forced manual update from users.

#### 1. Develop as usual

```bash
npm run tauri dev      # iterative development with HMR
npm run tauri build    # produce a one-off installer in src-tauri/target/release/bundle/nsis/
```

There are no other gates. No `npm test` (the project doesn't have a test
suite yet), no lint command (TypeScript via `tsc --noEmit` is the closest
thing — see below).

#### 2. Before tagging — manual smoke tests

These are the things that catch 95% of release-day bugs:

- [ ] Open the app, create a macro, save it, close the app, reopen it — does
      the macro survive?
- [ ] Run that macro. Does the Force Stop hotkey halt it?
- [ ] Open **Create with AI**, send a message, confirm the model returns a
      valid ```create_macro``` fence and that the resulting macro is editable.
- [ ] Open **Settings → AI** and confirm your API key persists across a
      restart.
- [ ] If you touched the Rust backend: run
      `Set-Location .../src-tauri; cargo check --manifest-path Cargo.toml`
      and `npx tsc --noEmit` from the repo root. Both must be silent.

#### 3. Bump the version

Two places, both currently `0.1.3`:

- `package.json` → `"version": "0.x.y"`
- `src-tauri/tauri.conf.json` → `"version": "0.x.y"`

The two MUST match exactly. The updater compares the version baked into
`latest.json` (which reads from `package.json` via the tag name) against
the running app's version string.

#### 4. Commit, tag, push

```bash
git add -A
git commit -m "release: 0.x.y — short summary"
git push origin main
git tag v0.x.y
git push origin v0.x.y
```

The `v*` tag is the trigger — pushing it starts the release workflow.

#### 5. Wait for CI (~8 minutes on a clean Windows runner)

Watch the run at https://github.com/herra-atlas/project-m/actions

The workflow:

1. Sets up Node + Rust on `windows-latest`.
2. Runs `npx tauri build --bundles nsis`. This produces:
   - `src-tauri/target/release/bundle/nsis/Project M_<version>_x64-setup.exe`
   - `src-tauri/target/release/bundle/nsis/Project M_<version>_x64-setup.exe.sig`
     (created because `bundle.createUpdaterArtifacts: true` in tauri.conf.json)
3. Runs a custom step that constructs `latest.json` from the `.sig`. Tauri
   2.5.x does NOT emit this file automatically with `--bundles nsis`, so the
   workflow builds it inline. Schema:

   ```json
   {
     "version": "0.x.y",
     "pub_date": "2026-…Z",
     "platforms": {
       "windows-x86_64": {
         "signature": "<base64 of .sig>",
         "url": "https://github.com/herra-atlas/project-m/releases/download/v0.x.y/Project M_0.x.y_x64-setup.exe"
       }
     }
   }
   ```

4. Uploads all three assets as a **draft** GitHub Release.

#### 6. Publish the draft

1. Open https://github.com/herra-atlas/project-m/releases
2. Find the draft titled "Project M v0.x.y".
3. Click **Edit**.
4. Edit the auto-generated release notes — add a user-facing changelog
   (what changed, why they should care, any breaking changes).
5. Click **Publish release**.

Until you publish, the URL is invisible to the public AND to your installed
users. The `latest.json` endpoint returns 404 until you publish, so
existing users will see no update prompt.

#### 7. Verify end-to-end

Within a minute or two of publishing, your installed users should see the
update banner on their next app launch. To verify yourself:

1. Install the current release from the Releases page on a fresh machine.
2. Bump to `0.x.y+1`, push, publish.
3. Launch the older install. It should show "Version 0.x.y+1 is
   available" in the top banner.
4. Click **Restart now**. The app downloads, installs, and relaunches
   into the new version.

If the banner doesn't appear:

- Check https://github.com/herra-atlas/project-m/releases/latest/download/latest.json
  responds with 200 and the expected `version`.
- Confirm `plugins.updater.pubkey` in `src-tauri/tauri.conf.json` matches
  the key that signed the build (Tauri logs a signature mismatch at runtime).
- Make sure you actually clicked **Publish release**, not just saved the
  draft.

#### 8. Post-release cleanup

- If a previous draft is hanging around, delete it.
- Pin the GitHub Actions run for the release in the Releases page
  (Releases → scroll to Assets → click the workflow name).

## Adding a new node type

1. Implement the node in `src-tauri/src/nodes/<name>.rs`.
2. Add the type's metadata (label, group, fields, outputs) to
   `src/components/editor/nodeTypes.ts`.
3. Add its field schema to `ALLOWED_FIELDS` and `requiredFields` in
   `src/components/ai/protocol.ts` — otherwise the verifier will flag it
   and the AI won't be able to produce it.
4. Document it in the registry section of `src/components/ai/prompts.ts`.
5. Restart the dev server. The new node appears in the editor palette.

## Adding a new AI capability

1. Add a new fence kind to `FenceKind` in
   `src/components/ai/protocol.ts`.
2. Add the parser regex branch to `FENCE_RE` and any tool-syntax fallback
   to `normalizeToolSyntax`.
3. Add a render case to `ActionCardView` in
   `src/components/CreateWithAiModal.tsx` so it renders as a card.
4. Add an `onApply*` callback prop to `CreateWithAiModal` and implement it
   in `App.tsx`.
5. Document the new block in `src/components/ai/prompts.ts`.

## Rotating the signing key

If the private key is compromised or you need to rotate for any reason:

1. Generate a new keypair: `npx tauri signer generate --ci`.
2. Replace the `pubkey` value in `src-tauri/tauri.conf.json`.
3. Replace `TAURI_SIGNING_PRIVATE_KEY` in GitHub Secrets.
4. Tag and release a new version immediately. Existing users will get
   the new key on next update; the app will reject any older signed
   releases — that's the point.

There is no way to do this without a forced re-install for users who
have the app pinned to a specific version. Plan accordingly.

## License

[MIT](LICENSE). Contributions welcome — open a PR or an issue.

## Security

Found a vulnerability? Please email rather than filing a public issue —
see `SECURITY.md`.