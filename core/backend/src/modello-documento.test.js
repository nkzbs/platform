'use strict';

// Test — motore del «documento da modello» (lib/modello-documento.js) e parità con i testi che
// stavano nel codice (lib/doc-cliente.js, lib/doc-immobile.js, cancellati) prima del blocco `document_action`:
// la parità si verifica contro fixtures/documenti-parita.json, il loro output congelato.
// Eseguire con: node modello-documento.test.js

const { renderModello, costruisciGet, risolviDestinatario, percorsiUsati, SEGNAPOSTI_FISSI, LINEA } = require('./lib/modello-documento');
const fixture = require('./fixtures/documenti-parita.json');
const seed = require('../../../super-admin/backend/src/pacchetti/mediazione-immobiliare/documenti.json');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.error('  ✗ ' + name); console.error('    ' + e.message); failed++; }
}
function assertEq(actual, expected, msg) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${msg || ''}: atteso ${b}, ottenuto ${a}`);
}
function assertTrue(c, msg) { if (!c) throw new Error(msg || 'atteso true'); }
const getDa = (obj) => (p) => obj[p];

console.log('\n--- segnaposto e filtri ---');

test('{{campo}} sostituisce il valore; se vuoto o assente mostra «—»', () => {
  assertEq(renderModello('A: {{x}}', getDa({ x: 'ciao' })), 'A: ciao');
  assertEq(renderModello('A: {{x}}', getDa({ x: '' })), 'A: —');
  assertEq(renderModello('A: {{x}}', getDa({})), 'A: —');
  assertEq(renderModello('A: {{x}}', getDa({ x: null })), 'A: —');
});
test('i booleani diventano Sì/No (false NON è «vuoto»), 0 resta 0', () => {
  assertEq(renderModello('{{a}} {{b}} {{c}}', getDa({ a: true, b: false, c: 0 })), 'Sì No 0');
});
test('le liste si uniscono con la virgola', () => {
  assertEq(renderModello('{{x}}', getDa({ x: ['a', 'b'] })), 'a, b');
});
test('|linea e |vuoto cambiano cosa compare se il campo è vuoto', () => {
  assertEq(renderModello('{{x|linea}}', getDa({})), LINEA);
  assertEq(renderModello('[{{x|vuoto}}]', getDa({})), '[]');
  assertEq(renderModello('{{x|linea}}', getDa({ x: 'v' })), 'v');
});
test('|minuscolo e |maiuscolo, anche concatenati con |vuoto', () => {
  assertEq(renderModello('{{x|minuscolo}} {{x|maiuscolo}}', getDa({ x: 'Ab' })), 'ab AB');
  assertEq(renderModello('{{x|vuoto|minuscolo}}', getDa({})), '');
});
test('un filtro sconosciuto è ignorato, non rompe il documento', () => {
  assertEq(renderModello('{{x|inventato}}', getDa({ x: 'ok' })), 'ok');
});
test('spazi dentro le graffe sono tollerati', () => {
  assertEq(renderModello('{{ x }} {{ x | maiuscolo }}', getDa({ x: 'a' })), 'a A');
});
test('testo senza segnaposto resta identico, anche con graffe singole e caratteri speciali', () => {
  assertEq(renderModello('Firma: ___ ☐ No {x} $ & <b>', getDa({})), 'Firma: ___ ☐ No {x} $ & <b>');
});
test('modello null/undefined → stringa vuota', () => {
  assertEq(renderModello(null, getDa({})), '');
});

console.log('\n--- sezioni ---');

test('{{#k}}…{{/k}} compare solo se k ha un valore', () => {
  assertEq(renderModello('a{{#k}} [{{k}}]{{/k}}b', getDa({ k: 'v' })), 'a [v]b');
  assertEq(renderModello('a{{#k}} [{{k}}]{{/k}}b', getDa({})), 'ab');
});
test('{{^k}}…{{/k}} compare solo se k è vuoto', () => {
  assertEq(renderModello('{{^k}}niente{{/k}}', getDa({})), 'niente');
  assertEq(renderModello('{{^k}}niente{{/k}}', getDa({ k: 'v' })), '');
});
test('una casella non spuntata (false) conta come vuota nelle sezioni', () => {
  assertEq(renderModello('{{#c}}sì{{/c}}{{^c}}no{{/c}}', getDa({ c: false })), 'no');
  assertEq(renderModello('{{#c}}sì{{/c}}{{^c}}no{{/c}}', getDa({ c: true })), 'sì');
});
test('sezioni con nomi diversi si annidano', () => {
  assertEq(renderModello('{{#a}}A{{#b}}B{{/b}}{{/a}}', getDa({ a: 1, b: 1 })), 'AB');
  assertEq(renderModello('{{#a}}A{{#b}}B{{/b}}{{/a}}', getDa({ a: 1 })), 'A');
  assertEq(renderModello('{{#a}}A{{#b}}B{{/b}}{{/a}}', getDa({ b: 1 })), '');
});
test('una sezione non chiusa non manda in loop e resta com\'è', () => {
  assertEq(renderModello('{{#a}}senza fine', getDa({ a: 1 })), '{{#a}}senza fine');
});

console.log('\n--- contesto: tenant, data, record collegati ---');

const tenant = { ragione_sociale: 'Agenzia Prova', indirizzo: 'Via Roma 1', piva: '01234567890' };
const leggi = (modulo, id) => (modulo === 'clienti' && id === 7 ? { nome: 'Anna Rossi', email: 'anna@esempio.it' } : null);
const schemaImm = { relations: [{ key: 'proprietario', target_module: 'clienti' }] };

test('@azienda/@indirizzo/@piva dal tenant; @oggi in italiano', () => {
  const get = costruisciGet({ record: {}, schema: {}, tenant, leggiRecord: leggi });
  assertEq(renderModello('{{@azienda}}|{{@indirizzo}}|{{@piva}}', get), 'Agenzia Prova|Via Roma 1|01234567890');
  assertEq(/^\d{1,2} [a-zà]+ \d{4}$/.test(renderModello('{{@oggi}}', get)), true);
});
test('senza tenant i dati del tenant sono vuoti, non un errore', () => {
  const get = costruisciGet({ record: {}, schema: {}, tenant: null, leggiRecord: leggi });
  assertEq(renderModello('[{{@azienda|vuoto}}]', get), '[]');
});
test('relazione.campo legge il campo del record collegato', () => {
  const get = costruisciGet({ record: { proprietario: 7 }, schema: schemaImm, tenant, leggiRecord: leggi });
  assertEq(renderModello('{{proprietario.nome}}', get), 'Anna Rossi');
});
test('relazione vuota, id inesistente o relazione non dichiarata → «—», mai un errore', () => {
  assertEq(renderModello('{{proprietario.nome}}', costruisciGet({ record: {}, schema: schemaImm, tenant, leggiRecord: leggi })), '—');
  assertEq(renderModello('{{proprietario.nome}}', costruisciGet({ record: { proprietario: 99 }, schema: schemaImm, tenant, leggiRecord: leggi })), '—');
  assertEq(renderModello('{{altra.nome}}', costruisciGet({ record: { altra: 7 }, schema: schemaImm, tenant, leggiRecord: leggi })), '—');
});
test('il record collegato si legge una volta sola per documento', () => {
  let letture = 0;
  const get = costruisciGet({ record: { proprietario: 7 }, schema: schemaImm, tenant, leggiRecord: (m, i) => { letture++; return leggi(m, i); } });
  renderModello('{{proprietario.nome}} {{proprietario.email}} {{proprietario.nome}}', get);
  assertEq(letture, 1);
});
test('risolviDestinatario: campo proprio, campo di un record collegato, vuoto se manca', () => {
  const get = costruisciGet({ record: { email: ' a@b.it ', proprietario: 7 }, schema: schemaImm, tenant, leggiRecord: leggi });
  assertEq(risolviDestinatario('email', get), 'a@b.it');
  assertEq(risolviDestinatario('proprietario.email', get), 'anna@esempio.it');
  assertEq(risolviDestinatario('', get), '');
  assertEq(risolviDestinatario('assente', get), '');
});
test('il modello non esegue codice né legge proprietà ereditate: espressioni e «constructor» danno «—»', () => {
  const get = costruisciGet({ record: { nome: 'x' }, schema: schemaImm, tenant, leggiRecord: leggi });
  assertEq(renderModello('{{process.exit(1)}} {{constructor}} {{__proto__}} {{toString}} {{hasOwnProperty}}', get), '— — — — —');
  const collegato = costruisciGet({ record: { proprietario: 7 }, schema: schemaImm, tenant, leggiRecord: leggi });
  assertEq(renderModello('{{proprietario.constructor}} {{proprietario.__proto__}}', collegato), '— —');
});

console.log('\n--- percorsiUsati (per la validazione del Builder) ---');

test('elenca campi, relazione.campo, @tenant, anche dentro sezioni e con filtri; senza doppioni', () => {
  const t = 'A {{nome}} {{ nome | maiuscolo }} {{#tipo}}{{tipo|minuscolo}}{{/tipo}}{{^note}}x{{/note}} {{proprietario.email}} {{@azienda}} {{@oggi}}';
  assertEq(percorsiUsati(t).sort(), ['@azienda', '@oggi', 'nome', 'note', 'proprietario.email', 'tipo'].sort());
});
test('modello vuoto o senza segnaposto → nessun percorso; le chiusure {{/k}} non contano', () => {
  assertEq(percorsiUsati(''), []);
  assertEq(percorsiUsati('solo testo {{#a}}x{{/a}}'), ['a']);
});
test('SEGNAPOSTI_FISSI contiene i quattro segnaposto che non sono campi', () => {
  assertEq(SEGNAPOSTI_FISSI.sort(), ['@azienda', '@indirizzo', '@oggi', '@piva']);
});
test('i modelli del seed citano solo campi, relazioni e segnaposto noti', () => {
  const tutti = Object.values(seed).filter(Array.isArray).flat();
  for (const a of tutti) {
    for (const p of [...percorsiUsati(a.body), ...percorsiUsati(a.subject)]) {
      const ok = SEGNAPOSTI_FISSI.includes(p) || /^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$/.test(p);
      if (!ok) throw new Error(a.key + ': segnaposto sospetto «' + p + '»');
    }
  }
});

console.log('\n--- parità con i testi che stavano nel codice (stesso output al carattere) ---');

const getCliente = (c, t) => costruisciGet({ record: c, schema: {}, tenant: t, leggiRecord: leggi });
const azione = (mod, key) => seed[mod].find((a) => a.key === key);
const oggiIt = new Date().toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
const senzaData = (t) => t.split(oggiIt).join('<OGGI>');

// La mail «Scheda immobile» è stata tolta dal pacchetto (0.5.60): i suoi casi congelati restano nella fixture ma non si confrontano più.
const casi = fixture.casi.filter((c) => c.documento !== 'scheda_immobile');
for (const caso of casi) {
  test(`${caso.id}: documento identico al testo originale`, () => {
    const a = azione('clienti', caso.documento);
    const get = caso.immobile
      ? costruisciGet({ record: caso.immobile, schema: schemaImm, tenant: caso.tenant, leggiRecord: leggi })
      : getCliente(caso.cliente, caso.tenant);
    assertEq(senzaData(renderModello(a.body, get)), caso.corpo, 'corpo');
    assertEq(senzaData(renderModello(a.subject, get)), caso.oggetto, 'oggetto');
  });
}
test('la fixture copre i due documenti rimasti (antiriciclaggio e privacy) con almeno 24 casi', () => {
  assertEq([...new Set(casi.map((c) => c.documento))].sort(), ['antiriciclaggio', 'privacy_incarico']);
  assertTrue(casi.length >= 24, 'casi: ' + casi.length);
});

test('destinatari del seed: email del cliente', () => {
  assertEq(azione('clienti', 'privacy_incarico').recipient, 'email');
});

test('le date del sistema (AAAA-MM-GG) si scrivono all\'italiana; il resto non cambia', () => {
  assertEq(renderModello('{{d}} | {{t}}', getDa({ d: '1985-12-10', t: '2026-1-5 note' })), '10/12/1985 | 2026-1-5 note');
});

console.log(`\n${'─'.repeat(50)}`);
console.log(`Risultato: ${passed} passati, ${failed} falliti`);
if (failed > 0) process.exit(1);
