'use strict';
// Dashboard di base dai moduli: «Da fare», numeri, percorso dei flussi, scadenze; non tocca una Dashboard già fatta. Eseguire con: node src/dashboard-base.test.js
const path = require('path'); const os = require('os'); const crypto = require('crypto');
process.env.DB_PATH = path.join(os.tmpdir(), 'dash-base-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.JWT_SECRET = 'jwt_' + crypto.randomBytes(8).toString('hex');
process.env.ENCRYPTION_KEY = 'dash_base_test_encryption_key_0';
process.env.INTERNAL_API_SECRET = 'int_' + crypto.randomBytes(8).toString('hex');
let passati = 0, falliti = 0;
function test(nome, fn) { try { fn(); console.log('  ✓ ' + nome); passati++; } catch (e) { console.error('  ✗ ' + nome + '\n    ' + e.message); falliti++; } }
const ok = (c, m) => { if (!c) throw new Error(m || 'atteso true'); };
const db = require('./db');
db.prepare('DELETE FROM modules').run(); db.prepare('DELETE FROM dashboard_widgets').run();
const F = (key, extra = {}) => ({ id: 'f_' + key, block_type: 'field', key, label: key, type: 'text', ...extra });
const S = (key, initial) => ({ id: 's_' + key, block_type: 'workflow_state', key, label: key, ...(initial ? { initial: true } : {}) });
const mod = (slug, steps) => db.prepare('INSERT INTO modules (name, slug, installed, schema_json) VALUES (?, ?, 1, ?)').run(slug[0].toUpperCase() + slug.slice(1), slug, JSON.stringify({ version: 3, steps }));
mod('persone', [F('nome')]);
mod('fatture', [F('numero'), F('data_scadenza', { type: 'date' }), S('emessa', true), S('pagata')]);
const { piano, crea } = require('./lib/dashboard-base');
test('il piano ha «Da fare», un numero per modulo, il percorso dei flussi e le scadenze', () => {
  const p = piano(); const tipi = p.map((x) => x.type + ':' + (x.module_slug || ''));
  ok(tipi.includes('agenda:') && tipi.includes('kpi:persone') && tipi.includes('kpi:fatture') && tipi.includes('percorso:fatture'), tipi.join());
  ok(!tipi.includes('percorso:persone'), 'persone non ha flusso');
  const seg = p.find((x) => x.type === 'segnali'); ok(seg && seg.config.voci[0].modulo === 'fatture' && seg.config.voci[0].filtri[0].campo === 'data_scadenza', JSON.stringify(seg));
});
test('crea i riquadri in una Dashboard vuota, in ordine', () => {
  const r = crea(); ok(r.creati === 5 && !r.saltata, JSON.stringify(r));
  const righe = db.prepare("SELECT type, sort_order FROM dashboard_widgets ORDER BY sort_order").all(); ok(righe.length === 5 && righe[0].type === 'agenda' && righe.every((x, i) => x.sort_order === i), JSON.stringify(righe));
});
test('non tocca una Dashboard già fatta, a meno che lo si chieda', () => {
  ok(crea().saltata === true && db.prepare('SELECT COUNT(*) n FROM dashboard_widgets').get().n === 5, 'doveva saltare');
  ok(crea({ soloSeVuota: false }).creati === 5 && db.prepare('SELECT COUNT(*) n FROM dashboard_widgets').get().n === 10, 'con forza aggiunge');
});
console.log(`\n${passati} passati, ${falliti} falliti`); process.exit(falliti ? 1 : 0);
