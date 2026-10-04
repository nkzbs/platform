'use strict';

// Test — motore automazioni (azioni interne usate dalle 9 fasi di logica business:
// stock, fatturazione, pagamenti, provvigioni, ammortamenti, insoluti). Stesso
// approccio di print-templates.test.js: mock di './db' iniettato nella cache dei
// moduli (il binding nativo di better-sqlite3 locale non compila con questa
// versione di Node), qui più esteso perché runAzioni tocca più tabelle.
// Eseguire con: node automation-engine.test.js

const Module = require('module');

// ─── MOCK DB — piccolo store relazionale in memoria, un ramo per ognuna delle
// (poche, enumerabili) forme di query che automation-engine.js emette davvero. ───

let RECORDS = [];      // { id, module_slug, user_id, data (stringa JSON) }
let MODULES = {};      // slug -> schema (oggetto, non stringificato)
let DELTAS = [];       // { id, module_slug, record_id, campo, delta, source_module, source_record_id, stornato }
let LOGS = [];
let NOTIFICATIONS = [];
let nextRecordId = 1;
let nextDeltaId = 1;
let MOCK_CREDENTIALS = {}; // integration_id -> oggetto credenziali (per i test dry-run su invia_notifica/callRealAPI)

function resetStore() {
  RECORDS = []; MODULES = {}; DELTAS = []; LOGS = []; NOTIFICATIONS = [];
  nextRecordId = 1; nextDeltaId = 1; MOCK_CREDENTIALS = {};
}

function findRecord(slug, id) {
  return RECORDS.find((r) => r.module_slug === slug && r.id === Number(id));
}

function seedModule(slug, schema) { MODULES[slug] = schema; }
function seedRecord(slug, data, userId) {
  const id = nextRecordId++;
  RECORDS.push({ id, module_slug: slug, user_id: userId ?? null, data: JSON.stringify(data) });
  return id;
}
function getRecordData(slug, id) {
  const r = findRecord(slug, id);
  return r ? JSON.parse(r.data) : null;
}

