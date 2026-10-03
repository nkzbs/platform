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

console.log('\n--- aggiorna_figli ---');

test('decrementa il target per ogni figlio collegato al record corrente', () => {
  seedModule('prodotti', NOOP_SCHEMA);
  seedModule('ordini_righe', NOOP_SCHEMA);
  const prod1 = seedRecord('prodotti', { stock_attuale: 10 });
  const prod2 = seedRecord('prodotti', { stock_attuale: 20 });
  const ordId = 500;
  seedRecord('ordini_righe', { ordine: ordId, prodotto: prod1, quantita: 3 });
  seedRecord('ordini_righe', { ordine: ordId, prodotto: prod2, quantita: 5 });
  const azioni = [{ target: '__interno__', azione: 'aggiorna_figli', config: { figlio_modulo: 'ordini_righe', via_relazione: 'ordine', rel_campo: 'prodotto', quantita_campo: 'quantita', target_modulo: 'prodotti', target_campo: 'stock_attuale', operazione: 'decrement' } }];
  runAzioni(azioni, {}, 'ordini', 'Conferma', ordId, logged);
  assertEq(getRecordData('prodotti', prod1).stock_attuale, 7);
  assertEq(getRecordData('prodotti', prod2).stock_attuale, 15);
});

// ─── trova_o_crea_e_aggiorna ──────────────────────────────────────────────────

console.log('\n--- trova_o_crea_e_aggiorna ---');

test('nessun record esistente che soddisfi match -> lo crea con il delta iniziale', () => {
  seedModule('giacenza_furgone', NOOP_SCHEMA);
  const azioni = [{ target: '__interno__', azione: 'trova_o_crea_e_aggiorna', config: { modulo: 'giacenza_furgone', match: { furgone: 'furgone', prodotto: 'prodotto' }, campo: 'kg', operazione: 'increment', valore: 'quantita' } }];
  runAzioni(azioni, { furgone: 7, prodotto: 12, quantita: 25 }, 'carichi_furgone', 'Test', 1, logged);
  assertEq(RECORDS.filter((r) => r.module_slug === 'giacenza_furgone').length, 1);
  const g = getRecordData('giacenza_furgone', RECORDS.find((r) => r.module_slug === 'giacenza_furgone').id);
  assertEq(g.furgone, 7); assertEq(g.prodotto, 12); assertEq(g.kg, 25);
});

test('record esistente che soddisfa match -> incrementa invece di duplicare', () => {
  seedModule('giacenza_furgone', NOOP_SCHEMA);
  seedRecord('giacenza_furgone', { furgone: 7, prodotto: 12, kg: 10 });
  const azioni = [{ target: '__interno__', azione: 'trova_o_crea_e_aggiorna', config: { modulo: 'giacenza_furgone', match: { furgone: 'furgone', prodotto: 'prodotto' }, campo: 'kg', operazione: 'increment', valore: 'quantita' } }];
  runAzioni(azioni, { furgone: 7, prodotto: 12, quantita: 5 }, 'carichi_furgone', 'Test', 1, logged);
  assertEq(RECORDS.filter((r) => r.module_slug === 'giacenza_furgone').length, 1, 'non deve duplicare');
  assertEq(getRecordData('giacenza_furgone', RECORDS.find((r) => r.module_slug === 'giacenza_furgone').id).kg, 15);
});

// ─── trova_relazione_inversa (dentro un match di trova_o_crea_e_aggiorna) ─────
// Scenario reale: da una riga ordine, mai collegata direttamente a un furgone,
// risalire "il furgone assegnato all'agente di questo ordine" — un salto che
// nessuna relazione diretta copre (ordini_righe -> ordine -> agente, poi
// SERVE il record furgoni il cui campo agente vale quell'id, l'opposto di
// leggere un campo di un record collegato).

console.log('\n--- trova_relazione_inversa ---');

