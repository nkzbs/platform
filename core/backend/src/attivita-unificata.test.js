'use strict';
// Attività come unico modulo: `rinomina` nelle estensioni (solo se l'etichetta è ancora quella di prima), migrazione di Visite e Interazioni (una volta sola, modulo di partenza spento,
// record di partenza segnati) ed «eredita» dalla relazione (la trattativa porta immobile e cliente). Nessun server: DB temporaneo e un finto callAs.
const path = require('path'); const os = require('os'); const fs = require('fs'); const crypto = require('crypto');
process.env.DB_PATH = path.join(os.tmpdir(), 'attu-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.JWT_SECRET = 'at_secret_' + crypto.randomBytes(8).toString('hex');
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'at-uploads-'));
let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); console.log('  ✓ ' + name); passed++; } catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; } }
const eq = (a, e, m) => { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${m || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m || 'atteso true'); };

const db = require('./db'); const seed = require('./seed-blocchi-verticale'); const { parseSchemaNormalized } = require('./schema-v3'); const { applicaEredita } = require('./lib/eredita-relazione');
const PK = '../../../super-admin/backend/src/pacchetti/mediazione-immobiliare/';
const EST = require(PK + 'estensioni.json').attivita, MIG = require(PK + 'migrazioni.json'), MODULI = require(PK + 'moduli.json');
const F = (key, type = 'text', label) => ({ id: 'f_' + key, block_type: 'field', key, label: label || key, type });
const R = (key, target) => ({ id: 'r_' + key, block_type: 'relation', key, label: key, type: 'many_to_one', target_module: target, display_field: 'nome' });
const add = (slug, steps) => db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES (?, ?, 'box', '#000', 1, 1, 80, ?)").run(slug, slug, JSON.stringify({ version: 3, steps }));
const rec = (slug, d) => db.prepare('INSERT INTO records (module_slug, data) VALUES (?, ?)').run(slug, JSON.stringify(d)).lastInsertRowid;
const bozze = {};
const finto = async (user, method, p, body) => {
  if (p.endsWith('/draft')) bozze[p.split('/')[2]] = body.schema;
  if (p.endsWith('/publish')) db.prepare('UPDATE modules SET schema_json = ? WHERE slug = ?').run(JSON.stringify(bozze[p.split('/')[2]]), p.split('/')[2]);
  if (method === 'POST' && p.startsWith('/records/')) return { ok: true, data: { id: rec(p.split('/')[2], body) } };
  return { ok: true, data: {} };
};
const steps = (slug) => JSON.parse(db.prepare('SELECT schema_json FROM modules WHERE slug = ?').get(slug).schema_json).steps;
const dati = (slug) => db.prepare('SELECT id, data FROM records WHERE module_slug = ? ORDER BY id').all(slug).map((r) => ({ id: r.id, ...JSON.parse(r.data) }));

