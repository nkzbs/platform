'use strict';
// Gli allegati di un record, per gli adattatori che devono LEGGERE un documento (da mandare a un servizio) o SALVARNE uno (che il servizio restituisce): il documento firmato, una ricevuta.
// Stessa tabella e stesso deposito dei file caricati dalla scheda (uploads + record_attachments, locale o Drive): nessun posto nuovo dove guardare.
const fs = require('fs');
const path = require('path');
const db = require('../../db');
const { saveUploadBuffer, UPLOAD_DIR } = require('../upload-storage');

// L'ultimo allegato di quel tipo: { buffer, nome, mime } oppure null.
async function leggi(slug, id, tipo) {
  const r = db.prepare('SELECT u.* FROM record_attachments a JOIN uploads u ON u.id = a.upload_id WHERE a.module_slug = ? AND a.record_id = ? AND a.tipo = ? ORDER BY a.id DESC LIMIT 1').get(slug, id, tipo);
  if (!r) return null;
  let buffer;
  if (String(r.stored_name).startsWith('drive:')) buffer = await require('../google-oauth').driveDownload(r.stored_name.slice(6));
  else { const f = path.join(UPLOAD_DIR, r.stored_name); if (!fs.existsSync(f)) return null; buffer = fs.readFileSync(f); }
  return { buffer, nome: r.original_name, mime: r.mime_type };
}

// Salva un file e lo allega al record con quel tipo. Ritorna l'id dell'upload.
async function salva({ slug, id, buffer, nome, mime, tipo, utenteId }) {
  const stored = await saveUploadBuffer(buffer, nome, mime);
  const up = db.prepare('INSERT INTO uploads (original_name, stored_name, mime_type, size, uploaded_by) VALUES (?, ?, ?, ?, ?)').run(nome, stored, mime, buffer.length, utenteId || null).lastInsertRowid;
  db.prepare('INSERT INTO record_attachments (module_slug, record_id, upload_id, tipo) VALUES (?, ?, ?, ?)').run(slug, id, up, tipo || null);
  return up;
}

// I dati di un record collegato tramite una relazione del record: { slug, id, dati } oppure null.
function collegato(slug, dati, chiaveRelazione) {
  const m = db.prepare('SELECT schema_json FROM modules WHERE slug = ?').get(slug); if (!m) return null;
  let s; try { s = JSON.parse(m.schema_json || '{}'); } catch (e) { return null; }
  const rel = (s.steps || []).find((b) => b.block_type === 'relation' && b.key === chiaveRelazione); const idc = dati[chiaveRelazione];
  if (!rel || !idc) return null;
  const r = db.prepare('SELECT id, data FROM records WHERE id = ? AND module_slug = ?').get(idc, rel.target_module); if (!r) return null;
  try { return { slug: rel.target_module, id: r.id, dati: JSON.parse(r.data) }; } catch (e) { return null; }
}

module.exports = { leggi, salva, collegato };
