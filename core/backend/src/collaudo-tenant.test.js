'use strict';
// Collaudo automatico: su un tenant di prova con un flusso vero (stati, requisito bloccante, automazione che crea record, documento) il collaudo attraversa tutto in una copia isolata
// e non tocca il database vero. Un modulo con un difetto (flusso che non arriva a uno stato) viene segnalato. Eseguire con: node src/collaudo-tenant.test.js
const path = require('path'); const os = require('os'); const crypto = require('crypto');
process.env.DB_PATH = path.join(os.tmpdir(), 'collaudo-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.JWT_SECRET = 'jwt_' + crypto.randomBytes(8).toString('hex');
process.env.ENCRYPTION_KEY = 'collaudo_test_encryption_key_00';
process.env.INTERNAL_API_SECRET = 'int_' + crypto.randomBytes(8).toString('hex');
process.env.UPLOAD_DIR = require('fs').mkdtempSync(path.join(os.tmpdir(), 'collaudo-up-'));
let passati = 0, falliti = 0;
async function test(nome, fn) { try { await fn(); console.log('  ✓ ' + nome); passati++; } catch (e) { console.error('  ✗ ' + nome + '\n    ' + e.message); falliti++; } }
const ok = (c, m) => { if (!c) throw new Error(m || 'atteso true'); };
const db = require('./db');
db.prepare('DELETE FROM modules').run();
const F = (key, extra = {}) => ({ id: 'f_' + key, block_type: 'field', key, label: key, type: 'text', ...extra });
const S = (key, initial) => ({ id: 's_' + key, block_type: 'workflow_state', key, label: key, ...(initial ? { initial: true } : {}) });
const T = (from, to) => ({ id: 't_' + from + to, block_type: 'workflow_transition', from, to, label: from + '→' + to });
const mod = (slug, steps) => db.prepare('INSERT INTO modules (name, slug, installed, schema_json) VALUES (?, ?, 1, ?)').run(slug, slug, JSON.stringify({ version: 3, steps }));
mod('persone', [F('nome', { required: true }), F('email', { type: 'email' }), F('cf', { validazione: 'codice_fiscale_it' })]);
mod('compensi', [F('descrizione'), F('importo', { type: 'number' }), { id: 'r', block_type: 'relation', key: 'pratica', label: 'Pratica', type: 'many_to_one', target_module: 'pratiche', display_field: 'titolo' }, S('da_pagare', true), S('pagato'), T('da_pagare', 'pagato')]);
mod('pratiche', [
  F('titolo'), F('importo', { type: 'number' }), F('tipo', { type: 'select', options: ['Vendita', 'Acquisto'] }),
  { id: 'r', block_type: 'relation', key: 'persona', label: 'Persona', type: 'many_to_one', target_module: 'persone', display_field: 'nome' },
  { id: 'al', block_type: 'allegati', label: 'Allegati', types: ['Contratto'] },
  S('aperta', true), S('firmata'), S('chiusa'), T('aperta', 'firmata'), T('firmata', 'chiusa'),
  { id: 'rq', block_type: 'state_requirements', stato: 'firmata', bloccante: true, requisiti: [{ label: 'Importo', tipo: 'campo', campo: 'importo' }, { label: 'Contratto', tipo: 'allegato', valore: 'Contratto' }] },
  { id: 'au', block_type: 'automation', label: 'Compenso alla firma', trigger: { evento: 'cambio_stato', stato: 'firmata' }, azioni: [{ target: '__interno__', azione: 'crea_record', config: { modulo: 'compensi', dati: { descrizione: 'Compenso', pratica: '__origine_id__', _stato: 'da_pagare' } } }] },
  { id: 'do', block_type: 'document_action', key: 'lettera', label: 'Lettera', subject: 'Pratica {{titolo}}', body: 'Gentile {{persona.nome}}, importo {{importo}}', recipient: 'persona.email' },
]);

(async () => {
  const collaudo = require('./lib/collaudo-tenant');
  const prima = { persone: db.prepare('SELECT COUNT(*) n FROM records').get().n };
  let r;
  await test('il collaudo gira in una copia e restituisce un rapporto', async () => {
    r = await collaudo.esegui({ stato: 'in_corso', avanzamento: [] });
    ok(r && r.controlli > 8, 'controlli: ' + (r && r.controlli));
  });
  await test('un tenant coerente supera il collaudo (flusso, requisito bloccante, automazione, documento)', () => {
    ok(r.problemi.length === 0, 'problemi: ' + JSON.stringify(r.problemi));
    ok(r.punteggio === 100, 'punteggio ' + r.punteggio);
    ok(r.categorie.flusso && r.categorie.documenti && r.categorie.automazioni, 'categorie: ' + Object.keys(r.categorie));
  });
  await test('si vede cosa ha prodotto l\'automazione', () => {
    ok(r.effetti_automazioni.some((e) => e.modulo === 'pratiche' && e.in === 'compensi' && e.prodotti >= 1), JSON.stringify(r.effetti_automazioni));
  });
  await test('il database vero non è stato toccato', () => {
    ok(db.prepare('SELECT COUNT(*) n FROM records').get().n === prima.persone, 'sono comparsi record nel database vero');
    ok(!db.prepare("SELECT 1 FROM users WHERE username = 'collaudo'").get(), 'utente di collaudo nel database vero');
  });
  // un difetto vero: l'automazione scrive in un campo che non c'è, e uno stato non si raggiunge
  mod('rotto', [F('nome'), S('a', true), S('b'), { ...T('a', 'b'), roles: ['ruolo_che_non_esiste'] }]);
  await test('un passaggio che nessuno può eseguire viene segnalato', async () => {
    const r2 = await collaudo.esegui({ stato: 'in_corso', avanzamento: [] });
    ok(r2.problemi.some((p) => p.modulo === 'rotto'), 'nessuna segnalazione per «rotto»: ' + JSON.stringify(r2.problemi));
    ok(r2.punteggio < 100, 'punteggio ' + r2.punteggio);
  });
  console.log(`\n${passati} passati, ${falliti} falliti`); process.exit(falliti ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
