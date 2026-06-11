# Frontend Files

## `frontend/package.json`

Defines the React/Vite frontend.

Important commands:

- `npm run dev`: development server
- `npm run build`: production build
- `npm run lint`: ESLint checks
- `npm run preview`: preview the production build

Main libraries are React, Socket.IO Client, Tailwind CSS, Lucide icons, and `qrcode.react`.

## `frontend/package-lock.json`

Exact frontend dependency tree. Update it through npm, not by hand.

## `frontend/README.md`

Default Vite template documentation. It explains generic React/Vite behavior but does not describe this application.

The project-specific docs in this folder are the better source for maintenance.

## `frontend/vite.config.js`

Loads React and Tailwind plugins.

In development, it proxies:

- `/api` to `http://localhost:3000`
- `/socket.io` to `http://localhost:3000` with WebSocket support

This lets frontend code use relative URLs in both development and production.

## `frontend/eslint.config.js`

ESLint rules for JavaScript and JSX.

It enables recommended JavaScript, React Hooks, and Vite React Refresh rules. It ignores `dist` and treats names beginning with a capital letter or underscore as acceptable unused variables.

## `frontend/index.html`

Small HTML shell used by Vite.

It provides `<div id="root">`, then loads `src/main.jsx`. The current title and favicon are still Vite defaults.

## `frontend/public/vite.svg`

Default Vite favicon. It is copied as a public static asset.

## `frontend/src/assets/react.svg`

Default React logo from the Vite starter. It is not imported by the current app.

## `frontend/src/main.jsx`

Browser entry point.

It imports global CSS and renders `<App />` into the `root` element inside React `StrictMode`.

## `frontend/src/index.css`

Global styling and Tailwind import.

It defines:

- full-screen layout
- dark WhatsApp-like colors
- custom scrollbars
- summary bubble animation
- QR fade animation

## `frontend/src/App.css`

Unused Vite starter styles. `App.jsx` does not import this file.

It can be removed after confirming no external code depends on it.

## `frontend/src/api.js`

Small REST helper.

It:

- reads `VITE_BACKEND_URL`
- reads `wa_session_id` from `localStorage`
- adds `X-Session-Id`
- JSON-encodes POST bodies
- currently parses every response with `.json()`

Important: callers receive parsed data, not a native `Response` object.

## `frontend/src/hooks/useSocket.js`

Creates the Socket.IO connection for one session ID.

It stores:

- connection status
- QR text
- the latest 200 log entries
- the latest summary

The effect disconnects the socket when the component unmounts or the session ID changes.

## `frontend/src/App.jsx`

Main UI controller.

It:

- creates or restores the browser session ID
- starts `useSocket`
- loads chats after WhatsApp connects
- checks Groq, ntfy, and tutorial setup state
- shows the QR screen before connection
- shows setup and tutorial modals when needed
- marks a selected unread chat as read

The Socket.IO connection currently creates a missing backend session automatically, so `App.jsx` does not need to call `POST /api/sessions`.

## `frontend/src/components/QRScreen.jsx`

Connection screen.

It renders the QR text as a QR image and shows phone instructions. While no QR is available, it shows a connecting/waiting state.

## `frontend/src/components/Sidebar.jsx`

Chat list and search.

It filters chats by name, shows unread counts, creates initials and stable avatar colors, highlights the selected chat, and opens settings.

## `frontend/src/components/ChatPanel.jsx`

Main summary workspace.

It lets the user:

- choose a message count from 10 to 200
- request a summary
- read or dismiss the summary
- watch backend logs

Important implementation note: `api.post()` already returns parsed JSON, but this component calls `res.json()` and checks `res.ok` as if it received a native `Response`. That mismatch should be fixed before relying on manual summaries from this screen.

## `frontend/src/components/SummaryCard.jsx`

Displays the latest summary in a WhatsApp-like message bubble.

It adds the current display time, supports clipboard copy, and lets the user dismiss the card.

The summary is rendered as plain text; WhatsApp formatting characters are not converted into HTML.

## `frontend/src/components/LogTerminal.jsx`

Shows live session logs.

It colors entries by level and automatically scrolls to the newest entry.

## `frontend/src/components/SettingsModal.jsx`

Loads and saves user settings.

Visible fields include:

- Groq API key and model
- ntfy topic, title, and priority
- default message limit

It can also reopen the tutorial or log out the current WhatsApp session.

## `frontend/src/components/ApiKeySetupModal.jsx`

First-time setup flow.

Step 1 requires a Groq API key. Step 2 accepts an ntfy topic or allows the user to skip it.

The key can be visually hidden, and browser password-manager hints are disabled where possible.

## `frontend/src/components/TutorialModal.jsx`

In-app quick-start guide.

It explains manual summaries, `!summarise`, `!general`, and automatic group summaries. Closing it causes `App.jsx` to save `TUTORIAL_SEEN=true`.

