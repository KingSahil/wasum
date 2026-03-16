// dotenv is configured in entry.cjs (pkg bootstrap) before this module loads
import pkg from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import Groq from 'groq-sdk';
import axios from 'axios';
import { readFile, writeFile, unlink, mkdir, appendFile, rm } from 'fs/promises';
import { join, dirname } from 'path';
// systemPrompt is inlined by esbuild from generated-prompt.cjs (built by build.js)
import systemPrompt from './generated-prompt.cjs';

const { Client, LocalAuth } = pkg;

let groq = null;
let groqKey = '';

function getGroqClient() {
    const apiKey = String(process.env.GROQ_API_KEY || '').trim();
    if (!apiKey) {
        throw new Error('GROQ_API_KEY is missing. Open Settings in the frontend and save your Groq API key.');
    }

    if (!groq || groqKey !== apiKey) {
        groq = new Groq({ apiKey });
        groqKey = apiKey;
    }

    return groq;
}

let _io = null;
let _status = 'loading'; // 'loading' | 'qr' | 'connected'
let _qr = null;

// Auto-summary: trigger from WhatsApp's real unreadCount (per group chat).
// We keep only the last triggered unread bucket to avoid duplicate sends.
const unreadSummaryBuckets = new Map();
const AUTO_THRESHOLD = parseInt(process.env.AUTO_SUMMARY_THRESHOLD || '100');
const SUMMARY_MEMORY_FILE = join(process.cwd(), 'data', 'summary-memory.json');
const LOG_FILE = join(process.cwd(), 'logs', 'wa-summariser.log');
const MAX_STORED_SUMMARIES_PER_CHAT = parseInt(process.env.MAX_STORED_SUMMARIES_PER_CHAT || '10');
const SUMMARY_CONTEXT_EXTRA = parseInt(process.env.SUMMARY_CONTEXT_EXTRA || '30');
const SUMMARY_FETCH_CACHE_TTL_MS = parseInt(process.env.SUMMARY_FETCH_CACHE_TTL_MS || '120000');
const MAX_MEDIA_ANALYSIS_PER_SUMMARY = parseInt(process.env.MAX_MEDIA_ANALYSIS_PER_SUMMARY || '12');
const ENABLE_MEDIA_ANALYSIS = (process.env.ENABLE_MEDIA_ANALYSIS || 'true').toLowerCase() !== 'false';
const VISION_MODEL = process.env.GROQ_VISION_MODEL || '';
const MAX_VISION_BYTES = parseInt(process.env.MEDIA_VISION_MAX_BYTES || '3000000');
const ALLOW_PUBLIC_COMMANDS = (process.env.ALLOW_PUBLIC_COMMANDS || 'false').toLowerCase() === 'true';
const ALLOWED_COMMAND_PHONES = new Set(
    String(process.env.ALLOWED_COMMAND_PHONES || '')
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean)
);
const SUPPORTED_VISION_MIME_TYPES = new Set([
    'image/jpeg',
    'image/jpg',
    'image/png',
]);

let memoryWriteQueue = Promise.resolve();
let logWriteQueue = Promise.resolve();
const runtimeFetchCache = new Map();

// ── Timeout helper ────────────────────────────────────────────────────────────
// Rejects with a clear error if `promise` doesn't resolve within `ms` ms.
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

// ── Watchdog ──────────────────────────────────────────────────────────────────
// Periodically verifies the WhatsApp Puppeteer page is still alive.
// If it stops responding, the client is destroyed and re-initialised.
const WATCHDOG_INTERVAL = 2 * 60 * 1000;  // ping every 2 minutes
const WATCHDOG_TIMEOUT  = 30 * 1000;       // treat as dead after 30 s
const UNREAD_SYNC_INTERVAL = 30 * 1000;

let _watchdogTimer = null;
let _restarting    = false;
let _unreadSyncTimer = null;

async function cleanupChromiumSingletonFiles() {
    const sessionDir = join(process.cwd(), '.wwebjs_auth', 'session');
    const singletonFiles = ['SingletonLock', 'SingletonSocket', 'SingletonCookie'];

    for (const file of singletonFiles) {
        try {
            await unlink(join(sessionDir, file));
        } catch {
            // Ignore missing/locked files and continue cleanup attempts.
        }
    }
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetriableAuthCleanupError(err) {
    const code = String(err?.code || '').toUpperCase();
    return code === 'EBUSY' || code === 'EPERM' || code === 'ENOTEMPTY';
}

async function clearAuthStorageWithRetries(maxAttempts = 10) {
    const authDir = join(process.cwd(), '.wwebjs_auth');
    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            await rm(authDir, { recursive: true, force: true });
            return;
        } catch (err) {
            lastError = err;
            if (!isRetriableAuthCleanupError(err) || attempt === maxAttempts) {
                throw err;
            }
            // Backoff gives Chromium/SQLite time to release file handles on Windows.
            await sleep(300 * attempt);
        }
    }

    if (lastError) throw lastError;
}

