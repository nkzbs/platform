const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { requireAuth, signSessionToken, userPublicShape } = require('./auth');
const { rateLimit } = require('../rate-limit');
const { logAudit } = require('../audit-log');
const {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
} = require('@simplewebauthn/server');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'changeme';
const RP_NAME = 'Platform Admin';

// Passkey per Super Admin — stesso identico meccanismo di core/backend/src/
// routes/webauthn.js (vedi i commenti lì per il perché di ogni scelta:
// rpID/origin dall'header Origin, residentKey 'required', pending_token
// invece di stato lato server). AGGIUNTIVA al 2FA, non lo sostituisce.
function originAndRpID(req) {
  const origin = req.headers.origin || ('https://' + req.hostname);
  let rpID;
  try { rpID = new URL(origin).hostname; } catch (e) { rpID = req.hostname; }
  return { origin, rpID };
}

function signPendingToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '5m' });
}

try {
  db.exec(`CREATE TABLE IF NOT EXISTS webauthn_credentials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    credential_id TEXT NOT NULL UNIQUE,
    public_key TEXT NOT NULL,
    counter INTEGER NOT NULL DEFAULT 0,
    transports TEXT,
    device_type TEXT,
    backed_up INTEGER DEFAULT 0,
    nickname TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_used_at DATETIME
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_user_id ON webauthn_credentials(user_id)');
} catch (e) {}

// Solo su /login-verify, stesso principio di core/backend/src/routes/
// webauthn.js (vedi lì il commento esteso): le "options" non rivelano nulla
// e contano doppio per tentativo rispetto al login con password.
const webauthnLimiter = rateLimit({ windowMs: 5 * 60 * 1000, max: 10, message: 'Troppi tentativi, riprova tra qualche minuto', name: 'webauthn-admin', failClosed: true });

router.post('/register-options', requireAuth, async (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const { rpID } = originAndRpID(req);
  const existing = db.prepare('SELECT credential_id, transports FROM webauthn_credentials WHERE user_id = ?').all(user.id);
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID,
    userName: user.username,
    userDisplayName: user.username,
    userID: Buffer.from('admin-' + user.id),
    attestationType: 'none',
    excludeCredentials: existing.map((c) => ({ id: c.credential_id, transports: c.transports ? JSON.parse(c.transports) : undefined })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
  });
  const pending_token = signPendingToken({ purpose: 'webauthn_register', uid: user.id, challenge: options.challenge });
  res.json({ options, pending_token });
});

router.post('/register-verify', requireAuth, async (req, res) => {
  const { pending_token, response, nickname } = req.body || {};
  let payload;
  try { payload = jwt.verify(pending_token || '', JWT_SECRET); } catch (e) {
    return res.status(401).json({ error: 'Sessione di registrazione scaduta — riprova' });
  }
  if (payload.purpose !== 'webauthn_register' || payload.uid !== req.user.id) {
    return res.status(401).json({ error: 'Token non valido per questo passaggio' });
  }
  const { origin, rpID } = originAndRpID(req);
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response, expectedChallenge: payload.challenge, expectedOrigin: origin, expectedRPID: rpID,
    });
  } catch (e) {
    return res.status(400).json({ error: 'Verifica non riuscita: ' + e.message });
  }
  if (!verification.verified) return res.status(400).json({ error: 'Verifica non riuscita' });

  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
  try {
    db.prepare(`INSERT INTO webauthn_credentials
      (user_id, credential_id, public_key, counter, transports, device_type, backed_up, nickname)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(req.user.id, credential.id, Buffer.from(credential.publicKey).toString('base64'), credential.counter,
        JSON.stringify(credential.transports || []), credentialDeviceType, credentialBackedUp ? 1 : 0, (nickname || '').slice(0, 60) || null);
  } catch (e) {
    return res.status(400).json({ error: 'Questa passkey è già registrata' });
  }
  logAudit(req.user.username, 'webauthn.register', req.user.username, { device_type: credentialDeviceType });
  res.json({ ok: true });
});

router.get('/list', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT id, nickname, device_type, backed_up, created_at, last_used_at FROM webauthn_credentials WHERE user_id = ? ORDER BY created_at DESC').all(req.user.id);
  res.json(rows);
});

router.delete('/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT id FROM webauthn_credentials WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Passkey non trovata' });
  db.prepare('DELETE FROM webauthn_credentials WHERE id = ?').run(req.params.id);
  logAudit(req.user.username, 'webauthn.delete', req.user.username, null);
  res.json({ ok: true });
});

router.post('/login-options', async (req, res) => {
  const { rpID } = originAndRpID(req);
  const options = await generateAuthenticationOptions({ rpID, userVerification: 'preferred' });
  const pending_token = signPendingToken({ purpose: 'webauthn_login', challenge: options.challenge });
  res.json({ options, pending_token });
});

router.post('/login-verify', webauthnLimiter, async (req, res) => {
  const { pending_token, response } = req.body || {};
  let payload;
  try { payload = jwt.verify(pending_token || '', JWT_SECRET); } catch (e) {
    return res.status(401).json({ error: 'Sessione di accesso scaduta — riprova' });
  }
  if (payload.purpose !== 'webauthn_login') return res.status(401).json({ error: 'Token non valido per questo passaggio' });

  const stored = db.prepare('SELECT * FROM webauthn_credentials WHERE credential_id = ?').get((response || {}).id);
  if (!stored) {
    logAudit('unknown', 'auth.webauthn_login_failed', null, null);
    return res.status(401).json({ error: 'Passkey non riconosciuta' });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(stored.user_id);
  if (!user) return res.status(401).json({ error: 'Utente non trovato o disabilitato' });

  const { origin, rpID } = originAndRpID(req);
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response, expectedChallenge: payload.challenge, expectedOrigin: origin, expectedRPID: rpID,
      credential: { id: stored.credential_id, publicKey: Buffer.from(stored.public_key, 'base64'), counter: stored.counter, transports: stored.transports ? JSON.parse(stored.transports) : undefined },
    });
  } catch (e) {
    return res.status(400).json({ error: 'Verifica non riuscita: ' + e.message });
  }
  if (!verification.verified) {
    logAudit(user.username, 'auth.webauthn_login_failed', user.username, null);
    return res.status(401).json({ error: 'Verifica non riuscita' });
  }

  db.prepare('UPDATE webauthn_credentials SET counter = ?, last_used_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(verification.authenticationInfo.newCounter, stored.id);
  db.prepare('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);
  logAudit(user.username, 'auth.webauthn_login', user.username, null);

  res.json({ token: signSessionToken(user), user: userPublicShape(user) });
});

module.exports = router;
