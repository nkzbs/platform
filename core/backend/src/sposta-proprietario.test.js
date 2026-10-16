'use strict';
// Spostare una riga in un altro modulo di spesa (routes/smista.js) e proprietario delle righe automatiche (record-owner.js, routes/record-owner.js).
// Server reale, DB temporaneo. Eseguire con: node src/sposta-proprietario.test.js (porta 34815).

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const TEST_PORT = 34815;
const BASE = 'http://localhost:' + TEST_PORT;
const dbPath = path.join(os.tmpdir(), 'sposta-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.DB_PATH = dbPath;
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'sposta_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'sposta_internal_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'sposta_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sposta-uploads-'));
process.env.SUPER_ADMIN_URL = 'http://localhost:1';
process.env.TENANT_SLUG = 'sposta';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; }
}
function assertEq(a, e, msg) { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${msg || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); }
function assertTrue(c, msg) { if (!c) throw new Error(msg || 'atteso true'); }

const F = (key, label, type, extra = {}) => ({ id: 'f_' + key, block_type: 'field', key, label, type, ...extra });
const WF = [
  { id: 'w1', block_type: 'workflow_state', key: 'da_smistare', label: 'Da smistare', initial: true }, { id: 'w2', block_type: 'workflow_state', key: 'da_pagare', label: 'Da pagare' }, { id: 'w3', block_type: 'workflow_state', key: 'pagato', label: 'Pagato' },
  { id: 't1', block_type: 'workflow_transition', from: 'da_smistare', to: 'da_pagare', label: 'Conferma' }, { id: 't2', block_type: 'workflow_transition', from: 'da_pagare', to: 'pagato', label: 'Pagata' },
];
// Casa: campi "importo/data/categoria/descrizione" + una nota
const CASA = { version: 3, steps: [F('descrizione', 'Descrizione', 'text'), F('importo', 'Importo', 'currency'), F('data', 'Data', 'date'), F('categoria', 'Categoria', 'select', { options: ['Luce', 'Gas', 'Affitto'] }), F('note', 'Note', 'textarea'), ...WF] };
// Personale: l'importo e la descrizione hanno un altro nome, la categoria ha altre opzioni, non c'è il campo note
const PERS = { version: 3, steps: [F('titolo', 'Titolo', 'text'), F('totale', 'Totale', 'currency'), F('quando', 'Quando', 'date'), F('tipo', 'Tipo', 'select', { options: ['Luce', 'Svago', 'Auto'] }), ...WF] };

