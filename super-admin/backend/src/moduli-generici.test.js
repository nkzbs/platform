'use strict';
// I moduli generici di partenza (lib/moduli-generici.js, seeds/moduli-generici.json) e le dipendenze tra moduli (lib/analysis.js withDependencies).
// Eseguire con: node src/moduli-generici.test.js
const path = require('path');
const os = require('os');
const crypto = require('crypto');
process.env.DB_PATH = path.join(os.tmpdir(), 'generici-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.JWT_SECRET = 'gen_secret_' + crypto.randomBytes(8).toString('hex');
process.env.ENCRYPTION_KEY = 'gen_enc_' + crypto.randomBytes(8).toString('hex');

let passed = 0, failed = 0;
function test(name, fn) { try { fn(); console.log('  ✓ ' + name); passed++; } catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; } }
const eq = (a, e, m) => { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${m || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m || 'atteso true'); };

const db = require('./db');
const g = require('./lib/moduli-generici');
const A = require('./lib/analysis');
const { parseSchemaNormalized } = require('../../../shared/schema-v3-core.js');
const KNOWN = new Set(['field', 'relation', 'workflow_state', 'workflow_transition', 'scope', 'permissions', 'validazione_creazione', 'computed', 'report_aggregate', 'condition', 'automation', 'connection_required', 'branch_create', 'period_view', 'parent_children_view', 'yearly_breakdown', 'category_pivot', 'weekly_breakdown', 'view_tabs']);

test('52 moduli, tutti con nome, descrizione, gruppo «Generico» e uno schema che si legge con soli blocchi che esistono ancora', () => {
  eq(g.SEED.length, 52); eq(new Set(g.SEED.map((m) => m.slug)).size, 52, 'slug unici');
  for (const m of g.SEED) {
    ok(m.name && m.description.length > 20 && m.group_name === 'Generico', m.slug);
    const j = JSON.parse(m.schema_json); parseSchemaNormalized(m.schema_json);
    ok(!Array.isArray(j.steps) || j.steps.every((s) => KNOWN.has(s.block_type)), m.slug + ' ha un blocco tolto');
    ok((parseSchemaNormalized(m.schema_json).fields || []).length >= 2, m.slug + ' senza campi');
  }
});
test('nessun nome di persone o aziende vere nei moduli (sono mattoncini senza settore)', () => {
  const txt = g.SEED.map((m) => m.name + ' ' + m.description + ' ' + m.schema_json).join(' ');
  ok(!/Nico Caff|Coffee|Finance|@[a-z]+\.(it|com)/i.test(txt));
});
test('si importano nella Libreria con un tocco, una volta sola, senza sovrascrivere', () => {
  const prima = db.prepare('SELECT COUNT(*) c FROM registry_modules').get().c;
  eq(g.stato().presenti, 0);
  eq(g.importa(), 52); eq(db.prepare('SELECT COUNT(*) c FROM registry_modules').get().c, prima + 52); eq(g.stato().mancanti, []);
  eq(g.importa(), 0, 'secondo giro: niente');
  db.prepare("UPDATE registry_modules SET description = 'MODIFICATA' WHERE slug = 'clienti_generico' AND source_tenant_slug = 'generici'").run();
  g.importa(); eq(db.prepare("SELECT description d FROM registry_modules WHERE slug = 'clienti_generico' AND source_tenant_slug = 'generici'").get().d, 'MODIFICATA', 'una scelta già fatta non si tocca');
  db.prepare("DELETE FROM registry_modules WHERE slug = 'note_generico' AND source_tenant_slug = 'generici'").run(); eq(g.stato().mancanti, ['Note']); eq(g.importa(), 1, 'rimette solo quello che manca');
});
test('un modulo richiede quelli a cui è collegato, a catena: Righe Fattura porta Fatture, Prodotti e Clienti', () => {
  const id = (slug) => db.prepare("SELECT id FROM registry_modules WHERE slug = ? AND source_tenant_slug = 'generici'").get(slug + '_generico').id;
  const nome = (i) => db.prepare('SELECT name FROM registry_modules WHERE id = ?').get(i).name;
  const out = A.withDependencies([id('fatture_righe')]);
  eq(out[0], id('fatture_righe')); eq(out.slice(1).map(nome).sort(), ['Clienti', 'Fatture', 'Prodotti']);
  eq(A.withDependencies([id('clienti')]), [id('clienti')], 'Clienti non richiede altro');
  eq(A.withDependencies([id('checklist')]).slice(1).map(nome).sort(), ['Clienti', 'Progetti'], 'anche un collegamento facoltativo: senza il modulo, il campo non avrebbe dove puntare');
  eq(A.withDependencies([id('fatture_righe'), id('fatture')]).length, 4, 'niente doppioni');
  eq(A.blueprint([{ copertura: 'coperto', registry_module_id: id('ore_lavorate'), ruoli_coinvolti: [] }]).moduli_collegati.sort(), ['Clienti', 'Dipendenti', 'Progetti']);
});

console.log(`\n${passed} passati, ${failed} falliti`);
process.exit(failed ? 1 : 0);
