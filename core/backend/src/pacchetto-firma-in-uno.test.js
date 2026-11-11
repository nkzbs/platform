'use strict';
// Pacchetto Mediazione immobiliare 24: i documenti del cliente si fanno firmare in un pacchetto. Su un tenant che ha ancora i documenti di prima l'estensione
// «firma_in_un_pacchetto» aggiorna SOLO ciò che è ancora com'era (etichetta e testo di «Anagrafica + privacy», delivery e tipo firmato dell'«Antiriciclaggio», archivia «Privacy + Incarico»);
// ciò che l'agenzia ha cambiato dal Builder non si tocca. Eseguire con: node src/pacchetto-firma-in-uno.test.js (porta 34863).
const path = require('path'), os = require('os'), fs = require('fs'), crypto = require('crypto');
const TEST_PORT = 34863, BASE = 'http://localhost:' + TEST_PORT;
process.env.DB_PATH = path.join(os.tmpdir(), 'pfu-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'pfu_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'pfu_internal_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'pfu_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pfu-uploads-'));
process.env.SUPER_ADMIN_URL = 'http://localhost:1';
process.env.TENANT_SLUG = 'pfu';
let passed = 0, failed = 0;
async function test(n, fn) { try { await fn(); console.log('  ✓ ' + n); passed++; } catch (e) { console.error('  ✗ ' + n + '\n    ' + e.message); failed++; } }
const eq = (a, e, m) => { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${m || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m || 'atteso true'); };
const F = (key) => ({ id: 'f_' + key, block_type: 'field', key, label: key, type: 'text' });
const P = path.join(__dirname, '../../../super-admin/backend/src/pacchetti/mediazione-immobiliare');

async function main() {
  require('./index.js');
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
  const db = require('./db'); const { applicaSeed } = require('./seed-blocchi-verticale');
  const estensioni = require(P + '/estensioni.json'), documenti = require(P + '/documenti.json');
  const est = estensioni.clienti.find((e) => e.key === 'firma_in_un_pacchetto');
  const riscr = est.riscrivi[0].proprieta;
  const mk = (slug, steps) => db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES (?, ?, 'box', '#000', 1, 1, 70, ?)").run(slug, slug, JSON.stringify({ version: 3, steps }));
  const blocco = (slug, key) => JSON.parse(db.prepare('SELECT schema_json FROM modules WHERE slug = ?').get(slug).schema_json).steps.find((x) => x.key === key);
  const vecchioDoc = (key, extra) => ({ id: 'd_' + key, block_type: 'document_action', key, ...extra });

  // Il tenant «di prima»: i tre documenti com'erano nel pacchetto 23 (testo di «Anagrafica + privacy» = la `da` dell'estensione).
  const CAMPI = ['nome', 'email', 'tipo_soggetto', 'codice_fiscale_piva', 'data_nascita', 'indirizzo', 'telefono', 'consenso_marketing', 'consenso_terzi', 'privacy_firmata_il', 'privacy_versione', 'conservazione_fino_al', 'tipo_cliente'].map(F);
  const FLUSSO = [{ id: 's1', block_type: 'workflow_state', key: 'verifica', label: 'Verifica', initial: true }, { id: 's2', block_type: 'workflow_state', key: 'documenti_inviati', label: 'Documenti inviati' }, { id: 't1', block_type: 'workflow_transition', from: 'verifica', to: 'documenti_inviati', label: 'Inviati' }];
  mk('clienti', [...CAMPI, ...FLUSSO,
    vecchioDoc('privacy_incarico', { label: 'Privacy + Incarico', subject: 's', body: 'b', recipient: 'email', on_send_state: 'documenti_inviati' }),
    vecchioDoc('antiriciclaggio', { label: 'Antiriciclaggio', subject: 's', body: 'b', recipient: 'email', on_send_state: 'documenti_inviati' }),
    vecchioDoc('anagrafica_privacy', { label: riscr.label.da, delivery: 'firma', body: riscr.body.da, signed_type: 'anagrafica_firmata' })]);
  mk('altro', [F('nome'), F('email'), vecchioDoc('anagrafica_privacy', { label: 'Il mio titolo', delivery: 'firma', body: 'Il mio testo', signed_type: 'x' })]);
  const mappaEst = { clienti: [est] };

  await test('su un tenant di prima: etichetta e testo aggiornati, antiriciclaggio da firmare, privacy + incarico archiviato, destinatario impostato', async () => {
    const esiti = await applicaSeed(mappaEst, { tipo: 'estensione' });
    eq(esiti.map((e) => e.esito), ['applicato']);
    const a = blocco('clienti', 'anagrafica_privacy');
    eq(a.label, 'Informativa privacy e incarico'); eq(a.recipient, 'email'); ok(/conferisce inoltre incarico/.test(a.body), 'il testo dell\'incarico è dentro'); ok(/I SUOI CONSENSI/.test(a.body), 'il resto del testo c\'è ancora');
    const m = blocco('clienti', 'antiriciclaggio'); eq(m.delivery, 'firma'); eq(m.signed_type, 'antiriciclaggio_firmato'); eq(m.on_send_state, 'documenti_inviati');
    eq(blocco('clienti', 'privacy_incarico').archiviato, true);
  });
  await test('il testo del nuovo pacchetto è quello dell\'estensione (nessuna differenza tra tenant nuovi e vecchi)', async () => {
    eq(riscr.body.a, documenti.clienti.find((d) => d.key === 'anagrafica_privacy').body);
    eq(documenti.clienti.find((d) => d.key === 'anagrafica_privacy').label, 'Informativa privacy e incarico');
    eq(documenti.clienti.find((d) => d.key === 'privacy_incarico').archiviato, true);
    eq(documenti.clienti.find((d) => d.key === 'antiriciclaggio').delivery, 'firma');
  });
  await test('un secondo avvio non cambia nulla', async () => {
    const prima = db.prepare("SELECT schema_json FROM modules WHERE slug = 'clienti'").get().schema_json;
    await applicaSeed(mappaEst, { tipo: 'estensione' });
    eq(db.prepare("SELECT schema_json FROM modules WHERE slug = 'clienti'").get().schema_json, prima);
  });
  await test('un titolo o un testo cambiati dall\'agenzia non si toccano', async () => {
    db.prepare("DELETE FROM seed_applicati WHERE chiave LIKE 'estensione:%'").run();
    const mappaAltro = { altro: [est] };
    await applicaSeed(mappaAltro, { tipo: 'estensione' });
    const a = blocco('altro', 'anagrafica_privacy'); eq(a.label, 'Il mio titolo'); eq(a.body, 'Il mio testo'); eq(a.recipient, 'email', 'il destinatario, che mancava, si imposta');
  });
  console.log(`\n${passed} passati, ${failed} falliti`); process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
