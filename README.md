# Blackboard Desktop

A modern, high-performance desktop "Hello World" application built with:
- **GPUIX** (`@gpuix/react` & `@gpuix/native` 0.10.0): GPU-accelerated retained-tree UI powered by Zed's GPUI and Rust.
- **Bun**: Ultra-fast JavaScript runtime, bundler, and standalone binary compiler.
- **pnpm v12** (`pnpm@12.11.2`): High-performance, deterministic package management with frozen lockfiles.
- **TypeScript 7**: Next-generation TypeScript typechecking.
- **Effect v4** (`effect` ^4.0.4): Purely functional, type-safe application architecture with Services, Layers, Refs, ManagedRuntime, `DateTime`, and `Schema`.
- **Effect AI MCP** (`effect/ai` `McpServer`, `Tool`, `Toolkit`, `McpProtocol`): built-in Model Context Protocol server with Effect Schemas, latest spec first (`2026-07-28` → `2025-11-25` → `2025-06-18`).
- **@effect/tsgo**: Official Effect language service compiler integration and diagnostics.
- **cargo-packager**: macOS `.app` and `.dmg` application packaging with automated GitHub Actions release workflow.

---

## UI Layout — Browser Canvas First

The window is a slim IDE-style shell around one hero component:

```
┌ top bar: logo · Blackboard vX · MCP status │ theme · updates ┐
│ BrowserCanvas (hero, flex-grow)  │ sidebar (264px)           │
│  ├─ browser chrome (traffic      │  ├─ Canvas controls       │
│  │   lights + url bar)           │  ├─ Labs (counter/greeting)│
│  └─ page viewport rendering      │  └─ Activity log           │
│     CanvasElements as HTML-ish   │                           │
│     divs/text (h1/h2/p/button/   │                           │
│     badge/card/image/divider/    │                           │
│     code + css-subset style)     │                           │
└ footer: canvas uri · MCP specs ─────────────────────────────┘
```

GPUIX has no webview/iframe — `BrowserCanvas` (`src/components/BrowserCanvas.tsx`) simulates the
browser: fake chrome + a light document viewport that renders each `CanvasElement`
(tag + text + css-subset `CanvasStyle`) as native divs. Greeting/counter/activity
remain as compact sidebar cards instead of competing hero sections.

---

## Canvas MCP Server

External agents populate the canvas through a stdio MCP server built only on
Effect's built-in `effect/ai` modules — no extra MCP SDK:

- `src/domain/canvas.ts` — `CanvasElement`, `CanvasStyle` (css subset), `CanvasElementPatch`,
  `CanvasError`, seed elements, `canvas://blackboard/elements` URI.
- `src/services/CanvasService.ts` — Effect `Context.Service` + `Ref` store
  (list/get/create/upsert/update/remove/clear/replaceAll), also wired into the desktop `AppRuntime`.
- `src/mcp/canvasToolkit.ts` — 6 `Tool.make` tools with Effect Schemas for params/success:
  `canvas_create_element`, `canvas_update_element`, `canvas_remove_element`,
  `canvas_list_elements`, `canvas_clear`, `canvas_set_page` (bulk replace).
- `src/mcp/server.ts` — `Toolkit.toLayer` handlers backed by `CanvasService`, plus a
  `canvas://blackboard/elements` resource and a `design-canvas-page` prompt, served via
  `McpServer.layerStdio` with protocols `[v2026_07_28, v2025_11_25, v2025_06_18]`.
- `src/mcp-main.ts` — stdio entrypoint (`NodeStdio.layer`, logs forced to stderr so
  stdout stays a clean protocol channel).

```bash
# run the MCP server (stdio)
bun src/mcp-main.ts          # or: pnpm run mcp
```

Connect any MCP client to that command: `tools/list` advertises the 6 `canvas_*` tools,
`resources/read` on `canvas://blackboard/elements` returns the live page JSON, and the
`design-canvas-page` prompt scaffolds a hero + body + badge page via `canvas_set_page`.

---

## Architecture Overview

