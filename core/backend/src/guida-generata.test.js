'use strict';
// La guida generata dai moduli: capitoli, flussi, giro guidato e passi per ruolo dicono cose vere sullo schema, e la guida del tenant vince su quella dei pacchetti. Eseguire con: node src/guida-generata.test.js
const path = require('path'); const os = require('os'); const crypto = require('crypto');
process.env.DB_PATH = path.join(os.tmpdir(), 'guida-gen-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.JWT_SECRET = 'jwt_' + crypto.randomBytes(8).toString('hex');
process.env.ENCRYPTION_KEY = 'guida_gen_test_encryption_key_00';
process.env.INTERNAL_API_SECRET = 'int_' + crypto.randomBytes(8).toString('hex');
process.env.TENANT_NAME = 'Studio Prova';
let passati = 0, falliti = 0;
function test(nome, fn) { try { fn(); console.log('  ✓ ' + nome); passati++; } catch (e) { console.error('  ✗ ' + nome + '\n    ' + e.message); falliti++; } }
const ok = (c, m) => { if (!c) throw new Error(m || 'atteso true'); };
const db = require('./db');
db.prepare('DELETE FROM modules').run();
const F = (key, extra = {}) => ({ id: 'f_' + key, block_type: 'field', key, label: key[0].toUpperCase() + key.slice(1), type: 'text', ...extra });
const S = (key, label, initial) => ({ id: 's_' + key, block_type: 'workflow_state', key, label, ...(initial ? { initial: true } : {}) });
const T = (from, to) => ({ id: 't_' + from + to, block_type: 'workflow_transition', from, to, label: from + to });
const mod = (slug, name, steps) => db.prepare('INSERT INTO modules (name, slug, installed, schema_json, sort_order) VALUES (?, ?, 1, ?, ?)').run(name, slug, JSON.stringify({ version: 3, steps }), db.prepare('SELECT COUNT(*) n FROM modules').get().n);
mod('persone', 'Persone', [F('nome', { required: true }), F('cf', { validazione: 'codice_fiscale_it', label: 'Codice fiscale' }), F('email', { type: 'email', dato_chiave: true })]);
mod('pratiche', 'Pratiche', [F('titolo', { required: true }), F('importo', { type: 'number' }),
  { id: 'r', block_type: 'relation', key: 'persona', label: 'Persona', type: 'many_to_one', target_module: 'persone', display_field: 'nome' },
  { id: 'al', block_type: 'allegati', label: 'Allegati', types: ['Contratto', 'Documento'] },
  S('aperta', 'Aperta', true), S('firmata', 'Firmata'), S('chiusa', 'Chiusa'), T('aperta', 'firmata'), T('firmata', 'chiusa'),
  { id: 'rq', block_type: 'state_requirements', stato: 'firmata', bloccante: true, requisiti: [{ label: 'Importo', tipo: 'campo', campo: 'importo' }, { label: 'Contratto', tipo: 'allegato', valore: 'Contratto' }] },
  { id: 'au', block_type: 'automation', label: 'Compenso alla firma', trigger: { evento: 'cambio_stato', stato: 'firmata' }, azioni: [{ target: '__interno__', azione: 'crea_record', config: { modulo: 'persone', dati: {} } }] },
  { id: 'do', block_type: 'document_action', key: 'lettera', label: 'Lettera', subject: 's', body: 'b' },
  { id: 'ca', block_type: 'calendar_view', key: 'cal', label: 'Cal', date_field: 'titolo' }]);
const { genera } = require('./lib/guida-generata');
let g;
test('la guida generata ha introduzione, capitoli, flussi, giro e passi per ruolo', () => {
  g = genera();
  ok(/Studio Prova/.test(g.introduzione.titolo), g.introduzione.titolo);
  ok(g.introduzione.testo[0].includes('Persone') && g.introduzione.testo[0].includes('Pratiche'), g.introduzione.testo[0]);
  ok(Object.keys(g.capitoli).join() === 'persone,pratiche', Object.keys(g.capitoli).join());
  ok(g.per_ruolo.admin.passi.length >= 4 && g.per_ruolo.default.passi.length >= 2, 'passi per ruolo');
  ok(g.giro[0].pagina === 'dashboard' && g.giro.some((p) => p.pagina === 'pratiche'), 'giro');
});
test('il capitolo dice cose vere sullo schema: obbligatori, validazione, relazioni, percorso, requisiti, documenti, automazioni, allegati', () => {
  const p = g.capitoli.persone, q = g.capitoli.pratiche; const t = (c) => [c.scopo, ...c.come_si_usa, ...c.consigli].join('\n');
  ok(/Nome/.test(t(p)) && /Codice fiscale/.test(t(p)) && /controllato mentre salvi/.test(t(p)), t(p));
  ok(/Persone/.test(t(q)) && /Aperta.*Firmata.*Chiusa/.test(t(q)), t(q));
  ok(/Per passare a «Firmata» servono: Importo e Contratto/.test(t(q)), t(q));
  ok(/Lettera/.test(t(q)) && /Contratto e Documento/.test(t(q)) && /Calendario/.test(t(q)) && /crea da sola le schede in Persone/.test(t(q)), t(q));
  ok(/Pratiche/.test(t(p)), 'Persone dovrebbe dire che compare in Pratiche: ' + t(p));
});
test('un flusso per ogni modulo con un percorso', () => {
  ok(g.flussi.length === 1 && g.flussi[0].passi.length === 3 && /Pratiche/.test(g.flussi[0].titolo), JSON.stringify(g.flussi));
  ok(g.glossario.some((x) => x.termine === 'Firmata'), 'glossario');
});
test('la guida del tenant vince su quella dei pacchetti e riempie la rotta', () => {
  db.prepare("INSERT INTO guida_tenant (id, contenuto) VALUES (1, ?)").run(JSON.stringify(g));
  const u = require('./routes/guida').unisci([]);
  ok(u.capitoli.pratiche && u.introduzione.titolo === g.introduzione.titolo && u.giro.length === g.giro.length, 'unione');
});
test('un tenant senza moduli genera comunque una guida valida', () => {
  db.prepare('DELETE FROM modules').run(); const v = genera();
  ok(Object.keys(v.capitoli).length === 0 && v.introduzione.titolo, JSON.stringify(v).slice(0, 120));
});
console.log(`\n${passati} passati, ${falliti} falliti`); process.exit(falliti ? 1 : 0);
