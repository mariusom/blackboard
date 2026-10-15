# Blackboard

A macOS canvas for HTML ideas. Arrange desktop pages, mobile screens, and experiments together on one open workspace. Connected coding agents generate real HTML and CSS directly into named canvases through MCP.

The workspace uses the system WebKit renderer inside a native macOS window, with a standard draggable title bar. The old greeting, counter, activity sidebar, fake browser chrome, and protocol footer have been removed.

## Working on the canvas

- Create a canvas with **New canvas**, or draw one with the frame tool (**A**).
- Select and drag canvases to arrange them. Drag the bottom-right handle to resize.
- Scroll to pan. Hold **Space** or use **H** for the hand tool; **V** returns to selection.
- Use **⌘ scroll** to zoom around the pointer. **Shift 1** fits all canvases.
- Double-click a canvas or choose **Edit HTML** for its name, dimensions, and source.
- Source edits preview live. Choose **Save changes** or **⌘ Enter** to commit a draft.
- **⌘ D** duplicates a canvas. Delete removes it. **⌘ Z / ⇧⌘ Z** undo and redo workspace changes.
- Preview a canvas at its actual CSS dimensions, or export a standalone HTML file.

Canvas geometry and committed HTML save atomically to:

```text
~/Library/Application Support/Blackboard/workspace.json
```

Invalid saved files are preserved and reported rather than replaced with starter content. Unsaved source drafts remain in the editor until saved or discarded. The application asks before closing with a draft.

## Shared design tokens

Open **Tokens** to create and edit workspace-wide colors, spacing, font sizes, font families, font weights, radii, and numbers. Reference a token in canvas CSS with `var(--color-brand)` or copy its reference from the library. Saving a value updates every linked canvas and open preview. Exports embed the token CSS so they work independently.

Token names are stable lowercase CSS names. Values support hex colors, CSS lengths (`px`, `rem`, `em`, `%`), font families and weights, numbers, and aliases such as `var(--color-brand)`. Aliases must refer to a compatible type and cannot form a cycle. Tokens used by saved canvases or other tokens cannot be deleted until their references are replaced.

The library saves with the workspace. Existing custom HTML is preserved; untouched starter canvases gain token references with their original values as fallbacks. Token drafts have a separate save action and conflict protection when another agent changes the library.

## Connect a coding agent

Open **Agent** in Blackboard and copy the MCP configuration. For an installed release:

```json
{
  "mcpServers": {
    "blackboard": {
      "command": "/Applications/Blackboard.app/Contents/MacOS/blackboard",
      "args": ["--mcp"]
    }
  }
}
```

Keep Blackboard open. The stdio MCP process connects to the same live workspace as the UI; it does not create a separate in-memory canvas. The Agent panel can copy a design prompt targeting the selected canvas.

Available tools:

| Tool | Purpose |
| --- | --- |
| `canvas_list_boards` | Inspect the workspace, canvas positions, IDs, HTML, and revisions |
| `canvas_get_board` | Read one canvas before editing |
| `canvas_create_board` | Generate a new named HTML canvas |
| `canvas_update_board` | Patch HTML, name, dimensions, or position |
| `canvas_delete_board` | Remove a requested canvas |
| `canvas_list_tokens` | Inspect shared values and the token library revision |
| `canvas_upsert_tokens` | Create or update named values while preserving unrelated tokens |
| `canvas_delete_token` | Remove an unused token |

Use `expectedRevision` when replacing HTML so concurrent changes produce a visible conflict. Only send fields you intend to change. Use the token library’s `revision` as `expectedRevision` when changing tokens. Agents should inspect and reuse shared values before generating HTML. The resources `canvas://blackboard/workspace` and `canvas://blackboard/tokens` expose the workspace and token library; the prompt `design-canvas-page` guides generation.

Previews support HTML and CSS, with inline SVG, CSS artwork, and embedded data images/fonts. Generated documents run in sandboxed frames without scripts, network access, forms, or native bridge access. External images and fonts should be embedded. HTML export retains the source and includes the shared token definitions.

The local app server binds only to `127.0.0.1`, requires an ephemeral session credential, checks request origins, and records connection details in a private `runtime.json` beside the workspace. MCP uses that connection file. Development tests can override its path with `BLACKBOARD_CONNECTION_FILE`.

## Development

Requires an Apple Silicon Mac, Xcode Command Line Tools, Bun 1.4.3, and pnpm 12.11.2.

```bash
pnpm install
bun run dev
pnpm run typecheck
pnpm run check:effect
bun test
bun run build
```

`bun run dev` compiles the small Swift WebKit host and starts the workspace. Build output contains `dist/blackboard` (Bun backend and MCP entrypoint) and `dist/blackboard-webkit` (native window). The frontend is bundled into the backend executable.

For an isolated development workspace:

```bash
bun run dev --workspace=/tmp/blackboard-design/workspace.json
```

`--preview-updates` runs an interactive emulation of update checking, installation feedback, restart-later, and a simulated restart. It has no native installer or relaunch dependency. The update panel labels the simulation clearly.

`--browser` starts only the local server for browser inspection. The server prints its local session URL. Do not share the session URL or the connection file.

The app uses Effect v4 services, schemas, streams, and a managed runtime for storage and verified updates. Tests cover persistence and corruption handling, concurrent edits, coordinate math, HTTP session/origin boundaries, live state streams, real stdio MCP round trips, update verification and restart states, and macOS release orchestration. Native window and canvas interactions are also checked in WebKit during development.

## Signed releases and updates

The manual **Release macOS DMG** GitHub workflow runs checks, bumps the requested SemVer component, builds both executables, signs them with Developer ID and hardened runtime, notarizes and staples the application and DMG, then publishes an immutable release. The native updater addon is signed before embedding. The WebKit host is signed again before sealing the app bundle. Apple stapling retries explicit transient network failures up to five times; invalid tickets stop publication.

Repository secrets:

- `APPLE_TEAM_ID`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_CERTIFICATE` (base64 encrypted PKCS#12) and `APPLE_CERTIFICATE_PASSWORD`
- `CARGO_PACKAGER_SIGN_PRIVATE_KEY` and `CARGO_PACKAGER_SIGN_PRIVATE_KEY_PASSWORD`

Repository variable: `UPDATER_PUBLIC_KEY`.

The updater verifies signed app archives against the public key embedded in the executable. The update button opens download/install progress, retries, manual DMG download, and restart-now/later actions. Drafts must be saved before restarting. Development builds, mounted DMGs, and translocated apps show manual installation instructions. Install the DMG in Applications before using automatic updates.

Release artifacts include the notarized Apple Silicon DMG, signed/stapled app archive, updater signature, and SHA-256 checksums. No ad-hoc signing fallback is used for distribution.
