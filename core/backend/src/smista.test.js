'use strict';
// Smistare una riga "nuova" (routes/smista.js): un pagamento solo, in rate (il piano genera le righe), già pagata, e i casi in cui si rifiuta.
// Server reale, DB temporaneo. Eseguire con: node src/smista.test.js (porta 34811).

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const TEST_PORT = 34811;
const BASE = 'http://localhost:' + TEST_PORT;
const dbPath = path.join(os.tmpdir(), 'smista-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.DB_PATH = dbPath;
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'smista_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'smista_internal_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'smista_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'smista-uploads-'));
process.env.SUPER_ADMIN_URL = 'http://localhost:1';
process.env.TENANT_SLUG = 'smista';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; }
}
function assertEq(a, e, msg) { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${msg || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); }
function assertTrue(c, msg) { if (!c) throw new Error(msg || 'atteso true'); }

const F = (key, label, type, extra = {}) => ({ id: 'f_' + key, block_type: 'field', key, label, type, ...extra });
const SPESE = { version: 3, steps: [
  F('descrizione', 'Descrizione', 'text'), F('importo', 'Importo', 'currency'), F('data', 'Data', 'date'), F('scadenza', 'Scadenza', 'date'),
  F('categoria', 'Categoria', 'select', { options: ['Luce', 'Gas', 'Altro'] }), F('data_pagamento', 'Pagata il', 'date'),
  { id: 'w1', block_type: 'workflow_state', key: 'da_smistare', label: 'Da smistare', initial: true }, { id: 'w2', block_type: 'workflow_state', key: 'da_pagare', label: 'Da pagare' }, { id: 'w3', block_type: 'workflow_state', key: 'pagato', label: 'Pagato' },
  { id: 't1', block_type: 'workflow_transition', from: 'da_smistare', to: 'da_pagare', label: 'Conferma' }, { id: 't2', block_type: 'workflow_transition', from: 'da_pagare', to: 'pagato', label: 'Segna pagato' },
] };
const DEBITI = { version: 3, steps: [
  F('nome', 'Nome', 'text'), F('importo_totale', 'Totale', 'currency'), F('n_rate', 'Rate', 'number'), F('importo_rata', 'Rata', 'currency'), F('data_prima_rata', 'Prima rata', 'date'),
  { id: 'ws1', block_type: 'workflow_state', key: 'attivo', label: 'Attivo', initial: true },
  { id: 'aut', block_type: 'automation', label: 'Crea piano rateale', trigger: { evento: 'nuovo_record' }, azioni: [{ target: '__interno__', azione: 'crea_record_n_volte', config: { modulo: 'costi', n_field: 'n_rate',
    dati: { descrizione: 'campo:nome', importo: 'campo:importo_rata', data: 'mese_offset:data_prima_rata', categoria: 'Altro', debito: '__origine_id__', _stato: 'da_pagare' } } }] },
] };

