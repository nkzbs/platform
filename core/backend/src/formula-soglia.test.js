'use strict';

// Test §1 — motore formule a soglia
// Funzioni pure testate contro dati mock (no better-sqlite3, no compilazione).
// Approccio: stesso pattern già usato per il motore formule esistente e per Nico Caffè.
// Eseguire con: node formula-soglia.test.js

const {
  validateScaglioni,
  calcolaScaglioni,
  validateSogliaData,
  calcolaSogliaData,
} = require('./formula-soglia');

const { evaluateFormula } = require('./formula');

// ─── INFRASTRUTTURA TEST ──────────────────────────────────────────────────────

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
  if (actual !== expected) {
    throw new Error(`${msg || ''}: atteso ${expected}, ottenuto ${actual}`);
  }
}

function assertClose(actual, expected, msg, eps = 1e-9) {
  if (Math.abs(actual - expected) > eps) {
    throw new Error(`${msg || ''}: atteso ${expected}, ottenuto ${actual}`);
  }
}

function assertValid(result) {
  if (!result.valid) throw new Error('Atteso valido, ma errori: ' + result.errors.join('; '));
}

function assertInvalid(result, containsText) {
  if (result.valid) throw new Error('Atteso invalido, ma è passato');
  if (containsText) {
    const msg = result.errors.join(' ');
    if (!msg.toLowerCase().includes(containsText.toLowerCase())) {
      throw new Error(`Errore atteso con "${containsText}", trovato: ${msg}`);
    }
  }
}

// Mock DB minimo per i test di integrazione (valutazione espressione `su`).
// Implementa l'interfaccia db.prepare(sql).all([param]) usata da formula.js.
function makeMockDb(modules, records) {
  return {
    prepare(sql) {
      if (sql.includes('FROM modules WHERE installed = 1')) {
        return { all: () => modules };
      }
      if (sql.includes('FROM records WHERE module_slug = ?')) {
        return { all: (slug) => records.filter((r) => r.module_slug === slug) };
      }
      return { all: () => [] };
    },
  };
}

// ─── §1.5 — SCAGLIONI: VALIDAZIONE ───────────────────────────────────────────

console.log('\n--- validateScaglioni ---');

test('schema vuoto rifiutato', () => {
  assertInvalid(validateScaglioni([]), 'non vuoto');
});

test('schema non array rifiutato', () => {
  assertInvalid(validateScaglioni(null));
});

test('schema senza livello terminale rifiutato', () => {
  assertInvalid(
    validateScaglioni([{ fino: 10000, tasso: 0.05 }, { fino: 20000, tasso: 0.03 }]),
    'terminale'
  );
});

test('schema con due livelli terminali rifiutato', () => {
  assertInvalid(
    validateScaglioni([{ tasso: 0.05 }, { tasso: 0.03 }]),
    'esattamente uno'
  );
});

test('livello terminale non ultimo rifiutato', () => {
  assertInvalid(
    validateScaglioni([{ tasso: 0.05 }, { fino: 10000, tasso: 0.03 }]),
    'ultimo'
  );
});

test('livelli non ordinati rifiutati', () => {
  assertInvalid(
    validateScaglioni([{ fino: 20000, tasso: 0.05 }, { fino: 10000, tasso: 0.04 }, { tasso: 0.03 }]),
    'maggiore'
  );
});

test('tasso mancante rifiutato', () => {
  assertInvalid(
    validateScaglioni([{ fino: 10000 }, { tasso: 0.03 }]),
    'tasso'
  );
});

test('2 livelli validi accettati', () => {
  assertValid(validateScaglioni([{ fino: 10000, tasso: 0.05 }, { tasso: 0.03 }]));
});

test('5 livelli validi accettati', () => {
  assertValid(validateScaglioni([
    { fino: 5000, tasso: 0.06 },
    { fino: 10000, tasso: 0.05 },
    { fino: 20000, tasso: 0.04 },
    { fino: 50000, tasso: 0.03 },
    { tasso: 0.02 },
  ]));
});

// ─── §1.5 — SCAGLIONI: CALCOLO 2 LIVELLI ─────────────────────────────────────
// Schema: 5% fino a 10.000 €, 3% sul resto

