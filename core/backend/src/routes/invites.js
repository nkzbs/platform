'use strict';
// Inviti (vedi invites.js):
//   POST   /api/invites                 (admin)  { nome, email?, role, invia_email?, link_base? } → { id, token, scade, email }  il token si vede UNA volta
//   GET    /api/invites                 (admin)  gli ultimi inviti con lo stato
//   DELETE /api/invites/:id             (admin)  annulla un invito non ancora usato
//   POST   /api/internal-invite         (secret interno, da Super Admin) { nome, email?, role } → { token, scade }
//   GET    /api/public-invite/:token    (pubblica) { valido, nome } oppure { valido: false, motivo }
//   POST   /api/public-invite/:token    (pubblica) { username, password } → crea l'utente
// L'email la manda Super Admin (ha la posta): il tenant gli chiede di spedire un messaggio fisso con il link, provando chi è con un token firmato col SUO segreto.
const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../db');
const invites = require('../invites');
const { requireAuth, requireAdmin } = require('./auth');
const { logAudit } = require('../audit-log');

const SUPER_ADMIN_URL = process.env.SUPER_ADMIN_URL || 'http://super-admin-backend:3000';
const TENANT_SLUG = process.env.TENANT_SLUG || 'default';
const fail = (res, e) => res.status(e.status || 500).json({ error: e.message });

const admin = express.Router();
admin.post('/', requireAuth, requireAdmin, async (req, res) => {
  const b = req.body || {};
  try {
    const inv = invites.crea({ nome: b.nome, email: b.email, role: b.role, by: req.user.username });
    logAudit(req.user.username, 'invite.create', String(inv.id), { role: b.role || 'user', email: !!b.email });
    let email = null;
    if (b.invia_email) {
      if (!b.email) email = { sent: false, reason: 'Manca l\'indirizzo email.' };
      else if (!/^https?:\/\/[^\s]+$/.test(String(b.link_base || ''))) email = { sent: false, reason: 'Indirizzo del progetto non valido.' };
      else {
        try {
          const token = jwt.sign({ slug: TENANT_SLUG, purpose: 'invite-mail' }, process.env.JWT_SECRET, { expiresIn: 120 });
          const r = await fetch(SUPER_ADMIN_URL + '/api/tenant-invite/' + encodeURIComponent(TENANT_SLUG) + '/mail', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ to: b.email, nome: b.nome, link: String(b.link_base).replace(/\/+$/, '') + '/invito/' + inv.token, ore: inv.ore }) });
          const d = await r.json().catch(() => ({}));
          email = r.ok ? { sent: !!d.sent, reason: d.reason || null } : { sent: false, reason: d.error || 'Super Admin non ha spedito la mail.' };
        } catch (e) { email = { sent: false, reason: 'Super Admin non è raggiungibile: la mail non è partita.' }; }
      }
    }
    res.json({ id: inv.id, token: inv.token, scade: inv.scade, ore: inv.ore, email });
  } catch (e) { fail(res, e); }
});
admin.get('/', requireAuth, requireAdmin, (req, res) => res.json(invites.elenco()));
admin.delete('/:id', requireAuth, requireAdmin, (req, res) => {
  if (!invites.revoca(Number(req.params.id))) return res.status(404).json({ error: 'Invito non trovato o già usato.' });
  logAudit(req.user.username, 'invite.revoke', String(req.params.id), null);
  res.json({ ok: true });
});

// Da Super Admin (secret interno): l'invito per il primo admin di un tenant appena creato.
const interno = express.Router();
interno.post('/', (req, res) => {
  const secret = req.headers['x-internal-secret'];
  if (!secret || secret !== (process.env.INTERNAL_API_SECRET || 'changeme_internal')) return res.status(401).json({ error: 'Secret interno non valido' });
  try {
    const b = req.body || {}, inv = invites.crea({ nome: b.nome, email: b.email, role: b.role || 'admin', by: 'super-admin' });
    logAudit('super-admin', 'invite.create', String(inv.id), { role: b.role || 'admin', via: 'super-admin' });
    res.json({ id: inv.id, token: inv.token, scade: inv.scade, ore: inv.ore });
  } catch (e) { fail(res, e); }
});

// Pubbliche (senza login): chi ha il link. Il token è lungo e casuale; l'invito si consuma una volta sola.
const pubblico = express.Router();
pubblico.get('/:token', (req, res) => {
  const s = invites.stato(req.params.token);
  const nome = (db.prepare('SELECT ragione_sociale FROM tenant_settings WHERE id = 1').get() || {}).ragione_sociale || process.env.TENANT_NAME || '';
  res.status(s.valido ? 200 : 410).json({ ...s, progetto: nome });
});
pubblico.post('/:token', (req, res) => {
  try {
    const u = invites.usa(req.params.token, req.body || {});
    logAudit(u.username, 'invite.use', u.username, { role: u.ruolo });
    res.json({ ok: true, username: u.username });
  } catch (e) { fail(res, e); }
});

module.exports = { admin, interno, pubblico };
