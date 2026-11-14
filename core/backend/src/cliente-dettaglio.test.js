'use strict';
// Scheda cliente del pacchetto Mediazione immobiliare: campi di SOLA LETTURA (i consensi privacy si confermano solo firmando), regime patrimoniale e coniuge condizionati
// allo stato civile, professionista di riferimento, tipo di allegato «Documenti urbanistici e catastali» su un tenant che ha ancora l'elenco di prima.
// Eseguire con: node src/cliente-dettaglio.test.js (porta 34871).
const path = require('path'), os = require('os'), fs = require('fs'), crypto = require('crypto');
const TEST_PORT = 34871, BASE = 'http://localhost:' + TEST_PORT;
process.env.DB_PATH = path.join(os.tmpdir(), 'cld-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'cld_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'cld_internal_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'cld_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cld-uploads-'));
process.env.SUPER_ADMIN_URL = 'http://localhost:1';
process.env.TENANT_SLUG = 'cld';
let passed = 0, failed = 0;
async function test(n, fn) { try { await fn(); console.log('  ✓ ' + n); passed++; } catch (e) { console.error('  ✗ ' + n + '\n    ' + e.message); failed++; } }
const eq = (a, e, m) => { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${m || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m || 'atteso true'); };
const P = path.join(__dirname, '../../../super-admin/backend/src/pacchetti/mediazione-immobiliare');
const VECCHI_TIPI = ['Documento di identità', 'Codice fiscale', 'Attualità della residenza', 'Atto di provenienza (venditore)', 'Atto di matrimonio (acquirente, facoltativo)', 'Privacy e incarico firmato', 'Antiriciclaggio firmato', 'Altro'];

async function main() {
  require('./index.js');
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
  const db = require('./db'); const { applicaSeed } = require('./seed-blocchi-verticale');
  const estensioni = require(P + '/estensioni.json'), documenti = require(P + '/documenti.json');
  const login = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: process.env.INITIAL_ADMIN_PASSWORD }) })).json();
  const H = { Authorization: 'Bearer ' + login.token, 'Content-Type': 'application/json' };
  const F = (key, type = 'text', extra) => ({ id: 'f_' + key, block_type: 'field', key, label: key, type, ...(extra || {}) });
  const SOLA = ['consenso_marketing', 'consenso_terzi', 'privacy_firmata_il', 'privacy_versione', 'conservazione_fino_al'];
  // Un Clienti «di prima»: i consensi sono caselle normali, l'elenco degli allegati è quello vecchio, il regime patrimoniale è sempre visibile.
  db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES ('Clienti', 'clienti', 'box', '#000', 1, 1, 70, ?)").run(JSON.stringify({ version: 3, steps: [
    F('nome'), F('stato_civile', 'select', { options: ['Celibe / Nubile', 'Coniugato/a', 'Unito/a civilmente'] }), F('regime_patrimoniale', 'select', { options: ['Comunione dei beni', 'Separazione dei beni', 'Non applicabile'] }),
    F('consenso_marketing', 'checkbox'), F('consenso_terzi', 'checkbox'), F('privacy_firmata_il', 'date'), F('privacy_versione'), F('conservazione_fino_al', 'date'),
    { id: 'al1', block_type: 'allegati', label: 'Allegati', types: VECCHI_TIPI }] }));
  const schemaClienti = () => JSON.parse(db.prepare("SELECT schema_json FROM modules WHERE slug = 'clienti'").get().schema_json);
  const blocco = (key) => schemaClienti().steps.find((x) => x.key === key);
  const nuove = ['stato_civile_dettaglio', 'professionista_riferimento', 'allegati_urbanistici', 'consensi_sola_lettura'].map((k) => estensioni.clienti.find((e) => e.key === k));
  ok(nuove.every(Boolean), 'le quattro estensioni esistono nel pacchetto');

  await test('su un tenant di prima: consensi di sola lettura, regime patrimoniale condizionato, coniuge e professionista aggiunti, nuovo tipo di allegato', async () => {
    const esiti = await applicaSeed({ clienti: nuove }, { tipo: 'estensione' });
    eq(esiti.map((e) => e.esito), ['applicato', 'applicato', 'applicato', 'applicato']);
    for (const k of SOLA) eq(blocco(k).sola_lettura, true, k);
    eq(blocco('regime_patrimoniale').visible_if, { enabled: true, field: 'stato_civile', op: 'in', value: 'Coniugato/a|Unito/a civilmente' });
    eq(blocco('coniuge_nome').visible_if.value, 'Comunione dei beni'); eq(blocco('coniuge_codice_fiscale').sezione, 'Anagrafica');
    eq(['professionista_nome', 'professionista_contatto', 'professionista_email'].map((k) => blocco(k).sezione), Array(3).fill('Professionista di riferimento'));
    const al = schemaClienti().steps.find((x) => x.block_type === 'allegati');
    ok(al.types.includes('Documenti urbanistici e catastali'), 'nuovo tipo'); eq(al.types.length, VECCHI_TIPI.length + 1); eq(al.types[4], 'Documenti urbanistici e catastali', 'accanto ai documenti dell\'immobile');
  });
  await test('un elenco di allegati cambiato dall\'agenzia non si tocca', async () => {
    const s = schemaClienti(); s.steps.find((x) => x.block_type === 'allegati').types = ['Solo questo'];
    db.prepare("UPDATE modules SET schema_json = ? WHERE slug = 'clienti'").run(JSON.stringify(s));
    db.prepare("DELETE FROM seed_applicati WHERE chiave = 'estensione:clienti:allegati_urbanistici'").run();
    await applicaSeed({ clienti: [nuove[2]] }, { tipo: 'estensione' });
    eq(schemaClienti().steps.find((x) => x.block_type === 'allegati').types, ['Solo questo']);
  });
  await test('sola lettura: alla creazione i consensi nascono vuoti, in modifica non cambiano, il resto sì', async () => {
    const c = await (await fetch(BASE + '/api/records/clienti', { method: 'POST', headers: H, body: JSON.stringify({ nome: 'Mario', consenso_marketing: true, privacy_versione: 'x' }) })).json();
    const dati = (r) => (r.data && typeof r.data === 'string' ? JSON.parse(r.data) : r.data) || {};
    eq(dati(c).nome, 'Mario'); ok(!dati(c).consenso_marketing, 'consenso scritto a mano alla creazione'); ok(!dati(c).privacy_versione, 'versione scritta a mano');
    // Come se la firma avesse registrato il consenso (scrive direttamente, come la rotta «firmato»).
    db.prepare('UPDATE records SET data = ? WHERE id = ?').run(JSON.stringify({ nome: 'Mario', consenso_marketing: true, privacy_versione: '2026-11' }), c.id);
    const m = await (await fetch(BASE + '/api/records/clienti/' + c.id, { method: 'PUT', headers: H, body: JSON.stringify({ nome: 'Mario Rossi', consenso_marketing: false, privacy_versione: 'altra' }) })).json();
    eq(dati(m).nome, 'Mario Rossi'); eq(dati(m).consenso_marketing, true, 'il consenso firmato non si cancella a mano'); eq(dati(m).privacy_versione, '2026-11');
  });
  await test('i campi creati dal pacchetto per i tenant nuovi sono di sola lettura anche negli «aggiungi_campi» del documento', async () => {
    const campi = documenti.clienti.find((d) => d.key === 'anagrafica_privacy').aggiungi_campi;
    eq(campi.map((c) => !!c.sola_lettura), [true, true, true, true, true]);
  });
  console.log('\n' + passed + ' passati, ' + failed + ' falliti');
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
