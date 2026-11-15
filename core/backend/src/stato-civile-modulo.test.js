'use strict';
// Lo stato civile ha le stesse scelte del modulo di adeguata verifica (blocco `stato_civile_come_modulo` del pacchetto Mediazione immobiliare):
// per un Clienti che aveva i sei stati di prima, l'elenco cambia, i valori già scritti passano al gruppo giusto (`rimappa`) e il regime patrimoniale
// resta legato ai coniugati solo se la sua condizione era ancora quella di prima. Eseguire con: node src/stato-civile-modulo.test.js
const path = require('path'), os = require('os'), fs = require('fs'), crypto = require('crypto');
const TEST_PORT = 34839;
process.env.DB_PATH = path.join(os.tmpdir(), 'stcivile-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'stc_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'stc_i_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'stc_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'stcivile-up-'));
process.env.SUPER_ADMIN_URL = 'http://localhost:1';
process.env.TENANT_SLUG = 'stcivile';
let passed = 0, failed = 0;
async function test(n, fn) { try { await fn(); console.log('  ✓ ' + n); passed++; } catch (e) { console.error('  ✗ ' + n + '\n    ' + e.message); failed++; } }
const eq = (a, e, m) => { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${m || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); };
const F = (key, type = 'text', extra = {}) => ({ id: 'f_' + key, block_type: 'field', key, label: key, type, ...extra });

(async () => {
  require('./index.js');
  for (let i = 0; i < 100; i++) { try { if ((await fetch('http://localhost:' + TEST_PORT + '/health')).ok) break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
  const db = require('./db'), { applicaSeed } = require('./seed-blocchi-verticale');
  const blocco = require('../../../super-admin/backend/src/pacchetti/mediazione-immobiliare/estensioni.json').clienti.find((e) => e.key === 'stato_civile_come_modulo');
  const vecchi = ['Celibe / Nubile', 'Coniugato/a', 'Unito/a civilmente', 'Separato/a', 'Divorziato/a', 'Vedovo/a'];
  const vecchiaCondizione = { enabled: true, field: 'stato_civile', op: 'in', value: 'Coniugato/a|Unito/a civilmente' };
  db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES ('Clienti', 'clienti', 'box', '#000', 1, 1, 70, ?)").run(JSON.stringify({ version: 3, steps: [F('nome'), F('stato_civile', 'select', { options: vecchi }), F('regime_patrimoniale', 'select', { options: ['Comunione dei beni'], visible_if: vecchiaCondizione })] }));
  const ids = Object.fromEntries(vecchi.concat(['Altro valore']).map((v) => [v, db.prepare('INSERT INTO records (module_slug, data) VALUES (?, ?)').run('clienti', JSON.stringify({ nome: v, stato_civile: v })).lastInsertRowid]));
  const schema = () => JSON.parse(db.prepare("SELECT schema_json FROM modules WHERE slug = 'clienti'").get().schema_json).steps;
  const valore = (id) => JSON.parse(db.prepare('SELECT data FROM records WHERE id = ?').get(id).data).stato_civile;

  await test('si applica: le scelte sono quelle del modulo e la condizione del regime segue il gruppo dei coniugati', async () => {
    const esiti = await applicaSeed({ clienti: [blocco] }, { tipo: 'estensione' });
    eq(esiti.map((e) => e.esito), ['applicato']);
    eq(schema().find((x) => x.key === 'stato_civile').options, ['Coniugato/a o Unito/a civilmente', 'Celibe/Nubile o Vedovo/a', 'Separato/a o Divorziato/a', 'Preferisco non rispondere']);
    eq(schema().find((x) => x.key === 'regime_patrimoniale').visible_if.value, 'Coniugato/a o Unito/a civilmente');
  });
  await test('i valori già scritti passano al gruppo giusto; un valore sconosciuto non si tocca', () => {
    const atteso = { 'Celibe / Nubile': 'Celibe/Nubile o Vedovo/a', 'Coniugato/a': 'Coniugato/a o Unito/a civilmente', 'Unito/a civilmente': 'Coniugato/a o Unito/a civilmente', 'Separato/a': 'Separato/a o Divorziato/a', 'Divorziato/a': 'Separato/a o Divorziato/a', 'Vedovo/a': 'Celibe/Nubile o Vedovo/a', 'Altro valore': 'Altro valore' };
    for (const [v, id] of Object.entries(ids)) eq(valore(id), atteso[v], v);
  });
  await test('secondo avvio: niente da fare', async () => { eq(await applicaSeed({ clienti: [blocco] }, { tipo: 'estensione' }), []); });
  console.log(`\n${passed} passati, ${failed} falliti`); process.exit(failed ? 1 : 0);
})();