test('trova_relazione_inversa composto con relazione: risolve furgone dall\'agente dell\'ordine, e scala la giacenza giusta', () => {
  seedModule('ordini', NOOP_SCHEMA);
  seedModule('furgoni', NOOP_SCHEMA);
  seedModule('giacenza_furgone', NOOP_SCHEMA);
  const ordine = seedRecord('ordini', { agente: 42 });
  const furgone = seedRecord('furgoni', { targa: 'XY123', agente: 42 });
  seedRecord('giacenza_furgone', { furgone, prodotto: 9, quantita: 20 });
  const azioni = [{
    target: '__interno__',
    azione: 'trova_o_crea_e_aggiorna',
    config: {
      modulo: 'giacenza_furgone',
      match: { furgone: 'trova_relazione_inversa:furgoni:agente:relazione:ordine:ordini:agente', prodotto: 'prodotto' },
      campo: 'quantita', operazione: 'decrement', valore: 'quantita',
    },
  }];
  runAzioni(azioni, { ordine, prodotto: 9, quantita: 3 }, 'ordini_righe', 'Test', 1, logged);
  assertEq(RECORDS.filter((r) => r.module_slug === 'giacenza_furgone').length, 1, 'non deve creare una riga duplicata/fantasma');
  assertEq(getRecordData('giacenza_furgone', RECORDS.find((r) => r.module_slug === 'giacenza_furgone').id).quantita, 17);
});

test('trova_relazione_inversa senza nessun furgone assegnato all\'agente -> azione saltata, nessun record fantasma', () => {
  seedModule('ordini', NOOP_SCHEMA);
  seedModule('furgoni', NOOP_SCHEMA);
  seedModule('giacenza_furgone', NOOP_SCHEMA);
  const ordine = seedRecord('ordini', { agente: 99 }); // nessun furgone ha agente:99
  const azioni = [{
    target: '__interno__',
    azione: 'trova_o_crea_e_aggiorna',
    config: {
      modulo: 'giacenza_furgone',
      match: { furgone: 'trova_relazione_inversa:furgoni:agente:relazione:ordine:ordini:agente', prodotto: 'prodotto' },
      campo: 'quantita', operazione: 'decrement', valore: 'quantita',
    },
  }];
  runAzioni(azioni, { ordine, prodotto: 9, quantita: 3 }, 'ordini_righe', 'Test', 1, logged);
  assertEq(RECORDS.filter((r) => r.module_slug === 'giacenza_furgone').length, 0, 'nessun record deve essere creato con furgone:null');
  assertEq(LOGS.some((l) => l[4] === 'saltato_match_incompleto'), true, 'deve restare traccia nel log del perché è stato saltato');
});

// ─── libera_altri_con_stesso_valore ───────────────────────────────────────────

console.log('\n--- libera_altri_con_stesso_valore ---');

test('assegnare un furgone a un agente libera gli ALTRI furgoni di quell\'agente', () => {
  seedModule('furgoni', NOOP_SCHEMA);
  const f1 = seedRecord('furgoni', { targa: 'AA', agente: 3 });
  const f2 = seedRecord('furgoni', { targa: 'BB', agente: 3 });
  const f3 = seedRecord('furgoni', { targa: 'CC', agente: 3 }); // questo è "il corrente"
  const azioni = [{ target: '__interno__', azione: 'libera_altri_con_stesso_valore', config: { modulo: 'furgoni', campo_confronto: 'agente', campo_da_liberare: 'agente' } }];
  runAzioni(azioni, { agente: 3 }, 'furgoni', 'Test', f3, logged);
  assertEq(getRecordData('furgoni', f1).agente, null);
  assertEq(getRecordData('furgoni', f2).agente, null);
  assertEq(getRecordData('furgoni', f3).agente, 3, 'il record corrente non tocca se stesso');
});

