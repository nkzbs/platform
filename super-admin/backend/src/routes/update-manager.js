const express = require('express');
const multer = require('multer');
const fs = require('fs');
const os = require('os');
const zlib = require('zlib');
const { Readable } = require('stream');
const db = require('../db');
const { requireAuth, requireQueryToken } = require('./auth');
const { logAudit } = require('../audit-log');
const { internalSecret } = require('../../../../shared/internal-secret.js');

const router = express.Router();
const IMAGE_REPO = 'platform-core';

// G2 (PLATFORM-0.6-GAP-ANALYSIS.md, 2026-08-22) — non più accesso diretto a
// Docker: ogni operazione immagine passa dal docker-provisioner, unico
// servizio con /var/run/docker.sock montato. Le due operazioni a stream
// (export/import) sono l'unico punto davvero diverso dagli altri call site di
// questo refactor — vedi i commenti puntuali sotto.
const PROVISIONER_URL = process.env.PROVISIONER_URL || 'http://docker-provisioner:4000';
const INTERNAL_SECRET = internalSecret();
const provisionerHeaders = { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_SECRET };

async function provisionerRequest(method, path, body) {
  const res = await fetch(PROVISIONER_URL + path, {
    method,
    headers: provisionerHeaders,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.error || 'Operazione immagine fallita'), { status: res.status });
  return data;
}
// 'latest'/'previous' invece dei vecchi IMAGE_NAME/'platform-core:previous' —
// il repo (sempre IMAGE_REPO) resta deciso lato docker-provisioner, qui si
// passa solo il ref, coerente con la validazione fatta lì (vedi G2).
const inspectImage = (ref) => provisionerRequest('GET', '/images/' + ref + '/inspect');
const tagImage = (source, tag) => provisionerRequest('POST', '/images/tag', { source, tag });

// ─── STATO LIVE, MAI FIDATO DA UNO STATO SALVATO ───────────────────────────────
// Causa reale del "dubbio" sull'Update Manager: la pipeline di deploy usata finora
// (SSH manuale: build → save → load sul NAS → retag manuale a :latest) ha già
// causato un incidente vero — retag dimenticato, :latest rimasto fermo 3 ore senza
// che nulla in app se ne accorgesse (vedi STATO_LAVORI.md). Tutto qui sotto legge
// Docker dal vivo invece di fidarsi di una riga DB che potrebbe essere disallineata
// dalla realtà — stessa immagine attualmente in esecuzione, non un ricordo di cosa
// dovrebbe esserci.

// Rileva se :latest è cambiato dall'ultima volta che l'abbiamo vista e, in quel
// caso, preserva la vecchia immagine come :previous PRIMA che vada persa — senza
// che nessuno debba ricordarsi un passaggio manuale in più. Chiamata sia da GET /
// (pagina aperta) sia dallo scheduler notturno (nessuno ha aperto la pagina) così
// il paracadute del rollback esiste indipendentemente da come :latest sia stata
// aggiornata. NON chiamata da /rollback — se lo facesse, :previous non verrebbe
// mai rinfrescato con l'immagine appena scavalcata dal rollback stesso, rendendo
// un secondo rollback un no-op silenzioso: si lascia che sia la prossima chiamata
// passiva (il prossimo GET o tick) a rilevare il cambio, tenendo sempre percorribile
// il ciclo rollback → nuovo redeploy → rollback.
async function capturePreviousImageIfChanged() {
  let current;
  try {
    current = await inspectImage('latest');
  } catch (e) {
    return null; // nessuna platform-core:latest su questo host — stato iniziale, non un errore
  }
  const state = db.prepare('SELECT last_seen_image_id FROM update_manager WHERE id = 1').get();
  if (state.last_seen_image_id && state.last_seen_image_id !== current.Id) {
    try {
      await tagImage(state.last_seen_image_id, 'previous');
    } catch (e) {
      // Immagine precedente non più presente (rimossa/pruned) — nessun rollback
      // disponibile da quel punto, ma non deve bloccare il resto: si logga e si va avanti.
      console.error('update-manager: impossibile preservare l\'immagine precedente per il rollback:', e.message);
    }
  }
  if (state.last_seen_image_id !== current.Id) {
    db.prepare('UPDATE update_manager SET last_seen_image_id = ? WHERE id = 1').run(current.Id);
  }
  return current;
}

function formatImage(info) {
  if (!info) return null;
  return {
    id: info.Id,
    short_id: info.Id.replace('sha256:', '').slice(0, 12),
    created: info.Created,
    size_mb: Math.round(info.Size / 1024 / 1024),
  };
}

