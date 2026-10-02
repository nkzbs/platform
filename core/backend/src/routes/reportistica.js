const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('./auth');

const router = express.Router();

const SUPER_ADMIN_URL = process.env.SUPER_ADMIN_URL || 'http://super-admin-backend:3000';
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET || 'changeme_internal';
const TENANT_SLUG = process.env.TENANT_SLUG || 'default';

// POST /analyze (2026-09-28, richiesto dall'utente: "vorrei che mistral mi
// analizzasse i dati" su Reportistica, "non voglio troppe chiamate, vanno
// gestiti bene i token") — SOLO bottone manuale in ReportisticaPage.jsx, MAI
// un useEffect/scheduler: un umano clicca, una chiamata parte. Riceve dal
// frontend le tabelle GIA' CALCOLATE lato client (performance agenti,
// marginalità prodotto — poche righe, mai i record grezzi), le inoltra a
// Super Admin (stesso pattern x-internal-secret già in uso in routes/support.js
// per i ticket) che possiede il prompt di sistema, salva il risultato qui e lo
// ritorna. Dashboard legge la stessa riga via GET /analysis sotto — zero
// chiamate aggiuntive per la Dashboard.
router.post('/analyze', requireAuth, requireAdmin, async (req, res) => {
  const { data } = req.body || {};
  if (!data || typeof data !== 'object') {
    return res.status(400).json({ error: 'data obbligatorio (tabelle già calcolate)' });
  }
  try {
    const r = await fetch(SUPER_ADMIN_URL + '/api/tenant-ai/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_SECRET },
      body: JSON.stringify({ tenant_slug: TENANT_SLUG, kind: 'reportistica', data }),
    });
    const body = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: body.error || 'Analisi AI non riuscita' });
    const insert = db.prepare('INSERT INTO ai_analysis_cache (kind, result_text, generated_by) VALUES (?, ?, ?)');
    const result = insert.run('reportistica', body.result_text, req.user.username || null);
    const row = db.prepare('SELECT * FROM ai_analysis_cache WHERE id = ?').get(result.lastInsertRowid);
    res.json(row);
  } catch (e) {
    res.status(502).json({ error: 'Super Admin non raggiungibile al momento — riprova più tardi' });
  }
});

// GET /analysis — ultima analisi in cache, o null se non ancora generata.
// Nessun costo AI: legge solo il DB locale. Usata SIA da ReportisticaPage.jsx
// all'apertura pagina SIA dal riquadro fisso in DashboardPage.jsx — un solo
// dato, due letture, zero chiamate Mistral aggiuntive.
router.get('/analysis', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM ai_analysis_cache WHERE kind = ? ORDER BY id DESC LIMIT 1').get('reportistica');
  res.json(row || null);
});

module.exports = router;