test('nessun altro record con lo stesso valore -> nessun effetto', () => {
  seedModule('furgoni', NOOP_SCHEMA);
  const f1 = seedRecord('furgoni', { agente: 3 });
  const azioni = [{ target: '__interno__', azione: 'libera_altri_con_stesso_valore', config: { modulo: 'furgoni', campo_confronto: 'agente', campo_da_liberare: 'agente' } }];
  runAzioni(azioni, { agente: 3 }, 'furgoni', 'Test', f1, logged);
  assertEq(getRecordData('furgoni', f1).agente, 3);
});

// ─── aggrega_in_record ────────────────────────────────────────────────────────

console.log('\n--- aggrega_in_record ---');

test('aggrega i record che soddisfano il filtro, crea la testata, marca i sorgenti', () => {
  seedModule('ordini_pagamenti', NOOP_SCHEMA);
  seedModule('distinte_versamento', NOOP_SCHEMA);
  const p1 = seedRecord('ordini_pagamenti', { agente: 5, importo: 100, distinta_id: null });
  const p2 = seedRecord('ordini_pagamenti', { agente: 5, importo: 50, distinta_id: null });
  seedRecord('ordini_pagamenti', { agente: 9, importo: 999, distinta_id: null }); // altro agente, escluso
  const azioni = [{
    target: '__interno__', azione: 'aggrega_in_record',
    config: {
      modulo_sorgente: 'ordini_pagamenti',
      filtro: [{ campo: 'agente', op: '==', valore: 'campo:agente' }, { campo: 'distinta_id', op: '==', valore: null }],
      modulo_destinazione: 'distinte_versamento',
      mappatura: { agente: 'campo:agente', totale: 'somma:importo', numero_pagamenti: 'conteggio' },
      campo_marcatura: 'distinta_id',
    },
  }];
  runAzioni(azioni, { agente: 5 }, 'richieste_versamento', 'Test', 1, logged);
  const distinte = RECORDS.filter((r) => r.module_slug === 'distinte_versamento');
  assertEq(distinte.length, 1);
  const d = JSON.parse(distinte[0].data);
  assertEq(d.totale, 150);
  assertEq(d.numero_pagamenti, 2);
  assertEq(getRecordData('ordini_pagamenti', p1).distinta_id, distinte[0].id);
  assertEq(getRecordData('ordini_pagamenti', p2).distinta_id, distinte[0].id);
});

test('nessun record che soddisfi il filtro -> nessuna testata creata', () => {
  seedModule('ordini_pagamenti', NOOP_SCHEMA);
  seedModule('distinte_versamento', NOOP_SCHEMA);
  const azioni = [{
    target: '__interno__', azione: 'aggrega_in_record',
    config: { modulo_sorgente: 'ordini_pagamenti', filtro: [{ campo: 'agente', op: '==', valore: 999 }], modulo_destinazione: 'distinte_versamento', mappatura: {} },
  }];
  runAzioni(azioni, {}, 'richieste_versamento', 'Test', 1, logged);
  assertEq(RECORDS.filter((r) => r.module_slug === 'distinte_versamento').length, 0);
});

test('somma:campo su un campo COMPUTED (non nella colonna grezza) viene ricalcolato, non ignorato come 0', () => {
  seedModule('ammortamenti_righe', {
    fields: [
      { key: 'costo', label: 'Costo', type: 'number' },
      { key: 'vita_utile_anni', label: 'Vita utile', type: 'number' },
      { key: 'quota_mensile', label: 'Quota mensile', type: 'computed', expr: 'costo / vita_utile_anni / 12' },
    ],
  });
  seedModule('ammortamenti_registrati', NOOP_SCHEMA);
  seedRecord('ammortamenti_righe', { costo: 1200, vita_utile_anni: 5, marcato: null });
  seedRecord('ammortamenti_righe', { costo: 2400, vita_utile_anni: 4, marcato: null });
  const azioni = [{
    target: '__interno__', azione: 'aggrega_in_record',
    config: { modulo_sorgente: 'ammortamenti_righe', filtro: [], modulo_destinazione: 'ammortamenti_registrati', mappatura: { totale_mensile: 'somma:quota_mensile' } },
  }];
  runAzioni(azioni, {}, 'scheduler', 'Test', 1, logged);
  const reg = RECORDS.find((r) => r.module_slug === 'ammortamenti_registrati');
  const d = JSON.parse(reg.data);
  // 1200/5/12 = 20, 2400/4/12 = 50 -> totale 70
  assertClose(d.totale_mensile, 70);
});

