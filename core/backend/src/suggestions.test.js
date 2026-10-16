'use strict';
// Suggerimenti di miglioramento (suggestions.js, routes/suggestions.js): le regole sui numeri d'uso, la scansione (apre, aggiorna, chiude da sola, non riapre ciò che è ignorato), la notifica
// ogni 7 giorni, e «spiega e proponi» con un Super Admin simulato. Server vero, DB temporaneo. Eseguire con: node src/suggestions.test.js (porta 34859 libera).
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const TEST_PORT = 34859, BASE = 'http://localhost:' + TEST_PORT;
process.env.DB_PATH = path.join(os.tmpdir(), 'sugg-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'sg_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'sg_internal_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'sg_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sg-uploads-'));
process.env.SUPER_ADMIN_URL = 'http://sa.test';
process.env.TENANT_SLUG = 'officina';
let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); console.log('  ✓ ' + name); passed++; } catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; } }
const eq = (a, e, m) => { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${m || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m || 'atteso true'); };
const realFetch = global.fetch; let richiesteSa = []; let rispostaSa = { status: 200, body: { proposta: { spiegazione: 'Potrebbe non servire.', cosa_fare: ['Verifica con chi lo usa'], azione: 'togli_campo' } } };
global.fetch = async (url, opt) => { if (!String(url).startsWith('http://sa.test')) return realFetch(url, opt); richiesteSa.push({ url: String(url), headers: opt.headers, body: JSON.parse(opt.body) }); return { ok: rispostaSa.status < 400, status: rispostaSa.status, json: async () => rispostaSa.body }; };

