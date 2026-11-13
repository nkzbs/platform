'use strict';
// Lo «store» delle funzioni: GET elenco (tutti gli utenti collegati), POST accendi/spegni (solo amministratore). Vedi plugins/index.js.
const express = require('express');
const { requireAuth, requireAdmin } = require('./auth');
const plugins = require('../plugins');
const router = express.Router();
router.get('/', requireAuth, (req, res) => res.json({ funzioni: plugins.catalogo() }));
router.post('/:id/attiva', requireAuth, requireAdmin, (req, res) => (plugins.attiva(req.params.id) ? res.json({ ok: true, funzioni: plugins.catalogo() }) : res.status(404).json({ error: 'Funzione sconosciuta' })));
router.post('/:id/spegni', requireAuth, requireAdmin, (req, res) => { const r = plugins.spegni(req.params.id); return r.errore ? res.status(409).json({ error: r.errore }) : res.json({ ok: true, funzioni: plugins.catalogo() }); });
module.exports = router;