```
src/
├── domain/
│   ├── models.ts           # Schema models (GreetingItem, TelemetryEvent, AppThemeConfig, SemVer, errors) & APP_VERSION
│   └── canvas.ts           # Canvas models (CanvasElement, CanvasStyle css-subset, patches, CanvasError)
├── services/
│   ├── GreetingService.ts  # Multi-language greeting service with Effect Ref state
│   ├── CounterService.ts   # Interactive counter service with error boundaries
│   ├── ActivityService.ts  # Audit log / telemetry service using Effect v4 DateTime
│   ├── ThemeService.ts     # Window & UI theme switcher
│   ├── CanvasService.ts    # Browser-canvas element store (Ref) shared by UI & MCP
│   └── AppRuntime.ts       # Layer composition & ManagedRuntime instance
├── mcp/
│   ├── canvasToolkit.ts    # Effect AI Tool.make schemas (6 canvas_* tools)
│   └── server.ts           # Toolkit handlers + resource + prompt + McpServer.layerStdio
├── components/
│   └── BrowserCanvas.tsx   # Hero browser canvas (chrome + HTML-ish viewport)
├── App.tsx                 # Slim shell: top bar, BrowserCanvas hero, sidebar, footer
├── mcp-main.ts             # MCP stdio server entrypoint (bun src/mcp-main.ts)
└── main.tsx                # Desktop entrypoint mounting GPUIX with background/focus options
```

### Effect v4 Idioms
- Services defined via `Context.Service<Self, Shape>()("key")`.
- State managed immutably and concurrently with `Ref.make`, `Ref.get`, and `Ref.updateAndGet`.
- Zero-argument operations modeled as direct, lazy `Effect.Effect<A, E, R>` values (per Effect v4 standards).
- Domain models and errors modeled with `Schema.Struct`, `Schema.Literals`, and branded `Schema.TaggedError`.
- Date and time operations modeled with `DateTime.now` and `DateTime.formatLocal`.
- Services merged using `Layer.mergeAll` and served via `ManagedRuntime.make(AppLiveLayer)`.

### GPUIX Rules
- **Explicit Color Rule**: Every `<text>` element explicitly defines a `color` in its `style` prop (GPUI does not inherit color from parent elements).
- **Background Focus**: Window options support `focus: process.env.GPUIX_BACKGROUND !== "1"`.

---

## Getting Started

