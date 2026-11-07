'use strict';
// Provvigione a due parti (seed `estensioni-immobiliare.json`): campi e calcoli sul modulo Provvigioni,
// venditore/acquirente/percentuali sulla Trattativa e automazione che alla firma del preliminare crea
// una riga per parte, una volta sola. Server reale, DB temporaneo. Eseguire con: node src/provvigioni-due-parti.test.js (porta 34836).

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const TEST_PORT = 34836;
const BASE = 'http://localhost:' + TEST_PORT;
process.env.DB_PATH = path.join(os.tmpdir(), 'prov-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'prov_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'prov_internal_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'prov_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'prov-uploads-'));
process.env.SUPER_ADMIN_URL = 'http://localhost:1';
process.env.TENANT_SLUG = 'prov';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; }
}
function assertEq(a, e, msg) { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${msg || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); }
function assertTrue(c, msg) { if (!c) throw new Error(msg || 'atteso true'); }
const F = (key, label, type = 'text', extra = {}) => ({ id: 'f_' + key, block_type: 'field', key, label, type, ...extra });

async function main() {
  require('./index.js');
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
  const db = require('./db');
  const { applicaSeed } = require('./seed-blocchi-verticale');
  const seed = require('../../../super-admin/backend/src/pacchetti/mediazione-immobiliare/estensioni.json');

  const mk = (slug, steps) => db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES (?, ?, 'box', '#000', 1, 1, 70, ?)").run(slug, slug, JSON.stringify({ version: 3, steps }));
  const rec = (slug, data) => db.prepare('INSERT INTO records (module_slug, data) VALUES (?, ?)').run(slug, JSON.stringify(data)).lastInsertRowid;
  const schemaDi = (slug) => JSON.parse(db.prepare('SELECT schema_json FROM modules WHERE slug = ?').get(slug).schema_json);

  mk('clienti', [F('nome', 'Nome')]);
  // Come i moduli di zucca prima dell'estensione: Provvigioni con importo a mano, Trattative con un solo cliente.
  mk('provvigioni', [
    F('descrizione', 'Descrizione'), { id: 'r1', block_type: 'relation', key: 'trattativa', label: 'Trattativa', type: 'many_to_one', target_module: 'trattative', display_field: 'titolo' },
    { id: 'r2', block_type: 'relation', key: 'cliente', label: 'Cliente', type: 'many_to_one', target_module: 'clienti', display_field: 'nome' },
    F('tipo', 'Tipo', 'select', { options: ['Provvigione preliminare', 'Provvigione rogito', 'Altro'] }), F('importo', 'Importo', 'currency'), F('data_scadenza', 'Scadenza', 'date'),
    { id: 'w1', block_type: 'workflow_state', key: 'da_fatturare', label: 'Da fatturare', initial: true }, { id: 'w2', block_type: 'workflow_state', key: 'fatturata', label: 'Fatturata' },
    { id: 'wt', block_type: 'workflow_transition', from: 'da_fatturare', to: 'fatturata', label: 'Fattura emessa', roles: ['admin'] },
  ]);
  mk('trattative', [
    F('titolo', 'Titolo'), F('prezzo_concordato', 'Prezzo concordato', 'currency'), F('data_rogito', 'Rogito', 'date'),
    { id: 's1', block_type: 'workflow_state', key: 'trattativa_in_corso', label: 'In corso', initial: true },
    { id: 's2', block_type: 'workflow_state', key: 'preliminare_firmato', label: 'Preliminare firmato' },
    { id: 't1', block_type: 'workflow_transition', from: 'trattativa_in_corso', to: 'preliminare_firmato', label: 'Firma', roles: ['admin'] },
    { id: 't2', block_type: 'workflow_transition', from: 'preliminare_firmato', to: 'trattativa_in_corso', label: 'Riapri', roles: ['admin'] },
  ]);
  const idLegacy = rec('provvigioni', { descrizione: 'Vecchia', importo: 5000, _stato: 'da_fatturare' });

  console.log('\n--- applicazione del seed ---');
  await test('le due estensioni si applicano nell\'ordine giusto (Provvigioni, poi Trattative) e passano dalla validazione', async () => {
    const esiti = await applicaSeed(seed, { tipo: 'estensione' });
    // Il seed ha anche le estensioni di Immobili e Clienti (scheda completa): qui il modulo Clienti c'è, Immobili no.
    assertEq(esiti.filter((e) => ['provvigioni', 'trattative'].includes(e.slug) && e.key !== 'allegati').map((e) => e.slug + ':' + e.esito), ['provvigioni:applicato', 'trattative:applicato']);
    const prov = schemaDi('provvigioni').steps.filter((x) => x.block_type === 'field').map((x) => x.key);
    for (const k of ['parte', 'percentuale', 'base_imponibile', 'importo_netto', 'iva', 'totale', 'importo']) assertTrue(prov.includes(k), 'manca ' + k);
    const tr = schemaDi('trattative').steps;
    assertTrue(tr.some((x) => x.block_type === 'automation'), 'manca l\'automazione');
    assertTrue(tr.some((x) => x.block_type === 'relation' && x.key === 'venditore') && tr.some((x) => x.block_type === 'relation' && x.key === 'acquirente'));
  });
  await test('secondo avvio: niente da fare', async () => { assertEq(await applicaSeed(seed, { tipo: 'estensione' }), []); });

  const login = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: process.env.INITIAL_ADMIN_PASSWORD }) })).json();
  const H = { Authorization: 'Bearer ' + login.token, 'Content-Type': 'application/json' };
  const api = (m, p, body) => fetch(BASE + '/api' + p, { method: m, headers: H, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, body: await r.json() }));

  console.log('\n--- calcoli sul modulo Provvigioni ---');
  await test('importo netto, IVA e totale dalla percentuale e dal prezzo', async () => {
    const r = await api('POST', '/records/provvigioni', { descrizione: 'Prova', base_imponibile: 250000, percentuale: 3, parte: 'Venditore' });
    assertEq(r.status, 200);
    const d = (await api('GET', '/records/provvigioni/' + r.body.id)).body.data;
    assertEq([d.importo_netto, d.iva, d.totale], [7500, 1650, 9150]);
  });
  await test('una provvigione vecchia, con il solo importo a mano, continua a funzionare', async () => {
    const d = (await api('GET', '/records/provvigioni/' + idLegacy)).body.data;
    assertEq([d.importo_netto, d.iva, d.totale], [5000, 1100, 6100]);
  });

  console.log('\n--- alla firma del preliminare ---');
  const cV = rec('clienti', { nome: 'Venditore Verdi' }), cA = rec('clienti', { nome: 'Acquirente Bianchi' });
  const trattativa = async (dati) => (await api('POST', '/records/trattative', { titolo: 'Vendita', _stato: 'trattativa_in_corso', prezzo_concordato: 200000, data_rogito: '2027-02-15', ...dati })).body.id;
  const delle = (idT) => db.prepare("SELECT data FROM records WHERE module_slug = 'provvigioni'").all().map((r) => JSON.parse(r.data)).filter((d) => d.trattativa === idT);
  const firma = (id, to = 'preliminare_firmato') => api('POST', '/records/trattative/' + id + '/transition', { to });

  await test('una riga per parte: cliente, percentuale, prezzo, scadenza al rogito, da fatturare', async () => {
    const t = await trattativa({ venditore: cV, acquirente: cA, prov_venditore_perc: 3, prov_acquirente_perc: 2 });
    assertEq((await firma(t)).status, 200);
    const righe = delle(t).sort((a, b) => a.parte.localeCompare(b.parte));
    assertEq(righe.length, 2);
    assertEq(righe.map((r) => [r.parte, r.cliente, r.percentuale, r.base_imponibile, r.data_scadenza, r._stato]),
      [['Acquirente', cA, 2, 200000, '2027-02-15', 'da_fatturare'], ['Venditore', cV, 3, 200000, '2027-02-15', 'da_fatturare']]);
    assertTrue(JSON.parse(db.prepare('SELECT data FROM records WHERE id = ?').get(t).data).provvigioni_generate_il, 'segno «generate il» mancante');
  });
  await test('riaprire e rifirmare NON duplica le provvigioni', async () => {
    const t = await trattativa({ venditore: cV, acquirente: cA, prov_venditore_perc: 3, prov_acquirente_perc: 2 });
    await firma(t); await firma(t, 'trattativa_in_corso'); await firma(t);
    assertEq(delle(t).length, 2);
  });
  await test('una parte senza percentuale non genera la sua riga', async () => {
    const t = await trattativa({ venditore: cV, prov_venditore_perc: 3 });
    await firma(t);
    assertEq(delle(t).map((r) => r.parte), ['Venditore']);
  });
  await test('nessuna percentuale: nessuna riga, e dopo averle indicate si può rigenerare', async () => {
    const t = await trattativa({ venditore: cV });
    await firma(t);
    assertEq(delle(t).length, 0);
    assertTrue(!JSON.parse(db.prepare('SELECT data FROM records WHERE id = ?').get(t).data).provvigioni_generate_il, 'il segno non va scritto se non è nata nessuna riga');
    await api('PUT', '/records/trattative/' + t, { ...JSON.parse(db.prepare('SELECT data FROM records WHERE id = ?').get(t).data), prov_venditore_perc: 3 });
    await firma(t, 'trattativa_in_corso'); await firma(t);
    assertEq(delle(t).map((r) => r.parte), ['Venditore']);
  });

  console.log(`\n${passed} passati, ${failed} falliti`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
