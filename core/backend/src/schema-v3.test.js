'use strict';

// Test — schema v2<->v3 (round-trip, tolleranza dei blocchi non rappresentabili,
// estrattori dedicati). Stesso pattern di formula-soglia.test.js/permissions.test.js.
// Eseguire con: node schema-v3.test.js

const {
  isV3, isV2, toV3, toV2, toV2Lenient, parseSchemaNormalized,
  getAutomationSteps,
} = require('./schema-v3');

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
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${msg || ''}: atteso ${b}, ottenuto ${a}`);
}

function assertThrows(fn, containsText) {
  let threw = false, message = '';
  try { fn(); } catch (e) { threw = true; message = e.message; }
  if (!threw) throw new Error('Atteso un errore, ma la funzione è tornata senza lanciare');
  if (containsText && !message.includes(containsText)) {
    throw new Error(`Errore atteso con "${containsText}", trovato: ${message}`);
  }
}

// ─── isV3 / isV2 ──────────────────────────────────────────────────────────────

console.log('\n--- isV3 / isV2 ---');

test('schema con version:3 e steps[] è v3', () => {
  assertEq(isV3({ version: 3, steps: [] }), true);
  assertEq(isV2({ version: 3, steps: [] }), false);
});

test('schema legacy (fields/relations dirette) è v2', () => {
  assertEq(isV3({ fields: [] }), false);
  assertEq(isV2({ fields: [] }), true);
});

test('schema vuoto/nullo è v2 (default retrocompatibile)', () => {
  assertEq(isV2({}), true);
  assertEq(isV2(null), true);
});

// ─── toV3: round-trip di ogni categoria v2 ───────────────────────────────────

console.log('\n--- toV3 ---');

test('fields/relations/workflow/scope/permissions/aggregati diventano step con block_type corretto', () => {
  const v2 = {
    fields: [{ key: 'nome', label: 'Nome', type: 'text' }],
    relations: [{ key: 'cliente', target_module: 'clienti', type: 'many_to_one' }],
    workflow: {
      states: [{ key: 'bozza', label: 'Bozza', initial: true }],
      transitions: [{ from: 'bozza', to: 'confermato', label: 'Conferma' }],
    },
    scope: { qualcosa: true },
    permissions: { rules: [{ role: 'agente', view: true }] },
    validazione_creazione: { expr: 'campo:x > 0' },
    aggregati: [{ key: 'tot', expr: 'sum(righe.importo)' }],
  };
  const v3 = toV3(v2);
  assertEq(v3.version, 3);
  const types = v3.steps.map((s) => s.block_type);
  assertEq(types, ['field', 'relation', 'workflow_state', 'workflow_transition', 'scope', 'permissions', 'validazione_creazione', 'report_aggregate']);
  // ogni step porta un id univoco generato, oltre ai campi originali
  v3.steps.forEach((s) => { if (!s.id) throw new Error('step senza id: ' + s.block_type); });
  const fieldStep = v3.steps.find((s) => s.block_type === 'field');
  assertEq(fieldStep.key, 'nome');
  assertEq(fieldStep.label, 'Nome');
});

test('schema v2 vuoto -> steps vuoto, nessun errore', () => {
  const v3 = toV3({});
  assertEq(v3.steps, []);
});

// ─── toV2: strict, lancia su blocchi non rappresentabili ────────────────────

console.log('\n--- toV2 (strict) ---');

test('round-trip completo v2->v3->v2 preserva tutte le categorie rappresentabili', () => {
  const v2 = {
    fields: [{ key: 'nome', label: 'Nome', type: 'text' }],
    relations: [{ key: 'cliente', target_module: 'clienti', type: 'many_to_one' }],
    workflow: {
      states: [{ key: 'bozza', label: 'Bozza', initial: true }],
      transitions: [{ from: 'bozza', to: 'confermato', label: 'Conferma' }],
    },
    scope: { qualcosa: true },
    permissions: { rules: [{ role: 'agente', view: true }] },
    validazione_creazione: { expr: 'campo:x > 0' },
    aggregati: [{ key: 'tot', expr: 'sum(righe.importo)' }],
  };
  const roundtripped = toV2(toV3(v2));
  assertEq(roundtripped.fields, v2.fields);
  assertEq(roundtripped.relations, v2.relations);
  assertEq(roundtripped.workflow, v2.workflow);
  assertEq(roundtripped.scope, v2.scope);
  assertEq(roundtripped.permissions, v2.permissions);
  assertEq(roundtripped.validazione_creazione, v2.validazione_creazione);
  assertEq(roundtripped.aggregati, v2.aggregati);
});

test('blocco "condition" senza equivalente v2 -> lancia esplicitamente', () => {
  const v3 = { version: 3, steps: [{ id: 'c1', block_type: 'condition' }] };
  assertThrows(() => toV2(v3), 'condition');
});

test('blocco "automation" senza equivalente v2 -> lancia esplicitamente', () => {
  const v3 = { version: 3, steps: [{ id: 'a1', block_type: 'automation' }] };
  assertThrows(() => toV2(v3), 'automation');
});

test('i blocchi rimossi dal motore (document_template, form_step, reconciliation, financial_statement, distance_buckets) sono "sconosciuti": lancia in modo esplicito', () => {
  for (const t of ['document_template', 'form_step', 'reconciliation', 'financial_statement', 'distance_buckets']) {
    assertThrows(() => toV2({ version: 3, steps: [{ id: 'x1', block_type: t }] }), 'sconosciuto');
  }
});

test('block_type sconosciuto -> lancia esplicitamente (non ignora silenziosamente)', () => {
  const v3 = { version: 3, steps: [{ id: 'x1', block_type: 'qualcosa_di_nuovo' }] };
  assertThrows(() => toV2(v3), 'sconosciuto');
});

// ─── toV2Lenient: tollerante, usata da parseSchemaNormalized ────────────────

console.log('\n--- toV2Lenient ---');

test('blocchi non rappresentabili finiscono in _v3_unsupported invece di far fallire tutto', () => {
  const v3 = {
    version: 3,
    steps: [
      { id: 'fld1', block_type: 'field', key: 'nome', label: 'Nome' },
      { id: 'a1', block_type: 'automation', label: 'Automazione X' },
      { id: 'c1', block_type: 'condition' },
    ],
  };
  const out = toV2Lenient(v3);
  assertEq(out.fields.length, 1);
  assertEq(out.fields[0].key, 'nome');
  assertEq(out._v3_unsupported.length, 2);
  // i blocchi in _v3_unsupported restano step v3 completi (con id e block_type), non "rest"
  const auto = out._v3_unsupported.find((s) => s.block_type === 'automation');
  assertEq(auto.label, 'Automazione X');
  assertEq(auto.id, 'a1');
});

test('un blocco rimosso dal motore (es. form_step) in uno schema già salvato viene ignorato in lettura, non fa fallire il modulo', () => {
  const v3 = { version: 3, steps: [{ id: 'fld1', block_type: 'field', key: 'nome' }, { id: 'f1', block_type: 'form_step', titolo: 'Passo 1' }] };
  const out = toV2Lenient(v3);
  assertEq(out.fields.length, 1); assertEq(out._v3_unsupported.length, 0);
});

test('view_tabs viene raccolto in out.view_tabs (rappresentabile, singleton come scope)', () => {
  const v2 = {
    view_tabs: {
      tabs: [
        { key: 'a', label: 'Spese', block_type: 'period_view', block_key: 'mese' },
        { key: 'b', label: 'Debiti', block_type: 'parent_children_view', block_key: 'piani', source_module: 'debiti_casa' },
      ],
    },
  };
  const v3 = toV3(v2);
  const step = v3.steps.find((s) => s.block_type === 'view_tabs');
  assertEq(step.tabs.length, 2);
  assertEq(step.tabs[1].source_module, 'debiti_casa');
  const out = toV2Lenient(v3);
  assertEq(out.view_tabs, v2.view_tabs);
  assertEq(out._v3_unsupported, []);
});

test('view_tabs assente -> out.view_tabs resta null (non un oggetto vuoto)', () => {
  const out = toV2Lenient({ version: 3, steps: [] });
  assertEq(out.view_tabs, null);
});

test('blocco "view_tabs" senza equivalente v2 (toV2 strict) -> lancia esplicitamente', () => {
  const v3 = { version: 3, steps: [{ id: 'v1', block_type: 'view_tabs', tabs: [] }] };
  assertThrows(() => toV2(v3), 'view_tabs');
});

test('block_type sconosciuto viene ignorato silenziosamente (a differenza di toV2 strict)', () => {
  const v3 = { version: 3, steps: [{ id: 'x1', block_type: 'qualcosa_di_nuovo' }] };
  const out = toV2Lenient(v3);
  assertEq(out.fields, []);
  assertEq(out._v3_unsupported, []);
});

// ─── parseSchemaNormalized ────────────────────────────────────────────────────

console.log('\n--- parseSchemaNormalized ---');

test('schema v2 legacy passa invariato', () => {
  const json = JSON.stringify({ fields: [{ key: 'a', label: 'A' }] });
  const out = parseSchemaNormalized(json);
  assertEq(out.fields, [{ key: 'a', label: 'A' }]);
});

test('schema v3 viene normalizzato a v2 tollerante', () => {
  const json = JSON.stringify({ version: 3, steps: [{ id: 'fld1', block_type: 'field', key: 'a', label: 'A' }] });
  const out = parseSchemaNormalized(json);
  assertEq(out.fields, [{ key: 'a', label: 'A' }]);
});

test('JSON non valido -> oggetto vuoto, non lancia', () => {
  assertEq(parseSchemaNormalized('{questo non è json'), {});
  assertEq(parseSchemaNormalized(null), {});
});

// ─── getAutomationSteps ───────────────────────────────

console.log('\n--- getAutomationSteps ---');

test('getAutomationSteps estrae solo i blocchi automation, id inclusi', () => {
  const json = JSON.stringify({
    version: 3,
    steps: [
      { id: 'fld1', block_type: 'field', key: 'a' },
      { id: 'aut1', block_type: 'automation', label: 'Aut 1' },
      { id: 'aut2', block_type: 'automation', label: 'Aut 2' },
    ],
  });
  const steps = getAutomationSteps(json);
  assertEq(steps.length, 2);
  assertEq(steps.map((s) => s.id), ['aut1', 'aut2']);
});

test('getAutomationSteps su schema v2 legacy -> array vuoto (mai automazioni possibili)', () => {
  assertEq(getAutomationSteps(JSON.stringify({ fields: [] })), []);
});

// Bug reale 2026-08-10: un modulo ripubblicato via API diretta (mai attraverso il
// vero editor v3) viene salvato in forma v2-lenient — campi nativi v2 + un array
// _v3_unsupported che contiene gli step v3-only (automation/condition)
// così come sono, per non perderli. getAutomationSteps
// guardava SOLO schema.steps sotto isV3(schema): su questa forma tornavano
// sempre [], e fireTrigger() non trovava mai l'automazione da eseguire — trovato
// perché "Crea piano rateale alla creazione" (debiti_casa) aveva smesso di
// generare le rate pur essendo ancora presente nello schema pubblicato.
test('getAutomationSteps su schema v2-lenient (con _v3_unsupported) -> trova comunque le automazioni', () => {
  const json = JSON.stringify({
    fields: [{ key: 'a' }],
    branch_creates: [],
    _v3_unsupported: [
      { id: 'aut1', block_type: 'automation', label: 'Crea piano rateale' },
      { id: 'cond1', block_type: 'condition' },
    ],
  });
  const steps = getAutomationSteps(json);
  assertEq(steps.length, 1);
  assertEq(steps[0].id, 'aut1');
});

// ─── view: block_type unificato (Fase 1 semplificazione Builder, ispirato a
// Collections) — stesse garanzie dei 5 block_type che subentra a sostituire per i
// NUOVI blocchi: mai auto-convertito dai vecchi, mai perso in lettura. ──────────

console.log('\n--- view (block_type unificato) ---');

test('toV3: le 5 chiavi legacy diventano i 5 block_type distinti, MAI "view"', () => {
  const v2 = {
    period_views: [{ key: 'p', label: 'Periodo' }],
    parent_children_views: [{ key: 'f', label: 'Figli' }],
    yearly_breakdowns: [{ key: 'y', label: 'Anno' }],
    category_pivots: [{ key: 'c', label: 'Pivot' }],
    weekly_breakdowns: [{ key: 'w', label: 'Settimana' }],
  };
  const v3 = toV3(v2);
  const types = v3.steps.map((s) => s.block_type);
  assertEq(types, ['period_view', 'parent_children_view', 'yearly_breakdown', 'category_pivot', 'weekly_breakdown']);
  assertEq(types.includes('view'), false);
});

test('toV3: la chiave "views" diventa block_type "view"', () => {
  const v2 = { views: [{ key: 'v1', label: 'Vista unificata', mode: 'period', placement: 'replace' }] };
  const v3 = toV3(v2);
  const step = v3.steps.find((s) => s.block_type === 'view');
  assertEq(step.key, 'v1');
  assertEq(step.mode, 'period');
});

test('toV2Lenient: un blocco "period_view" legacy e un blocco "view" nuovo restano array separati, mai uniti', () => {
  const v3 = {
    version: 3,
    steps: [
      { id: 'pvw1', block_type: 'period_view', key: 'p', label: 'Vecchia' },
      { id: 'vwb1', block_type: 'view', key: 'v', label: 'Nuova', mode: 'period', placement: 'replace' },
    ],
  };
  const out = toV2Lenient(v3);
  assertEq(out.period_views.length, 1);
  assertEq(out.period_views[0].key, 'p');
  assertEq(out.views.length, 1);
  assertEq(out.views[0].key, 'v');
});

test('toV2Lenient: "views" assente -> out.views resta [] (non scartato in _v3_unsupported, non undefined)', () => {
  const out = toV2Lenient({ version: 3, steps: [] });
  assertEq(out.views, []);
  assertEq(out._v3_unsupported, []);
});

test('blocco "view" senza equivalente v2 (toV2 strict) -> lancia esplicitamente', () => {
  const v3 = { version: 3, steps: [{ id: 'v1', block_type: 'view', mode: 'period' }] };
  assertThrows(() => toV2(v3), 'view');
});

// ─── SOMMARIO ─────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
console.log(`Risultato: ${passed} passati, ${failed} falliti`);
if (failed > 0) {
  process.exit(1);
}