// Confronta l'immagine con cui gira DAVVERO il container di un tenant (ispezione
// live del container, non un valore salvato) contro l'immagine attualmente :latest
// su questo host — risponde a "questo tenant ha preso l'ultimo aggiornamento?"
// senza dover indovinare o fare SSH a mano.
async function getTenantImageStatus(tenant, currentImageId) {
  if (tenant.status !== 'active') return { slug: tenant.slug, up_to_date: null, reason: 'not_running' };
  try {
    const info = await provisionerRequest('GET', '/tenants/' + tenant.slug + '/inspect');
    return { slug: tenant.slug, up_to_date: currentImageId ? info.Image === currentImageId : null, running_image_id: info.Image };
  } catch (e) {
    return { slug: tenant.slug, up_to_date: null, reason: 'inspect_failed' };
  }
}

// Immagini Docker sono pesanti (~300MB) — disco, mai in memoria (a differenza
// degli allegati normali in core/backend/routes/uploads.js, dove la scelta
// opposta è deliberata: qui andrebbe in RAM tutto il file prima di poterlo
// processare). Limite generoso ma non infinito: un upload sbagliato non deve
// poter riempire il disco del NAS.
const upload = multer({ dest: os.tmpdir(), limits: { fileSize: 2 * 1024 * 1024 * 1024 } });

// Stato dell'Update Manager (riga singola, id=1) — vedi update-scheduler.js per
// chi la consuma e il workflow completo (valida su un tenant di prova di giorno,
// metti in coda, la notte lo scheduler propaga a tutti). Oltre alla riga DB,
// arricchito con lo stato live di Docker: immagine attualmente :latest, immagine
// disponibile per rollback, e per ciascun tenant se sta girando con l'ultima
// immagine o è rimasto indietro — ogni blocco in try/catch indipendente così un
// problema del daemon Docker degrada quella sezione a vuoto invece di far
// fallire l'intera pagina (coda/annulla restano operativi comunque, sono pure DB).
router.get('/', requireAuth, async (req, res) => {
  const row = db.prepare('SELECT * FROM update_manager WHERE id = 1').get();
  let currentImage = null;
  let previousImage = null;
  let tenantStatus = [];
  try {
    currentImage = formatImage(await capturePreviousImageIfChanged());
  } catch (e) {
    console.error('update-manager: inspect immagine corrente fallito:', e.message);
  }
  try {
    previousImage = formatImage(await inspectImage('previous'));
  } catch (e) {
    // Nessun rollback disponibile ancora — stato normale, non un errore.
  }
  try {
    const tenants = db.prepare("SELECT slug, status FROM tenants WHERE status != 'deleted'").all();
    tenantStatus = await Promise.all(tenants.map((t) => getTenantImageStatus(t, currentImage && currentImage.id)));
  } catch (e) {
    console.error('update-manager: stato tenant live fallito:', e.message);
  }
  res.json({ ...row, current_image: currentImage, previous_image: previousImage, tenant_status: tenantStatus });
});