console.log('\n--- calcolaScaglioni — 2 livelli [0→10k 5%, ∞ 3%] ---');

const s2 = [{ fino: 10000, tasso: 0.05 }, { tasso: 0.03 }];

test('valore = 0 (sotto la soglia più bassa)', () => {
  assertClose(calcolaScaglioni(0, s2).value, 0);
});

test('valore = 5000 (nel primo scaglione)', () => {
  assertClose(calcolaScaglioni(5000, s2).value, 250);    // 5000 * 0.05
});

test('valore = 10000 (esattamente sulla soglia — edge case)', () => {
  assertClose(calcolaScaglioni(10000, s2).value, 500);   // 10000 * 0.05
});

test('valore = 15000 (tratto aperto finale)', () => {
  assertClose(calcolaScaglioni(15000, s2).value, 650);   // 10000*0.05 + 5000*0.03
});

// ─── §1.5 — SCAGLIONI: CALCOLO 3 LIVELLI ─────────────────────────────────────
// Schema: 5% fino 10k, 4% da 10k a 20k, 3% oltre 20k

console.log('\n--- calcolaScaglioni — 3 livelli [0→10k 5%, 10k→20k 4%, ∞ 3%] ---');

const s3 = [
  { fino: 10000, tasso: 0.05 },
  { fino: 20000, tasso: 0.04 },
  { tasso: 0.03 },
];

test('valore = 0', () => {
  assertClose(calcolaScaglioni(0, s3).value, 0);
});

test('valore = 5000 (primo scaglione)', () => {
  assertClose(calcolaScaglioni(5000, s3).value, 250);
});

test('valore = 10000 (soglia primo livello)', () => {
  assertClose(calcolaScaglioni(10000, s3).value, 500);   // 10000*0.05
});

test('valore = 15000 (nel secondo scaglione)', () => {
  assertClose(calcolaScaglioni(15000, s3).value, 700);   // 10000*0.05 + 5000*0.04
});

test('valore = 20000 (soglia secondo livello)', () => {
  assertClose(calcolaScaglioni(20000, s3).value, 900);   // 10000*0.05 + 10000*0.04
});

test('valore = 25000 (tratto aperto finale)', () => {
  assertClose(calcolaScaglioni(25000, s3).value, 1050);  // 500 + 400 + 5000*0.03
});

// ─── §1.5 — SCAGLIONI: CALCOLO 5 LIVELLI ─────────────────────────────────────
// Schema: 6%/5%/4%/3%/2% su fasce 0-5k / 5k-10k / 10k-20k / 20k-50k / 50k+

console.log('\n--- calcolaScaglioni — 5 livelli [6%/5%/4%/3%/2%] ---');

const s5 = [
  { fino: 5000,  tasso: 0.06 },
  { fino: 10000, tasso: 0.05 },
  { fino: 20000, tasso: 0.04 },
  { fino: 50000, tasso: 0.03 },
  { tasso: 0.02 },
];

test('valore = 2500 (prima soglia)', () => {
  assertClose(calcolaScaglioni(2500, s5).value, 150);    // 2500*0.06
});

test('valore = 5000 (soglia primo livello)', () => {
  assertClose(calcolaScaglioni(5000, s5).value, 300);    // 5000*0.06
});

test('valore = 10000 (soglia secondo livello)', () => {
  assertClose(calcolaScaglioni(10000, s5).value, 550);   // 300 + 5000*0.05
});

test('valore = 20000 (soglia terzo livello)', () => {
  assertClose(calcolaScaglioni(20000, s5).value, 950);   // 300 + 250 + 10000*0.04
});

test('valore = 50000 (soglia quarto livello)', () => {
  assertClose(calcolaScaglioni(50000, s5).value, 1850);  // 300+250+400+30000*0.03
});

test('valore = 100000 (tratto aperto finale)', () => {
  assertClose(calcolaScaglioni(100000, s5).value, 2850); // 1850 + 50000*0.02
});

// ─── §1.5 — SCAGLIONI: INTEGRAZIONE CON MOCK DB ──────────────────────────────
// Simula: formula `su` = sum(ordini.totale), poi scaglioni applicati al risultato.
// Usa un DB mock in-memory (no better-sqlite3) come già fatto per il motore formule.

