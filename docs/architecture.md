# Architecture

## What This App Does

WA Chat Summariser links a browser to WhatsApp Web, reads selected messages, sends useful context to Groq, and returns a short summary. It can also answer `!general` questions and send notifications through ntfy.

## Main Parts

### Browser

The React app:

- creates a stable session ID in browser `localStorage`
- connects to Socket.IO using that ID
- shows a QR code until WhatsApp is connected
- lists chats
- asks the backend to summarise a selected chat
- displays live logs and completed summaries

### Node.js Server

The Express server:

- serves the built React app
- validates the `X-Session-Id` header
- exposes chat, summary, logout, and settings routes
- creates one `WaUserSession` object per browser session ID
- sends live events through a private Socket.IO room

### WhatsApp Session

Each `WaUserSession`:

- owns one `whatsapp-web.js` client
- stores its own settings, logs, and summary memory
- manages QR login and reconnects
- fetches and formats chat messages
- calls Groq for text summaries and optional image descriptions
- handles WhatsApp commands
- can send a summary to ntfy

## Normal Startup Flow

1. `npm start` runs `backend/server.js`.
2. The server restores IDs listed in `data/sessions.json`.
3. Each restored ID gets a `WaUserSession`.
4. The browser loads the built frontend.
5. `App.jsx` creates or reuses `wa_session_id`.
6. `useSocket.js` connects with that session ID.
7. The server creates the session if it does not already exist.
8. WhatsApp emits a QR code or restores an existing login.
9. Socket events update the browser.

## Manual Summary Flow

1. The user selects a chat in the sidebar.
2. `ChatPanel.jsx` sends `POST /api/summarise`.
3. `server.js` finds the user's session and selected WhatsApp chat.
4. `WaUserSession.summariseChat()` fetches messages.
5. Old messages may be added as context, while target messages are marked for summary.
6. Media may be described with a Groq vision model.
7. Groq creates WhatsApp-friendly text using `system_prompt.txt`.
8. The backend stores summary memory, optionally calls ntfy, and emits `summary_done`.

## Live Events

The backend sends these Socket.IO events to a room named after the session ID:

| Event | Meaning |
| --- | --- |
| `status` | Current state such as `loading`, `qr`, or `connected`. |
| `qr` | QR text that the frontend renders as an image. |
| `ready` | WhatsApp is connected and usable. |
| `log` | One live log entry with a level and message. |
| `summary_done` | A summary has finished. |

## REST API

All routes except session creation expect an `X-Session-Id` header.

| Method and route | Purpose |
| --- | --- |
| `POST /api/sessions` | Explicitly create or restore a session ID. |
| `GET /api/status` | Read WhatsApp connection state. |
| `GET /api/chats` | Return up to 100 chats. |
| `POST /api/chats/:id/read` | Mark a chat as seen and reset its auto-summary bucket. |
| `POST /api/summarise` | Summarise a selected chat. |
| `POST /api/logout` | Log out WhatsApp and clear that session's authentication data. |
| `GET /api/settings` | Return safe settings and “is configured” flags. |
| `POST /api/settings` | Save allowed per-user settings. |

## Stored Data

```text
data/
  sessions.json
  users/
    <session-id>/
      settings.json
      summary-memory.json
      wa.log

.wwebjs_auth/
  session-<session-id>/
```

`sessions.json` is a registry. The actual user-specific information lives under `data/users/<session-id>/`.

## Commands Inside WhatsApp

- `!summarise` or `!summarize`: summarise the current chat.
- `!summarise 100`: summarise a chosen number of messages.
- `!summarise ... detail`: request a more detailed result.
- Time phrases can limit the summary window.
- `!general <question>`: ask Groq a general question with recent and stored chat context.
- `whatsapp summary`: another summary trigger handled for incoming messages.

## AI Context Rules

- `[CONTEXT]` messages help explain the conversation but should not be directly summarised.
- `[SUMMARY TARGET]` messages are the messages the model should summarise.
- Previous summaries and known participants may be added as memory.
- Images are analysed only when media analysis is enabled, a vision model is set, the type is supported, and the image is below the size limit.