async function main() {
  require('./index.js');
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
  const db = require('./db');
  const roles = require('./module-roles');
  const owner = require('./record-owner');
  const add = (slug, schema) => db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES (?, ?, 'box', '#000', 1, 1, 70, ?)").run(slug, slug, JSON.stringify(schema));
  const AV = { states: { nuovo: 'da_smistare', da_fare: 'da_pagare', fatto: 'pagato' }, nuovo: true };
  add('casa', CASA); add('personale', PERS); add('entrate_x', CASA);
  roles.set('casa', { kind: 'spesa', uses: ['avvisi'], roles: { importo: 'importo', data: 'data', categoria: 'categoria', descrizione: 'descrizione', stato: '_stato' }, avvisi: AV });
  roles.set('personale', { kind: 'spesa', uses: ['avvisi'], roles: { importo: 'totale', data: 'quando', categoria: 'tipo', descrizione: 'titolo', stato: '_stato' }, avvisi: AV });
  roles.set('entrate_x', { kind: 'entrata', uses: ['avvisi'], roles: { importo: 'importo', data: 'data', descrizione: 'descrizione', stato: '_stato' }, avvisi: AV });

  const login = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: process.env.INITIAL_ADMIN_PASSWORD }) })).json();
  const H = { Authorization: 'Bearer ' + login.token, 'Content-Type': 'application/json' };
  const adminId = db.prepare("SELECT id FROM users WHERE username = 'admin'").get().id;
  db.prepare("INSERT INTO users (id, username, password_hash, display_name, role) VALUES (5, 'nima_t', 'x', 'Nima', 'user'), (7, 'fede_t', 'x', 'Fede', 'user')").run();
  const post = (slug, id, body) => fetch(BASE + '/api/smista/' + slug + '/' + id, { method: 'POST', headers: H, body: JSON.stringify(body) });
  const riga = (slug, data, uid = null) => db.prepare('INSERT INTO records (module_slug, user_id, data) VALUES (?, ?, ?)').run(slug, uid, JSON.stringify(data)).lastInsertRowid;
  const rec = (id) => { const r = db.prepare('SELECT * FROM records WHERE id = ?').get(id); return r ? { ...r, d: JSON.parse(r.data) } : null; };
  const base = (extra = {}) => ({ descrizione: 'Cena', importo: 42, data: '2026-10-05', categoria: 'Luce', note: 'ricevuta in cassetto', _stato: 'da_smistare', ...extra });

  console.log('\n--- sposta in un altro modulo di spesa ---');
  await test('le destinazioni sono solo i moduli dello stesso tipo, con l\'elenco di ciò che non passerebbe', async () => {
    const id = riga('casa', base());
    const dest = await (await fetch(BASE + '/api/smista/casa/' + id + '/destinazioni', { headers: H })).json();
    assertEq(dest.map((d) => d.slug), ['personale'], 'niente moduli di entrata né se stesso');
    assertTrue(dest[0].persi.some((p) => p.key === 'note'), 'le note non esistono in destinazione');
  });
  await test('si sposta abbinando i campi per ruolo (importo -> totale, descrizione -> titolo), lo stato resta "da smistare"', async () => {
    const id = riga('casa', base({ categoria: 'Luce' }), 7);
    const r = await post('casa', id, { modo: 'sposta', verso: 'personale' });
    assertEq(r.status, 200); const j = await r.json();
    const x = rec(id);
    assertEq(x.module_slug, 'personale'); assertEq(x.d.titolo, 'Cena'); assertEq(x.d.totale, 42); assertEq(x.d.quando, '2026-10-05'); assertEq(x.d.tipo, 'Luce'); assertEq(x.d._stato, 'da_smistare');
    assertEq(x.user_id, 7, 'il proprietario resta lo stesso');
    assertTrue(j.persi.some((p) => p.key === 'note') && /Note/.test(j.message), 'dice cosa non è passato');
    assertTrue(!('note' in x.d) && !('descrizione' in x.d), 'nessun campo con il vecchio nome');
  });
  await test('una categoria non prevista in destinazione non passa, ed è segnalata', async () => {
    const id = riga('casa', base({ categoria: 'Affitto' }));
    const j = await (await post('casa', id, { modo: 'sposta', verso: 'personale' })).json();
    assertTrue(j.persi.some((p) => p.key === 'categoria' && /non previsto/.test(p.motivo)), JSON.stringify(j.persi));
    assertTrue(!('tipo' in rec(id).d), 'la categoria non c\'è');
  });
  await test('una riga senza proprietario diventa di chi la sposta (altrimenti nessuno la vedrebbe)', async () => {
    const id = riga('casa', base());
    await post('casa', id, { modo: 'sposta', verso: 'personale' });
    assertEq(rec(id).user_id, adminId);
  });
  await test('gli allegati seguono la riga', async () => {
    const id = riga('casa', base());
    const up = db.prepare("INSERT INTO uploads (original_name, stored_name, mime_type, size) VALUES ('b.pdf', 'b.pdf', 'application/pdf', 10)").run().lastInsertRowid;
    db.prepare("INSERT INTO record_attachments (module_slug, record_id, upload_id) VALUES ('casa', ?, ?)").run(id, up);
    await post('casa', id, { modo: 'sposta', verso: 'personale' });
    assertEq(db.prepare("SELECT module_slug m FROM record_attachments WHERE record_id = ?").get(id).m, 'personale');
  });
  await test('lo spostamento è nella cronologia della riga', async () => {
    const id = riga('casa', base());
    await post('casa', id, { modo: 'sposta', verso: 'personale' });
    assertEq(db.prepare("SELECT COUNT(*) c FROM record_history WHERE module_slug = 'personale' AND record_id = ?").get(id).c, 1);
  });
  await test('si rifiuta: verso un modulo di tipo diverso, verso se stessi, o una riga già smistata', async () => {
    const a = riga('casa', base()); assertEq((await post('casa', a, { modo: 'sposta', verso: 'entrate_x' })).status, 400);
    assertEq((await post('casa', a, { modo: 'sposta', verso: 'casa' })).status, 400);
    assertEq(rec(a).module_slug, 'casa', 'non si è mossa');
    const b = riga('casa', base({ _stato: 'da_pagare' })); assertEq((await post('casa', b, { modo: 'sposta', verso: 'personale' })).status, 409);
  });

  console.log('\n--- proprietario delle righe automatiche ---');
  await test('senza impostazione il proprietario predefinito è nessuno; dopo l\'impostazione è quello scelto', async () => {
    assertEq(owner.defaultOwnerId(), null);
    const r = await fetch(BASE + '/api/record-owner', { method: 'PUT', headers: H, body: JSON.stringify({ user_id: adminId }) });
    assertEq(r.status, 200); assertEq(owner.defaultOwnerId(), adminId);
    assertEq((await fetch(BASE + '/api/record-owner', { method: 'PUT', headers: H, body: JSON.stringify({ user_id: 9999 }) })).status, 400, 'utente inesistente');
  });
  await test('una riga generata da un\'altra prende il proprietario di quella; senza, il predefinito', async () => {
    const madre = riga('casa', base(), 7);
    assertEq(owner.ownerFor(madre), 7);
    const orfana = riga('casa', base(), null);
    assertEq(owner.ownerFor(orfana), adminId);
  });
  await test('la riassegnazione: anteprima che non scrive, poi la scrittura; solo l\'admin e solo lì dove serve', async () => {
    db.prepare("DELETE FROM records WHERE module_slug = 'casa'").run();
    riga('casa', base(), null); riga('casa', base(), adminId); riga('casa', base(), 7);
    const st = await (await fetch(BASE + '/api/record-owner', { headers: H })).json();
    const m = st.moduli.find((x) => x.slug === 'casa'); assertEq([m.senza_proprietario, m.di_admin], [1, 1]);
    // ricevente = 5 (utente di prova creato qui)
    const dry = await (await fetch(BASE + '/api/record-owner/assign', { method: 'POST', headers: H, body: JSON.stringify({ module_slug: 'casa', to_user_id: 5, from: 'entrambi', dry_run: true }) })).json();
    assertEq(dry.righe, 2); assertEq(db.prepare("SELECT COUNT(*) c FROM records WHERE module_slug = 'casa' AND user_id = 5").get().c, 0, 'l\'anteprima non scrive');
    const w = await (await fetch(BASE + '/api/record-owner/assign', { method: 'POST', headers: H, body: JSON.stringify({ module_slug: 'casa', to_user_id: 5, from: 'entrambi' }) })).json();
    assertEq(w.righe, 2); assertEq(db.prepare("SELECT COUNT(*) c FROM records WHERE module_slug = 'casa' AND user_id = 5").get().c, 2);
    assertEq(db.prepare("SELECT COUNT(*) c FROM records WHERE module_slug = 'casa' AND user_id = 7").get().c, 1, 'quelle di un altro utente non si toccano');
    assertEq((await fetch(BASE + '/api/record-owner')).status, 401, 'senza accesso non si legge');
  });

  console.log(`\n${'='.repeat(60)}`);
  console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
  try { fs.unlinkSync(dbPath); } catch (e) {}
  process.exit(failed > 0 ? 1 : 0);
}
main().catch((e) => { console.error('Suite sposta-proprietario fallita ad avviarsi:', e); process.exit(1); });
