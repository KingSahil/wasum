# WA Chat Summariser

WhatsApp chat summariser built with a React frontend and a Node.js backend.

This project does three main things:
1. Connects to WhatsApp Web using your QR login.
2. Lets you choose a chat and fetch recent messages.
3. Sends those messages to an LLM (Groq) and returns a readable summary.

## What This Repo Contains

```text
wa-chat-summariser-main/
  backend/              # Node.js server and WhatsApp logic
  frontend/             # React app (UI)
  scripts/              # helper scripts for build/run/package
  data/                 # session registry and runtime data (partly gitignored)
  package.json          # root scripts (start/build/package)
  Dockerfile            # container build config
  docker-compose.yml    # local container orchestration
```

## How The App Works (Noob-Friendly Flow)

When you run `npm start`, this is the flow:

1. `backend/server.js` starts an Express server and Socket.IO.
2. The browser opens the React app (already built in `frontend/dist`).
3. Frontend creates or reuses a `sessionId` and sends it to backend.
4. Backend creates a WhatsApp session for that user through `SessionManager.js` + `WaUserSession.js`.
5. You scan QR once, then status updates are sent live through Socket.IO.
6. When you click summarise, frontend calls `/api/summarise`.
7. Backend fetches chat messages, formats prompt + context, calls Groq, and returns summary.
8. Summary can also be sent to ntfy topic if configured.

## File-by-File Guide

### Root

- `package.json`
  - Root commands like `start`, `build`, `build:bundle`, `build:exe`.
- `.env.example`
  - Template for required environment variables.
- `.gitignore`
  - Prevents secrets/runtime artifacts (`dist/`, `data/users/`, `.env`) from being committed.

### Backend (`backend/`)

- `server.js` (main server entrypoint)
  - Sets up Express routes and Socket.IO.
  - Serves the built frontend static files.
  - Exposes APIs like:
    - `POST /api/sessions`
    - `GET /api/chats`
    - `POST /api/summarise`
    - `GET/POST /api/settings`

- `SessionManager.js`
  - Keeps a map of active user sessions.
  - Restores previous sessions from `data/sessions.json`.

- `WaUserSession.js`
  - Core WhatsApp automation and AI logic.
  - Handles QR/auth lifecycle, chat fetching, summarisation, notifications, and per-user memory/settings.

- `system_prompt.txt`
  - Base prompt instructions sent to the model.

- `generated-prompt.cjs`
  - Auto-generated prompt module used during bundling.

- `main.js`
  - Legacy/older implementation kept for reference. Runtime uses `server.js`.

### Frontend (`frontend/`)

- `src/main.jsx`
  - React root mount.

- `src/App.jsx`
  - Main app composition.
  - Manages UI state and decides what screen to show (QR, setup, chat panel, settings, tutorial).

- `src/hooks/useSocket.js`
  - Socket.IO connection hook for real-time backend events (`status`, `qr`, `ready`, logs, summary events).

- `src/api.js`
  - REST helper for backend API calls.

- `src/components/*`
  - UI modules like chat list, QR screen, settings modal, tutorial modal.

### Scripts (`scripts/`)

- `build.js`
  - Bundles backend for packaging and copies required assets.

- `entry.cjs`
  - Packaging bootstrap that loads `.env` and starts bundled app.

- `build-exe.bat`
  - Windows helper: build frontend + bundle + package exe.

- `start.bat`, `tray.ps1`, `start-hidden.vbs`
  - Windows startup helpers.

## Prerequisites

- Node.js 20+
- npm 10+
- Chromium/Chrome (for WhatsApp Web automation)
- Groq API key

## Quick Start

1. Install dependencies:

```bash
npm install
npm install --prefix frontend
```

2. Create `.env` in project root:

```env
PORT=3000
GROQ_API_KEY=your_key_here
```

3. Build frontend:

```bash
npm run build
```

4. Start backend server:

```bash
npm start
```

5. Open:

```text
http://localhost:3000
```

## Development Workflow

Run backend:

```bash
npm run dev:server
```

Run frontend dev server:

```bash
npm run dev:client
```

## Build and Package

Build frontend only:

```bash
npm run build
```

Bundle backend:

```bash
npm run build:bundle
```

Build Windows executable:

```bash
npm run build:exe
```

Output binary:

```text
dist/wa-summariser.exe
```

## Docker

```bash
docker compose up --build
```

App runs at `http://localhost:3000`.

## Runtime Data and Security Notes

- `data/users/` is runtime user/session data and should not be committed.
- `dist/` is generated build output and should not be committed.
- Never commit `.env` or any API key.
- If a key is leaked, rotate it immediately.

## Common Beginner Questions

### Where do I change UI text/components?
Edit files in `frontend/src/components/` and `frontend/src/App.jsx`.

### Where do I change summarisation behavior?
Start with `backend/WaUserSession.js` and `backend/system_prompt.txt`.

### Where is chat/session state stored?
- Session registry: `data/sessions.json`
- Per-user runtime data: `data/users/` (local runtime only)
