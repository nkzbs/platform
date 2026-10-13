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

test('55 moduli, tutti con nome, descrizione, gruppo «Generico» e uno schema che si legge con soli blocchi che esistono ancora', () => {
  eq(g.SEED.length, 55); eq(new Set(g.SEED.map((m) => m.slug)).size, 55, 'slug unici');
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
  eq(g.importa().aggiunti, 55); eq(db.prepare('SELECT COUNT(*) c FROM registry_modules').get().c, prima + 55); eq(g.stato().mancanti, []);
  eq(g.importa(), { aggiunti: 0, completati: 0 }, 'secondo giro: niente');
  db.prepare("UPDATE registry_modules SET description = 'MODIFICATA' WHERE slug = 'clienti_generico' AND source_tenant_slug = 'generici'").run();
  g.importa(); eq(db.prepare("SELECT description d FROM registry_modules WHERE slug = 'clienti_generico' AND source_tenant_slug = 'generici'").get().d, 'MODIFICATA', 'una scelta già fatta non si tocca');
  db.prepare("DELETE FROM registry_modules WHERE slug = 'note_generico' AND source_tenant_slug = 'generici'").run(); eq(g.stato().mancanti, ['Note']); eq(g.importa().aggiunti, 1, 'rimette solo quello che manca');
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

test('DICHIARAZIONI dei ruoli: ogni campo dichiarato esiste nel modulo; chi era già importato senza ruoli li riceve, senza toccare quelli presenti', () => {
  const dichiarati = g.SEED.filter((m) => m.ruoli); ok(dichiarati.length >= 17, 'almeno 17 moduli dichiarati');
  for (const m of dichiarati) {
    const campi = new Set((parseSchemaNormalized(m.schema_json).fields || []).map((f) => f.key)); campi.add('_stato');
    for (const [ruolo, campo] of Object.entries(m.ruoli.roles)) ok(campi.has(campo), m.slug + ': il ruolo «' + ruolo + '» punta a «' + campo + '» che non c\'è');
    ok(['spesa', 'entrata', 'presenze', 'pratica'].includes(m.ruoli.kind), m.slug);
    if (m.ruoli.avvisi) { const st = (parseSchemaNormalized(m.schema_json).workflow.states || []).map((x) => x.key); for (const v of Object.values(m.ruoli.avvisi.states)) ok(!v || st.includes(v), m.slug + ': stato «' + v + '» non esiste'); }
  }
  db.prepare("UPDATE registry_modules SET ruoli = NULL WHERE slug = 'fatture_generico' AND source_tenant_slug = 'generici'").run();
  db.prepare("UPDATE registry_modules SET ruoli = '{\"kind\":\"spesa\"}' WHERE slug = 'ordini_generico' AND source_tenant_slug = 'generici'").run();
  eq(g.stato().da_completare, ['Fatture']); const r = g.importa(); eq(r, { aggiunti: 0, completati: 1 });
  ok(db.prepare("SELECT ruoli FROM registry_modules WHERE slug = 'fatture_generico' AND source_tenant_slug = 'generici'").get().ruoli.includes('pratica'));
  eq(db.prepare("SELECT ruoli FROM registry_modules WHERE slug = 'ordini_generico' AND source_tenant_slug = 'generici'").get().ruoli, '{"kind":"spesa"}', 'una dichiarazione già presente non si tocca');
});
test('PROPOSTE di report e di AI, dai ruoli dichiarati dei moduli scelti (nessun nome di settore)', () => {
  const id = (slug) => db.prepare("SELECT id FROM registry_modules WHERE slug = ? AND source_tenant_slug = 'generici'").get(slug + '_generico').id;
  const p = A.proposte(A.withDependencies([id('spese'), id('timbrature'), id('ticket_supporto'), id('scadenzario')]));
  eq(p.report.map((r) => r.tipo).sort(), ['coda', 'in_ritardo', 'ore_settimana', 'riepilogo_periodo']);
  eq(p.ai.map((a) => a.key).sort(), ['ai:spese_generico:explain', 'ai:spese_generico:import', 'ai:spese_generico:triage']);
  eq(A.proposte([id('note')]), { report: [], ai: [] }, 'un modulo senza dichiarazione non propone niente');
  eq(A.proposte([id('clienti')]).report.length, 0);
  const pk = A.pacchettoTenant(A.withDependencies([id('spese'), id('timbrature')]), ['report:ore_settimana', 'ai:spese_generico:import']);
  eq(pk.module_roles.map((m) => m.slug).sort(), ['spese_generico', 'timbrature_generico']); eq(pk.reports.map((r) => r.tipo), ['riepilogo_periodo', 'in_ritardo']);
  eq(pk.ai, [{ slug: 'spese_generico', features: ['triage', 'explain'] }], 'le proposte tolte non partono');
});

console.log(`\n${passed} passati, ${failed} falliti`);
process.exit(failed ? 1 : 0);
