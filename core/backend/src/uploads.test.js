'use strict';

// Test — whitelist di tipo file upload (G7, PLATFORM-0.6-GAP-ANALYSIS.md).
// Funzione pura, nessun DB/HTTP reale coinvolto. Stesso pattern di permissions.test.js.
// Trovato in F0.1.7.1.D1 (PLATFORM-MASTER-ROADMAP.md): il fix G7 non aveva NESSUN test
// dedicato in tutto il repo, nonostante fosse già "chiuso" nel gap-analysis.
// Eseguire con: node uploads.test.js

const { isAllowedUploadMime } = require('./upload-mime-whitelist');

let passed = 0, failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log('  ✓ ' + name);
    passed++;
  } catch (e) {
    console.error('  ✗ ' + name);
    console.error('    ' + e.message);
    failed++;
  }
}

function assertEq(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg || ''}: atteso ${JSON.stringify(expected)}, ottenuto ${JSON.stringify(actual)}`);
  }
}

console.log('\n--- isAllowedUploadMime ---');

test('nessun mime type -> rifiutato', () => {
  assertEq(isAllowedUploadMime(undefined), false);
  assertEq(isAllowedUploadMime(''), false);
  assertEq(isAllowedUploadMime(null), false);
});

test('immagini (prefisso image/) -> consentite', () => {
  assertEq(isAllowedUploadMime('image/png'), true);
  assertEq(isAllowedUploadMime('image/jpeg'), true);
  assertEq(isAllowedUploadMime('image/webp'), true);
});

test('PDF/testo/CSV -> consentiti', () => {
  assertEq(isAllowedUploadMime('application/pdf'), true);
  assertEq(isAllowedUploadMime('text/plain'), true);
  assertEq(isAllowedUploadMime('text/csv'), true);
});

test('Office (Word/Excel/PowerPoint, vecchio e nuovo formato) -> consentiti', () => {
  assertEq(isAllowedUploadMime('application/msword'), true);
  assertEq(isAllowedUploadMime('application/vnd.openxmlformats-officedocument.wordprocessingml.document'), true);
  assertEq(isAllowedUploadMime('application/vnd.ms-excel'), true);
  assertEq(isAllowedUploadMime('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'), true);
  assertEq(isAllowedUploadMime('application/vnd.ms-powerpoint'), true);
  assertEq(isAllowedUploadMime('application/vnd.openxmlformats-officedocument.presentationml.presentation'), true);
});

test('ZIP (entrambe le varianti di mime type note) -> consentiti', () => {
  assertEq(isAllowedUploadMime('application/zip'), true);
  assertEq(isAllowedUploadMime('application/x-zip-compressed'), true);
});

// Il rischio reale che G7 doveva chiudere: un HTML caricato ed eseguito inline
// nel contesto dell'app quando un altro utente lo apre.
test('HTML -> rifiutato (rischio reale: script eseguito nel contesto dell\'app)', () => {
  assertEq(isAllowedUploadMime('text/html'), false);
});

test('eseguibili/script -> rifiutati', () => {
  assertEq(isAllowedUploadMime('application/x-msdownload'), false);
  assertEq(isAllowedUploadMime('application/x-sh'), false);
  assertEq(isAllowedUploadMime('application/javascript'), false);
  assertEq(isAllowedUploadMime('application/x-executable'), false);
});

test('mime type sconosciuto/generico -> rifiutato (whitelist, non blacklist)', () => {
  assertEq(isAllowedUploadMime('application/octet-stream'), false);
  assertEq(isAllowedUploadMime('video/mp4'), false);
});

// ─── SOMMARIO ─────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
console.log(`Risultato: ${passed} passati, ${failed} falliti`);
if (failed > 0) {
  process.exit(1);
}
