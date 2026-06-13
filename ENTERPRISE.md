# Enterprise Deployment Guide — Open Cowork

Open Cowork is an open-source Electron desktop application that runs Claude Code and other AI models in a sandboxed environment, with support for MCP integrations, Skills (document generation), and remote control via Feishu/Slack. This guide covers deployment, observability, troubleshooting, and security for IT-savvy operators.

---

## Overview & System Requirements

**What is Open Cowork?**

A cross-platform desktop app (Windows & macOS) that wraps Claude Code, OpenAI, Gemini, DeepSeek, and custom APIs into a GUI. All file operations and shell commands execute in an isolated sandbox (WSL2 on Windows, Lima VM on macOS, or native with path restrictions). Local SQLite persistence, i18n (English & Chinese), and one-click installers.

**System Requirements:**

- **Node.js 22+** (per `.nvmrc`; enforce via `nvm use` or equivalent)
- **npm 10+** (ships with Node 18+)
- **Electron 35.7.5+** (bundled; no separate install needed)
- **Platform-specific:**
  - **Windows:** WSL2 enabled (for sandbox isolation); fallback to native mode available (not recommended for production)
  - **macOS:** Lima VM runtime (preferred) or native mode with path-based restrictions

**Installation & Build Prerequisites:**

After cloning or during CI/deployment, run:

```bash
npm install
```

This triggers `postinstall` (see `package.json` line 49), which:

1. Applies patches via `patch-package`
2. Downloads Node.js binaries to `resources/node/` (via `scripts/download-node.js`)
3. Rebuilds `better-sqlite3` against the installed Electron version (`npm run rebuild`)

These steps are **mandatory** — do not skip. The native `better-sqlite3` module requires rebuilding for each Electron version to ensure ABI compatibility.

---

## Deployment Per Platform

### Windows

**Installer:** `Sidekick-<version>-win-x64.exe` (NSIS-based, from GitHub Releases)

**Installation:**

