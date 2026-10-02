'use strict';
// Punto unico di scrittura di un allegato — usato sia da routes/uploads.js
// (upload manuale dell'utente) sia da gmail-poller.js (allegati email
// smistati automaticamente), così il modulo extra "Drive" (vedi
// routes/google-oauth.js: isDriveEnabled/driveUpload) si applica ovunque un
// file viene salvato, non solo a metà dei casi.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../db');
const { isDriveEnabled, driveUpload, driveDelete } = require('../routes/google-oauth');

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join('/data/uploads', process.env.TENANT_SLUG || 'default');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function writeLocal(buffer, originalName) {
  const safeExt = path.extname(originalName).slice(0, 10).replace(/[^a-zA-Z0-9.]/g, '');
  const storedName = crypto.randomUUID() + safeExt;
  fs.writeFileSync(path.join(UPLOAD_DIR, storedName), buffer);
  return storedName;
}

// Ritorna il valore da salvare in uploads.stored_name — "drive:<fileId>" se il
// modulo Drive è attivo, altrimenti un nome file locale come sempre.
async function saveUploadBuffer(buffer, originalName, mimeType) {
  return isDriveEnabled()
    ? 'drive:' + await driveUpload(buffer, originalName, mimeType)
    : writeLocal(buffer, originalName);
}

// Cancella il file fisico (locale o Drive) E la riga in uploads — punto unico
// di cancellazione, come saveUploadBuffer lo è per la scrittura. Usata sia
// dalla route generica DELETE /uploads/:id sia da records.js quando si
// rimuove un allegato o un intero record: prima NESSUNO dei due ripuliva
// mai il file sottostante, restava orfano per sempre (su disco, o peggio su
// Drive dove si accumula visibilmente nella cartella dell'utente). Non
// lancia se il file è già assente — stesso principio "va bene così" già
// usato altrove.
async function deleteUploadById(id) {
  const row = db.prepare('SELECT * FROM uploads WHERE id = ?').get(id);
  if (!row) return;
  if (row.stored_name.startsWith('drive:')) {
    try { await driveDelete(row.stored_name.slice(6)); } catch (e) {}
  } else {
    const filePath = path.join(UPLOAD_DIR, row.stored_name);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
  db.prepare('DELETE FROM uploads WHERE id = ?').run(id);
}

module.exports = { saveUploadBuffer, deleteUploadById, UPLOAD_DIR };
