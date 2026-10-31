const express = require('express');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAuth, requireAdmin } = require('./auth');
const { logAudit } = require('../audit-log');
const { generatePassword } = require('../../../../shared/generate-password.js');
const { isAllowedAvatarMime, saveAvatar, deleteAvatar } = require('../lib/avatar-storage');

const router = express.Router();

function avatarUrlFor(avatarPath) {
  return avatarPath ? '/api/avatars/' + avatarPath : null;
}

router.get('/', requireAuth, requireAdmin, (req, res) => {
  const users = db.prepare('SELECT id, username, display_name, role, active, linked_module_slug, linked_record_id, avatar_path, created_at FROM users ORDER BY created_at DESC').all();
  res.json(users.map((u) => ({ ...u, avatar_url: avatarUrlFor(u.avatar_path), avatar_path: undefined })));
});

router.post('/', requireAuth, requireAdmin, (req, res) => {
  const { username, password, display_name, role, linked_module_slug, linked_record_id } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username e password obbligatori' });
  try {
    const hash = bcrypt.hashSync(password, 10);
    const result = db.prepare('INSERT INTO users (username, password_hash, display_name, role, linked_module_slug, linked_record_id) VALUES (?, ?, ?, ?, ?, ?)')
      .run(username, hash, display_name || username, role || 'user', linked_module_slug || null, linked_record_id ? parseInt(linked_record_id) : null);
    const user = db.prepare('SELECT id, username, display_name, role, active, linked_module_slug, linked_record_id FROM users WHERE id = ?').get(result.lastInsertRowid);
    logAudit(req.user.username, 'user.create', username, { role: role || 'user' });
    res.json(user);
  } catch (e) {
    res.status(400).json({ error: 'Username già esistente' });
  }
});

router.patch('/:id', requireAuth, requireAdmin, (req, res) => {
  const { display_name, role, active, password, linked_module_slug, linked_record_id } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Utente non trovato' });
  if (password) {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);
  }
  db.prepare('UPDATE users SET display_name = ?, role = ?, active = ?, linked_module_slug = ?, linked_record_id = ? WHERE id = ?').run(
    display_name ?? user.display_name,
    role ?? user.role,
    active !== undefined ? active : user.active,
    linked_module_slug !== undefined ? (linked_module_slug || null) : user.linked_module_slug,
    linked_record_id !== undefined ? (linked_record_id ? parseInt(linked_record_id) : null) : user.linked_record_id,
    user.id
  );
  const updated = db.prepare('SELECT id, username, display_name, role, active, linked_module_slug, linked_record_id FROM users WHERE id = ?').get(user.id);
  logAudit(req.user.username, 'user.update', user.username, { role, active, password_changed: !!password });
  res.json(updated);
});

// G4 (PLATFORM-0.6-GAP-ANALYSIS.md, 2026-08-22) — prima di questa route, l'UNICO
// modo di cambiare la password di un utente diverso da sé stessi era PATCH /:id
// col campo 'password' scelto e scritto da chi chiama (l'amministratore doveva
// inventare/digitare lui stesso il nuovo valore) — diverso dal meccanismo già
// esistente in super-admin/backend per resettare l'admin di un TENANT (genera
// una password casuale server-side, mai scelta da un umano). Aggiunta qui la
// stessa capacità per un utente NORMALE di un tenant, riusando lo stesso
// generatore condiviso (shared/generate-password.js) — non sostituisce PATCH
// /:id (che resta per chi vuole impostare una password scelta), la affianca.
router.post('/:id/reset-password', requireAuth, requireAdmin, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Utente non trovato' });
  const newPassword = generatePassword();
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(newPassword, 10), user.id);
  logAudit(req.user.username, 'user.reset_password', user.username, null);
  res.json({ username: user.username, password: newPassword });
});

router.delete('/:id', requireAuth, requireAdmin, (req, res) => {
  if (parseInt(req.params.id) === req.user.id) return res.status(400).json({ error: 'Non puoi eliminare te stesso' });
  db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(req.params.id);
  const target = db.prepare('SELECT username FROM users WHERE id = ?').get(req.params.id);
  logAudit(req.user.username, 'user.deactivate', target && target.username, null);
  res.json({ ok: true });
});

