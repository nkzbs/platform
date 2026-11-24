// Allegati di un record (elenco, aggiunta, stacco). Montato da routes/records.js nello stesso punto in cui stavano.
const express = require('express');
const db = require('../db');
const { requireAuth, requireModuleAccess } = require('./auth');
const { ruleFor, ownedOrAllowed } = require('../permissions');
const { deleteUploadById } = require('../lib/upload-storage');
const { getModuleSchema } = require('./records-helpers');

const router = express.Router();

// ─── ALLEGATI TIPIZZATI ──────────────────────────────────────────────────────
// Falla reale trovata il 2026-10-14 (segnalata dall'utente, mai verificata
// prima): queste tre rotte avevano solo requireAuth, NESSUN controllo sul
// record a cui l'allegato appartiene — un utente con ruolo "solo propri"
// (view_own_only) poteva leggere/aggiungere/staccare allegati di un record
// altrui semplicemente conoscendone slug+id, bypassando del tutto la regola
// che per i record stessi (GET /:slug/:id) è già rispettata. Stesso identico
// controllo di quella rotta, replicato qui.
function loadRecordOr404(slug, id, res) {
  const record = db.prepare('SELECT * FROM records WHERE id = ? AND module_slug = ?').get(id, slug);
  if (!record) { res.status(404).json({ error: 'Record non trovato' }); return null; }
  return record;
}

router.get('/:slug/:id/attachments', requireAuth, requireModuleAccess, (req, res) => {
  const record = loadRecordOr404(req.params.slug, req.params.id, res);
  if (!record) return;
  const schema = getModuleSchema(req.params.slug) || {};
  const rule = ruleFor(schema, req.user.role);
  if (rule && (!rule.view || !ownedOrAllowed(rule, record, req.user))) {
    return res.status(403).json({ error: 'Non hai i permessi per vedere questo record' });
  }
  const rows = db.prepare(`
    SELECT ra.id, ra.tipo, ra.created_at, u.original_name, u.size, u.mime_type, u.id as upload_id
    FROM record_attachments ra JOIN uploads u ON u.id = ra.upload_id
    WHERE ra.module_slug = ? AND ra.record_id = ?
    ORDER BY ra.created_at ASC
  `).all(req.params.slug, req.params.id);
  res.json(rows);
});

router.post('/:slug/:id/attachments', requireAuth, requireModuleAccess, (req, res) => {
  const record = loadRecordOr404(req.params.slug, req.params.id, res);
  if (!record) return;
  const schema = getModuleSchema(req.params.slug) || {};
  const rule = ruleFor(schema, req.user.role);
  if (rule && (!rule.edit || !ownedOrAllowed(rule, record, req.user))) {
    return res.status(403).json({ error: 'Non hai i permessi per modificare questo record' });
  }
  const { upload_id, tipo } = req.body;
  if (!upload_id) return res.status(400).json({ error: 'upload_id obbligatorio' });
  const up = db.prepare('SELECT id, uploaded_by FROM uploads WHERE id = ?').get(upload_id);
  if (!up) return res.status(404).json({ error: 'Upload non trovato' });
  // Senza questo controllo, avere il permesso di modifica sul PROPRIO record
  // bastava a "rubare" un file caricato da qualcun altro: lo si collegava al
  // proprio record (questa rotta) e poi lo si leggeva da lì, aggirando
  // qualunque permesso sul record originale dell'upload. L'unico flusso reale
  // (RecordDetailModal.jsx, ModulePage/index.jsx) carica e allega nella
  // stessa azione, sempre con lo stesso utente — un admin resta libero per
  // import/correzioni.
  if (up.uploaded_by !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Puoi allegare solo file che hai caricato tu' });
  }
  const result = db.prepare(
    'INSERT INTO record_attachments (module_slug, record_id, upload_id, tipo) VALUES (?, ?, ?, ?)'
  ).run(req.params.slug, req.params.id, upload_id, tipo || null);
  res.json({ id: result.lastInsertRowid, upload_id, tipo });
});

router.delete('/:slug/:id/attachments/:attId', requireAuth, requireModuleAccess, async (req, res) => {
  const record = loadRecordOr404(req.params.slug, req.params.id, res);
  if (!record) return;
  const schema = getModuleSchema(req.params.slug) || {};
  const rule = ruleFor(schema, req.user.role);
  if (rule && (!rule.edit || !ownedOrAllowed(rule, record, req.user))) {
    return res.status(403).json({ error: 'Non hai i permessi per modificare questo record' });
  }
  // Ogni riga qui ha un upload dedicato, mai condiviso con un altro record
  // (creato apposta al momento dell'allega, verificato su tutti e 3 i punti
  // del frontend che chiamano questa API) — cancellare il collegamento
  // cancella quindi anche il file vero sottostante, altrimenti resta orfano
  // per sempre su disco/Drive (come succedeva prima di questo fix).
  const att = db.prepare('SELECT upload_id FROM record_attachments WHERE id = ? AND module_slug = ? AND record_id = ?')
    .get(req.params.attId, req.params.slug, req.params.id);
  db.prepare('DELETE FROM record_attachments WHERE id = ? AND module_slug = ? AND record_id = ?')
    .run(req.params.attId, req.params.slug, req.params.id);
  if (att) { try { await deleteUploadById(att.upload_id); } catch (e) {} }
  res.json({ ok: true });
});

module.exports = router;
