'use strict';
// «Ti manca un modulo?» (module-gap.js, routes/suggestions.js → /gap-scan): un suggerimento 'modulo_mancante' alla volta, mai due aperti insieme, mai chiuso dalla scansione
// giornaliera di suggestions.js. Server vero, DB temporaneo, Super Admin simulato. Eseguire con: node src/module-gap.test.js (porta 34861 libera).
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const TEST_PORT = 34861, BASE = 'http://localhost:' + TEST_PORT;
process.env.DB_PATH = path.join(os.tmpdir(), 'modgap-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'mg_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'mg_internal_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'mg_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mg-uploads-'));
process.env.SUPER_ADMIN_URL = 'http://sa.test';
process.env.TENANT_SLUG = 'officina';
let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); console.log('  ✓ ' + name); passed++; } catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; } }
const eq = (a, e, m) => { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${m || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m || 'atteso true'); };
const realFetch = global.fetch; let richiesteSa = []; let rispostaSa = { status: 200, body: { proposta: { tipo: 'nessuna' } } };
global.fetch = async (url, opt) => { if (!String(url).startsWith('http://sa.test')) return realFetch(url, opt); richiesteSa.push({ url: String(url), body: JSON.parse(opt.body) }); return { ok: rispostaSa.status < 400, status: rispostaSa.status, json: async () => rispostaSa.body }; };

async function main() {
  require('./index.js');
  for (let i = 0; i < 100; i++) { try { if ((await realFetch(BASE + '/health')).ok) break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
  const db = require('./db'); const G = require('./module-gap'); const S = require('./suggestions'); const moduleAi = require('./module-ai'); const feat = require('./features');
  feat.set('suggerimenti', true);
  const F = (key, type) => ({ id: 'f_' + key, block_type: 'field', key, label: key, type });
  const schema = { version: 3, steps: [F('titolo', 'text'), F('fornitore', 'text')] };
  db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json, registry_module_id) VALUES ('Costi', 'costi', 'box', '#000', 1, 1, 70, ?, 42)").run(JSON.stringify(schema));
  const H = async () => { const l = await realFetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'mg_admin_pw' }) }); return { Authorization: 'Bearer ' + (await l.json()).token, 'Content-Type': 'application/json' }; };
  const hh = await H();

  await test('moduliInstallati/indizi: struttura e registry_module_id, mai valori di riga', () => {
    const mods = G.moduliInstallati();
    eq(mods.length, 1); eq(mods[0].nome, 'Costi'); eq(mods[0].registry_module_id, 42);
    eq(mods[0].campi.map((f) => f.key), ['titolo', 'fornitore']);
  });

  await test('salva(): scrive una riga sola, la ritrova e aggiorna (stesso target), la chiude se il target cambia', () => {
    G.salva({ tipo: 'installa', registry_module_id: 1, nome: 'Clienti', descrizione: 'x', motivo: 'm1' });
    let aperte = db.prepare("SELECT * FROM suggestions WHERE rule_key = ? AND status = 'open'").all(G.RULE_KEY);
    eq(aperte.length, 1); eq(JSON.parse(aperte[0].data).motivo, 'm1'); eq(aperte[0].module_slug, G.SENTINEL);

    G.salva({ tipo: 'installa', registry_module_id: 1, nome: 'Clienti', descrizione: 'x', motivo: 'm2' });
    aperte = db.prepare("SELECT * FROM suggestions WHERE rule_key = ? AND status = 'open'").all(G.RULE_KEY);
    eq(aperte.length, 1, 'stesso target: aggiorna, non duplica'); eq(JSON.parse(aperte[0].data).motivo, 'm2');

    G.salva({ tipo: 'crea', nome: 'Manutenzioni', descrizione: 'y', motivo: 'm3' });
    aperte = db.prepare("SELECT * FROM suggestions WHERE rule_key = ? AND status = 'open'").all(G.RULE_KEY);
    eq(aperte.length, 1, 'un target diverso chiude il vecchio: mai due aperti insieme'); eq(JSON.parse(aperte[0].data).motivo, 'm3');
    const chiuse = db.prepare("SELECT * FROM suggestions WHERE rule_key = ? AND status = 'resolved'").all(G.RULE_KEY);
    eq(chiuse.length, 1);
  });

  await test('la scansione giornaliera (suggestions.js) non chiude mai un modulo_mancante: non è cosa sua', () => {
    const prima = db.prepare("SELECT COUNT(*) c FROM suggestions WHERE rule_key = ? AND status = 'open'").get(G.RULE_KEY).c;
    S.scansiona();
    const dopo = db.prepare("SELECT COUNT(*) c FROM suggestions WHERE rule_key = ? AND status = 'open'").get(G.RULE_KEY).c;
    eq(dopo, prima);
  });

  await test('controlla(): l\'AI non è configurata -> skip silenzioso, nessuna riga nuova', async () => {
    db.prepare("DELETE FROM suggestions WHERE rule_key = ?").run(G.RULE_KEY);
    rispostaSa = { status: 503, body: { error: 'Nessuna chiave', code: 'ai_not_configured' } };
    const r = await G.controlla();
    eq(r.skipped, 'ai_not_configured');
    eq(db.prepare("SELECT COUNT(*) c FROM suggestions WHERE rule_key = ?").get(G.RULE_KEY).c, 0);
  });

  await test('controlla(): tipo "nessuna" -> nessuna riga; tipo "installa" -> scrive la proposta', async () => {
    rispostaSa = { status: 200, body: { proposta: { tipo: 'nessuna', motivo: '' } } };
    let r = await G.controlla();
    ok(r.nessuna); eq(db.prepare("SELECT COUNT(*) c FROM suggestions WHERE rule_key = ?").get(G.RULE_KEY).c, 0);

    rispostaSa = { status: 200, body: { proposta: { tipo: 'installa', registry_module_id: 7, nome: 'Clienti', descrizione: 'Anagrafica', motivo: 'Niente li gestisce' } } };
    r = await G.controlla();
    eq(r.proposta.tipo, 'installa');
    const riga = db.prepare("SELECT * FROM suggestions WHERE rule_key = ? AND status = 'open'").get(G.RULE_KEY);
    ok(riga, 'la riga deve esistere'); ok(riga.title.includes('Clienti'), riga.title);
    eq(richiesteSa[richiesteSa.length - 1].body.data.installed_registry_ids, [42], 'manda i registry_module_id già installati, per non riproporli');
  });

  await test('rotta /api/suggestions/gap-scan: 400 se l\'AI è spenta, 200 con gli items aggiornati se accesa', async () => {
    moduleAi.setMaster(false);
    let r = await realFetch(BASE + '/api/suggestions/gap-scan', { method: 'POST', headers: hh });
    eq(r.status, 400); eq((await r.json()).code, 'ai_off');
    moduleAi.setMaster(true);
    rispostaSa = { status: 200, body: { proposta: { tipo: 'nessuna', motivo: '' } } };
    r = await realFetch(BASE + '/api/suggestions/gap-scan', { method: 'POST', headers: hh });
    eq(r.status, 200); const body = await r.json();
    ok(Array.isArray(body.items));
  });

  console.log(`\n${passed} passati, ${failed} falliti`); process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error('Suite module-gap fallita ad avviarsi:', e); process.exit(1); });
