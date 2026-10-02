'use strict';
// G7 (PLATFORM-0.6-GAP-ANALYSIS.md) — whitelist di tipo file upload, estratta in un
// modulo a sé (zero dipendenze: nessun db/express/multer) proprio per essere
// testabile come funzione pura senza trascinarsi dietro un'intera route e la sua
// apertura del DB — stesso principio già in uso per permissions.js. Whitelist
// generosa sui formati business reali (documenti/immagini/fogli di calcolo/
// archivi) usati oggi da Coffee/Finance per allegati a record — deliberatamente
// esclusi eseguibili/script/HTML (rischio reale: un HTML caricato e poi aperto
// inline da un altro utente eseguirebbe script nel contesto dell'app).
const ALLOWED_MIME_PREFIXES = ['image/', 'application/pdf', 'text/plain', 'text/csv'];
const ALLOWED_MIME_EXACT = new Set([
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/zip', 'application/x-zip-compressed',
]);
function isAllowedUploadMime(mime) {
  if (!mime) return false;
  if (ALLOWED_MIME_EXACT.has(mime)) return true;
  return ALLOWED_MIME_PREFIXES.some((p) => mime.startsWith(p));
}

module.exports = { isAllowedUploadMime };
