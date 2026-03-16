// WaUserSession.js — per-user WhatsApp client + all related logic
import pkg from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import Groq from 'groq-sdk';
import axios from 'axios';
import { readFile, writeFile, unlink, mkdir, appendFile, rm } from 'fs/promises';
import { join, dirname } from 'path';
import systemPrompt from './generated-prompt.cjs';

const { Client, LocalAuth } = pkg;

// ── Module-level constants (system-wide, not per-user) ────────────────────────
const WATCHDOG_INTERVAL    = 2 * 60 * 1000;
const WATCHDOG_TIMEOUT     = 30 * 1000;
const UNREAD_SYNC_INTERVAL = 30 * 1000;
const SUPPORTED_VISION_MIME_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png']);

// ── Pure utility helpers ──────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function isRetriableAuthCleanupError(err) {
    const code = String(err?.code || '').toUpperCase();
    return code === 'EBUSY' || code === 'EPERM' || code === 'ENOTEMPTY';
}

function withTimeout(promise, ms, label = '') {
    let timer;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(
            () => reject(new Error(`[TIMEOUT] ${label} did not respond within ${ms} ms`)),
            ms
        );
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function sanitizeForWhatsApp(text) {
    if (!text) return '';
    return text
        .replace(/\*\*(.*?)\*\*/g, '*$1*')
        .replace(/__(.*?)__/g, '_$1_')
        .replace(/~~(.*?)~~/g, '~$1~')
        .replace(/^\s{0,3}#{1,6}\s+(.+)$/gm, '*$1*')
        .replace(/^\s*\*\s+/gm, '- ')
        .replace(/^\s*(\d+)\)\s+/gm, '$1. ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function trimTo(str, max = 240) {
    if (!str) return '';
    return str.length > max ? `${str.slice(0, max - 1)}...` : str;
}

function getWordCount(text) {
    return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

function extractRequestedWordCount(question) {
    const q = String(question || '');
    const match = q.match(/(?:exactly|in|with|use)?\s*(\d+)\s+words?\b/i);
    if (!match) return null;
    const parsed = parseInt(match[1], 10);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1000) return null;
    return parsed;
}

function forceWordCount(text, targetWords) {
    const words = String(text || '').trim().split(/\s+/).filter(Boolean);
    if (words.length === targetWords) return words.join(' ');
    if (words.length > targetWords) return words.slice(0, targetWords).join(' ');
    const padded = [...words];
    while (padded.length < targetWords) padded.push('...');
    return padded.join(' ');
}

function isTargetClosedError(err) {
    const msg = String(err?.message || '').toLowerCase();
    return msg.includes('target closed') || msg.includes('execution context was destroyed');
}

function isSummarizeCommand(text) {
    const body = String(text || '').trim().toLowerCase();
    return body.startsWith('!summarise') || body.startsWith('!summarize');
}

function isGeneralCommand(text) {
    return String(text || '').trim().toLowerCase().startsWith('!general');
}

function messageIdOf(message) {
    return message?.id?._serialized || message?.id?.id || '';
}

function normalizeName(name) {
    return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function extractPhoneFromJid(jid) {
    const raw = String(jid || '');
    const match = raw.match(/(\d{6,15})/);
    return match ? match[1] : '';
}

// ── WaUserSession class ───────────────────────────────────────────────────────
export class WaUserSession {
    constructor(sessionId, io) {
        this.sessionId = sessionId;
        this.io = io;

        // Per-user file paths
        this.settingsFile      = join(process.cwd(), 'data', 'users', sessionId, 'settings.json');
        this.summaryMemoryFile = join(process.cwd(), 'data', 'users', sessionId, 'summary-memory.json');
        this.logFile           = join(process.cwd(), 'data', 'users', sessionId, 'wa.log');

        // Per-user runtime state
        this.userSettings        = {};
        this.groq                = null;
        this.groqKey             = '';
        this.status              = 'loading';
        this.qr                  = null;
        this.client              = null;
        this.watchdogTimer       = null;
        this.unreadSyncTimer     = null;
        this.restartTimer        = null;
        this.restarting          = false;
        this.unreadSummaryBuckets = new Map();
        this.runtimeFetchCache   = new Map();
        this.memoryWriteQueue    = Promise.resolve();
        this.logWriteQueue       = Promise.resolve();
    }

    // ── Settings ──────────────────────────────────────────────────────────────
    // User-level settings override process.env defaults.
    getSetting(key, defaultVal = '') {
        const v = this.userSettings[key];
        if (v !== undefined && v !== '') return v;
        return process.env[key] || defaultVal;
    }

    getStatus() {
        return { status: this.status, qr: this.qr };
    }

    getSettingsForApi() {
        return {
            GROQ_API_KEY:          this.getSetting('GROQ_API_KEY') ? '***' : '',
            GROQ_API_KEY_SET:      Boolean(this.getSetting('GROQ_API_KEY')),
            GROQ_MODEL:            this.getSetting('GROQ_MODEL'),
            NTFY_TOPIC:            this.getSetting('NTFY_TOPIC'),
            NTFY_TOPIC_SET:        Boolean(this.getSetting('NTFY_TOPIC')),
            TUTORIAL_SEEN:         this.userSettings.TUTORIAL_SEEN === 'true',
            NTFY_TITLE:            this.getSetting('NTFY_TITLE'),
            NTFY_PRIORITY:         this.getSetting('NTFY_PRIORITY'),
            DEFAULT_MESSAGE_LIMIT: this.getSetting('DEFAULT_MESSAGE_LIMIT', '50'),
        };
    }

    async loadSettings() {
        try {
            const raw = await readFile(this.settingsFile, 'utf-8');
            this.userSettings = JSON.parse(raw);
        } catch {
            this.userSettings = {};
        }
    }

    async saveSettings(updates) {
        const ALLOWED = [
            'GROQ_API_KEY', 'GROQ_MODEL', 'NTFY_TOPIC', 'NTFY_TITLE',
            'NTFY_PRIORITY', 'DEFAULT_MESSAGE_LIMIT', 'TUTORIAL_SEEN',
        ];
        for (const key of ALLOWED) {
            if (updates[key] !== undefined) {
                if (key === 'GROQ_API_KEY' && String(updates[key]).trim() === '***') continue;
                this.userSettings[key] = updates[key];
            }
        }
        await mkdir(dirname(this.settingsFile), { recursive: true });
        await writeFile(this.settingsFile, JSON.stringify(this.userSettings, null, 2), 'utf-8');
    }

    async resetOnboardingSettings() {
        delete this.userSettings.GROQ_API_KEY;
        delete this.userSettings.NTFY_TOPIC;
        delete this.userSettings.TUTORIAL_SEEN;
        await mkdir(dirname(this.settingsFile), { recursive: true });
        await writeFile(this.settingsFile, JSON.stringify(this.userSettings, null, 2), 'utf-8');
    }

    // ── Groq client ───────────────────────────────────────────────────────────
    getGroqClient() {
        const apiKey = String(this.getSetting('GROQ_API_KEY') || '').trim();
        if (!apiKey) {
            throw new Error('GROQ_API_KEY is missing. Open Settings and save your Groq API key.');
        }
        if (!this.groq || this.groqKey !== apiKey) {
            this.groq = new Groq({ apiKey });
            this.groqKey = apiKey;
        }
        return this.groq;
    }

    // ── Logging ───────────────────────────────────────────────────────────────
    emit(level, message) {
        console.log(`[${this.sessionId.slice(0, 8)}] ${message}`);
        const line = `${new Date().toISOString()} [${String(level || 'info').toUpperCase()}] ${message}\n`;
        this.logWriteQueue = this.logWriteQueue
            .then(async () => {
                await mkdir(dirname(this.logFile), { recursive: true });
                await appendFile(this.logFile, line, 'utf-8');
            })
            .catch(() => {});
        this.io.to(this.sessionId).emit('log', { level, message });
    }

    // ── Auth / Chromium cleanup ───────────────────────────────────────────────
    async cleanupChromiumSingletonFiles() {
        const sessionDir = join(process.cwd(), '.wwebjs_auth', `session-${this.sessionId}`);
        for (const file of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
            try { await unlink(join(sessionDir, file)); } catch {}
        }
    }

    async clearAuthStorageWithRetries(maxAttempts = 10) {
        const userAuthDir = join(process.cwd(), '.wwebjs_auth', `session-${this.sessionId}`);
        let lastError = null;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                await rm(userAuthDir, { recursive: true, force: true });
                return;
            } catch (err) {
                lastError = err;
                if (!isRetriableAuthCleanupError(err) || attempt === maxAttempts) throw err;
                await sleep(300 * attempt);
            }
        }
        if (lastError) throw lastError;
    }

    // ── Memory ────────────────────────────────────────────────────────────────
    async loadSummaryMemory() {
        try {
            const raw = await readFile(this.summaryMemoryFile, 'utf-8');
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object') return { chats: {} };
            if (!parsed.chats || typeof parsed.chats !== 'object') parsed.chats = {};
            return parsed;
        } catch {
            return { chats: {} };
        }
    }

    async saveSummaryMemory(memory) {
        await mkdir(dirname(this.summaryMemoryFile), { recursive: true });
        await writeFile(this.summaryMemoryFile, JSON.stringify(memory, null, 2), 'utf-8');
    }

    async queueMemoryUpdate(updater) {
        this.memoryWriteQueue = this.memoryWriteQueue
            .then(async () => {
                const memory = await this.loadSummaryMemory();
                await updater(memory);
                await this.saveSummaryMemory(memory);
            })
            .catch(err => this.emit('error', `[MEMORY] Failed: ${err.message}`));
        return this.memoryWriteQueue;
    }

    async getChatMemory(chatId) {
        const memory = await this.loadSummaryMemory();
        return memory.chats?.[chatId] || null;
    }

    async loadMessageCache(chatId) {
        const memory = await this.loadSummaryMemory();
        return memory.chats?.[chatId]?.messageCache || null;
    }

    async saveMessageCache(chatId, payload) {
        if (!chatId || !payload) return;
        await this.queueMemoryUpdate(async (memory) => {
            const chats = memory.chats || (memory.chats = {});
            const entry = chats[chatId] || { chatName: '', participants: [], summaries: [], updatedAt: null };
            entry.messageCache = payload;
            chats[chatId] = entry;
        });
    }

    async rememberChatDirectory(chat, participants = []) {
        if (!chat?.id?._serialized) return;
        const chatId   = chat.id._serialized;
        const chatName = chat.name || chat.id.user || '';
        await this.queueMemoryUpdate(async (memory) => {
            const directory = memory.chatDirectory || (memory.chatDirectory = {});
            const names     = memory.chatNames    || (memory.chatNames    = {});
            const entry = directory[chatId] || { chatId, chatName, isGroup: !!chat.isGroup, phones: [], updatedAt: null };
            entry.chatName  = chatName || entry.chatName;
            entry.isGroup   = !!chat.isGroup;
            entry.updatedAt = new Date().toISOString();
            const merged = new Set(entry.phones || []);
            for (const p of participants) { if (p && typeof p === 'string') merged.add(p); }
            entry.phones = [...merged].slice(0, 200);
            directory[chatId] = entry;
            const normalized = normalizeName(chatName);
            if (normalized) names[normalized] = chatId;
        });
    }

    async findChatByNameFromMemory(c, groupName) {
        const memory    = await this.loadSummaryMemory();
        const names     = memory.chatNames    || {};
        const directory = memory.chatDirectory || {};
        const normalized = normalizeName(groupName);

        const exactId = names[normalized];
        if (exactId) {
            try { return await withTimeout(c.getChatById(exactId), 15_000, 'getChatById memory exact'); } catch {}
        }
        const partial = Object.values(directory).find(e => normalizeName(e?.chatName).includes(normalized));
        if (partial?.chatId) {
            try { return await withTimeout(c.getChatById(partial.chatId), 15_000, 'getChatById memory partial'); } catch {}
        }
        return null;
    }

    formatMemoryForPrompt(chatMemory) {
        if (!chatMemory) return [];
        const lines = [];
        const participants = Array.isArray(chatMemory.participants) ? chatMemory.participants.filter(Boolean) : [];
        if (participants.length > 0) {
            lines.push(`[MEMORY] Known participants: ${participants.slice(0, 20).join(', ')}`);
        }
        const summaries = Array.isArray(chatMemory.summaries) ? chatMemory.summaries : [];
        if (summaries.length > 0) {
            lines.push('[MEMORY] Previous summaries from this chat:');
            for (const s of summaries.slice(-3)) {
                const stamp = s.at ? new Date(s.at).toISOString() : 'unknown-time';
                lines.push(`[MEMORY] ${stamp}: ${trimTo(s.text || '', 260)}`);
            }
        }
        return lines;
    }

    async rememberChatSummary({ chatId, chatName, participants, summary }) {
        if (!chatId || !summary) return;
        const MAX_STORED = parseInt(this.getSetting('MAX_STORED_SUMMARIES_PER_CHAT', '10'));
        await this.queueMemoryUpdate(async (memory) => {
            const chats    = memory.chats || (memory.chats = {});
            const existing = chats[chatId] || { chatName: chatName || '', participants: [], summaries: [], updatedAt: null };
            existing.chatName = chatName || existing.chatName || '';
            const mergedParticipants = new Set([...(existing.participants || [])]);
            for (const p of participants || []) { if (p && typeof p === 'string') mergedParticipants.add(p); }
            existing.participants = [...mergedParticipants].slice(0, 50);
            existing.summaries = [
                ...(existing.summaries || []),
                { at: new Date().toISOString(), text: trimTo(summary, 1200) },
            ].slice(-Math.max(1, MAX_STORED));
            existing.updatedAt = new Date().toISOString();
            chats[chatId] = existing;
        });
    }

    // ── Media ─────────────────────────────────────────────────────────────────
    async describeImageForContext(media) {
        const ENABLE_MEDIA = (this.getSetting('ENABLE_MEDIA_ANALYSIS', 'true')).toLowerCase() !== 'false';
        const VISION_MODEL  = this.getSetting('GROQ_VISION_MODEL', '');
        const MAX_BYTES     = parseInt(this.getSetting('MEDIA_VISION_MAX_BYTES', '3000000'));

        if (!ENABLE_MEDIA || !VISION_MODEL || !media?.data || !media?.mimetype?.startsWith('image/')) return '';
        if (!SUPPORTED_VISION_MIME_TYPES.has(String(media.mimetype).toLowerCase())) return '';
        const normalizedBase64 = String(media.data).replace(/\s+/g, '');
        if (!/^[A-Za-z0-9+/=]+$/.test(normalizedBase64)) return '';
        if (Math.floor((normalizedBase64.length * 3) / 4) > MAX_BYTES) return '';

        try {
            const response = await withTimeout(
                this.getGroqClient().chat.completions.create({
                    model: VISION_MODEL,
                    messages: [
                        { role: 'system', content: 'Describe this WhatsApp media in one short, factual sentence for chat context. No markdown.' },
                        { role: 'user', content: [
                            { type: 'text', text: 'Describe the key visible content briefly.' },
                            { type: 'image_url', image_url: { url: `data:${media.mimetype};base64,${normalizedBase64}` } },
                        ]},
                    ],
                    temperature: 0.2,
                }),
                45_000, 'Groq vision'
            );
            return sanitizeForWhatsApp(response.choices?.[0]?.message?.content || '');
        } catch (err) {
            if (!String(err.message || '').toLowerCase().includes('invalid image data')) {
                this.emit('error', `[MEDIA] Vision analysis failed: ${err.message}`);
            }
            return '';
        }
    }

    async describeMediaMessage(message, deepAnalyze = true) {
        const type = message.type || 'media';
        let detail = `[MEDIA:${type}]`;
        const body = (message.body || '').trim();
        if (body) detail += ` caption="${trimTo(body, 120)}"`;
        if (!message.hasMedia || !deepAnalyze) return detail;
        try {
            const media = await withTimeout(message.downloadMedia(), 20_000, 'downloadMedia');
            if (media?.mimetype) detail += ` mime=${media.mimetype}`;
            if (media?.filename) detail += ` file=${media.filename}`;
            const vision = await this.describeImageForContext(media);
            if (vision) detail += ` visual="${trimTo(vision, 180)}"`;
        } catch (err) {
            detail += ' media=unavailable';
            this.emit('error', `[MEDIA] Failed to read media: ${err.message}`);
        }
        return detail;
    }

    // ── Watchdog & unread sync ────────────────────────────────────────────────
    startWatchdog() {
        if (this.watchdogTimer) clearInterval(this.watchdogTimer);
        this.watchdogTimer = setInterval(async () => {
            if (this.status !== 'connected' || this.restarting) return;
            try {
                const state = await withTimeout(this.client.getState(), WATCHDOG_TIMEOUT, 'watchdog getState');
                this.emit('info', `[WATCHDOG] Client alive — state: ${state}`);
            } catch (err) {
                this.emit('error', `[WATCHDOG] Client unresponsive (${err.message}) — restarting...`);
                this.restartClient();
            }
        }, WATCHDOG_INTERVAL);
    }

    async syncUnreadSummaryBuckets() {
        if (this.status !== 'connected' || this.restarting) return;
        const AUTO_THRESHOLD = parseInt(this.getSetting('AUTO_SUMMARY_THRESHOLD', '100'));
        try {
            const chats = await withTimeout(this.client.getChats(), 30_000, 'sync unread getChats');
            for (const chat of chats) {
                if (!chat.isGroup) continue;
                const chatId = chat.id?._serialized;
                if (!chatId) continue;
                const unread       = Number(chat.unreadCount || 0);
                const actualBucket = Math.floor(unread / AUTO_THRESHOLD);
                const storedBucket = this.unreadSummaryBuckets.get(chatId) || 0;
                if (storedBucket !== actualBucket) {
                    this.unreadSummaryBuckets.set(chatId, actualBucket);
                    if (storedBucket > actualBucket) {
                        this.emit('info', `[AUTO] Reset unread state for "${chat.name || chat.id.user}" -> unread=${unread}`);
                    }
                }
            }
        } catch (err) {
            if (this.restarting || isTargetClosedError(err)) return;
            this.emit('error', `[AUTO] Failed syncing unread counts: ${err.message}`);
        }
    }

    startUnreadSync() {
        if (this.unreadSyncTimer) clearInterval(this.unreadSyncTimer);
        this.unreadSyncTimer = setInterval(() => this.syncUnreadSummaryBuckets(), UNREAD_SYNC_INTERVAL);
    }

    resetUnreadCount(chatId) {
        this.unreadSummaryBuckets.delete(chatId);
    }

    scheduleRestart(source = 'INIT', delayMs = 10_000) {
        if (this.restarting || this.restartTimer) return;
        this.restartTimer = setTimeout(() => {
            this.restartTimer = null;
            this.restartClient(source);
        }, delayMs);
    }

    beginClientInitialisation(source = 'INIT') {
        this.cleanupChromiumSingletonFiles().finally(() =>
            this.client.initialize().catch(err => {
                const detail = isTargetClosedError(err)
                    ? `${err.message} — Chromium navigated during WhatsApp boot`
                    : err.message;
                this.emit('error', `[${source}] initialize() failed: ${detail} — retrying in 10 s...`);
                this.scheduleRestart(source, 10_000);
            })
        );
    }

    // ── Client restart ────────────────────────────────────────────────────────
    async restartClient(source = 'WATCHDOG') {
        if (this.restarting) return;
        this.restarting = true;
        if (this.restartTimer) {
            clearTimeout(this.restartTimer);
            this.restartTimer = null;
        }
        this.status = 'loading';
        this.emit('error', `[${source}] Destroying stale client...`);

        if (this.watchdogTimer) { clearInterval(this.watchdogTimer); this.watchdogTimer = null; }
        if (this.unreadSyncTimer) { clearInterval(this.unreadSyncTimer); this.unreadSyncTimer = null; }

        const browserProc = this.client?.pupBrowser?.process();
        if (browserProc && !browserProc.killed) {
            try { browserProc.kill(); } catch {}
        }
        try { await this.client.destroy(); } catch {}
        this.client = null;
        await this.cleanupChromiumSingletonFiles();

        setTimeout(() => {
            this.restarting = false;
            this.emit('info', `[${source}] Re-initialising WhatsApp client...`);
            this.client = this.createAndBindClient();
            this.beginClientInitialisation('INIT');
        }, 5_000);
    }

    // ── Client factory ────────────────────────────────────────────────────────
    createAndBindClient() {
        const self = this;
        const c = new Client({
            authStrategy: new LocalAuth({ clientId: this.sessionId }),
            puppeteer: {
                executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--no-first-run',
                ],
            },
        });

        c.on('qr', qr => {
            self.status = 'qr';
            self.qr = qr;
            qrcode.generate(qr, { small: true });
            self.io.to(self.sessionId).emit('qr', qr);
        });

        c.on('ready', () => {
            self.status = 'connected';
            self.qr = null;
            self.emit('success', '[STATUS] WhatsApp client is ready');
            self.io.to(self.sessionId).emit('ready');
            self.startWatchdog();
            self.startUnreadSync();
            self.syncUnreadSummaryBuckets();
            if (c.pupPage) {
                c.pupPage.on('crash', () => {
                    self.emit('error', '[PUPPETEER] Page crashed — restarting...');
                    self.restartClient();
                });
                c.pupPage.on('close', () => {
                    if (self.status === 'connected') {
                        self.emit('error', '[PUPPETEER] Page closed unexpectedly — restarting...');
                        self.restartClient();
                    }
                });
            }
        });

        c.on('disconnected', reason => {
            self.emit('error', `[STATUS] WhatsApp client disconnected (${reason}) — restarting in 5 s...`);
            self.restartClient();
        });

        c.on('auth_failure', msg => {
            self.status = 'loading';
            self.emit('error', `[AUTH] Authentication failed: ${msg}`);
        });

        this._attachMessageCreate(c);
        return c;
    }

    // ── Summarise ─────────────────────────────────────────────────────────────
    async summariseChat(chat, limit, detailed = false) {
        const DEFAULT_LIMIT  = parseInt(this.getSetting('DEFAULT_MESSAGE_LIMIT', '50'));
        const safeLimit      = Math.max(1, parseInt(limit) || DEFAULT_LIMIT);
        const contextExtra   = Math.max(0, parseInt(this.getSetting('SUMMARY_CONTEXT_EXTRA', '30')));
        const CACHE_TTL      = parseInt(this.getSetting('SUMMARY_FETCH_CACHE_TTL_MS', '120000'));
        const fetchLimit     = safeLimit + contextExtra + 12;

        const chatId   = chat.id?._serialized;
        const chatName = chat.name || chat.id?.user || '';
        const chatMemory = chatId ? await this.getChatMemory(chatId) : null;

        let contextMessages = [], targetMessages = [];
        let cachedContextLines = null, cachedTargetLines = null;
        let usedCache = false;
        let rawFetchedCount = 0, afterCommandFilterCount = 0, selectedTargetMessageCount = 0;

        const latestMessageId = await this.getLatestMessageId(chat);
        const runtimeCached = this.runtimeFetchCache.get(chatId);
        if (runtimeCached
            && Date.now() - runtimeCached.cachedAt <= CACHE_TTL
            && runtimeCached.latestMessageId === latestMessageId
            && runtimeCached.limit >= safeLimit) {
            contextMessages = runtimeCached.contextMessages.slice(-contextExtra);
            targetMessages  = runtimeCached.targetMessages.slice(-safeLimit);
            selectedTargetMessageCount = targetMessages.length;
            usedCache = true;
        }

        if (!usedCache && chatId) {
            const persistedCache = await this.loadMessageCache(chatId);
            if (persistedCache
                && Date.now() - new Date(persistedCache.cachedAt || 0).getTime() <= CACHE_TTL
                && persistedCache.latestMessageId === latestMessageId
                && persistedCache.limit >= safeLimit) {
                cachedContextLines = persistedCache.contextLines || [];
                cachedTargetLines  = persistedCache.targetLines  || [];
                usedCache = true;
            }
        }

        if (!usedCache) {
            const allMessages = await withTimeout(chat.fetchMessages({ limit: fetchLimit }), 45_000, 'fetchMessages');
            rawFetchedCount = allMessages.length;
            const filtered = allMessages.filter(m => !isSummarizeCommand(m.body || ''));
            afterCommandFilterCount = filtered.length;
            targetMessages  = filtered.slice(-safeLimit);
            selectedTargetMessageCount = targetMessages.length;
            contextMessages = filtered.slice(0, Math.max(0, filtered.length - targetMessages.length)).slice(-contextExtra);
            const runtimePayload = { cachedAt: Date.now(), latestMessageId, limit: safeLimit, contextMessages, targetMessages };
            if (chatId) this.runtimeFetchCache.set(chatId, runtimePayload);
        }

        const MAX_MEDIA   = parseInt(this.getSetting('MAX_MEDIA_ANALYSIS_PER_SUMMARY', '12'));
        const ENABLE_MEDIA = (this.getSetting('ENABLE_MEDIA_ANALYSIS', 'true')).toLowerCase() !== 'false';
        const participantsSeen = new Set();
        const contactNameCache = new Map();
        let mediaAnalysedCount = 0;

        const resolveMessages = async (messages, label) => {
            const lines = [];
            for (const message of messages) {
                if (!message.body && !message.hasMedia) continue;
                let contact_name = 'Unknown', phone = '';

                if (message.fromMe) {
                    contact_name = this.client.info?.pushname || this.client.info?.wid?.user || 'Me';
                    phone = extractPhoneFromJid(this.client.info?.wid?._serialized || this.client.info?.wid?.user);
                } else {
                    const contactKey = String(message.author || message.from || 'unknown');
                    const cached = contactNameCache.get(contactKey);
                    if (cached) {
                        contact_name = cached.name; phone = cached.phone;
                    } else {
                        try {
                            const contact = await withTimeout(message.getContact(), 8_000, 'getContact');
                            contact_name = contact.name || contact.pushname || message.author || 'Unknown';
                            phone = extractPhoneFromJid(contact.number || contact.id?._serialized || message.author || message.from);
                        } catch {
                            contact_name = message.author || message.from || 'Unknown';
                            phone = extractPhoneFromJid(message.author || message.from);
                        }
                        contactNameCache.set(contactKey, { name: contact_name, phone });
                    }
                }

                const who = message.fromMe
                    ? contact_name
                    : `${message.author ?? contact_name} aka ${contact_name}`;
                participantsSeen.add(phone ? `${contact_name} (${phone})` : contact_name);

                if (message.body) lines.push(`[${label}] ${who}: ${message.body}`);
                if (message.hasMedia) {
                    const allowDeep = label === 'SUMMARY TARGET' && ENABLE_MEDIA && mediaAnalysedCount < MAX_MEDIA;
                    if (allowDeep) mediaAnalysedCount++;
                    lines.push(`[${label}] ${who}: ${await this.describeMediaMessage(message, allowDeep)}`);
                }
            }
            return lines;
        };

        const contextLines = cachedContextLines || await resolveMessages(contextMessages, 'CONTEXT');
        const targetLines  = cachedTargetLines  || await resolveMessages(targetMessages,  'SUMMARY TARGET');

        if (chatId && !cachedContextLines && !cachedTargetLines) {
            await this.saveMessageCache(chatId, {
                cachedAt: new Date().toISOString(), latestMessageId, limit: safeLimit, contextLines, targetLines,
            });
        }
        if (cachedTargetLines) selectedTargetMessageCount = Math.max(selectedTargetMessageCount, cachedTargetLines.length);

        const message_collection = [...this.formatMemoryForPrompt(chatMemory), ...contextLines, ...targetLines];
        this.emit('info', `[STATUS] Messages fetched${usedCache ? ' (cache)' : ''} — target=${targetLines.length}, context=${contextLines.length}`);
        this.emit('info', `[STATUS] rawFetched=${rawFetchedCount || 'cache'}, afterFilter=${afterCommandFilterCount || 'cache'}, selected=${selectedTargetMessageCount}`);
        this.emit('info', '[STATUS] Sending messages to AI...');

        const detailPrefix = detailed
            ? 'Provide a DETAILED, thorough summary covering all decisions, conclusions, questions asked, and important context from the [SUMMARY TARGET] messages. Do not omit anything significant.\n\n'
            : '';

        const ai_response = await withTimeout(
            this.getGroqClient().chat.completions.create({
                model: this.getSetting('GROQ_MODEL'),
                messages: [
                    { role: 'system', content: detailPrefix + systemPrompt.trim() },
                    { role: 'user',   content: message_collection.join('\n') },
                ],
            }),
            90_000, 'Groq API'
        );

        const summary = sanitizeForWhatsApp(
            ai_response.choices[0].message.content.replace(/<think>.*?<\/think>/gs, '').trim()
        );

        await this.rememberChatSummary({ chatId, chatName, participants: [...participantsSeen], summary });
        await this.rememberChatDirectory(chat, [...participantsSeen].map(p => {
            const match = p.match(/\((\d{6,15})\)/);
            return match ? match[1] : '';
        }).filter(Boolean));

        this.emit('success', '[STATUS] Summary generated');
        return summary;
    }

    async getLatestMessageId(chat) {
        try {
            const latest = await withTimeout(chat.fetchMessages({ limit: 1 }), 12_000, 'fetchMessages latest');
            return latest?.[0] ? messageIdOf(latest[0]) : '';
        } catch { return ''; }
    }

    // ── ntfy ──────────────────────────────────────────────────────────────────
    async sendNtfy(summary) {
        const topic = this.getSetting('NTFY_TOPIC');
        if (!topic) { this.emit('error', '[NTFY] No NTFY_TOPIC configured.'); return; }
        try {
            const response = await withTimeout(
                axios.post(topic, summary, {
                    headers: {
                        'Title':    this.getSetting('NTFY_TITLE'),
                        'Priority': this.getSetting('NTFY_PRIORITY'),
                    },
                }),
                15_000, 'ntfy'
            );
            this.emit('success', '[STATUS] Notification sent: ' + response.data.message);
        } catch (error) {
            this.emit('error', '[STATUS] Error sending notification: ' + error.message);
        }
    }

    // ── General Q&A ───────────────────────────────────────────────────────────
    async answerGeneralQuestion(question) {
        const prompt = String(question || '').trim();
        if (!prompt) return 'Usage: !general <your question>';
        const targetWordCount = extractRequestedWordCount(prompt);

        const ai_response = await withTimeout(
            this.getGroqClient().chat.completions.create({
                model: this.getSetting('GROQ_MODEL'),
                messages: [
                    { role: 'system', content: 'Answer the user question directly. Output only the answer text with no preamble, no labels, and no extra commentary.' },
                    { role: 'user',   content: prompt },
                ],
                temperature: 0.2,
            }),
            90_000, 'Groq API general'
        );

        let answer = sanitizeForWhatsApp(
            String(ai_response?.choices?.[0]?.message?.content || '')
                .replace(/<think>.*?<\/think>/gs, '').trim()
        );

        if (targetWordCount) {
            const currentCount = getWordCount(answer);
            if (currentCount !== targetWordCount) {
                try {
                    const rewrite = await withTimeout(
                        this.getGroqClient().chat.completions.create({
                            model: this.getSetting('GROQ_MODEL'),
                            messages: [
                                { role: 'system', content: `Rewrite the answer so it contains exactly ${targetWordCount} words. Return only the rewritten answer text.` },
                                { role: 'user',   content: answer },
                            ],
                            temperature: 0,
                        }),
                        60_000, 'Groq API general rewrite'
                    );
                    answer = sanitizeForWhatsApp(
                        String(rewrite?.choices?.[0]?.message?.content || '')
                            .replace(/<think>.*?<\/think>/gs, '').trim()
                    );
                } catch {}
                if (getWordCount(answer) !== targetWordCount) answer = forceWordCount(answer, targetWordCount);
            }
        }
        return answer;
    }

    // ── Command gating ────────────────────────────────────────────────────────
    isCommandAllowedForMessage(msg) {
        if (msg?.fromMe) return true;
        const ALLOW_PUBLIC = (process.env.ALLOW_PUBLIC_COMMANDS || 'false').toLowerCase() === 'true';
        if (!ALLOW_PUBLIC) return false;
        const ALLOWED_PHONES = new Set(
            String(process.env.ALLOWED_COMMAND_PHONES || '').split(',').map(v => v.trim()).filter(Boolean)
        );
        if (ALLOWED_PHONES.size === 0) return true;
        const phone = extractPhoneFromJid(msg?.author || msg?.from);
        return phone ? ALLOWED_PHONES.has(phone) : false;
    }

    // ── Message handler ───────────────────────────────────────────────────────
    _attachMessageCreate(c) {
        c.on('message_create', async (msg) => {
            const AUTO_THRESHOLD = parseInt(this.getSetting('AUTO_SUMMARY_THRESHOLD', '100'));

            if (!msg.fromMe) {
                let chat;
                try { chat = await withTimeout(msg.getChat(), 15_000, 'getChat'); }
                catch (err) { this.emit('error', '[AUTO] Failed to get chat: ' + err.message); return; }

                let senderName = 'Unknown', senderPhone = '';
                try {
                    const contact = await withTimeout(msg.getContact(), 8_000, 'getContact');
                    senderName  = contact.name || contact.pushname || msg.author || 'Unknown';
                    senderPhone = extractPhoneFromJid(contact.number || contact.id?._serialized || msg.author || msg.from);
                } catch {}
                this.emit('info', `[MSG] "${chat.name || chat.id.user}" from ${senderName}: ${msg.body}`);
                await this.rememberChatDirectory(chat, senderPhone ? [senderPhone] : []);

                if (msg.body.toLowerCase().trim() === 'whatsapp summary') {
                    this.emit('info', `[TRIGGER] "whatsapp summary" requested in "${chat.name || chat.id.user}"`);
                    try {
                        const summary = await withTimeout(
                            this.summariseChat(chat, parseInt(this.getSetting('DEFAULT_MESSAGE_LIMIT', '50'))),
                            120_000, 'summariseChat trigger'
                        );
                        await withTimeout(chat.sendMessage(summary), 15_000, 'sendMessage');
                        this.io.to(this.sessionId).emit('summary_done', summary);
                    } catch (err) { this.emit('error', '[TRIGGER ERROR] ' + err.message); }
                    return;
                }

                if (chat.isGroup) {
                    const id = chat.id._serialized;
                    let latestChat = chat;
                    try { latestChat = await withTimeout(c.getChatById(id), 15_000, 'getChatById auto'); } catch {}
                    const unread     = Number(latestChat.unreadCount || 0);
                    const bucket     = Math.floor(unread / AUTO_THRESHOLD);
                    const lastBucket = this.unreadSummaryBuckets.get(id) || 0;
                    this.emit('info', `[AUTO] "${latestChat.name || chat.name}" unreadCount: ${unread}/${AUTO_THRESHOLD}`);
                    if (bucket === 0) { if (lastBucket !== 0) this.unreadSummaryBuckets.set(id, 0); return; }
                    if (bucket <= lastBucket) return;
                    this.unreadSummaryBuckets.set(id, bucket);
                    this.emit('info', `[AUTO] Threshold hit for "${latestChat.name || chat.name}" (unread=${unread}) — generating summary...`);
                    try {
                        const summary = await withTimeout(
                            this.summariseChat(latestChat, AUTO_THRESHOLD), 120_000, 'summariseChat auto'
                        );
                        const ntfyText = `📋 ${latestChat.name || chat.name}\n\n${summary}`;
                        await withTimeout(this.sendNtfy(ntfyText), 20_000, 'sendNtfy auto');
                        this.io.to(this.sessionId).emit('summary_done', summary);
                    } catch (err) {
                        this.unreadSummaryBuckets.set(id, Math.max(0, bucket - 1));
                        this.emit('error', '[AUTO ERROR] ' + err.message);
                    }
                }
            }

            if (msg.fromMe) {
                try {
                    const chat = await withTimeout(msg.getChat(), 15_000, 'getChat fromMe');
                    this.emit('info', `[YOU → "${chat.name || chat.id.user}"]: ${msg.body}`);
                } catch {}
            }

            if (isGeneralCommand(msg.body) && this.isCommandAllowedForMessage(msg)) {
                try {
                    const replyChat = await withTimeout(msg.getChat(), 15_000, 'getChat general reply');
                    const question  = String(msg.body || '').trim().slice('!general'.length).trim();
                    const answer    = await this.answerGeneralQuestion(question);
                    await withTimeout(replyChat.sendMessage(answer), 20_000, 'sendMessage general');
                } catch (err) { this.emit('error', '[GENERAL ERROR] ' + err.message); }
                return;
            }

            if (isSummarizeCommand(msg.body) && this.isCommandAllowedForMessage(msg)) {
                const raw      = msg.body;
                const detailed = raw.trimEnd().toLowerCase().endsWith(' detail');
                const stripped = detailed ? raw.trimEnd().slice(0, -7).trimEnd() : raw;
                const parts    = stripped.split(' ');
                const secondArg = parts[1];
                let targetChat, number_of_messages;
                const replyChat = await withTimeout(msg.getChat(), 15_000, 'getChat cmd reply');

                if (!secondArg) {
                    targetChat = replyChat;
                    number_of_messages = parseInt(this.getSetting('DEFAULT_MESSAGE_LIMIT', '50'));
                } else if (!isNaN(secondArg)) {
                    targetChat = replyChat;
                    number_of_messages = parseInt(secondArg);
                } else {
                    const lastArg  = parts[parts.length - 1];
                    const hasCount = !isNaN(lastArg) && parts.length > 2;
                    number_of_messages = hasCount ? parseInt(lastArg) : parseInt(this.getSetting('DEFAULT_MESSAGE_LIMIT', '50'));
                    const groupName    = hasCount ? parts.slice(1, -1).join(' ') : parts.slice(1).join(' ');
                    this.emit('info', `[STATUS] Searching for chat: "${groupName}"`);
                    targetChat = await this.findChatByNameFromMemory(c, groupName);
                    if (!targetChat) {
                        const allChats = await withTimeout(this.client.getChats(), 30_000, 'getChats');
                        targetChat = allChats.find(ch => ch.name?.toLowerCase() === groupName.toLowerCase())
                            || allChats.find(ch => ch.name?.toLowerCase().includes(groupName.toLowerCase()));
                        for (const ch of allChats) await this.rememberChatDirectory(ch, []);
                    }
                    if (!targetChat) { this.emit('error', `[ERROR] No chat found matching "${groupName}"`); return; }
                    this.emit('info', `[STATUS] Found chat: "${targetChat.name}"`);
                }

                try {
                    const summary = await withTimeout(
                        this.summariseChat(targetChat, number_of_messages, detailed), 120_000, 'summariseChat cmd'
                    );
                    await withTimeout(replyChat.sendMessage(summary), 20_000, 'sendMessage cmd');
                    this.io.to(this.sessionId).emit('summary_done', summary);
                } catch (err) { this.emit('error', '[ERROR] ' + err.message); }
            }
        });
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────
    async start() {
        await this.loadSettings();
        this.client = this.createAndBindClient();
        this.beginClientInitialisation('INIT');
    }

    async logout() {
        this.emit('info', '[LOGOUT] Logging out WhatsApp session...');
        this.restarting = true;

        if (this.watchdogTimer)   { clearInterval(this.watchdogTimer);   this.watchdogTimer   = null; }
        if (this.unreadSyncTimer) { clearInterval(this.unreadSyncTimer); this.unreadSyncTimer = null; }
        if (this.restartTimer)    { clearTimeout(this.restartTimer);      this.restartTimer    = null; }

        let didLogoutGracefully = false;
        try {
            await withTimeout(this.client.logout(), 20_000, 'logout');
            didLogoutGracefully = true;
        } catch (err) { this.emit('error', `[LOGOUT] logout() failed: ${err.message}`); }

        if (!didLogoutGracefully) {
            const browserProc = this.client?.pupBrowser?.process();
            if (browserProc && !browserProc.killed) {
                try { browserProc.kill(); } catch {}
            }
        }

        try { await withTimeout(this.client.destroy(), 20_000, 'destroy after logout'); }
        catch (err) { this.emit('error', `[LOGOUT] destroy() failed: ${err.message}`); }

        try { await this.clearAuthStorageWithRetries(); }
        catch (err) { this.emit('error', `[LOGOUT] Failed to clear auth storage: ${err.message}`); }

        try { await this.resetOnboardingSettings(); }
        catch (err) { this.emit('error', `[LOGOUT] Failed to reset onboarding settings: ${err.message}`); }

        this.unreadSummaryBuckets.clear();
        this.runtimeFetchCache.clear();
        await this.cleanupChromiumSingletonFiles();
        this.status = 'loading';
        this.qr = null;
        this.io.to(this.sessionId).emit('status', 'loading');

        await sleep(1500);
        this.restarting = false;
        this.client = this.createAndBindClient();
        this.beginClientInitialisation('LOGOUT');
    }
}