### Prerequisites
- [pnpm](https://pnpm.io) (`v12.11.2` or later)
- [Bun](https://bun.sh) (v1.2+)

### Installation
```bash
pnpm install
```
This triggers `postinstall: effect-tsgo patch`, which patches the TypeScript compiler with Effect language service support.

### Development
```bash
bun run dev
```

### Type Checking & Diagnostics
```bash
# TypeScript compiler typecheck
pnpm run typecheck

# Effect v4 Language Service diagnostics (0 errors, 0 warnings, 0 messages)
pnpm run check:effect
```

### Running Tests
```bash
bun test
```
Runs domain logic tests, Effect service tests, isolated semver version bump tests, and GPUIX component mounting tests.

### Building Standalone Executable
```bash
bun run build
```
Compiles a standalone executable into `dist/blackboard`.

---

## Versioning & Release Workflow

### SemVer Bump Script
Written using **Effect v4** in `scripts/bump-version.ts`:
```bash
# Bump patch (e.g. 0.0.0 -> 0.0.1)
bun run bump patch

# Bump minor (e.g. 0.0.0 -> 0.1.0)
bun run bump minor

# Bump major (e.g. 0.0.0 -> 1.0.0)
bun run bump major
```
Outputs strictly the single-line bumped version string to stdout (e.g. `0.0.1`) without extraneous log lines, and syncs the new version across `package.json` and `packager.json`.

### Signed macOS releases and automatic updates

The release workflow in [`.github/workflows/release.yml`](.github/workflows/release.yml)
builds an **Apple Silicon** DMG. The pinned GPUIX native package currently supplies
an arm64 macOS renderer; this is not an Intel or universal build.

Each release signs the native addon and application with Developer ID, enables the
hardened runtime with Bun's JIT permissions, submits the app to Apple, and staples
its notarization ticket. It then creates, signs, notarizes, and staples the DMG.
Signing or notarization failures stop the release. No ad-hoc distribution fallback
is used. See [Apple's notarization workflow](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow).

Blackboard checks for updates on startup and every six hours. Click **Update** to
download and install, then **Restart**. The DMG is for the initial installation;
the in-app updater downloads `Blackboard-aarch64.app.tar.gz` and its `.sig` from
the same release. GPUIX verifies this archive against the public key embedded at
build time before installing it. It preserves the app's Apple signature. See the
[GPUIX updater documentation](https://www.gpuix.dev/#6-auto-update).

Install Blackboard by dragging it to **Applications**, eject the DMG, and launch
that installed copy. Updates require write access to the installed application.
The updater refuses development binaries, mounted DMGs, and translocated apps.
The GitHub repository must be public so installed clients can read the release
feed without a GitHub token. Existing v0.0.4 installations need a manual install
of the first signed release: the old update button only checked for updates.

#### Configure GitHub settings once

Use **mariusom/blackboard → Settings → Secrets and variables → Actions**.
Credentials from another repository (such as `dosium/fresh`) are not automatically
available here. Add these repository **secrets**:

| Secret | Value and origin |
| --- | --- |
| `APPLE_TEAM_ID` | The 10-character Team ID in Apple Developer account → Membership details. |
| `APPLE_ID` | Email for an Apple account that belongs to that developer team and can notarize software. |
| `APPLE_APP_SPECIFIC_PASSWORD` | Generate for that same account at account.apple.com → Sign-In and Security → App-Specific Passwords; two-factor authentication is required. |
| `APPLE_CERTIFICATE` | Base64-encoded Developer ID Application `.p12`, including its private key. |
| `APPLE_CERTIFICATE_PASSWORD` | The password you chose when exporting that `.p12`. |
| `CARGO_PACKAGER_SIGN_PRIVATE_KEY` | The updater private key file's contents, generated below. Separate from the Apple certificate. |
| `CARGO_PACKAGER_SIGN_PRIVATE_KEY_PASSWORD` | The password chosen when generating the updater signing key. |

To obtain the Apple certificate, create a certificate signing request in Keychain
Access → Certificate Assistant → Request a Certificate From a Certificate Authority
and save it to disk. In the Apple Developer portal create a **Developer ID
Application** certificate using that request (G2 Sub-CA when prompted). Install the
resulting `.cer` on the Mac holding the request's private key. Under Keychain Access
→ login → My Certificates, expand the certificate to confirm it has a private key,
then export it as a password-protected `.p12`. The certificate alone cannot sign.
Follow [Apple's certificate instructions](https://developer.apple.com/help/account/certificates/create-developer-id-certificates/)
for the required account permissions.

Upload the `.p12` without printing its contents:

```bash
base64 -i /secure/path/DeveloperID.p12 | tr -d '\n' | gh secret set APPLE_CERTIFICATE -R mariusom/blackboard
```

Keep an encrypted backup of the `.p12` and its password. An Apple account password
change revokes app-specific passwords; update the corresponding GitHub secret.
GitHub displays secret names and dates, and does not reveal saved values.

Generate a password-protected updater key **once**, saving it outside the repository:

```bash
cargo install cargo-packager --version 0.11.8 --locked
cargo packager signer generate --path /secure/path/blackboard-updater.key
# The command prompts for the new key's password.
gh secret set CARGO_PACKAGER_SIGN_PRIVATE_KEY -R mariusom/blackboard < /secure/path/blackboard-updater.key
gh secret set CARGO_PACKAGER_SIGN_PRIVATE_KEY_PASSWORD -R mariusom/blackboard
# Enter the same updater password at the hidden prompt.
gh variable set UPDATER_PUBLIC_KEY -R mariusom/blackboard < /secure/path/blackboard-updater.key.pub
```

`UPDATER_PUBLIC_KEY` is a repository **variable**, not a secret. The build embeds it
into the executable; the downloaded release never chooses its own trust key. CI
verifies the generated archive signature against this same public key before
publishing. Back up the updater key securely and keep it stable across releases.
Changing it without a migration prevents installed clients from trusting new
updates. Never commit the private key, `.p12`, or passwords.

#### Publish a release

Push these changes to the default branch. In **Actions → Release macOS DMG → Run
workflow**, select that branch and a `patch`, `minor`, or `major` bump. The workflow:

1. Requires all signing settings and an arm64 macOS runner.
2. Installs locked dependencies and runs type checks, Effect diagnostics, and tests.
3. Bumps `package.json` and `packager.json` together, then compiles and packages.
4. Signs and notarizes the app and DMG, staples tickets, and checks Gatekeeper.
5. Archives the final stapled app, signs the archive, and verifies the updater key pair.
6. Pushes the version commit and a new immutable `v<version>` tag atomically.
7. Uploads all four assets to a draft release, then publishes it as latest.
8. Removes the temporary signing keychain, even after failure.

Published assets: `Blackboard-<version>-aarch64.dmg`,
`Blackboard-aarch64.app.tar.gz`, `Blackboard-aarch64.app.tar.gz.sig`, and `SHA256SUMS`.
SHA-256 hashes help check downloads; the updater's signature establishes authenticity.
The built-in `GITHUB_TOKEN` needs permission to write repository contents. Branch
protection must allow the release bot's version commit, or the push will fail.
No tags are force-pushed. If publication fails after tagging, inspect the existing
tag/draft and finish that release; do not move a published version tag.

Local development builds remain available through `bun run build`. Without an
embedded public key, automatic updating reports that it is unconfigured. Live
Developer ID signing, Apple notarization, and a real installed-app update still
need verification with your configured Apple credentials and two signed releases.
