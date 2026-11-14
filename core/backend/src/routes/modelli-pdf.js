const express = require('express');
const { requireAuth, requireAdmin } = require('./auth');
const { logAudit } = require('../audit-log');
const modelli = require('../lib/modelli-pdf');

// Modelli PDF compilabili del tenant: l'elenco, e il caricamento (i pacchetti di verticale li installano da qui). Solo amministratori.
const router = express.Router();
router.get('/', requireAuth, requireAdmin, (req, res) => res.json(modelli.elenco()));
router.put('/:chiave', requireAuth, requireAdmin, async (req, res) => {
  try {
    const b = req.body || {};
    const r = await modelli.salva({ chiave: req.params.chiave, titolo: b.titolo, pdf: Buffer.from(String(b.pdf_base64 || ''), 'base64'), mappa: b.mappa });
    logAudit(req.user.username, 'modelli_pdf.salva', req.params.chiave, r);
    res.json({ ok: true, ...r });
  } catch (e) { res.status(e.status || 500).json({ error: e.status ? e.message : 'Caricamento non riuscito' }); }
});
module.exports = router;
