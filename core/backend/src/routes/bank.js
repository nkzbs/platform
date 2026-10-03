'use strict';
const express = require('express');
const multer = require('multer');
const { requireAuth, requireAdmin } = require('./auth');
const bank = require('../bank-import');
const { logAudit } = require('../audit-log');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 24 } });
const validMonth = (m) => m === undefined || /^\d{4}-\d{2}$/.test(String(m));
const idOf = (req) => parseInt(req.params.id, 10);

// Carica uno o più estratti conto (PDF). Il PDF si legge e si scarta: restano solo i movimenti.
router.post('/import', requireAuth, requireAdmin, (req, res) => {
  upload.array('files', 24)(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'Scegli almeno un estratto conto in PDF.' });
    const results = [];
    for (const f of files) {
      if (!f.buffer.slice(0, 5).toString().startsWith('%PDF')) { results.push({ file: f.originalname, error: 'Non è un PDF.' }); continue; }
      try { results.push(await bank.importPdf(f.buffer, f.originalname)); }
      catch (e) { results.push({ file: f.originalname, error: e.message }); }
    }
    const abbinati = bank.rematch();
    const nuovi = results.reduce((s, r) => s + (r.nuovi || 0), 0);
    logAudit(req.user.username, 'bank.import', null, { file: files.length, nuovi, abbinati });
    res.json({ results, abbinati });
  });
});

router.get('/summary', requireAuth, requireAdmin, (req, res) => {
  if (!validMonth(req.query.month)) return res.status(400).json({ error: 'Mese non valido (atteso AAAA-MM)' });
  res.json(bank.monthSummary(req.query.month || new Date().toISOString().slice(0, 7)) || { month: req.query.month, movimenti: 0 });
});

router.get('/movements', requireAuth, requireAdmin, (req, res) => {
  if (!validMonth(req.query.month)) return res.status(400).json({ error: 'Mese non valido (atteso AAAA-MM)' });
  res.json(bank.listMovements({ month: req.query.month, filter: req.query.filter }));
});

router.post('/rematch', requireAuth, requireAdmin, (req, res) => res.json({ abbinati: bank.rematch() }));

router.post('/movements/:id/register', requireAuth, requireAdmin, (req, res) => {
  const out = bank.registerAsExpense(idOf(req), req.body || {});
  if (out.notFound) return res.status(404).json({ error: 'Movimento non trovato' });
  if (out.error) return res.status(400).json({ error: out.error });
  logAudit(req.user.username, 'bank.register', String(idOf(req)), { record_id: out.record_id });
  res.json(out);
});

router.post('/movements/:id/ignore', requireAuth, requireAdmin, (req, res) => res.status(bank.setIgnored(idOf(req), true) ? 200 : 404).json({ ok: true }));
router.post('/movements/:id/unignore', requireAuth, requireAdmin, (req, res) => res.status(bank.setIgnored(idOf(req), false) ? 200 : 404).json({ ok: true }));

module.exports = router;