// ─── storna_riferimento ───────────────────────────────────────────────────────

console.log('\n--- storna_riferimento ---');

test('inverte tutti i delta registrati dal record corrente', () => {
  seedModule('cassa', NOOP_SCHEMA);
  seedModule('clienti', NOOP_SCHEMA);
  const cassaId = seedRecord('cassa', { saldo: 100 });
  const clienteId = seedRecord('clienti', { credito: 50 });
  // Simula due incrementi già applicati e loggati da un pagamento (record 42 in 'pagamenti')
  const pagamentoId = 42;
  DELTAS.push({ id: nextDeltaId++, module_slug: 'cassa', record_id: cassaId, campo: 'saldo', delta: 30, source_module: 'pagamenti', source_record_id: pagamentoId, stornato: 0 });
  DELTAS.push({ id: nextDeltaId++, module_slug: 'clienti', record_id: clienteId, campo: 'credito', delta: -30, source_module: 'pagamenti', source_record_id: pagamentoId, stornato: 0 });
  const azioni = [{ target: '__interno__', azione: 'storna_riferimento' }];
  runAzioni(azioni, {}, 'pagamenti', 'Storno', pagamentoId, logged);
  assertEq(getRecordData('cassa', cassaId).saldo, 70, 'incasso di 30 invertito');
  assertEq(getRecordData('clienti', clienteId).credito, 80, 'decremento di 30 invertito');
  assertEq(DELTAS.every((d) => d.stornato === 1), true);
});

test('storno ripetuto (delta già stornati) non applica di nuovo l\'inversione', () => {
  seedModule('cassa', NOOP_SCHEMA);
  const cassaId = seedRecord('cassa', { saldo: 100 });
  DELTAS.push({ id: nextDeltaId++, module_slug: 'cassa', record_id: cassaId, campo: 'saldo', delta: 30, source_module: 'pagamenti', source_record_id: 42, stornato: 1 });
  runAzioni([{ target: '__interno__', azione: 'storna_riferimento' }], {}, 'pagamenti', 'Storno', 42, logged);
  assertEq(getRecordData('cassa', cassaId).saldo, 100, 'nessun doppio storno');
});

// ─── crea_record_da_padre ─────────────────────────────────────────────────────

console.log('\n--- crea_record_da_padre ---');

test('clona il padre + tutte le righe figlie collegate, ricollegate al nuovo padre', () => {
  seedModule('ordini', NOOP_SCHEMA);
  seedModule('fatture', NOOP_SCHEMA);
  seedModule('ordini_righe', NOOP_SCHEMA);
  seedModule('fatture_righe', NOOP_SCHEMA);
  const ordId = seedRecord('ordini', { numero: 'ORD-1', cliente: 13 });
  seedRecord('ordini_righe', { ordine: ordId, prodotto: 1, quantita: 2 });
  seedRecord('ordini_righe', { ordine: ordId, prodotto: 2, quantita: 3 });
  const azioni = [{
    target: '__interno__', azione: 'crea_record_da_padre',
    config: {
      modulo_destinazione: 'fatture',
      mappatura_campi: { numero: 'campo:numero', cliente: 'campo:cliente' },
      figli: [{ modulo_sorgente_figli: 'ordini_righe', via_relazione: 'ordine', modulo_destinazione_figli: 'fatture_righe', mappatura_campi_figli: { prodotto: 'campo:prodotto', quantita: 'campo:quantita' }, relazione_nuovo_padre: 'fattura' }],
    },
  }];
  runAzioni(azioni, { numero: 'ORD-1', cliente: 13 }, 'ordini', 'Genera fattura', ordId, logged);
  const fatture = RECORDS.filter((r) => r.module_slug === 'fatture');
  assertEq(fatture.length, 1);
  const fatturaId = fatture[0].id;
  assertEq(JSON.parse(fatture[0].data).cliente, 13);
  const righeFattura = RECORDS.filter((r) => r.module_slug === 'fatture_righe');
  assertEq(righeFattura.length, 2);
  righeFattura.forEach((r) => assertEq(JSON.parse(r.data).fattura, fatturaId));
});

