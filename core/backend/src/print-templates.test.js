'use strict';

// Test — resolver dei documenti stampabili (token {{campo:X}}/{{azienda:X}}/{{oggi}}
// e loop {{#righe}}). print-templates.js richiede './db' direttamente (query scritte
// con l'interfaccia better-sqlite3, non dietro un parametro iniettabile) — invece di
// una vera istanza SQLite (il binding nativo locale non è compilato per la versione
// di Node di questa macchina, solo per quella dell'immagine Docker), si inietta un
// mock nella cache dei moduli PRIMA di richiedere print-templates.js, stesso spirito
// del makeMockDb già usato in formula-soglia.test.js ma esposto come './db' vero e
// proprio così ogni require('./db') a valle (anche transitivo) riceve lo stesso mock.
// Eseguire con: node print-templates.test.js

const path = require('path');
const Module = require('module');

const MODULES = {
  clienti: {
    fields: [{ key: 'ragione_sociale', label: 'Ragione Sociale', type: 'text' }],
    relations: [],
  },
  ordini: {
    fields: [{ key: 'numero', label: 'Numero', type: 'text' }],
    relations: [{ key: 'cliente', target_module: 'clienti', display_field: 'ragione_sociale', type: 'many_to_one' }],
  },
  ordini_righe: {
    fields: [{ key: 'quantita', label: 'Quantità', type: 'number' }, { key: 'prodotto_nome', label: 'Prodotto', type: 'text' }],
    relations: [{ key: 'ordine', target_module: 'ordini', type: 'many_to_one' }],
  },
};

const RECORDS = []; // { module_slug, id, data }
let nextId = 1;
function seedRecord(moduleSlug, data) {
  const id = nextId++;
  RECORDS.push({ module_slug: moduleSlug, id, data: JSON.stringify(data) });
  return id;
}

// Mock minimale di better-sqlite3: solo le 3 forme di query che print-templates.js
// emette davvero (get modulo per slug, get record per slug+id, all record per slug).
const mockDb = {
  prepare(sql) {
    if (sql.includes('FROM modules WHERE slug = ?')) {
      return { get: (slug) => (MODULES[slug] ? { schema_json: JSON.stringify(MODULES[slug]) } : undefined) };
    }
    if (sql.includes('FROM records WHERE module_slug = ? AND id = ?')) {
      return { get: (slug, id) => RECORDS.find((r) => r.module_slug === slug && r.id === id) };
    }
    if (sql.includes('FROM records WHERE module_slug = ?')) {
      return { all: (slug) => RECORDS.filter((r) => r.module_slug === slug) };
    }
    throw new Error('mockDb: query non gestita dal mock: ' + sql);
  },
};

// Inietta il mock al posto del vero './db' nella cache dei moduli — qualunque
// require('./db') successivo (diretto o transitivo, stesso path risolto) riceve
// questo oggetto invece di eseguire il vero db.js (che aprirebbe better-sqlite3).
const dbPath = require.resolve('./db');
require.cache[dbPath] = new Module(dbPath, null);
require.cache[dbPath].exports = mockDb;
require.cache[dbPath].loaded = true;

const { renderDocumentTemplate } = require('./print-templates');

let passed = 0, failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log('  ✓ ' + name);
    passed++;
  } catch (e) {
    console.error('  ✗ ' + name);
    console.error('    ' + e.message);
    failed++;
  }
}

function assertEq(actual, expected, msg) {
  if (actual !== expected) throw new Error(`${msg || ''}: atteso ${JSON.stringify(expected)}, ottenuto ${JSON.stringify(actual)}`);
}

function assertIncludes(actual, substring, msg) {
  if (!actual.includes(substring)) throw new Error(`${msg || ''}: atteso che contenesse "${substring}", ottenuto: ${actual}`);
}

// ─── FIXTURE ──────────────────────────────────────────────────────────────────

const clienteId = seedRecord('clienti', { ragione_sociale: 'Bar Centrale <script>' });
const ordineId = seedRecord('ordini', { numero: 'ORD-001', cliente: clienteId });
seedRecord('ordini_righe', { ordine: ordineId, quantita: 3, prodotto_nome: 'Arabica' });
seedRecord('ordini_righe', { ordine: ordineId, quantita: 5, prodotto_nome: 'Robusta' });

const ordiniSchema = MODULES.ordini;
const azienda = { ragione_sociale: 'TORREFAZIONE TEST SRL', indirizzo: 'Via Test 1', piva: '00000000000' };
const ordineRecord = { id: ordineId, data: { numero: 'ORD-001', cliente: clienteId } };