console.log('\n--- integrazione scaglioni + mock DB (sum(ordini.totale)) ---');

{
  const schemaOrdini = JSON.stringify({
    fields: [
      { key: 'agente', label: 'Agente', type: 'text' },
      { key: 'totale', label: 'Totale', type: 'currency' },
    ],
  });
  const mockModules = [
    { slug: 'ordini', schema_json: schemaOrdini, schema_json_draft: null, installed: 1 },
  ];
  const mockRecords = [
    { module_slug: 'ordini', data: JSON.stringify({ agente: 'Mario', totale: 8000 }) },
    { module_slug: 'ordini', data: JSON.stringify({ agente: 'Mario', totale: 7000 }) },
  ];
  // totale ordini = 15000 → 10000*0.05 + 5000*0.03 = 650
  const db = makeMockDb(mockModules, mockRecords);

  test('sum(ordini.totale)=15000 → scaglioni 2 livelli → 650', () => {
    const formulaResult = evaluateFormula('sum(ordini.totale)', db, null);
    assertValid(formulaResult);
    assertClose(formulaResult.value, 15000, 'totale ordini');
    const scRes = calcolaScaglioni(formulaResult.value, s2);
    assertClose(scRes.value, 650, 'provvigione a scaglioni');
  });
}

// ─── §1.5 — SOGLIA_DATA: VALIDAZIONE ─────────────────────────────────────────

console.log('\n--- validateSogliaData ---');

test('tipo non riconosciuto rifiutato esplicitamente (non silenziosamente)', () => {
  const r = validateSogliaData({
    su: 'campo:data_pagamento',
    tipo: 'giorno_anno',
    se_vero: 'mese_successivo',
    se_falso: 'mese_corrente',
  });
  assertInvalid(r, 'non riconosciuto');
});

test('tipo mancante rifiutato', () => {
  assertInvalid(validateSogliaData({ su: 'campo:data', se_vero: 'x', se_falso: 'y' }), 'obbligatorio');
});

test('"su" non campo: rifiutato', () => {
  assertInvalid(
    validateSogliaData({ su: 'sum(ordini.totale)', tipo: 'giorno_mese', soglia: 27, se_vero: 'mese_successivo', se_falso: 'mese_corrente' }),
    'campo:'
  );
});

test('giorno_mese senza "soglia" rifiutato', () => {
  assertInvalid(
    validateSogliaData({ su: 'campo:data_pagamento', tipo: 'giorno_mese', se_vero: 'mese_successivo', se_falso: 'mese_corrente' }),
    'soglia'
  );
});

test('giorno_settimana con giorni vuoti rifiutato', () => {
  assertInvalid(
    validateSogliaData({ su: 'campo:data', tipo: 'giorno_settimana', giorni: [], se_vero: 'x', se_falso: 'y' }),
    'giorni'
  );
});

test('fine_mese_offset senza offset rifiutato', () => {
  assertInvalid(
    validateSogliaData({ su: 'campo:data', tipo: 'fine_mese_offset', se_vero: 'x', se_falso: 'y' }),
    'offset'
  );
});

test('giorno_mese valido accettato', () => {
  assertValid(validateSogliaData({
    su: 'campo:data_pagamento',
    tipo: 'giorno_mese',
    soglia: 27,
    se_vero: 'mese_successivo',
    se_falso: 'mese_corrente',
  }));
});

// ─── §1.5 — SOGLIA_DATA: CALCOLO giorno_mese ─────────────────────────────────
// Regola: dal giorno 27 in poi → mese successivo, altrimenti mese corrente

console.log('\n--- calcolaSogliaData — tipo: giorno_mese ---');

const sdGiornoMese = {
  su: 'campo:data_pagamento',
  tipo: 'giorno_mese',
  soglia: 27,
  se_vero: 'mese_successivo',
  se_falso: 'mese_corrente',
};

test('15 gennaio → mese corrente (gennaio)', () => {
  const r = calcolaSogliaData('2026-01-15', sdGiornoMese);
  assertEq(r.periodo, 'mese_corrente');
  assertEq(r.anno, 2026);
  assertEq(r.mese, 1);
});

