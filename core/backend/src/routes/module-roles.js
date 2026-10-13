'use strict';
const express = require('express');
const { requireAuth, requireAdmin } = require('./auth');
const roles = require('../module-roles');
const moduleAi = require('../module-ai');
const { logAudit } = require('../audit-log');
const db = require('../db');

const router = express.Router();

// Le "code" per la dashboard: i moduli che hanno dichiarato quale stato significa "nuovo" (da smistare). Nessun dato di righe qui:
// le righe le legge il widget dall'elenco normale del modulo, che già rispetta i permessi di chi guarda.
router.get('/queues', requireAuth, (req, res) => {
  res.json(roles.list({ use: 'avvisi' }).filter((m) => m.avvisi.states.nuovo).map((m) => ({
    module_slug: m.module_slug, name: m.name, stato: m.roles.stato || '_stato', nuovo: m.avvisi.states.nuovo, da_fare: m.avvisi.states.da_fare || '',
    descrizione: m.roles.descrizione || '', importo: m.roles.importo || '', scadenza: m.roles.scadenza || '', data: m.roles.data || '',
    ai: moduleAi.can(m.module_slug, 'triage'), categoria: m.roles.categoria || '', fatto: m.avvisi.states.fatto || '', rate: !!(m.avvisi.piano.modulo && Object.values(m.avvisi.piano.campi).every(Boolean)),
    noun_s: m.avvisi.noun_s, noun_p: m.avvisi.noun_p,
  })));
});

router.get('/', requireAuth, requireAdmin, (req, res) => {
  res.json(roles.list());
});

router.get('/:slug', requireAuth, requireAdmin, (req, res) => {
  res.json(roles.get(req.params.slug) || { module_slug: req.params.slug, kind: null, uses: [], roles: {} });
});

router.put('/:slug', requireAuth, requireAdmin, (req, res) => {
  if (!db.prepare('SELECT 1 FROM modules WHERE slug = ?').get(req.params.slug)) return res.status(404).json({ error: 'Modulo non trovato' });
  const out = roles.set(req.params.slug, req.body || {});
  logAudit(req.user.username, 'module.roles', req.params.slug, { kind: out.kind, uses: out.uses });
  res.json(out);
});

module.exports = router;
