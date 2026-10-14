const express = require('express');
const bcrypt = require('bcryptjs');
const { generatePassword } = require('../../../../shared/generate-password.js');
const jwt = require('jsonwebtoken');
const { authenticator } = require('otplib');
const QRCode = require('qrcode');
const db = require('../db');
const { rateLimit } = require('../rate-limit');
const { genBackupCodes, matchBackupCode } = require('../totp-backup-codes');
const { logAudit } = require('../audit-log');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'changeme';

function userPublicShape(user) {
  return { id: user.id, username: user.username, role: user.role };
}
function signSessionToken(user) {
  return jwt.sign(userPublicShape(user), JWT_SECRET, { expiresIn: '24h' });
}
function signPendingToken(user) {
  return jwt.sign({ pending_2fa: true, uid: user.id }, JWT_SECRET, { expiresIn: '5m' });
}

// Protezione brute-force — per IP, vedi core/backend/src/routes/auth.js per lo
// stesso ragionamento (lì duplicato perché sono due processi separati, mai un
// solo Super Admin da proteggere qui contro N tenant diversi).
const loginLimiter = rateLimit({ windowMs: 5 * 60 * 1000, max: 10, message: 'Troppi tentativi di accesso, riprova tra qualche minuto', name: 'login', failClosed: true });

// Crea l'utente admin al primo avvio. La password viene da INITIAL_ADMIN_PASSWORD
// se impostata; altrimenti ne viene generata una casuale e stampata UNA sola volta
// nel log di avvio (mai una password fissa scritta nel codice). Chi la perde la
// reimposta con INITIAL_ADMIN_PASSWORD su un DB vuoto o direttamente dal DB.
const existing = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
if (!existing) {
  const fromEnv = !!process.env.INITIAL_ADMIN_PASSWORD;
  const initialPassword = process.env.INITIAL_ADMIN_PASSWORD || generatePassword();
  db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run('admin', bcrypt.hashSync(initialPassword, 10), 'admin');
  if (fromEnv) {
    console.log('Utente admin creato (password da INITIAL_ADMIN_PASSWORD, non stampata qui).');
  } else {
    console.log('\n' + '='.repeat(60) + '\nUtente admin creato.  username: admin   password: ' + initialPassword + '\nQuesta password viene mostrata UNA sola volta: salvala ora.\n' + '='.repeat(60) + '\n');
  }
}

function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: 'Non autorizzato' });
  const token = auth.split(' ')[1];
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    // Bug reale (2026-08-23, vedi POST /login sopra): senza questo controllo,
    // disabilitare un utente non revocava le sessioni già firmate — un JWT
    // valido per 24h restava pienamente valido a prescindere da 'active'.
    // Un lookup per richiesta ha un costo reale, accettabile qui: pochi
    // utenti, traffico basso, e la revoca immediata è il punto stesso del
    // pulsante "Disabilita" (non "disabilita al prossimo login").
    const current = db.prepare('SELECT active FROM users WHERE id = ?').get(req.user.id);
    if (!current || !current.active) return res.status(401).json({ error: 'Utente disabilitato' });
    next();
  } catch (e) {
    res.status(401).json({ error: 'Token non valido' });
  }
}

// P2 (collaudo operativo 2026-09-03) — login e verifica 2FA non finivano mai in
// audit_log, unico evento di sicurezza non tracciato in tutto il backend (ogni altra
// azione mutante lo è). loginLimiter (rate-limit) restava l'unica difesa visibile, ma
// senza una riga in audit_log un tentativo riuscito con credenziali rubate non lascia
// traccia leggibile da un operatore — solo dal log applicativo grezzo, se ancora vivo.
router.post('/login', loginLimiter, (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    logAudit(username || 'unknown', 'auth.login_failed', username, null);
    return res.status(401).json({ error: 'Credenziali non valide' });
  }
  // Bug reale trovato costruendo #6 del redesign UI (2026-08-23): "Disabilita"
  // in UsersPage.jsx scriveva già users.active, ma NESSUN punto lo rileggeva —
  // né qui né in requireAuth sotto — quindi un utente "disabilitato" restava
  // in grado di fare login e usare qualunque sessione già firmata fino alla
  // scadenza naturale del JWT. Blocco qui il login; requireAuth sotto
  // ricontrolla ad ogni richiesta per revocare anche le sessioni già in corso,
  // non solo i login futuri.
  if (!user.active) {
    logAudit(username, 'auth.login_blocked_disabled', username, null);
    return res.status(401).json({ error: 'Utente disabilitato' });
  }
  // 2FA opzionale, mai attivo di default (vedi db.js) — se questo utente
  // l'ha accesa da sé (Impostazioni), il login si ferma qui e aspetta il
  // codice su /login/2fa-verify, stesso identico flusso già in uso lato
  // tenant (core/backend/src/routes/auth.js).
  if (user.totp_enabled) {
    return res.json({ needs_2fa: true, pending_token: signPendingToken(user) });
  }
  db.prepare('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);
  logAudit(username, 'auth.login', username, null);
  res.json({ token: signSessionToken(user), user: userPublicShape(user) });
});