test('senza modulo_destinazione: clona solo le righe, senza creare una testata', () => {
  seedModule('ordini_acquisto_righe', NOOP_SCHEMA);
  seedModule('lotti', NOOP_SCHEMA);
  const oaId = 700;
  seedRecord('ordini_acquisto_righe', { ordine_acquisto: oaId, kg: 50 });
  const azioni = [{
    target: '__interno__', azione: 'crea_record_da_padre',
    config: { figli: [{ modulo_sorgente_figli: 'ordini_acquisto_righe', via_relazione: 'ordine_acquisto', modulo_destinazione_figli: 'lotti', mappatura_campi_figli: { kg_ricevuti: 'campo:kg' } }] },
  }];
  runAzioni(azioni, {}, 'ordini_acquisto', 'Ricevi', oaId, logged);
  assertEq(RECORDS.filter((r) => r.module_slug === 'lotti').length, 1);
  assertEq(getRecordData('lotti', RECORDS.find((r) => r.module_slug === 'lotti').id).kg_ricevuti, 50);
});

test('figli_fissi: crea esattamente le righe elencate, mappate contro il record padre (non un figlio sorgente)', () => {
  seedModule('fatture', NOOP_SCHEMA);
  seedModule('movimenti_righe', NOOP_SCHEMA);
  const fatId = seedRecord('fatture', { totale: 122, imponibile: 100 });
  const azioni = [{
    target: '__interno__', azione: 'crea_record_da_padre',
    config: {
      figli_fissi: [
        { modulo_destinazione_figli: 'movimenti_righe', mappatura_campi_figli: { dare: 'campo:totale', avere: 0 }, relazione_nuovo_padre: null },
        { modulo_destinazione_figli: 'movimenti_righe', mappatura_campi_figli: { dare: 0, avere: 'campo:imponibile' } },
      ],
    },
  }];
  runAzioni(azioni, { totale: 122, imponibile: 100 }, 'fatture', 'Genera movimento', fatId, logged);
  const righe = RECORDS.filter((r) => r.module_slug === 'movimenti_righe').map((r) => JSON.parse(r.data));
  assertEq(righe.length, 2);
  assertEq(righe[0].dare, 122);
  assertEq(righe[1].avere, 100);
});

// ─── aggiorna_figli_via_router ────────────────────────────────────────────────

console.log('\n--- aggiorna_figli_via_router ---');

