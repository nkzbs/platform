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

  console.log('\n--- creazione del tenant in background ---');
  await test('la rotta risponde subito (202), la pagina segue le fasi e i tempi; l\'accesso admin si consegna UNA volta; il tenant si crea senza moduli di default', async () => {
    const T = require('./routes/tenants'); const real = { c: T.createTenant, i: T.installModulesByIds, e: T.enqueueHostedCreation };
    let optsRicevute = null, installati = null;
    T.createTenant = async (o) => { optsRicevute = o; o.onStep('container'); await new Promise((r) => setTimeout(r, 60)); o.onStep('database'); await new Promise((r) => setTimeout(r, 60)); o.onStep('dominio'); return { tenant: { slug: o.slug }, initialPassword: 'pw-di-prova' }; };
    T.installModulesByIds = async (slug, ids) => { installati = ids; return { modules: ids.length }; };
    T.enqueueHostedCreation = (fn) => fn();
    let setupRicevuto = null;
    A.deps.applyConfig = async () => ({ roles_created: ['ricezione'], modules_configured: [{}] });
    A.deps.setupTenant = async (slug, pacchetto) => { setupRicevuto = { slug, pacchetto }; return { reports: ['r1', 'r2'], module_roles: ['a'] }; };
    try {
      const c = await (await api('POST', '', { name: 'Per creare', descrizione: 'x' })).json();
      await api('PATCH', '/' + c.id, { processi: [{ nome: 'Righe', registry_module_id: idA }, { nome: 'Altro', registry_module_id: idB }] });
      const t0 = Date.now(); const r = await api('POST', '/' + c.id + '/create-tenant', { name: 'Nuovo', slug: 'nuovo-test' });
      eq(r.status, 202); ok(Date.now() - t0 < 500, 'risponde subito'); eq((await api('POST', '/' + c.id + '/create-tenant', { name: 'N', slug: 'nuovo-test-2' })).status, 409, 'una creazione alla volta');
      eq((await api('DELETE', '/' + c.id)).status, 409, 'non si toglie un\'analisi mentre il tenant nasce');
      let st; for (let i = 0; i < 100; i++) { st = await (await api('GET', '/' + c.id + '/creazione')).json(); if (st.fase === 'finita' || st.fase === 'errore') break; await new Promise((r) => setTimeout(r, 50)); }
      eq(st.fase, 'finita', JSON.stringify(st)); eq(st.tenant_slug, 'nuovo-test'); eq([st.moduli_installati, st.ruoli_creati], [2, 1]);
      ok(st.tempi.container >= 0 && st.tempi.database >= 0 && 'moduli' in st.tempi && 'ruoli' in st.tempi, JSON.stringify(st.tempi)); ok(st.secondi >= 0);
      eq(st.credenziali, { username: 'admin', password: 'pw-di-prova' }, 'l\'accesso si vede una volta');
      eq((await (await api('GET', '/' + c.id + '/creazione')).json()).credenziali, undefined, 'e poi non c\'è più');
      eq(setupRicevuto.slug, 'nuovo-test'); eq(Object.keys(setupRicevuto.pacchetto).sort(), ['ai', 'module_roles', 'reports']); eq([st.report_creati, st.moduli_dichiarati], [2, 1]);
      eq(optsRicevute.skipDefaults, true, 'niente moduli di default: ha scelto lui'); eq(installati.length >= 2, true);
      eq((await (await api('GET', '/' + c.id)).json()).tenant_slug, 'nuovo-test');
      T.createTenant = async () => { throw new Error('Docker non risponde'); };
      const c2 = await (await api('POST', '', { name: 'Che fallisce' })).json(); await api('PATCH', '/' + c2.id, { processi: [{ nome: 'X' }] });
      eq((await api('POST', '/' + c2.id + '/create-tenant', { name: 'F', slug: 'fallisce' })).status, 202);
      for (let i = 0; i < 100; i++) { st = await (await api('GET', '/' + c2.id + '/creazione')).json(); if (st.fase === 'errore') break; await new Promise((r) => setTimeout(r, 50)); }
      eq([st.fase, st.errore], ['errore', 'Docker non risponde']); eq((await api('DELETE', '/' + c2.id)).status, 200, 'un\'analisi con la creazione fallita si può togliere');
    } finally { T.createTenant = real.c; T.installModulesByIds = real.i; T.enqueueHostedCreation = real.e; }
  });

  console.log('\n--- «Fai tutto» ---');
  await test('un racconto → analisi completa in background: nome dell\'attività, processi proposti, tutti completati (un errore non ferma gli altri); nessun tenant creato da solo', async () => {
    const precedente = A.deps.callAI;
    A.deps.callAI = async (prov, { system, user }) => {
      await new Promise((r) => setTimeout(r, 80)); // un'AI vera non risponde subito
      if (/dalla descrizione di un'attività, elenca/.test(system)) return JSON.stringify({ nome_attivita: 'Officina Verdi', processi: [{ nome: 'Accettazione', reparto: 'Ricezione', registry_module_id: idA }, { nome: 'Ricambi', registry_module_id: 424242 }, { nome: 'Consegna' }] });
      if (/Processo: Ricambi/.test(user)) throw new Error('modello in errore');
      return JSON.stringify({ scopo: 'Scopo di prova', evento_innesco: 'Arriva il cliente', input: 'Anagrafica', output: 'Lavoro', ruoli_coinvolti: [{ nome: 'Ricezione', tipo: 'utente' }], passaggi: [{ titolo: 'Accetta', ruolo: 'Ricezione', descrizione: 'Registra', tipo: 'step' }], registry_module_id: idB });
    };
    try {
      eq((await api('POST', '/auto', { descrizione: 'corta' })).status, 400);
      A.deps.isConfigured = () => false; eq((await api('POST', '/auto', { descrizione: 'Un\'officina con sei meccanici che ripara auto e moto.' })).status, 503); A.deps.isConfigured = () => true;
      const r = await api('POST', '/auto', { descrizione: 'Un\'officina con sei meccanici che ripara auto e moto, con preventivi e ricambi.' }); eq(r.status, 202);
      const { id } = await r.json(); eq((await api('DELETE', '/' + id)).status, 409, 'non si toglie mentre si compila');
      let a; for (let i = 0; i < 200; i++) { a = await (await api('GET', '/' + id)).json(); if (a.auto && (a.auto.fase === 'finita' || a.auto.fase === 'errore')) break; await new Promise((r) => setTimeout(r, 50)); }
      eq(a.auto.fase, 'finita', JSON.stringify(a.auto)); eq(a.name, 'Officina Verdi'); eq([a.auto.fatti, a.auto.totale, a.auto.errori], [3, 3, 1]);
      eq(a.processi.map((p) => p.nome), ['Accettazione', 'Ricambi', 'Consegna']);
      const acc = a.processi[0]; eq(acc.registry_module_id, idA, 'il modulo già abbinato non si cambia'); eq(acc.scopo, 'Scopo di prova'); eq(acc.passaggi.length, 1);
      eq(a.processi[1].scopo, '', 'quello che è fallito resta com\'era'); eq(a.processi[2].registry_module_id, idB); eq(a.tenant_slug, null, 'il tenant lo crea l\'utente, con un tocco');
      eq((await api('DELETE', '/' + id)).status, 200, 'finita: si può togliere');
      const r2 = await api('POST', '/auto', { descrizione: 'Un\'altra attività con descrizione abbastanza lunga.', name: 'Nome scelto' }); const id2 = (await r2.json()).id;
      for (let i = 0; i < 200; i++) { a = await (await api('GET', '/' + id2)).json(); if (a.auto && a.auto.fase !== 'processi' && a.auto.fase !== 'completamento') break; await new Promise((r) => setTimeout(r, 50)); }
      eq(a.name, 'Nome scelto', 'un nome dato dall\'utente non si cambia');
    } finally { A.deps.callAI = precedente; }
  });

  console.log('\n--- guida all\'uso ---');
  await test('la guida nasce solo dai dati: moduli con campi e stati, ruoli con i loro passaggi, niente di inventato', async () => {
    const schema = JSON.stringify({ version: 3, steps: [{ id: 'f1', block_type: 'field', key: 'nome', label: 'Nome lavoro', type: 'text' }, { id: 'f2', block_type: 'field', key: 'tipo', label: 'Tipo', type: 'select', options: [{ value: 'a', label: 'Tagliando' }] }, { id: 'w1', block_type: 'workflow_state', key: 'aperto', label: 'Aperto', initial: true }, { id: 'r1', block_type: 'relation', key: 'cliente', label: 'Cliente', type: 'many_to_one', target_module: 'prev' }] });
    const m = db.prepare("INSERT INTO registry_modules (name, slug, description, schema_json, version, source_tenant_slug) VALUES ('Lavori', 'lavori', 'I lavori in corso', ?, 1, 't')").run(schema).lastInsertRowid;
    const c = await (await api('POST', '', { name: 'Con guida', descrizione: 'x' })).json();
    const processi = [{ nome: 'Lavorazione', reparto: 'Officina', scopo: 'Fare il lavoro', evento_innesco: 'Arriva un ordine', registry_module_id: Number(m), copertura: 'coperto', ruoli_coinvolti: [{ nome: 'Meccanico', tipo: 'utente' }, { nome: 'Gestionale', tipo: 'sistema' }], passaggi: [{ titolo: 'Apri il lavoro', ruolo: 'Meccanico', descrizione: 'Dal modulo Lavori', tipo: 'step' }], eccezioni: ['Ricambio mancante'] }, { nome: 'Fatturazione', copertura: 'da_costruire' }];
    eq((await api('PATCH', '/' + c.id, { processi })).status, 200);
    const g = await (await api('GET', '/' + c.id + '/guida')).json();
    eq(g.moduli.map((x) => x.nome), ['Lavori', 'Preventivi'], 'entra anche il modulo da cui dipende'); eq(g.moduli[0].campi.map((f) => f.nome), ['Nome lavoro', 'Tipo']); eq(g.moduli[0].campi[1].scelte, ['Tagliando']);
    eq(g.moduli[0].stati, ['Aperto']); eq(g.moduli[0].collegamenti, ['Preventivi']);
    eq(g.ruoli.map((r) => r.nome), ['Meccanico'], 'i sistemi non sono ruoli di persone'); eq(g.ruoli[0].passaggi[0].titolo, 'Apri il lavoro');
    eq(g.processi[0].modulo, 'Lavori'); eq(g.processi[1].da_costruire, true); eq(g.da_costruire, ['Fatturazione']);
    eq((await api('GET', '/99999/guida')).status, 404);
  });

  console.log('\n--- approfondimento ---');
  await test('più moduli per processo: id inventati scartati, il principale non si ripete, tetti rispettati', () => {
    const valid = new Set([idA, idB]);
    const p = A.sanitizeProcesso({ nome: 'X', registry_module_id: idA, moduli_extra: [idA, idB, 9999, 'x', idB], manca: ['a', '', 'b'] }, valid);
    eq(p.moduli_extra, [idB]); eq(p.manca, ['a', 'b']);
    eq(A.sanitizeProcesso({ nome: 'X', moduli_extra: Array.from({ length: 30 }, (_, i) => i + 1) }).moduli_extra.length, 8);
  });
  await test('applica: aggiunge senza togliere (le scelte di chi ha l\'analisi restano)', () => {
    const p = { registry_module_id: idA, moduli_extra: [idB], manca: ['uno'] };
    const r = A.applicaApprofondimento(p, { moduli_extra: [idB, 77, idA], manca: ['uno', 'due'] });
    eq(r.moduli_extra, [idB, 77]); eq(r.manca, ['uno', 'due']); eq(r.registry_module_id, idA);
  });
  await test('il passaggio AI: solo id veri, numeri di processo veri, i dati personali non partono; l\'analisi si salva e il blueprint conta i moduli in più', async () => {
    const c = await (await api('POST', '', { name: 'Da approfondire', descrizione: 'x' })).json();
    eq((await api('POST', '/' + c.id + '/approfondisci')).status, 400, 'senza processi');
    await api('PATCH', '/' + c.id, { processi: [{ nome: 'Preventivare mario@rossi.it', registry_module_id: idA, copertura: 'coperto', scopo: 'tel 333 1234567' }, { nome: 'Chiudere' }] });
    prompts = []; risposta = { processi: [{ n: 1, moduli_extra: [idB, 424242], manca: ['Firma digitale'] }, { n: 9, moduli_extra: [idA] }, { n: 2, moduli_extra: [idA], manca: [] }] };
    const r = await (await api('POST', '/' + c.id + '/approfondisci')).json();
    eq(r.processi[0].moduli_extra, [idB]); eq(r.processi[0].manca, ['Firma digitale']); eq(r.processi[1].moduli_extra, [idA]);
    ok(!prompts.join('').includes('mario@rossi.it') && !prompts.join('').includes('1234567'), 'nessun dato personale al modello');
    eq(r.blueprint.moduli_ids.sort(), [idA, idB].sort()); eq(r.blueprint.manca, [{ processo: 'Preventivare mario@rossi.it', voci: ['Firma digitale'] }]);
  });

  console.log(`\n${passed} passati, ${failed} falliti`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
