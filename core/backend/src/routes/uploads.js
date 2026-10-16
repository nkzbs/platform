const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const { requireAuth } = require('./auth');
const { driveDownload } = require('./google-oauth');
const { saveUploadBuffer, deleteUploadById, UPLOAD_DIR } = require('../lib/upload-storage');
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

router.get('/:id', requireAuth, async (req, res) => {
  const row = db.prepare('SELECT * FROM uploads WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'File non trovato' });
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
