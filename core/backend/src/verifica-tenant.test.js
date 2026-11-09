'use strict';
// «Quanto è operativo il tenant»: schemi coerenti passano tutti i controlli, schemi con riferimenti rotti vengono segnalati uno per uno, senza scrivere nulla. Eseguire con: node src/verifica-tenant.test.js
const path = require('path'); const os = require('os'); const crypto = require('crypto');
process.env.DB_PATH = path.join(os.tmpdir(), 'verifica-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.JWT_SECRET = 'jwt_' + crypto.randomBytes(8).toString('hex');
process.env.ENCRYPTION_KEY = 'verifica_test_encryption_key_000';
process.env.INTERNAL_API_SECRET = 'int_' + crypto.randomBytes(8).toString('hex');
let passati = 0, falliti = 0;
function test(nome, fn) { try { fn(); console.log('  ✓ ' + nome); passati++; } catch (e) { console.error('  ✗ ' + nome + '\n    ' + e.message); falliti++; } }
const ok = (c, m) => { if (!c) throw new Error(m || 'atteso true'); };

const db = require('./db');
const { verifica } = require('./lib/verifica-tenant');
// parto da un tenant vuoto: tolgo i moduli di base che crea l'avvio
db.prepare('DELETE FROM modules').run();
const F = (key, extra = {}) => ({ id: 'f_' + key, block_type: 'field', key, label: key, type: 'text', ...extra });
const S = (key, initial) => ({ id: 's_' + key, block_type: 'workflow_state', key, label: key, ...(initial ? { initial: true } : {}) });
const T = (from, to, extra = {}) => ({ id: 't_' + from + to, block_type: 'workflow_transition', from, to, label: from + '→' + to, ...extra });
const mod = (slug, steps) => db.prepare('INSERT INTO modules (name, slug, installed, schema_json) VALUES (?, ?, 1, ?)').run(slug, slug, JSON.stringify({ version: 3, steps }));
const problemi = () => verifica().problemi.map((p) => p.modulo + '|' + p.messaggio);

mod('persone', [F('nome'), F('email'), F('data_nascita', { type: 'date' })]);
mod('pratiche', [
  F('titolo'), F('importo', { type: 'number' }),
  { id: 'r1', block_type: 'relation', key: 'persona', label: 'Persona', type: 'many_to_one', target_module: 'persone', display_field: 'nome' },
  { id: 'al', block_type: 'allegati', label: 'Allegati', types: ['Contratto'] },
  S('aperta', true), S('firmata'), S('chiusa'),
  T('aperta', 'firmata'), T('firmata', 'chiusa'),
  { id: 'rq', block_type: 'state_requirements', stato: 'firmata', bloccante: true, requisiti: [{ label: 'Importo', tipo: 'campo', campo: 'importo' }, { label: 'Contratto', tipo: 'allegato', valore: 'Contratto' }, { label: 'Nome della persona', tipo: 'campo', campo: 'persona.nome' }] },
  { id: 'au', block_type: 'automation', label: 'Crea una persona alla firma', trigger: { evento: 'cambio_stato', stato: 'firmata' }, azioni: [{ target: '__interno__', azione: 'crea_record', config: { modulo: 'persone', dati: { nome: 'campo:titolo' } } }] },
  { id: 'do', block_type: 'document_action', key: 'lettera', label: 'Lettera', subject: 'Pratica {{titolo}}', body: 'Gentile {{persona.nome}}, {{@oggi}}', recipient: 'persona.email' },
  { id: 'ca', block_type: 'calendar_view', key: 'cal', label: 'Cal', date_field: 'titolo', title_field: 'titolo' },
]);

test('un tenant coerente supera tutti i controlli', () => {
  const v = verifica();
  ok(v.problemi.length === 0, 'problemi inattesi: ' + problemi().join(' ; '));
  ok(v.punteggio === 100 && v.controlli > 15, 'punteggio ' + v.punteggio + ' su ' + v.controlli + ' controlli');
  ok(v.moduli === 2, 'moduli');
});

// schema rotto: ogni difetto deve comparire con il suo messaggio
mod('guaste', [
  F('titolo'),
  { id: 'r1', block_type: 'relation', key: 'x', label: 'X', type: 'many_to_one', target_module: 'non_esiste', display_field: 'nome' },
  { id: 'r2', block_type: 'relation', key: 'p', label: 'P', type: 'many_to_one', target_module: 'persone', display_field: 'campo_inventato' },
  S('uno'), S('due', true), S('isolato'), T('uno', 'due'), T('due', 'fantasma'),
  { id: 'rq', block_type: 'state_requirements', stato: 'uno', bloccante: true, requisiti: [{ label: 'Manca', tipo: 'campo', campo: 'campo_assente' }, { label: 'Allegato', tipo: 'allegato', valore: 'Mai previsto' }] },
  { id: 'au', block_type: 'automation', label: 'Rotta', trigger: { evento: 'cambio_stato', stato: 'stato_assente' }, azioni: [{ target: '__interno__', azione: 'crea_record', config: { modulo: 'altro_modulo', dati: {} } }] },
  { id: 'vuota', block_type: 'automation', label: 'Vuota', trigger: { evento: 'cambio_stato', stato: 'uno' }, azioni: [] },
  { id: 'do', block_type: 'document_action', key: 'd', label: 'D', subject: 'Ciao {{nome_inventato}}', body: 'x' },
  { id: 'ca', block_type: 'calendar_view', key: 'cal', label: 'Cal', date_field: 'data_che_non_c_e', title_field: 'titolo', done_state: 'finito' },
  { id: 'pe', block_type: 'permissions', rules: [{ role: 'ruolo_fantasma', view: true }] },
  F('calcolo', { type: 'computed', expr: 'campo_che_non_esiste * 2' }),
]);
test('i difetti dello schema vengono segnalati uno per uno', () => {
  const p = problemi().filter((x) => x.startsWith('guaste|')).join('\n');
  for (const frammento of [
    'non_esiste', 'campo_inventato', 'fantasma', 'campo_assente', 'Mai previsto', 'stato_assente', 'altro_modulo', 'nessuna azione|Non ha nessuna azione',
    'nome_inventato', 'data_che_non_c_e', 'finito', 'ruolo_fantasma', 'non si raggiunge',
  ]) {
    const alternative = frammento.split('|');
    ok(alternative.some((a) => p.includes(a)), 'manca la segnalazione «' + frammento + '»\n' + p);
  }
});
mod('senzainiziale', [F('a'), S('x'), S('y'), T('x', 'y')]);
test('senza stato iniziale viene segnalato', () => {
  ok(problemi().some((x) => x.startsWith('senzainiziale|') && /Nessuno stato iniziale/.test(x)), problemi().join('\n'));
  db.prepare("DELETE FROM modules WHERE slug = 'senzainiziale'").run();
});
test('il punteggio scende e i moduli sani restano senza problemi', () => {
  const v = verifica(); ok(v.punteggio < 100 && v.punteggio > 20, 'punteggio ' + v.punteggio);
  ok(!problemi().some((x) => x.startsWith('pratiche|') || x.startsWith('persone|')), 'i moduli sani non devono avere problemi');
});
test('un servizio esterno non collegato finisce tra le cose da completare a mano e non toglie punti', () => {
  const prima = verifica().punteggio;
  mod('esterna', [F('a'), { id: 'ea', block_type: 'external_action', key: 'k', label: 'Verifica', adapter: 'da_attivare', servizio_richiesto: 'il servizio X' }]);
  const v = verifica(); ok(v.da_completare_a_mano.some((m) => m.modulo === 'esterna' && /Verifica/.test(m.cosa)), 'voce mancante');
  ok(v.problemi.filter((p) => p.modulo === 'esterna').length === 0 && v.punteggio >= prima - 1, 'non deve togliere punti');
});
test('un tenant senza moduli non è «rotto»', () => {
  db.prepare('DELETE FROM modules').run(); const v = verifica(); ok(v.controlli === 0 && v.punteggio === 100, JSON.stringify(v));
});
console.log(`\n${passati} passati, ${falliti} falliti`); process.exit(falliti ? 1 : 0);
