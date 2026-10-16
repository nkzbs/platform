const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAuth } = require('./auth');
const { logAudit } = require('../audit-log');

const router = express.Router();

// Login del pannello Super Admin — un solo ruolo, 'admin'.
router.get('/', requireAuth, (req, res) => {
  const users = db.prepare("SELECT id, username, role, active, last_login_at, created_at, totp_enabled FROM users WHERE role = 'admin' ORDER BY created_at DESC").all();
  res.json(users);
});

router.post('/', requireAuth, (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username e password obbligatori' });
  try {
    const hash = bcrypt.hashSync(password, 10);
    // Sempre 'admin' — mai un ruolo passato dal chiamante.
    const result = db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')").run(username, hash);
    const user = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(result.lastInsertRowid);
    logAudit(req.user.username, 'user.create', username, { role: 'admin' });
    res.json(user);
  } catch (e) {
    res.status(400).json({ error: 'Username già esistente' });
  }
});

router.patch('/:id', requireAuth, (req, res) => {
  // Stesso confine di GET/POST sopra — non un endpoint generico per
  // abilitare/disabilitare QUALUNQUE utente, solo login Core.
  const target = db.prepare('SELECT username, role FROM users WHERE id = ?').get(req.params.id);
  if (!target || target.role !== 'admin') return res.status(404).json({ error: 'Utente non trovato' });

  // 'active' e 'username' sono indipendenti: solo i campi presenti nel body
  // si aggiornano (2026-10-14, prima questo endpoint faceva SOLO toggle di
  // 'active' — estenderlo a username serve a rinominare un utente senza
  // ricrearlo). better-sqlite3 rifiuta un booleano JS come parametro bind
  // (throw, non un errore silenzioso) — coercizione esplicita, non lasciata
  // al chiamante (bug reale trovato il 2026-08-10 su questo stesso campo).
  const sets = []; const params = [];
  if ('active' in req.body) { sets.push('active = ?'); params.push(req.body.active ? 1 : 0); }
  if ('username' in req.body) {
    const username = String(req.body.username || '').trim();
    if (!username) return res.status(400).json({ error: 'Username non può essere vuoto' });
    sets.push('username = ?'); params.push(username);
  }
  if (!sets.length) return res.status(400).json({ error: 'Niente da aggiornare' });

  try {
    db.prepare('UPDATE users SET ' + sets.join(', ') + ' WHERE id = ?').run(...params, req.params.id);
  } catch (e) {
    return res.status(400).json({ error: 'Username già esistente' });
  }
  if ('active' in req.body) logAudit(req.user.username, req.body.active ? 'user.enable' : 'user.disable', target.username, null);
  if ('username' in req.body && req.body.username !== target.username) logAudit(req.user.username, 'user.rename', target.username, { to: req.body.username });
  res.json({ ok: true });
});

// ─── Recupero di un ALTRO admin bloccato (2026-10-14) ──────────────────────────
// Il 2FA e la password restano self-service per chi è già dentro (vedi
// auth.js) — qui invece è un admin GIÀ loggato che sblocca un collega che ha
// perso l'accesso. Non è lo stesso confine di sicurezza indebolito: serve
// comunque la PROPRIA password di chi esegue l'azione (step-up), resta
// tracciato in audit_log con azione distinta da quelle self-service, e un
// admin non può farlo su se stesso (per quello c'è già /change-password e
// /auth/2fa/disable). Richiesto esplicitamente dall'utente dopo aver notato
// che altrimenti un admin bloccato non ha alcuna via d'uscita.
function verifyActingAdmin(req, res) {
  const me = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!me || !bcrypt.compareSync(req.body.admin_password || '', me.password_hash)) {
    res.status(401).json({ error: 'La tua password non è corretta' });
    return null;
  }
  return me;
}

router.post('/:id/reset-password', requireAuth, (req, res) => {
  if (Number(req.params.id) === req.user.id) return res.status(400).json({ error: 'Per la tua password usa Impostazioni → Password' });
  const target = db.prepare('SELECT username, role FROM users WHERE id = ?').get(req.params.id);
  if (!target || target.role !== 'admin') return res.status(404).json({ error: 'Utente non trovato' });
  const newPassword = req.body.new_password;
  if (!newPassword || String(newPassword).length < 8) return res.status(400).json({ error: 'La nuova password deve avere almeno 8 caratteri' });
  if (!verifyActingAdmin(req, res)) return;
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(newPassword, 10), req.params.id);
  logAudit(req.user.username, 'user.reset_password', target.username, null);
  res.json({ ok: true });
});

router.post('/:id/disable-2fa', requireAuth, (req, res) => {
  if (Number(req.params.id) === req.user.id) return res.status(400).json({ error: 'Per il tuo 2FA usa Impostazioni → Due fattori' });
  const target = db.prepare('SELECT username, role, totp_enabled FROM users WHERE id = ?').get(req.params.id);
  if (!target || target.role !== 'admin') return res.status(404).json({ error: 'Utente non trovato' });
  if (!target.totp_enabled) return res.status(400).json({ error: '2FA già non attivo per questo utente' });
  if (!verifyActingAdmin(req, res)) return;
  db.prepare('UPDATE users SET totp_enabled = 0, totp_secret = NULL, totp_backup_codes = NULL WHERE id = ?').run(req.params.id);
  logAudit(req.user.username, 'user.force_disable_2fa', target.username, null);
  res.json({ ok: true });
});

router.delete('/:id', requireAuth, (req, res) => {
  // Niente guardia "non è l'ultimo admin attivo": non servirebbe a nulla —
  // chi chiama questa rotta è per forza un admin attivo (requireAuth lo
  // rifiuta altrimenti), e il blocco sopra impedisce già di eliminare SE
  // STESSI. Un blocco in più sul conteggio sarebbe irraggiungibile (il
  // chiamante resta sempre un admin attivo in più rispetto al bersaglio) —
  // meglio niente controllo che un controllo morto che sembra protezione.
  if (Number(req.params.id) === req.user.id) return res.status(400).json({ error: 'Non puoi eliminare il tuo stesso utente' });
  const target = db.prepare('SELECT username, role FROM users WHERE id = ?').get(req.params.id);
  if (!target || target.role !== 'admin') return res.status(404).json({ error: 'Utente non trovato' });
  if (!verifyActingAdmin(req, res)) return;
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  logAudit(req.user.username, 'user.delete', target.username, null);
  res.json({ ok: true });
});

module.exports = router;