- Run the `.exe` file; defaults to per-user install (not system-wide) unless modified
- User configuration and logs stored in `%APPDATA%\open-cowork\` (e.g., `C:\Users\alice\AppData\Roaming\open-cowork\`)

**Sandbox Mode:**

- Windows uses **WSL2** (Windows Subsystem for Linux 2) for full VM-level isolation
- All agent file I/O and shell commands run inside the WSL2 VM
- If WSL2 is unavailable, the app falls back to **native mode** (not isolated, not recommended for enterprise)

**Building from source:**

```bash
npm run build:wsl-agent      # Compile the WSL agent
npm run build                # Full build → electron-builder → release/
```

### macOS

**Installer:** `Sidekick-<version>-mac-arm64.dmg` (notarized; Intel builds available on request)

**Installation:**

- Drag `Sidekick.app` to `/Applications`
- User configuration and logs stored in `~/Library/Application Support/open-cowork/`

**Sandbox Mode Priority:**

1. **Lima VM** (preferred) — isolated, lightweight Linux VM via `limactl` (installed separately; e.g., `brew install lima`)
2. **Native mode** (fallback) — path-based restrictions only; full isolation not guaranteed

The app auto-detects the sandbox mode at startup via `sandbox-adapter.ts`. If Lima is not available, it downgrades to native and logs a warning.

**Building from source:**

```bash
brew install lima cliclick           # Install dependencies
npm run build:lima-agent             # Compile the Lima agent
npm run build                        # Full build → electron-builder → release/
```

### Releases from GitHub

Releases are published via the **Release workflow** (`.github/workflows/release.yml`):

- Triggered on git tag push: `git tag v3.4.0 && git push origin v3.4.0`
- Lint, test, and build on `ubuntu-latest` (lint/test), `macos-14` (macOS build), and `windows-latest` (Windows build)
- Artifacts published to [GitHub Releases](https://github.com/guiguili520/open-cowork/releases)
- Auto-update enabled: app checks for new versions and prompts users via `electron-updater`

---

## Observability & Logging

### Log Location

Logs are written to the **user data directory**, resolved as:

- **Windows:** `%APPDATA%\open-cowork\logs\` (e.g., `C:\Users\alice\AppData\Roaming\open-cowork\logs\`)
- **macOS/Linux:** `~/Library/Application Support/open-cowork/logs/` (macOS) or `~/.config/open-cowork/logs/` (Linux)

In code, this is `app.getPath('userData') + '/logs/'` (see `src/main/utils/logger.ts`).

### Log Files & Rotation

- **Format:** JSON records, one per line; plain-text header includes platform, Node/Electron versions, app version
- **Naming:** `app-<ISO-timestamp>-<sequence>.log` (e.g., `app-2026-06-13_15-30-45-1.log`)
- **Rotation:** Automatic when log size exceeds 10 MB
- **Retention:** Keeps the 5 most recent log files; older files are deleted

**Example:**

```
app-2026-06-13_15-30-45-1.log   (current)
app-2026-06-13_14-20-10-2.log
app-2026-06-13_12-45-00-3.log
app-2026-06-13_11-00-15-4.log
app-2026-06-12_22-30-50-5.log
```

### Log Levels & Persistence

- **WARN & ERROR:** Always persisted to disk and console
- **INFO & DEBUG:** Persisted only if developer logs are enabled (toggleable via UI, defaults to on)

Log entries include structured context:

- `[sid:xxx]` — session ID (first 8 chars of UUID)
- `[tid:xxx]` — trace ID for a single agent task (8 hex chars)
- Timestamps, module name, message

### Secret & PII Redaction

**All logs are automatically redacted** of sensitive information (see `src/main/utils/log-redaction.ts`, added in T1 of the current development pipeline):

Redacted patterns include:

- API keys: `sk-*`, `sk-ant-*`, AWS keys (`AKIA[0-9A-Z]{16}`), Google keys (`AIza*`), generic long tokens (≥32 chars of hex/base64)
- Authorization headers: `Authorization: Bearer <token>`, `Bearer <token>`
- Query parameters: `api_key=*`, `apiKey=*`, `token=*`, `password=*`
- Home paths: `/Users/<username>/`, `/home/<username>/`, `C:\Users\<username>\` → `~/` (usernames not leaked)

Redacted secrets are replaced with masks like `***REDACTED***` or `sk-***` (short prefix for clarity without exposing the secret).

**Example redacted log:**

```json
{
  "level": "INFO",
  "timestamp": "2026-06-13T15:30:45.123Z",
  "message": "Agent session started",
  "context": "[sid:abc12345]",
  "apiKey": "sk-***",
  "workspace": "~/projects/my-workspace"
}
```

---

## Troubleshooting Runbook

### WSL2 / Lima Sandbox Won't Start or Connect

**Symptoms:**

- Sandbox mode shows as `'none'`; agent operations fail with "sandbox not initialized"
- Windows: "WSL2 is not available" warning on startup

**Fixes:**

**Windows — Enable WSL2:**

```powershell
# Run as Administrator
wsl --install
wsl --update
# Verify:
wsl --list --verbose
```

If you must run without WSL2 (not recommended):

```bash
# Set environment variable to force native mode
$env:OPEN_COWORK_FORCE_NATIVE = "true"
# Re-launch the app
```

**macOS — Install or Reset Lima:**

```bash
brew install lima
limactl start default          # Start the default Lima VM
# Verify:
limactl list
# If Lima is stuck, reset:
limactl delete default
limactl start default
```

### better-sqlite3 Node Module ABI Mismatch

**Symptoms:**

- Launch crash: `Error: The version of node.js this was compiled for does not match...`
- Or: `Error: Module version mismatch. Expected 127, got 123`

**Cause:** Native module compiled against a different Electron version.

**Fix:**

After upgrading Electron (in `package.json`) or if the ABI has drifted:

```bash
npm run rebuild
```

This rebuilds `better-sqlite3` against the installed Electron version's runtime and ABI.

If rebuilding fails, clear and reinstall:

```bash
rm -rf node_modules
npm ci          # Clean install from package-lock.json
npm run rebuild
```

### API Key / Relay Returns 403 Forbidden

**Symptoms:**

- Agent queries fail with "403 Forbidden"
- Some proxy services or API endpoints block requests

**Cause:** User-Agent detection. Some services block Electron-like User-Agents to prevent automation.

**Workaround:** Set the **decoy User-Agent** environment variable:

```bash
export SIDEKICK_DECOY_USER_AGENT="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
# Then launch the app
open /Applications/Sidekick.app
```

Or on Windows:

```powershell
$env:SIDEKICK_DECOY_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
# Then launch the app
```

This value is used in HTTP client initialization to masquerade as a browser.

### Office Task Fails with "No Artifacts Found"

**Symptoms:**

- Task status shows `error`; message: "Task finished, but no generated artifacts were found..."
- Expected output file is missing or empty

**Diagnosis:**

1. **Check session trace:** Open the task in the UI; expand the Trace panel to see the agent's intermediate steps and tool outputs
2. **Verify workspace:** Confirm the workspace directory is writable and not full:
   ```bash
   ls -la /path/to/workspace
   df -h /path/to/workspace
   ```
3. **Check sandbox:** Verify the sandbox mode (WSL2, Lima, or native) is functioning:
   - Look in logs for `[Logger] Sandbox mode: <mode>` at startup
   - Retry the task; watch the trace for file operations

**Common causes:**

- **Inputs missing:** Agent template or form inputs not populated correctly
- **Skill not available:** Built-in Skills (DOCX, PPTX, XLSX, PDF) must be present in the `skills/` directory under resources
- **Agent error:** Agent encountered an error during task execution; check the trace for `**Error**: ...` or status=`error` in trace steps
- **Output directory unreachable:** Sandbox cannot write to the output directory (permission, not in allowed workspace)

**Fixes:**

- Re-submit the task with correct inputs
- Rebuild and redeploy to ensure Skills are bundled: `npm run build`
- If sandbox is stuck, restart the app and try again

### Auto-Update Issues

**Symptoms:**

- App does not check for updates
- Update prompt appears but fails to download/install

**Causes & Fixes:**

- **GitHub token missing:** The app uses `GH_TOKEN` for GitHub Releases (auto-update). If offline or token is invalid, updates are skipped silently.
- **Proxy blocking:** Some corporate proxies intercept HTTPS requests to GitHub. Configure proxy settings in the OS or disable auto-update (via `electron-updater` config).
- **Old version:** Only versions newer than the running version trigger an update. Verify the tag in the release (e.g., `v3.4.0`) is newer than the current app version (check **About** in the UI).

**Manual update:**
Download the latest installer from [GitHub Releases](https://github.com/guiguili520/open-cowork/releases) and run it. The installer preserves user config by default.

---

## Security Notes

### Sandbox Isolation

- **Windows (WSL2):** File ops and shell commands execute in a separate WSL2 distro. Path translation ensures the agent only accesses files within the user's chosen workspace.
- **macOS (Lima):** Commands run in the Lima VM with path containment enforced by `path-containment.ts` (agent sees `~/workspace` on the VM, mapped from the host).
- **Fallback (native):** Path-based restrictions only; no VM isolation. Not suitable for running untrusted agent code.

The `sandbox-adapter.ts` abstracts these differences; all IPC handlers (`session.*`, `sandbox.*`) go through the adapter, ensuring the app never directly calls `child_process` or `fs` for agent operations.

### Log Redaction

API keys, Bearer tokens, and home-directory paths are automatically redacted in logs (see [Observability & Logging](#observability--logging)). This prevents accidental credential leaks in support dumps or log analysis.

### API Key Storage

- **Location:** Encrypted via `electron-store` (with key rotation); stored in `app.getPath('userData')/config.json`
- **Access:** Keys are in-memory during agent execution; never logged in plaintext
- **Management:** Users add/rotate keys via the **Configuration** UI; no CLI export mechanism (intentional, to prevent accidental exfiltration)

---

## Operational Checklist

- [ ] **Pre-deployment:** Verify Node 22 and npm 10+ are installed and on PATH
- [ ] **Installation:** Run `npm install` to trigger postinstall (patches, Node download, better-sqlite3 rebuild)
- [ ] **Platform setup:** Windows → WSL2 enabled; macOS → Lima installed (optional but recommended)
- [ ] **Logging:** Confirm log directory is writable: `app.getPath('userData')/logs/`
- [ ] **First run:** Launch the app; check **About** for version; inspect logs for startup messages (no errors)
- [ ] **Sandbox test:** Create a simple workspace and run a test task; verify trace shows the correct sandbox mode
- [ ] **API keys:** Add one API key (Anthropic, OpenAI, etc.) and run a test chat; verify no errors in logs
- [ ] **Firewall/proxy:** If behind a corporate proxy, configure `HTTPS_PROXY` / `HTTP_PROXY` environment variables
- [ ] **Updates:** Ensure app can reach GitHub Releases (or disable auto-update if offline)

---

_Last updated: 2026-06-13 | Open Cowork v3.4.0_
