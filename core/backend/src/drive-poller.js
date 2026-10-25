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
//
// Sottocartelle = cartelle viste nell'app (richiesto dall'utente il
// 25/10/2026: "vorrei vedere una cartella Finance e relative sottocartelle
// come le vedo in modulo documenti"): un file trovato dentro una sottocartella
// di Drive che corrisponde a un valore vero del campo "cartella" del modulo
// prende quel valore; e ad ogni giro, ogni record con cartella e file già
// collegati viene spostato nella sottocartella Drive giusta se non c'è già —
// così sia i file nuovi sia quelli caricati prima (o la cui cartella è
// cambiata dopo) finiscono allineati, senza bisogno di agganciarsi alla
// creazione/modifica dei record (resterebbe generico: nessuna logica Drive
// dentro routes/records.js).
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

// Una sottocartella Drive il cui nome non è ancora un'opzione vera del campo
// "cartella" diventa una — anche se è vuota (richiesto dall'utente il
// 25/10/2026: "voglio anche le cartelle vuote syncate"): senza questo,
// un'opzione nuova esisterebbe solo quando arriva il primo file dentro, mai
// prima. Stessa rotta reale del Builder/ArchiveView (POST /field-options,
// azione "add"): stessa convalida (nome non doppio, ≤60 caratteri), stessa
// cronologia di pubblicazione. Ritorna i nomi aggiunti con successo, per
// aggiornare subito le opzioni note in questo stesso giro del poller.
async function registraCartelleNuove(m, cartelleTrovate) {
  if (!m.folderField) return [];
  const opzioni = new Set((m.folderField.options || []).map((o) => (typeof o === 'string' ? o : o.value)));
  const nuove = [...new Set(cartelleTrovate)].filter((c) => c && !opzioni.has(c));
  if (!nuove.length) return [];
  const { callAs } = require('./lib/internal-api');
  const db2 = require('./db');
  const admin = db2.prepare("SELECT * FROM users WHERE role = 'admin' LIMIT 1").get();
  if (!admin) return [];
  const aggiunte = [];
  for (const nome of nuove) {
    try {
      const r = await callAs(admin, 'POST', '/field-options/' + m.slug + '/' + m.folderField.key, { action: 'add', value: nome });
      if (r.ok) aggiunte.push(nome); else console.error('[drive-poller] cartella "' + nome + '" non registrata:', JSON.stringify(r.data));
    } catch (e) {
      console.error('[drive-poller] cartella "' + nome + '" non registrata:', e.message);
    }
  }
  return aggiunte;
}

// Un documento con un file già su Drive ma senza cartella resta nella radice
// per sempre (organizza(), sotto, sposta solo chi ha già una cartella valida)
// — richiesto dall'utente il 25/10/2026: "in drive ci sono file nella root,
// vanno sistemati". Finisce in "Altro" (il catch-all già tra le opzioni:
// mai inventato un valore a caso se "Altro" non è dichiarato). Solo i file
// SU DRIVE: uno locale non ha nessun problema di posizione da correggere.
async function assegnaCartellaPredefinita(m) {
  if (!m.folderField) return 0;
  const opzioni = (m.folderField.options || []).map((o) => (typeof o === 'string' ? o : o.value));
  if (!opzioni.includes('Altro')) return 0;
  const righe = db.prepare('SELECT id, data FROM records WHERE module_slug = ?').all(m.slug).map((r) => ({ id: r.id, data: JSON.parse(r.data) }));
  const { callAs } = require('./lib/internal-api');
  const admin = db.prepare("SELECT * FROM users WHERE role = 'admin' LIMIT 1").get();
  let assegnati = 0;
  for (const r of righe) {
    const file = r.data[m.fileField.key];
    const cartella = m.folderField ? r.data[m.folderField.key] : undefined;
    if (cartella || !file || !file.id) continue;
    const up = db.prepare('SELECT stored_name FROM uploads WHERE id = ?').get(file.id);
    if (!up || !up.stored_name || !up.stored_name.startsWith('drive:')) continue;
    try {
      const resu = await callAs(admin, 'PUT', '/records/' + m.slug + '/' + r.id, { ...r.data, [m.folderField.key]: 'Altro' });
      if (resu.ok) assegnati++; else console.error('[drive-poller] cartella predefinita non assegnata al record', r.id, ':', JSON.stringify(resu.data));
    } catch (e) {
      console.error('[drive-poller] cartella predefinita non assegnata al record', r.id, ':', e.message);
    }
  }
  return assegnati;
}

