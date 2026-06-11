# Root Files

## `.dockerignore`

Tells Docker which local files not to copy into the image.

It excludes dependencies, build output, WhatsApp login data, Git data, and logs. This keeps Docker builds smaller and avoids copying private runtime files.

## `.env.example`

Template for environment settings. Copy its values into a private `.env` file and replace placeholders.

Main groups:

- Groq key and model
- ntfy notification settings
- summary size and cache limits
- media analysis settings

Some backend settings also have code defaults even when they are not listed here.

## `.gitignore`

Stops Git from tracking secrets and generated/runtime files, including:

- `.env`
- `node_modules/`
- `.wwebjs_auth/`
- `.wwebjs_cache/`
- `data/users/`
- `dist/`
- logs

## `docker-compose.yml`

Runs the app as one Docker service on port `3000`.

It mounts:

- `wa_session` for WhatsApp authentication
- `wa_data` for app data
- the local `.env` file for configuration

`restart: unless-stopped` asks Docker to restart the service after failures or machine restarts.

## `Dockerfile`

Builds the production container in two stages.

1. The builder stage installs frontend dependencies and creates `frontend/dist`.
2. The runtime stage installs Chromium, installs backend production dependencies, copies the project, and copies in the built frontend.

The final command is `node backend/server.js`.

## `image.png`

Screenshot used at the top of the main `README.md`. It is documentation media and has no runtime logic.

## `LICENSE`

MIT license text. It allows reuse, modification, and distribution while keeping the copyright and license notice.

Note: root `package.json` currently says `"license": "ISC"`, which does not match this MIT license file.

## `package.json`

Defines the backend package, dependencies, build commands, and executable packaging settings.

Important commands:

| Command | Action |
| --- | --- |
| `npm start` | Starts `backend/server.js`. |
| `npm run dev:server` | Starts the backend for development. |
| `npm run dev:client` | Starts the Vite frontend dev server. |
| `npm run build` | Builds the frontend. |
| `npm run build:bundle` | Bundles the backend with esbuild. |
| `npm run build:exe` | Builds the frontend, bundles the backend, and creates a Windows executable. |
| `npm run package` | Packages the existing bundle as an executable. |

The current `test` script starts the server; it is not an automated test suite.

## `package-lock.json`

Exact dependency tree for the root Node.js package.

Use `npm install` to update it. Do not edit it by hand.

## `README.md`

Public project introduction with setup, build, Docker, and beginner guidance.

Use `docs/` for deeper implementation details. Keep the root README short enough for a new user to start the app.

