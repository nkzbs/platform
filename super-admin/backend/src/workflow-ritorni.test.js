'use strict';
// Dall'analisi al tenant: il ritorno indietro di un passaggio (`ritorna_a`) e il marchio dell'azienda nel profilo.
// Funzioni pure, nessun server. Eseguire con: node src/workflow-ritorni.test.js
const path = require('path');
const os = require('os');
const crypto = require('crypto');
process.env.DB_PATH = path.join(os.tmpdir(), 'ritorni-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.JWT_SECRET = 'rit_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'rit_internal_' + crypto.randomBytes(8).toString('hex');
process.env.ENCRYPTION_KEY = 'rit_enc_' + crypto.randomBytes(8).toString('hex');

let passed = 0, failed = 0;
function test(name, fn) { try { fn(); console.log('  ✓ ' + name); passed++; } catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; } }
const eq = (a, e, m) => { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${m || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m || 'atteso true'); };

const { buildWorkflowSteps } = require('./lib/tenant-config-from-analysis');
const analysis = require('./lib/analysis');
const ruoli = new Map([['agente', { tipo: 'utente', slug: 'agente' }]]);
const P = (titolo, extra = {}) => ({ titolo, ruolo: 'Agente', descrizione: '', tipo: 'step', ...extra });

console.log('\n--- ritorno indietro ---');
test('senza ritorni: solo transizioni in avanti, come prima', () => {
  const s = buildWorkflowSteps([P('Verifica'), P('Documenti'), P('Verificato')], ruoli);
  eq(s.filter((x) => x.block_type === 'workflow_transition').map((x) => x.from + '>' + x.to), ['verifica>documenti', 'documenti>verificato']);
});
test('ritorna_a aggiunge la transizione indietro con i ruoli del passaggio', () => {
  const s = buildWorkflowSteps([P('Verifica'), P('Documenti', { ritorna_a: 'Verifica' }), P('Verificato')], ruoli);
  const tr = s.filter((x) => x.block_type === 'workflow_transition');
  eq(tr.map((x) => x.from + '>' + x.to), ['verifica>documenti', 'documenti>verificato', 'documenti>verifica']);
  eq(tr[2].roles, ['agente']);
  ok(/^Torna a/.test(tr[2].label), tr[2].label);
});
test('un ritorno verso un passaggio che non esiste, o verso se stesso, si ignora', () => {
  const s = buildWorkflowSteps([P('Verifica', { ritorna_a: 'Inesistente' }), P('Documenti', { ritorna_a: 'Documenti' })], ruoli);
  eq(s.filter((x) => x.block_type === 'workflow_transition').length, 1);
});
test('la pulizia dei processi conserva ritorna_a', () => {
  const [p] = analysis.sanitizeProcessi([{ nome: 'X', passaggi: [{ titolo: 'A' }, { titolo: 'B', ritorna_a: 'A' }] }], null);
  eq(p.passaggi.map((x) => x.ritorna_a), ['', 'A']);
});

console.log('\n--- marchio nel profilo ---');
test('il marchio si conserva; logo non valido e colore non valido si scartano', () => {
  const m = analysis.sanitizeProfilo({ marchio: { ragione_sociale: 'Agenzia', piva: '123', logo_url: 'javascript:alert(1)', accent_color: 'rosso' } }).marchio;
  eq(m.ragione_sociale, 'Agenzia'); eq(m.piva, '123'); eq(m.logo_url, ''); eq(m.accent_color, '');
  const buono = analysis.sanitizeProfilo({ marchio: { logo_url: 'data:image/png;base64,AAAA', accent_color: '#16355B' } }).marchio;
  eq(buono.logo_url, 'data:image/png;base64,AAAA'); eq(buono.accent_color, '#16355B');
  eq(analysis.sanitizeProfilo({}).marchio.ragione_sociale, '');
});

console.log('\n--- configurazione esatta del tenant ---');
test('azione, ritorna_etichetta e colore si riportano nel flusso', () => {
  const s = buildWorkflowSteps([P('Verifica', { colore: '#3B82F6' }), P('Documenti', { azione: 'Documenti inviati', ritorna_a: 'Verifica', ritorna_etichetta: 'Documenti da rifare', colore: '#F59E0B' })], ruoli);
  eq(s.filter((x) => x.block_type === 'workflow_state').map((x) => x.color), ['#3B82F6', '#F59E0B']);
  eq(s.filter((x) => x.block_type === 'workflow_transition').map((x) => x.label), ['Documenti inviati', 'Documenti da rifare']);
});
test('la configurazione si pulisce: id validi, colori validi, relazioni AI accese di default', () => {
  const c = analysis.sanitizeProfilo({ configurazione: { ruoli: ['A', '', 'B'], moduli: [{ id: '7', permessi: ['A'], passaggi: [{ titolo: 'X', colore: 'rosso' }, { titolo: '' }] }, { id: 0 }] } }).configurazione;
  eq(c.ruoli, ['A', 'B']); eq(c.moduli.length, 1); eq(c.moduli[0].id, 7); eq(c.moduli[0].passaggi.length, 1); eq(c.moduli[0].passaggi[0].colore, ''); eq(c.relazioni_ai, true);
  eq(analysis.sanitizeProfilo({ configurazione: { relazioni_ai: false } }).configurazione.relazioni_ai, false);
});
test('AI generale spenta di default; i widget della Dashboard si puliscono; il pacchetto li porta al tenant', () => {
  const c = analysis.sanitizeProfilo({ configurazione: { ai_attiva: 'si', dashboard: [{ type: 'kpi', modulo: 'immobili' }, { type: '', modulo: 'x' }] } }).configurazione;
  eq(c.ai_attiva, false); eq(c.dashboard.length, 1);
  const pk = analysis.pacchettoTenant([], [], { ai_attiva: true, dashboard: c.dashboard });
  eq(pk.ai_master, true); eq(pk.dashboard.length, 1); eq(analysis.pacchettoTenant([], [], c).ai_master, undefined);
});

console.log(`\n${passed} passati, ${failed} falliti`);
process.exit(failed ? 1 : 0);