function sanitizeForWhatsApp(text) {
    if (!text) return '';
    return text
    // Convert common markdown formatting to WhatsApp-supported syntax.
    .replace(/\*\*(.*?)\*\*/g, '*$1*')
    .replace(/__(.*?)__/g, '_$1_')
    .replace(/~~(.*?)~~/g, '~$1~')
    // Convert markdown headings to WhatsApp bold section titles.
    .replace(/^\s{0,3}#{1,6}\s+(.+)$/gm, '*$1*')
    // Normalize list formats for WhatsApp.
    .replace(/^\s*\*\s+/gm, '- ')
    .replace(/^\s*(\d+)\)\s+/gm, '$1. ')
        // Normalize excessive blank lines.
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

async function getLatestMessageId(chat) {
    try {
        const latest = await withTimeout(chat.fetchMessages({ limit: 1 }), 12_000, 'fetchMessages latest');
        return latest?.[0] ? messageIdOf(latest[0]) : '';
    } catch {
        return '';
    }
}

async function loadMessageCache(chatId) {
    const memory = await loadSummaryMemory();
    return memory.chats?.[chatId]?.messageCache || null;
}

async function saveMessageCache(chatId, payload) {
    if (!chatId || !payload) return;
    await queueMemoryUpdate(async (memory) => {
        const chats = memory.chats || (memory.chats = {});
        const entry = chats[chatId] || {
            chatName: '',
            participants: [],
            summaries: [],
            updatedAt: null,
        };
        entry.messageCache = payload;
        chats[chatId] = entry;
    });
}

function normalizeName(name) {
    return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function extractPhoneFromJid(jid) {
    const raw = String(jid || '');
    const match = raw.match(/(\d{6,15})/);
    return match ? match[1] : '';
}

function isCommandAllowedForMessage(msg) {
    if (msg?.fromMe) return true;
    if (!ALLOW_PUBLIC_COMMANDS) return false;

    // If no whitelist is configured, allow everyone when public mode is on.
    if (ALLOWED_COMMAND_PHONES.size === 0) return true;

    const authorPhone = extractPhoneFromJid(msg?.author || msg?.from);
    return authorPhone ? ALLOWED_COMMAND_PHONES.has(authorPhone) : false;
}

async function loadSummaryMemory() {
    try {
        const raw = await readFile(SUMMARY_MEMORY_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return { chats: {} };
        if (!parsed.chats || typeof parsed.chats !== 'object') parsed.chats = {};
        return parsed;
    } catch {
        return { chats: {} };
    }
}

async function saveSummaryMemory(memory) {
    await mkdir(dirname(SUMMARY_MEMORY_FILE), { recursive: true });
    await writeFile(SUMMARY_MEMORY_FILE, JSON.stringify(memory, null, 2), 'utf-8');
}

async function queueMemoryUpdate(updater) {
    memoryWriteQueue = memoryWriteQueue
        .then(async () => {
            const memory = await loadSummaryMemory();
            await updater(memory);
            await saveSummaryMemory(memory);
        })
        .catch((err) => {
            emit('error', `[MEMORY] Failed to persist memory: ${err.message}`);
        });
    return memoryWriteQueue;
}

async function getChatMemory(chatId) {
    const memory = await loadSummaryMemory();
    return memory.chats?.[chatId] || null;
}

async function rememberChatDirectory(chat, participants = []) {
    if (!chat?.id?._serialized) return;

    const chatId = chat.id._serialized;
    const chatName = chat.name || chat.id.user || '';

    await queueMemoryUpdate(async (memory) => {
        const directory = memory.chatDirectory || (memory.chatDirectory = {});
        const names = memory.chatNames || (memory.chatNames = {});
        const entry = directory[chatId] || {
            chatId,
            chatName,
            isGroup: !!chat.isGroup,
            phones: [],
            updatedAt: null,
        };

        entry.chatName = chatName || entry.chatName;
        entry.isGroup = !!chat.isGroup;
        entry.updatedAt = new Date().toISOString();

        const merged = new Set(entry.phones || []);
        for (const p of participants) {
            if (p && typeof p === 'string') merged.add(p);
        }
        entry.phones = [...merged].slice(0, 200);
        directory[chatId] = entry;

        const normalized = normalizeName(chatName);
        if (normalized) names[normalized] = chatId;
    });
}

async function findChatByNameFromMemory(c, groupName) {
    const memory = await loadSummaryMemory();
    const names = memory.chatNames || {};
    const directory = memory.chatDirectory || {};
    const normalized = normalizeName(groupName);

    const exactId = names[normalized];
    if (exactId) {
        try {
            const chat = await withTimeout(c.getChatById(exactId), 15_000, 'getChatById memory exact');
            return chat;
        } catch {
            // stale ID, fall through
        }
    }

    const partial = Object.values(directory).find((entry) =>
        normalizeName(entry?.chatName).includes(normalized)
    );
    if (partial?.chatId) {
        try {
            const chat = await withTimeout(c.getChatById(partial.chatId), 15_000, 'getChatById memory partial');
            return chat;
        } catch {
            // stale ID, caller will fallback to getChats
        }
    }

    return null;
}

function formatMemoryForPrompt(chatMemory) {
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

async function rememberChatSummary({ chatId, chatName, participants, summary }) {
    if (!chatId || !summary) return;
    await queueMemoryUpdate(async (memory) => {
        const chats = memory.chats || (memory.chats = {});
        const existing = chats[chatId] || {
            chatName: chatName || '',
            participants: [],
            summaries: [],
            updatedAt: null,
        };

        existing.chatName = chatName || existing.chatName || '';

        const mergedParticipants = new Set([...(existing.participants || [])]);
        for (const p of participants || []) {
            if (p && typeof p === 'string') mergedParticipants.add(p);
        }
        existing.participants = [...mergedParticipants].slice(0, 50);

        existing.summaries = [...(existing.summaries || []), {
            at: new Date().toISOString(),
            text: trimTo(summary, 1200),
        }].slice(-Math.max(1, MAX_STORED_SUMMARIES_PER_CHAT));

        existing.updatedAt = new Date().toISOString();
        chats[chatId] = existing;
    });
}

async function describeImageForContext(media) {
    if (!ENABLE_MEDIA_ANALYSIS || !VISION_MODEL || !media?.data || !media?.mimetype?.startsWith('image/')) {
        return '';
    }

    // Stickers/webp and some image variants commonly fail vision ingestion.
    if (!SUPPORTED_VISION_MIME_TYPES.has(String(media.mimetype).toLowerCase())) {
        return '';
    }

    const normalizedBase64 = String(media.data).replace(/\s+/g, '');
    if (!/^[A-Za-z0-9+/=]+$/.test(normalizedBase64)) {
        return '';
    }

    const byteEstimate = Math.floor((normalizedBase64.length * 3) / 4);
    if (byteEstimate > MAX_VISION_BYTES) return '';

    try {
        const response = await withTimeout(
            getGroqClient().chat.completions.create({
                model: VISION_MODEL,
                messages: [
                    {
                        role: 'system',
                        content: 'Describe this WhatsApp media in one short, factual sentence for chat context. No markdown.',
                    },
                    {
                        role: 'user',
                        content: [
                            { type: 'text', text: 'Describe the key visible content briefly.' },
                            { type: 'image_url', image_url: { url: `data:${media.mimetype};base64,${normalizedBase64}` } },
                        ],
                    },
                ],
                temperature: 0.2,
            }),
            45_000,
            'Groq vision'
        );

        return sanitizeForWhatsApp(response.choices?.[0]?.message?.content || '');
    } catch (err) {
        // Bad media payloads should not spam logs or block summaries.
        if (!String(err.message || '').toLowerCase().includes('invalid image data')) {
            emit('error', `[MEDIA] Vision analysis failed: ${err.message}`);
        }
        return '';
    }
}

async function describeMediaMessage(message, deepAnalyze = true) {
    const type = message.type || 'media';
    let detail = `[MEDIA:${type}]`;
    const body = (message.body || '').trim();
    if (body) detail += ` caption="${trimTo(body, 120)}"`;

    if (!message.hasMedia) return detail;

    if (!deepAnalyze) return detail;

    try {
        const media = await withTimeout(message.downloadMedia(), 20_000, 'downloadMedia');
        if (media?.mimetype) detail += ` mime=${media.mimetype}`;
        if (media?.filename) detail += ` file=${media.filename}`;

        const vision = await describeImageForContext(media);
        if (vision) detail += ` visual="${trimTo(vision, 180)}"`;
    } catch (err) {
        detail += ' media=unavailable';
        emit('error', `[MEDIA] Failed to read media: ${err.message}`);
    }

    return detail;
}

function startWatchdog() {
    if (_watchdogTimer) clearInterval(_watchdogTimer);
    _watchdogTimer = setInterval(async () => {
        if (_status !== 'connected' || _restarting) return;
        try {
            const state = await withTimeout(client.getState(), WATCHDOG_TIMEOUT, 'watchdog getState');
            emit('info', `[WATCHDOG] Client alive — state: ${state}`);
        } catch (err) {
            emit('error', `[WATCHDOG] Client unresponsive (${err.message}) — restarting...`);
            restartClient();
        }
    }, WATCHDOG_INTERVAL);
}

async function syncUnreadSummaryBuckets() {
    if (_status !== 'connected' || _restarting) return;

    try {
        const chats = await withTimeout(client.getChats(), 30_000, 'sync unread getChats');
        for (const chat of chats) {
            if (!chat.isGroup) continue;

            const chatId = chat.id?._serialized;
            if (!chatId) continue;

            const unread = Number(chat.unreadCount || 0);
            const actualBucket = Math.floor(unread / AUTO_THRESHOLD);
            const storedBucket = unreadSummaryBuckets.get(chatId) || 0;

            if (storedBucket !== actualBucket) {
                unreadSummaryBuckets.set(chatId, actualBucket);
                if (storedBucket > actualBucket) {
                    emit('info', `[AUTO] Reset unread state for "${chat.name || chat.id.user}" -> unread=${unread}`);
                }
            }
        }
    } catch (err) {
        if (_restarting || isTargetClosedError(err)) return;
        emit('error', `[AUTO] Failed syncing unread counts: ${err.message}`);
    }
}

function startUnreadSync() {
    if (_unreadSyncTimer) clearInterval(_unreadSyncTimer);
    _unreadSyncTimer = setInterval(() => {
        syncUnreadSummaryBuckets();
    }, UNREAD_SYNC_INTERVAL);
}

async function restartClient() {
    if (_restarting) return;
    _restarting = true;
    _status = 'loading';
    emit('error', '[WATCHDOG] Destroying stale client...');

    // Force-kill the underlying browser process so its SingletonLock is released
    // before we attempt destroy() — avoids the "browser already running" crash.
    const browserProc = client.pupBrowser?.process();
    if (browserProc && !browserProc.killed) {
        try { browserProc.kill(); } catch {}
    }

    try { await client.destroy(); } catch {}

    // Remove Chromium singleton artifacts so a fresh launch doesn't think an
    // old browser instance is still active.
    await cleanupChromiumSingletonFiles();

    setTimeout(() => {
        _restarting = false;
        emit('info', '[WATCHDOG] Re-initialising WhatsApp client...');
        // Always create a fresh Client instance — calling initialize() on a
        // destroyed instance leaves stale Puppeteer execution contexts that
        // cause "Execution context was destroyed" ProtocolErrors on inject().
        client = createAndBindClient();
        cleanupChromiumSingletonFiles().finally(() => client.initialize().catch(err => {
            // initialize() can reject if the page navigates mid-inject;
            // schedule another full restart instead of crashing.
            emit('error', `[INIT] initialize() failed: ${err.message} — retrying in 10 s...`);
            setTimeout(() => restartClient(), 10_000);
        }));
    }, 5_000);
}

function emit(level, message) {
    console.log(message);
    const line = `${new Date().toISOString()} [${String(level || 'info').toUpperCase()}] ${message}\n`;
    logWriteQueue = logWriteQueue
        .then(async () => {
            await mkdir(dirname(LOG_FILE), { recursive: true });
            await appendFile(LOG_FILE, line, 'utf-8');
        })
        .catch(() => {
            // Never let logging failures affect bot flow.
        });
    if (_io) _io.emit('log', { level, message });
}

// ── Client factory ────────────────────────────────────────────────────────────
// Creates a fresh Client instance with all event handlers bound.
// Must be used on every (re)start — reusing a destroyed instance causes stale
// Puppeteer execution-context errors during initialize() → inject().
function createAndBindClient() {
    const c = new Client({
        authStrategy: new LocalAuth(),
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
        _status = 'qr';
        _qr = qr;
        qrcode.generate(qr, { small: true });
        if (_io) _io.emit('qr', qr);
    });

    c.on('ready', () => {
        _status = 'connected';
        _qr = null;
        emit('success', '[STATUS] WhatsApp client is ready');
        if (_io) _io.emit('ready');
        startWatchdog();
        startUnreadSync();
        syncUnreadSummaryBuckets();
        // Detect Puppeteer page crashes and auto-recover
        if (c.pupPage) {
            c.pupPage.on('crash', () => {
                emit('error', '[PUPPETEER] Page crashed — restarting client...');
                restartClient();
            });
            c.pupPage.on('close', () => {
                if (_status === 'connected') {
                    emit('error', '[PUPPETEER] Page closed unexpectedly — restarting client...');
                    restartClient();
                }
            });
        }
    });

    c.on('disconnected', (reason) => {
        emit('error', `[STATUS] WhatsApp client disconnected (${reason}) — restarting in 5 s...`);
        restartClient();
    });

    c.on('auth_failure', (msg) => {
        _status = 'loading';
        emit('error', `[AUTH] Authentication failed: ${msg}`);
    });

    _attachMessageCreate(c);
    return c;
}

let client = createAndBindClient();

async function summariseChat(chat, limit, detailed = false) {
    const safeLimit = Math.max(1, parseInt(limit) || parseInt(process.env.DEFAULT_MESSAGE_LIMIT) || 50);
    const contextExtra = Math.max(0, SUMMARY_CONTEXT_EXTRA);
    const fetchLimit = safeLimit + contextExtra + 12; // buffer for command/system lines

    const chatId = chat.id?._serialized;
    const chatName = chat.name || chat.id?.user || '';
    const chatMemory = chatId ? await getChatMemory(chatId) : null;

    let contextMessages = [];
    let targetMessages = [];
    let cachedContextLines = null;
    let cachedTargetLines = null;
    let usedCache = false;
    let rawFetchedCount = 0;
    let afterCommandFilterCount = 0;
    let selectedTargetMessageCount = 0;

    const latestMessageId = await getLatestMessageId(chat);
    const runtimeCached = runtimeFetchCache.get(chatId);
    if (runtimeCached
        && Date.now() - runtimeCached.cachedAt <= SUMMARY_FETCH_CACHE_TTL_MS
        && runtimeCached.latestMessageId
        && runtimeCached.latestMessageId === latestMessageId
        && runtimeCached.limit >= safeLimit) {
        contextMessages = runtimeCached.contextMessages.slice(-contextExtra);
        targetMessages = runtimeCached.targetMessages.slice(-safeLimit);
        selectedTargetMessageCount = targetMessages.length;
        usedCache = true;
    }

    if (!usedCache && chatId) {
        const persistedCache = await loadMessageCache(chatId);
        if (persistedCache
            && Date.now() - new Date(persistedCache.cachedAt || 0).getTime() <= SUMMARY_FETCH_CACHE_TTL_MS
            && persistedCache.latestMessageId
            && persistedCache.latestMessageId === latestMessageId
            && persistedCache.limit >= safeLimit) {
            cachedContextLines = persistedCache.contextLines || [];
            cachedTargetLines = persistedCache.targetLines || [];
            usedCache = true;
        }
    }

    if (!usedCache) {
        const allMessages = await withTimeout(chat.fetchMessages({ limit: fetchLimit }), 45_000, 'fetchMessages');
        rawFetchedCount = allMessages.length;
        const filtered = allMessages.filter((m) => !isSummarizeCommand(m.body || ''));
        afterCommandFilterCount = filtered.length;
        targetMessages = filtered.slice(-safeLimit);
        selectedTargetMessageCount = targetMessages.length;
        const remaining = filtered.slice(0, Math.max(0, filtered.length - targetMessages.length));
        contextMessages = remaining.slice(-contextExtra);

        const runtimePayload = {
            cachedAt: Date.now(),
            latestMessageId,
            limit: safeLimit,
            contextMessages,
            targetMessages,
        };
        if (chatId) {
            runtimeFetchCache.set(chatId, runtimePayload);
            // Persist text-line cache later after resolving messages.
        }
    }

    const participantsSeen = new Set();
    const contactNameCache = new Map();
    let mediaAnalysedCount = 0;

    const resolveMessages = async (messages, label) => {
        const lines = [];
        for (const message of messages) {
            if (!message.body && !message.hasMedia) continue;
            let contact_name = 'Unknown';
            let phone = '';

            if (message.fromMe) {
                contact_name = client.info?.pushname || client.info?.wid?.user || 'Me';
                phone = extractPhoneFromJid(client.info?.wid?._serialized || client.info?.wid?.user);
            } else {
                const contactKey = String(message.author || message.from || 'unknown');
                const cached = contactNameCache.get(contactKey);
                if (cached) {
                    contact_name = cached.name;
                    phone = cached.phone;
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

            const participantDescriptor = phone ? `${contact_name} (${phone})` : contact_name;
            participantsSeen.add(participantDescriptor);

            if (message.body) {
                lines.push(`[${label}] ${who}: ${message.body}`);
            }
            if (message.hasMedia) {
                const allowDeepMedia =
                    label === 'SUMMARY TARGET'
                    && ENABLE_MEDIA_ANALYSIS
                    && mediaAnalysedCount < MAX_MEDIA_ANALYSIS_PER_SUMMARY;
                if (allowDeepMedia) mediaAnalysedCount += 1;
                const mediaLine = await describeMediaMessage(message, allowDeepMedia);
                lines.push(`[${label}] ${who}: ${mediaLine}`);
            }
        }
        return lines;
    };

    const contextLines = cachedContextLines || await resolveMessages(contextMessages, 'CONTEXT');
    const targetLines  = cachedTargetLines || await resolveMessages(targetMessages,  'SUMMARY TARGET');

    if (chatId && !cachedContextLines && !cachedTargetLines) {
        await saveMessageCache(chatId, {
            cachedAt: new Date().toISOString(),
            latestMessageId,
            limit: safeLimit,
            contextLines,
            targetLines,
        });
    }

    if (cachedTargetLines) {
        selectedTargetMessageCount = Math.max(selectedTargetMessageCount, cachedTargetLines.length);
    }

    const memoryLines = formatMemoryForPrompt(chatMemory);
    const message_collection = [...memoryLines, ...contextLines, ...targetLines];

    emit(
        'info',
        `[STATUS] Messages fetched${usedCache ? ' (cache)' : ''} — requested target=${safeLimit}, resolved target=${targetLines.length}, context=${contextLines.length}`
    );
    emit(
        'info',
        `[STATUS] Target message stats — rawFetched=${rawFetchedCount || 'cache'}, afterCommandFilter=${afterCommandFilterCount || 'cache'}, selectedTargetMessages=${selectedTargetMessageCount}`
    );
    emit('info', '[STATUS] Sending messages to AI...');

    const detailPrefix = detailed
        ? 'Provide a DETAILED, thorough summary covering all decisions, conclusions, questions asked, and important context from the [SUMMARY TARGET] messages. Do not omit anything significant.\n\n'
        : '';

    const ai_response = await withTimeout(
        getGroqClient().chat.completions.create({
            model: process.env.GROQ_MODEL,
            messages: [
                { role: 'system', content: detailPrefix + systemPrompt.trim() },
                { role: 'user', content: message_collection.join('\n') }
            ],
        }),
        90_000,
        'Groq API'
    );

    const summary = sanitizeForWhatsApp(
        ai_response.choices[0].message.content.replace(/<think>.*?<\/think>/gs, '').trim()
    );

    await rememberChatSummary({
        chatId,
        chatName,
        participants: [...participantsSeen],
        summary,
    });

    await rememberChatDirectory(chat, [...participantsSeen].map((p) => {
        const match = p.match(/\((\d{6,15})\)/);
        return match ? match[1] : '';
    }).filter(Boolean));

    emit('success', '[STATUS] Summary generated');
    return summary;
}

async function sendNtfy(summary) {
    try {
        const response = await withTimeout(
            axios.post(process.env.NTFY_TOPIC, summary, {
                headers: {
                    'Title': process.env.NTFY_TITLE,
                    'Priority': process.env.NTFY_PRIORITY,
                },
            }),
            15_000,
            'ntfy'
        );
        emit('success', '[STATUS] Notification sent: ' + response.data.message);
    } catch (error) {
        emit('error', '[STATUS] Error sending notification: ' + error.message);
    }
}

async function answerGeneralQuestion(question) {
    const prompt = String(question || '').trim();
    if (!prompt) return 'Usage: !general <your question>';

    const targetWordCount = extractRequestedWordCount(prompt);

    const ai_response = await withTimeout(
        getGroqClient().chat.completions.create({
            model: process.env.GROQ_MODEL,
            messages: [
                {
                    role: 'system',
                    content: 'Answer the user question directly. Output only the answer text with no preamble, no labels, and no extra commentary.',
                },
                { role: 'user', content: prompt },
            ],
            temperature: 0.2,
        }),
        90_000,
        'Groq API general'
    );

    let answer = sanitizeForWhatsApp(
        String(ai_response?.choices?.[0]?.message?.content || '')
            .replace(/<think>.*?<\/think>/gs, '')
            .trim()
    );

    if (targetWordCount) {
        const currentCount = getWordCount(answer);
        if (currentCount !== targetWordCount) {
            try {
                const rewrite = await withTimeout(
                    getGroqClient().chat.completions.create({
                        model: process.env.GROQ_MODEL,
                        messages: [
                            {
                                role: 'system',
                                content: `Rewrite the answer so it contains exactly ${targetWordCount} words. Return only the rewritten answer text.`,
                            },
                            {
                                role: 'user',
                                content: answer,
                            },
                        ],
                        temperature: 0,
                    }),
                    60_000,
                    'Groq API general rewrite'
                );

                answer = sanitizeForWhatsApp(
                    String(rewrite?.choices?.[0]?.message?.content || '')
                        .replace(/<think>.*?<\/think>/gs, '')
                        .trim()
                );
            } catch {
                // Fall back to deterministic enforcement below.
            }

            if (getWordCount(answer) !== targetWordCount) {
                answer = forceWordCount(answer, targetWordCount);
            }
        }
    }

    return answer;
}

function _attachMessageCreate(c) {
    c.on('message_create', async (msg) => {
        // Auto-summary: count incoming group messages (not from me)
        if (!msg.fromMe) {
            let chat;
            try {
                chat = await withTimeout(msg.getChat(), 15_000, 'getChat');
            } catch (err) {
                emit('error', '[AUTO] Failed to get chat: ' + err.message);
                return;
            }
            let senderName = 'Unknown';
            let senderPhone = '';
            try {
                const contact = await withTimeout(msg.getContact(), 8_000, 'getContact');
                senderName = contact.name || contact.pushname || msg.author || 'Unknown';
                senderPhone = extractPhoneFromJid(contact.number || contact.id?._serialized || msg.author || msg.from);
            } catch {}
            emit('info', `[MSG] "${chat.name || chat.id.user}" from ${senderName}: ${msg.body}`);

            // Keep directory memory hot for faster future chat lookups.
            await rememberChatDirectory(chat, senderPhone ? [senderPhone] : []);
            // "whatsapp summary" trigger — anyone (not me) types it in any chat/group
            if (msg.body.toLowerCase().trim() === 'whatsapp summary') {
                emit('info', `[TRIGGER] "whatsapp summary" requested in "${chat.name || chat.id.user}"`);
                try {
                    const summary = await withTimeout(
                        summariseChat(chat, parseInt(process.env.DEFAULT_MESSAGE_LIMIT)),
                        120_000, 'summariseChat trigger');
                    await withTimeout(chat.sendMessage(summary), 15_000, 'sendMessage');
                    if (_io) _io.emit('summary_done', summary);
                } catch (err) {
                    emit('error', '[TRIGGER ERROR] ' + err.message);
                }
                return;
            }

            if (chat.isGroup) {
                const id = chat.id._serialized;
                let latestChat = chat;
                try {
                    // Pull a fresh chat object so unreadCount reflects latest state.
                    latestChat = await withTimeout(c.getChatById(id), 15_000, 'getChatById auto');
                } catch {
                    // Fall back to the original chat object if refresh fails.
                }

                const unread = Number(latestChat.unreadCount || 0);
                emit('info', `[AUTO] "${latestChat.name || chat.name}" unreadCount: ${unread}/${AUTO_THRESHOLD}`);

                // Only trigger for actually unread messages.
                const bucket = Math.floor(unread / AUTO_THRESHOLD);
                const lastBucket = unreadSummaryBuckets.get(id) || 0;

                // If the chat is read again, reset trigger state.
                if (bucket === 0) {
                    if (lastBucket !== 0) unreadSummaryBuckets.set(id, 0);
                    return;
                }

                // Already summarised this unread range.
                if (bucket <= lastBucket) return;

                unreadSummaryBuckets.set(id, bucket);
                emit('info', `[AUTO] Threshold hit for "${latestChat.name || chat.name}" (unread=${unread}) — generating summary...`);
                try {
                    const summary = await withTimeout(
                        summariseChat(latestChat, AUTO_THRESHOLD),
                        120_000, 'summariseChat auto');
                    const ntfyText = `📋 ${latestChat.name || chat.name}\n\n${summary}`;
                    await withTimeout(sendNtfy(ntfyText), 20_000, 'sendNtfy auto');
                    if (_io) _io.emit('summary_done', summary);
                } catch (err) {
                    // Allow a retry on next incoming message if generation fails.
                    unreadSummaryBuckets.set(id, Math.max(0, bucket - 1));
                    emit('error', '[AUTO ERROR] ' + err.message);
                }
            }
        }

        if (msg.fromMe) {
            try {
                const chat = await withTimeout(msg.getChat(), 15_000, 'getChat fromMe');
                emit('info', `[YOU → "${chat.name || chat.id.user}"]: ${msg.body}`);
            } catch { /* ignore */ }
        }

        if (isGeneralCommand(msg.body) && isCommandAllowedForMessage(msg)) {
            try {
                const replyChat = await withTimeout(msg.getChat(), 15_000, 'getChat general reply');
                const question = String(msg.body || '').trim().slice('!general'.length).trim();
                const answer = await answerGeneralQuestion(question);
                await withTimeout(replyChat.sendMessage(answer), 20_000, 'sendMessage general');
            } catch (err) {
                emit('error', '[GENERAL ERROR] ' + err.message);
            }
            return;
        }

        if ((msg.body.startsWith("!summarise") || msg.body.startsWith("!summarize")) && isCommandAllowedForMessage(msg)) {
            const raw = msg.body;
            const detailed = raw.trimEnd().toLowerCase().endsWith(' detail');
            const stripped = detailed ? raw.trimEnd().slice(0, -7).trimEnd() : raw; // remove trailing ' detail'
            const parts = stripped.split(" ");
            const secondArg = parts[1];
            let targetChat, number_of_messages;

            // Always send command results back to the same chat where command was typed.
            const replyChat = await withTimeout(msg.getChat(), 15_000, 'getChat cmd reply');

            if (!secondArg) {
                targetChat = replyChat;
                number_of_messages = parseInt(process.env.DEFAULT_MESSAGE_LIMIT);
            } else if (!isNaN(secondArg)) {
                targetChat = replyChat;
                number_of_messages = parseInt(secondArg);
            } else {
                const lastArg = parts[parts.length - 1];
                const hasCount = !isNaN(lastArg) && parts.length > 2;
                number_of_messages = hasCount ? parseInt(lastArg) : parseInt(process.env.DEFAULT_MESSAGE_LIMIT);
                const groupName = hasCount ? parts.slice(1, -1).join(" ") : parts.slice(1).join(" ");

                emit('info', `[STATUS] Searching for chat: "${groupName}"`);
                targetChat = await findChatByNameFromMemory(c, groupName);
                if (!targetChat) {
                    const allChats = await withTimeout(client.getChats(), 30_000, 'getChats');
                    targetChat = allChats.find(ch => ch.name?.toLowerCase() === groupName.toLowerCase())
                        || allChats.find(ch => ch.name?.toLowerCase().includes(groupName.toLowerCase()));

                    // Refresh chat directory cache for faster future resolutions.
                    for (const ch of allChats) {
                        await rememberChatDirectory(ch, []);
                    }
                }

                if (!targetChat) { emit('error', `[ERROR] No chat found matching "${groupName}"`); return; }
                emit('info', `[STATUS] Found chat: "${targetChat.name}"`);
            }

            try {
                const summary = await withTimeout(
                    summariseChat(targetChat, number_of_messages, detailed),
                    120_000, 'summariseChat cmd');

                // Manual commands always return summary in the same chat where the command was sent.
                // Ntfy notifications are reserved for automatic unread-threshold summaries only.
                await withTimeout(replyChat.sendMessage(summary), 20_000, 'sendMessage cmd');
                if (_io) _io.emit('summary_done', summary);
            } catch (err) {
                emit('error', '[ERROR] ' + err.message);
            }
        }
    });
}

export function init(io) {
    _io = io;
    cleanupChromiumSingletonFiles().finally(() => client.initialize().catch(err => {
        emit('error', `[INIT] initialize() failed on startup: ${err.message} — retrying in 10 s...`);
        setTimeout(() => restartClient(), 10_000);
    }));
}

export async function logoutWhatsAppSession() {
    emit('info', '[LOGOUT] Logging out current WhatsApp session...');
    _restarting = true;

    if (_watchdogTimer) {
        clearInterval(_watchdogTimer);
        _watchdogTimer = null;
    }
    if (_unreadSyncTimer) {
        clearInterval(_unreadSyncTimer);
        _unreadSyncTimer = null;
    }

    // Try graceful WhatsApp unlink first so it disappears from Linked Devices.
    // Only force-kill Chromium if graceful logout fails.
    let didLogoutGracefully = false;
    try {
        await withTimeout(client.logout(), 20_000, 'logout');
        didLogoutGracefully = true;
    } catch (err) {
        emit('error', `[LOGOUT] logout() failed: ${err.message}`);
    }

    if (!didLogoutGracefully) {
        const browserProc = client.pupBrowser?.process();
        if (browserProc && !browserProc.killed) {
            try { browserProc.kill(); } catch {}
        }
    }

    try {
        await withTimeout(client.destroy(), 20_000, 'destroy after logout');
    } catch (err) {
        emit('error', `[LOGOUT] destroy() failed: ${err.message}`);
    }

    // Remove persisted LocalAuth data so next init always starts logged out.
    try {
        await clearAuthStorageWithRetries();
    } catch (err) {
        emit('error', `[LOGOUT] Failed to clear auth storage: ${err.message}`);
    }

    unreadSummaryBuckets.clear();
    runtimeFetchCache.clear();
    await cleanupChromiumSingletonFiles();
    _status = 'loading';
    _qr = null;
    if (_io) _io.emit('status', 'loading');

    // Give Chromium a short grace period to fully release file handles.
    await new Promise((resolve) => setTimeout(resolve, 1500));

    client = createAndBindClient();
    cleanupChromiumSingletonFiles().finally(() => client.initialize().catch((err) => {
        emit('error', `[LOGOUT] initialize() failed after logout: ${err.message} — retrying in 10 s...`);
        setTimeout(() => restartClient(), 10_000);
    }));
    _restarting = false;
}

// Safety net: prevent any stray unhandled rejections from crashing the process.
process.on('unhandledRejection', (reason) => {
    emit('error', `[PROCESS] Unhandled rejection: ${reason?.message ?? reason}`);
});

export function resetUnreadCount(chatId) { unreadSummaryBuckets.set(chatId, 0); }
export { client, summariseChat, sendNtfy };
export function getStatus() { return { status: _status, qr: _qr }; }

