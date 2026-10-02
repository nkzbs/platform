const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { requireAuth, requireAdmin } = require('./auth');
const { logAudit } = require('../audit-log');
const { saveUploadBuffer, UPLOAD_DIR } = require('../lib/upload-storage');
const { driveDownload } = require('./google-oauth');

const router = express.Router();

router.get('/download', requireAuth, requireAdmin, (req, res) => {
  const dbPath = process.env.DB_PATH || '/data/platform.db';
  if (!fs.existsSync(dbPath)) return res.status(404).json({ error: 'File database non trovato' });
  const tenant = process.env.TENANT_SLUG || 'tenant';
  const ts = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  const filename = `backup-${tenant}-${ts}.db`;
  logAudit(req.user.username, 'backup.download', filename, null);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/octet-stream');
  fs.createReadStream(dbPath).pipe(res);
});

// Export/restore JSON — a differenza del download .db grezzo (binario, legato a
// SQLite), questo è portabile e leggibile: moduli (schema incluso, cosi' un
// restore su un'istanza vuota ricrea anche la struttura) + tutti i record +
// (da qui in poi) gli allegati veri, byte inclusi. Prima l'export si fermava a
// modules/records: un ripristino su un tenant nuovo ricreava la struttura ma
// ogni allegato (prova di pagamento, fattura...) restava un riferimento
// orfano — "ripristino al 100%" richiesto esplicitamente dall'utente dopo
// averlo notato. Volutamente NON include la tabella users (restore di
// utenti/password è un rischio diverso — auth va gestita a parte).
router.get('/export-json', requireAuth, requireAdmin, async (req, res) => {
  const tenant = process.env.TENANT_SLUG || 'tenant';
  const modules = db.prepare('SELECT name, slug, icon, color, group_name, sort_order, schema_json, support_module, quick_toggle, installed FROM modules').all();
  const records = db.prepare('SELECT id, module_slug, user_id, data, created_at, updated_at FROM records').all();
  const recordAttachments = db.prepare('SELECT id, module_slug, record_id, upload_id, tipo, created_at FROM record_attachments').all();
  const uploadRows = db.prepare('SELECT id, original_name, stored_name, mime_type, size, uploaded_by, created_at FROM uploads').all();
  // Byte veri inclusi qui, non solo il riferimento — sia per i file locali
  // (letti da disco) sia per quelli su Drive (scaricati ora): un ripristino
  // su un tenant/account Google diverso non potrebbe comunque accedere al
  // fileId originale, quindi i byte vanno portati con sé, non ri-referenziati.
  // Un file mancante o un download Drive fallito non deve bloccare l'intero
  // backup: si annota l'errore sulla singola riga e si continua.
  const uploads = await Promise.all(uploadRows.map(async (u) => {
    try {
      let buffer;
      if (u.stored_name.startsWith('drive:')) {
        buffer = await driveDownload(u.stored_name.slice(6));
      } else {
        buffer = fs.readFileSync(path.join(UPLOAD_DIR, u.stored_name));
      }
      return { ...u, data_base64: buffer.toString('base64') };
    } catch (e) {
      return { ...u, data_base64: null, error: e.message };
    }
  }));
  const dump = { tenant, exported_at: new Date().toISOString(), modules, records, uploads, record_attachments: recordAttachments };
  const uploadsFalliti = uploads.filter((u) => !u.data_base64).length;
  logAudit(req.user.username, 'backup.export_json', tenant, { modules: modules.length, records: records.length, uploads: uploads.length, uploadsFalliti });
  res.setHeader('Content-Disposition', `attachment; filename="backup-${tenant}-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.json"`);
  res.json(dump);
});