const mockDb = {
  prepare(sql) {
    if (sql === 'SELECT schema_json FROM modules WHERE slug = ?') {
      return { get: (slug) => (MODULES[slug] ? { schema_json: JSON.stringify(MODULES[slug]) } : undefined) };
    }
    if (sql === 'SELECT slug, schema_json, schema_json_draft FROM modules WHERE installed = 1') {
      // Usata da formula.js per risolvere aggregazioni che scansionano tutti i moduli
      // installati (es. sum(modulo.campo) dentro un campo computed) — tutti i moduli
      // seedati nel test si considerano "installati".
      return { all: () => Object.entries(MODULES).map(([slug, schema]) => ({ slug, schema_json: JSON.stringify(schema), schema_json_draft: null })) };
    }
    if (sql === 'SELECT credentials FROM connections WHERE integration_id = ?') {
      return { get: (integrationId) => (MOCK_CREDENTIALS[integrationId] ? { credentials: JSON.stringify(MOCK_CREDENTIALS[integrationId]) } : undefined) };
    }
    if (sql === 'SELECT * FROM whatsapp_recipients ORDER BY id') {
      // I destinatari WhatsApp hanno una tabella propria (notification-settings.js); il test li
      // semina come prima con seedRecord e qui li restituisce nella forma della tabella.
      return { all: () => RECORDS.filter((r) => r.module_slug === 'whatsapp_destinatari').map((r) => { const d = JSON.parse(r.data); return { id: r.id, nome: d.nome, numero: d.numero, triggers: JSON.stringify(d.triggers || []), attivo: d.attivo === false ? 0 : 1 }; }) };
    }
    if (sql === 'INSERT INTO automation_deltas (module_slug, record_id, campo, delta, source_module, source_record_id) VALUES (?, ?, ?, ?, ?, ?)') {
      return {
        run: (module_slug, record_id, campo, delta, source_module, source_record_id) => {
          const id = nextDeltaId++;
          DELTAS.push({ id, module_slug, record_id: Number(record_id), campo, delta, source_module, source_record_id: Number(source_record_id), stornato: 0 });
          return { lastInsertRowid: id };
        },
      };
    }
    if (sql === 'SELECT * FROM automation_deltas WHERE source_module = ? AND source_record_id = ? AND stornato = 0') {
      return { all: (source_module, source_record_id) => DELTAS.filter((d) => d.source_module === source_module && d.source_record_id === Number(source_record_id) && d.stornato === 0) };
    }
    if (sql === 'UPDATE automation_deltas SET stornato = 1 WHERE id = ?') {
      return { run: (id) => { const d = DELTAS.find((x) => x.id === id); if (d) d.stornato = 1; } };
    }
    if (sql === 'INSERT INTO automation_logs (module_slug, automation_label, trigger_desc, action_desc, esito, record_id) VALUES (?, ?, ?, ?, ?, ?)') {
      return { run: (...args) => { LOGS.push(args); return { lastInsertRowid: LOGS.length }; } };
    }
    if (sql === 'UPDATE automation_logs SET esito = ? WHERE module_slug = ? AND record_id = ? ORDER BY created_at DESC LIMIT 1') {
      return { run: () => {} };
    }
    if (sql === 'INSERT INTO notifications (message, module_slug, record_id) VALUES (?, ?, ?)') {
      return { run: (message, module_slug, record_id) => { NOTIFICATIONS.push({ message, module_slug, record_id }); return { lastInsertRowid: NOTIFICATIONS.length }; } };
    }
    if (sql === 'INSERT INTO records (module_slug, user_id, data) VALUES (?, ?, ?)') {
      return {
        run: (module_slug, user_id, data) => {
          const id = nextRecordId++;
          RECORDS.push({ id, module_slug, user_id, data });
          return { lastInsertRowid: id };
        },
      };
    }
    if (sql === 'SELECT data FROM records WHERE module_slug = ? AND id = ?') {
      return { get: (slug, id) => findRecord(slug, id) };
    }
    if (sql === 'SELECT id, data FROM records WHERE module_slug = ? AND id != ?') {
      return { all: (slug, id) => RECORDS.filter((r) => r.module_slug === slug && r.id !== Number(id)) };
    }
    if (sql === 'SELECT data FROM records WHERE module_slug = ?') {
      return { all: (slug) => RECORDS.filter((r) => r.module_slug === slug) };
    }
    if (sql === 'SELECT id, data FROM records WHERE module_slug = ?') {
      return { all: (slug) => RECORDS.filter((r) => r.module_slug === slug) };
    }
    if (sql === 'SELECT data FROM records WHERE id = ?') {
      return { get: (id) => RECORDS.find((r) => r.id === Number(id)) };
    }
    if (sql === 'UPDATE records SET data = ? WHERE module_slug = ? AND id = ?') {
      return { run: (data, slug, id) => { const r = findRecord(slug, id); if (r) r.data = data; } };
    }
    if (sql === 'UPDATE records SET data = ? WHERE id = ?') {
      return { run: (data, id) => { const r = RECORDS.find((x) => x.id === Number(id)); if (r) r.data = data; } };
    }
    throw new Error('mockDb: query non gestita dal mock: ' + sql);
  },
};

const dbPath = require.resolve('./db');
require.cache[dbPath] = new Module(dbPath, null);
require.cache[dbPath].exports = mockDb;
require.cache[dbPath].loaded = true;

const { fireTrigger, runAzioni, compare } = require('./automation-engine');

// Spia su https/http — automation-engine.js richiede questi moduli built-in a livello
// di modulo (require('https')/require('http') tornano lo STESSO oggetto singleton dalla
// cache di Node, quindi patcharlo qui intercetta anche le chiamate fatte da lì dentro,
// incluso il require('https') inline usato da callRealAPI per Stripe). Serve a provare
// che il dry-run non manda MAI una richiesta di rete reale (WhatsApp via CallMeBot,
// Slack, Stripe, ecc.) — non basta "nessuna credenziale nel mock", perché alcuni test
// dry-run seedano credenziali finte apposta per verificare che il gate regga anche
// quando la chiamata reale ci sarebbe stata.
let httpCallCount = 0;
const https = require('https');
const http = require('http');
['request', 'get'].forEach((method) => {
  [https, http].forEach((mod) => {
    mod[method] = () => { httpCallCount++; throw new Error('rete reale chiamata in test (' + method + ')'); };
  });
});