async function main() {
  require('./index.js');
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
  const db = require('./db');
  const roles = require('./module-roles');
  const add = (slug, schema) => db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES (?, ?, 'box', '#000', 1, 1, 70, ?)").run(slug, slug, JSON.stringify(schema));
  add('costi', SPESE); add('piani', DEBITI);
  const R = { importo: 'importo', data: 'data', scadenza: 'scadenza', categoria: 'categoria', descrizione: 'descrizione', stato: '_stato', data_pagamento: 'data_pagamento' };
  const campi = { nome: 'nome', importo_totale: 'importo_totale', n_rate: 'n_rate', importo_rata: 'importo_rata', data_prima_rata: 'data_prima_rata' };
  roles.set('costi', { kind: 'spesa', uses: ['avvisi'], roles: R, avvisi: { states: { nuovo: 'da_smistare', da_fare: 'da_pagare', fatto: 'pagato' }, piano: { modulo: 'piani', campi }, nuovo: true, scadenze: true } });
  add('senza_piano', SPESE);
  roles.set('senza_piano', { kind: 'spesa', uses: ['avvisi'], roles: R, avvisi: { states: { nuovo: 'da_smistare', da_fare: 'da_pagare', fatto: 'pagato' }, nuovo: true } });

  const login = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: process.env.INITIAL_ADMIN_PASSWORD }) })).json();
  const H = { Authorization: 'Bearer ' + login.token, 'Content-Type': 'application/json' };
  const post = (slug, id, body, h = H) => fetch(BASE + '/api/smista/' + slug + '/' + id, { method: 'POST', headers: h, body: JSON.stringify(body) });
  const newRow = (slug = 'costi', extra = {}) => db.prepare('INSERT INTO records (module_slug, user_id, data) VALUES (?, NULL, ?)').run(slug, JSON.stringify({ descrizione: 'A2A Energia', importo: 90, data: '2026-10-01', scadenza: '2026-10-31', categoria: 'Altro', _stato: 'da_smistare', ...extra })).lastInsertRowid;
  const data = (id) => { const r = db.prepare('SELECT data FROM records WHERE id = ?').get(id); return r ? JSON.parse(r.data) : null; };

  console.log('\n--- un pagamento solo ---');
  await test('passa a "da pagare" con le modifiche fatte nel pannello (importo, scadenza, categoria)', async () => {
    const id = newRow();
    const r = await post('costi', id, { modo: 'uno', importo: 80.5, scadenza: '2026-11-10', categoria: 'Luce' });
    assertEq(r.status, 200);
    const j = await r.json(); assertTrue(/da pagare/.test(j.message) && /10\/11\/2026/.test(j.message), j.message);
    const d = data(id); assertEq(d._stato, 'da_pagare'); assertEq(d.importo, 80.5); assertEq(d.scadenza, '2026-11-10'); assertEq(d.categoria, 'Luce');
    assertEq(db.prepare("SELECT COUNT(*) c FROM record_history WHERE module_slug = 'costi' AND record_id = ?").get(id).c, 1, 'la modifica è nello storico');
  });
  await test('una categoria che non è tra le opzioni del modulo si rifiuta e la riga non cambia', async () => {
    const id = newRow();
    assertEq((await post('costi', id, { modo: 'uno', categoria: 'Viaggi' })).status, 400);
    assertEq(data(id)._stato, 'da_smistare');
  });

  console.log('\n--- già pagata ---');
  await test('passa per "da pagare" e finisce "pagato", con la data di pagamento', async () => {
    const id = newRow();
    const r = await post('costi', id, { modo: 'pagata', data_pagamento: '2026-10-03' });
    assertEq(r.status, 200);
    const d = data(id); assertEq(d._stato, 'pagato'); assertEq(d.data_pagamento, '2026-10-03');
  });

  console.log('\n--- in rate ---');
  await test('crea il piano, le rate (dall\'automazione) sostituiscono la riga; gli allegati passano alla prima rata', async () => {
    const id = newRow('costi', { importo: 90, scadenza: '2026-11-05' });
    const up = db.prepare("INSERT INTO uploads (original_name, stored_name, mime_type, size) VALUES ('bolletta.pdf', 'x.pdf', 'application/pdf', 10)").run().lastInsertRowid;
    db.prepare("INSERT INTO record_attachments (module_slug, record_id, upload_id, tipo) VALUES ('costi', ?, ?, 'gmail')").run(id, up);
    const r = await post('costi', id, { modo: 'rate', n_rate: 3, data_prima_rata: '2026-11-05' });
    const j = await r.json(); assertEq(r.status, 200, JSON.stringify(j));
    assertEq(j.rate.length, 3); assertEq(j.rate.map((x) => x.importo), [30, 30, 30]);
    assertTrue(/Divisa in 3 rate da 30,00 €/.test(j.message), j.message);
    assertEq(data(id), null, 'la riga originale è sostituita dalle rate');
    const piano = JSON.parse(db.prepare('SELECT data FROM records WHERE id = ?').get(j.piano.id).data);
    assertEq(piano.nome, 'A2A Energia'); assertEq(piano.importo_totale, 90); assertEq(piano.n_rate, 3); assertEq(piano.importo_rata, 30);
    assertEq(j.rate.map((x) => data(x.id)._stato), ['da_pagare', 'da_pagare', 'da_pagare']);
    assertEq(db.prepare("SELECT record_id FROM record_attachments WHERE upload_id = ?").get(up).record_id, j.rate[0].id, 'il PDF segue la prima rata');
  });
  await test('rate con un importo che non si divide esatto: la rata è arrotondata e il messaggio dice quanto', async () => {
    const id = newRow('costi', { importo: 100 });
    const j = await (await post('costi', id, { modo: 'rate', n_rate: 3, data_prima_rata: '2026-11-05' })).json();
    assertEq(j.rate[0].importo, 33.33);
    assertTrue(/sommano 99,99 €, 0,01 € in meno/.test(j.message), j.message);
  });
  await test('senza importo, con un numero di rate sbagliato o senza data: si rifiuta e la riga non cambia', async () => {
    const a = newRow('costi', { importo: 0 }), b = newRow(), c = newRow('costi', { scadenza: undefined, data: undefined });
    assertEq((await post('costi', a, { modo: 'rate', n_rate: 3, data_prima_rata: '2026-11-05' })).status, 400);
    assertEq((await post('costi', b, { modo: 'rate', n_rate: 1, data_prima_rata: '2026-11-05' })).status, 400);
    assertEq((await post('costi', b, { modo: 'rate', n_rate: 99, data_prima_rata: '2026-11-05' })).status, 400);
    assertEq((await post('costi', c, { modo: 'rate', n_rate: 3 })).status, 400);
    for (const x of [a, b, c]) assertEq(data(x)._stato, 'da_smistare');
  });
  await test('un modulo senza piano a rate dichiarato non può dividere in rate', async () => {
    const id = newRow('senza_piano');
    const r = await post('senza_piano', id, { modo: 'rate', n_rate: 3, data_prima_rata: '2026-11-05' });
    assertEq(r.status, 400); assertEq(data(id)._stato, 'da_smistare');
  });

  console.log('\n--- i casi in cui si rifiuta ---');
  await test('una riga già smistata non si smista due volte (409)', async () => {
    const id = newRow(); await post('costi', id, { modo: 'uno' });
    assertEq((await post('costi', id, { modo: 'uno' })).status, 409);
  });
  await test('modo mancante o strano -> 400; riga inesistente -> 404; senza login -> 401', async () => {
    const id = newRow();
    assertEq((await post('costi', id, {})).status, 400); assertEq((await post('costi', id, { modo: 'boh' })).status, 400);
    assertEq((await post('costi', 999999, { modo: 'uno' })).status, 404);
    assertEq((await fetch(BASE + '/api/smista/spese/' + id, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
  });
  await test('un modulo che non ha dichiarato gli stati -> 400', async () => {
    add('muto', SPESE); roles.set('muto', { kind: 'spesa', uses: [], roles: R });
    const id = newRow('muto'); assertEq((await post('muto', id, { modo: 'uno' })).status, 400);
  });

  console.log(`\n${'='.repeat(60)}`);
  console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
  try { fs.unlinkSync(dbPath); } catch (e) {}
  process.exit(failed > 0 ? 1 : 0);
}
main().catch((e) => { console.error('Suite smista fallita ad avviarsi:', e); process.exit(1); });
