const crypto = require('crypto');
const { put, head } = require('@vercel/blob');

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

function pathnameFor(email) {
  const key = crypto.createHash('sha256').update(normalizeEmail(email)).digest('hex');
  return `users/${key}.json`;
}

async function readUser(email) {
  try {
    const info = await head(pathnameFor(email), { token: process.env.BLOB_READ_WRITE_TOKEN });
    const r = await fetch(info.url, { headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` } });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    return null;
  }
}

async function writeUser(email, record) {
  await put(pathnameFor(email), JSON.stringify(record), {
    access: 'private',
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
    token: process.env.BLOB_READ_WRITE_TOKEN
  });
}

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
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
      await writeUser(email, record);
      return res.status(200).json({ ok: true, email, token, chatHistory: null, settings: null });
    }

    if (action === 'login') {
      if (!isValidEmail(email)) return res.status(400).json({ error: 'invalid_email' });
      const user = await readUser(email);
      if (!user) return res.status(404).json({ error: 'not_found' });
      if (!verifySecret(String(body.password || ''), user.passwordHash)) return res.status(401).json({ error: 'wrong_password' });
      const token = genToken();
      user.sessionToken = token;
      user.updatedAt = new Date().toISOString();
      await writeUser(email, user);
      return res.status(200).json({ ok: true, email, token, chatHistory: user.chatHistory, settings: user.settings });
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
      return res.status(200).json({ ok: true, email, token, chatHistory: user.chatHistory, settings: user.settings });
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
      let writeError = null;
      try { await writeUser(email, user); } catch (werr) { writeError = werr && werr.message; }
      return res.status(200).json({ ok: true, debugReceivedSettings: body.settings, debugWriteError: writeError, debugWrittenSettings: user.settings });
    }

    if (action === 'loadData') {
      if (!isValidEmail(email)) return res.status(400).json({ error: 'invalid_email' });
      const user = await readUser(email);
      if (!user || user.sessionToken !== body.token) return res.status(401).json({ error: 'invalid_session' });
      return res.status(200).json({ ok: true, chatHistory: user.chatHistory, settings: user.settings });
    }

    return res.status(400).json({ error: 'unknown_action' });
  } catch (e) {
    return res.status(500).json({ error: 'server_error' });
  }
};
