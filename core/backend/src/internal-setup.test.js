'use strict';
// Impostazione di un tenant dall'analisi (routes/internal-setup.js) e righe senza importo nei report (kind «pratica»).
// Server vero, DB temporaneo. Eseguire con: node src/internal-setup.test.js (porta 34853 libera).
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const TEST_PORT = 34853, BASE = 'http://localhost:' + TEST_PORT;
process.env.DB_PATH = path.join(os.tmpdir(), 'isetup-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'is_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'is_internal_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'is_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'is-uploads-'));
const SECRET = process.env.INTERNAL_API_SECRET;

let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); console.log('  ✓ ' + name); passed++; } catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; } }
const eq = (a, e, m) => { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${m || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m || 'atteso true'); };

async function main() {
  require('./index.js');
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
  const db = require('./db'); const roles = require('./module-roles'); const ai = require('./module-ai'); const rep = require('./reports'); const feat = require('./features');
  const F = (key, type, extra = {}) => ({ id: 'f_' + key, block_type: 'field', key, label: key, type, ...extra });
  const add = (slug) => db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES (?, ?, 'box', '#000', 1, 1, 70, ?)").run(slug, slug, JSON.stringify({ version: 3, steps: [F('titolo', 'text'), F('scadenza', 'date'), F('importo', 'currency')] }));
  add('ticket'); add('spese_x'); add('timbr');
  const post = (body, secret = SECRET) => fetch(BASE + '/api/internal-setup/apply', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-secret': secret }, body: JSON.stringify(body) });
  const PRATICA = { kind: 'pratica', uses: ['avvisi'], roles: { descrizione: 'titolo', scadenza: 'scadenza', stato: '_stato' }, avvisi: { states: { nuovo: 'aperto', da_fare: 'in_corso', fatto: 'risolto' }, nuovo: true, scadenze: true, label: 'ticket', noun_s: 'ticket', noun_p: 'ticket' } };

  await test('senza il secret interno non entra nessuno', async () => { eq((await post({}, 'sbagliato')).status, 401); eq((await fetch(BASE + '/api/internal-setup/apply', { method: 'POST' })).status, 401); });
  await test('dichiara i ruoli dei moduli installati, accende le funzioni che servono, crea i report SPENTI', async () => {
    eq(feat.isEnabled('riepilogo_mattino'), false);
    const r = await (await post({
      module_roles: [{ slug: 'ticket', ...PRATICA }, { slug: 'spese_x', kind: 'spesa', uses: ['riepiloghi'], roles: { importo: 'importo' } }, { slug: 'non_installato', kind: 'spesa' }],
      ai: [{ slug: 'spese_x', features: ['import', 'boh'] }],
      reports: [{ tipo: 'in_ritardo', nome: 'Ticket in ritardo', params: { stato: 'da_fare', weekday: 2, ora: 8, titolo: 'Ticket fermi', enabled: true } }, { tipo: 'sconosciuto' }],
    })).json();
    eq(r.module_roles, ['ticket', 'spese_x']); eq(roles.get('ticket').kind, 'pratica'); eq(roles.get('ticket').avvisi.states.fatto, 'risolto');
    eq(r.ai, [{ slug: 'spese_x', features: ['import'] }]); eq(ai.get('spese_x'), ['import']); eq(ai.masterOn(), false, 'l\'interruttore generale resta spento');
    ok(r.features.includes('riepilogo_mattino') && r.features.includes('analisi'), JSON.stringify(r.features)); eq(feat.isEnabled('riepilogo_mattino'), true);
    eq(r.reports.length, 1); const d = rep.definizione(r.reports[0]); eq([d.enabled, d.weekday, d.ora, d.titolo, d.nome], [false, 2, 8, 'Ticket fermi', 'Ticket in ritardo'], 'spento anche se i parametri dicevano enabled');
    ok(r.saltati.some((x) => /non installato/.test(x)) && r.saltati.some((x) => /report/.test(x)));
  });
  await test('si completa, non si sovrascrive: ruoli e potenziamenti già scelti restano', async () => {
    roles.set('spese_x', { kind: 'spesa', uses: [], roles: { importo: 'importo', data: 'data' } }); ai.set('spese_x', ['explain']);
    const r = await (await post({ module_roles: [{ slug: 'spese_x', kind: 'entrata', roles: {} }], ai: [{ slug: 'spese_x', features: ['triage'] }] })).json();
    eq(r.module_roles, []); eq(r.ai, []); eq(roles.get('spese_x').kind, 'spesa'); eq(ai.get('spese_x'), ['explain']); eq(r.saltati.length, 2);
  });
  await test('un tenant senza report non li accende; le funzioni non si spengono mai', async () => {
    feat.set('riepilogo_mattino', false); const r = await (await post({ features: { riepilogo_mattino: false, whatsapp: true } })).json();
    eq(r.features, ['whatsapp']); eq(feat.isEnabled('riepilogo_mattino'), false, 'false nella richiesta non spegne né accende'); feat.set('riepilogo_mattino', true);
  });
  await test('I REPORT sulle «pratiche» (senza importo) non scrivono importi inventati', async () => {
    const put = (d) => db.prepare("INSERT INTO records (module_slug, user_id, data) VALUES ('ticket', NULL, ?)").run(JSON.stringify(d));
    // Data di scadenza in fuso di Roma (rep.romeParts), non UTC (Date...toISOString()):
    // buildInRitardo calcola "oggi" con rep.romeParts(now).date — tra mezzanotte e le
    // 2 (ora legale) il giorno di calendario a Roma è già cambiato mentre quello UTC no,
    // quindi la vecchia versione (UTC) produceva "da 4 gg" invece di "da 3 gg" proprio in
    // quella finestra. Bug del test, non del prodotto: daysBetween confronta due date
    // nello stesso fuso solo se ENTRAMBE vengono da romeParts/addDays, come qui.
    const oggi = rep.addDays(rep.romeParts(new Date()).date, -3);
    put({ titolo: 'Stampante rotta', scadenza: oggi, _stato: 'in_corso' }); put({ titolo: 'Accesso mail', _stato: 'aperto' });
    const ritardo = rep.addDefinition('in_ritardo', 'Ticket in ritardo').id; rep.saveSettings(ritardo, { stato: 'da_fare', piede: '' });
    const t1 = rep.build(ritardo).text; ok(/Stampante rotta · da 3 gg/.test(t1) && !/€/.test(t1) && !/NaN|undefined/.test(t1), t1);
    const coda = rep.addDefinition('coda', 'Nuovi ticket').id; rep.saveSettings(coda, { stato: 'nuovo' });
    const t2 = rep.build(coda).text; ok(/Accesso mail/.test(t2) && !/importo da verificare|€|NaN/.test(t2), t2);
  });

  console.log(`\n${'='.repeat(60)}\n${passed} passati, ${failed} falliti su ${passed + failed} test.`);
  try { fs.unlinkSync(process.env.DB_PATH); } catch (e) {}
  process.exit(failed > 0 ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
