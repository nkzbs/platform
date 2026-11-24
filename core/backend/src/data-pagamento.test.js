'use strict';
// Data di pagamento automatica (data-pagamento.js): una voce che passa a «fatto» senza data di pagamento la riceve (oggi); mai inventata altrove.
// Server reale, DB temporaneo. Eseguire con: node src/data-pagamento.test.js (porta 34881).
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const TEST_PORT = 34881;
const BASE = 'http://localhost:' + TEST_PORT;
process.env.DB_PATH = path.join(os.tmpdir(), 'datapag-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'dp_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'dp_internal_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'dp_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-uploads-'));
process.env.SUPER_ADMIN_URL = 'http://localhost:1';
process.env.TENANT_SLUG = 'dp';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; }
}
const eq = (a, e, m) => { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${m || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); };

const F = (key, label, type) => ({ id: 'f_' + key, block_type: 'field', key, label, type });
const SPESE = { version: 3, steps: [F('descrizione', 'Descrizione', 'text'), F('importo', 'Importo', 'currency'), F('data', 'Data', 'date'), F('scadenza', 'Scadenza', 'date'), F('data_pagamento', 'Data pagamento', 'date')] };
const AV = { states: { nuovo: '', da_fare: 'da_pagare', fatto: 'pagato' }, scadenze: true };

