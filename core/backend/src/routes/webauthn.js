const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { requireAuth, signSessionToken, serializeUser } = require('./auth');
const { rateLimit } = require('../rate-limit');
const { logAudit } = require('../audit-log');
const {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
} = require('@simplewebauthn/server');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'changeme';
const RP_NAME = 'Platform';

// Passkey — AGGIUNTIVA al 2FA, non lo sostituisce (richiesto esplicitamente
// dall'utente, 2026-10-14: "oltre alle 2FA voglio passkey ovunque"). Un
// metodo di accesso completo a sé — chi ha una passkey registrata entra con
// quella SENZA passare da password+2FA, non è un secondo fattore sopra la
// password. Self-service come il 2FA: nessun endpoint per registrare una
// passkey per conto di un altro utente.
//
// rpID/origin vengono dall'header Origin della richiesta (mai dall'host
// della proxy nginx davanti al container, su cui non c'è alcuna garanzia
// esplicita in questo repo) — un browser vero manda sempre Origin su una
// POST, anche same-origin. Stesso identico principio per tutti i tenant:
// ogni container serve un solo dominio, quindi la passkey registrata lì
// resta valida solo per quel dominio (mai condivisa tra tenant diversi).
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

// Solo sulle rotte "verify" (dove si prova davvero una firma) — le "options"
// non rivelano nulla di specifico sull'account (discoverable, nessun
// username in ingresso) e vanno chiamate una volta per OGNI tentativo prima
// della verifica stessa: limitarle avrebbe dimezzato per errore la quota
// reale di tentativi rispetto al login con password (1 richiesta = 1
// tentativo lì, 2 qui). Stessa soglia del login con password comunque.
const webauthnLimiter = rateLimit({ windowMs: 5 * 60 * 1000, max: 10, message: 'Troppi tentativi, riprova tra qualche minuto', name: 'webauthn', failClosed: true });

// ─── Registrazione (self-service, richiede già un accesso) ─────────────────────
router.post('/register-options', requireAuth, async (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const { rpID } = originAndRpID(req);
  const existing = db.prepare('SELECT credential_id, transports FROM webauthn_credentials WHERE user_id = ?').all(user.id);
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID,
    userName: user.username,
    userDisplayName: user.display_name || user.username,
    // ID stabile e opaco, MAI il nome utente — serve solo al browser per
    // distinguere account diversi sullo stesso rpID (residentKey sotto).
    userID: Buffer.from('user-' + user.id),
    attestationType: 'none',
    excludeCredentials: existing.map((c) => ({ id: c.credential_id, transports: c.transports ? JSON.parse(c.transports) : undefined })),
    // residentKey 'required' = credenziale "discoverable": al login il
    // browser propone l'account da sé, senza che l'utente scriva lo
    // username prima (il punto della passkey, non solo un secondo fattore).
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

// ─── Elenco e rimozione (self-service) ──────────────────────────────────────────
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

// ─── Login (pubblico, nessun accesso precedente) ────────────────────────────────
// Nessun allowCredentials: il browser propone da sé quale passkey usare tra
// quelle "discoverable" registrate per questo rpID — niente username da
// digitare prima, è il punto della passkey.
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
  logAudit(user.username, 'auth.webauthn_login', user.username, null);

  // Stessa firma di sessione del login con password (routes/auth.js) — una
  // passkey verificata è già un accesso completo, niente 2FA sopra.
  const token = signSessionToken(user);
  res.json({ token, user: serializeUser(user) });
});

module.exports = router;
