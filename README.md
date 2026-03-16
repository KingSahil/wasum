# WA Chat Summariser

WhatsApp chat summariser with a React frontend and Node.js backend.

The app connects to WhatsApp Web, lets you choose chats, generates AI summaries, and can push summaries to `ntfy`.

## Project layout

```text
wa-chat-summariser-main/
  backend/
    server.js
    SessionManager.js
    WaUserSession.js
    main.js
    system_prompt.txt
    generated-prompt.cjs
  frontend/
    src/
    public/
    package.json
  data/
    sessions.json
    users/
  dist/
  scripts/
    build.js
    build-exe.bat
    start.bat
    tray.ps1
    start-hidden.vbs
    setup.sh
    azure-setup.sh
  package.json
  Dockerfile
  docker-compose.yml
```

## Architecture

- `frontend/`: React + Vite UI.
- `backend/server.js`: Express + Socket.IO API and static serving.
- `backend/SessionManager.js`: Creates/restores per-user WhatsApp sessions.
- `backend/WaUserSession.js`: WhatsApp client lifecycle, summarisation, settings, memory.
- `data/`: persisted sessions and user-level settings/memory.

## Prerequisites

- Node.js 20+
- npm 10+
- Chromium/Chrome (for Puppeteer/WhatsApp Web)
- A Groq API key

## Quick start

1. Install backend deps:

```bash
npm install
```

2. Install frontend deps:

```bash
npm install --prefix frontend
```

3. Create `.env` at repo root (or copy from `.env.example`) and set at least:

```env
PORT=3000
GROQ_API_KEY=your_key_here
```

4. Build frontend:

```bash
npm run build
```

5. Start backend:

```bash
npm start
```

Open `http://localhost:3000`.

## Development

Run backend:

```bash
npm run dev:server
```

Run frontend dev server:

```bash
npm run dev:client
```

## Build and package

Build frontend:

```bash
npm run build
```

Bundle backend for pkg:

```bash
npm run build:bundle
```

Or directly:

```bash
node scripts/build.js
```

Create Windows executable:

```bash
npm run build:exe
```

Output: `dist/wa-summariser.exe`

Windows helper scripts:

```bat
scripts\start.bat
scripts\build-exe.bat
scripts\start-hidden.vbs
```

## Docker

Build and run with Docker Compose:

```bash
docker compose up --build
```

Service runs on `http://localhost:3000`.

## Notes

- Session/auth data is stored under `.wwebjs_auth/` and `data/`.
- Frontend build output is `frontend/dist`.
- The root server always serves static files from the built frontend output.
