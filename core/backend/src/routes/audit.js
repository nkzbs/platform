const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('./auth');

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
router.get('/internal/monitoring-feed', (req, res) => {
  const secret = req.headers['x-internal-secret'];
  if (!secret || secret !== (process.env.INTERNAL_API_SECRET || 'changeme_internal')) {
    return res.status(401).json({ error: 'Secret interno non valido' });
  }
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

// F12 (PLATFORM-MASTER-ROADMAP.md) — Measurement/Closed Loop: dato il registry_module_id di
// una raccomandazione (F11), trova lo slug REALE con cui quel modulo è installato SU QUESTO
// tenant — necessario prima di poter misurare qualunque cosa, perché F11 conosce solo il
// modulo del Registro, non lo slug locale del tenant che lo ha installato (di norma uguale
// ma non garantito). Nessuno slug trovato = il modulo non è (ancora) installato qui, un
// precondizione onesta da segnalare, non un errore silenzioso.
router.get('/internal/resolve-module', (req, res) => {
  const secret = req.headers['x-internal-secret'];
  if (!secret || secret !== (process.env.INTERNAL_API_SECRET || 'changeme_internal')) {
    return res.status(401).json({ error: 'Secret interno non valido' });
  }
  const registryModuleId = parseInt(req.query.registry_module_id, 10);
  if (!registryModuleId) return res.status(400).json({ error: 'registry_module_id obbligatorio' });
  const mod = db.prepare('SELECT slug FROM modules WHERE registry_module_id = ? AND installed = 1').get(registryModuleId);
  res.json({ slug: mod ? mod.slug : null });
});

// F12 — tempo medio (ore) tra la creazione di un record e il suo ultimo evento successivo
// registrato in record_history (update/transition), per i record creati nella finestra
// [since, until). Un record MAI più toccato dopo la creazione è escluso dalla media (non c'è
// un "tempo di completamento" da misurare) — sampleSize riflette quanti record contribuiscono
// davvero, mai un numero gonfiato includendo record senza un secondo evento.
router.get('/internal/module-cycle-time', (req, res) => {
  const secret = req.headers['x-internal-secret'];
  if (!secret || secret !== (process.env.INTERNAL_API_SECRET || 'changeme_internal')) {
    return res.status(401).json({ error: 'Secret interno non valido' });
  }
  const { module_slug, since, until } = req.query;
  if (!module_slug || !since || !until) return res.status(400).json({ error: 'module_slug, since, until obbligatori' });

  let rows = [];
  try {
    rows = db.prepare('SELECT record_id, action, created_at FROM record_history WHERE module_slug = ? ORDER BY record_id, created_at').all(module_slug);
  } catch (e) { return res.json({ averageHours: null, sampleSize: 0 }); }

  const byRecord = new Map();
  for (const r of rows) {
    if (!byRecord.has(r.record_id)) byRecord.set(r.record_id, []);
    byRecord.get(r.record_id).push(r);
  }

  const sinceMs = new Date(since).getTime();
  const untilMs = new Date(until).getTime();
  const durationsHours = [];
  for (const events of byRecord.values()) {
    const createEvent = events.find((e) => e.action === 'create');
    if (!createEvent) continue;
    const createdMs = new Date(createEvent.created_at).getTime();
    if (createdMs < sinceMs || createdMs >= untilMs) continue;
    const later = events.filter((e) => e !== createEvent && new Date(e.created_at).getTime() > createdMs);
    if (later.length === 0) continue;
    const lastMs = new Date(later[later.length - 1].created_at).getTime();
    durationsHours.push((lastMs - createdMs) / 3600000);
  }

  const averageHours = durationsHours.length ? durationsHours.reduce((a, b) => a + b, 0) / durationsHours.length : null;
  res.json({ averageHours, sampleSize: durationsHours.length });
});

module.exports = router;
