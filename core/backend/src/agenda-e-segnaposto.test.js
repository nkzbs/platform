'use strict';
// L'agenda del giorno (GET /api/module-roles/agenda: i moduli con scadenze acceso e campo scadenza dichiarato) e le funzioni «da attivare» (adattatore segnaposto).
// Server vero, DB temporaneo. Eseguire con: node src/agenda-e-segnaposto.test.js (porta 34871 libera).
const path = require('path'); const os = require('os'); const fs = require('fs'); const crypto = require('crypto');
const TEST_PORT = 34871, BASE = 'http://localhost:' + TEST_PORT;
process.env.DB_PATH = path.join(os.tmpdir(), 'agenda-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'ag_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'ag_internal_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'ag_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-uploads-'));
let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); console.log('  ✓ ' + name); passed++; } catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; } }
const eq = (a, e, m) => { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${m || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m || 'atteso true'); };

async function main() {
  require('./index.js');
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
  const db = require('./db'); const roles = require('./module-roles');
  const login = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: process.env.INITIAL_ADMIN_PASSWORD }) })).json();
  const H = { Authorization: 'Bearer ' + login.token, 'Content-Type': 'application/json' };
  const F = (key, type = 'text') => ({ id: 'f_' + key, block_type: 'field', key, label: key, type });
  const add = (slug, steps) => db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES (?, ?, 'box', '#000', 1, 1, 70, ?)").run(slug, slug, JSON.stringify({ version: 3, steps }));
  add('visite_x', [F('oggetto'), F('quando', 'date')]);
  add('senza_scadenze', [F('oggetto'), F('quando', 'date')]);
  roles.set('visite_x', { kind: 'pratica', uses: ['avvisi'], roles: { descrizione: 'oggetto', scadenza: 'quando' }, avvisi: { states: { nuovo: '', da_fare: '', fatto: 'conclusa' }, scadenze: true, noun_s: 'visita', noun_p: 'visite' } });
  roles.set('senza_scadenze', { kind: 'pratica', uses: ['avvisi'], roles: { descrizione: 'oggetto', scadenza: 'quando' }, avvisi: { states: { nuovo: '', da_fare: '', fatto: 'ok' }, scadenze: false } });

  await test('/module-roles/agenda: elenca solo i moduli con scadenze acceso e campo scadenza, col campo del «fatto»', async () => {
    const r = await (await fetch(BASE + '/api/module-roles/agenda', { headers: H })).json();
    eq(r.map((m) => m.module_slug), ['visite_x']); eq([r[0].scadenza, r[0].descrizione, r[0].fatto, r[0].noun_s], ['quando', 'oggetto', 'conclusa', 'visita']);
    eq((await fetch(BASE + '/api/module-roles/agenda')).status, 401, 'serve il login');
  });
  await test('un widget «agenda» si crea dall\'impostazione del tenant senza un modulo proprio; uno sconosciuto o senza modulo no', async () => {
    const r = await (await fetch(BASE + '/api/internal-setup/apply', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.INTERNAL_API_SECRET }, body: JSON.stringify({ dashboard: [{ type: 'agenda', etichetta: 'Da fare' }, { type: 'boh' }, { type: 'kpi', modulo: 'non_installato' }] }) })).json();
    eq(r.dashboard, 1); const w = db.prepare("SELECT type, module_slug, label FROM dashboard_widgets WHERE page = 'dashboard'").all(); eq(w, [{ type: 'agenda', module_slug: null, label: 'Da fare' }]);
  });
  await test('il widget «Da fare» si aggiunge a una Dashboard già piena, una volta sola; a una vuota no (ci pensa il profilo)', async () => {
    const eng = require('./seed-blocchi-verticale'); const n = () => db.prepare("SELECT COUNT(*) c FROM dashboard_widgets WHERE type = 'agenda'").get().c;
    db.prepare("DELETE FROM dashboard_widgets").run(); eq(eng.aggiungiWidgetAgenda(), false, 'vuota'); eq(n(), 0);
    db.prepare("INSERT INTO dashboard_widgets (type, module_slug, label, sort_order, config, roles, user_ids, page) VALUES ('kpi', 'visite_x', 'K', 3, '{}', '[]', '[]', 'dashboard')").run();
    eq(eng.aggiungiWidgetAgenda(), true); eq(n(), 1); eq(eng.aggiungiWidgetAgenda(), false, 'una volta sola'); eq(n(), 1);
    eq(db.prepare("SELECT sort_order FROM dashboard_widgets WHERE type = 'agenda'").get().sort_order, 4, 'in fondo');
  });
  await test('l\'adattatore «da_attivare» non chiama nulla: 501 col motivo, e il record non cambia', async () => {
    add('clienti_x', [F('nome'), { id: 'ea', block_type: 'external_action', key: 'verifica', label: 'Verifica del soggetto', adapter: 'da_attivare', servizio_richiesto: 'il servizio Risk' }]);
    const id = db.prepare("INSERT INTO records (module_slug, data) VALUES ('clienti_x', ?)").run(JSON.stringify({ nome: 'Rossi' })).lastInsertRowid;
    const r = await fetch(BASE + '/api/records/clienti_x/' + id + '/azione/verifica', { method: 'POST', headers: H, body: JSON.stringify({ conferma: true }) });
    eq(r.status, 501); const j = await r.json(); eq(j.code, 'da_attivare'); ok(/Risk/.test(j.error), j.error);
    eq(JSON.parse(db.prepare('SELECT data FROM records WHERE id = ?').get(id).data), { nome: 'Rossi' });
    const tab = db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'openapi_spese'").get(); // il registro si crea alla prima spesa: qui non deve esserci nulla
    eq(tab ? db.prepare('SELECT COUNT(*) c FROM openapi_spese').get().c : 0, 0, 'nessuna spesa');
  });

  console.log(`\n${'='.repeat(60)}\n${passed} passati, ${failed} falliti su ${passed + failed} test.`);
  try { fs.unlinkSync(process.env.DB_PATH); } catch (e) {}
  process.exit(failed > 0 ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
