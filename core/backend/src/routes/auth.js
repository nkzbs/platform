const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { authenticator } = require('otplib');
const QRCode = require('qrcode');
const db = require('../db');
const { rateLimit } = require('../rate-limit');
const { genBackupCodes, matchBackupCode } = require('../totp-backup-codes');
const { logAudit } = require('../audit-log');
const { requireInternalSecret } = require('../../../../shared/internal-secret.js');

const router = express.Router();
// Nessun valore di riserva: senza JWT_SECRET la firma fallisce e nessun token è valido.
const JWT_SECRET = process.env.JWT_SECRET;

// Protezione brute-force su login e verifica 2FA — per IP, non per username:
// un attacco reale prova molti username dallo stesso posto, non lo stesso
// username 1000 volte (che comunque resterebbe protetto lo stesso). Vedi
// shared/rate-limit.js per il motivo del contatore fatto in casa.
const loginLimiter = rateLimit({ windowMs: 5 * 60 * 1000, max: 10, message: 'Troppi tentativi di accesso, riprova tra qualche minuto', name: 'login', failClosed: true });

// Endpoint chiamati automaticamente a intervalli fissi, senza alcuna azione
// dell'utente (campanella notifiche ogni 30s in Sidebar.jsx, log attività ogni
// 10s in AuditPage.jsx quando quella pagina è aperta) — una tab dimenticata
// aperta continua a chiamarli all'infinito, quindi NON contano come attività
// vera per il controllo "sessione attiva" prima di un redeploy (vedi
// last_active_at sotto). Solo la richiesta GET del poll è esclusa: un'azione
// deliberata sullo stesso endpoint (es. POST /notifications/:id/read) conta.
const PASSIVE_POLL_PATHS = ['/api/notifications', '/api/audit-log'];
function isPassivePoll(req) {
  if (req.method !== 'GET') return false;
  return PASSIVE_POLL_PATHS.some((p) => req.originalUrl === p || req.originalUrl.startsWith(p + '?'));
}

// Token API personale (es. per un server MCP): prefisso riconoscibile 'plat_',
// mai confondibile con un JWT (che inizia sempre con 'eyJ', base64 di {"alg":...}).
// Autentica come l'utente vero del token, con tutti i suoi permessi reali — non
// un ruolo a parte. Nessuna scadenza automatica: si revoca da Impostazioni →
// Il mio account, come un logout remoto.
function tryApiToken(req) {
  const auth = req.headers.authorization || '';
  const raw = auth.startsWith('Bearer ') ? auth.slice(7) : auth;
  if (!raw.startsWith('plat_')) return false;
  const hash = require('crypto').createHash('sha256').update(raw).digest('hex');
  const row = db.prepare('SELECT * FROM api_tokens WHERE token_hash = ?').get(hash);
  if (!row || row.revoked_at) return false;
  const current = db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id);
  if (!current || !current.active) return false;
  req.user = { id: current.id, username: current.username, role: current.role, display_name: current.display_name, linked_module_slug: current.linked_module_slug, linked_record_id: current.linked_record_id };
  db.prepare('UPDATE api_tokens SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?').run(row.id);
  return true;
}

