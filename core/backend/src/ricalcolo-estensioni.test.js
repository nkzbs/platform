'use strict';
// `ricalcola` nelle estensioni dei pacchetti: cambia la formula di un campo calcolato solo se è ancora quella originale, e sposta il campo dopo gli altri.
// Prova con le estensioni VERE delle Provvigioni (due parti, scaglioni, scaglioni nel totale). Nessun server: DB temporaneo e un finto callAs. Eseguire con: node src/ricalcolo-estensioni.test.js
const path = require('path'); const os = require('os'); const fs = require('fs'); const crypto = require('crypto');
process.env.DB_PATH = path.join(os.tmpdir(), 'ricalc-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.JWT_SECRET = 'rc_secret_' + crypto.randomBytes(8).toString('hex');
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-uploads-'));
let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); console.log('  ✓ ' + name); passed++; } catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; } }
const eq = (a, e, m) => { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${m || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m || 'atteso true'); };

const db = require('./db'); const seedEngine = require('./seed-blocchi-verticale'); const { parseSchemaNormalized } = require('./schema-v3'); const { attachComputedFields } = require('./computed-fields');
const EST = require('../../../super-admin/backend/src/pacchetti/mediazione-immobiliare/estensioni.json').provvigioni.filter((x) => ['due_parti', 'scaglioni', 'scaglioni_nel_totale'].includes(x.key));
const F = (key, type = 'text') => ({ id: 'f_' + key, block_type: 'field', key, label: key, type });
const add = (slug, steps) => db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES (?, ?, 'box', '#000', 1, 1, 80, ?)").run(slug, slug, JSON.stringify({ version: 3, steps }));
const bozze = {};
const finto = async (user, method, p, body) => {
  if (p.endsWith('/draft')) bozze[p.split('/')[2]] = body.schema;
  if (p.endsWith('/publish')) db.prepare('UPDATE modules SET schema_json = ? WHERE slug = ?').run(JSON.stringify(bozze[p.split('/')[2]]), p.split('/')[2]);
  return { ok: true, data: {} };
};
const steps = (slug) => JSON.parse(db.prepare('SELECT schema_json FROM modules WHERE slug = ?').get(slug).schema_json).steps;
const calcola = (slug, dati) => attachComputedFields(db, { id: 1, data: { ...dati } }, parseSchemaNormalized(db.prepare('SELECT schema_json FROM modules WHERE slug = ?').get(slug).schema_json), slug).data;

async function main() {
  db.prepare('DELETE FROM users').run(); db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('admin', 'x', 'admin')").run();
  add('provvigioni', [F('descrizione'), F('importo', 'currency')]);
  await test('con le tre estensioni: la formula passa alla percentuale applicata e i calcoli vengono DOPO gli scaglioni', async () => {
    const esiti = await seedEngine.applicaSeed({ provvigioni: EST }, { tipo: 'estensione', callAs: finto });
    eq(esiti.map((e) => e.key + ':' + e.esito), ['due_parti:applicato', 'scaglioni:applicato', 'scaglioni_nel_totale:applicato']);
    const k = steps('provvigioni').filter((x) => x.type === 'computed').map((x) => x.key);
    ok(k.indexOf('importo_netto') > k.indexOf('percentuale_applicata') && k.indexOf('totale') > k.indexOf('importo_netto') && k.indexOf('iva') > k.indexOf('importo_netto'), 'ordine: ' + k.join(','));
  });
  await test('senza percentuale scritta il totale usa lo scaglione; con la percentuale scritta vince quella', () => {
    const a = calcola('provvigioni', { base_imponibile: 152000 });
    eq([a.percentuale_applicata, a.importo_netto, a.iva, a.totale], [3, 4560, 1003.2, 5563.2], 'scaglione 3%');
    const b = calcola('provvigioni', { base_imponibile: 152000, percentuale: 4 }); eq([b.importo_netto, b.totale], [6080, 7417.6], 'percentuale scritta');
    const c = calcola('provvigioni', { base_imponibile: 600000 }); eq([c.percentuale_applicata, c.importo_netto], [2, 12000], 'scaglione alto');
    const d = calcola('provvigioni', { importo: 1000 }); eq([d.importo_netto, d.totale], [1000, 1220], 'senza prezzo: resta l\'importo scritto');
  });
  await test('una formula modificata dall\'utente non si tocca; ripetere non cambia nulla', async () => {
    add('prov2', [F('descrizione'), F('importo', 'currency')]);
    await seedEngine.applicaSeed({ prov2: EST.slice(0, 2) }, { tipo: 'estensione', callAs: finto });
    const st = steps('prov2').map((x) => (x.key === 'importo_netto' ? { ...x, expr: 'importo * 2' } : x));
    db.prepare('UPDATE modules SET schema_json = ? WHERE slug = ?').run(JSON.stringify({ version: 3, steps: st }), 'prov2');
    await seedEngine.applicaSeed({ prov2: EST.slice(2) }, { tipo: 'estensione', callAs: finto });
    eq(steps('prov2').find((x) => x.key === 'importo_netto').expr, 'importo * 2', 'formula dell\'utente intatta');
    const prima = JSON.stringify(steps('provvigioni')); await seedEngine.applicaSeed({ provvigioni: EST }, { tipo: 'estensione', callAs: finto }); eq(JSON.stringify(steps('provvigioni')), prima, 'una volta sola');
  });
  console.log(`\n${'='.repeat(60)}\n${passed} passati, ${failed} falliti su ${passed + failed} test.`);
  try { fs.unlinkSync(process.env.DB_PATH); } catch (e) {}
  process.exit(failed > 0 ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
