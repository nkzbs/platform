'use strict';
// I moduli nuovi del verticale creati dai seed (seeds/moduli-immobiliare.json, seed-blocchi-verticale.js: creaModuli) e il documento di cessione quote.
// Nessun server: DB temporaneo e un finto callAs che registra le chiamate. Eseguire con: node src/moduli-verticale.test.js
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
process.env.DB_PATH = path.join(os.tmpdir(), 'modver-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.JWT_SECRET = 'mv_secret_' + crypto.randomBytes(8).toString('hex');
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mv-uploads-'));

let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); console.log('  ✓ ' + name); passed++; } catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; } }
const eq = (a, e, m) => { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${m || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m || 'atteso true'); };

const db = require('./db'); const seedEngine = require('./seed-blocchi-verticale');
const { parseSchemaNormalized } = require('./schema-v3');
const SEED = require('../../../super-admin/backend/src/pacchetti/mediazione-immobiliare/moduli.json'); const DOC = require('../../../super-admin/backend/src/pacchetti/mediazione-immobiliare/documenti.json');
const F = (key, type = 'text') => ({ id: 'f_' + key, block_type: 'field', key, label: key, type });
const add = (slug, steps) => db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES (?, ?, 'box', '#000', 1, 1, 80, ?)").run(slug, slug, steps ? JSON.stringify({ version: 3, steps }) : '{}');

// finto callAs come il Builder vero: «crea» inserisce il modulo vuoto, «bozza» tiene lo schema da parte, «pubblica» lo rende quello del modulo
const chiamate = [], bozze = {};
const finto = (rifiuta) => async (user, method, p, body) => {
  chiamate.push(method + ' ' + p);
  if (rifiuta && rifiuta === p.split('/').pop()) return { ok: false, status: 500, data: { error: 'no' } };
  if (p === '/modules/create') { add(body.slug); return { ok: true, data: {} }; }
  if (p.endsWith('/draft')) { bozze[p.split('/')[2]] = body.schema; return { ok: true, data: {} }; }
  if (p.endsWith('/publish')) db.prepare('UPDATE modules SET schema_json = ? WHERE slug = ?').run(JSON.stringify(bozze[p.split('/')[2]]), p.split('/')[2]);
  return { ok: true, data: {} };
};