router.post('/import-json', requireAuth, requireAdmin, async (req, res) => {
  const { modules, records, uploads, record_attachments: recordAttachments } = req.body || {};
  if (!Array.isArray(modules) || !Array.isArray(records)) {
    return res.status(400).json({ error: 'Formato non valido: attesi { modules: [], records: [] }' });
  }
  // Gli allegati (uploads/record_attachments) sono opzionali per compatibilità
  // con backup più vecchi che non li includevano ancora — un import di un
  // backup pre-allegati deve continuare a funzionare, solo senza restituirli.
  const uploadsIn = Array.isArray(uploads) ? uploads : [];
  const attachmentsIn = Array.isArray(recordAttachments) ? recordAttachments : [];

  // I file vanno scritti su disco PRIMA della transazione DB (operazione non
  // transazionale, non SQL) — se un file fallisce a scriversi si annota e si
  // prosegue con gli altri, un solo allegato rotto non deve bloccare l'intero
  // ripristino. Sempre salvati in locale sul tenant di destinazione, anche se
  // originariamente erano su Drive: un Drive diverso (o nessuno) sul tenant
  // nuovo non potrebbe comunque riusare il fileId originale.
  let uploadsRipristinati = 0, uploadsFalliti = 0;
  const uploadRowsToInsert = [];
  for (const u of uploadsIn) {
    if (!u.data_base64) { uploadsFalliti++; continue; }
    try {
      const buffer = Buffer.from(u.data_base64, 'base64');
      const storedName = await saveUploadBuffer(buffer, u.original_name, u.mime_type);
      uploadRowsToInsert.push({ ...u, stored_name: storedName });
      uploadsRipristinati++;
    } catch (e) {
      uploadsFalliti++;
    }
  }

  const importTx = db.transaction(() => {
    let moduliCreati = 0;
    modules.forEach((m) => {
      const exists = db.prepare('SELECT id FROM modules WHERE slug = ?').get(m.slug);
      if (!exists) {
        db.prepare(`INSERT INTO modules (name, slug, icon, color, group_name, sort_order, schema_json, support_module, quick_toggle, installed)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          m.name, m.slug, m.icon || 'box', m.color || '#2563EB', m.group_name || null,
          m.sort_order || 99, m.schema_json || '{}', m.support_module ? 1 : 0, m.quick_toggle !== undefined ? (m.quick_toggle ? 1 : 0) : 1, m.installed !== undefined ? (m.installed ? 1 : 0) : 1
        );
        moduliCreati++;
      }
    });
    const slugsPresenti = [...new Set(records.map((r) => r.module_slug))];
    slugsPresenti.forEach((slug) => db.prepare('DELETE FROM records WHERE module_slug = ?').run(slug));
    const insert = db.prepare('INSERT INTO records (id, module_slug, user_id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
    records.forEach((r) => {
      insert.run(r.id, r.module_slug, r.user_id || null, typeof r.data === 'string' ? r.data : JSON.stringify(r.data), r.created_at, r.updated_at);
    });

    // uploads.id è referenziato per valore dentro records.data (campi tipo
    // allegato salvano {id, name, ...}) e da record_attachments.upload_id —
    // va preservato esplicitamente sull'insert, non lasciato autoincrement,
    // altrimenti ogni riferimento esistente punterebbe a un id sbagliato.
    if (uploadRowsToInsert.length > 0) {
      db.exec('DELETE FROM record_attachments');
      db.exec('DELETE FROM uploads');
      const insertUpload = db.prepare(
        'INSERT INTO uploads (id, original_name, stored_name, mime_type, size, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      );
      uploadRowsToInsert.forEach((u) => {
        insertUpload.run(u.id, u.original_name, u.stored_name, u.mime_type || null, u.size || null, u.uploaded_by || null, u.created_at);
      });
      const insertAttachment = db.prepare(
        'INSERT INTO record_attachments (id, module_slug, record_id, upload_id, tipo, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      );
      attachmentsIn.forEach((a) => {
        // Un attachment il cui upload non è stato ripristinato (fallito sopra)
        // verrebbe rifiutato dal vincolo REFERENCES uploads(id) — saltato, non
        // deve far fallire l'intero ripristino per un solo file rotto.
        if (uploadRowsToInsert.some((u) => u.id === a.upload_id)) {
          insertAttachment.run(a.id, a.module_slug, a.record_id, a.upload_id, a.tipo || null, a.created_at);
        }
      });
    }

    return { moduliCreati, recordRipristinati: records.length, moduliInteressati: slugsPresenti.length, uploadsRipristinati, uploadsFalliti };
  });
  try {
    const result = importTx();
    logAudit(req.user.username, 'backup.import_json', process.env.TENANT_SLUG || 'tenant', result);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ error: 'Import fallito: ' + e.message });
  }
});

module.exports = router;