// Torna all'immagine precedente (platform-core:previous → :latest) — il redeploy
// vero e proprio (singolo o "propaga a tutti") resta quello già esistente: il
// rollback cambia solo a cosa punta :latest, riusando tutta la macchina già in
// piedi invece di duplicarla.
router.post('/rollback', requireAuth, async (req, res) => {
  try {
    await inspectImage('previous');
  } catch (e) {
    return res.status(404).json({ error: 'Nessuna immagine precedente disponibile per il rollback su questo host — verrà creata automaticamente al prossimo aggiornamento rilevato.' });
  }
  try {
    await tagImage(IMAGE_REPO + ':previous', 'latest');
    const info = await inspectImage('latest');
    logAudit(req.user.username, 'update_manager.rollback', null, { restored_image_id: info.Id });
    res.json({ ok: true, current_image: formatImage(info) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Storico reale, non solo "l'ultimo giro" — legge dal log di audit già esistente
// (logAudit scrive già ogni redeploy/import/rollback, non serve una scrittura in
// più): niente si perde quando last_run_results viene sovrascritto dal giro dopo.
router.get('/history', requireAuth, (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 200);
  const rows = db.prepare(
    "SELECT * FROM audit_log WHERE action IN ('tenant.redeploy','tenant.redeploy_all','update_manager.image_import','update_manager.rollback') ORDER BY created_at DESC LIMIT ?"
  ).all(limit);
  res.json(rows.map((r) => ({ ...r, details: r.details ? JSON.parse(r.details) : null })));
});

router.post('/queue', requireAuth, (req, res) => {
  const runHour = req.body && req.body.run_hour !== undefined ? parseInt(req.body.run_hour, 10) : undefined;
  db.prepare('UPDATE update_manager SET queued = 1, queued_at = CURRENT_TIMESTAMP, queued_by = ?' + (runHour !== undefined && !isNaN(runHour) ? ', run_hour = ' + Math.max(0, Math.min(23, runHour)) : '') + ' WHERE id = 1')
    .run(req.user.username);
  logAudit(req.user.username, 'update_manager.queue', null, { run_hour: runHour });
  res.json(db.prepare('SELECT * FROM update_manager WHERE id = 1').get());
});

router.post('/cancel', requireAuth, (req, res) => {
  db.prepare('UPDATE update_manager SET queued = 0 WHERE id = 1').run();
  logAudit(req.user.username, 'update_manager.cancel', null, null);
  res.json(db.prepare('SELECT * FROM update_manager WHERE id = 1').get());
});

// Esporta l'immagine platform-core:latest attualmente caricata su QUESTO host
// come .tar.gz scaricabile — pensato per una topologia multi-server (un Super
// Admin per server, ciascuno con i propri tenant): invece che io trasferisca a
// mano l'immagine via SSH ad ogni server, la si scarica una volta da qui e si
// carica nell'Update Manager dell'altro server (vedi /import sotto). Auth via
// query string (?token=) invece dell'header Authorization — un <a href> di
// download normale non può mandare header custom; il token è lo stesso JWT di
// sempre, verificato a mano qui perché requireAuth si aspetta l'header.
router.get('/export', requireQueryToken, async (req, res) => {
  try {
    // Stream grezzo (tar non compresso) dal docker-provisioner — la
    // compressione gzip resta responsabilità di qui, com'era prima del
    // refactor G2 (vedi commento in docker-provisioner/src/index.js).
    const upstream = await fetch(PROVISIONER_URL + '/images/export', {
      headers: { 'x-internal-secret': INTERNAL_SECRET },
    });
    if (!upstream.ok || !upstream.body) {
      const data = await upstream.json().catch(() => ({}));
      return res.status(upstream.status || 500).json({ error: 'Immagine non trovata su questo host: ' + (data.error || upstream.statusText) });
    }
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Disposition', 'attachment; filename="platform-core-' + stamp + '.tar.gz"');
    res.setHeader('Content-Type', 'application/gzip');
    Readable.fromWeb(upstream.body).pipe(zlib.createGzip()).pipe(res);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Importa un .tar.gz esportato da /export (di qui o di un altro server) — lo
// decomprime al volo (il docker-provisioner vuole un tar, non un .gz) e lo
// carica tramite lui nel daemon Docker locale, dove diventa immediatamente
// disponibile come platform-core:latest per il redeploy di QUESTO server (la
// stessa immagine esportata porta già il tag con sé, incorporato nel tar da
// 'docker save').
router.post('/import', requireAuth, upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Nessun file caricato' });
  const tmpPath = req.file.path;
  try {
    // Il gunzip resta qui (come prima del refactor G2): il docker-provisioner
    // riceve sempre un tar già decompresso come body grezzo — vedi il commento
    // in docker-provisioner/src/index.js sul perché questa responsabilità non
    // si è spostata insieme al resto. duplex:'half' è richiesto da Node/undici
    // quando il body di una fetch è uno stream, non un buffer già pronto.
    const gunzipStream = fs.createReadStream(tmpPath).pipe(zlib.createGunzip());
    const upstream = await fetch(PROVISIONER_URL + '/images/import', {
      method: 'POST',
      headers: { 'x-internal-secret': INTERNAL_SECRET },
      body: Readable.toWeb(gunzipStream),
      duplex: 'half',
    });
    const importResult = await upstream.json();
    if (!upstream.ok) throw new Error(importResult.error || 'Import immagine fallito');
    const loadedRef = importResult.loaded_ref;
    // Prima di sovrascrivere :latest, cattura "gratis" l'immagine che sta per
    // essere scavalcata come :previous per il rollback.
    await capturePreviousImageIfChanged().catch(() => {});
    // Un .tar.gz esportato da 'docker save' porta con sé QUALUNQUE tag avesse
    // l'immagine di origine — non necessariamente :latest (es. la pipeline SSH
    // usata di solito produce platform-core:amd64). Si forza sempre il retag a
    // :latest indipendentemente dal tag incorporato, così questo percorso non può
    // silenziosamente "caricare ma non attivare" un aggiornamento. Il parsing
    // dell'output NDJSON di 'docker load' (bug reale già trovato: il testo
    // JSON-escaped contiene ancora "\n" letterale prima del parsing) vive ora
    // dentro docker-provisioner — qui si riceve già solo `loaded_ref`.
    await tagImage(loadedRef, 'latest');
    const info = await inspectImage('latest');
    logAudit(req.user.username, 'update_manager.image_import', null, {
      original_name: req.file.originalname,
      size_mb: Math.round(req.file.size / 1024 / 1024),
      loaded_ref: loadedRef,
      image_id: info.Id,
    });
    res.json({ ok: true, current_image: formatImage(info) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    fs.unlink(tmpPath, () => {});
  }
});

module.exports = router;
module.exports.capturePreviousImageIfChanged = capturePreviousImageIfChanged;
