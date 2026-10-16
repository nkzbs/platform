'use strict';
// Esportazione di un tenant su un server dell'utente (lib/tenant-export.js). Lo chiama il TENANT stesso (Impostazioni → Dati) e prova chi è con un token firmato col SUO segreto, che Super Admin
// conosce: un tenant non può quindi esportarne un altro (il segreto interno condiviso NON basta). Tutte le rotte rispondono solo per il tenant del token.
//   POST /api/tenant-export/:slug/verifica   { server, opzioni }                    → impronta del server e controlli (sola lettura)
//   POST /api/tenant-export/:slug/avvia      { server, fingerprint, opzioni }       → { id }, la copia parte in background
//   GET  /api/tenant-export/:slug/stato/:id                                         → avanzamento
const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../db');
const exporter = require('../lib/tenant-export');

const router = express.Router();

function requireTenantToken(req, res, next) {
  const tenant = db.prepare("SELECT * FROM tenants WHERE slug = ? AND status != 'deleted'").get(req.params.slug);
  const raw = (req.headers.authorization || '').replace(/^Bearer /, '');
  if (!tenant || !tenant.jwt_secret || !raw) return res.status(401).json({ error: 'Non autorizzato' });
  try {
    const p = jwt.verify(raw, tenant.jwt_secret, { algorithms: ['HS256'] });
    if (p.purpose !== 'export' || p.slug !== tenant.slug) return res.status(401).json({ error: 'Non autorizzato' });
  } catch (e) { return res.status(401).json({ error: 'Non autorizzato' }); }
  req.tenant = tenant;
  next();
}

// Dal corpo si prende SOLO ciò che serve, con i tipi giusti; il resto si ignora.
function leggiServer(b) {
  const s = (b && b.server) || {};
  const porta = s.port == null || s.port === '' ? 22 : Number(s.port);
  return { host: String(s.host || '').trim(), port: porta, username: String(s.username || '').trim().slice(0, 64), password: s.password ? String(s.password).slice(0, 512) : undefined, privateKey: s.privateKey ? String(s.privateKey).slice(0, 16384) : undefined, passphrase: s.passphrase ? String(s.passphrase).slice(0, 512) : undefined };
}
const errore = (res, e) => res.status(e.status || 500).json({ error: e.message });

router.post('/:slug/verifica', requireTenantToken, async (req, res) => {
  const server = leggiServer(req.body);
  if (!server.username || (!server.password && !server.privateKey)) return res.status(400).json({ error: 'Servono utente e password (oppure chiave privata).' });
  try { res.json(await exporter.verifica(req.tenant, server, req.body && req.body.opzioni)); } catch (e) { errore(res, e); }
});

router.post('/:slug/avvia', requireTenantToken, async (req, res) => {
  const server = leggiServer(req.body);
  if (!server.username || (!server.password && !server.privateKey)) return res.status(400).json({ error: 'Servono utente e password (oppure chiave privata).' });
  try { res.status(202).json(await exporter.avvia(req.tenant, server, String((req.body && req.body.fingerprint) || ''), req.body && req.body.opzioni)); } catch (e) { errore(res, e); }
});

router.get('/:slug/stato/:id', requireTenantToken, (req, res) => {
  const s = exporter.stato(req.params.id, req.tenant.slug);
  if (!s) return res.status(404).json({ error: 'Esportazione non trovata' });
  res.json(s);
});

module.exports = router;