async function main() {
  require('./index.js');
  for (let i = 0; i < 100; i++) { try { if ((await realFetch(BASE + '/health')).ok) break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
  const db = require('./db'); const S = require('./suggestions'); const feat = require('./features'); const moduleAi = require('./module-ai');
  const F = (key, type, extra = {}) => ({ id: 'f_' + key, block_type: 'field', key, label: key.toUpperCase(), type, ...extra });
  const WS = (i, key, extra = {}) => ({ id: 'w' + i, block_type: 'workflow_state', key, label: key, ...extra });
  const schema = { version: 3, steps: [F('titolo', 'text', { required: true }), F('note', 'text'), F('marca', 'text'), F('tel', 'phone'), WS(1, 'nuovo', { initial: true }), WS(2, 'lavoro'), WS(3, 'chiuso'), WS(4, 'mai'),
    { id: 't1', block_type: 'workflow_transition', from: 'nuovo', to: 'lavoro', label: 'a', roles: [] }, { id: 't2', block_type: 'workflow_transition', from: 'lavoro', to: 'chiuso', label: 'b', roles: [] }] };
  db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES ('Lavori', 'lavori', 'box', '#000', 1, 1, 70, ?)").run(JSON.stringify(schema));
  const vecchio = '2026-01-01 10:00:00';
  const put = (d, upd = new Date().toISOString().slice(0, 19).replace('T', ' ')) => db.prepare("INSERT INTO records (module_slug, user_id, data, updated_at) VALUES ('lavori', 1, ?, ?)").run(JSON.stringify(d), upd);
  const marche = ['Fiat', 'Fiat', 'Fiat', 'Fiat', 'Opel', 'Opel', 'Fiat', 'Fiat'];
  for (let i = 0; i < 40; i++) put({ titolo: 'L' + i, marca: marche[i % marche.length], _stato: i < 5 ? 'lavoro' : 'nuovo', ...(i < 3 ? { note: 'x' } : {}) }, i < 5 ? vecchio : undefined);
  const H = async () => { const l = await realFetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'sg_admin_pw' }) }); return { Authorization: 'Bearer ' + (await l.json()).token, 'Content-Type': 'application/json' }; };
  const hh = await H();

  await test('le regole sui numeri (pure): campo mai compilato, poco usato, testo con pochi valori, righe ferme, passaggio mai raggiunto; niente su pochi dati', async () => {
    const m = db.prepare("SELECT schema_json FROM modules WHERE slug = 'lavori'").get(); const { parseSchemaNormalized } = require('./schema-v3'); const sc = parseSchemaNormalized(m.schema_json);
    const righe = db.prepare("SELECT data, updated_at FROM records WHERE module_slug = 'lavori'").all().map((r) => ({ data: JSON.parse(r.data), updated_at: r.updated_at }));
    const o = S.osservaModulo({ name: 'Lavori', fields: sc.fields, workflow: sc.workflow }, righe, new Set(['nuovo', 'lavoro', 'chiuso']));
    const k = (r, t) => o.find((x) => x.rule_key === r && x.target === t);
    ok(k('campo_poco_usato', 'tel') && k('campo_poco_usato', 'tel').data.mai === true, 'tel mai compilato');
    ok(!k('campo_poco_usato', 'titolo'), 'un campo obbligatorio non conta'); ok(!k('campo_poco_usato', 'note'), '3 su 40 con meno di 50 righe: non ancora');
    eq(k('testo_da_strutturare', 'marca').data.distinti, 2); ok(!k('testo_da_strutturare', 'titolo'), 'titoli tutti diversi');
    eq(k('righe_ferme', 'lavoro').data.ferme, 5); ok(!k('righe_ferme', 'chiuso'), 'uno stato finale non è fermo'); ok(!k('righe_ferme', 'nuovo'), 'righe recenti');
    eq(k('stato_mai_usato', 'mai').data.totale, 40); ok(!k('stato_mai_usato', 'chiuso'), 'chiuso è stato raggiunto (storico)');
    eq(S.osservaModulo({ name: 'X', fields: sc.fields, workflow: sc.workflow }, righe.slice(0, 5), new Set()).filter((x) => x.rule_key !== 'righe_ferme').length, 0, 'sotto le 20 righe nessuna osservazione sull\'uso');
  });
  await test('con la funzione spenta (di partenza) la pagina non risponde; accesa, la scansione apre le osservazioni', async () => {
    eq(feat.isEnabled('suggerimenti'), false); eq((await realFetch(BASE + '/api/suggestions', { headers: hh })).status, 403);
    eq(S.tick(), null, 'lo scheduler non fa niente da spento'); feat.set('suggerimenti', true);
    const r = await (await realFetch(BASE + '/api/suggestions/scan', { method: 'POST', headers: hh })).json();
    ok(r.nuove >= 4, JSON.stringify(r)); eq(r.risolte, 0); const regole = r.items.map((x) => x.rule_key + ':' + x.target);
    ok(regole.includes('campo_poco_usato:tel') && regole.includes('righe_ferme:lavoro') && regole.includes('stato_mai_usato:mai') && regole.includes('testo_da_strutturare:marca'), regole.join());
    eq((await realFetch(BASE + '/api/suggestions')).status, 401);
  });
  await test('rifare la scansione non duplica; ignorare una voce la tiene ignorata; quando il problema sparisce si chiude da sola', async () => {
    const prima = (await (await realFetch(BASE + '/api/suggestions', { headers: hh })).json()).items; const n = prima.length;
    const r2 = await (await realFetch(BASE + '/api/suggestions/scan', { method: 'POST', headers: hh })).json(); eq(r2.nuove, 0); eq(r2.items.length, n, 'nessun doppione');
    const tel = prima.find((x) => x.target === 'tel'); eq((await realFetch(BASE + '/api/suggestions/' + tel.id, { method: 'PATCH', headers: hh, body: JSON.stringify({ status: 'dismissed' }) })).status, 200);
    await realFetch(BASE + '/api/suggestions/scan', { method: 'POST', headers: hh });
    eq((await (await realFetch(BASE + '/api/suggestions', { headers: hh })).json()).items.find((x) => x.id === tel.id).status, 'dismissed', 'non si riapre da sola');
    eq((await realFetch(BASE + '/api/suggestions/' + tel.id, { method: 'PATCH', headers: hh, body: JSON.stringify({ status: 'boh' }) })).status, 400);
    db.prepare("UPDATE records SET data = json_set(data, '$._stato', 'chiuso') WHERE json_extract(data, '$._stato') = 'lavoro'").run(); // le righe ferme si chiudono
    const r3 = await (await realFetch(BASE + '/api/suggestions/scan', { method: 'POST', headers: hh })).json(); ok(r3.risolte >= 1);
    ok(!r3.items.some((x) => x.rule_key === 'righe_ferme'), 'risolta e non più in elenco');
  });
  await test('la notifica agli admin: una sola ogni 7 giorni e solo se c\'è qualcosa di aperto', async () => {
    db.prepare("DELETE FROM notifications WHERE category = 'suggerimenti'").run();
    eq(S.notifica(), true); eq(S.notifica(), false, 'subito dopo: no'); const c = () => db.prepare("SELECT COUNT(*) c FROM notifications WHERE category = 'suggerimenti'").get().c; eq(c(), 1);
    ok(/suggerimenti per migliorare|suggerimento per migliorare/.test(db.prepare("SELECT message FROM notifications WHERE category = 'suggerimenti'").get().message));
    eq(S.notifica(new Date(Date.now() + 8 * 86400000)), true, 'dopo 8 giorni sì'); eq(c(), 2);
    db.prepare("UPDATE suggestions SET status = 'resolved'").run(); eq(S.notifica(new Date(Date.now() + 30 * 86400000)), false, 'niente di aperto: niente notifica');
  });
  await test('«Spiega e proponi»: serve l\'AI accesa; parte la struttura e i numeri, MAI i valori delle righe; la proposta si conserva', async () => {
    await realFetch(BASE + '/api/suggestions/scan', { method: 'POST', headers: hh }); const item = (await (await realFetch(BASE + '/api/suggestions', { headers: hh })).json()).items.find((x) => x.rule_key === 'testo_da_strutturare');
    let r = await realFetch(BASE + '/api/suggestions/' + item.id + '/propose', { method: 'POST', headers: hh }); eq(r.status, 400); eq((await r.json()).code, 'ai_off'); eq(richiesteSa.length, 0);
    moduleAi.setMaster(true); r = await realFetch(BASE + '/api/suggestions/' + item.id + '/propose', { method: 'POST', headers: hh }); eq(r.status, 200);
    const q = richiesteSa[0]; eq(q.url, 'http://sa.test/api/tenant-ai/suggestion'); eq(q.headers['x-internal-secret'], process.env.INTERNAL_API_SECRET); eq(q.body.tenant_slug, 'officina');
    ok(!/Fiat|Opel/.test(JSON.stringify(q.body)), 'nessun valore delle righe'); eq(q.body.data.regola, 'testo_da_strutturare'); eq(q.body.data.campi.length, 4); ok(q.body.data.stati.length === 4);
    eq((await (await realFetch(BASE + '/api/suggestions', { headers: hh })).json()).items.find((x) => x.id === item.id).ai.azione, 'togli_campo', 'la proposta resta salvata');
    rispostaSa = { status: 503, body: { error: 'Nessuna chiave', code: 'ai_not_configured' } }; r = await realFetch(BASE + '/api/suggestions/' + item.id + '/propose', { method: 'POST', headers: hh }); eq(r.status, 503);
    eq((await realFetch(BASE + '/api/suggestions/99999/propose', { method: 'POST', headers: hh })).status, 404);
  });

  console.log(`\n${'='.repeat(60)}\n${passed} passati, ${failed} falliti su ${passed + failed} test.`);
  try { fs.unlinkSync(process.env.DB_PATH); } catch (e) {}
  process.exit(failed > 0 ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
