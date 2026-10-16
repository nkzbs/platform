const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('./auth');
const { requireInternalSecret } = require('../../../../shared/internal-secret.js');

const router = express.Router();

// Paginazione reale (2026-09-03, richiesto dall'utente: "il paging va sistemato
// ovunque ora") — prima solo `limit` (max 500), la cronologia oltre quel numero era
// semplicemente irraggiungibile dal frontend, non solo "tutta nel DOM insieme" come
// negli altri casi sistemati in questo stesso giro. `total` nella risposta permette
// al frontend di calcolare le pagine senza un secondo giro di rete. Risposta diventa
// {rows, total} invece di un array nudo — unico chiamante è AuditPage.jsx, aggiornato
// nello stesso commit.
router.get('/', requireAuth, requireAdmin, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const rows = db.prepare('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset);
  const total = db.prepare('SELECT COUNT(*) as n FROM audit_log').get().n;
  res.json({ rows: rows.map((r) => ({ ...r, details: r.details ? JSON.parse(r.details) : null })), total });
});

// G2b/G15 (PLATFORM-0.6-GAP-ANALYSIS.md) — endpoint interno (rete Docker, mai esposto
// fuori), stesso principio già in uso per /auth/internal-token: Super Admin autentica
// con INTERNAL_API_SECRET, non con un login utente. Calcola audit_log+error_logs DENTRO
// il processo del tenant, così super-admin/backend/src/routes/monitoring.js e
// lib/module-stats.js non devono più aprire il .db grezzo del tenant dall'esterno per
// leggere questi due dati — sostituisce quell'accesso diretto con una chiamata di rete,
// stesso identico dato restituito.
router.get('/internal/monitoring-feed', requireInternalSecret, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 150, 500);
  // PRIVACY (13 ottobre 2026): da qui esce SOLO l'elenco degli errori tecnici (serve a sapere se il tenant è rotto). Le azioni degli utenti
  // (audit_log) e cosa succede ai record (record_history) restano dentro il tenant, visibili solo a chi ha accesso al tenant: Super Admin non le legge.
  // `before` (timestamp ISO) è un cursore opzionale per «Carica altri».
  const before = req.query.before || null;
  let error_logs = [];
  try {
    error_logs = before
      ? db.prepare('SELECT * FROM error_logs WHERE created_at < ? ORDER BY created_at DESC LIMIT ?').all(before, limit)
      : db.prepare('SELECT * FROM error_logs ORDER BY created_at DESC LIMIT ?').all(limit);
  } catch (e) { /* tabella non ancora presente su un'immagine precedente — non un errore */ }
  res.json({ error_logs });
});

module.exports = router;
