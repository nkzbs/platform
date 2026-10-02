const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAuth } = require('./auth');
const { logAudit } = require('../audit-log');

const router = express.Router();

// Login del pannello Super Admin — un solo ruolo, 'admin'.
router.get('/', requireAuth, (req, res) => {
  const users = db.prepare("SELECT id, username, role, active, last_login_at, created_at FROM users WHERE role = 'admin' ORDER BY created_at DESC").all();
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
  // better-sqlite3 rifiuta un booleano JS come parametro bind (throw, non un
  // errore silenzioso) — un body {active:false} andava sempre in errore 500,
  // {active:0} no: bug reale trovato verificando dal vivo il cambio password
  // self-service (2026-08-10), mai notato prima perché il frontend esistente
  // manda sempre già un intero. Coercizione esplicita qui, non lasciata al
  // chiamante.
  const active = req.body.active ? 1 : 0;
  db.prepare('UPDATE users SET active = ? WHERE id = ?').run(active, req.params.id);
  logAudit(req.user.username, active ? 'user.enable' : 'user.disable', target.username, null);
  res.json({ ok: true });
});

module.exports = router;
