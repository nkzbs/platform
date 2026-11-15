'use strict';
// Qualità del mandante e stato di occupazione dell'immobile sono a scelta multipla (blocco `qualita_e_occupazione_multiple`): per un Immobili che le aveva a scelta
// singola il campo cambia tipo e i valori già scritti diventano un elenco; il contratto di incarico in PDF spunta e rilegge più caselle insieme.
// Eseguire con: node src/immobile-scelte-multiple.test.js
const path = require('path'), os = require('os'), fs = require('fs'), crypto = require('crypto');
const TEST_PORT = 34840;
process.env.DB_PATH = path.join(os.tmpdir(), 'immmult-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'imm_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'imm_i_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'imm_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'immmult-up-'));
process.env.SUPER_ADMIN_URL = 'http://localhost:1';
process.env.TENANT_SLUG = 'immmult';
let passed = 0, failed = 0;
async function test(n, fn) { try { await fn(); console.log('  ✓ ' + n); passed++; } catch (e) { console.error('  ✗ ' + n + '\n    ' + e.message); failed++; } }
const eq = (a, e, m) => { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${m || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); };
const F = (key, type = 'text', extra = {}) => ({ id: 'f_' + key, block_type: 'field', key, label: key, type, ...extra });
const PAC = path.join(__dirname, '../../../super-admin/backend/src/pacchetti/mediazione-immobiliare/');

(async () => {
  require('./index.js');
  for (let i = 0; i < 100; i++) { try { if ((await fetch('http://localhost:' + TEST_PORT + '/health')).ok) break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
  const db = require('./db'), { applicaSeed } = require('./seed-blocchi-verticale');
  const blocco = require(PAC + 'estensioni.json').immobili.find((e) => e.key === 'qualita_e_occupazione_multiple');
  const qualita = ['Proprietario esclusivo', 'Comproprietario', 'Legale rappresentante'], occupazione = ['Libero al rogito', 'Occupato dalla proprietà', 'Locato'];
  db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES ('Immobili', 'immobili', 'box', '#000', 1, 1, 70, ?)").run(JSON.stringify({ version: 3, steps: [F('indirizzo'), F('mandante_qualita', 'select', { options: qualita }), F('stato_occupazione', 'select', { options: occupazione })] }));
  const id = db.prepare('INSERT INTO records (module_slug, data) VALUES (?, ?)').run('immobili', JSON.stringify({ indirizzo: 'Via Roma 1', mandante_qualita: 'Comproprietario', stato_occupazione: 'Locato' })).lastInsertRowid;
  const steps = () => JSON.parse(db.prepare("SELECT schema_json FROM modules WHERE slug = 'immobili'").get().schema_json).steps;

  await test('si applica: i due campi diventano elenchi a più scelte, con le stesse voci', async () => {
    eq((await applicaSeed({ immobili: [blocco] }, { tipo: 'estensione' })).map((e) => e.esito), ['applicato']);
    eq(steps().filter((x) => ['mandante_qualita', 'stato_occupazione'].includes(x.key)).map((x) => [x.type, x.options]), [['multiselect', qualita], ['multiselect', occupazione]]);
  });
  await test('i valori già scritti diventano un elenco di una voce', () => {
    eq(JSON.parse(db.prepare('SELECT data FROM records WHERE id = ?').get(id).data), { indirizzo: 'Via Roma 1', mandante_qualita: ['Comproprietario'], stato_occupazione: ['Locato'] });
  });
  await test('secondo avvio: niente da fare', async () => { eq(await applicaSeed({ immobili: [blocco] }, { tipo: 'estensione' }), []); });

  const modelli = require('./lib/modelli-pdf'), imp = require('./lib/importa-modulo-pdf'), { costruisciGet } = require('./lib/modello-documento');
  const m = JSON.parse(fs.readFileSync(PAC + 'moduli-pdf/contratto-incarico.json', 'utf8'));
  await modelli.salva({ chiave: 'contratto-incarico', titolo: m.titolo, pdf: fs.readFileSync(PAC + 'moduli-pdf/' + (m.file || 'contratto-incarico.pdf')), mappa: { campi: m.campi } });
  const schema = { document_actions: [{ key: 'incarico', label: 'Incarico', pdf_modello: 'contratto-incarico' }], fields: [
    { key: 'mandante_qualita', label: 'Il mandante agisce come', type: 'multiselect', options: qualita }, { key: 'stato_occupazione', label: 'Stato di occupazione', type: 'multiselect', options: occupazione }] };
  await test('il contratto in PDF spunta più caselle insieme e le rilegge tutte', async () => {
    const rec = { mandante_qualita: ['Comproprietario', 'Legale rappresentante'], stato_occupazione: ['Libero al rogito', 'Locato'] };
    const buffer = (await modelli.compilaPer('contratto-incarico', costruisciGet({ record: rec, schema: { relations: [] }, tenant: {} }))).buffer;
    const p = await imp.proponi({ schema, buffer });
    const v = Object.fromEntries(p.campi.map((c) => [c.key, c.valore]));
    eq(v.mandante_qualita, rec.mandante_qualita, 'qualità'); eq(v.stato_occupazione, rec.stato_occupazione, 'occupazione');
  });
  console.log(`\n${passed} passati, ${failed} falliti`); process.exit(failed ? 1 : 0);
})();