router.post('/me/change-password', requireAuth, (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) return res.status(400).json({ error: 'Dati mancanti' });
  if (new_password.length < 8) return res.status(400).json({ error: 'La nuova password deve avere almeno 8 caratteri' });
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!u) return res.status(404).json({ error: 'Utente non trovato' });
  if (!bcrypt.compareSync(current_password, u.password_hash)) return res.status(400).json({ error: 'Password attuale non corretta' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(new_password, 10), u.id);
  logAudit(u.username, 'user.change_password', u.username, null);
  res.json({ ok: true });
});

// Foto profilo (2026-10-31, richiesto dall'utente: "la mia Memoji come immagine
// profilo, cerchio accanto al nome"). Sempre in memoria come uploads.js (la
// scelta disco-vs-Drive lì non si applica qui, vedi lib/avatar-storage.js) — solo
// immagini, 5MB bastano e avanzano per una foto profilo.
const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    if (!isAllowedAvatarMime(file.mimetype)) return cb(new Error('Formato non supportato — usa PNG, JPG, WEBP o GIF'));
    cb(null, true);
  },
});

router.post('/me/avatar', requireAuth, (req, res) => {
  avatarUpload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Nessun file ricevuto' });
    const u = db.prepare('SELECT avatar_path FROM users WHERE id = ?').get(req.user.id);
    const name = saveAvatar(req.file.buffer, req.file.mimetype);
    db.prepare('UPDATE users SET avatar_path = ? WHERE id = ?').run(name, req.user.id);
    if (u && u.avatar_path) deleteAvatar(u.avatar_path);
    logAudit(req.user.username, 'user.avatar_update', req.user.username, null);
    res.json({ avatar_url: avatarUrlFor(name) });
  });
});

router.delete('/me/avatar', requireAuth, (req, res) => {
  const u = db.prepare('SELECT avatar_path FROM users WHERE id = ?').get(req.user.id);
  if (u && u.avatar_path) deleteAvatar(u.avatar_path);
  db.prepare('UPDATE users SET avatar_path = NULL WHERE id = ?').run(req.user.id);
  logAudit(req.user.username, 'user.avatar_remove', req.user.username, null);
  res.json({ ok: true });
});

router.post('/me/vault-pin/setup', requireAuth, (req, res) => {
  const { pin } = req.body;
  if (!pin || String(pin).length < 4) return res.status(400).json({ error: 'PIN deve essere di almeno 4 cifre' });
  const hash = bcrypt.hashSync(String(pin), 10);
  db.prepare('UPDATE users SET vault_pin_hash = ? WHERE id = ?').run(hash, req.user.id);
  res.json({ ok: true });
});

router.post('/me/vault-pin/verify', requireAuth, (req, res) => {
  const { pin } = req.body;
  const u = db.prepare('SELECT vault_pin_hash FROM users WHERE id = ?').get(req.user.id);
  if (!u || !u.vault_pin_hash) return res.json({ ok: true, no_pin: true });
  res.json({ ok: bcrypt.compareSync(String(pin || ''), u.vault_pin_hash) });
});

router.delete('/me/vault-pin', requireAuth, (req, res) => {
  db.prepare('UPDATE users SET vault_pin_hash = NULL WHERE id = ?').run(req.user.id);
  res.json({ ok: true });
});

router.get('/me/vault-pin/status', requireAuth, (req, res) => {
  const u = db.prepare('SELECT vault_pin_hash FROM users WHERE id = ?').get(req.user.id);
  res.json({ has_pin: !!(u && u.vault_pin_hash) });
});

router.get('/:id/modules', requireAuth, requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT module_slug FROM user_modules WHERE user_id = ?').all(req.params.id);
  res.json(rows.map((r) => r.module_slug));
});

router.put('/:id/modules', requireAuth, requireAdmin, (req, res) => {
  const { slugs } = req.body;
  const deleteSlug = db.prepare('DELETE FROM user_modules WHERE user_id = ?');
  const insertSlug = db.prepare('INSERT INTO user_modules (user_id, module_slug) VALUES (?, ?)');
  db.transaction(() => {
    deleteSlug.run(req.params.id);
    if (Array.isArray(slugs) && slugs.length > 0) {
      slugs.forEach((s) => insertSlug.run(req.params.id, s));
    }
  })();
  logAudit(req.user.username, 'user.modules_update', req.params.id, { slugs });
  res.json({ ok: true });
});

module.exports = router;
