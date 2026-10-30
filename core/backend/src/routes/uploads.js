const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const { requireAuth } = require('./auth');
const { driveDownload } = require('./google-oauth');
const { saveUploadBuffer, deleteUploadById, UPLOAD_DIR } = require('../lib/upload-storage');
const { parseSchemaNormalized } = require('../schema-v3');
const { ruleFor, ownedOrAllowed } = require('../permissions');
// G7 (PLATFORM-0.6-GAP-ANALYSIS.md) — whitelist di tipo file: prima solo il limite di
// dimensione, nessun controllo su COSA veniva caricato. Logica in un modulo a sé
// (upload-mime-whitelist.js, zero dipendenze) per essere testabile come funzione pura
// — vedi uploads.test.js (F0.1.7.1.D2, PLATFORM-MASTER-ROADMAP.md).
const { isAllowedUploadMime, isInlineSafeMime, contentDisposition } = require('../upload-mime-whitelist');

const router = express.Router();

const MAX_SIZE = 20 * 1024 * 1024; // 20MB, ragionevole per allegati di documenti/fatture

// Sempre in memoria, mai scritto su disco direttamente da multer: la scelta
// disco-vs-Drive (vedi lib/upload-storage.js) si decide DOPO, per richiesta —
// isDriveEnabled può cambiare da un momento all'altro, non è fissabile una
// volta sola all'avvio del server.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE },
  fileFilter(req, file, cb) {
    if (!isAllowedUploadMime(file.mimetype)) return cb(new Error('Tipo di file non consentito: ' + file.mimetype));
    cb(null, true);
  },
});

// Multer chiama `next(err)` sia per fileFilter sia per dimensione superata —
// senza questo wrapper l'errore cadrebbe nel gestore generico di index.js,
// che risponde sempre 500 "Errore interno": qui invece resta un vero 400 con
// il messaggio reale (tipo file rifiutato, o dimensione oltre i 20MB).
function uploadSingle(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}

router.post('/', requireAuth, uploadSingle, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nessun file ricevuto' });
  try {
    const storedName = await saveUploadBuffer(req.file.buffer, req.file.originalname, req.file.mimetype);
    const result = db.prepare(
      'INSERT INTO uploads (original_name, stored_name, mime_type, size, uploaded_by) VALUES (?, ?, ?, ?, ?)'
    ).run(req.file.originalname, storedName, req.file.mimetype, req.file.size, req.user.id);
    res.json({ id: result.lastInsertRowid, name: req.file.originalname, size: req.file.size, mime_type: req.file.mimetype });
  } catch (e) {
    res.status(502).json({ error: 'Salvataggio su Drive fallito: ' + e.message });
  }
});

