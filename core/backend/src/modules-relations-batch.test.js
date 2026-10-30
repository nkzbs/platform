'use strict';
// POST /api/modules/internal/apply-relations-batch (routes/modules.js): scrive relazioni
// nuove tra moduli appena installati durante la creazione di un tenant da Analisi (Super
// Admin, lib/analysis.js proponiRelazioni) — mai sovrascrive, mai duplica, mai verso se
// stesso, solo registry_module_id veri su questo tenant. Server reale, DB temporaneo.
// Eseguire con: node src/modules-relations-batch.test.js (porta 34823).

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const TEST_PORT = 34823;
const BASE = 'http://localhost:' + TEST_PORT;
const SECRET = 'relbatch_internal_' + crypto.randomBytes(8).toString('hex');
process.env.DB_PATH = path.join(os.tmpdir(), 'modules-relbatch-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'relbatch_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = SECRET;
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'relbatch-uploads-'));

let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); console.log('  ✓ ' + name); passed++; } catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; } }
const eq = (a, e, m) => { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${m || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m || 'atteso true'); };

async function main() {
  require('./index.js');
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
  const db = require('./db');
  const call = (relations) => fetch(BASE + '/api/modules/internal/apply-relations-batch', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-secret': SECRET }, body: JSON.stringify({ relations }) });
  const mod = (slug, name, registryId, relations = []) => db.prepare("INSERT INTO modules (name, slug, icon, color, installed, schema_json, registry_module_id) VALUES (?, ?, 'box', '#000', 1, ?, ?)")
    .run(name, slug, JSON.stringify({ version: 3, steps: [{ id: 'f1', block_type: 'field', key: 'nome', label: 'Nome', type: 'text' }, ...relations] }), registryId);
  const relationsOf = (slug) => { const r = db.prepare('SELECT schema_json FROM modules WHERE slug = ?').get(slug); return JSON.parse(r.schema_json).steps.filter((s) => s.block_type === 'relation'); };

  console.log('\n--- senza il segreto interno ---');
  await test('senza x-internal-secret -> 401', async () => {
    const r = await fetch(BASE + '/api/modules/internal/apply-relations-batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"relations":[]}' });
    eq(r.status, 401);
  });

  console.log('\n--- scrive una relazione nuova ---');
  await test('da -> verso diventa una relazione many_to_one reale, con un\'etichetta sensata', async () => {
    mod('immobili', 'Immobili', 101);
    mod('appuntamenti', 'Appuntamenti', 102);
    const r = await call([{ registry_module_id: 102, target_registry_module_id: 101 }]);
    eq(r.status, 200); const b = await r.json();
    eq(b.results, [{ registry_module_id: 102, target_registry_module_id: 101, configured: true, key: 'immobili' }]);
    const rel = relationsOf('appuntamenti');
    eq(rel.length, 1); eq(rel[0].target_module, 'immobili'); eq(rel[0].type, 'many_to_one'); eq(rel[0].label, 'immobili');
    eq(relationsOf('immobili').length, 0, 'la relazione è solo sul modulo "da", non sul bersaglio');
  });

  console.log('\n--- non duplica, non scrive verso se stesso, non inventa moduli ---');
  await test('la stessa coppia da->verso una seconda volta: non configurata, non duplicata', async () => {
    const r = await (await call([{ registry_module_id: 102, target_registry_module_id: 101 }])).json();
    eq(r.results, [{ registry_module_id: 102, configured: false, reason: 'relazione_gia_presente' }]);
    eq(relationsOf('appuntamenti').length, 1);
  });
  await test('un modulo verso se stesso si rifiuta', async () => {
    const r = await (await call([{ registry_module_id: 101, target_registry_module_id: 101 }])).json();
    eq(r.results[0].reason, 'relazione_verso_se_stesso');
  });
  await test('un registry_module_id che questo tenant non ha installato si rifiuta', async () => {
    const r1 = await (await call([{ registry_module_id: 999999, target_registry_module_id: 101 }])).json();
    eq(r1.results[0].reason, 'modulo_non_trovato_sul_tenant');
    const r2 = await (await call([{ registry_module_id: 102, target_registry_module_id: 999999 }])).json();
    eq(r2.results[0].reason, 'modulo_bersaglio_non_trovato_sul_tenant');
  });
  await test('dati mancanti o relations vuoto: niente da fare, nessun errore 500', async () => {
    eq((await call([])).status, 400);
    const r = await (await call([{ registry_module_id: 102 }])).json();
    eq(r.results[0].reason, 'dati_mancanti');
  });

  console.log('\n--- mai sovrascrive una relazione già presente verso lo stesso bersaglio ---');
  await test('un modulo con già una relazione (anche con chiave/etichetta diverse) verso quel bersaglio non viene toccato', async () => {
    mod('pratiche', 'Pratiche', 103, [{ id: 'r1', block_type: 'relation', key: 'dossier_immobile', label: 'Immobile del dossier', type: 'many_to_one', target_module: 'immobili' }]);
    const r = await (await call([{ registry_module_id: 103, target_registry_module_id: 101 }])).json();
    eq(r.results[0].reason, 'relazione_gia_presente');
    eq(relationsOf('pratiche').length, 1, 'resta la relazione originale, non se ne aggiunge una seconda');
  });

  console.log('\n--- una chiave doppia tra moduli diversi collegati allo stesso modulo non confligge ---');
  await test('due moduli diversi possono avere entrambi una relazione con key "immobili" verso Immobili, nessun conflitto tra loro', async () => {
    mod('visite', 'Visite', 104);
    const r = await (await call([{ registry_module_id: 104, target_registry_module_id: 101 }])).json();
    eq(r.results[0].configured, true); eq(r.results[0].key, 'immobili');
  });

  console.log(`\n${'='.repeat(60)}`);
  console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
  process.exit(failed > 0 ? 1 : 0);
}
main().catch((e) => { console.error('Suite modules-relations-batch fallita ad avviarsi:', e); process.exit(1); });