function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: 'Non autorizzato' });
  if (tryApiToken(req)) return next();
  try {
    req.user = jwt.verify(auth.split(' ')[1], JWT_SECRET);
    // Un token "pending" (2FA non ancora verificato, vedi POST /login sotto) non è
    // mai una sessione vera — difesa esplicita anche se di fatto non avrebbe i
    // campi (sid, role) che il resto dell'app si aspetta comunque.
    if (req.user.pending_2fa) return res.status(401).json({ error: 'Verifica del codice 2FA non completata' });
    // Stato e ruolo si rileggono a ogni richiesta: disabilitare un utente o togliergli
    // il ruolo admin vale subito, non alla scadenza del token (24 ore).
    const current = db.prepare('SELECT active, role FROM users WHERE id = ?').get(req.user.id);
    if (!current || !current.active) return res.status(401).json({ error: 'Utente disabilitato' });
    req.user.role = current.role;
    // Token emessi prima dell'introduzione del log accessi non hanno 'sid' — si
    // riallineano da soli al prossimo login, nessuna migrazione necessaria.
    if (req.user.sid) {
      try {
        // Un JWT valido normalmente basta da solo (stateless) — ma un logout
        // remoto da Super Admin (vedi routes/tenants.js POST /:slug/sessions/:sid/
        // revoke, scrive revoked_at direttamente sul .db del tenant) deve poter
        // invalidare un token PRIMA della sua scadenza naturale (24h). Ogni
        // richiesta autenticata ricontrolla qui, non solo al login.
        const sess = db.prepare('SELECT revoked_at FROM sessions WHERE id = ?').get(req.user.sid);
        if (sess && sess.revoked_at) return res.status(401).json({ error: 'Sessione terminata da remoto — effettua di nuovo l\'accesso' });
        db.prepare('UPDATE sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.user.sid);
        if (!isPassivePoll(req)) {
          db.prepare('UPDATE sessions SET last_active_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.user.sid);
        }
      } catch (e) {}
    }
    next();
  } catch (e) {
    res.status(401).json({ error: 'Token non valido' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Solo admin' });
  next();
}

// Chiusura di un gap reale (26/10/2026, docs/DECISIONI.md): nascondere un
// modulo dal menu (user_modules, vedi getVisibleInstalledModules in
// routes/modules.js) filtrava solo il menu — chi restava loggato poteva
// comunque chiamare le API del modulo direttamente. Stessi identici
// comportamenti del filtro menu, replicati qui apposta per non introdurre una
// seconda semantica: admin bypassa sempre; un utente SENZA righe in
// user_modules non ha restrizioni (compatibilità con ogni tenant esistente,
// mai configurato finora); 'dashboard' è sempre implicitamente permesso.
function requireModuleAccess(req, res, next) {
  if (req.user.role === 'admin') return next();
  const slug = req.params.slug;
  const hasAnyRow = db.prepare('SELECT 1 FROM user_modules WHERE user_id = ?').get(req.user.id);
  if (!hasAnyRow) return next();
  if (slug === 'dashboard') return next();
  const allowed = db.prepare('SELECT 1 FROM user_modules WHERE user_id = ? AND module_slug = ?').get(req.user.id, slug);
  if (!allowed) return res.status(403).json({ error: 'Modulo non visibile per questo utente' });
  next();
}

// Forma unica della risposta "user", usata da /login e /login/2fa-verify.
function serializeUser(user) {
  return {
    id: user.id, username: user.username, role: user.role, display_name: user.display_name,
    linked_module_slug: user.linked_module_slug, linked_record_id: user.linked_record_id,
  };
}

// Stessa firma usata da /login e dall'endpoint interno sotto — una sola sessione
// registrata per ogni "accesso" reale, indipendentemente da come è nato il token.
function signSessionToken(user) {
  const session = db.prepare('INSERT INTO sessions (user_id, username) VALUES (?, ?)').run(user.id, user.username);
  return jwt.sign(
    {
      id: user.id, username: user.username, role: user.role, display_name: user.display_name,
      linked_module_slug: user.linked_module_slug, linked_record_id: user.linked_record_id,
      sid: session.lastInsertRowid,
    },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
}

// Token intermedio tra "password corretta" e "sessione vera" quando l'utente ha il
// 2FA attivo — vita breve (5 minuti, il tempo di aprire l'app authenticator),
// nessuna riga in sessions (non è un accesso avvenuto, solo un passaggio a metà).
function signPendingToken(user) {
  return jwt.sign({ pending_2fa: true, uid: user.id }, JWT_SECRET, { expiresIn: '5m' });
}

// P2 (collaudo operativo 2026-09-03) — login e verifica 2FA non finivano mai in
// audit_log qui, unico evento di sicurezza non tracciato in questo backend, stesso
// gap chiuso in parallelo su super-admin/backend/src/routes/auth.js.
router.post('/login', loginLimiter, (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    logAudit(username || 'unknown', 'auth.login_failed', username, null);
    return res.status(401).json({ error: 'Credenziali non valide' });
  }
  if (user.totp_enabled) {
    return res.json({ needs_2fa: true, pending_token: signPendingToken(user) });
  }
  logAudit(username, 'auth.login', username, null);
  const token = signSessionToken(user);
  res.json({ token, user: serializeUser(user) });
});

// Secondo passaggio del login quando l'utente ha il 2FA attivo — riceve il
// pending_token di /login più il codice a 6 cifre (o, in alternativa, un codice
// di recupero) e completa l'accesso firmando la sessione vera.
router.post('/login/2fa-verify', loginLimiter, (req, res) => {
  const { pending_token, code } = req.body;
  let payload;
  try {
    payload = jwt.verify(pending_token || '', JWT_SECRET);
  } catch (e) {
    return res.status(401).json({ error: 'Sessione di verifica scaduta — rifai il login' });
  }
  if (!payload.pending_2fa) return res.status(401).json({ error: 'Token non valido per questo passaggio' });

  const user = db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(payload.uid);
  if (!user || !user.totp_enabled) return res.status(401).json({ error: 'Utente non trovato o 2FA non attivo' });

  const normalizedCode = String(code || '').trim();
  let usedBackupCode = false;

  if (/^\d{6}$/.test(normalizedCode) && authenticator.check(normalizedCode, require('../secrets-at-rest').unsealText(user.totp_secret) || '')) {
    // codice TOTP valido, procede
  } else {
    // Prova come codice di recupero (formato XXXX-XXXX) — a singolo uso, vedi
    // shared/totp-backup-codes.js.
    const match = matchBackupCode(bcrypt, normalizedCode, user.totp_backup_codes);
    if (!match.matched) {
      logAudit(user.username, 'auth.2fa_verify_failed', user.username, null);
      return res.status(401).json({ error: 'Codice non valido' });
    }
    db.prepare('UPDATE users SET totp_backup_codes = ? WHERE id = ?').run(match.remaining, user.id);
    usedBackupCode = true;
  }

  logAudit(user.username, 'auth.2fa_verify', user.username, { usedBackupCode });
  const token = signSessionToken(user);
  res.json({ token, usedBackupCode, user: serializeUser(user) });
});

// ─── 2FA — self-service, ogni utente attiva/disattiva SOLO il proprio ──────────
// Deliberatamente niente endpoint admin per attivare il 2FA su un altro utente —
// richiesta esplicita: si attiva dal pannello, lo fa la persona stessa.

// Prepara un secret nuovo (non ancora abilitato) e il QR per scansionarlo — va
// confermato con un codice reale (sotto) prima che totp_enabled diventi 1.
router.post('/2fa/setup', requireAuth, async (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  // Con il 2FA già attivo un nuovo segreto sostituirebbe quello in uso prima di essere confermato e chiuderebbe fuori l'utente: prima va disattivato.
  if (user.totp_enabled) return res.status(409).json({ error: 'Il 2FA è già attivo: disattivalo prima di configurarlo di nuovo.' });
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
  // I codici in chiaro vengono restituiti UNA sola volta qui — mai più recuperabili
  // dopo, solo rigenerabili (disattivando e riattivando il 2FA).
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

// Endpoint interno (rete Docker, mai esposto fuori) che permette a Super Admin di
// aprire il Builder di questo tenant senza conoscerne la password — firma un token
// admin vero usando il JWT_SECRET di QUESTO container, che non lascia mai il
// container stesso (Super Admin conosce solo INTERNAL_API_SECRET, condiviso e
// pensato solo per l'autenticazione servizio-a-servizio sulla rete interna, non
// per l'autenticazione utente — stesso principio già usato da /api/registry
// lato Super Admin per le chiamate in arrivo dai tenant). Bypassa deliberatamente
// il 2FA: non passa mai dal form di login (non verifica nemmeno la password), è
// già un canale più privilegiato e tracciato (audit log lato Super Admin) — un
// secondo fattore pensato per il login umano via form non aggiunge nulla qui.
router.post('/internal-token', requireInternalSecret, (req, res) => {
  const user = db.prepare("SELECT * FROM users WHERE role = 'admin' AND active = 1 ORDER BY id LIMIT 1").get();
  if (!user) return res.status(404).json({ error: 'Nessun utente admin su questo tenant' });
  res.json({ token: signSessionToken(user) });
});

// Variante di /internal-token per il flusso "Apri" di Super Admin (2026-08-30) —
// richiesto esplicitamente dall'utente: aprire un tenant deve richiedere le
// credenziali admin DI QUEL TENANT, non una scorciatoia. A differenza di
// /internal-token sopra (che prende semplicemente il primo admin, usato
// dall'iframe Builder integrato — lasciato invariato, uso interno frequente),
// qui il secret interno resta l'autorizzazione di CANALE (stesso principio:
// mai esposto fuori dalla rete Docker) ma non basta da solo — serve anche la
// password vera di un admin di questo tenant, verificata con bcrypt esattamente
// come /login sopra (stessa comparazione, non duplicata come logica). Se il
// Partner non conosce la password del tenant (es. il cliente l'ha cambiata),
// non entra — nessuna scorciatoia.
router.post('/internal-login', requireInternalSecret, (req, res) => {
  const { username, password } = req.body || {};
  const user = db.prepare("SELECT * FROM users WHERE username = ? AND role = 'admin' AND active = 1").get(username);
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    return res.status(401).json({ error: 'Credenziali admin non valide per questo tenant' });
  }
  res.json({ token: signSessionToken(user) });
});

router.get('/me', requireAuth, (req, res) => {
  res.json(req.user);
});

module.exports = router;
module.exports.requireAuth = requireAuth;
module.exports.requireAdmin = requireAdmin;
module.exports.requireModuleAccess = requireModuleAccess;
// Riusate da routes/webauthn.js — stessa identica sessione di un login con
// password, una passkey verificata non deve crearne una "diversa".
module.exports.signSessionToken = signSessionToken;
module.exports.serializeUser = serializeUser;
