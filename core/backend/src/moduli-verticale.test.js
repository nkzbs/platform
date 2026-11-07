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
const SEED = require('./seeds/moduli-immobiliare.json'); const DOC = require('./seeds/documenti-immobiliare.json');
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
  await test('senza i moduli che cita non si crea nulla; con Clienti e Immobili si crea (crea, bozza, pubblica) una volta sola', async () => {
    eq(await seedEngine.creaModuli(SEED, { callAs: finto() }), []); eq(chiamate, []);
    add('clienti', [F('nome')]); eq(await seedEngine.creaModuli(SEED, { callAs: finto() }), [], 'manca Immobili'); add('immobili', [F('titolo')]);
    eq((await seedEngine.creaModuli(SEED, { callAs: finto() })).map((e) => e.esito), ['applicato']);
    eq(chiamate, ['POST /modules/create', 'PUT /builder/quote_societarie/draft', 'POST /builder/quote_societarie/publish']);
    eq(await seedEngine.creaModuli(SEED, { callAs: finto() }), [], 'una volta sola'); eq(chiamate.length, 3);
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
    eq(require('./seeds/relazioni-immobiliare.json').richieste_privacy[0].a, 'clienti');
  });

  console.log(`\n${passed} passati, ${failed} falliti`);
  try { fs.unlinkSync(process.env.DB_PATH); } catch (e) {}
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
