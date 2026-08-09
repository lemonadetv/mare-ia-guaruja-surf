const crypto = require('crypto');
const { put, head, list, del } = require('@vercel/blob');

const ADMIN_EMAILS = ['rhhellbrugge@gmail.com'];

function hashSecret(secret) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(secret, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifySecret(secret, stored) {
  if (!stored || typeof secret !== 'string') return false;
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const hashBuf = Buffer.from(hash, 'hex');
  const testBuf = crypto.scryptSync(secret, salt, 64);
  if (hashBuf.length !== testBuf.length) return false;
  return crypto.timingSafeEqual(hashBuf, testBuf);
}

function genToken() { return crypto.randomBytes(24).toString('hex'); }

function normalizeEmail(email) { return String(email || '').trim().toLowerCase(); }

function isAdmin(email) { return ADMIN_EMAILS.includes(normalizeEmail(email)); }

function keyFor(email) { return crypto.createHash('sha256').update(normalizeEmail(email)).digest('hex'); }
function pathnameFor(email) { return `users/${keyFor(email)}.json`; }
// Usage stats live in a SEPARATE blob from the user record so a `track` call
// (fired on every tab switch, refresh click, chat send) can never race with a
// `saveData` call (settings/favorites/chat) and clobber it — each writes its
// own file, so a read-modify-write on one can't stomp the other's write.
function statsPathnameFor(email) { return `stats/${keyFor(email)}.json`; }

function defaultStats(now) {
  return { loginCount: 0, lastLoginAt: null, lastActiveAt: now, tabViews: {}, chatMessagesSent: 0, refreshClicks: 0, favoriteToggles: 0 };
}

async function readBlob(pathname) {
  try {
    const info = await head(pathname, { token: process.env.BLOB_READ_WRITE_TOKEN });
    const r = await fetch(info.url, { headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` } });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    return null;
  }
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

// Vercel Blob can briefly serve a stale read immediately after a write when requests
// land in very quick succession (e.g. saveData firing right after signup). Since we
// already hold the intended final record in memory, we just re-assert the write and
// verify it stuck, rather than re-reading and re-merging (which would re-trigger the
// same race).
async function writeBlob(pathname, record) {
  const json = JSON.stringify(record);
  for (let attempt = 0; attempt < 3; attempt++) {
    await put(pathname, json, {
      access: 'private',
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: true,
      token: process.env.BLOB_READ_WRITE_TOKEN
    });
    const verify = await readBlob(pathname);
    if (verify && verify.updatedAt === record.updatedAt) return;
    if (attempt < 2) await sleep(150 * (attempt + 1));
  }
}

function readUser(email) { return readBlob(pathnameFor(email)); }
function writeUser(email, record) { return writeBlob(pathnameFor(email), record); }
function readStats(email) { return readBlob(statsPathnameFor(email)); }
function writeStats(email, record) { return writeBlob(statsPathnameFor(email), record); }

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

async function requireAdmin(email, token) {
  if (!isAdmin(email)) return null;
  const admin = await readUser(email);
  if (!admin || admin.sessionToken !== token) return null;
  return admin;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  body = body || {};
  const action = body.action;
  const email = normalizeEmail(body.email);

  try {
    if (action === 'signup') {
      if (!isValidEmail(email)) return res.status(400).json({ error: 'invalid_email' });
      if (!body.password || String(body.password).length < 6) return res.status(400).json({ error: 'weak_password' });
      if (!body.securityQuestion || !body.securityAnswer) return res.status(400).json({ error: 'missing_security' });
      const existing = await readUser(email);
      if (existing) return res.status(409).json({ error: 'already_exists' });
      const token = genToken();
      const now = new Date().toISOString();
      const record = {
        email, passwordHash: hashSecret(String(body.password)),
        securityQuestion: String(body.securityQuestion).slice(0, 140),
        securityAnswerHash: hashSecret(String(body.securityAnswer).trim().toLowerCase()),
        sessionToken: token, chatHistory: null, settings: null,
        createdAt: now, updatedAt: now
      };
      await Promise.all([
        writeUser(email, record),
        writeStats(email, { ...defaultStats(now), createdAt: now, updatedAt: now })
      ]);
      return res.status(200).json({ ok: true, email, token, chatHistory: null, settings: null, isAdmin: isAdmin(email) });
    }

    if (action === 'login') {
      if (!isValidEmail(email)) return res.status(400).json({ error: 'invalid_email' });
      const user = await readUser(email);
      if (!user) return res.status(404).json({ error: 'not_found' });
      if (!verifySecret(String(body.password || ''), user.passwordHash)) return res.status(401).json({ error: 'wrong_password' });
      const token = genToken();
      const now = new Date().toISOString();
      user.sessionToken = token;
      user.updatedAt = now;
      const stats = (await readStats(email)) || defaultStats(now);
      stats.loginCount = (stats.loginCount || 0) + 1;
      stats.lastLoginAt = now;
      stats.lastActiveAt = now;
      stats.updatedAt = now;
      await Promise.all([writeUser(email, user), writeStats(email, stats)]);
      return res.status(200).json({ ok: true, email, token, chatHistory: user.chatHistory, settings: user.settings, isAdmin: isAdmin(email) });
    }

    if (action === 'getSecurityQuestion') {
      if (!isValidEmail(email)) return res.status(400).json({ error: 'invalid_email' });
      const user = await readUser(email);
      if (!user) return res.status(404).json({ error: 'not_found' });
      return res.status(200).json({ ok: true, question: user.securityQuestion });
    }

    if (action === 'resetPassword') {
      if (!isValidEmail(email)) return res.status(400).json({ error: 'invalid_email' });
      if (!body.newPassword || String(body.newPassword).length < 6) return res.status(400).json({ error: 'weak_password' });
      const user = await readUser(email);
      if (!user) return res.status(404).json({ error: 'not_found' });
      if (!verifySecret(String(body.securityAnswer || '').trim().toLowerCase(), user.securityAnswerHash)) {
        return res.status(401).json({ error: 'wrong_answer' });
      }
      const token = genToken();
      user.passwordHash = hashSecret(String(body.newPassword));
      user.sessionToken = token;
      user.updatedAt = new Date().toISOString();
      await writeUser(email, user);
      return res.status(200).json({ ok: true, email, token, chatHistory: user.chatHistory, settings: user.settings, isAdmin: isAdmin(email) });
    }

    if (action === 'changePassword') {
      if (!isValidEmail(email)) return res.status(400).json({ error: 'invalid_email' });
      if (!body.newPassword || String(body.newPassword).length < 6) return res.status(400).json({ error: 'weak_password' });
      const user = await readUser(email);
      if (!user || user.sessionToken !== body.token) return res.status(401).json({ error: 'invalid_session' });
      if (!verifySecret(String(body.oldPassword || ''), user.passwordHash)) return res.status(401).json({ error: 'wrong_password' });
      user.passwordHash = hashSecret(String(body.newPassword));
      user.updatedAt = new Date().toISOString();
      await writeUser(email, user);
      return res.status(200).json({ ok: true });
    }

    if (action === 'saveData') {
      if (!isValidEmail(email)) return res.status(400).json({ error: 'invalid_email' });
      const user = await readUser(email);
      if (!user || user.sessionToken !== body.token) return res.status(401).json({ error: 'invalid_session' });
      user.chatHistory = body.chatHistory != null ? body.chatHistory : user.chatHistory;
      user.settings = body.settings != null ? body.settings : user.settings;
      user.updatedAt = new Date().toISOString();
      await writeUser(email, user);
      return res.status(200).json({ ok: true });
    }

    if (action === 'loadData') {
      if (!isValidEmail(email)) return res.status(400).json({ error: 'invalid_email' });
      const user = await readUser(email);
      if (!user || user.sessionToken !== body.token) return res.status(401).json({ error: 'invalid_session' });
      return res.status(200).json({ ok: true, chatHistory: user.chatHistory, settings: user.settings, isAdmin: isAdmin(email) });
    }

    if (action === 'track') {
      if (!isValidEmail(email)) return res.status(400).json({ error: 'invalid_email' });
      const user = await readUser(email);
      if (!user || user.sessionToken !== body.token) return res.status(401).json({ error: 'invalid_session' });
      const now = new Date().toISOString();
      const stats = (await readStats(email)) || defaultStats(now);
      stats.lastActiveAt = now;
      const ev = String(body.event || '');
      if (ev.indexOf('tab_') === 0) {
        stats.tabViews[ev] = (stats.tabViews[ev] || 0) + 1;
      } else if (ev === 'chat_send') {
        stats.chatMessagesSent = (stats.chatMessagesSent || 0) + 1;
      } else if (ev === 'refresh') {
        stats.refreshClicks = (stats.refreshClicks || 0) + 1;
      } else if (ev === 'favorite_toggle') {
        stats.favoriteToggles = (stats.favoriteToggles || 0) + 1;
      }
      stats.updatedAt = now;
      await writeStats(email, stats);
      return res.status(200).json({ ok: true });
    }

    if (action === 'adminListUsers') {
      const admin = await requireAdmin(email, body.token);
      if (!admin) return res.status(403).json({ error: 'forbidden' });
      const { blobs } = await list({ prefix: 'users/', token: process.env.BLOB_READ_WRITE_TOKEN });
      const users = [];
      for (const b of blobs) {
        try {
          const r = await fetch(b.url, { headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` } });
          if (!r.ok) continue;
          const u = await r.json();
          if (!u.email) continue;
          const stats = (await readStats(u.email)) || defaultStats(u.createdAt);
          users.push({
            email: u.email,
            createdAt: u.createdAt,
            updatedAt: u.updatedAt,
            isAdmin: isAdmin(u.email),
            favoriteId: (u.settings && u.settings.favoriteId) || null,
            unit: (u.settings && u.settings.unit) || null,
            chatMessages: Array.isArray(u.chatHistory) ? u.chatHistory.length : 0,
            stats
          });
        } catch (e) {}
      }
      users.sort((a, b2) => new Date(b2.updatedAt || 0) - new Date(a.updatedAt || 0));
      return res.status(200).json({ ok: true, users });
    }

    if (action === 'adminDeleteUser') {
      const admin = await requireAdmin(email, body.token);
      if (!admin) return res.status(403).json({ error: 'forbidden' });
      const targetEmail = normalizeEmail(body.targetEmail);
      if (!isValidEmail(targetEmail)) return res.status(400).json({ error: 'invalid_email' });
      if (targetEmail === email) return res.status(400).json({ error: 'cannot_delete_self' });
      await Promise.all([
        del(pathnameFor(targetEmail), { token: process.env.BLOB_READ_WRITE_TOKEN }),
        del(statsPathnameFor(targetEmail), { token: process.env.BLOB_READ_WRITE_TOKEN }).catch(() => {})
      ]);
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'unknown_action' });
  } catch (e) {
    return res.status(500).json({ error: 'server_error' });
  }
};
