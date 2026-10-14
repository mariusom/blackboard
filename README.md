# Blackboard Desktop

A modern, high-performance desktop "Hello World" application built with:
- **GPUIX** (`@gpuix/react` & `@gpuix/native` 0.10.0): GPU-accelerated retained-tree UI powered by Zed's GPUI and Rust.
- **Bun**: Ultra-fast JavaScript runtime, bundler, and standalone binary compiler.
- **pnpm v12** (`pnpm@12.11.2`): High-performance, deterministic package management with frozen lockfiles.
- **TypeScript 7**: Next-generation TypeScript typechecking.
- **Effect v4** (`effect` ^4.0.4): Purely functional, type-safe application architecture with Services, Layers, Refs, ManagedRuntime, `DateTime`, and `Schema`.
- **@effect/tsgo**: Official Effect language service compiler integration and diagnostics.
- **cargo-packager**: macOS `.app` and `.dmg` application packaging with automated GitHub Actions release workflow.

---

## Architecture Overview

```
src/
├── domain/
│   └── models.ts           # Schema models (GreetingItem, TelemetryEvent, AppThemeConfig, SemVer, errors) & APP_VERSION
├── services/
│   ├── GreetingService.ts  # Multi-language greeting service with Effect Ref state
│   ├── CounterService.ts   # Interactive counter service with error boundaries
│   ├── ActivityService.ts  # Audit log / telemetry service using Effect v4 DateTime
│   ├── ThemeService.ts     # Window & UI theme switcher
│   └── AppRuntime.ts       # Layer composition & ManagedRuntime instance
├── components/
│   └── (subcomponents)
├── App.tsx                 # GPUIX desktop UI with greeting cycling, counter, and live activity log
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
