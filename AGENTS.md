# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Commands

Node.js **22** (see `.nvmrc`) and npm 10+ are required. `postinstall` runs `patch-package`, downloads the Node sidecar binaries, and rebuilds `better-sqlite3` against Electron — don't skip it.

| Command                               | Purpose                                                                                   |
| ------------------------------------- | ----------------------------------------------------------------------------------------- |
| `npm install`                         | Install + run postinstall (downloads Node, rebuilds native modules)                       |
| `npm run dev`                         | Start Vite + Electron (also builds wsl-agent, lima-agent, and bundled MCP servers first)  |
| `npm run lint`                        | ESLint over `src/**/*.{ts,tsx}`                                                           |
| `npm run format`                      | Prettier write                                                                            |
| `npx tsc --noEmit`                    | Type-check (CI gate; same as `npm run typecheck`)                                         |
| `npm run test`                        | Vitest in watch mode                                                                      |
| `npx vitest run`                      | Single CI-style run                                                                       |
| `npx vitest run path/to/file.test.ts` | Run one test file                                                                         |
| `npx vitest run -t "test name"`       | Run tests matching a name                                                                 |
| `npm run test:coverage`               | Coverage; thresholds (lines 30 / fn 35 / br 28 / stmt 30) are enforced and will fail CI   |
| `npm run build`                       | Full production build → `electron-builder` installers                                     |
| `npm run rebuild`                     | Rebuild `better-sqlite3` for the installed Electron version (run after Electron upgrades) |
| `npm run clean`                       | Clear `dist*`, `release`, and bundle outputs                                              |

CI (`.github/workflows/ci.yml`) runs lint → `tsc --noEmit` → `test:coverage` on Node 22. Match it locally before pushing.

## Architecture

Open Cowork is an Electron desktop app that drives the `@mariozechner/pi-coding-agent` SDK (a Codex-compatible agent runner) inside a sandboxed VM. The three Electron processes have distinct responsibilities and bundle separately via `vite.config.ts`:

- **`src/main/`** — Node.js main process. Owns app lifecycle, ~60 IPC handlers (namespaced `config.*`, `mcp.*`, `session.*`, `sandbox.*`, `remote.*`, `schedule.*`, …), SQLite persistence (`better-sqlite3`), and all OS-level integrations. Entry: `src/main/index.ts`.
- **`src/preload/index.ts`** — exposes a typed bridge to the renderer via `contextBridge`. Externals: only `electron`.
- **`src/renderer/`** — React 18 + Tailwind + Zustand UI. Talks to main via the preload bridge through `hooks/useIPC.ts`. i18next (`src/renderer/i18n/`) is mandatory for all user-visible strings — both `en` and `zh` locales must be updated together.
- **`src/shared/`** — types and pure utilities used by both processes (IPC event shapes in `ipc-types.ts`, model presets, path helpers).

Path aliases: `@/* → src/*`, `@main/* → src/main/*`, `@renderer/* → src/renderer/*`.

### Agent execution pipeline

`src/main/Codex/agent-runner.ts` is the heart of the app. It:

1. Constructs a `PiAgentSession` via `createAgentSession()` from `@mariozechner/pi-coding-agent` and resolves models through `@mariozechner/pi-ai` (`pi-model-resolution.ts`, `pi-session-runtime.ts`).
2. Bridges MCP tools (`src/main/mcp/mcp-manager.ts`) into the SDK's `ToolDefinition` format.
3. Injects Skills (`src/main/skills/`) and runtime extensions (`src/main/extensions/`) into the system prompt.
4. Streams responses back to the renderer as `ServerEvent`s: `stream.message`, `stream.partial`, `trace.step` (consumed by `TracePanel`).

When touching agent behavior, look at `agent-runner.ts` and the sibling files in `src/main/Codex/` together — they're a tightly coupled unit.

### Sandbox abstraction

`src/main/sandbox/sandbox-adapter.ts` picks one of four executors at runtime: `wsl` (Windows + WSL2), `lima` (macOS + Lima VM), `native` (fallback with path-based restrictions), or `none`. All file ops and shell commands from the agent go through this adapter, so **never call `child_process` or `fs` directly from agent/tool code** — use the adapter and let it translate paths via `pathConverter` / `limaPathConverter`.

The WSL and Lima agents are separate TypeScript projects compiled by `npm run build:wsl-agent` and `npm run build:lima-agent` into `dist-wsl-agent/` and `dist-lima-agent/`. Their `path-containment.ts` enforces workspace boundaries inside the VM. Bundled MCP servers are built by `scripts/bundle-mcp.js` into `dist-mcp/`.

### Other notable subsystems

- `src/main/db/` — SQLite schema/migrations via `better-sqlite3`. Native module — rebuild after Electron version bumps.
- `src/main/session/` — session CRUD, message history, title generation.
- `src/main/mcp/` — MCP server lifecycle over stdio / SSE / Streamable HTTP, plus the config store and an example "gui-operate" server for computer use.
- `src/main/skills/` — discovers Skills under `.Codex/skills/` (default skills shipped: `pptx`, `docx`, `xlsx`, `pdf`, `skill-creator`) with hot-reload; plugin registry/catalog services manage user-installed skills.
- `src/main/remote/` — Feishu/Lark + Slack bots; channels dispatch through `gateway.ts` → `message-router.ts` → `remote-manager.ts`, which calls the same `AgentExecutor` interface as the local UI.
- `src/main/schedule/` — cron-like scheduled tasks persisted via a store.
- `src/main/memory/` — agent memory backed by an `AgentRuntimeExtension`.

## Repo conventions

- **No `any`.** ESLint rule `@typescript-eslint/no-explicit-any` is `error`. Use `unknown` + narrowing; `catch (e: unknown)` is correct.
- **Conventional Commits** are enforced by commitlint + husky. Allowed types: `feat`, `fix`, `refactor`, `perf`, `docs`, `test`, `build`, `chore`, `ci`, `style`, `revert`, `release`, `merge`. Header ≤ 100 chars.
- **PRs target `dev`**, not `main` (`main` is for releases). Keep individual component files under 500 lines.
- **Tests are required for every `feat` and `fix`.** Vitest picks up both `src/**/*.{test,spec}.ts` and `tests/**/*.{test,spec}.ts`. Place new tests next to source or mirrored under `src/tests/<area>/`. Electron is aliased to `tests/mocks/electron.ts` so tests don't depend on a real Electron install.
- **i18n is mandatory** for any user-visible string — use `useTranslation()`, add the key to both `en` and `zh`. Use `lucide-react` for icons (no other icon libs).
- Critical deps that need manual review on any version bump: `electron`, `@mariozechner/pi-coding-agent`, `better-sqlite3`, `vite` / `@vitejs/plugin-react`.

## Build externalization gotcha

`vite.config.ts` externalizes large CJS-friendly main-process deps (`@anthropic-ai/sdk`, `openai`, `@modelcontextprotocol/sdk`, `electron-updater`, `chokidar`, `archiver`, `ngrok`, `ws`, `glob`, `dotenv`, plus `better-sqlite3` and Node builtins). **ESM-only packages (`pi-coding-agent`, `pi-ai`, `electron-store`, `uuid`) must stay bundled** — moving them to `external` will break the build because CJS `require()` can't load them. `electron-builder.yml` separately controls which `node_modules` ship in the installer; if you add a new externalized dep, add it to both files.
