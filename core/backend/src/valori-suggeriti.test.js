'use strict';
// Campi di testo con «suggerisci» (valori-suggeriti.js): elenco dei valori usati e allineamento della grafia. Eseguire con: node src/valori-suggeriti.test.js (porta 34817).
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const TEST_PORT = 34817;
const BASE = 'http://localhost:' + TEST_PORT;
const dbPath = path.join(os.tmpdir(), 'suggeriti-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.DB_PATH = dbPath;
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'sg_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'sg_internal_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'sg_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-uploads-'));
process.env.SUPER_ADMIN_URL = 'http://localhost:1';
process.env.TENANT_SLUG = 'sg';

let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); console.log('  ✓ ' + name); passed++; } catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; } }
function assertEq(a, e, msg) { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${msg || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); }

const F = (key, label, type, extra = {}) => ({ id: 'f_' + key, block_type: 'field', key, label, type, ...extra });

async function main() {
  require('./index.js');
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
  const db = require('./db');
  db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES ('piani', 'piani', 'box', '#000', 1, 1, 70, ?)").run(JSON.stringify({ version: 3, steps: [F('nome', 'Nome', 'text'), F('creditore', 'Creditore', 'text', { suggerisci: true })] }));
  const login = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: process.env.INITIAL_ADMIN_PASSWORD }) })).json();
  const H = { Authorization: 'Bearer ' + login.token, 'Content-Type': 'application/json' };
  const crea = async (body) => (await (await fetch(BASE + '/api/records/piani', { method: 'POST', headers: H, body: JSON.stringify(body) })).json());
  const modifica = async (id, body) => (await (await fetch(BASE + '/api/records/piani/' + id, { method: 'PUT', headers: H, body: JSON.stringify(body) })).json());
  const valori = async (key = 'creditore', slug = 'piani') => (await (await fetch(BASE + '/api/records/' + slug + '/valori/' + key, { headers: H })).json());

  await crea({ nome: 'a', creditore: 'AUTOLANZANOVA' }); await crea({ nome: 'b', creditore: 'AUTOLANZANOVA' }); await crea({ nome: 'c', creditore: 'IKEA' });

  await test('un valore scritto in modo diverso (maiuscole, spazi, punteggiatura) torna alla grafia già in uso', async () => {
    assertEq((await crea({ nome: 'd', creditore: 'Auto Lanzanova' })).data.creditore, 'AUTOLANZANOVA');
    assertEq((await crea({ nome: 'e', creditore: '  autolanzanova ' })).data.creditore, 'AUTOLANZANOVA');
    assertEq((await crea({ nome: 'f', creditore: 'ikea' })).data.creditore, 'IKEA');
  });
  await test('un valore davvero nuovo resta com\'è (ripulito dagli spazi); un campo vuoto resta vuoto', async () => {
    assertEq((await crea({ nome: 'g', creditore: '  Scalapay  ' })).data.creditore, 'Scalapay');
    assertEq((await crea({ nome: 'h' })).data.creditore, undefined);
  });
  await test('anche modificando un record la grafia si allinea', async () => {
    const r = await crea({ nome: 'i', creditore: 'Scalapay' });
    assertEq((await modifica(r.id, { ...r.data, creditore: 'SCALAPAY' })).data.creditore, 'Scalapay');
  });
  await test('l\'elenco dei valori parte dal più usato', async () => {
    const v = await valori(); assertEq(v[0], 'AUTOLANZANOVA'); assertEq(v.slice().sort(), ['AUTOLANZANOVA', 'IKEA', 'Scalapay'].sort());
  });
  await test('un campo senza «suggerisci», o inesistente, non dà niente e non si allinea', async () => {
    assertEq(await valori('nome'), []); assertEq(await valori('boh'), []);
    assertEq((await crea({ nome: 'ikea' })).data.nome, 'ikea');
  });

  // lista da un altro modulo (es. Fornitori) con aggiunta automatica
  db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES ('forn', 'forn', 'box', '#000', 1, 1, 71, ?)").run(JSON.stringify({ version: 3, steps: [F('nome', 'Nome', 'text')] }));
  db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES ('piani2', 'piani2', 'box', '#000', 1, 1, 72, ?)").run(JSON.stringify({ version: 3, steps: [F('nome', 'Nome', 'text'), F('creditore', 'Creditore', 'text', { suggerisci: true, suggerisci_da: { modulo: 'forn', campo: 'nome', crea: true } })] }));
  for (const n of ['Lanzanova Auto', 'A2A']) db.prepare("INSERT INTO records (module_slug, user_id, data) VALUES ('forn', NULL, ?)").run(JSON.stringify({ nome: n }));
  const crea2 = async (body) => (await (await fetch(BASE + '/api/records/piani2', { method: 'POST', headers: H, body: JSON.stringify(body) })).json());
  const nomiForn = () => db.prepare("SELECT data FROM records WHERE module_slug = 'forn'").all().map((r) => JSON.parse(r.data).nome).sort();
  await test('con una lista (suggerisci_da) un nome scritto in modo diverso torna alla grafia della lista, anche se nessun piano lo usa ancora', async () => {
    assertEq((await crea2({ nome: 'x', creditore: 'AUTOLANZANOVA' })).data.creditore, 'AUTOLANZANOVA', 'senza «Auto» uguale non c\'è corrispondenza: nuovo');
    assertEq((await crea2({ nome: 'y', creditore: 'lanzanova auto' })).data.creditore, 'Lanzanova Auto');
    assertEq((await crea2({ nome: 'z', creditore: ' a2a ' })).data.creditore, 'A2A');
  });
  await test('un nome nuovo si aggiunge da solo alla lista (una volta), uno già in lista no', async () => {
    assertEq(nomiForn().includes('AUTOLANZANOVA'), true);
    const n0 = nomiForn().length;
    await crea2({ nome: 'w', creditore: 'AUTOLANZANOVA' }); await crea2({ nome: 'v', creditore: 'a2a' });
    assertEq(nomiForn().length, n0, 'nessun doppione');
  });
  await test('l\'elenco dei suggerimenti ha prima la lista (in ordine alfabetico), poi i valori già usati e non in lista', async () => {
    const v = await valori('creditore', 'piani2');
    assertEq(v.slice(0, 2), ['A2A', 'AUTOLANZANOVA']); assertEq(new Set(v.map((x) => x.toLowerCase())).size, v.length, 'nessun doppione');
  });

  console.log(`\n${'='.repeat(60)}`);
  console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
  try { fs.unlinkSync(dbPath); } catch (e) {}
  process.exit(failed > 0 ? 1 : 0);
}
main().catch((e) => { console.error('Suite valori-suggeriti fallita ad avviarsi:', e); process.exit(1); });