test('27 gennaio → mese successivo (febbraio) [esattamente sulla soglia]', () => {
  const r = calcolaSogliaData('2026-01-27', sdGiornoMese);
  assertEq(r.periodo, 'mese_successivo');
  assertEq(r.anno, 2026);
  assertEq(r.mese, 2);
});

test('31 gennaio → mese successivo (febbraio)', () => {
  const r = calcolaSogliaData('2026-01-31', sdGiornoMese);
  assertEq(r.periodo, 'mese_successivo');
  assertEq(r.mese, 2);
});

test('rollover dicembre → gennaio (27 dic → anno+1, mese 1)', () => {
  const r = calcolaSogliaData('2026-12-27', sdGiornoMese);
  assertEq(r.periodo, 'mese_successivo');
  assertEq(r.anno, 2027);
  assertEq(r.mese, 1);
});

test('26 dicembre → mese corrente (dicembre, nessun rollover)', () => {
  const r = calcolaSogliaData('2026-12-26', sdGiornoMese);
  assertEq(r.periodo, 'mese_corrente');
  assertEq(r.anno, 2026);
  assertEq(r.mese, 12);
});

// ─── §1.5 — SOGLIA_DATA: CALCOLO range_date ──────────────────────────────────
// Range ricorrente: 1 aprile–31 agosto (es. stagione estiva)

console.log('\n--- calcolaSogliaData — tipo: range_date ---');

const sdRange = {
  su: 'campo:data_operazione',
  tipo: 'range_date',
  inizio_mese: 4,  inizio_giorno: 1,
  fine_mese:   8,  fine_giorno:   31,
  se_vero: 'tariffa_estiva',
  se_falso: 'tariffa_standard',
};

test('15 giugno → dentro il range → tariffa_estiva', () => {
  const r = calcolaSogliaData('2026-06-15', sdRange);
  assertEq(r.periodo, 'tariffa_estiva');
});

test('1 aprile → primo giorno del range (edge)', () => {
  const r = calcolaSogliaData('2026-04-01', sdRange);
  assertEq(r.periodo, 'tariffa_estiva');
});

test('31 agosto → ultimo giorno del range (edge)', () => {
  const r = calcolaSogliaData('2026-08-31', sdRange);
  assertEq(r.periodo, 'tariffa_estiva');
});

test('15 marzo → fuori dal range → tariffa_standard', () => {
  const r = calcolaSogliaData('2026-03-15', sdRange);
  assertEq(r.periodo, 'tariffa_standard');
});

test('1 settembre → appena fuori dal range (edge)', () => {
  const r = calcolaSogliaData('2026-09-01', sdRange);
  assertEq(r.periodo, 'tariffa_standard');
});

// Range cross-anno: 15 dicembre–15 gennaio (periodo natalizio)
const sdRangeCrossAnno = {
  su: 'campo:data_operazione',
  tipo: 'range_date',
  inizio_mese: 12, inizio_giorno: 15,
  fine_mese:   1,  fine_giorno:   15,
  se_vero: 'natalizio',
  se_falso: 'standard',
};

test('range cross-anno: 20 dicembre → natalizio', () => {
  const r = calcolaSogliaData('2026-12-20', sdRangeCrossAnno);
  assertEq(r.periodo, 'natalizio');
});

test('range cross-anno: 10 gennaio → natalizio', () => {
  const r = calcolaSogliaData('2027-01-10', sdRangeCrossAnno);
  assertEq(r.periodo, 'natalizio');
});

test('range cross-anno: 1 luglio → standard', () => {
  const r = calcolaSogliaData('2026-07-01', sdRangeCrossAnno);
  assertEq(r.periodo, 'standard');
});

// ─── §1.5 — SOGLIA_DATA: CALCOLO giorno_settimana ────────────────────────────
// 2026-01-01 è giovedì → lunedì = 2026-01-05, domenica = 2026-01-04

console.log('\n--- calcolaSogliaData — tipo: giorno_settimana ---');

const sdGiornoSett = {
  su: 'campo:data_consegna',
  tipo: 'giorno_settimana',
  giorni: [1, 2, 3],  // lunedì, martedì, mercoledì
  se_vero: 'inizio_settimana',
  se_falso: 'fine_settimana',
};

