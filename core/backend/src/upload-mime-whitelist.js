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
// SVG è un'immagine che può contenere script: aperto dall'app girerebbe con la sua origine.
const SCRIPTABLE_MIME = new Set(['image/svg+xml']);

function isAllowedUploadMime(mime) {
  if (!mime || SCRIPTABLE_MIME.has(mime)) return false;
  if (ALLOWED_MIME_EXACT.has(mime)) return true;
  return ALLOWED_MIME_PREFIXES.some((p) => mime.startsWith(p));
}

// Quali file si possono aprire nel browser invece di scaricarli. Vale per ogni
// provenienza (caricamento, allegati Gmail con il tipo dichiarato dal mittente,
// ripristino di un backup): un tipo non sicuro si scarica sempre.
const INLINE_SAFE_EXACT = new Set(['application/pdf', 'text/plain', 'text/csv']);
function isInlineSafeMime(mime) {
  const m = String(mime || '').toLowerCase().split(';')[0].trim();
  if (INLINE_SAFE_EXACT.has(m)) return true;
  return m.startsWith('image/') && !SCRIPTABLE_MIME.has(m);
}

// Content-Disposition con il nome originale anche se contiene accenti, € o emoji
// (un header con caratteri fuori da latin1 fa fallire la risposta).
function contentDisposition(type, filename) {
  const name = String(filename || 'file');
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '');
  return type + '; filename="' + ascii + '"; filename*=UTF-8\'\'' + encodeURIComponent(name);
}

module.exports = { isAllowedUploadMime, isInlineSafeMime, contentDisposition };
