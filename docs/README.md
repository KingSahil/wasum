# WA Chat Summariser Documentation

This folder explains the project in simple language. It is written for:

- people who are new to the codebase
- developers who need to change or debug it
- AI coding assistants that need a quick and accurate project map

## Start Here

1. Read [architecture.md](architecture.md) to understand how the whole app works.
2. Read the file guide for the area you want to change:
   - [root-files.md](root-files.md)
   - [backend-files.md](backend-files.md)
   - [frontend-files.md](frontend-files.md)
   - [scripts-and-runtime.md](scripts-and-runtime.md)

## Quick Project Map

| Area | Purpose |
| --- | --- |
| `backend/` | Connects to WhatsApp, calls Groq, stores session data, and exposes the API. |
| `frontend/` | React user interface shown in the browser. |
| `scripts/` | Helpers for setup, Windows startup, bundling, and packaging. |
| `data/` | Session registry and per-user runtime data. |
| `docs/` | Human-readable and AI-readable project documentation. |

## Most Important Files

| Task | Start with |
| --- | --- |
| Change API routes | `backend/server.js` |
| Change WhatsApp or AI behavior | `backend/WaUserSession.js` |
| Change the summary instructions | `backend/system_prompt.txt` |
| Change the main screen flow | `frontend/src/App.jsx` |
| Change the summary screen | `frontend/src/components/ChatPanel.jsx` |
| Change settings | `frontend/src/components/SettingsModal.jsx` and `backend/WaUserSession.js` |
| Change build/package behavior | `scripts/build.js` and root `package.json` |

## Important Safety Rules

- Never commit `.env`; it can contain API keys.
- Treat `.wwebjs_auth/` as private because it contains WhatsApp login state.
- Treat `data/users/` as private because it contains user settings, logs, and AI memory.
- Do not manually edit `backend/generated-prompt.cjs`. It is generated from `backend/system_prompt.txt`.
- Do not manually edit either `package-lock.json` file.

