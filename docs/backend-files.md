# Backend Files

## `backend/server.js`

This is the active server entry point.

It creates:

- an Express application
- an HTTP server
- a Socket.IO server
- REST routes
- static hosting for `frontend/dist`

Session IDs are accepted only when they are 8 to 64 characters and contain letters, numbers, `_`, or `-`.

Most API routes use `requireSession()`. That middleware reads `X-Session-Id`, finds the matching `WaUserSession`, and stores it as `req.session`.

The server tries several possible frontend build locations so it can work in development, a bundle, or a packaged executable.

When the requested port is busy, it retries once on the next port number.

## `backend/SessionManager.js`

Owns the in-memory map of session ID to `WaUserSession`.

Main functions:

- `initSessionManager(io)`: reads `data/sessions.json` and starts all saved sessions
- `getOrCreateSession(sessionId)`: returns an existing session or creates, saves, and starts a new one
- `getSession(sessionId)`: returns a session without creating it

This file stores only the registry. User settings and memory are handled by `WaUserSession.js`.

## `backend/WaUserSession.js`

This is the main application logic. Each instance belongs to one session ID.

### Files Owned by Each Session

```text
data/users/<session-id>/settings.json
data/users/<session-id>/summary-memory.json
data/users/<session-id>/wa.log
.wwebjs_auth/session-<session-id>/
```

### Main Responsibilities

- create and monitor the WhatsApp client
- emit QR, status, ready, log, and summary events
- retry failed browser initialization
- watch for a frozen Chromium page
- load and save user settings
- fetch messages and build Groq prompts
- maintain summary, participant, chat-directory, and general-question memory
- analyse supported images with a vision model
- handle `!summarise`, `!summarize`, and `!general`
- trigger unread-count summaries
- send ntfy notifications
- clear authentication state during logout

### Important Method Groups

| Methods | Purpose |
| --- | --- |
| `loadSettings`, `saveSettings`, `getSetting` | Per-user configuration. |
| `loadSummaryMemory`, `queueMemoryUpdate` | Safe, ordered memory file updates. |
| `rememberChatDirectory`, `findChatByNameFromMemory` | Find chats without repeatedly loading every chat. |
| `describeImageForContext`, `describeMediaMessage` | Optional media context. |
| `startWatchdog`, `restartClient` | Detect and recover from a dead browser/client. |
| `createAndBindClient` | Create the WhatsApp client and attach lifecycle events. |
| `summariseChat` | Fetch, format, summarise, and remember messages. |
| `answerGeneralQuestion` | Answer `!general` using recent and persistent context. |
| `_attachMessageCreate` | Process incoming and outgoing WhatsApp messages. |
| `start`, `logout` | Session lifecycle. |

### Settings Behavior

Environment variables provide shared defaults. Values saved in the user's `settings.json` can override allowed settings.

The API does not return the saved Groq key directly. It returns flags such as `GROQ_API_KEY_SET` instead.

### Summary Behavior

`summariseChat()`:

1. validates the requested message limit
2. fetches messages, sometimes using a cache
3. applies an optional time window
4. separates background context from summary targets
5. identifies senders and media
6. adds previous memory
7. calls Groq
8. cleans formatting for WhatsApp
9. stores the result in memory

## `backend/system_prompt.txt`

The source prompt for chat summaries.

It tells the model:

- what information matters
- what noise to ignore
- how context and target messages differ
- which WhatsApp formatting is allowed
- which sections to use
- what exact sentence to return when nothing important happened

Edit this file when changing summary style or priorities.

After editing it, run `npm run build:bundle` before packaging.

## `backend/generated-prompt.cjs`

Generated CommonJS module containing `system_prompt.txt` as a JavaScript string.

`scripts/build.js` rewrites this file. Do not edit it manually because the next bundle build will replace the changes.

## `backend/main.js`

Legacy single-session implementation.

It contains older versions of WhatsApp connection, summary, memory, command, and notification logic using module-level variables. The active server imports `SessionManager.js` and `WaUserSession.js`, not this file.

Keep this file only as a migration/reference source. New behavior should normally be added to `WaUserSession.js`.