async function main() {
  db.prepare('DELETE FROM users').run(); db.prepare("INSERT INTO users (username, password_hash, role) VALUES ('admin', 'x', 'admin')").run();
  add('clienti', [F('nome')]); add('immobili', [F('titolo')]); add('trattative', [F('titolo'), R('immobile', 'immobili'), R('cliente', 'clienti')]);
  add('attivita', MODULI.attivita.steps);
  add('visite', [F('oggetto'), F('data_visita', 'date'), F('ora'), F('agente'), F('esito'), F('note'), R('immobile', 'immobili'), R('cliente', 'clienti')]);
  add('interazioni', [R('cliente', 'clienti'), F('tipo'), F('data_ora'), F('esito'), F('prossimo_contatto', 'date')]);

  await test('l\'estensione si applica: tipo, collegamenti, calendario; «Scadenza» diventa «Quando»; un nome scelto dall\'utente non si tocca', async () => {
    const esiti = await seed.applicaSeed({ attivita: EST }, { tipo: 'estensione', callAs: finto });
    eq(esiti.map((e) => e.esito), ['applicato']);
    const st = steps('attivita'); eq(st.find((x) => x.key === 'scadenza').label, 'Quando'); ok(st.some((x) => x.key === 'tipo') && st.some((x) => x.block_type === 'calendar_view'), 'campi e calendario');
    // un altro tenant dove l'utente aveva già chiamato il campo «Data»
    add('attivita2', MODULI.attivita.steps.map((x) => (x.key === 'scadenza' ? { ...x, label: 'Data' } : x)));
    await seed.applicaSeed({ attivita2: EST }, { tipo: 'estensione', callAs: finto }); eq(steps('attivita2').find((x) => x.key === 'scadenza').label, 'Data');
  });
  const c1 = rec('clienti', { nome: 'Rossi' }), i1 = rec('immobili', { titolo: 'Via Roma' });
  rec('visite', { oggetto: 'Visita Via Roma', data_visita: '2026-11-12', ora: '15:30', agente: 'Anna', esito: 'Interessato', note: 'Portare planimetria', immobile: i1, cliente: c1, _stato: 'conclusa' });
  rec('visite', { oggetto: 'Visita bilocale', data_visita: '2026-11-20', immobile: i1, cliente: c1, _stato: 'programmata', _demo: 1 });
  rec('interazioni', { cliente: c1, tipo: 'Telefonata', data_ora: '2026-11-10T09:30', esito: 'Da richiamare', prossimo_contatto: '2026-11-15', _stato: 'svolta' });
  await test('migrazione: Visite e Interazioni diventano attività con tipo, data, ora e stato giusti; il modulo di partenza si spegne', async () => {
    const esiti = await seed.migraModuli(MIG, { callAs: finto });
    eq(esiti.map((e) => e.slug + ':' + e.esito + ':' + e.spostati), ['visite:applicato:2', 'interazioni:applicato:1']);
    const a = dati('attivita'); eq(a.length, 3);
    eq([a[0].titolo, a[0].tipo, a[0].scadenza, a[0].ora, a[0].agente, a[0].esito, a[0].descrizione, a[0]._stato, a[0].immobile, a[0].cliente], ['Visita Via Roma', 'Visita', '2026-11-12', '15:30', 'Anna', 'Interessato', 'Portare planimetria', 'fatto', i1, c1]);
    eq([a[1]._stato, a[1]._demo], ['da_fare', 1], 'stato e segno di dimostrativo');
    eq([a[2].titolo, a[2].tipo, a[2].scadenza, a[2].ora, a[2].descrizione, a[2].prossimo_contatto, a[2]._stato], ['Telefonata', 'Telefonata', '2026-11-10', '09:30', 'Da richiamare', '2026-11-15', 'fatto']);
    eq(db.prepare("SELECT slug FROM modules WHERE active = 0 ORDER BY slug").all().map((m) => m.slug), ['interazioni', 'visite'], 'spenti, non cancellati');
    ok(dati('visite').every((v) => v._migrato), 'record di partenza segnati e conservati'); eq(dati('visite').length, 2);
  });
  await test('una volta sola: ripetere non crea doppioni', async () => { eq(await seed.migraModuli(MIG, { callAs: finto }), []); eq(dati('attivita').length, 3); });
  await test('modulo di partenza assente: non è un errore e non si segna; modulo di arrivo senza i campi: si riprova dopo', async () => {
    eq(await seed.migraModuli({ x: { da: 'non_esiste', a: 'attivita', campi: {} } }, { callAs: finto }), []);
    add('vuoto', [F('a')]); rec('vuoto', { a: 1 });
    eq(await seed.migraModuli({ x: { da: 'vuoto', a: 'attivita', campi: { campo_che_non_c_e: 'a' } } }, { callAs: finto }), []); eq(db.prepare("SELECT 1 FROM seed_applicati WHERE chiave = 'migrazione:vuoto>attivita'").get(), undefined, 'nessun marcatore');
  });
  await test('eredita: la trattativa porta immobile e cliente se sono vuoti, mai sopra un valore scritto; relazione verso un record inesistente: nulla', () => {
    const t = rec('trattative', { titolo: 'Trattativa', immobile: i1, cliente: c1 });
    const schema = parseSchemaNormalized(db.prepare('SELECT schema_json FROM modules WHERE slug = ?').get('attivita').schema_json);
    eq(applicaEredita(db, schema, { titolo: 'x', trattativa: t }), { titolo: 'x', trattativa: t, immobile: i1, cliente: c1 });
    eq(applicaEredita(db, schema, { trattativa: t, immobile: 999 }).immobile, 999, 'valore scritto intatto'); eq(applicaEredita(db, schema, { trattativa: t, immobile: 999 }).cliente, c1, 'ma il vuoto si compila');
    eq(applicaEredita(db, schema, { trattativa: 424242 }), { trattativa: 424242 }); eq(applicaEredita(db, schema, { titolo: 'solo' }), { titolo: 'solo' });
  });
  console.log(`\n${'='.repeat(60)}\n${passed} passati, ${failed} falliti su ${passed + failed} test.`);
  try { fs.unlinkSync(process.env.DB_PATH); } catch (e) {}
  process.exit(failed > 0 ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
