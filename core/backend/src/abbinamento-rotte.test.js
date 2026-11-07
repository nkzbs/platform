'use strict';
// Abbinamento (blocco `match_view`) end-to-end: calcolo via rotta, condizioni, filtri, direzione
// inversa, permessi del modulo bersaglio, validazione alla pubblicazione. Server reale, DB temporaneo.
// Eseguire con: node src/abbinamento-rotte.test.js (porta 34832).

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const TEST_PORT = 34832;
const BASE = 'http://localhost:' + TEST_PORT;
process.env.DB_PATH = path.join(os.tmpdir(), 'abbinamento-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'abb_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'abb_internal_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'abb_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'abb-uploads-'));
process.env.SUPER_ADMIN_URL = 'http://localhost:1';
process.env.TENANT_SLUG = 'abb';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; }
}
function assertEq(a, e, msg) { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${msg || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); }
function assertTrue(c, msg) { if (!c) throw new Error(msg || 'atteso true'); }
const F = (key, label, type = 'text') => ({ id: 'f_' + key, block_type: 'field', key, label, type });

async function main() {
  require('./index.js');
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
  const db = require('./db');

  const mk = (slug, steps) => db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES (?, ?, 'box', '#000', 1, 1, 70, ?)").run(slug, slug, JSON.stringify({ version: 3, steps }));
  const rec = (slug, data) => db.prepare('INSERT INTO records (module_slug, data) VALUES (?, ?)').run(slug, JSON.stringify(data)).lastInsertRowid;

  const REGOLE_CLIENTE = [
    { mine: 'cerca_tipo', theirs: 'tipo', op: 'testo', label: 'Tipologia' },
    { mine: 'budget', theirs: 'prezzo', op: 'theirs<=mine', label: 'Nel budget', required: true },
    { mine: 'zona', theirs: ['comune', 'quartiere'], op: 'testo', label: 'Zona' },
  ];
  mk('persone_a', [
    F('nome', 'Nome'), F('tipo_cliente', 'Tipo'), F('cerca_tipo', 'Cerca'), F('budget', 'Budget', 'currency'), F('zona', 'Zona'),
    { id: 'm1', block_type: 'match_view', key: 'adatte', label: 'Case adatte', target_module: 'case_a', display_field: 'titolo', subtitle_fields: ['comune', 'prezzo'],
      when: { field: 'tipo_cliente', equals: 'Acquirente' }, target_filter: { field: '_stato', in: ['in_vendita'] }, rules: REGOLE_CLIENTE },
  ]);
  mk('case_a', [
    F('titolo', 'Titolo'), F('tipo', 'Tipo'), F('prezzo', 'Prezzo', 'currency'), F('comune', 'Comune'), F('quartiere', 'Quartiere'),
    { id: 'w1', block_type: 'workflow_state', key: 'in_vendita', label: 'In vendita', initial: true },
    { id: 'w2', block_type: 'workflow_state', key: 'venduto', label: 'Venduto' },
    { id: 'm2', block_type: 'match_view', key: 'richieste', label: 'Richieste compatibili', target_module: 'persone_a', display_field: 'nome', subtitle_fields: ['budget'],
      target_filter: { field: 'tipo_cliente', equals: 'Acquirente' },
      rules: [
        { mine: 'tipo', theirs: 'cerca_tipo', op: 'testo', label: 'Tipologia' },
        { mine: 'prezzo', theirs: 'budget', op: 'theirs>=mine', label: 'Nel budget', required: true },
        { mine: 'comune', theirs: 'zona', op: 'testo', label: 'Zona' },
      ] },
  ]);

  const login = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: process.env.INITIAL_ADMIN_PASSWORD }) })).json();
  const H = { Authorization: 'Bearer ' + login.token, 'Content-Type': 'application/json' };
  const get = (p, headers = H) => fetch(BASE + '/api' + p, { headers });
  const post = (p, body) => fetch(BASE + '/api' + p, { method: 'POST', headers: H, body: JSON.stringify(body || {}) });

  const c1 = rec('persone_a', { nome: 'Anna', tipo_cliente: 'Acquirente', cerca_tipo: 'Villa', budget: 200000, zona: 'Desenzano' });
  const c2 = rec('persone_a', { nome: 'Bruno', tipo_cliente: 'Venditore', cerca_tipo: 'Villa', budget: 200000, zona: 'Desenzano' });
  const c3 = rec('persone_a', { nome: 'Carla', tipo_cliente: 'Acquirente' });
  const c4 = rec('persone_a', { nome: 'Dario', tipo_cliente: 'Acquirente', cerca_tipo: 'Villa', budget: 100000, zona: 'Desenzano' });
  const h1 = rec('case_a', { titolo: 'Villa sul lago', tipo: 'Villa', prezzo: 190000, comune: 'Desenzano del Garda', _stato: 'in_vendita' });
  const h2 = rec('case_a', { titolo: 'Villa di lusso', tipo: 'Villa', prezzo: 300000, comune: 'Desenzano', _stato: 'in_vendita' });
  const h3 = rec('case_a', { titolo: 'Bilocale Brescia', tipo: 'Appartamento', prezzo: 150000, comune: 'Brescia', _stato: 'in_vendita' });
  const h4 = rec('case_a', { titolo: 'Villa già venduta', tipo: 'Villa', prezzo: 190000, comune: 'Desenzano', _stato: 'venduto' });
  const h5 = rec('case_a', { titolo: 'Appartamento in zona', tipo: 'Appartamento', prezzo: 120000, comune: 'Desenzano', _stato: 'in_vendita' });

  console.log('\n--- calcolo via rotta ---');
  await test('Immobili adatti a un acquirente: vincolo di budget, filtro per stato, ordinati per affinità', async () => {
    const r = await get(`/records/persone_a/${c1}/abbinamenti/adatte`);
    assertEq(r.status, 200); const j = await r.json();
    assertEq(j.applicabile, true); assertEq(j.titolo, 'Case adatte');
    // h1: tipologia+zona (1), h5: solo zona (1/2); h2 escluso (budget), h3 nessuna affinità, h4 venduto (filtro)
    assertEq(j.items.map((i) => i.id), [h1, h5]);
    assertEq(j.items[0].punteggio, 1); assertEq(j.items[1].punteggio, 0.5);
    assertEq(j.totale, 2);
  });
  await test('ogni risultato porta titolo, dettagli e cosa soddisfa/manca', async () => {
    const j = await (await get(`/records/persone_a/${c1}/abbinamenti/adatte`)).json();
    assertEq(j.items[0].titolo, 'Villa sul lago');
    assertEq(j.items[0].dettagli.map((d) => d.campo), ['comune', 'prezzo']);
    assertEq(j.items[0].soddisfatte, ['Tipologia', 'Nel budget', 'Zona']);
    assertEq(j.items[1].mancanti, ['Tipologia']);
  });
  await test('condizione sul mio record (solo acquirenti): per un venditore la sezione non si applica', async () => {
    const j = await (await get(`/records/persone_a/${c2}/abbinamenti/adatte`)).json();
    assertEq(j.applicabile, false); assertEq(j.items, []);
  });
  await test('acquirente senza criteri compilati: valutabili 0 (l\'interfaccia dirà «compila i criteri»)', async () => {
    const j = await (await get(`/records/persone_a/${c3}/abbinamenti/adatte`)).json();
    assertEq(j.applicabile, true); assertEq(j.valutabili, 0); assertEq(j.items, []);
  });
  await test('direzione inversa: da un immobile alle richieste (solo acquirenti, budget ≥ prezzo)', async () => {
    const j = await (await get(`/records/case_a/${h1}/abbinamenti/richieste`)).json();
    assertEq(j.items.map((i) => i.id), [c1]); // c4 ha budget troppo basso, c2 non è acquirente, c3 senza criteri
    assertEq(j.items[0].titolo, 'Anna');
  });
  await test('l\'abbinamento non scrive nulla', async () => {
    const prima = db.prepare('SELECT COUNT(*) c FROM records').get().c;
    await get(`/records/persone_a/${c1}/abbinamenti/adatte`);
    assertEq(db.prepare('SELECT COUNT(*) c FROM records').get().c, prima);
  });

  console.log('\n--- errori e accessi ---');
  await test('abbinamento inesistente → 404; record inesistente → 404; senza token → 401', async () => {
    assertEq((await get(`/records/persone_a/${c1}/abbinamenti/boh`)).status, 404);
    assertEq((await get(`/records/persone_a/99999/abbinamenti/adatte`)).status, 404);
    assertEq((await get(`/records/persone_a/${c1}/abbinamenti/adatte`, {})).status, 401);
  });
  await test('un utente che non può vedere il modulo bersaglio riceve un elenco vuoto, non un errore né dati', async () => {
    const u = await post('/users', { username: 'operatore', password: 'operatore_pw_1', role: 'user' });
    assertEq(u.status, 200);
    const sc = JSON.parse(db.prepare("SELECT schema_json FROM modules WHERE slug = 'case_a'").get().schema_json);
    sc.steps.push({ id: 'p1', block_type: 'permissions', rules: [{ role: 'user', view: false, view_own_only: false, create: false, edit: false, delete: false }, { role: 'admin', view: true, view_own_only: false, create: true, edit: true, delete: true }] });
    db.prepare("UPDATE modules SET schema_json = ? WHERE slug = 'case_a'").run(JSON.stringify(sc));
    const lg = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'operatore', password: 'operatore_pw_1' }) })).json();
    const r = await get(`/records/persone_a/${c1}/abbinamenti/adatte`, { Authorization: 'Bearer ' + lg.token });
    assertEq(r.status, 200); const j = await r.json();
    assertEq(j.items, [], 'nessun dato del modulo che non può vedere');
    const admin = await (await get(`/records/persone_a/${c1}/abbinamenti/adatte`)).json();
    assertEq(admin.items.length, 2, 'l\'admin continua a vedere i risultati');
  });

  console.log('\n--- validazione alla pubblicazione ---');
  const pubblica = (slug) => post(`/builder/${slug}/publish`, {});
  const dettagli = async (r) => ((await r.json()).details || []).map((d) => (d.errors || []).join('; ')).join(' | ');
  const modulo = (slug, mv) => mk(slug, [F('a', 'A'), F('prezzo', 'Prezzo', 'currency'),
    { id: 'mv', block_type: 'match_view', key: 'abb', label: 'Abb', target_module: 'case_a', display_field: 'titolo', rules: [{ mine: 'a', theirs: 'tipo', op: 'testo' }], ...mv }]);
  await test('un abbinamento corretto si pubblica', async () => {
    modulo('ok_v', {});
    const r = await pubblica('ok_v');
    assertEq(r.status, 200, await dettagli(r));
  });
  await test('modulo bersaglio inesistente → bloccato', async () => {
    modulo('v1', { target_module: 'non_esiste' });
    assertTrue(/non esiste/.test(await dettagli(await pubblica('v1'))));
  });
  await test('campo mio, campo del bersaglio o operatore inesistenti → bloccato, con il nome', async () => {
    modulo('v2', { rules: [{ mine: 'zzz', theirs: 'tipo', op: 'testo' }] });
    assertTrue(/"zzz" non esiste in questo modulo/.test(await dettagli(await pubblica('v2'))));
    modulo('v3', { rules: [{ mine: 'a', theirs: 'yyy', op: 'testo' }] });
    assertTrue(/"yyy" non esiste in "case_a"/.test(await dettagli(await pubblica('v3'))));
    modulo('v4', { rules: [{ mine: 'a', theirs: 'tipo', op: 'magia' }] });
    assertTrue(/operatore "magia"/.test(await dettagli(await pubblica('v4'))));
  });
  await test('nessuna regola, titolo o chiave non validi → bloccato', async () => {
    modulo('v5', { rules: [], label: '', key: 'Chiave Storta' });
    const d = await dettagli(await pubblica('v5'));
    assertTrue(/almeno una regola/.test(d) && /titolo/.test(d) && /chiave non valida/.test(d), d);
  });
  await test('condizione, filtro o campo mostrato su campi inesistenti → bloccato; _stato è ammesso', async () => {
    modulo('v6', { when: { field: 'nope', equals: 'x' }, target_filter: { field: 'nope2', in: ['x'] }, subtitle_fields: ['nope3'] });
    const d = await dettagli(await pubblica('v6'));
    assertTrue(/condizione: il campo "nope"/.test(d) && /filtro: il campo "nope2"/.test(d) && /"nope3"/.test(d), d);
    modulo('v7', { target_filter: { field: '_stato', in: ['in_vendita'] }, when: { field: '_stato', equals: 'x' } });
    assertEq((await pubblica('v7')).status, 200);
  });

  console.log('\n--- seed: gli abbinamenti del verticale applicati ai moduli (una volta sola) ---');
  const seedAbb = require('./pacchetti/mediazione-immobiliare/abbinamenti.json');
  const { applicaSeed } = require('./seed-blocchi-verticale');
  mk('clienti', [F('nome', 'Nome'), F('tipo_cliente', 'Tipo'), F('ricerca_tipologia', 'Tipologia'), F('ricerca_budget_max', 'Budget', 'currency'), F('ricerca_zona', 'Zona')]);
  mk('immobili', [F('titolo', 'Titolo'), F('tipologia', 'Tipologia'), F('comune', 'Comune'), F('zona_quartiere', 'Zona'), F('localita', 'Località'), F('prezzo_richiesto', 'Prezzo', 'currency'),
    { id: 'i1', block_type: 'workflow_state', key: 'in_mandato', label: 'In mandato', initial: true },
    { id: 'i2', block_type: 'workflow_state', key: 'in_vendita', label: 'In vendita' }, { id: 'i3', block_type: 'workflow_state', key: 'venduto', label: 'Venduto' }]);
  const chiaviMv = (slug) => (JSON.parse(db.prepare('SELECT schema_json FROM modules WHERE slug = ?').get(slug).schema_json).steps || []).filter((st) => st.block_type === 'match_view').map((st) => st.key);

  await test('il seed reale degli abbinamenti si applica (passa dalla validazione del Builder)', async () => {
    const esiti = await applicaSeed(seedAbb, { tipo: 'match_view' });
    assertEq(esiti.filter((e) => e.esito === 'applicato').map((e) => e.key).sort(), ['immobili_adatti', 'richieste_compatibili']);
    assertEq(chiaviMv('clienti'), ['immobili_adatti']); assertEq(chiaviMv('immobili'), ['richieste_compatibili']);
  });
  await test('con i dati veri: un acquirente vede gli immobili in vendita nel suo budget, in zona', async () => {
    const acq = rec('clienti', { nome: 'Elena', tipo_cliente: 'Acquirente', ricerca_tipologia: 'trilocale', ricerca_budget_max: 250000, ricerca_zona: 'Sirmione' });
    const ven = rec('clienti', { nome: 'Fabio', tipo_cliente: 'Venditore', ricerca_budget_max: 250000 });
    const i1 = rec('immobili', { titolo: 'Trilocale vista lago', tipologia: 'Appartamento', comune: 'Sirmione', prezzo_richiesto: 240000, _stato: 'in_vendita' });
    const i2 = rec('immobili', { titolo: 'Villa grande', tipologia: 'Villa', comune: 'Sirmione', prezzo_richiesto: 900000, _stato: 'in_vendita' });
    const i3 = rec('immobili', { titolo: 'Trilocale venduto', tipologia: 'Appartamento', comune: 'Sirmione', prezzo_richiesto: 200000, _stato: 'venduto' });
    const j = await (await get(`/records/clienti/${acq}/abbinamenti/immobili_adatti`)).json();
    // «trilocale» compare nel titolo di i1 (la tipologia del cliente è testo libero): tipologia + zona. i2 escluso dal budget, i3 dallo stato.
    assertEq(j.items.map((i) => i.id), [i1]); assertEq(j.items[0].punteggio, 1);
    assertEq((await (await get(`/records/clienti/${ven}/abbinamenti/immobili_adatti`)).json()).applicabile, false, 'il venditore non vede gli immobili adatti');
    const inv = await (await get(`/records/immobili/${i1}/abbinamenti/richieste_compatibili`)).json();
    assertEq(inv.items.map((i) => i.titolo), ['Elena'], 'solo gli acquirenti con budget sufficiente');
    assertEq((await (await get(`/records/immobili/${i2}/abbinamenti/richieste_compatibili`)).json()).items, [], 'nessuno ha 900.000');
    assertEq(i3 > 0, true);
  });
  await test('secondo avvio: niente da fare; se l\'abbinamento viene tolto dal Builder non ricompare', async () => {
    assertEq(await applicaSeed(seedAbb, { tipo: 'match_view' }), []);
    const sc = JSON.parse(db.prepare("SELECT schema_json FROM modules WHERE slug = 'clienti'").get().schema_json);
    sc.steps = sc.steps.filter((st) => st.block_type !== 'match_view');
    db.prepare("UPDATE modules SET schema_json = ? WHERE slug = 'clienti'").run(JSON.stringify(sc));
    assertEq(await applicaSeed(seedAbb, { tipo: 'match_view' }), []);
    assertEq(chiaviMv('clienti'), []);
  });
  await test('un modulo omonimo senza i campi dell\'abbinamento non viene toccato', async () => {
    mk('altrove', [F('nome', 'Nome')]);
    const finto = { altrove: [{ key: 'k', label: 'K', target_module: 'immobili', display_field: 'titolo', rules: [{ mine: 'ricerca_zona', theirs: 'comune', op: 'testo' }] }] };
    assertEq((await applicaSeed(finto, { tipo: 'match_view' })).map((e) => e.esito), ['non applicabile']);
    assertEq(chiaviMv('altrove'), []);
  });
  await test('un abbinamento verso un modulo che non esiste nel tenant non fa nulla', async () => {
    mk('qui', [F('a', 'A')]);
    const finto = { qui: [{ key: 'k2', label: 'K2', target_module: 'inesistente_t', display_field: 'titolo', rules: [{ mine: 'a', theirs: 'b', op: 'testo' }] }] };
    assertEq((await applicaSeed(finto, { tipo: 'match_view' })).map((e) => e.esito), ['non applicabile']);
  });

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Risultato: ${passed} passati, ${failed} falliti`);
  process.exit(failed > 0 ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
