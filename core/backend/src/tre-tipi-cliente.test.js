'use strict';
// Il cliente è di tre tipi (blocchi `tre_tipi_cliente`, `campi_incarico_ricerca` e `immobili_adatti_due_acquirenti` del pacchetto Mediazione immobiliare):
// l'elenco cambia, chi era «Acquirente» passa a «sa già cosa vuole», i campi della ricerca compaiono solo per gli acquirenti, i campi dell'incarico di ricerca solo per il
// terzo tipo, «Immobili adatti» vale per entrambi gli acquirenti e il documento «Incarico di ricerca» compare solo per il terzo tipo.
// Eseguire con: node src/tre-tipi-cliente.test.js
const path = require('path'), os = require('os'), fs = require('fs'), crypto = require('crypto');
const TEST_PORT = 34851;
process.env.DB_PATH = path.join(os.tmpdir(), 'tretipi-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'tt_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'tt_i_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'tt_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tretipi-up-'));
process.env.SUPER_ADMIN_URL = 'http://localhost:1';
process.env.TENANT_SLUG = 'tretipi';
let passed = 0, failed = 0;
async function test(n, fn) { try { await fn(); console.log('  ✓ ' + n); passed++; } catch (e) { console.error('  ✗ ' + n + '\n    ' + e.message); failed++; } }
const eq = (a, e, m) => { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${m || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); };
const F = (key, type = 'text', extra = {}) => ({ id: 'f_' + key, block_type: 'field', key, label: key, type, ...extra });

const T1 = 'Acquirente che sa già cosa vuole', T2 = 'Venditore', T3 = 'Acquirente che cerca casa e non ha tempo';
const PAC = path.join(__dirname, '../../../super-admin/backend/src/pacchetti/mediazione-immobiliare/');

(async () => {
  require('./index.js');
  for (let i = 0; i < 100; i++) { try { if ((await fetch('http://localhost:' + TEST_PORT + '/health')).ok) break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
  const db = require('./db'), { applicaSeed } = require('./seed-blocchi-verticale');
  const est = require(PAC + 'estensioni.json'), documenti = require(PAC + 'documenti.json'), abb = require(PAC + 'abbinamenti.json');
  const blocco = (lista, key) => lista.find((e) => e.key === key);

  const matchClienti = { id: 'mtc_c', block_type: 'match_view', key: 'immobili_adatti', label: 'Immobili adatti', target_module: 'immobili', display_field: 'titolo', when: { field: 'tipo_cliente', equals: 'Acquirente' }, target_filter: { field: '_stato', in: ['in_vendita'] }, rules: [{ mine: 'ricerca_tipologia', theirs: 'tipologia', op: 'testo', label: 'Tipologia' }] };
  const matchImmobili = { id: 'mtc_i', block_type: 'match_view', key: 'richieste_compatibili', label: 'Richieste compatibili', target_module: 'clienti', display_field: 'nome', target_filter: { field: 'tipo_cliente', equals: 'Acquirente' }, rules: [{ mine: 'tipologia', theirs: 'ricerca_tipologia', op: 'testo', label: 'Tipologia' }] };
  db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES ('Clienti', 'clienti', 'box', '#000', 1, 1, 70, ?)")
    .run(JSON.stringify({ version: 3, steps: [F('nome'), F('email'), F('telefono'), F('pec'), F('residenza'), F('luogo_nascita'), F('data_nascita', 'date'), F('codice_fiscale_piva'), F('documento_tipo'), F('documento_numero'), F('azienda'),
      F('tipo_cliente', 'select', { options: ['Venditore', 'Acquirente'] }), F('esigenza_acquisto', 'select', { options: ["Ha già individuato l'immobile", 'Cerca immobile'] }),
      F('ricerca_tipologia'), F('ricerca_budget_max', 'currency'), F('ricerca_zona'), matchClienti] }));
  db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES ('Immobili', 'immobili', 'box', '#000', 1, 1, 71, ?)")
    .run(JSON.stringify({ version: 3, steps: [F('titolo'), F('tipologia'), F('prezzo_richiesto', 'currency'), F('comune'), matchImmobili] }));
  const rec = (d) => db.prepare('INSERT INTO records (module_slug, data) VALUES (?, ?)').run('clienti', JSON.stringify(d)).lastInsertRowid;
  const idAcq = rec({ nome: 'A', tipo_cliente: 'Acquirente' }), idVen = rec({ nome: 'V', tipo_cliente: 'Venditore' }), idAltro = rec({ nome: 'X', tipo_cliente: 'Altro' });
  const steps = (slug) => JSON.parse(db.prepare('SELECT schema_json FROM modules WHERE slug = ?').get(slug).schema_json).steps;
  const campo = (slug, k) => steps(slug).find((x) => x.block_type === 'field' && x.key === k);
  const tipoDi = (id) => JSON.parse(db.prepare('SELECT data FROM records WHERE id = ?').get(id).data).tipo_cliente;
  const applica = (slug, key, lista) => applicaSeed({ [slug]: [blocco(lista, key)] }, { tipo: 'estensione' });

  await test('i tre tipi: elenco nuovo, chi era «Acquirente» passa a «sa già cosa vuole», gli altri valori non si toccano', async () => {
    eq((await applica('clienti', 'tre_tipi_cliente', est.clienti)).map((e) => e.esito), ['applicato']);
    eq(campo('clienti', 'tipo_cliente').options, [T1, T2, T3]);
    eq(tipoDi(idAcq), T1); eq(tipoDi(idVen), 'Venditore'); eq(tipoDi(idAltro), 'Altro');
  });
  await test('i campi della ricerca compaiono solo per i due acquirenti; la vecchia «Esigenza» si nasconde', () => {
    for (const k of ['ricerca_tipologia', 'ricerca_budget_max', 'ricerca_zona']) eq(campo('clienti', k).visible_if, { enabled: true, field: 'tipo_cliente', op: 'in', value: T1 + '|' + T3 }, k);
    eq(campo('clienti', 'esigenza_acquisto').visible_if.value, 'Acquirente');
  });
  await test('campi dell\'incarico di ricerca: compaiono solo per «cerca casa e non ha tempo», in una sezione propria', async () => {
    eq((await applica('clienti', 'campi_incarico_ricerca', est.clienti)).map((e) => e.esito), ['applicato']);
    const nuovi = steps('clienti').filter((x) => x.sezione === 'Incarico di ricerca');
    eq(nuovi.length, 18);
    for (const f of nuovi) eq(f.visible_if, { enabled: true, field: 'tipo_cliente', op: '==', value: T3 }, f.key);
    eq(campo('clienti', 'ricerca_esclusiva').options, ['In esclusiva', 'Non in esclusiva']);
  });
  await test('«Immobili adatti» e «Richieste compatibili» valgono per i due acquirenti', async () => {
    eq((await applica('clienti', 'immobili_adatti_due_acquirenti', est.clienti)).map((e) => e.esito), ['applicato']);
    eq(steps('clienti').find((x) => x.key === 'immobili_adatti').when, { field: 'tipo_cliente', in: [T1, T3] });
    eq((await applica('immobili', 'richieste_compatibili_due_acquirenti', est.immobili)).map((e) => e.esito), ['applicato']);
    eq(steps('immobili').find((x) => x.key === 'richieste_compatibili').target_filter, { field: 'tipo_cliente', in: [T1, T3] });
  });
  await test('una condizione già cambiata dall\'utente non si tocca', async () => {
    const cambiata = steps('clienti').map((x) => (x.key === 'immobili_adatti' ? { ...x, when: { field: 'tipo_cliente', equals: 'Venditore' } } : x));
    db.prepare("UPDATE modules SET schema_json = ? WHERE slug = 'clienti'").run(JSON.stringify({ version: 3, steps: cambiata }));
    db.prepare("DELETE FROM seed_applicati WHERE chiave = 'estensione:clienti:immobili_adatti_due_acquirenti'").run();
    await applica('clienti', 'immobili_adatti_due_acquirenti', est.clienti);
    eq(steps('clienti').find((x) => x.key === 'immobili_adatti').when, { field: 'tipo_cliente', equals: 'Venditore' });
  });
  await test('secondo avvio: niente da fare', async () => {
    eq(await applica('clienti', 'tre_tipi_cliente', est.clienti), []);
    eq(await applica('clienti', 'campi_incarico_ricerca', est.clienti), []);
  });
  await test('il documento «Incarico di ricerca» si aggiunge, da firmare, e compare solo per il terzo tipo', async () => {
    const doc = documenti.clienti.find((d) => d.key === 'incarico_ricerca');
    eq((await applicaSeed({ clienti: [doc] })).map((e) => e.esito), ['applicato']);
    const az = steps('clienti').find((x) => x.block_type === 'document_action' && x.key === 'incarico_ricerca');
    eq(az.delivery, 'firma'); eq(az.pdf_modello, 'incarico-ricerca'); eq(az.visible_if, { enabled: true, field: 'tipo_cliente', op: '==', value: T3 });
    for (const k of (doc.body.match(/\{\{[#^]?\s*([a-z_]+)/g) || []).map((m) => m.replace(/\{\{[#^]?\s*/, ''))) {
      if (!k.startsWith('@')) eq(!!campo('clienti', k), true, 'campo citato dal documento: ' + k);
    }
  });
  await test('proposta irrevocabile d\'acquisto: i campi si aggiungono alla trattativa e il documento (da firmare) cita solo campi che esistono, anche di cliente, immobile e venditore', async () => {
    const doc = documenti.trattative.find((d) => d.key === 'proposta_acquisto');
    const percorsi = [...new Set((doc.body.match(/\{\{[#^]?\s*([a-z_.@]+)/g) || []).map((m) => m.replace(/\{\{[#^]?\s*/, '')))].filter((p) => !p.startsWith('@'));
    const di = (rel) => percorsi.filter((p) => p.startsWith(rel + '.')).map((p) => p.split('.')[1]);
    const aggiungi = (slug, chiavi) => { const s = steps(slug); db.prepare('UPDATE modules SET schema_json = ? WHERE slug = ?').run(JSON.stringify({ version: 3, steps: [...s, ...[...new Set(chiavi)].filter((k) => !s.some((x) => x.key === k)).map((k) => F(k))] }), slug); };
    aggiungi('immobili', di('immobile')); aggiungi('clienti', [...di('cliente'), ...di('venditore')]);
    const rel = (key, target) => ({ id: 'r_' + key, block_type: 'relation', key, label: key, type: 'many_to_one', target_module: target, display_field: 'nome' });
    db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES ('Trattative', 'trattative', 'box', '#000', 1, 1, 72, ?)")
      .run(JSON.stringify({ version: 3, steps: [F('titolo'), rel('cliente', 'clienti'), rel('immobile', 'immobili'), rel('venditore', 'clienti')] }));
    eq((await applicaSeed({ trattative: [blocco(est.trattative, 'campi_proposta_acquisto')] }, { tipo: 'estensione' })).map((e) => e.esito), ['applicato']);
    eq(steps('trattative').filter((x) => x.sezione === "Proposta d'acquisto").length, 29);
    for (const k of percorsi.filter((p) => !p.includes('.'))) eq(!!campo('trattative', k), true, 'campo citato dal documento: ' + k);
    eq((await applicaSeed({ trattative: [doc] })).map((e) => e.esito), ['applicato']);
    const az = steps('trattative').find((x) => x.block_type === 'document_action' && x.key === 'proposta_acquisto');
    eq(az.delivery, 'firma'); eq(az.recipient, 'cliente.email'); eq(az.pdf_modello, 'proposta-acquisto');
    // anche l'accordo provvigionale: il suo testo cita solo campi che esistono
    const acc = documenti.trattative.find((d) => d.key === 'accordo_provvigionale');
    aggiungi('immobili', (acc.body.match(/\{\{[#^]?\s*immobile\.([a-z_]+)/g) || []).map((m) => m.replace(/.*immobile\./, '')));
    aggiungi('clienti', (acc.body.match(/\{\{[#^]?\s*cliente\.([a-z_]+)/g) || []).map((m) => m.replace(/.*cliente\./, '')));
    eq((await applicaSeed({ trattative: [acc] })).map((e) => e.esito), ['applicato']);
    eq(steps('trattative').find((x) => x.block_type === 'document_action' && x.key === 'accordo_provvigionale').pdf_modello, 'accordo-provvigionale');
  });
  await test('nel pacchetto per i nuovi tenant gli abbinamenti citano i due tipi, non più «Acquirente»', () => {
    eq(abb.clienti[0].when, { field: 'tipo_cliente', in: [T1, T3] });
    eq(abb.immobili[0].target_filter, { field: 'tipo_cliente', in: [T1, T3] });
  });
  console.log(`\n${passed} passati, ${failed} falliti`); process.exit(failed ? 1 : 0);
})();
