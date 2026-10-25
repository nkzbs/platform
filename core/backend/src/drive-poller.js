'use strict';
// ─── POLLER GOOGLE DRIVE ────────────────────────────────────────────────────
// Ogni 15 minuti (stesso ritmo del poller Gmail): guarda cosa c'è nella cartella
// Drive dedicata al tenant e, per ogni file che Platform non conosce ancora
// (nessuna riga 'uploads' con quello stesso id Drive — stessa è la condizione
// che lo rende "nuovo" sia che l'abbia caricato l'utente dall'app Drive, sia
// che sia il primo controllo dopo l'attivazione), crea un record nel modulo ad
// archivio (vedi moduloArchivio sotto) col file già allegato — bidirezionale
// "richiesto dall'utente il 25/10/2026: così carico i file da app Google drive".
//
// Un file caricato DA Platform stessa (routes/uploads.js, gmail-poller.js) ha
// già la sua riga 'uploads' con stored_name = 'drive:<id>' PRIMA che questo
// poller lo veda: non viene mai reimportato. Niente tabella di "già visti" a
// parte — la tabella uploads è già l'elenco di ciò che Platform conosce.
const db = require('./db');
const { fireTrigger } = require('./automation-engine');

// Lo stesso modulo che ModulePage/ArchiveView.jsx riconosce da solo come "ad
// archivio" (nessun nome di modulo o di campo scritto qui): list_view
// 'archive' con un campo file. Con più moduli così dichiarati (raro: un
// tenant con un solo archivio è il caso comune) non si indovina quale sia
// quello giusto — meglio niente importazione automatica che in uno sbagliato.
function moduloArchivio() {
  const { parseSchemaNormalized } = require('./schema-v3');
  const mods = db.prepare("SELECT slug, schema_json FROM modules WHERE installed = 1 AND list_view = 'archive'").all();
  const candidati = mods
    .map((m) => ({ slug: m.slug, fields: parseSchemaNormalized(m.schema_json).fields || [] }))
    .map((m) => {
      const fileField = m.fields.find((f) => f.type === 'file');
      const folderField = m.fields.find((f) => f.type === 'select');
      // Stessa identica scelta di ModulePage/ArchiveView.jsx: primo campo testo
      // diverso dalla cartella, altrimenti il primo campo in assoluto.
      const titleField = m.fields.find((f) => f.type === 'text' && f.key !== (folderField && folderField.key)) || m.fields[0];
      const dateField = m.fields.find((f) => f.type === 'date');
      return { slug: m.slug, fileField, folderField, titleField, dateField };
    })
    .filter((m) => m.fileField);
  return candidati.length === 1 ? candidati[0] : null;
}

// I tipi nativi di Google (Documenti, Fogli…) non sono file scaricabili come
// byte (serve "export", non "download"): si saltano, non si cerca di
// archiviarli a metà. Le cartelle dentro la cartella del tenant si ignorano
// allo stesso modo (un solo livello, come il resto dell'integrazione Drive).
function nonImportabile(mimeType) {
  return mimeType === 'application/vnd.google-apps.folder' || String(mimeType || '').startsWith('application/vnd.google-apps.');
}

async function pollDrive() {
  const { isDriveEnabled, ensureDriveFolder, driveListFiles } = require('./routes/google-oauth');
  if (!isDriveEnabled()) return;
  const m = moduloArchivio();
  if (!m) return; // nessun archivio dichiarato, o più di uno: niente da fare

  let files;
  try {
    const folderId = await ensureDriveFolder();
    files = await driveListFiles(folderId);
  } catch (e) {
    console.error('[drive-poller] elenco file Drive fallito:', e.message);
    return;
  }

  const noti = db.prepare("SELECT stored_name FROM uploads WHERE stored_name LIKE 'drive:%'").all().map((r) => r.stored_name.slice(6));
  const conosciuti = new Set(noti);
  const nuovi = files.filter((f) => !conosciuti.has(f.id) && !nonImportabile(f.mimeType));
  if (!nuovi.length) return;

  const ownerId = require('./record-owner').ownerFor(null, m.slug);
  let importati = 0;
  for (const f of nuovi) {
    try {
      const uploadId = db.prepare('INSERT INTO uploads (original_name, stored_name, mime_type, size, uploaded_by) VALUES (?, ?, ?, ?, ?)')
        .run(f.name, 'drive:' + f.id, f.mimeType || 'application/octet-stream', parseInt(f.size, 10) || 0, null).lastInsertRowid;
      const titolo = f.name.replace(/\.[^.]+$/, '');
      const data = { [m.fileField.key]: { id: uploadId, name: f.name, size: parseInt(f.size, 10) || 0, mime_type: f.mimeType || 'application/octet-stream' } };
      if (m.titleField) data[m.titleField.key] = titolo;
      if (m.dateField) data[m.dateField.key] = (f.createdTime || '').slice(0, 10) || new Date().toISOString().slice(0, 10);

      const result = db.prepare('INSERT INTO records (module_slug, user_id, data) VALUES (?, ?, ?)').run(m.slug, ownerId, JSON.stringify(data));
      try { fireTrigger(m.slug, 'nuovo_record', data, result.lastInsertRowid, {}); } catch (e) { console.error('[drive-poller] fireTrigger fallito:', e.message); }
      importati++;
    } catch (e) {
      console.error('[drive-poller] file', f.name, 'non importato:', e.message);
    }
  }
  if (importati) console.log('[drive-poller] ' + importati + ' file nuovi trovati su Drive, importati in "' + m.slug + '"');
}

function startDrivePoller() {
  setTimeout(() => pollDrive().catch((e) => console.error('[drive-poller]', e.message)), 90 * 1000);
  setInterval(() => pollDrive().catch((e) => console.error('[drive-poller]', e.message)), 15 * 60 * 1000);
}

module.exports = { startDrivePoller, pollDrive, moduloArchivio };