test('router trovato -> instrada verso il modulo alternativo (crea la riga se non esiste)', () => {
  seedModule('ordini_righe', NOOP_SCHEMA);
  seedModule('furgoni', NOOP_SCHEMA);
  seedModule('giacenza_furgone', NOOP_SCHEMA);
  seedModule('prodotti', NOOP_SCHEMA);
  const furgoneId = seedRecord('furgoni', { agente: 3 });
  const ordId = 800;
  seedRecord('ordini_righe', { ordine: ordId, prodotto: 12, quantita: 4 });
  const azioni = [{
    target: '__interno__', azione: 'aggiorna_figli_via_router',
    config: {
      figlio_modulo: 'ordini_righe', via_relazione: 'ordine', rel_campo: 'prodotto', quantita_campo: 'quantita',
      router_campo_corrente: 'agente', router_modulo: 'furgoni', router_campo_match: 'agente',
      modulo_alternativo: 'giacenza_furgone', router_campo_riferimento: 'furgone', campo_alternativo_match: 'prodotto', target_campo_alternativo: 'kg',
      target_modulo: 'prodotti', target_campo: 'stock_attuale', operazione: 'decrement',
    },
  }];
  runAzioni(azioni, { agente: 3 }, 'ordini', 'Conferma', ordId, logged);
  const giacenze = RECORDS.filter((r) => r.module_slug === 'giacenza_furgone');
  assertEq(giacenze.length, 1);
  const g = JSON.parse(giacenze[0].data);
  assertEq(g.furgone, furgoneId);
  assertEq(g.prodotto, 12);
  assertEq(g.kg, -4, 'decremento su un record nuovo parte da 0 - 4');
  assertEq(RECORDS.filter((r) => r.module_slug === 'prodotti').length, 0, 'il magazzino centrale non deve essere toccato quando il router trova un furgone');
});

test('nessun router trovato -> fallback sul target_modulo/target_campo standard', () => {
  seedModule('ordini_righe', NOOP_SCHEMA);
  seedModule('furgoni', NOOP_SCHEMA);
  seedModule('prodotti', NOOP_SCHEMA);
  const prodId = seedRecord('prodotti', { stock_attuale: 10 });
  const ordId = 801;
  seedRecord('ordini_righe', { ordine: ordId, prodotto: prodId, quantita: 2 });
  const azioni = [{
    target: '__interno__', azione: 'aggiorna_figli_via_router',
    config: {
      figlio_modulo: 'ordini_righe', via_relazione: 'ordine', rel_campo: 'prodotto', quantita_campo: 'quantita',
      router_campo_corrente: 'agente', router_modulo: 'furgoni', router_campo_match: 'agente',
      modulo_alternativo: 'giacenza_furgone', router_campo_riferimento: 'furgone', campo_alternativo_match: 'prodotto', target_campo_alternativo: 'kg',
      target_modulo: 'prodotti', target_campo: 'stock_attuale', operazione: 'decrement',
    },
  }];
  // Nessun agente sul record -> nessun furgone trovabile -> deve cadere sul magazzino centrale
  runAzioni(azioni, {}, 'ordini', 'Conferma', ordId, logged);
  assertEq(getRecordData('prodotti', prodId).stock_attuale, 8);
});

// ─── condizioni (kind: 'condition') ───────────────────────────────────────────

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

test('dry-run: applica_prezzo_listino non scrive il prezzo sulla riga', () => {
  seedModule('prodotti', NOOP_SCHEMA);
  const prodId = seedRecord('prodotti', { prezzo_base: 10 });
  assertNoMutation((dryLog) => {
    runAzioni([{ target: '__interno__', azione: 'applica_prezzo_listino', config: { modulo_padre: 'ordini', campo_padre: 'ordine', campo_prodotto: 'prodotto', modulo_prodotti: 'prodotti', campo_prezzo_base: 'prezzo_base' } }],
      { prodotto: prodId }, 'ordini_righe', 'Test', 99, logged, { dryRun: true, dryLog });
  });
});

test('dry-run: aggiorna_figli non tocca i record collegati', () => {
  seedModule('prodotti', NOOP_SCHEMA);
  const prodId = seedRecord('prodotti', { stock: 10 });
  seedModule('ordini_righe', NOOP_SCHEMA);
  seedRecord('ordini_righe', { ordine: 99, prodotto: prodId, quantita: 3 });
  assertNoMutation((dryLog) => {
    runAzioni([{ target: '__interno__', azione: 'aggiorna_figli', config: { figlio_modulo: 'ordini_righe', via_relazione: 'ordine', rel_campo: 'prodotto', target_modulo: 'prodotti', target_campo: 'stock', operazione: 'decrement', quantita_campo: 'quantita' } }],
      {}, 'ordini', 'Test', 99, logged, { dryRun: true, dryLog });
  });
  assertEq(getRecordData('prodotti', prodId).stock, 10);
});

