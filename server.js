const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Config ---
const MAX_CIPHERTEXT_BASE64_LENGTH = 2_000_000; // ~1.5MB of raw data after base64 overhead
const DATA_FILE = path.join(__dirname, 'data', 'pastes.json');
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// --- Storage (simple JSON-file backed store; swap for a DB in production) ---
fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });

/** @type {Map<string, {ciphertext: string, iv: string, burnAfterRead: boolean, expiresAt: number|null, createdAt: number}>} */
let store = new Map();

function loadStore() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const obj = JSON.parse(raw);
    store = new Map(Object.entries(obj));
  } catch (err) {
    store = new Map();
  }
}

let saveTimeout = null;
function persistStore() {
  // Debounce writes so bursts of requests don't hammer the disk
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    const obj = Object.fromEntries(store);
    fs.writeFileSync(DATA_FILE, JSON.stringify(obj), 'utf8');
  }, 200);
}

function cleanupExpired() {
  const now = Date.now();
  let changed = false;
  for (const [id, paste] of store.entries()) {
    if (paste.expiresAt && paste.expiresAt < now) {
      store.delete(id);
      changed = true;
    }
  }
  if (changed) persistStore();
}

loadStore();
setInterval(cleanupExpired, CLEANUP_INTERVAL_MS);

// --- Middleware ---
app.use(express.json({ limit: '3mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Very basic in-memory rate limiter (per IP, sliding window)
const rateLimitWindowMs = 60_000;
const rateLimitMax = 30;
const rateLimitHits = new Map();

function rateLimit(req, res, next) {
  const ip = req.ip;
  const now = Date.now();
  const windowStart = now - rateLimitWindowMs;
  const hits = (rateLimitHits.get(ip) || []).filter((t) => t > windowStart);
  hits.push(now);
  rateLimitHits.set(ip, hits);
  if (hits.length > rateLimitMax) {
    return res.status(429).json({ error: 'Too many requests, slow down.' });
  }
  next();
}

// --- Helpers ---
function generateId() {
  // 12 bytes -> 16 chars base64url, short but unguessable enough combined with rate limiting
  return crypto.randomBytes(9).toString('base64url');
}

function isValidBase64(str) {
  return typeof str === 'string' && str.length > 0 && /^[A-Za-z0-9+/_=-]+$/.test(str);
}

// --- API routes ---

// Create a new encrypted paste. The server only ever sees ciphertext + IV.
// It NEVER sees the encryption key or the plaintext.
app.post('/api/paste', rateLimit, (req, res) => {
  const { ciphertext, iv, expiresInMinutes, burnAfterRead } = req.body || {};

  if (!isValidBase64(ciphertext) || !isValidBase64(iv)) {
    return res.status(400).json({ error: 'Invalid or missing ciphertext/iv.' });
  }
  if (ciphertext.length > MAX_CIPHERTEXT_BASE64_LENGTH) {
    return res.status(413).json({ error: 'Paste too large.' });
  }

  let expiresAt = null;
  if (expiresInMinutes !== undefined && expiresInMinutes !== null) {
    const mins = Number(expiresInMinutes);
    if (!Number.isFinite(mins) || mins <= 0 || mins > 60 * 24 * 30) {
      return res.status(400).json({ error: 'Invalid expiration.' });
    }
    expiresAt = Date.now() + mins * 60_000;
  }

  const id = generateId();
  store.set(id, {
    ciphertext,
    iv,
    burnAfterRead: Boolean(burnAfterRead),
    expiresAt,
    createdAt: Date.now(),
  });
  persistStore();

  res.status(201).json({ id });
});

// Retrieve an encrypted paste by id. Deletes it if burn-after-read or expired.
app.get('/api/paste/:id', (req, res) => {
  const { id } = req.params;
  const paste = store.get(id);

  if (!paste) {
    return res.status(404).json({ error: 'Paste not found or already burned.' });
  }

  if (paste.expiresAt && paste.expiresAt < Date.now()) {
    store.delete(id);
    persistStore();
    return res.status(404).json({ error: 'Paste has expired.' });
  }

  const { ciphertext, iv, burnAfterRead } = paste;

  if (burnAfterRead) {
    store.delete(id);
    persistStore();
  }

  res.json({ ciphertext, iv, burnAfterRead });
});

// Serve the SPA for paste view links: /p/:id#key (fragment never reaches the server)
app.get('/p/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/health', (req, res) => res.json({ status: 'ok', pastes: store.size }));

app.listen(PORT, () => {
  console.log(`Zero-Knowledge Pastebin running on http://localhost:${PORT}`);
});