// Secondo passaggio solo per chi ha il 2FA attivo — riceve il pending_token
// di /login più il codice a 6 cifre (o, in alternativa, un codice di
// recupero) e completa l'accesso firmando la sessione vera.
router.post('/login/2fa-verify', loginLimiter, (req, res) => {
  const { pending_token, code } = req.body;
  let payload;
  try {
    payload = jwt.verify(pending_token || '', JWT_SECRET);
  } catch (e) {
    return res.status(401).json({ error: 'Sessione di verifica scaduta — rifai il login' });
  }
  if (!payload.pending_2fa) return res.status(401).json({ error: 'Token non valido per questo passaggio' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.uid);
  if (!user || !user.totp_enabled) return res.status(401).json({ error: 'Utente non trovato o 2FA non attivo' });

  const normalizedCode = String(code || '').trim();
  let usedBackupCode = false;

  if (/^\d{6}$/.test(normalizedCode) && authenticator.check(normalizedCode, require('../secrets-at-rest').unsealText(user.totp_secret) || '')) {
    // codice TOTP valido, procede
  } else {
    const match = matchBackupCode(bcrypt, normalizedCode, user.totp_backup_codes);
    if (!match.matched) {
      logAudit(user.username, 'auth.2fa_verify_failed', user.username, null);
      return res.status(401).json({ error: 'Codice non valido' });
    }
    db.prepare('UPDATE users SET totp_backup_codes = ? WHERE id = ?').run(match.remaining, user.id);
    usedBackupCode = true;
  }

  db.prepare('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);
  logAudit(user.username, 'auth.2fa_verify', user.username, { usedBackupCode });
  res.json({ token: signSessionToken(user), usedBackupCode, user: userPublicShape(user) });
});

router.get('/me', requireAuth, (req, res) => res.json(req.user));

// ─── 2FA — self-service, ogni utente ATTIVA solo il proprio ────────────────────
// Stesso identico meccanismo di core/backend/src/routes/auth.js — nessun
// endpoint admin per ATTIVARE il 2FA su un altro utente, si accende dal
// pannello, lo fa la persona stessa. Reso POSSIBILE qui (2026-08-10), mai
// attivato di default su nessun utente reale. La DISATTIVAZIONE forzata da
// parte di un altro admin esiste invece (2026-10-14, recupero di un admin
// bloccato) — vedi routes/users.js POST /:id/disable-2fa, richiede comunque
// la password di chi esegue l'azione e resta tracciata con un'azione audit
// distinta da questa self-service.
router.post('/2fa/setup', requireAuth, async (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const secret = authenticator.generateSecret();
  const uri = authenticator.keyuri(user.username, 'Platform', secret);
  db.prepare('UPDATE users SET totp_secret = ? WHERE id = ?').run(require('../secrets-at-rest').sealText(secret), user.id);
  const qr = await QRCode.toDataURL(uri);
  res.json({ secret, otpauth_uri: uri, qr_data_uri: qr });
});

router.post('/2fa/confirm', requireAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user.totp_secret) return res.status(400).json({ error: 'Nessuna configurazione 2FA in corso — avvia prima /2fa/setup' });
  const code = String(req.body.code || '').trim();
  if (!authenticator.check(code, require('../secrets-at-rest').unsealText(user.totp_secret) || '')) return res.status(400).json({ error: 'Codice non valido' });

  const { plain, hashed } = genBackupCodes(bcrypt);
  db.prepare('UPDATE users SET totp_enabled = 1, totp_backup_codes = ? WHERE id = ?').run(JSON.stringify(hashed), user.id);
  res.json({ ok: true, backup_codes: plain });
});

router.post('/2fa/disable', requireAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(req.body.password || '', user.password_hash)) {
    return res.status(401).json({ error: 'Password non corretta' });
  }
  db.prepare('UPDATE users SET totp_enabled = 0, totp_secret = NULL, totp_backup_codes = NULL WHERE id = ?').run(user.id);
  res.json({ ok: true });
});

router.get('/2fa/status', requireAuth, (req, res) => {
  const user = db.prepare('SELECT totp_enabled FROM users WHERE id = ?').get(req.user.id);
  res.json({ enabled: !!(user && user.totp_enabled) });
});

// Cambio password self-service — richiede la password attuale, stesso
// principio di qualunque cambio password serio: non basta essere già loggati.
router.post('/change-password', requireAuth, (req, res) => {
  const { current_password, new_password } = req.body;
  if (!new_password || String(new_password).length < 8) {
    return res.status(400).json({ error: 'La nuova password deve avere almeno 8 caratteri' });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user || !bcrypt.compareSync(current_password || '', user.password_hash)) {
    return res.status(401).json({ error: 'Password attuale non corretta' });
  }
  const hash = bcrypt.hashSync(new_password, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);
  res.json({ ok: true });
});

// NOTA: uno step-up sulla PROPRIA password per "Apri →" (POST /reauth,
// users.stepup_until) è esistito qui dal 2026-08-30 mattina fino a poche ore
// dopo — sostituito da vera esclusione: le credenziali richieste sono quelle
// admin DEL TENANT specifico, non le proprie. /tenants/:slug/open-session
// verifica username+password del tenant stesso via
// mintTenantAdminToken/internal-login (vedi tenants.js). La colonna
// stepup_until resta nello schema (migrazione già applicata, rimuoverla
// richiederebbe un DROP COLUMN distruttivo per zero beneficio) ma non è più
// letta né scritta da nessun percorso.

module.exports = router;
module.exports.requireAuth = requireAuth;
module.exports.signSessionToken = signSessionToken;
