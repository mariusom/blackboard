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

### GitHub Actions Release Workflow
Defined in `.github/workflows/release.yml`:
1. Triggered on GitHub via **Run workflow** (`workflow_dispatch`).
2. Input `release_type` (`patch`, `minor`, `major`).
3. Runs on `macos-latest`.
4. Sets up `pnpm@12.11.2` via `pnpm/action-setup@v4` and Bun via `oven-sh/setup-bun@v2`.
5. Installs dependencies using `pnpm install --frozen-lockfile`.
6. Runs typecheck (`pnpm run typecheck`), Effect language service diagnostics (`pnpm run check:effect`), and unit tests (`bun test`).
7. Bumps SemVer and pushes git commit and tag `v<version>`.
8. Compiles standalone Bun executable (`bun run build`).
9. Generates macOS `AppIcon.icns` from `assets/icon.svg`.
10. Packages macOS `.app` and `.dmg` using `cargo-packager` (with `hdiutil` fallback).
11. Creates a GitHub Release and uploads the `.dmg`.