test('lunedì 5 gennaio → in [1,2,3] → inizio_settimana', () => {
  // new Date('2026-01-05').getUTCDay() == 1 (lunedì)
  const d = new Date('2026-01-05');
  if (d.getUTCDay() !== 1) throw new Error('Prerequisito: 2026-01-05 deve essere lunedì');
  const r = calcolaSogliaData('2026-01-05', sdGiornoSett);
  assertEq(r.periodo, 'inizio_settimana');
});

test('domenica 4 gennaio → non in [1,2,3] → fine_settimana', () => {
  const d = new Date('2026-01-04');
  if (d.getUTCDay() !== 0) throw new Error('Prerequisito: 2026-01-04 deve essere domenica');
  const r = calcolaSogliaData('2026-01-04', sdGiornoSett);
  assertEq(r.periodo, 'fine_settimana');
});

test('giorno_settimana con nomi italiani (lunedi, martedi)', () => {
  const sdNomi = {
    su: 'campo:data',
    tipo: 'giorno_settimana',
    giorni: ['lunedi', 'martedi'],
    se_vero: 'lavorativo_inizio',
    se_falso: 'altro',
  };
  const r = calcolaSogliaData('2026-01-05', sdNomi); // lunedì
  assertEq(r.periodo, 'lavorativo_inizio');
});

// ─── §1.5 — SOGLIA_DATA: CALCOLO fine_mese_offset ────────────────────────────
// Ultimi 3 giorni del mese → si_vero (gennaio ha 31 giorni: 29, 30, 31)

console.log('\n--- calcolaSogliaData — tipo: fine_mese_offset ---');

const sdFineMese = {
  su: 'campo:data_scadenza',
  tipo: 'fine_mese_offset',
  offset: 3,
  se_vero: 'ultimi_giorni',
  se_falso: 'mese_normale',
};

test('31 gennaio → ultimo giorno (offset=3) → ultimi_giorni', () => {
  const r = calcolaSogliaData('2026-01-31', sdFineMese);
  assertEq(r.periodo, 'ultimi_giorni');
});

test('29 gennaio → terzultimo giorno (offset=3) → ultimi_giorni', () => {
  const r = calcolaSogliaData('2026-01-29', sdFineMese);
  assertEq(r.periodo, 'ultimi_giorni');
});

test('28 gennaio → fuori dall\'offset → mese_normale', () => {
  // 31 - 28 = 3, non strettamente < 3
  const r = calcolaSogliaData('2026-01-28', sdFineMese);
  assertEq(r.periodo, 'mese_normale');
});

test('15 gennaio → mese_normale', () => {
  const r = calcolaSogliaData('2026-01-15', sdFineMese);
  assertEq(r.periodo, 'mese_normale');
});

test('febbraio non bisestile: 26 feb → terzultimo → ultimi_giorni', () => {
  // Febbraio 2026 ha 28 giorni; 28-26=2 < 3 → true
  const r = calcolaSogliaData('2026-02-26', sdFineMese);
  assertEq(r.periodo, 'ultimi_giorni');
});

test('febbraio non bisestile: 25 feb → fuori offset → mese_normale', () => {
  // 28 - 25 = 3, non strettamente < 3
  const r = calcolaSogliaData('2026-02-25', sdFineMese);
  assertEq(r.periodo, 'mese_normale');
});

// ─── calcolaSogliaData: tipo sconosciuto lancia errore (non ritorna se_falso) ──

console.log('\n--- calcolaSogliaData — tipo sconosciuto ---');

test('tipo sconosciuto lancia errore esplicito, non ritorna silenziosamente', () => {
  let threw = false;
  try {
    calcolaSogliaData('2026-06-15', {
      su: 'campo:data',
      tipo: 'giorno_anno',
      se_vero: 'x',
      se_falso: 'y',
    });
  } catch (e) {
    threw = true;
    if (!e.message.includes('giorno_anno')) {
      throw new Error(`Errore lanciato ma il messaggio non menziona il tipo: "${e.message}"`);
    }
  }
  if (!threw) throw new Error('Atteso un errore, ma calcolaSogliaData ha restituito un valore');
});

// ─── SOMMARIO ─────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
console.log(`Risultato: ${passed} passati, ${failed} falliti`);
if (failed > 0) {
  process.exit(1);
}
