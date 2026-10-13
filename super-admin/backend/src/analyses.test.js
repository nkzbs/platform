'use strict';
// Analisi dei processi (lib/analysis.js, routes/analyses.js): pulizia di ciò che arriva dal modello, nessun modulo inventato, dati personali tolti prima dell'AI,
// elenco/modifica/blueprint, e i rifiuti prima di creare un tenant. L'AI è simulata. Eseguire con: node src/analyses.test.js (porta 34851 libera).
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const TEST_PORT = 34851;
const BASE = 'http://localhost:' + TEST_PORT;
process.env.DB_PATH = path.join(os.tmpdir(), 'analyses-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'an_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'an_internal_' + crypto.randomBytes(8).toString('hex');
process.env.ENCRYPTION_KEY = 'an_enc_' + crypto.randomBytes(8).toString('hex');

let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); console.log('  ✓ ' + name); passed++; } catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; } }
const eq = (a, e, m) => { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${m || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m || 'atteso true'); };

async function main() {
  require('./index.js');
  for (let i = 0; i < 100; i++) { try { const r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); if (r.status) break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
  const db = require('./db'); const A = require('./lib/analysis'); const bcrypt = require('bcryptjs');
  db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('an_user', ?, 'admin')").run(bcrypt.hashSync('an_pw_123456', 10));
  const login = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'an_user', password: 'an_pw_123456' }) });
  const H = { Authorization: 'Bearer ' + (await login.json()).token, 'Content-Type': 'application/json' };
  const api = (m, p, b) => fetch(BASE + '/api/analyses' + p, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined });
  const mod = (name, slug, desc) => db.prepare("INSERT INTO registry_modules (name, slug, description, schema_json, version, source_tenant_slug, group_name) VALUES (?, ?, ?, '{}', 1, 't', 'Gruppo')").run(name, slug, desc).lastInsertRowid;
  const idA = mod('Ordini di lavoro', 'ordini', 'Lavori con stati'), idB = mod('Preventivi', 'prev', 'Preventivi con scadenza');
  let prompts = []; let risposta = null;
  A.deps.isConfigured = () => true;
  A.deps.callAI = async (prov, { system, user }) => { prompts.push(user); return JSON.stringify(risposta); };

  console.log('\n--- pulizia ---');
  await test('un modulo inventato dal modello diventa null; uno vero copre il processo; i tipi strani tornano normali', () => {
    const valid = new Set([idA, idB]);
    const p = A.sanitizeProcesso({ nome: ' Accettazione ', registry_module_id: 9999, copertura: 'boh', ruoli_coinvolti: [{ nome: 'Ricezione', tipo: 'alieno' }, { nome: '' }], passaggi: [{ titolo: 'Arriva', tipo: 'salto' }, { titolo: 'Bivio', tipo: 'decisione' }, {}], kpi: ['a', '', 5] }, valid);
    eq(p.registry_module_id, null); eq(p.copertura, 'da_valutare'); eq(p.nome, 'Accettazione');
    eq(p.ruoli_coinvolti, [{ nome: 'Ricezione', tipo: 'utente' }]); eq(p.passaggi.map((s) => s.tipo), ['step', 'decisione']); eq(p.kpi, ['a', '5']);
    const q = A.sanitizeProcesso({ nome: 'X', registry_module_id: idA }, valid); eq(q.registry_module_id, idA); eq(q.copertura, 'coperto', 'scegliere un modulo copre il processo');
    eq(A.sanitizeProcesso({ nome: 'X', copertura: 'da_costruire' }, valid).copertura, 'da_costruire');
  });
  await test('lunghezze limitate, niente righe senza nome, al massimo 40 processi', () => {
    eq(A.sanitizeProcesso({ nome: 'x'.repeat(500) }).nome.length, 80);
    eq(A.sanitizeProcessi([{ nome: '' }, { nome: 'ok' }]).length, 1); eq(A.sanitizeProcessi(Array.from({ length: 60 }, (_, i) => ({ nome: 'p' + i }))).length, 40);
  });

  console.log('\n--- l\'AI propone, non scrive ---');
  await test('«Suggerisci processi»: i dati personali non arrivano al modello e un modulo inventato sparisce', async () => {
    risposta = { processi: [{ nome: 'Accettazione auto', reparto: 'Ricezione', scopo: 'Prendere in carico', registry_module_id: idA }, { nome: 'Magia', registry_module_id: 424242 }] };
    prompts = [];
    const r = await api('POST', '/suggest-processi', { descrizione: 'Officina del signor Rossi, mario.rossi@example.com, IBAN IT60X0542811101000000123456, telefono 333 1234567, 6 meccanici.' });
    eq(r.status, 200); const b = await r.json();
    ok(!/mario\.rossi@|IT60X05428|333 1234567/.test(prompts[0]), 'dati personali nel prompt: ' + prompts[0]); ok(/Ordini di lavoro/.test(prompts[0]), 'il modello vede la Libreria');
    eq(b.processi.map((p) => p.registry_module_id), [idA, null]); eq(b.processi[0].copertura, 'coperto');
    eq(db.prepare('SELECT COUNT(*) c FROM process_analyses').get().c, 0, 'niente è stato salvato da solo');
  });
  await test('«Suggerisci con AI» su un processo: il nome resta, i campi si riempiono ripuliti', async () => {
    risposta = { scopo: 'Far partire un lavoro', evento_innesco: 'Arriva il cliente', ruoli_coinvolti: [{ nome: 'Ricezione', tipo: 'utente' }], passaggi: [{ titolo: 'Accetta', ruolo: 'Ricezione', descrizione: 'Registra', tipo: 'step' }], registry_module_id: idB, nome: 'DEVE ESSERE IGNORATO' };
    const b = await (await api('POST', '/suggest-processo', { nome: 'Preventivo', reparto: 'Ricezione' })).json();
    eq(b.nome, 'Preventivo'); eq(b.registry_module_id, idB); eq(b.passaggi.length, 1);
  });
  await test('risposta non valida o AI non configurata: errore chiaro, niente scritto', async () => {
    risposta = 'questo non è json';
    A.deps.callAI = async () => 'non json';
    eq((await api('POST', '/suggest-processo', { nome: 'X' })).status, 502);
    A.deps.isConfigured = () => false;
    const r = await api('POST', '/suggest-processi', { descrizione: 'Una descrizione abbastanza lunga' }); eq(r.status, 503); eq((await r.json()).code, 'ai_not_configured');
    A.deps.isConfigured = () => true; A.deps.callAI = async () => JSON.stringify(risposta);
    eq((await api('POST', '/suggest-processi', { descrizione: 'corta' })).status, 400); eq((await api('POST', '/suggest-processo', { nome: ' ' })).status, 400);
  });

  console.log('\n--- analisi salvate ---');
  let id;
  await test('si crea, si modifica (ripulita), si legge con il blueprint, si elenca e si toglie', async () => {
    const c = await (await api('POST', '', { name: 'Officina Rossi', descrizione: 'Racconto' })).json(); id = c.id; eq(c.processi, []);
    const p = await (await api('PATCH', '/' + id, { profilo: { settore: 'Meccanica', numero_dipendenti: '6', reparti: ['Ricezione', ''] }, processi: [
      { nome: 'Accettazione', registry_module_id: idA, ruoli_coinvolti: [{ nome: 'Ricezione', tipo: 'utente' }, { nome: 'Cliente', tipo: 'esterno' }] },
      { nome: 'Ricambi', copertura: 'da_costruire', registry_module_id: 777 }, { nome: '' }] })).json();
    eq(p.processi.map((x) => x.nome), ['Accettazione', 'Ricambi']); eq(p.processi[1].registry_module_id, null); eq(p.profilo.numero_dipendenti, 6); eq(p.profilo.reparti, ['Ricezione']);
    eq([p.blueprint.processi, p.blueprint.coperto, p.blueprint.da_costruire.length, p.blueprint.ruoli_utente, p.blueprint.moduli_ids], [2, 1, 1, 1, [idA]]);
    const l = await (await api('GET', '')).json(); eq([l[0].n_processi, l[0].n_da_costruire], [2, 1]);
    eq((await api('PATCH', '/' + id, { name: '  ' })).status, 400); eq((await api('GET', '/9999')).status, 404);
  });
  await test('un utente non collegato non vede niente', async () => {
    const r = await fetch(BASE + '/api/analyses'); eq(r.status, 401);
  });
  await test('la Libreria per scegliere il modulo a mano; creare il tenant senza nome o già creato si rifiuta', async () => {
    const lib = (await (await api('GET', '/library')).json()).map((m) => m.name); ok(lib.includes('Ordini di lavoro') && lib.includes('Preventivi'), lib.join());
    eq((await api('POST', '/' + id + '/create-tenant', { name: 'X' })).status, 400, 'manca lo slug');
    db.prepare("UPDATE process_analyses SET tenant_slug = 'gia' WHERE id = ?").run(id);
    const r = await api('POST', '/' + id + '/create-tenant', { name: 'X', slug: 'x' }); eq(r.status, 400); ok(/già nato/.test((await r.json()).error));
    eq((await api('DELETE', '/' + id)).status, 200); eq((await api('GET', '/' + id)).status, 404);
  });

  console.log(`\n${passed} passati, ${failed} falliti`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