// Sposta nella sottocartella Drive giusta ogni record che ha sia una cartella
// sia un file su Drive, se non ci sta già (letto dalla stessa scansione
// dell'albero, `posizioneAttuale`: nessuna chiamata Drive in più solo per
// controllare). Un record senza cartella (campo vuoto) resta dov'è, di solito
// la cartella del tenant — nessuna sottocartella "vuota" da inventare.
async function organizza(m, posizioneAttuale) {
  if (!m.folderField) return 0;
  const { ensureDriveSubfolder, driveMoveFile } = require('./routes/google-oauth');
  const opzioni = new Set((m.folderField.options || []).map((o) => (typeof o === 'string' ? o : o.value)));
  const righe = db.prepare("SELECT id, data FROM records WHERE module_slug = ?").all(m.slug).map((r) => ({ id: r.id, data: JSON.parse(r.data) }));
  let spostati = 0;
  for (const r of righe) {
    const cartella = r.data[m.folderField.key];
    const file = r.data[m.fileField.key];
    if (!cartella || !opzioni.has(cartella) || !file || !file.id) continue;
    const up = db.prepare('SELECT stored_name FROM uploads WHERE id = ?').get(file.id);
    if (!up || !up.stored_name || !up.stored_name.startsWith('drive:')) continue; // su disco locale, niente da spostare su Drive
    const driveId = up.stored_name.slice(6);
    if (posizioneAttuale.get(driveId) === cartella) continue; // già nella sottocartella giusta
    try {
      const subfolderId = await ensureDriveSubfolder(cartella);
      await driveMoveFile(driveId, subfolderId);
      spostati++;
    } catch (e) {
      console.error('[drive-poller] spostamento del file del record', r.id, 'in "' + cartella + '" fallito:', e.message);
    }
  }
  return spostati;
}

// Ritorna sempre un esito tipizzato (mai solo side-effect silenzioso): usato
// sia dallo scheduler sotto sia dal pulsante "Sincronizza" in Documenti
// (routes/drive-poller.js), che altrimenti non avrebbe nulla da mostrare.
async function pollDrive() {
  const { isDriveEnabled, ensureDriveFolder, driveListTree } = require('./routes/google-oauth');
  if (!isDriveEnabled()) return { disponibile: false };
  const m = moduloArchivio();
  if (!m) return { disponibile: false }; // nessun archivio dichiarato, o più di uno: niente da fare

  let files, cartelleTrovate;
  try {
    const folderId = await ensureDriveFolder();
    ({ files, cartelle: cartelleTrovate } = await driveListTree(folderId));
  } catch (e) {
    console.error('[drive-poller] elenco file Drive fallito:', e.message);
    return { disponibile: true, errore: e.message };
  }

  const cartelleRegistrate = await registraCartelleNuove(m, cartelleTrovate);
  if (cartelleRegistrate.length) console.log('[drive-poller] nuove cartelle registrate:', cartelleRegistrate.join(', '));

  const noti = db.prepare("SELECT stored_name FROM uploads WHERE stored_name LIKE 'drive:%'").all().map((r) => r.stored_name.slice(6));
  const conosciuti = new Set(noti);
  const opzioniCartella = new Set([...(m.folderField && m.folderField.options || []).map((o) => (typeof o === 'string' ? o : o.value)), ...cartelleRegistrate]);
  const nuovi = files.filter((f) => !conosciuti.has(f.id) && !nonImportabile(f.mimeType));

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
      if (m.folderField && f.cartella && opzioniCartella.has(f.cartella)) data[m.folderField.key] = f.cartella;

      const result = db.prepare('INSERT INTO records (module_slug, user_id, data) VALUES (?, ?, ?)').run(m.slug, ownerId, JSON.stringify(data));
      try { fireTrigger(m.slug, 'nuovo_record', data, result.lastInsertRowid, {}); } catch (e) { console.error('[drive-poller] fireTrigger fallito:', e.message); }
      importati++;
    } catch (e) {
      console.error('[drive-poller] file', f.name, 'non importato:', e.message);
    }
  }
  if (importati) console.log('[drive-poller] ' + importati + ' file nuovi trovati su Drive, importati in "' + m.slug + '"');

  const assegnati = await assegnaCartellaPredefinita(m);
  if (assegnati) console.log('[drive-poller] ' + assegnati + ' documenti senza cartella messi in "Altro"');

  const posizioneAttuale = new Map(files.map((f) => [f.id, f.cartella]));
  const spostati = await organizza(m, posizioneAttuale);
  if (spostati) console.log('[drive-poller] ' + spostati + ' file spostati nella sottocartella Drive giusta');

  return { disponibile: true, importati, spostati, assegnati, cartelle_nuove: cartelleRegistrate, modulo: m.slug };
}

function startDrivePoller() {
  setTimeout(() => pollDrive().catch((e) => console.error('[drive-poller]', e.message)), 90 * 1000);
  setInterval(() => pollDrive().catch((e) => console.error('[drive-poller]', e.message)), 15 * 60 * 1000);
}

module.exports = { startDrivePoller, pollDrive, moduloArchivio };
