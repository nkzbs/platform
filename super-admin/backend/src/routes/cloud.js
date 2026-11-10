'use strict';
// Impostazioni → Server (Linode): token sigillato, regione e tipo di macchina, controllo a sole letture. Solo Super Admin autenticato.
const express = require('express');
const router = express.Router();
const { requireAuth } = require('./auth');
const { logAudit } = require('../audit-log');
const linode = require('../lib/linode');

router.get('/', requireAuth, (req, res) => res.json(linode.stato()));

router.put('/token', requireAuth, async (req, res) => {
  const t = String((req.body && req.body.token) || '').trim();
  if (t.length < 20 || /\s/.test(t)) return res.status(400).json({ error: 'Il token non sembra valido (troppo corto o con spazi).' });
  const v = await linode.validaToken(t);
  if (!v.ok) return res.status(400).json({ error: v.reason });
  linode.salvaToken(t);
  logAudit(req.user.username, 'cloud.linode.token.set', null, null);
  res.json(linode.stato());
});

router.delete('/token', requireAuth, (req, res) => {
  linode.togliToken();
  logAudit(req.user.username, 'cloud.linode.token.clear', null, null);
  res.json(linode.stato());
});

router.put('/impostazioni', requireAuth, (req, res) => {
  try { linode.salvaImpostazioni({ regione: req.body && req.body.regione, tipo: req.body && req.body.tipo }); }
  catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
  logAudit(req.user.username, 'cloud.linode.impostazioni', null, linode.impostazioni());
  res.json(linode.stato());
});

// Solo letture su Linode: non crea e non costa.
router.post('/controlla', requireAuth, async (req, res) => res.json(await linode.controlla()));

// ── Cloudflare (record DNS dei tenant sui loro server) ─ stesse regole: token sigillato, controllo a sole letture ──
const cf = require('../lib/cloudflare');
router.get('/cloudflare', requireAuth, (req, res) => res.json(cf.stato()));
router.put('/cloudflare/token', requireAuth, async (req, res) => {
  const t = String((req.body && req.body.token) || '').trim();
  if (t.length < 20 || /\s/.test(t)) return res.status(400).json({ error: 'Il token non sembra valido (troppo corto o con spazi).' });
  const v = await cf.validaToken(t);
  if (!v.ok) return res.status(400).json({ error: v.reason });
  cf.salvaToken(t);
  logAudit(req.user.username, 'cloud.cloudflare.token.set', null, null);
  res.json(cf.stato());
});
router.delete('/cloudflare/token', requireAuth, (req, res) => {
  cf.togliToken();
  logAudit(req.user.username, 'cloud.cloudflare.token.clear', null, null);
  res.json(cf.stato());
});
router.put('/cloudflare/impostazioni', requireAuth, (req, res) => {
  try { cf.salvaImpostazioni({ zona: req.body && req.body.zona, dominio: req.body && req.body.dominio }); }
  catch (e) { return res.status(e.status || 400).json({ error: e.message }); }
  logAudit(req.user.username, 'cloud.cloudflare.impostazioni', null, cf.impostazioni());
  res.json(cf.stato());
});
router.post('/cloudflare/controlla', requireAuth, async (req, res) => res.json(await cf.controlla()));

module.exports = router;
