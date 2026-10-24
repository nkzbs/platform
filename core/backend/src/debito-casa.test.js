'use strict';
// Saldo dei contributi tra due persone (debito-casa.js): quota fissa mensile, versato da entrate
// "Contributo <nome>" più le spese pagate direttamente (ruolo pagato_da). Eseguire con: node src/debito-casa.test.js

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const dbPath = path.join(os.tmpdir(), 'debito-casa-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.DB_PATH = dbPath;
process.env.JWT_SECRET = 'dc_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'dc_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-uploads-'));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; }
}
function assertEq(a, e, msg) { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${msg || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); }
function assertTrue(c, msg) { if (!c) throw new Error(msg || 'atteso true'); }

const db = require('./db');
const roles = require('./module-roles');
const dc = require('./debito-casa');

db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES ('Entrate', 'entrate', 'box', '#000', 1, 1, 70, '{}')").run();
db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES ('Spese Comuni', 'spese_comuni', 'box', '#000', 1, 1, 71, '{}')").run();
db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES ('Spese Altro', 'spese_altro', 'box', '#000', 1, 1, 72, '{}')").run();
roles.set('entrate', { kind: 'entrata', uses: [], roles: { importo: 'importo', data: 'data', categoria: 'categoria' } });
roles.set('spese_comuni', { kind: 'spesa', uses: [], roles: { importo: 'importo', data: 'data', pagato_da: 'pagato_da' } });
roles.set('spese_altro', { kind: 'spesa', uses: [], roles: { importo: 'importo', data: 'data' } }); // niente pagato_da: non è "la" spesa comune

const putEntrata = (d) => db.prepare('INSERT INTO records (module_slug, user_id, data) VALUES (?, NULL, ?)').run('entrate', JSON.stringify(d));
const putSpesa = (d) => db.prepare('INSERT INTO records (module_slug, user_id, data) VALUES (?, NULL, ?)').run('spese_comuni', JSON.stringify(d));
const nima = { id: 1, username: 'anna', display_name: 'Anna' };
const fede = { id: 2, username: 'marco', display_name: 'Marco' };

test('senza quota/nomi impostati (default), senza contributi: non attivo, il bot lo dice', () => {
  assertTrue(!dc.attivo());
  assertEq(dc.rispondi(nima).html, 'Nessun contributo registrato ancora.');
});

test('le quote e i nomi si impostano e si rileggono', () => {
  const q = dc.setQuote({ nome_a: 'Anna', nome_b: 'Marco', quota_a: 500, quota_b: 400 });
  assertEq(q, { nome_a: 'Anna', nome_b: 'Marco', quota_a: 500, quota_b: 400 });
});

test('il primo mese è quello della prima entrata "Contributo <nome>"; senza nessuna, non è attivo', () => {
  assertEq(dc.primoMese(), null);
  putEntrata({ descrizione: 'x', importo: 500, data: '2026-01-15', categoria: 'Contributo Anna' });
  assertEq(dc.primoMese(), '2026-01');
});

test('saldo su 2 mesi: versato (contributi + spese pagate direttamente) contro la quota di ciascuno', () => {
  putEntrata({ descrizione: 'x', importo: 400, data: '2026-01-20', categoria: 'Contributo Marco' });
  // a febbraio Anna non versa niente nel pot (sotto la sua quota di 500); Marco non versa nel pot
  // ma paga 400 di bolletta direttamente: copre comunque la sua quota di febbraio.
  putSpesa({ descrizione: 'Bolletta', importo: 400, data: '2026-02-05', pagato_da: 'Marco' });
  const s = dc.saldo('2026-02');
  assertEq(s.available, true); assertEq(s.mesi, 2); assertEq(s.da, '2026-01'); assertEq(s.a, '2026-02');
  assertEq(s.versato_a, 500); assertEq(s.versato_b, 800); assertEq(s.dovuto_a, 1000); assertEq(s.dovuto_b, 800);
  assertEq(s.saldo_a, -500, 'Anna ha versato (a gennaio) 500 su 1000 dovuti in 2 mesi -> deve 500 a Marco');
});

test('una spesa pagata direttamente in un modulo SENZA il ruolo pagato_da non entra nel saldo', () => {
  db.prepare("INSERT INTO records (module_slug, user_id, data) VALUES ('spese_altro', NULL, ?)").run(JSON.stringify({ importo: 9999, data: '2026-02-01', pagato_da: 'Marco' }));
  const s = dc.saldo('2026-02');
  assertEq(s.versato_b, 800, 'il modulo spese_altro non dichiara pagato_da: non è "la" spesa comune, ignorato');
});

test('rispondi(): dal punto di vista di chi chiede, con dettaglio solo per chi non è nessuno dei due', () => {
  const perAnna = dc.rispondi(nima, new Date('2026-02-20'));
  assertTrue(/Devi <b>500,00 €<\/b> a <b>Marco<\/b>/.test(perAnna.html), perAnna.html);
  assertTrue(!/versato/.test(perAnna.html), 'niente dettaglio per chi è una delle due persone');
  const perMarco = dc.rispondi(fede, new Date('2026-02-20'));
  assertTrue(/<b>Anna<\/b> ti deve <b>500,00 €<\/b>/.test(perMarco.html), perMarco.html);
  const perAltro = dc.rispondi({ display_name: 'Admin' }, new Date('2026-02-20'));
  assertTrue(/Anna: versato/.test(perAltro.html) && /Marco: versato/.test(perAltro.html), perAltro.html);
});

test('in pari: a gennaio entrambi avevano versato esattamente la quota -> "sei in pari", non un importo', () => {
  const s = dc.saldo('2026-01');
  assertEq(s.saldo_a, 0);
  const html = dc.rispondi(nima, new Date('2026-01-25')).html; // «rispondi» usa sempre il mese corrente di `now`, non finoA: qui now è ancora gennaio
  assertTrue(/Sei in pari con Marco/.test(html), html);
});

console.log(`\n${'='.repeat(60)}`);
console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
try { fs.unlinkSync(dbPath); } catch (e) {}
process.exit(failed > 0 ? 1 : 0);
