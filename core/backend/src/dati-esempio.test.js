'use strict';
// Dati di esempio dallo schema: records collegati tra loro, valori validi, stati distribuiti, nessuna automazione scattata, tutto rimovibile. Eseguire con: node src/dati-esempio.test.js
const path = require('path'); const os = require('os'); const crypto = require('crypto');
process.env.DB_PATH = path.join(os.tmpdir(), 'esempio-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.JWT_SECRET = 'jwt_' + crypto.randomBytes(8).toString('hex');
process.env.ENCRYPTION_KEY = 'esempio_test_encryption_key_00';
process.env.INTERNAL_API_SECRET = 'int_' + crypto.randomBytes(8).toString('hex');
let passati = 0, falliti = 0;
function test(nome, fn) { try { fn(); console.log('  ✓ ' + nome); passati++; } catch (e) { console.error('  ✗ ' + nome + '\n    ' + e.message); falliti++; } }
const ok = (c, m) => { if (!c) throw new Error(m || 'atteso true'); };
const db = require('./db');
db.prepare('DELETE FROM modules').run(); db.prepare('DELETE FROM records').run();
const F = (key, extra = {}) => ({ id: 'f_' + key, block_type: 'field', key, label: key, type: 'text', ...extra });
const S = (key, initial) => ({ id: 's_' + key, block_type: 'workflow_state', key, label: key, ...(initial ? { initial: true } : {}) });
const T = (from, to) => ({ id: 't_' + from + to, block_type: 'workflow_transition', from, to, label: from + to });
const mod = (slug, steps) => db.prepare('INSERT INTO modules (name, slug, installed, schema_json) VALUES (?, ?, 1, ?)').run(slug, slug, JSON.stringify({ version: 3, steps }));
mod('pratiche', [F('titolo'), { id: 'r', block_type: 'relation', key: 'persona', label: 'Persona', type: 'many_to_one', target_module: 'persone', display_field: 'nome' }, F('importo', { type: 'currency' }), F('data', { type: 'date' }), F('tipo', { type: 'select', options: ['A', 'B', 'C'] }),
  S('aperta', true), S('firmata'), S('chiusa'), T('aperta', 'firmata'), T('firmata', 'chiusa'),
  { id: 'au', block_type: 'automation', label: 'Compenso', trigger: { evento: 'cambio_stato', stato: 'firmata' }, azioni: [{ target: '__interno__', azione: 'crea_record', config: { modulo: 'persone', dati: { nome: 'Automatico' } } }] }]);
mod('persone', [F('nome', { required: true }), F('cf', { validazione: 'codice_fiscale_o_piva_it' }), F('email', { type: 'email' }), F('citta')]);
const { carica, rimuovi, conta } = require('./lib/dati-esempio');
const { controllaValidazioni } = require('./validazioni-campo');
const tutti = (slug) => db.prepare('SELECT id, data FROM records WHERE module_slug = ?').all(slug).map((r) => ({ id: r.id, ...JSON.parse(r.data) }));
test('crea il numero richiesto di record per ogni modulo con campi', () => {
  const r = carica({ quanti: 6 }); ok(r.creati.persone === 6 && r.creati.pratiche === 6, JSON.stringify(r.creati));
  ok(tutti('persone').length === 6 && tutti('pratiche').length === 6, 'conteggi');
});
test('le relazioni puntano a record che esistono davvero (le persone nascono prima delle pratiche)', () => {
  const idPersone = new Set(tutti('persone').map((p) => p.id));
  for (const p of tutti('pratiche')) ok(idPersone.has(p.persona), 'persona ' + p.persona + ' inesistente');
});
test('i valori sono validi e vari: codice fiscale o partita IVA validi, email, scelte a rotazione, date vicine a oggi', () => {
  const campi = [{ key: 'cf', validazione: 'codice_fiscale_o_piva_it', label: 'cf' }];
  const persone = tutti('persone');
  for (const p of persone) ok(!controllaValidazioni(campi, p), 'cf non valido: ' + p.cf);
  ok(new Set(persone.map((p) => p.cf)).size === persone.length, 'codici duplicati');
  ok(persone.every((p) => /@example\.com$/.test(p.email)), 'email');
  ok(new Set(tutti('pratiche').map((p) => p.tipo)).size === 3, 'scelte non a rotazione');
  const oggi = Date.now(); ok(tutti('pratiche').every((p) => Math.abs(new Date(p.data) - oggi) < 50 * 86400000), 'date lontane');
});
test('i record sono distribuiti su tutti gli stati del flusso', () => {
  const stati = new Set(tutti('pratiche').map((p) => p._stato)); ok(stati.size === 3, [...stati].join());
});
test('nessuna automazione è scattata e ogni record è marcato come dimostrativo', () => {
  ok(tutti('persone').every((p) => p._demo === true) && !tutti('persone').some((p) => p.nome === 'Automatico'), 'persone');
  ok(conta().persone === 6 && conta().pratiche === 6, JSON.stringify(conta()));
});
test('non si caricano due volte, e rimuovi toglie tutto', () => {
  let errore = null; try { carica({ quanti: 2 }); } catch (e) { errore = e; }
  ok(errore && errore.status === 409, 'doveva rifiutare');
  const r = rimuovi(); ok(r.rimossi.persone === 6 && r.rimossi.pratiche === 6, JSON.stringify(r));
  ok(db.prepare('SELECT COUNT(*) n FROM records').get().n === 0, 'restano record');
});
test('i dati veri non si toccano', () => {
  db.prepare('INSERT INTO records (module_slug, user_id, data) VALUES (?, 1, ?)').run('persone', JSON.stringify({ nome: 'Vero' }));
  carica({ quanti: 2 }); rimuovi();
  ok(tutti('persone').length === 1 && tutti('persone')[0].nome === 'Vero', 'il record vero è sparito');
});
console.log(`\n${passati} passati, ${falliti} falliti`); process.exit(falliti ? 1 : 0);
