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
  // P2 (collaudo operativo 2026-09-03) — /timeline di Super Admin era limitato a un
  // tetto fisso (500), oltre il quale gli eventi più vecchi diventavano irraggiungibili
  // per sempre, non solo "non ancora caricati". `before` (timestamp ISO) è un cursore
  // opzionale — "carica altri" ripete la stessa chiamata con l'evento più vecchio già
  // mostrato, non un vero OFFSET (qui il feed è un merge cross-tenant via HTTP, un
  // OFFSET reale non avrebbe senso senza materializzare tutto prima).
  const before = req.query.before || null;
  let audit_log = [];
  let error_logs = [];
  let business_events = [];
  try {
    audit_log = (before
      ? db.prepare('SELECT * FROM audit_log WHERE created_at < ? ORDER BY created_at DESC LIMIT ?').all(before, limit)
      : db.prepare('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ?').all(limit))
      .map((r) => ({ ...r, details: r.details ? JSON.parse(r.details) : null }));
  } catch (e) { /* tabella non ancora presente su un'immagine precedente — non un errore */ }
  try {
    error_logs = before
      ? db.prepare('SELECT * FROM error_logs WHERE created_at < ? ORDER BY created_at DESC LIMIT ?').all(before, limit)
      : db.prepare('SELECT * FROM error_logs ORDER BY created_at DESC LIMIT ?').all(limit);
  } catch (e) { /* idem */ }
  // F9 (PLATFORM-MASTER-ROADMAP.md) — Observability Foundation: record_history già
  // esiste (create/update/delete/transition su ogni record, di ogni modulo — cioè
  // "ordine/pagamento/fattura/stock" nei termini della roadmap, dato che questo
  // sistema non ha entità business hardcoded) ma prima era visibile SOLO aprendo lo
  // storico del singolo record dentro il tenant, mai nella vista aggregata di Super
  // Admin (/timeline) — qui esposto allo stesso modo di audit_log/error_logs sopra.
  // before_data/after_data non incluse (potrebbero contenere campi cifrati/PII di
  // un record intero) — solo cosa è successo, non i valori, coerente con l'uso
  // previsto ("ricostruire cosa è successo", non un export dati).
  try {
    business_events = before
      ? db.prepare('SELECT id, record_id, module_slug, actor, action, created_at FROM record_history WHERE created_at < ? ORDER BY created_at DESC LIMIT ?').all(before, limit)
      : db.prepare('SELECT id, record_id, module_slug, actor, action, created_at FROM record_history ORDER BY created_at DESC LIMIT ?').all(limit);
  } catch (e) { /* idem */ }
  res.json({ audit_log, error_logs, business_events });
});

module.exports = router;