async function main() {
  const { applica, oggi, giornoDiPagamento } = require('./data-pagamento');
  require('./index.js');
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
  const db = require('./db');
  const roles = require('./module-roles');
  const add = (slug) => db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES (?, ?, 'box', '#000', 1, 1, 70, ?)").run(slug, slug, JSON.stringify(SPESE));
  add('con'); add('senza'); add('pag27');
  roles.set('con', { kind: 'spesa', uses: ['avvisi'], roles: { importo: 'importo', scadenza: 'scadenza', descrizione: 'descrizione', data_pagamento: 'data_pagamento' }, avvisi: AV });
  roles.set('pag27', { kind: 'spesa', uses: ['avvisi'], roles: { importo: 'importo', data: 'data', scadenza: 'scadenza', descrizione: 'descrizione', data_pagamento: 'data_pagamento' }, avvisi: AV, competenza: { giorno: 27 } });
  roles.set('senza', { kind: 'spesa', uses: ['avvisi'], roles: { importo: 'importo', scadenza: 'scadenza', descrizione: 'descrizione' }, avvisi: AV });
  const login = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: process.env.INITIAL_ADMIN_PASSWORD }) })).json();
  const H = { Authorization: 'Bearer ' + login.token, 'Content-Type': 'application/json' };
  const crea = async (slug, body) => (await (await fetch(BASE + '/api/records/' + slug, { method: 'POST', headers: H, body: JSON.stringify(body) })).json());
  const modifica = async (slug, id, body) => (await (await fetch(BASE + '/api/records/' + slug + '/' + id, { method: 'PUT', headers: H, body: JSON.stringify(body) })).json());

  console.log('\n--- la data di oggi ---');
  await test('«oggi» è la data italiana (non quella UTC) e ha la forma AAAA-MM-GG', async () => {
    eq(oggi(new Date('2026-11-24T23:30:00Z')), '2026-11-25', 'dopo mezzanotte in Italia è già il giorno dopo');
    eq(oggi(new Date('2026-06-24T10:00:00Z')), '2026-06-24');
  });

  console.log('\n--- il giorno di pagamento (il 27 del mese della scadenza) ---');
  await test('il 27 del mese della scadenza, qualunque sia il giorno: 15 novembre → 27 novembre; 28 novembre → 27 novembre; 5 gennaio → 27 gennaio', async () => {
    eq(giornoDiPagamento('2026-11-15', 27), '2026-11-27'); eq(giornoDiPagamento('2026-11-28', 27), '2026-11-27'); eq(giornoDiPagamento('2027-01-05', 27), '2027-01-27');
    eq(giornoDiPagamento('', 27), null); eq(giornoDiPagamento('2026-12-01', 0), null); eq(giornoDiPagamento('15/11/2026', 27), null);
  });

  console.log('\n--- nei record ---');
  await test('da pagare → pagato (modifica a mano) senza data di pagamento: la compila con oggi', async () => {
    const a = await crea('con', { descrizione: 'A', importo: 10, scadenza: '2026-11-30', _stato: 'da_pagare' });
    const m = await modifica('con', a.id, { ...a.data, _stato: 'pagato' });
    eq(m.data.data_pagamento, oggi());
  });
  await test('se la data di pagamento c\'è già (scritta a mano o da Smista), resta quella', async () => {
    const a = await crea('con', { descrizione: 'B', importo: 10, scadenza: '2026-11-30', _stato: 'da_pagare' });
    const m = await modifica('con', a.id, { ...a.data, _stato: 'pagato', data_pagamento: '2026-11-02' });
    eq(m.data.data_pagamento, '2026-11-02');
  });
  await test('una riga creata già pagata non riceve una data inventata', async () => {
    const a = await crea('con', { descrizione: 'C', importo: 10, scadenza: '2026-11-30', _stato: 'pagato' });
    eq(a.data.data_pagamento, undefined);
  });
  await test('una riga già pagata che si modifica (altro campo) non riceve la data', async () => {
    const a = await crea('con', { descrizione: 'D', importo: 10, scadenza: '2026-11-30', _stato: 'pagato' });
    const m = await modifica('con', a.id, { ...a.data, importo: 99 });
    eq(m.data.data_pagamento, undefined);
  });
  await test('un passaggio verso altri stati non scrive nulla', async () => {
    const a = await crea('con', { descrizione: 'E', importo: 10, scadenza: '2026-11-30', _stato: 'da_pagare' });
    const m = await modifica('con', a.id, { ...a.data, importo: 11 });
    eq(m.data.data_pagamento, undefined);
  });
  await test('un modulo senza il ruolo data_pagamento non cambia', async () => {
    const a = await crea('senza', { descrizione: 'F', importo: 10, scadenza: '2026-11-30', _stato: 'da_pagare' });
    const m = await modifica('senza', a.id, { ...a.data, _stato: 'pagato' });
    eq(m.data.data_pagamento, undefined);
  });
  await test('con il giorno di pagamento dichiarato: scadenza 30/3 (competenza aprile) pagata a mano → 27 marzo, non oggi', async () => {
    const a = await crea('pag27', { descrizione: 'G', importo: 10, scadenza: '2026-03-30', _stato: 'da_pagare' });
    eq(a.data.data, '2026-04-01', 'la competenza è aprile');
    const m = await modifica('pag27', a.id, { ...a.data, _stato: 'pagato' });
    eq(m.data.data_pagamento, '2026-03-27');
  });
  await test('scadenza a metà mese (15/3): il 27 dello stesso mese, come nello storico di Collections', async () => {
    const a = await crea('pag27', { descrizione: 'G2', importo: 10, scadenza: '2026-03-15', _stato: 'da_pagare' });
    const m = await modifica('pag27', a.id, { ...a.data, _stato: 'pagato' });
    eq(m.data.data_pagamento, '2026-03-27');
  });
  await test('mai nel futuro: una voce di competenza lontana, segnata pagata oggi, riceve oggi', async () => {
    const a = await crea('pag27', { descrizione: 'H', importo: 10, scadenza: '2099-03-30', _stato: 'da_pagare' });
    const m = await modifica('pag27', a.id, { ...a.data, _stato: 'pagato' });
    eq(m.data.data_pagamento, oggi());
  });
  await test('applica(): senza «prima» (creazione) o con lo stato già «fatto» restituisce gli stessi dati', async () => {
    const d = { _stato: 'pagato', descrizione: 'x' };
    eq(applica('con', d, null), d);
    eq(applica('con', d, { _stato: 'pagato' }), d);
  });

  console.log(`\n${'='.repeat(60)}\n${passed} passati, ${failed} falliti su ${passed + failed} test.`);
  try { fs.unlinkSync(process.env.DB_PATH); } catch (e) {}
  process.exit(failed > 0 ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
