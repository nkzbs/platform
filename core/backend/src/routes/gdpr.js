'use strict';
// Pannello Privacy e GDPR (solo admin). Vedi gdpr.js per cosa fa ogni parte.
const express = require('express');
const { requireAuth, requireAdmin } = require('./auth');
const { logAudit } = require('../audit-log');
const g = require('../gdpr');

const router = express.Router();
router.use(requireAuth, requireAdmin);

const TIPI = ['trattamenti', 'fornitori', 'violazioni'];
const fail = (res, e) => res.status(e.status || 500).json({ error: e.status ? e.message : 'Errore interno' });

router.get('/stato', (req, res) => res.json(g.stato()));
router.post('/precompila', (req, res) => { const r = g.precompila(); logAudit(req.user.username, 'gdpr.precompila', null, r); res.json(r); });

router.get('/persona', (req, res) => {
  try {
    const trovate = g.cercaPersona(req.query.q);
    logAudit(req.user.username, 'gdpr.ricerca_persona', null, { risultati: trovate.length });
    res.json(trovate.map(({ dati, ...resto }) => resto)); // l'elenco non porta i dati, solo dove sta la persona
  } catch (e) { fail(res, e); }
});
// Esportazione dei dati di una persona (art. 15 e 20): JSON scaricabile con tutte le schede trovate.
router.get('/persona/esporta', (req, res) => {
  try {
    const trovate = g.cercaPersona(req.query.q);
    logAudit(req.user.username, 'gdpr.esporta_persona', null, { risultati: trovate.length });
    res.setHeader('Content-Disposition', 'attachment; filename="dati-persona.json"');
    res.json({ generato_il: new Date().toISOString(), ricerca: String(req.query.q).trim(), schede: trovate.map((t) => ({ modulo: t.nome_modulo, id: t.id, dati: t.dati })) });
  } catch (e) { fail(res, e); }
});

router.get('/:tipo', (req, res) => { if (!TIPI.includes(req.params.tipo)) return res.status(404).json({ error: 'Non trovato' }); res.json(g.elenco(req.params.tipo)); });
router.post('/:tipo', (req, res) => {
  if (!TIPI.includes(req.params.tipo)) return res.status(404).json({ error: 'Non trovato' });
  try { const id = g.crea(req.params.tipo, req.body); logAudit(req.user.username, 'gdpr.crea_' + req.params.tipo, String(id), null); res.json({ id }); } catch (e) { fail(res, e); }
});
router.put('/:tipo/:id', (req, res) => {
  if (!TIPI.includes(req.params.tipo)) return res.status(404).json({ error: 'Non trovato' });
  const n = g.aggiorna(req.params.tipo, Number(req.params.id), req.body);
  if (!n) return res.status(404).json({ error: 'Non trovato' });
  logAudit(req.user.username, 'gdpr.modifica_' + req.params.tipo, req.params.id, null); res.json({ ok: true });
});
router.delete('/:tipo/:id', (req, res) => {
  if (!TIPI.includes(req.params.tipo)) return res.status(404).json({ error: 'Non trovato' });
  if (!g.togli(req.params.tipo, Number(req.params.id))) return res.status(404).json({ error: 'Non trovato' });
  logAudit(req.user.username, 'gdpr.elimina_' + req.params.tipo, req.params.id, null); res.json({ ok: true });
});

module.exports = router;
