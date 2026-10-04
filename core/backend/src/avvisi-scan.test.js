'use strict';
// Controllo unico delle righe nuove (avvisi.js scanNuove): avvisa per qualunque via di creazione, una volta sola, e raggruppa.
// Eseguire con: node src/avvisi-scan.test.js

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const dbPath = path.join(os.tmpdir(), 'avvisi-scan-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.DB_PATH = dbPath;
process.env.JWT_SECRET = 'avs_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'avs_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'avs-uploads-'));

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; }
}
function assertEq(a, e, msg) { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${msg || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); }
function assertTrue(c, msg) { if (!c) throw new Error(msg || 'atteso true'); }

(async () => {
  const db = require('./db');
  const roles = require('./module-roles');
  const avvisi = require('./avvisi');
  const wa = require('./whatsapp');
  require('./features').set('whatsapp', true);
  db.prepare("INSERT OR IGNORE INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES ('Spese casa', 'spese_casa', 'box', '#000', 1, 1, 60, '{}')").run();
  roles.seedIfEmpty();
  db.prepare("INSERT OR REPLACE INTO connections (integration_id, connected, credentials) VALUES ('whatsapp_callmebot', 1, ?)").run(JSON.stringify({ api_key: 'k' }));
  db.prepare("INSERT INTO whatsapp_recipients (nome, numero, triggers, attivo) VALUES ('Nima', '3331111111', ?, 1)").run(JSON.stringify(['scadenza']));
  const sent = [];
  wa.sendAll = async ({ testo, destinatari }) => { sent.push(testo); return { esito: 'inviato', dettaglio: destinatari.map((d) => d.nome + ' ✓').join(';') }; };
  const add = (extra = {}) => db.prepare('INSERT INTO records (module_slug, user_id, data) VALUES (?, NULL, ?)').run('spese_casa', JSON.stringify({ descrizione: 'Bolletta', importo: 10, data: '2026-10-01', _stato: 'da_smistare', ...extra })).lastInsertRowid;
  add({ descrizione: 'Vecchia' });

  await test('la prima volta le righe già presenti si segnano come viste, senza avvisare', async () => {
    const r = await avvisi.scanNuove(); assertEq(r.baseline, true); assertEq(sent.length, 0);
  });
  await test('una riga nuova, da qualunque via (qui inserita direttamente, come farebbe un\'automazione), parte in un messaggio', async () => {
    add({ descrizione: 'A2A Energia', importo: 44, scadenza: '2026-10-31' });
    await avvisi.scanNuove(); assertEq(sent.length, 1); assertEq(sent[0], 'Bolletta da smistare: A2A Energia · 44,00 € · scade 31/10/2026');
  });
  await test('la stessa riga non avvisa due volte', async () => { await avvisi.scanNuove(); assertEq(sent.length, 1); });
  await test('più righe nuove insieme: un solo messaggio con l\'elenco', async () => {
    add({ descrizione: 'Intred', importo: 77.12 }); add({ descrizione: 'TARI', importo: 0 }); add({ descrizione: 'Acqua', importo: 20 });
    await avvisi.scanNuove(); assertEq(sent.length, 2);
    assertTrue(sent[1].startsWith('3 bollette da smistare:') && sent[1].includes('• Intred 77,12 €') && sent[1].includes('• TARI'), sent[1]);
  });
  await test('più di 4 righe: le prime 4 e "… e altre N"', async () => {
    for (let i = 0; i < 6; i++) add({ descrizione: 'Riga ' + i });
    await avvisi.scanNuove(); assertTrue(sent[2].startsWith('6 bollette da smistare:') && sent[2].includes('… e altre 2'), sent[2]);
  });
  await test('una riga che nasce in un altro stato (es. le rate "da pagare") non avvisa', async () => {
    const n = sent.length; add({ descrizione: 'Rata 1/3', _stato: 'da_pagare' }); await avvisi.scanNuove(); assertEq(sent.length, n);
  });
  await test('un modulo con l\'avviso spento non avvisa', async () => {
    const n = sent.length; const cur = roles.get('spese_casa');
    roles.set('spese_casa', { kind: cur.kind, uses: cur.uses, roles: cur.roles, avvisi: { ...cur.avvisi, nuovo: false } });
    add({ descrizione: 'Muta' }); await avvisi.scanNuove(); assertEq(sent.length, n);
    roles.set('spese_casa', { kind: cur.kind, uses: cur.uses, roles: cur.roles, avvisi: cur.avvisi });
  });

  console.log(`\n${'='.repeat(60)}`);
  console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
  try { fs.unlinkSync(dbPath); } catch (e) {}
  process.exit(failed > 0 ? 1 : 0);
})();
