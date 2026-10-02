'use strict';

// Test — cifratura per-campo (crypto-fields.js), il cuore della scelta architetturale
// di G11/record_index (PLATFORM-MASTER-ROADMAP.md: SQL non può filtrare su un valore
// cifrato, per questo permessi/relazione/data sono JS-side). Funzione pura, nessun
// DB/HTTP reale coinvolto. Stesso pattern di permissions.test.js.
// Trovato in F0.1.7.1.D1: nessun file di test dedicato esisteva per questo modulo,
// nonostante fosse il meccanismo su cui poggia tutta quella decisione.
// Eseguire con: node crypto-fields.test.js

process.env.ENCRYPTION_KEY = 'test_encryption_key_non_reale_' + Date.now();
process.env.TENANT_SLUG = 'crypto-test-tenant';

const { encrypt, decrypt, encryptFields, decryptFields } = require('./crypto-fields');

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
function assertTrue(cond, msg) {
  if (!cond) throw new Error(msg || 'atteso true');
}

console.log('\n--- encrypt/decrypt ---');

test('round-trip: decrypt(encrypt(x)) === x', () => {
  assertEq(decrypt(encrypt('un valore sensibile')), 'un valore sensibile');
  assertEq(decrypt(encrypt('IBAN IT60X0542811101000000123456')), 'IBAN IT60X0542811101000000123456');
});

test('il testo cifrato NON contiene il plaintext in chiaro', () => {
  const plain = 'numero di carta 4111111111111111';
  const enc = encrypt(plain);
  assertTrue(!enc.includes(plain), 'il valore cifrato non deve contenere il testo in chiaro');
});

test('il formato salvato è prefissato "enc:" (IV:tag:ciphertext in hex)', () => {
  const enc = encrypt('x');
  assertTrue(enc.startsWith('enc:'), 'deve iniziare con enc:');
  assertEq(enc.split(':').length, 4, 'enc:iv:tag:ciphertext -> 4 segmenti');
});

test('stesso plaintext cifrato due volte -> ciphertext DIVERSO (IV casuale, mai riusato)', () => {
  const a = encrypt('valore ripetuto');
  const b = encrypt('valore ripetuto');
  assertTrue(a !== b, 'due cifrature dello stesso valore non devono mai coincidere');
  // ma decifrano comunque allo stesso plaintext
  assertEq(decrypt(a), 'valore ripetuto');
  assertEq(decrypt(b), 'valore ripetuto');
});

test('null/undefined/stringa vuota passano invariati (nessuna cifratura su "niente")', () => {
  assertEq(encrypt(null), null);
  assertEq(encrypt(undefined), undefined);
  assertEq(encrypt(''), '');
});

test('decrypt su un valore MAI cifrato (senza prefisso enc:) lo ritorna invariato', () => {
  assertEq(decrypt('valore in chiaro, mai passato da encrypt()'), 'valore in chiaro, mai passato da encrypt()');
  assertEq(decrypt(null), null);
  assertEq(decrypt(''), '');
});

test('ciphertext manomesso (auth tag GCM non valido) -> errore leggibile, mai un crash', () => {
  const enc = encrypt('valore originale');
  const parts = enc.split(':');
  // altero un carattere del ciphertext (ultimo segmento) — GCM deve rilevarlo
  const tampered = parts[0] + ':' + parts[1] + ':' + parts[2] + ':' + (parts[3][0] === 'a' ? 'b' : 'a') + parts[3].slice(1);
  const result = decrypt(tampered);
  assertEq(result, '[errore decifratura]');
});

console.log('\n--- isolamento per tenant (TENANT_SLUG come sale della chiave) ---');

test('lo stesso ENCRYPTION_KEY con TENANT_SLUG diverso deriva una chiave diversa: un tenant non decifra i dati di un altro', () => {
  const encAsTenantA = encrypt('segreto del tenant A');
  const originalSlug = process.env.TENANT_SLUG;
  process.env.TENANT_SLUG = 'un-altro-tenant';
  try {
    const result = decrypt(encAsTenantA);
    assertEq(result, '[errore decifratura]', 'un tenant diverso non deve MAI riuscire a decifrare i dati di un altro');
  } finally {
    process.env.TENANT_SLUG = originalSlug; // ripristinato SEMPRE, anche se l'assert sopra fallisce
  }
});

console.log('\n--- encryptFields/decryptFields (integrazione con lo schema modulo) ---');

const schema = [
  { key: 'iban', type: 'encrypted' },
  { key: 'note', type: 'text' }, // non cifrato, il tipo non è 'encrypted'
];

test('encryptFields cifra SOLO i campi type:encrypted dello schema, lascia gli altri invariati', () => {
  const data = { iban: 'IT60X0000000000000000000000', note: 'nota pubblica', extra: 'campo non nello schema' };
  const enc = encryptFields(data, schema);
  assertTrue(String(enc.iban).startsWith('enc:'), 'iban deve essere cifrato');
  assertEq(enc.note, 'nota pubblica', 'note non è type:encrypted, resta in chiaro');
  assertEq(enc.extra, 'campo non nello schema', 'un campo non nello schema resta invariato');
});

test('decryptFields(encryptFields(x)) === x per i campi cifrati', () => {
  const data = { iban: 'IT60X0000000000000000000000', note: 'nota pubblica' };
  const roundTrip = decryptFields(encryptFields(data, schema), schema);
  assertEq(roundTrip.iban, data.iban);
  assertEq(roundTrip.note, data.note);
});

test('encryptFields/decryptFields con data o fields assenti -> ritorna data invariato, mai un crash', () => {
  assertEq(encryptFields(null, schema), null);
  const withNoSchema = { a: 1 };
  assertEq(encryptFields(withNoSchema, null), withNoSchema, 'senza uno schema, torna la stessa data invariata');
  assertEq(decryptFields(undefined, schema), undefined);
});

// ─── SOMMARIO ─────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
console.log(`Risultato: ${passed} passati, ${failed} falliti`);
if (failed > 0) {
  process.exit(1);
}