test('dry-run: aggiorna_figli_via_router (router trovato, crea alternativo) non crea nessun record', () => {
  seedModule('agenti', NOOP_SCHEMA);
  const agenteId = seedRecord('agenti', { nome: 'Mario' });
  seedModule('furgoni', NOOP_SCHEMA);
  const furgoneId = seedRecord('furgoni', { agente: agenteId });
  seedModule('ordini_righe', NOOP_SCHEMA);
  seedRecord('ordini_righe', { ordine: 99, prodotto: 1, quantita: 2 });
  assertNoMutation((dryLog) => {
    runAzioni([{ target: '__interno__', azione: 'aggiorna_figli_via_router', config: {
      figlio_modulo: 'ordini_righe', via_relazione: 'ordine', rel_campo: 'prodotto', quantita_campo: 'quantita',
      router_campo_corrente: 'agente', router_modulo: 'furgoni', router_campo_match: 'agente',
      modulo_alternativo: 'giacenze_furgone', router_campo_riferimento: 'furgone', campo_alternativo_match: 'prodotto', target_campo_alternativo: 'quantita',
      target_modulo: 'magazzino', target_campo: 'stock', operazione: 'decrement',
    } }], { agente: agenteId }, 'ordini', 'Test', 99, logged, { dryRun: true, dryLog });
  });
  assertEq(RECORDS.filter((r) => r.module_slug === 'giacenze_furgone').length, 0, 'nessun record creato in anteprima');
});

test('dry-run: libera_altri_con_stesso_valore non tocca gli altri record', () => {
  seedModule('furgoni', NOOP_SCHEMA);
  seedRecord('furgoni', { agente: 5 });
  assertNoMutation((dryLog) => {
    runAzioni([{ target: '__interno__', azione: 'libera_altri_con_stesso_valore', config: { modulo: 'furgoni', campo_confronto: 'agente', campo_da_liberare: 'agente' } }],
      { agente: 5 }, 'furgoni', 'Test', 99, logged, { dryRun: true, dryLog });
  });
});

test('dry-run: trova_o_crea_e_aggiorna (record esistente) non lo tocca', () => {
  seedModule('giacenze', NOOP_SCHEMA);
  const giacId = seedRecord('giacenze', { furgone: 1, prodotto: 2, quantita: 5 });
  assertNoMutation((dryLog) => {
    runAzioni([{ target: '__interno__', azione: 'trova_o_crea_e_aggiorna', config: { modulo: 'giacenze', match: { furgone: 'furgone', prodotto: 'prodotto' }, campo: 'quantita', operazione: 'increment', valore: 3 } }],
      { furgone: 1, prodotto: 2 }, 'consegne', 'Test', 99, logged, { dryRun: true, dryLog });
  });
  assertEq(getRecordData('giacenze', giacId).quantita, 5);
});

test('dry-run: trova_o_crea_e_aggiorna (nessun match) non crea il record', () => {
  seedModule('giacenze', NOOP_SCHEMA);
  assertNoMutation((dryLog) => {
    runAzioni([{ target: '__interno__', azione: 'trova_o_crea_e_aggiorna', config: { modulo: 'giacenze', match: { furgone: 'furgone', prodotto: 'prodotto' }, campo: 'quantita', operazione: 'increment', valore: 3 } }],
      { furgone: 1, prodotto: 2 }, 'consegne', 'Test', 99, logged, { dryRun: true, dryLog });
  });
  assertEq(RECORDS.filter((r) => r.module_slug === 'giacenze').length, 0);
});

