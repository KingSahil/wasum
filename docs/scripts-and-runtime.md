# Scripts, Data, and Generated Files

## `scripts/build.js`

Builds the backend bundle used for Windows packaging.

It:

1. reads `backend/system_prompt.txt`
2. generates `backend/generated-prompt.cjs`
3. bundles `backend/server.js` into `dist/bundle.cjs`
4. leaves Puppeteer and WhatsApp packages external where needed
5. copies the prompt and built frontend into `dist`

Run the frontend build first so `frontend/dist` exists.

## `scripts/entry.cjs`

Bootstrap file for the packaged executable.

It loads `.env` before the bundled app starts:

- beside the executable when running under `pkg`
- from the current working directory during normal Node.js use

It then loads `dist/bundle.cjs`.

## `scripts/build-exe.bat`

Windows helper for the full executable build:

1. build frontend
2. bundle backend
3. package `dist/wa-summariser.exe`

It stops on the first failed step.

## `scripts/start.bat`

Windows development/start helper.

It rebuilds the frontend, stops all `node.exe` and `chrome.exe` processes, frees port `3000`, removes stale Chromium lock files, and starts the backend.

Warning: stopping every Node and Chrome process affects unrelated programs running on the computer.

## `scripts/start-hidden.vbs`

Starts `tray.ps1` in a hidden PowerShell window. It is useful for launching the tray version without leaving a console open.

## `scripts/tray.ps1`

Windows system-tray launcher.

It:

- cleans old Node, Chrome, port, and lock state
- starts the backend
- starts a Cloudflare quick tunnel
- reads the generated public URL
- shows status balloons
- provides menu actions for logs, URL copy, restart, and exit

It expects `cloudflared` to be installed or available at its configured Windows path.

Like `start.bat`, its cleanup stops all local Node and Chrome processes.

## `scripts/setup.sh`

One-time Oracle/Ubuntu setup helper.

It updates the system, installs Docker, opens port `3000`, clones or updates the repository, and creates `.env` from the example when missing.

Before using it, replace the placeholder repository URL or set `REPO_URL`.

## `scripts/azure-setup.sh`

Ubuntu server setup script named for Azure.

It installs Docker from Docker's official package repository, enables Docker, adds the current user to the Docker group, clones this repository, and creates `data` and `logs` directories.

## `data/sessions.json`

Registry of browser session IDs and creation times.

At server startup, `SessionManager.js` restores every listed session. This file does not contain full WhatsApp authentication data.

The current file contains real runtime IDs, so avoid publishing it when session identifiers should remain private.

## Runtime Directories

These directories are created while the app runs and are intentionally not documented file by file because their contents are private or generated.

| Path | Purpose |
| --- | --- |
| `.wwebjs_auth/` | Persistent WhatsApp login state. |
| `.wwebjs_cache/` | Cache used by WhatsApp Web tooling. |
| `data/users/` | Per-session settings, summaries, memory, and logs. |
| `logs/` | Legacy/shared log output when used. |
| `frontend/dist/` | Built browser application. |
| `dist/` | Backend bundle, copied assets, and executable output. |
| `node_modules/` | Installed root dependencies. |
| `frontend/node_modules/` | Installed frontend dependencies. |

## Generated and Binary Files

| File | Rule |
| --- | --- |
| `backend/generated-prompt.cjs` | Regenerate with `npm run build:bundle`. |
| `package-lock.json` | Regenerate through root npm commands. |
| `frontend/package-lock.json` | Regenerate through frontend npm commands. |
| `image.png` | Binary screenshot used by the README. |
| `frontend/public/vite.svg` | Static Vite asset. |
| `frontend/src/assets/react.svg` | Unused starter asset. |

