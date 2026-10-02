'use strict';
// G18 (PLATFORM-0.6-GAP-ANALYSIS.md, 2026-08-22) — copia off-site di un backup già
// creato localmente (vedi backup-scheduler.js). L'URL che il tenant/Core scrive in
// tenants.backup_offsite_url DECIDE il meccanismo (schema URL -> funzione qui sotto),
// non un env var separato: cambiare destinazione domani (da locale a S3/WebDAV/altro)
// significa scrivere un URL diverso, mai toccare codice o fare un redeploy — proprio
// perché la destinazione reale è deliberatamente temporanea oggi (NAS + Cloud Sync
// verso Google Drive) e cambierà "a regime".
//
// Oggi supportato SOLO 'file:' (copia su un percorso locale montato in questo
// container, tipicamente sincronizzato altrove da uno strumento esterno come
// Synology Cloud Sync — questo modulo non sa né deve sapere di Google Drive).
// Aggiungere un domani 's3:'/'webdav:' significa aggiungere UN case qui sotto,
// nessuna modifica al chiamante (backup-scheduler.js) né alla UI.
const fs = require('fs');
const path = require('path');
const { decrypt } = require('./crypto-secrets');

// Radice consentita per le destinazioni 'file://' — mai un percorso arbitrario del
// filesystem del container: senza questo, un URL tipo 'file:///etc/passwd' o
// 'file:///data/altro-tenant.db' (letto da un Core/partner malintenzionato o solo
// distratto) scriverebbe fuori dall'area pensata per l'off-site. Configurabile
// (il mount reale dentro il container puo' avere qualunque nome), MA se non è
// configurata nessuna destinazione file:// è permessa — mai un default permissivo.
function allowedFileRoot() {
  const root = process.env.OFFSITE_BACKUP_ROOT;
  return root ? path.resolve(root) : null;
}

function resolveFileDestination(url) {
  const root = allowedFileRoot();
  if (!root) throw Object.assign(new Error("Destinazione 'file://' non disponibile: OFFSITE_BACKUP_ROOT non configurata su questo host"), { code: 'ROOT_NOT_CONFIGURED' });
  // url.pathname è il percorso ASSOLUTO scritto dall'utente (es. 'file:///offsite-
  // backups/coffee' -> pathname '/offsite-backups/coffee') — non relativo alla
  // radice, che sarebbe stato ambiguo (bug reale trovato testando questo endpoint
  // dal vivo: un URL con lo stesso prefisso della radice raddoppiava il percorso,
  // es. /offsite-backups/offsite-backups/coffee). resolve() qui normalizza '..'/'.'
  // PRIMA del confronto con la radice, non dopo: è questo l'ordine che rende il
  // controllo reale, non aggirabile con un path relativo camuffato.
  const resolved = path.resolve(url.pathname);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw Object.assign(new Error('Percorso off-site fuori dalla radice consentita (' + root + ')'), { code: 'PATH_TRAVERSAL' });
  }
  return resolved;
}

async function copyViaFile(url, localPath, filename) {
  const destDir = resolveFileDestination(url);
  fs.mkdirSync(destDir, { recursive: true });
  const destPath = path.join(destDir, filename);
  fs.copyFileSync(localPath, destPath);
  return { ok: true, destination: destPath };
}

// tenant.backup_offsite_credentials arriva già cifrato (colonna DB) — decifrato qui,
// non prima: nessuno schema oggi lo usa (file:// non richiede autenticazione), ma la
// forma è pronta per quando servirà (s3:// -> access_key/secret_key, webdav://
// -> username/password, ecc.), senza dover ritoccare lo schema DB in quel momento.
function decryptCredentials(tenant) {
  if (!tenant.backup_offsite_credentials) return {};
  try {
    return JSON.parse(decrypt(tenant.backup_offsite_credentials));
  } catch (e) {
    return {};
  }
}

// Punto unico chiamato da backup-scheduler.js dopo un backup locale riuscito.
// Ritorna sempre { ok, skipped?, error?, destination? } — mai un throw: un
// fallimento off-site non deve mai far sembrare fallito il backup locale, che è
// già stato scritto con successo prima di arrivare qui.
async function copyBackupOffsite(tenant, localPath, filename) {
  if (!tenant.backup_offsite_url) return { ok: false, skipped: true };
  let url;
  try {
    url = new URL(tenant.backup_offsite_url);
  } catch (e) {
    return { ok: false, error: 'URL off-site non valido: ' + e.message };
  }
  try {
    switch (url.protocol) {
      // 'credentials' (decryptCredentials(tenant)) non serve a 'file:' — verrà
      // passata ai prossimi case (s3://, webdav://) quando esisteranno, non prima:
      // costruirla anche qui sarebbe lavoro sprecato per un caso che non la usa mai.
      case 'file:':
        return await copyViaFile(url, localPath, filename);
      default:
        return { ok: false, error: "Schema '" + url.protocol + "' non supportato" };
    }
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// resolveFileDestination esportata per backup-verify.js (G18, 2026-08-23) — la
// verifica periodica deve trovare lo stesso file 'file://' già copiato qui,
// senza reimplementare una seconda volta il controllo anti-path-traversal.
module.exports = { copyBackupOffsite, resolveFileDestination };
