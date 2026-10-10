'use strict';
// Proprietario delle righe automatiche + riassegnazione delle righe esistenti (solo admin).
//   GET  /api/record-owner         -> proprietario predefinito, utenti, e per modulo quante righe sono senza proprietario o dell'admin
//   PUT  /api/record-owner         { user_id | null }  imposta il proprietario predefinito
//   POST /api/record-owner/assign  { module_slug, to_user_id, from: 'senza_proprietario' | 'admin' | 'entrambi', dry_run }
// La riassegnazione cambia solo records.user_id: i dati delle righe non si toccano. Con dry_run dice quante righe cambierebbero.
const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('./auth');
const { logAudit } = require('../audit-log');
const { defaultOwnerId } = require('../record-owner');

const router = express.Router();
const guard = [requireAuth, requireAdmin];

const adminIds = () => db.prepare("SELECT id FROM users WHERE role = 'admin'").all().map((u) => u.id);

function condizione(from) {
  const admins = adminIds();
  const inAdmin = admins.length ? 'user_id IN (' + admins.map(() => '?').join(',') + ')' : '0';
  if (from === 'senza_proprietario') return { sql: 'user_id IS NULL', params: [] };
  if (from === 'admin') return { sql: inAdmin, params: admins };
  if (from === 'entrambi') return { sql: '(user_id IS NULL OR ' + inAdmin + ')', params: admins };
  return null;
}

router.get('/', ...guard, (req, res) => {
  const admins = adminIds();
  const moduli = db.prepare('SELECT slug, name FROM modules WHERE installed = 1 ORDER BY sort_order, name').all().map((m) => {
    const senza = db.prepare('SELECT COUNT(*) n FROM records WHERE module_slug = ? AND user_id IS NULL').get(m.slug).n;
    const diAdmin = admins.length ? db.prepare('SELECT COUNT(*) n FROM records WHERE module_slug = ? AND user_id IN (' + admins.map(() => '?').join(',') + ')').get(m.slug, ...admins).n : 0;
    return { slug: m.slug, name: m.name, senza_proprietario: senza, di_admin: diAdmin };
  }).filter((m) => m.senza_proprietario || m.di_admin);
  res.json({
    default_owner_user_id: defaultOwnerId(),
    utenti: db.prepare('SELECT id, username, display_name, role FROM users ORDER BY id').all(),
    moduli,
  });
});

router.put('/', ...guard, (req, res) => {
  const id = req.body && req.body.user_id;
  if (id !== null && id !== undefined && id !== '') {
    if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(parseInt(id, 10))) return res.status(400).json({ error: 'Utente non trovato.' });
  }
  const val = id === null || id === undefined || id === '' ? null : parseInt(id, 10);
  db.prepare('UPDATE tenant_settings SET default_owner_user_id = ? WHERE id = 1').run(val);
  logAudit(req.user.username, 'record_owner.default', String(val), null);
  res.json({ default_owner_user_id: val });
});

router.post('/assign', ...guard, (req, res) => {
  const b = req.body || {};
  const mod = db.prepare('SELECT slug, name FROM modules WHERE slug = ? AND installed = 1').get(b.module_slug);
  if (!mod) return res.status(404).json({ error: 'Modulo non trovato.' });
  const to = parseInt(b.to_user_id, 10);
  if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(to)) return res.status(400).json({ error: 'Utente di destinazione non trovato.' });
  const c = condizione(b.from);
  if (!c) return res.status(400).json({ error: 'Indica da dove prendere le righe: senza_proprietario, admin o entrambi.' });
  // chi è già il destinatario non si conta
  const where = 'module_slug = ? AND ' + c.sql + ' AND (user_id IS NULL OR user_id != ?)';
  const params = [mod.slug, ...c.params, to];
  const n = db.prepare('SELECT COUNT(*) n FROM records WHERE ' + where).get(...params).n;
  if (b.dry_run) return res.json({ dry_run: true, righe: n, modulo: mod.name });
  const done = db.transaction(() => db.prepare('UPDATE records SET user_id = ? WHERE ' + where).run(to, ...params).changes)();
  logAudit(req.user.username, 'record_owner.assign', mod.slug, { da: b.from, a: to, righe: done });
  res.json({ ok: true, righe: done, modulo: mod.name });
});

module.exports = router;