// Falla reale trovata il 2026-10-14 (segnalata dall'utente, mai verificata
// prima): GET e DELETE qui sotto avevano solo requireAuth — qualunque utente
// autenticato poteva leggere o cancellare QUALUNQUE allegato di QUALUNQUE
// record indovinando l'id, bypassando del tutto "solo propri" (già rispettato
// dalla lettura/cancellazione del record stesso). Un upload è accessibile se:
// (a) l'ha caricato chi chiede (uploaded_by, vale anche prima che sia
// collegato a un record — la finestra tra POST /uploads e POST .../attachments),
// oppure (b) è collegato a record_attachments su un record che il ruolo di chi
// chiede può vedere (GET) o modificare (DELETE), secondo la stessa regola già
// in uso per i record (permissions.js). Un upload non suo e non ancora
// collegato a niente non è leggibile da nessun altro, admin incluso: non c'è
// un record la cui regola di permesso possa autorizzarlo.
function getModuleSchema(slug) {
  const mod = db.prepare('SELECT schema_json FROM modules WHERE slug = ?').get(slug);
  if (!mod) return null;
  return parseSchemaNormalized(mod.schema_json);
}
// Un campo di tipo 'file' (es. il File di un documento in Documenti, o di
// qualunque altro modulo-archivio) salva il riferimento all'upload dentro
// data[chiave] = {id, ...} del record stesso — un collegamento reale quanto
// record_attachments, solo mai controllato qui sotto fino al 30/10/2026 (bug
// trovato dal vivo: un documento importato da Drive, caricato da nessun
// utente specifico, era illeggibile da chiunque, "Non hai i permessi" anche
// per l'admin). Cerca fra i moduli installati con almeno un campo file
// quello/i record il cui campo file punta a QUESTO upload.
function collegamentiDaCampoFile(uploadId) {
  const moduli = db.prepare('SELECT slug, schema_json FROM modules WHERE installed = 1').all();
  const out = [];
  for (const m of moduli) {
    let schema; try { schema = parseSchemaNormalized(m.schema_json); } catch (e) { continue; }
    const campiFile = (schema.fields || []).filter((f) => f.type === 'file').map((f) => f.key);
    if (!campiFile.length) continue;
    const righe = db.prepare('SELECT id, data FROM records WHERE module_slug = ?').all(m.slug);
    for (const r of righe) {
      let d; try { d = JSON.parse(r.data); } catch (e) { continue; }
      if (campiFile.some((k) => d[k] && d[k].id === uploadId)) out.push({ module_slug: m.slug, record_id: r.id });
    }
  }
  return out;
}

function canAccessUpload(req, row, action) { // action: 'view' | 'edit'
  if (row.uploaded_by === req.user.id) return true;
  const links = [
    ...db.prepare('SELECT module_slug, record_id FROM record_attachments WHERE upload_id = ?').all(row.id),
    ...collegamentiDaCampoFile(row.id),
  ];
  if (links.length === 0) return false;
  return links.every((link) => {
    const record = db.prepare('SELECT * FROM records WHERE id = ? AND module_slug = ?').get(link.record_id, link.module_slug);
    if (!record) return false;
    const rule = ruleFor(getModuleSchema(link.module_slug) || {}, req.user.role);
    if (!rule) return true;
    const permOk = action === 'view' ? rule.view : rule.edit;
    return permOk && ownedOrAllowed(rule, record, req.user);
  });
}

router.get('/:id', requireAuth, async (req, res) => {
  const row = db.prepare('SELECT * FROM uploads WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'File non trovato' });
  if (!canAccessUpload(req, row, 'view')) return res.status(403).json({ error: 'Non hai i permessi per vedere questo allegato' });
  const inline = isInlineSafeMime(row.mime_type);
  res.setHeader('Content-Type', inline ? row.mime_type : 'application/octet-stream');
  res.setHeader('Content-Disposition', contentDisposition(inline ? 'inline' : 'attachment', row.original_name));
  if (row.stored_name.startsWith('drive:')) {
    try {
      res.send(await driveDownload(row.stored_name.slice(6)));
    } catch (e) {
      res.status(502).json({ error: 'Lettura da Drive fallita: ' + e.message });
    }
    return;
  }
  const filePath = path.join(UPLOAD_DIR, row.stored_name);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File mancante su disco' });
  fs.createReadStream(filePath).pipe(res);
});

router.delete('/:id', requireAuth, async (req, res) => {
  const row = db.prepare('SELECT * FROM uploads WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'File non trovato' });
  if (!canAccessUpload(req, row, 'edit')) return res.status(403).json({ error: 'Non hai i permessi per cancellare questo allegato' });
  try {
    await deleteUploadById(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    // Un upload ancora collegato a un record_attachments (vincolo di chiave
    // esterna) mandava in crash l'intero processo — trovato con un test
    // reale, non solo per sospetto: qui non deve più succedere, si risponde
    // con un errore chiaro invece di lasciare che l'eccezione risalga.
    res.status(409).json({ error: 'Impossibile cancellare: il file è ancora collegato a un record. ' + e.message });
  }
});

module.exports = router;
