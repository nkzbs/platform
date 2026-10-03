'use strict';
// Avvisi per modulo (avvisi.js + module-roles.js): il modulo dichiara cosa è "nuovo", come chiama le sue righe e a chi avvisare.
// Eseguire con: node src/avvisi.test.js

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const dbPath = path.join(os.tmpdir(), 'avvisi-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.DB_PATH = dbPath;
process.env.JWT_SECRET = 'avv_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'avv_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'avv-uploads-'));

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; }
}
function assertEq(a, e, msg) { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${msg || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); }

const db = require('./db');
const roles = require('./module-roles');
const avvisi = require('./avvisi');
const addModule = (slug, name) => db.prepare("INSERT OR IGNORE INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES (?, ?, 'box', '#000', 1, 1, 60, '{}')").run(name, slug);

console.log('\n--- valori di partenza per Finance ---');
addModule('spese_casa', 'Spese casa');
roles.seedIfEmpty();
test('Spese casa avvisa per le righe da smistare, con il tag e i nomi di prima', () => {
  const a = roles.get('spese_casa').avvisi;
  assertEq(a.states, { nuovo: 'da_smistare', da_fare: 'da_pagare' }); assertEq(a.nuovo, true); assertEq(a.scadenze, true); assertEq(a.tag, 'scadenza'); assertEq(a.noun_s, 'bolletta');
});
test('il messaggio per una nuova bolletta', () => {
  const m = avvisi.buildNuovaRiga('spese_casa', { descrizione: 'A2A Energia', importo: 44, scadenza: '2026-10-01', _stato: 'da_smistare' });
  assertEq(m.text, 'Bolletta da smistare: A2A Energia · 44,00 € · scade 01/10/2026'); assertEq(m.tag, 'scadenza');
});
test('una riga in un altro stato non avvisa', () => { assertEq(avvisi.buildNuovaRiga('spese_casa', { descrizione: 'x', _stato: 'pagato' }), null); });

console.log('\n--- un modulo diverso, senza una parola di finanza ---');
addModule('ordini', 'Ordini');
roles.set('ordini', { kind: 'entrata', uses: ['avvisi'], roles: { importo: 'totale', descrizione: 'cliente', stato: '_stato', scadenza: 'consegna' },
  avvisi: { states: { nuovo: 'nuovo', da_fare: 'da_evadere' }, nuovo: true, scadenze: true, tag: 'ordini', label: 'ord.', noun_s: 'ordine', noun_p: 'ordini' } });
test('usa i suoi campi, i suoi stati e le sue parole', () => {
  const m = avvisi.buildNuovaRiga('ordini', { cliente: 'Rossi', totale: 120.5, consegna: '2026-11-02', _stato: 'nuovo' });
  assertEq(m.text, 'Ordine nuovo: Rossi · 120,50 € · scade 02/11/2026'); assertEq(m.tag, 'ordini');
});
test('senza avviso acceso il modulo non avvisa', () => {
  roles.set('ordini', { kind: 'entrata', uses: ['avvisi'], roles: { stato: '_stato' }, avvisi: { states: { nuovo: 'nuovo' }, nuovo: false } });
  assertEq(avvisi.buildNuovaRiga('ordini', { _stato: 'nuovo' }), null);
});
test('valori strani nelle dichiarazioni vengono ripuliti', () => {
  const a = roles.set('ordini', { kind: 'entrata', uses: [], roles: {}, avvisi: { states: { nuovo: "x'; DROP", da_fare: 'ok_1' }, tag: 'a b!c', noun_s: '  ', nuovo: 1 } }).avvisi;
  assertEq(a.states, { nuovo: '', da_fare: 'ok_1' }); assertEq(a.tag, 'abc'); assertEq(a.noun_s, 'riga'); assertEq(a.nuovo, true);
});

console.log(`\n${'='.repeat(60)}`);
console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
try { fs.unlinkSync(dbPath); } catch (e) {}
process.exit(failed > 0 ? 1 : 0);