async function main() {
  db.prepare("DELETE FROM users").run();
  db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('admin', 'x', 'admin')").run();

  await test('lo schema del modulo è valido, con relazioni verso moduli che il seed richiede e un flusso con stato iniziale', () => {
    const def = SEED.quote_societarie, sc = parseSchemaNormalized(JSON.stringify({ version: 3, steps: def.steps }));
    ok(sc.fields.length >= 4 && sc.relations.length === 4, JSON.stringify({ f: sc.fields.length, r: sc.relations.length }));
    for (const r of sc.relations) ok(def.richiede.includes(r.target_module), 'la relazione ' + r.key + ' cita ' + r.target_module + ' che non è tra i richiesti');
    eq(def.steps.filter((s) => s.block_type === 'workflow_state' && s.initial).length, 1);
  });
  await test('Attività: l\'estensione dichiara il calendario, cita solo campi e relazioni che esistono (base + aggiunti) e sopravvive all\'andata e ritorno del Builder', () => {
    const base = SEED.attivita, est = require('../../../super-admin/backend/src/pacchetti/mediazione-immobiliare/estensioni.json').attivita.find((x) => x.key === 'attivita_unificata');
    const sc = parseSchemaNormalized(JSON.stringify({ version: 3, steps: [...base.steps, ...est.aggiungi.map((b, i) => ({ id: 'e' + i, ...b }))] }));
    eq(sc.calendar_views.length, 1); const c = sc.calendar_views[0];
    const chiavi = new Set([...sc.fields.map((f) => f.key), ...sc.relations.map((r) => r.key)]);
    for (const k of [c.date_field, c.time_field, c.title_field, ...c.subtitle_fields]) ok(chiavi.has(k), 'il calendario cita «' + k + '» che non esiste');
    ok(sc.workflow.states.some((st) => st.key === c.done_state), 'stato concluso inesistente');
    const tr = sc.relations.find((r) => r.key === 'trattativa'); eq(tr.eredita, { immobile: 'immobile', cliente: 'cliente' }, 'eredita dalla trattativa');
    for (const k of Object.keys(tr.eredita)) ok(chiavi.has(k), 'eredita verso un campo che non c\'è: ' + k);
    for (const r of est.aggiungi.filter((b) => b.block_type === 'state_requirements').flatMap((b) => b.requisiti)) for (const k of (r.campi || [r.campo])) ok(chiavi.has(k), 'requisito su «' + k + '» inesistente');
    const { toV3 } = require('./schema-v3');
    eq(parseSchemaNormalized(JSON.stringify(toV3(sc))).calendar_views.map((x) => x.key), ['calendario'], 'andata e ritorno');
  });
  await test('Mappa (map_view): l\'estensione di Immobili è un blocco valido, i campi che cita sono tra quelli richiesti o noti e sopravvive all\'andata e ritorno del Builder', () => {
    const est = require('../../../super-admin/backend/src/pacchetti/mediazione-immobiliare/estensioni.json').immobili.find((x) => x.key === 'mappa_osm');
    const blocco = est.aggiungi[0]; eq(blocco.block_type, 'map_view'); ok(blocco.campi.includes('indirizzo') && blocco.campi.includes('comune'), 'indirizzo e comune');
    const { toV3 } = require('./schema-v3');
    const sc = parseSchemaNormalized(JSON.stringify({ version: 3, steps: [F('indirizzo'), F('comune'), { id: 'm1', ...blocco }] }));
    eq(sc.map_views.length, 1); eq(parseSchemaNormalized(JSON.stringify(toV3(sc))).map_views.map((m) => m.key), ['posizione'], 'andata e ritorno');
  });
  await test('senza i moduli che cita non si crea nulla; con Clienti e Immobili si crea (crea, bozza, pubblica) una volta sola', async () => {
    eq(await seedEngine.creaModuli(SEED, { callAs: finto() }), []); eq(chiamate, []);
    add('clienti', [F('nome')]); eq(await seedEngine.creaModuli(SEED, { callAs: finto() }), [], 'manca Immobili'); add('immobili', [F('titolo')]);
    const nuovi = Object.keys(SEED).filter((k) => !k.startsWith('_') && SEED[k].richiede.every((r) => ['clienti', 'immobili'].includes(r))); // i moduli del pacchetto che richiedono solo Clienti e Immobili (oggi: Quote societarie)
    eq((await seedEngine.creaModuli(SEED, { callAs: finto() })).map((e) => e.esito), nuovi.map(() => 'applicato'));
    eq(chiamate.slice(0, 3), ['POST /modules/create', 'PUT /builder/' + nuovi[0] + '/draft', 'POST /builder/' + nuovi[0] + '/publish']);
    eq(chiamate.length, 3 * nuovi.length);
    eq(await seedEngine.creaModuli(SEED, { callAs: finto() }), [], 'una volta sola'); eq(chiamate.length, 3 * nuovi.length);
  });
  await test('un modulo che c\'è già con il suo schema non si tocca; uno rimasto vuoto per un errore si completa al giro dopo', async () => {
    const S2 = { nuovo_a: { ...SEED.quote_societarie, nome: 'A' }, nuovo_b: { ...SEED.quote_societarie, nome: 'B' } };
    add('nuovo_a', [F('mio')]); chiamate.length = 0;
    eq(await seedEngine.creaModuli(S2, { callAs: finto('publish') }), [{ slug: 'nuovo_b', esito: 'errore pubblicazione' }]);
    eq(db.prepare("SELECT schema_json FROM modules WHERE slug = 'nuovo_a'").get().schema_json, JSON.stringify({ version: 3, steps: [F('mio')] }), 'il modulo già presente resta com\'è');
    ok(!db.prepare("SELECT 1 FROM seed_applicati WHERE chiave = 'modulo:nuovo_b'").get(), 'non segnato: riproverà');
    chiamate.length = 0; eq((await seedEngine.creaModuli(S2, { callAs: finto() })).map((e) => e.slug), ['nuovo_b']);
    ok(!chiamate.includes('POST /modules/create'), 'non lo ricrea: completa quello esistente');
  });
  await test('il documento di cessione quote è applicabile al modulo (campi e relazioni citati esistono, Clienti ha i campi che usa)', () => {
    const az = DOC.quote_societarie[0];
    eq([az.delivery, az.signed_type], ['firma', 'cessione_quote_firmata']);
    const clienti = new Set(['nome', 'codice_fiscale_piva']), immobili = new Set(['titolo']);
    ok(seedEngine.modelloApplicabile(az, SEED.quote_societarie.steps, { clienti, immobili }));
    ok(!seedEngine.modelloApplicabile(az, SEED.quote_societarie.steps, { clienti: new Set(['nome']), immobili }), 'senza il codice fiscale/P.IVA di Clienti non è applicabile');
    ok(/notaio/i.test(az.body), 'il documento avverte di farlo rivedere');
  });

  await test('la relazione che cita un modulo inesistente si riallinea al modulo giusto, una volta sola; se il vecchio bersaglio esiste o il nuovo manca non si tocca', async () => {
    const REL = { rp: [{ chiave: 'cliente', da: 'clienti_generico', a: 'clienti', display_field: 'nome' }] };
    const relazione = (target) => ({ id: 'rel_c', block_type: 'relation', key: 'cliente', label: 'Cliente', type: 'many_to_one', target_module: target, display_field: 'ragione_sociale' });
    add('rp', [F('titolo'), relazione('clienti_generico')]); chiamate.length = 0;
    const e1 = await seedEngine.riallineaRelazioni(REL, { callAs: finto() });
    eq(e1.map((e) => e.esito), ['applicato']);
    const rel = JSON.parse(db.prepare("SELECT schema_json FROM modules WHERE slug = 'rp'").get().schema_json).steps.find((x) => x.key === 'cliente');
    eq([rel.target_module, rel.display_field], ['clienti', 'nome']);
    chiamate.length = 0; eq(await seedEngine.riallineaRelazioni(REL, { callAs: finto() }), []); eq(chiamate, [], 'una volta sola');
    // il vecchio bersaglio esiste (anche come slug della Libreria): niente da riallineare
    add('rp2', [relazione('clienti_generico')]); db.prepare("UPDATE modules SET registry_slug = 'clienti_generico' WHERE slug = 'clienti'").run();
    eq(await seedEngine.riallineaRelazioni({ rp2: REL.rp }, { callAs: finto() }), []);
    ok(JSON.parse(db.prepare("SELECT schema_json FROM modules WHERE slug = 'rp2'").get().schema_json).steps[0].target_module === 'clienti_generico', 'non toccato');
    // il modulo giusto non c'è: riprova senza segnare
    db.prepare("UPDATE modules SET registry_slug = NULL WHERE slug = 'clienti'").run(); add('rp3', [relazione('clienti_generico')]);
    eq(await seedEngine.riallineaRelazioni({ rp3: [{ ...REL.rp[0], a: 'inesistente' }] }, { callAs: finto() }), []);
    ok(!db.prepare("SELECT 1 FROM seed_applicati WHERE chiave = 'relazione:rp3:cliente'").get(), 'riproverà');
    eq(require('../../../super-admin/backend/src/pacchetti/mediazione-immobiliare/relazioni.json').richieste_privacy[0].a, 'clienti');
  });

  await test('il cerchio rapido si toglie da Immobili e Clienti una volta sola, senza rimetterlo se poi lo si riaccende; senza il modulo riprova', async () => {
    const proprietaPacchetto = require('../../../super-admin/backend/src/pacchetti/mediazione-immobiliare/proprieta.json');
    eq(proprietaPacchetto.immobili, { quick_toggle: 0 }); eq(proprietaPacchetto.clienti, { quick_toggle: 0 }); eq(proprietaPacchetto.quote_societarie, { menu_nascosto: 1 }, 'Quote societarie tolte dal menu (restano dentro il Cliente)');
    const seed = { immobili: proprietaPacchetto.immobili, clienti: proprietaPacchetto.clienti };
    const prop = []; const callAs = async (u, m, p, b) => { prop.push(m + ' ' + p + ' ' + JSON.stringify(b)); return { ok: true, data: {} }; };
    db.prepare("DELETE FROM seed_applicati WHERE chiave LIKE 'proprieta:%'").run(); db.prepare("DELETE FROM modules WHERE slug = 'immobili'").run();
    eq((await seedEngine.impostaProprieta(seed, { callAs })).map((e) => e.slug), ['clienti']); eq(prop, ['PATCH /modules/clienti {"quick_toggle":false}']);
    add('immobili', [F('titolo')]); prop.length = 0;
    eq((await seedEngine.impostaProprieta(seed, { callAs })).map((e) => e.slug), ['immobili']); eq(prop, ['PATCH /modules/immobili {"quick_toggle":false}']);
    prop.length = 0; eq(await seedEngine.impostaProprieta(seed, { callAs }), []); eq(prop, [], 'una volta sola');
  });

  await test('le sezioni e i dati chiave si assegnano ai campi che esistono, senza sovrascrivere, una volta sola', async () => {
    const SEZ = { sz: { sezioni: { Posizione: ['indirizzo', 'comune'], Prezzi: ['prezzo', 'inesistente'] }, dati_chiave: ['prezzo'] } };
    add('sz', [F('indirizzo'), { ...F('comune'), sezione: 'Mia sezione' }, F('prezzo', 'currency'), F('altro')]); chiamate.length = 0;
    eq((await seedEngine.assegnaSezioni(SEZ, { callAs: finto() })).map((e) => e.esito), ['applicato']);
    const campi = JSON.parse(db.prepare("SELECT schema_json FROM modules WHERE slug = 'sz'").get().schema_json).steps;
    const per = (k) => campi.find((x) => x.key === k);
    eq([per('indirizzo').sezione, per('comune').sezione, per('prezzo').sezione, per('altro').sezione], ['Posizione', 'Mia sezione', 'Prezzi', undefined], 'quella scelta a mano resta');
    eq([per('prezzo').dato_chiave, per('altro').dato_chiave], [true, undefined]);
    chiamate.length = 0; eq(await seedEngine.assegnaSezioni(SEZ, { callAs: finto() }), []); eq(chiamate, [], 'una volta sola');
    const reale = require('../../../super-admin/backend/src/pacchetti/mediazione-immobiliare/sezioni.json').immobili;
    eq(reale.dati_chiave, ['prezzo_richiesto', 'stima_valore', 'superficie_mq', 'locali']);
    const tutte = Object.values(reale.sezioni).flat(); eq(new Set(tutte).size, tutte.length, 'nessun campo in due sezioni'); ok(tutte.includes('titolo') && tutte.includes('riacquisto_zona'));
  });

  console.log(`\n${passed} passati, ${failed} falliti`);
  try { fs.unlinkSync(process.env.DB_PATH); } catch (e) {}
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