test('dry-run: aggrega_in_record non crea il record aggregato né marca le sorgenti', () => {
  seedModule('spese', NOOP_SCHEMA);
  seedRecord('spese', { importo: 20, marcato: null });
  seedRecord('spese', { importo: 30, marcato: null });
  assertNoMutation((dryLog) => {
    runAzioni([{ target: '__interno__', azione: 'aggrega_in_record', config: {
      modulo_sorgente: 'spese', filtro: [{ campo: 'marcato', op: '==', valore: null }],
      modulo_destinazione: 'distinte', mappatura: { totale: 'somma:importo' }, campo_marcatura: 'marcato',
    } }], {}, 'automazioni', 'Test', null, logged, { dryRun: true, dryLog });
  });
  assertEq(RECORDS.filter((r) => r.module_slug === 'distinte').length, 0);
});

test('dry-run: storna_riferimento non inverte i delta né tocca i record', () => {
  seedModule('cassa', NOOP_SCHEMA);
  const cassaId = seedRecord('cassa', { saldo: 100 });
  seedModule('pagamenti', NOOP_SCHEMA);
  const pagId = seedRecord('pagamenti', { cassa: cassaId });
  runAzioni([{ target: '__interno__', azione: 'aggiorna_record', config: { modulo: 'cassa', id_field: 'cassa', campo: 'saldo', operazione: 'increment', valore: 50 } }],
    { cassa: cassaId }, 'pagamenti', 'Registra', pagId, logged); // esecuzione reale, per generare un delta reale da stornare
  assertEq(getRecordData('cassa', cassaId).saldo, 150);
  assertNoMutation((dryLog) => {
    runAzioni([{ target: '__interno__', azione: 'storna_riferimento' }], {}, 'pagamenti', 'Storna', pagId, logged, { dryRun: true, dryLog });
  });
  assertEq(getRecordData('cassa', cassaId).saldo, 150, 'il saldo non deve tornare indietro in anteprima');
});

test('dry-run: crea_record_da_padre non crea padre né figli', () => {
  seedModule('ordini', NOOP_SCHEMA);
  seedModule('ordini_righe', NOOP_SCHEMA);
  seedRecord('ordini_righe', { ordine: 99, prodotto: 1, quantita: 2 });
  assertNoMutation((dryLog) => {
    runAzioni([{ target: '__interno__', azione: 'crea_record_da_padre', config: {
      modulo_destinazione: 'fatture', mappatura_campi: { note: 'campo:note' },
      figli: [{ modulo_sorgente_figli: 'ordini_righe', via_relazione: 'ordine', modulo_destinazione_figli: 'fatture_righe', mappatura_campi_figli: { prodotto: 'campo:prodotto' } }],
    } }], { note: 'test' }, 'ordini', 'Test', 99, logged, { dryRun: true, dryLog });
  });
  assertEq(RECORDS.filter((r) => r.module_slug === 'fatture' || r.module_slug === 'fatture_righe').length, 0);
});

test('dry-run: registra_provvigione non crea movimenti né marca le fatture', () => {
  seedModule('agenti', NOOP_SCHEMA);
  const agenteId = seedRecord('agenti', { provvigione_base: 10, scaglioni_provvigione: '[]' });
  seedModule('fatture', { fields: [{ key: 'imponibile_calcolato', type: 'computed', expr: 'imponibile' }], relations: [] });
  const fatId = seedRecord('fatture', { agente: agenteId, imponibile: 1000, provvigione_registrata: false });
  seedModule('piano_conti', NOOP_SCHEMA);
  seedModule('movimenti', NOOP_SCHEMA);
  assertNoMutation((dryLog) => {
    runAzioni([{ target: '__interno__', azione: 'registra_provvigione' }], { agente: agenteId }, 'richieste_provvigione', 'Test', 1, logged, { dryRun: true, dryLog });
  });
  assertEq(getRecordData('fatture', fatId).provvigione_registrata, false);
  assertEq(RECORDS.filter((r) => r.module_slug === 'movimenti').length, 0);
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
