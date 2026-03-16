# ── Stage 1: Build frontend ───────────────────────────────────────────────────
FROM node:22-slim AS builder
WORKDIR /app

COPY frontend/package*.json ./frontend/
RUN cd frontend && npm install

COPY frontend/ ./frontend/
RUN cd frontend && npm run build

# ── Stage 2: Production image ─────────────────────────────────────────────────
FROM node:22-slim

# Install Chromium and dependencies required by whatsapp-web.js / Puppeteer
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-freefont-ttf \
    fonts-noto-color-emoji \
    ca-certificates \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Install backend deps
COPY package*.json ./
RUN npm install --omit=dev

# Copy source
COPY . .

# Copy built frontend from Stage 1
COPY --from=builder /app/frontend/dist ./frontend/dist

# Persist WhatsApp session data across restarts
VOLUME ["/app/.wwebjs_auth"]

EXPOSE 3000

CMD ["node", "backend/server.js"]
