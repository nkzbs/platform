'use strict';
// Il report «Ricorrenze» (reports.js): compleanni e altre date annuali dei moduli dichiarati «anagrafica». Nessun server: DB temporaneo.
// Eseguire con: node src/ricorrenze.test.js
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
process.env.DB_PATH = path.join(os.tmpdir(), 'ricorrenze-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.JWT_SECRET = 'ric_secret_' + crypto.randomBytes(8).toString('hex');
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ric-uploads-'));

let passed = 0, failed = 0;
function test(name, fn) { try { fn(); console.log('  ✓ ' + name); passed++; } catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; } }
const eq = (a, e, m) => { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${m || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m || 'atteso true'); };

const db = require('./db'); const rep = require('./reports'); const roles = require('./module-roles');
db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES ('Persone', 'persone', 'user', '#000', 1, 1, 70, ?)").run(JSON.stringify({ version: 3, steps: [] }));
const put = (d) => db.prepare("INSERT INTO records (module_slug, user_id, data) VALUES ('persone', NULL, ?)").run(JSON.stringify(d));
const NOW = new Date('2026-11-10T09:30:00+01:00'); // lunedì 10 novembre 2026, a Roma

test('prossimaRicorrenza: oggi conta, il passato slitta all\'anno dopo, il 29 febbraio diventa 28 negli anni non bisestili', () => {
  eq(rep.prossimaRicorrenza('1980-11-10', '2026-11-10'), '2026-11-10');
  eq(rep.prossimaRicorrenza('1980-11-09', '2026-11-10'), '2027-11-09');
  eq(rep.prossimaRicorrenza('2000-02-29', '2026-11-10'), '2027-02-28');
  eq(rep.prossimaRicorrenza('2000-02-29', '2027-11-10'), '2028-02-29');
  eq(rep.prossimaRicorrenza('1980-01-03', '2026-12-30'), '2027-01-03', 'a cavallo d\'anno');
});
test('senza moduli dichiarati «anagrafica» non c\'è niente da dire', () => {
  put({ nome: 'Mario Rossi', nascita: '1981-11-12' });
  const id = rep.addDefinition('ricorrenze', 'Compleanni').id;
  eq(rep.build(id, NOW), null);
});
test('con il modulo dichiarato elenca le ricorrenze entro i giorni scelti, con età, ordinate, salta le lontane e le date non valide, e senza età se l\'anno non è credibile', () => {
  roles.set('persone', { kind: 'anagrafica', uses: [], roles: { descrizione: 'nome', data_ricorrenza: 'nascita' } });
  put({ nome: 'Anna Verdi', nascita: '1990-11-10' }); put({ nome: 'Luca Neri', nascita: '1975-11-11' }); put({ nome: 'Lontano', nascita: '1970-12-25' });
  put({ nome: 'Senza data' }); put({ nome: 'Data rotta', nascita: 'boh' }); put({ nome: 'Anno incerto', nascita: '0001-11-14' }); // l'anno non è credibile: si ricorda la data, senza età
  const id = rep.settings().definizioni.find((d) => d.tipo === 'ricorrenze').id;
  const t = rep.build(id, NOW).text;
  ok(/4 ricorrenze/.test(t), t);
  ok(t.indexOf('Anna Verdi') < t.indexOf('Luca Neri') && t.indexOf('Luca Neri') < t.indexOf('Mario Rossi'), t);
  ok(/oggi\*\s{2}Anna Verdi — 36 anni/.test(t) && /domani\*\s{2}Luca Neri — 51 anni/.test(t) && /Mario Rossi — 45 anni/.test(t), t);
  ok(/14\/11\*\s{2}Anno incerto$/m.test(t) && !/Lontano|Senza data|Data rotta/.test(t), t);
});
test('i giorni di anticipo si scelgono (1–60) e cambiano ciò che entra', () => {
  const id = rep.settings().definizioni.find((d) => d.tipo === 'ricorrenze').id;
  ok(rep.saveSettings(id, { giorni_prima: 0 }).error); ok(rep.saveSettings(id, { giorni_prima: 61 }).error);
  ok(!rep.saveSettings(id, { giorni_prima: 1 }).error);
  const t = rep.build(id, NOW).text; ok(/2 ricorrenze/.test(t) && !/Mario Rossi|Anno incerto/.test(t), t);
  ok(rep.saveSettings(id, { giorni_prima: 20 }).settings.definizioni.find((d) => d.id === id).giorni_prima === 20);
});
test('nasce spento e settimanale; «giorni_prima» non si accetta su un tipo che non lo prevede', () => {
  const id = rep.addDefinition('ricorrenze').id; const d = rep.definizione(id);
  eq([d.enabled, d.freq, d.giorni_prima], [false, 'settimanale', 7]);
  const altro = rep.addDefinition('coda').id; rep.saveSettings(altro, { giorni_prima: 5 });
  eq('giorni_prima' in rep.definizione(altro), false);
});
test('il seed dichiara Clienti come anagrafica solo se ha i campi citati, una volta sola, senza sovrascrivere', () => {
  const { dichiaraRuoli } = require('./seed-blocchi-verticale');
  const F = (key) => ({ id: 'f_' + key, block_type: 'field', key, label: key, type: 'text' });
  const add = (slug, keys) => db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES (?, ?, 'user', '#000', 1, 1, 71, ?)").run(slug, slug, JSON.stringify({ version: 3, steps: keys.map(F) }));
  const seed = { _descrizione: 'x', clienti: { kind: 'anagrafica', uses: [], roles: { descrizione: 'nome', data_ricorrenza: 'data_nascita' } } };
  eq(dichiaraRuoli(seed), [], 'senza il modulo non fa nulla');
  add('clienti', ['nome']); eq(dichiaraRuoli(seed), [], 'mancano i campi citati: non dichiara');
  db.prepare("UPDATE modules SET schema_json = ? WHERE slug = 'clienti'").run(JSON.stringify({ version: 3, steps: ['nome', 'data_nascita'].map(F) }));
  eq(dichiaraRuoli(seed).map((e) => e.slug), ['clienti']); eq(roles.get('clienti').kind, 'anagrafica'); eq(roles.get('clienti').roles.data_ricorrenza, 'data_nascita');
  eq(dichiaraRuoli(seed), [], 'una volta sola');
  roles.set('clienti', { kind: 'pratica', uses: [], roles: { descrizione: 'nome' } }); db.prepare("DELETE FROM seed_applicati WHERE chiave = 'ruoli:clienti'").run();
  eq(dichiaraRuoli(seed), []); eq(roles.get('clienti').kind, 'pratica', 'già dichiarato: non si tocca');
  const reale = require('./seeds/ruoli-immobiliare.json'); eq(reale.clienti.kind, 'anagrafica');
});

console.log(`\n${passed} passati, ${failed} falliti`);
try { fs.unlinkSync(process.env.DB_PATH); } catch (e) {}
process.exit(failed ? 1 : 0);