// ─── {{campo:X}} — campo semplice ─────────────────────────────────────────────

console.log('\n--- {{campo:X}} — campo semplice ---');

test('campo testuale semplice viene sostituito', () => {
  const html = renderDocumentTemplate({ contenuto_html: 'Ordine {{campo:numero}}' }, ordiniSchema, ordineRecord, azienda);
  assertEq(html, 'Ordine ORD-001');
});

test('campo mancante nel record -> stringa vuota, non "undefined"', () => {
  const html = renderDocumentTemplate({ contenuto_html: 'Note: {{campo:note_inesistenti}}' }, ordiniSchema, ordineRecord, azienda);
  assertEq(html, 'Note: ');
});

// ─── {{campo:X}} — relazione risolta al display_field ────────────────────────

console.log('\n--- {{campo:X}} su una relazione ---');

test('relazione many_to_one risolve al display_field del record collegato, non all\'id grezzo', () => {
  const html = renderDocumentTemplate({ contenuto_html: 'Cliente: {{campo:cliente}}' }, ordiniSchema, ordineRecord, azienda);
  assertIncludes(html, 'Bar Centrale');
  assertEq(html.includes(String(clienteId) + '<'), false, 'non deve mostrare l\'id grezzo davanti a un tag');
});

test('valore del display_field viene escapato (niente injection HTML dal dato)', () => {
  const html = renderDocumentTemplate({ contenuto_html: '{{campo:cliente}}' }, ordiniSchema, ordineRecord, azienda);
  assertEq(html.includes('<script>'), false, 'il tag script grezzo non deve comparire');
  assertIncludes(html, '&lt;script&gt;');
});

// ─── {{azienda:X}} e {{oggi}} ─────────────────────────────────────────────────

console.log('\n--- {{azienda:X}} / {{oggi}} ---');

test('token azienda:X sostituito dalle impostazioni tenant', () => {
  const html = renderDocumentTemplate({ contenuto_html: '{{azienda:ragione_sociale}} - P.IVA {{azienda:piva}}' }, ordiniSchema, ordineRecord, azienda);
  assertEq(html, 'TORREFAZIONE TEST SRL - P.IVA 00000000000');
});

test('token oggi sostituito con una data (non lasciato letterale)', () => {
  const html = renderDocumentTemplate({ contenuto_html: 'Stampato il {{oggi}}' }, ordiniSchema, ordineRecord, azienda);
  assertEq(html.includes('{{oggi}}'), false);
  assertIncludes(html, 'Stampato il ');
});

// ─── {{#righe modulo="X" campo="Y"}}...{{/righe}} ────────────────────────────

console.log('\n--- loop righe figlie ---');

test('itera tutte le righe figlie che puntano al record corrente', () => {
  const template = { contenuto_html: '{{#righe modulo="ordini_righe" campo="ordine"}}<li>{{campo:prodotto_nome}} x{{campo:quantita}}</li>{{/righe}}' };
  const html = renderDocumentTemplate(template, ordiniSchema, ordineRecord, azienda);
  assertIncludes(html, '<li>Arabica x3</li>');
  assertIncludes(html, '<li>Robusta x5</li>');
});

test('nessuna riga figlia -> blocco loop reso vuoto, non lascia i tag letterali', () => {
  const ordineSenzaRighe = seedRecord('ordini', { numero: 'ORD-002', cliente: clienteId });
  const template = { contenuto_html: 'RIGHE:[{{#righe modulo="ordini_righe" campo="ordine"}}{{campo:prodotto_nome}}{{/righe}}]' };
  const html = renderDocumentTemplate(template, ordiniSchema, { id: ordineSenzaRighe, data: { numero: 'ORD-002', cliente: clienteId } }, azienda);
  assertEq(html, 'RIGHE:[]');
});

test('il loop non tocca il testo fuori dal blocco', () => {
  const template = { contenuto_html: 'PRIMA {{#righe modulo="ordini_righe" campo="ordine"}}X{{/righe}} DOPO' };
  const html = renderDocumentTemplate(template, ordiniSchema, ordineRecord, azienda);
  assertEq(html.startsWith('PRIMA '), true);
  assertEq(html.endsWith(' DOPO'), true);
});

// ─── template vuoto/assente ───────────────────────────────────────────────────

console.log('\n--- edge case ---');

test('contenuto_html assente -> stringa vuota, non lancia', () => {
  const html = renderDocumentTemplate({}, ordiniSchema, ordineRecord, azienda);
  assertEq(html, '');
});

// ─── SOMMARIO ─────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
console.log(`Risultato: ${passed} passati, ${failed} falliti`);
if (failed > 0) {
  process.exit(1);
}