let passed = 0, failed = 0;
function test(name, fn) {
  resetStore();
  try {
    fn();
    console.log('  ✓ ' + name);
    passed++;
  } catch (e) {
    console.error('  ✗ ' + name);
    console.error('    ' + (e.stack || e.message));
    failed++;
  }
}
function assertEq(actual, expected, msg) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${msg || ''}: atteso ${b}, ottenuto ${a}`);
}
function assertClose(actual, expected, msg, eps = 1e-6) {
  if (Math.abs(actual - expected) > eps) throw new Error(`${msg || ''}: atteso ${expected}, ottenuto ${actual}`);
}

const NOOP_SCHEMA = { fields: [], relations: [] };
const logged = { triggerDesc: 'test' };

// ─── compare() — il bug delle date confrontate come numeri ──────────────────

console.log('\n--- compare() ---');

test('due date ISO dello stesso anno NON sono uguali solo perché parseFloat le tronca allo stesso numero', () => {
  assertEq(compare('2026-01-31', '<', '2026-08-01'), true);
  assertEq(compare('2026-08-01', '<', '2026-01-31'), false);
});

test('numeri confrontati numericamente, non come stringhe', () => {
  assertEq(compare(9, '<', 10), true);   // come stringa "9" > "10"
  assertEq(compare('9', '<', '10'), true);
});

test('confronto letterale su valori non numerici/non data', () => {
  assertEq(compare('bozza', '==', 'bozza'), true);
  assertEq(compare('bozza', '!=', 'confermato'), true);
});

// ─── aggiorna_record ──────────────────────────────────────────────────────────

console.log('\n--- aggiorna_record ---');

test('decrement numerico sul record self, con log del delta', () => {
  seedModule('prodotti', NOOP_SCHEMA);
  const prodId = seedRecord('prodotti', { nome: 'Arabica', stock_attuale: 10 });
  const azioni = [{ target: '__interno__', azione: 'aggiorna_record', config: { modulo: 'prodotti', id_field: '__self__', campo: 'stock_attuale', operazione: 'decrement', valore: 3 } }];
  runAzioni(azioni, {}, 'ordini', 'Test', prodId, logged);
  assertEq(getRecordData('prodotti', prodId).stock_attuale, 7);
  assertEq(DELTAS.length, 1);
  assertEq(DELTAS[0].delta, -3);
});

test('id_field punta a un campo del record corrente (non self)', () => {
  seedModule('prodotti', NOOP_SCHEMA);
  const prodId = seedRecord('prodotti', { stock_attuale: 5 });
  const azioni = [{ target: '__interno__', azione: 'aggiorna_record', config: { modulo: 'prodotti', id_field: 'prodotto', campo: 'stock_attuale', operazione: 'increment', valore: 'quantita' } }];
  runAzioni(azioni, { prodotto: prodId, quantita: 4 }, 'ordini_righe', 'Test', 999, logged);
  assertEq(getRecordData('prodotti', prodId).stock_attuale, 9);
});

test('set con valore non numerico (es. _stato) assegna il valore così com\'è, non lo azzera', () => {
  seedModule('fatture', NOOP_SCHEMA);
  const fatId = seedRecord('fatture', { _stato: 'emessa' });
  const azioni = [{ target: '__interno__', azione: 'aggiorna_record', config: { modulo: 'fatture', id_field: '__self__', campo: '_stato', operazione: 'set', valore: 'pagata' } }];
  runAzioni(azioni, {}, 'fatture', 'Test', fatId, logged);
  assertEq(getRecordData('fatture', fatId)._stato, 'pagata');
});

test('set arrotonda a 3 decimali per valori numerici', () => {
  seedModule('conti', NOOP_SCHEMA);
  const id = seedRecord('conti', { saldo: 0 });
  const azioni = [{ target: '__interno__', azione: 'aggiorna_record', config: { modulo: 'conti', id_field: '__self__', campo: 'saldo', operazione: 'set', valore: 1.23456789 } }];
  runAzioni(azioni, {}, 'conti', 'Test', id, logged);
  assertClose(getRecordData('conti', id).saldo, 1.235);
});

test('valore "relazione:campo:modulo:campoSorgente" legge un campo di un record collegato', () => {
  seedModule('ordini', NOOP_SCHEMA);
  seedModule('pagamenti', NOOP_SCHEMA);
  const ordId = seedRecord('ordini', { agente: 'Mario' });
  const pagId = seedRecord('pagamenti', { ordine: ordId, agente_copiato: null });
  const azioni = [{ target: '__interno__', azione: 'aggiorna_record', config: { modulo: 'pagamenti', id_field: '__self__', campo: 'agente_copiato', operazione: 'set', valore: 'relazione:ordine:ordini:agente' } }];
  runAzioni(azioni, { ordine: ordId }, 'pagamenti', 'Test', pagId, logged);
  assertEq(getRecordData('pagamenti', pagId).agente_copiato, 'Mario');
});

test('id_field non valorizzato -> nessun effetto, nessun crash', () => {
  seedModule('prodotti', NOOP_SCHEMA);
  const azioni = [{ target: '__interno__', azione: 'aggiorna_record', config: { modulo: 'prodotti', id_field: 'prodotto', campo: 'stock', operazione: 'decrement', valore: 1 } }];
  runAzioni(azioni, {}, 'ordini_righe', 'Test', 1, logged);
  assertEq(RECORDS.length, 0);
});

// ─── aggiorna_figli ───────────────────────────────────────────────────────────

console.log('\n--- condizioni Se/Altrimenti ---');

test('ramo "then" eseguito quando la condizione è vera', () => {
  seedModule('prodotti', NOOP_SCHEMA);
  const id = seedRecord('prodotti', { stock: 10 });
  const azioni = [{
    kind: 'condition', a: 'campo:quantita', op: '>', b: { literal: 0 },
    then: [{ target: '__interno__', azione: 'aggiorna_record', config: { modulo: 'prodotti', id_field: '__self__', campo: 'stock', operazione: 'decrement', valore: 1 } }],
    otherwise: [],
  }];
  // 'a' è risolto con resolveOperand: stringa presente in recordData -> il suo valore
  runAzioni(azioni, { 'campo:quantita': 5 }, 'x', 'Test', id, logged);
  assertEq(getRecordData('prodotti', id).stock, 9);
});

test('ramo "otherwise" eseguito quando la condizione è falsa', () => {
  seedModule('prodotti', NOOP_SCHEMA);
  const id = seedRecord('prodotti', { stock: 10 });
  const azioni = [{
    kind: 'condition', a: 'qta', op: '>', b: { literal: 100 },
    then: [{ target: '__interno__', azione: 'aggiorna_record', config: { modulo: 'prodotti', id_field: '__self__', campo: 'stock', operazione: 'set', valore: 999 } }],
    otherwise: [{ target: '__interno__', azione: 'aggiorna_record', config: { modulo: 'prodotti', id_field: '__self__', campo: 'stock', operazione: 'set', valore: 1 } }],
  }];
  runAzioni(azioni, { qta: 5 }, 'x', 'Test', id, logged);
  assertEq(getRecordData('prodotti', id).stock, 1);
});

// ─── fireTrigger — matching di evento/stato/campo ────────────────────────────

console.log('\n--- fireTrigger ---');

test('cambio_stato con "stato" specificato scatta solo per quello stato esatto', () => {
  seedModule('ordini', {
    version: 3,
    steps: [{
      id: 'a1', block_type: 'automation', label: 'Decremento su conferma',
      trigger: { evento: 'cambio_stato', stato: 'confermato' },
      azioni: [{ target: '__interno__', azione: 'aggiorna_record', config: { modulo: 'prodotti', id_field: '__self__', campo: 'stock', operazione: 'decrement', valore: 1 } }],
    }],
  });
  seedModule('prodotti', NOOP_SCHEMA);
  const prodId = seedRecord('prodotti', { stock: 10 });
  fireTrigger('ordini', 'cambio_stato', {}, prodId, { stato: 'annullato' }); // stato diverso -> non deve scattare
  assertEq(getRecordData('prodotti', prodId).stock, 10);
  fireTrigger('ordini', 'cambio_stato', {}, prodId, { stato: 'confermato' }); // stato giusto -> scatta
  assertEq(getRecordData('prodotti', prodId).stock, 9);
});

test('modifica_campo con "campo" specificato scatta solo per quel campo esatto', () => {
  seedModule('fatture', {
    version: 3,
    steps: [{
      id: 'a1', block_type: 'automation', label: 'Su pagato',
      trigger: { evento: 'modifica_campo', campo: 'pagato' },
      azioni: [{ target: '__interno__', azione: 'aggiorna_record', config: { modulo: 'contatori', id_field: '__self__', campo: 'n', operazione: 'increment', valore: 1 } }],
    }],
  });
  seedModule('contatori', NOOP_SCHEMA);
  const contId = seedRecord('contatori', { n: 0 });
  fireTrigger('fatture', 'modifica_campo', {}, contId, { campo: 'note' }); // campo diverso -> non scatta
  assertEq(getRecordData('contatori', contId).n, 0);
  fireTrigger('fatture', 'modifica_campo', {}, contId, { campo: 'pagato' }); // campo giusto -> scatta
  assertEq(getRecordData('contatori', contId).n, 1);
});

test('modulo senza schema pubblicato -> nessun errore, nessuna azione', () => {
  fireTrigger('modulo_inesistente', 'nuovo_record', {}, 1, {});
  assertEq(RECORDS.length, 0);
});

// ─── DRY-RUN — anteprima automazioni dal Builder, nessuna scrittura reale ──────
// Un test per ciascuno dei 15 tipi di azione: chiama runAzioni con {dryRun:true,
// dryLog:[]} e verifica che RECORDS/NOTIFICATIONS/DELTAS/LOGS restino ESATTAMENTE
// come prima (snapshot testuale, non un controllo per tipo di azione — se un
// qualunque punto di scrittura non fosse gated, questo lo scoprirebbe), più che
// dryLog riporti almeno una voce descrittiva. La spia su https/http (sopra) fa
// fallire il test con un errore esplicito se una qualunque azione dovesse chiamare
// la rete per davvero durante l'anteprima.

console.log('\n--- dry-run: nessuna scrittura reale per nessun tipo di azione ---');

function snapshotStore() {
  return JSON.stringify({ RECORDS, NOTIFICATIONS, DELTAS, LOGS });
}
function assertNoMutation(fn) {
  const before = snapshotStore();
  const dryLog = [];
  fn(dryLog);
  const after = snapshotStore();
  if (before !== after) throw new Error('dry-run ha scritto per davvero — before: ' + before + ' | after: ' + after);
  if (dryLog.length === 0) throw new Error('dry-run non ha prodotto nessuna voce di anteprima');
  return dryLog;
}

test('dry-run: notifica_interna non crea la notifica né il log', () => {
  assertNoMutation((dryLog) => {
    runAzioni([{ target: '__interno__', azione: 'notifica_interna', config: { message: 'Ciao {{nome}}' } }],
      { nome: 'Mario' }, 'clienti', 'Test', 1, logged, { dryRun: true, dryLog });
  });
});

test('dry-run: invia_notifica senza credenziali non scrive il log', () => {
  assertNoMutation((dryLog) => {
    runAzioni([{ target: '__interno__', azione: 'invia_notifica', config: { trigger_tag: 'test', messaggio: 'Ciao' } }],
      {}, 'clienti', 'Test', 1, logged, { dryRun: true, dryLog });
  });
});

test('dry-run: invia_notifica CON credenziali e destinatari reali non chiama CallMeBot né scrive', () => {
  MOCK_CREDENTIALS.whatsapp_callmebot = { api_key: 'FAKE' };
  seedModule('whatsapp_destinatari', NOOP_SCHEMA);
  seedRecord('whatsapp_destinatari', { nome: 'Nico', numero: '+391234567890', attivo: true, triggers: ['test'] });
  assertNoMutation((dryLog) => {
    runAzioni([{ target: '__interno__', azione: 'invia_notifica', config: { trigger_tag: 'test', messaggio: 'Ciao' } }],
      {}, 'clienti', 'Test', 1, logged, { dryRun: true, dryLog });
  });
  assertEq(httpCallCount, 0, 'nessuna chiamata di rete reale attesa');
});

test('dry-run: invia_report_periodico (nessuna voce nel periodo) non scrive', () => {
  seedModule('spese', NOOP_SCHEMA);
  assertNoMutation((dryLog) => {
    runAzioni([{ target: '__interno__', azione: 'invia_report_periodico', config: { trigger_tag: 'test' } }],
      {}, 'spese', 'Test', null, logged, { dryRun: true, dryLog });
  });
});

test('dry-run: invia_report_periodico CON voci e credenziali non chiama CallMeBot né scrive', () => {
  MOCK_CREDENTIALS.whatsapp_callmebot = { api_key: 'FAKE' };
  seedModule('spese', NOOP_SCHEMA);
  seedModule('whatsapp_destinatari', NOOP_SCHEMA);
  seedRecord('whatsapp_destinatari', { nome: 'Nico', numero: '+391234567890', attivo: true, triggers: ['test'] });
  seedRecord('spese', { importo: 50, data: new Date().toISOString().slice(0, 10) });
  assertNoMutation((dryLog) => {
    runAzioni([{ target: '__interno__', azione: 'invia_report_periodico', config: { trigger_tag: 'test' } }],
      {}, 'spese', 'Test', null, logged, { dryRun: true, dryLog });
  });
  assertEq(httpCallCount, 0, 'nessuna chiamata di rete reale attesa');
});

test('dry-run: aggiorna_record non tocca il record target', () => {
  seedModule('fatture', NOOP_SCHEMA);
  const fatId = seedRecord('fatture', { _stato: 'bozza' });
  assertNoMutation((dryLog) => {
    runAzioni([{ target: '__interno__', azione: 'aggiorna_record', config: { modulo: 'fatture', id_field: '__self__', campo: '_stato', operazione: 'set', valore: 'pagata' } }],
      {}, 'fatture', 'Test', fatId, logged, { dryRun: true, dryLog });
  });
  assertEq(getRecordData('fatture', fatId)._stato, 'bozza', 'il record non deve essere cambiato in anteprima');
});

test('dry-run: crea_record non crea il record', () => {
  seedModule('log_attivita', NOOP_SCHEMA);
  assertNoMutation((dryLog) => {
    runAzioni([{ target: '__interno__', azione: 'crea_record', config: { modulo: 'log_attivita', dati: { evento: 'test' } } }],
      {}, 'ordini', 'Test', 1, logged, { dryRun: true, dryLog });
  });
  assertEq(RECORDS.filter((r) => r.module_slug === 'log_attivita').length, 0);
});

test('dry-run: crea_record_n_volte non crea nessuno degli N record', () => {
  seedModule('rate', NOOP_SCHEMA);
  assertNoMutation((dryLog) => {
    runAzioni([{ target: '__interno__', azione: 'crea_record_n_volte', config: { modulo: 'rate', n: 5, dati: { numero: 'campo:_indice' } } }],
      {}, 'piani', 'Test', 1, logged, { dryRun: true, dryLog });
  });
  assertEq(RECORDS.filter((r) => r.module_slug === 'rate').length, 0);
});

test('dry-run: azione su target esterno (Slack) con credenziali non chiama l\'API reale né scrive', () => {
  MOCK_CREDENTIALS.slack = { webhook_url: 'https://hooks.slack.com/fake' };
  assertNoMutation((dryLog) => {
    runAzioni([{ target: 'slack', azione: 'Notifica canale', config: 'Nuovo ordine {{numero}}' }],
      { numero: '2026/001' }, 'ordini', 'Test', 1, logged, { dryRun: true, dryLog });
  });
  assertEq(httpCallCount, 0, 'nessuna chiamata di rete reale attesa verso Slack');
});

// ─── SOMMARIO ─────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
console.log(`Risultato: ${passed} passati, ${failed} falliti`);
if (failed > 0) {
  process.exit(1);
}
