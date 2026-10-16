'use strict';
// «Distacca su un tuo server» (solo admin): copia questo tenant su un server Linux dell'utente via SSH, dove continua a funzionare da solo. Il lavoro lo fa Super Admin (ha l'immagine e il volume dei dati);
// il tenant gli prova chi è con un token firmato col SUO segreto (il segreto interno condiviso non basta) e chiede la password dell'account prima di partire.
// Le credenziali SSH passano da qui in memoria verso Super Admin: non si salvano, non si registrano, non finiscono nell'audit.
//   POST /api/export-server/verifica   { password, server, opzioni }                  → impronta del server + controlli (sola lettura)
//   POST /api/export-server/avvia      { password, server, fingerprint, opzioni }     → { id }
//   GET  /api/export-server/stato/:id
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { requireAuth, requireAdmin } = require('./auth');
const { logAudit } = require('../audit-log');

const router = express.Router();
const SUPER_ADMIN_URL = process.env.SUPER_ADMIN_URL || 'http://super-admin-backend:3000';
const TENANT_SLUG = process.env.TENANT_SLUG || 'default';

const token = () => jwt.sign({ slug: TENANT_SLUG, purpose: 'export' }, process.env.JWT_SECRET, { expiresIn: 300 });

async function versoSuperAdmin(method, path, body) {
  let r;
  try {
    r = await fetch(SUPER_ADMIN_URL + '/api/tenant-export/' + encodeURIComponent(TENANT_SLUG) + path, {
      method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token() }, body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) { return { status: 502, data: { error: 'Super Admin non è raggiungibile: da qui non posso copiare il tenant.' } }; }
  return { status: r.status, data: await r.json().catch(() => ({ error: 'Risposta non valida da Super Admin' })) };
}

// Solo admin, solo se questo tenant non è già distaccato, e con la password dell'account riconfermata.
function controlla(req, res, next) {
  if (process.env.DETACHED === '1') return res.status(400).json({ error: 'Questo tenant è già distaccato: non ha più Super Admin da cui copiarsi.' });
  const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!user || !bcrypt.compareSync(String((req.body && req.body.password) || ''), user.password_hash)) return res.status(401).json({ error: 'Password dell\'account non corretta.' });
  next();
}
// Solo i campi attesi, con i tipi giusti, verso Super Admin: il resto del corpo non parte.
const pulito = (b, conImpronta) => ({
  server: { host: (b.server || {}).host, port: (b.server || {}).port, username: (b.server || {}).username, password: (b.server || {}).password, privateKey: (b.server || {}).privateKey, passphrase: (b.server || {}).passphrase },
  opzioni: { porta_web: (b.opzioni || {}).porta_web, cartella: (b.opzioni || {}).cartella },
  ...(conImpronta ? { fingerprint: b.fingerprint } : {}),
});

router.post('/verifica', requireAuth, requireAdmin, controlla, async (req, res) => {
  const r = await versoSuperAdmin('POST', '/verifica', pulito(req.body));
  if (r.status === 200) logAudit(req.user.username, 'export.verify', ((req.body.server || {}).host) || '', null);
  res.status(r.status).json(r.data);
});
router.post('/avvia', requireAuth, requireAdmin, controlla, async (req, res) => {
  const r = await versoSuperAdmin('POST', '/avvia', pulito(req.body, true));
  if (r.status === 202) logAudit(req.user.username, 'export.start', ((req.body.server || {}).host) || '', { cartella: (req.body.opzioni || {}).cartella });
  res.status(r.status).json(r.data);
});
router.get('/stato/:id', requireAuth, requireAdmin, async (req, res) => {
  const r = await versoSuperAdmin('GET', '/stato/' + encodeURIComponent(req.params.id));
  res.status(r.status).json(r.data);
});

module.exports = router;
