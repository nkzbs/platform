const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const Database = require('better-sqlite3');
const db = require('../db');
const { requireAuth } = require('./auth');
const { logAudit } = require('../audit-log');

// Registrare un tenant che esiste già (container e dati creati altrove, o
// ereditati da un Super Admin precedente) senza ricrearlo: la riga in `tenants`
// riusa le sue chiavi originali, quindi i campi cifrati del suo DB restano
// leggibili. Nessun container viene toccato qui — il tenant nasce 'stopped' e si
// avvia da /:slug/start (che ricrea il container sullo stesso volume dati).
//
// Due strade:
//  - importa da un vecchio super-admin.db: si carica il file, si spuntano i tenant,
//    chiavi comprese (copiate lato server, mai rimandate al browser);
//  - registrazione manuale: nome, slug, porta, percorso DB, chiave di cifratura.
const router = express.Router();

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
const IMPORT_TTL_MS = 15 * 60 * 1000;
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

// Solo queste colonne vengono copiate da un vecchio DB: tutto il resto (licenze,
// fatturazione, partner, federazione...) non esiste più. backup_offsite_* resta
// fuori di proposito: le credenziali sono cifrate con la chiave del vecchio Super
// Admin e qui non sarebbero decifrabili — vanno reinserite dalle impostazioni backup.
const IMPORTABLE_COLUMNS = [
  'name', 'slug', 'port', 'db_path', 'domain', 'categoria', 'encryption_key', 'jwt_secret',
  'auto_update_enabled', 'backup_auto_enabled', 'backup_auto_frequency_hours', 'backup_auto_retention',
];

const imports = new Map(); // import_id -> { file, expires }

function forget(importId) {
  const entry = imports.get(importId);
  if (!entry) return;
  imports.delete(importId);
  fs.rm(entry.file, { force: true }, () => {});
}

function sweepExpired() {
  const now = Date.now();
  for (const [id, entry] of imports) if (entry.expires < now) forget(id);
}

const upload = multer({
  dest: path.join(os.tmpdir(), 'platform-import'),
  limits: { fileSize: MAX_UPLOAD_BYTES },
});

function openOldDb(file) {
  const old = new Database(file, { readonly: true, fileMustExist: true });
  const cols = old.prepare('PRAGMA table_info(tenants)').all().map((c) => c.name);
  for (const required of ['name', 'slug', 'port', 'db_path']) {
    if (!cols.includes(required)) {
      old.close();
      throw Object.assign(new Error('Non sembra un super-admin.db di Platform: nella tabella tenants manca la colonna "' + required + '"'), { status: 400 });
    }
  }
  return { old, cols };
}

function describeTenant(row, cols) {
  return {
    slug: row.slug,
    name: row.name,
    port: row.port,
    domain: cols.includes('domain') ? row.domain : null,
    db_path: row.db_path,
    has_encryption_key: !!(cols.includes('encryption_key') && row.encryption_key),
    already_registered: !!db.prepare('SELECT 1 FROM tenants WHERE slug = ?').get(row.slug),
    port_in_use: !!db.prepare('SELECT 1 FROM tenants WHERE port = ?').get(row.port),
  };
}

// POST /import/preview — carica il vecchio super-admin.db, risponde con l'elenco
// dei tenant trovati. Il file resta sul server (cancellato dopo 15 minuti o dopo
// l'importazione); mai segreti nella risposta, solo se la chiave c'è o no.
router.post('/import/preview', requireAuth, (req, res) => {
  sweepExpired();
  upload.single('file')(req, res, (uploadErr) => {
    if (uploadErr) return res.status(400).json({ error: 'Caricamento fallito: ' + uploadErr.message });
    if (!req.file) return res.status(400).json({ error: 'Nessun file ricevuto' });
    let opened;
    try {
      opened = openOldDb(req.file.path);
      const rows = opened.old.prepare("SELECT * FROM tenants WHERE status != 'deleted' ORDER BY slug").all();
      const importId = crypto.randomBytes(16).toString('hex');
      imports.set(importId, { file: req.file.path, expires: Date.now() + IMPORT_TTL_MS });
      res.json({ import_id: importId, tenants: rows.map((r) => describeTenant(r, opened.cols)) });
    } catch (err) {
      fs.rm(req.file.path, { force: true }, () => {});
      res.status(err.status || 400).json({ error: err.status ? err.message : 'File non leggibile come database SQLite: ' + err.message });
    } finally {
      if (opened) opened.old.close();
    }
  });
});

// POST /import { import_id, slugs[] } — registra i tenant scelti come 'stopped'.
router.post('/import', requireAuth, (req, res) => {
  const { import_id, slugs } = req.body || {};
  const entry = imports.get(import_id);
  if (!entry || entry.expires < Date.now()) {
    forget(import_id);
    return res.status(400).json({ error: 'Importazione scaduta: ricarica il file' });
  }
  if (!Array.isArray(slugs) || slugs.length === 0) return res.status(400).json({ error: 'Seleziona almeno un tenant' });

  let opened;
  try {
    opened = openOldDb(entry.file);
    const results = [];
    for (const slug of slugs) {
      const row = opened.old.prepare('SELECT * FROM tenants WHERE slug = ?').get(slug);
      if (!row) { results.push({ slug, ok: false, error: 'Non presente nel file' }); continue; }
      if (!SLUG_RE.test(row.slug)) { results.push({ slug, ok: false, error: 'Slug non valido' }); continue; }
      if (db.prepare('SELECT 1 FROM tenants WHERE slug = ?').get(row.slug)) { results.push({ slug, ok: false, error: 'Già registrato' }); continue; }
      if (db.prepare('SELECT 1 FROM tenants WHERE port = ?').get(row.port)) { results.push({ slug, ok: false, error: 'La porta ' + row.port + ' è già usata da un altro tenant' }); continue; }
      if (!row.encryption_key) { results.push({ slug, ok: false, error: 'Nel file questo tenant non ha una chiave di cifratura: usa la registrazione manuale' }); continue; }

      const cols = IMPORTABLE_COLUMNS.filter((c) => opened.cols.includes(c) && row[c] !== undefined);
      const values = cols.map((c) => row[c]);
      db.prepare('INSERT INTO tenants (' + cols.join(', ') + ", status) VALUES (" + cols.map(() => '?').join(', ') + ", 'stopped')").run(...values);
      logAudit(req.user.username, 'tenant.import', row.slug, { from: 'super-admin.db', port: row.port });
      results.push({ slug: row.slug, ok: true });
    }
    forget(import_id);
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    if (opened) opened.old.close();
  }
});

// POST /register — registrazione manuale.
router.post('/register', requireAuth, (req, res) => {
  const { name, slug, port, db_path, domain, encryption_key, jwt_secret } = req.body || {};
  if (!name || !slug) return res.status(400).json({ error: 'Nome e slug obbligatori' });
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) {
    return res.status(400).json({ error: 'Slug non valido: solo lettere minuscole, numeri e trattini, senza spazi' });
  }
  const portNum = parseInt(port, 10);
  if (!Number.isInteger(portNum) || portNum < 1024 || portNum > 65535) {
    return res.status(400).json({ error: 'Porta non valida (1024-65535)' });
  }
  if (!encryption_key || String(encryption_key).length < 8) {
    return res.status(400).json({ error: 'La chiave di cifratura esistente è obbligatoria: senza, i campi cifrati del tenant non si leggono' });
  }
  if (db.prepare('SELECT 1 FROM tenants WHERE slug = ?').get(slug)) return res.status(400).json({ error: 'Slug "' + slug + '" già in uso' });
  if (db.prepare('SELECT 1 FROM tenants WHERE port = ?').get(portNum)) return res.status(400).json({ error: 'La porta ' + portNum + ' è già usata da un altro tenant' });

  const dbPath = (db_path && String(db_path).trim()) || '/data/' + slug + '.db';
  const cleanDomain = domain ? String(domain).trim().toLowerCase() : null;
  // Senza JWT_SECRET originale le sessioni già aperte decadono (si rifà il login):
  // innocuo, a differenza della chiave di cifratura.
  const jwt = (jwt_secret && String(jwt_secret).trim()) || crypto.randomBytes(32).toString('hex');
  db.prepare("INSERT INTO tenants (name, slug, port, db_path, status, domain, encryption_key, jwt_secret) VALUES (?, ?, ?, ?, 'stopped', ?, ?, ?)")
    .run(String(name).trim(), slug, portNum, dbPath, cleanDomain, String(encryption_key).trim(), jwt);
  logAudit(req.user.username, 'tenant.register', slug, { port: portNum, db_path: dbPath });
  res.json({ slug, status: 'stopped' });
});

module.exports = router;
