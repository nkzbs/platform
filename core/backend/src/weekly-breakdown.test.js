'use strict';
// Test — weekly-breakdown.js (motore puro, nessun DB). Eseguire con: node weekly-breakdown.test.js

const { computeWeeklyBreakdown } = require('./weekly-breakdown');

let failures = 0;
function assertEqual(actual, expected, label) {
  if (actual !== expected) { console.error(`FAIL ${label}: atteso ${JSON.stringify(expected)}, ottenuto ${JSON.stringify(actual)}`); failures++; }
  else console.log(`OK ${label}: ${JSON.stringify(actual)}`);
}

// Marzo 2026: 1 marzo è domenica -> la settimana S9 (23 feb - 1 mar) contribuisce solo con
// la domenica 1/3 al mese. 31 marzo è martedì -> S14 (30 mar - 5 apr) contribuisce solo con
// lun 30 e mar 31. Attese 6 settimane (S9..S14).
const rows = [
  { data: '2026-03-01', min: 480 }, // domenica, S9 (coda di febbraio)
  { data: '2026-03-02', min: 480 }, // lunedì S10
  { data: '2026-03-03', min: 480 },
  { data: '2026-03-04', min: 480 },
  { data: '2026-03-05', min: 480 },
  { data: '2026-03-06', min: 480 }, // venerdì S10 -> 5 giorni * 480 = 2400 (esatto 40h, niente straordinario)
  { data: '2026-03-09', min: 500 },
  { data: '2026-03-10', min: 500 },
  { data: '2026-03-11', min: 500 },
  { data: '2026-03-12', min: 500 },
  { data: '2026-03-13', min: 500 }, // S11: 5*500=2500 -> 100 min oltre soglia
  { data: '2026-03-30', min: 480 },
  { data: '2026-03-31', min: 480 }, // S14 (coda di marzo, inizio aprile)
];

const compareValues = (a, op, b) => op === '==' ? a === b : true;
const metric = { field: 'min', func: 'sum' };
const r = computeWeeklyBreakdown(rows, 'data', 2026, 3, metric, 2400, compareValues);

assertEqual(r.weeks.length, 6, 'numero settimane marzo 2026 (S9..S14)');
assertEqual(r.weeks[0].label, 'S9', 'prima settimana è S9 (coda di febbraio)');
assertEqual(r.weeks[0].value, 480, 'S9 ha solo la domenica 1/3 (480 min)');
assertEqual(r.weeks[1].label, 'S10', 'seconda settimana è S10');
assertEqual(r.weeks[1].value, 2400, 'S10: 5 giorni da 480min = 2400 (40h esatte)');
assertEqual(r.weeks[2].value, 2500, 'S11: 5 giorni da 500min = 2500');
assertEqual(r.weeks[5].label, 'S14', 'ultima settimana è S14 (coda di marzo)');
assertEqual(r.weeks[5].value, 960, 'S14 ha solo lun 30 + mar 31 (2*480)');
assertEqual(r.total, 480 + 2400 + 2500 + 0 + 0 + 960, 'totale mese = somma di tutte le settimane restituite');
assertEqual(r.overThresholdTotal, 100, 'straordinari = solo S11 supera 2400 (di 100 min), le altre no');

// Nessuna soglia -> overThresholdTotal è null, non 0 (distingue "non richiesto" da "zero extra").
const r2 = computeWeeklyBreakdown(rows, 'data', 2026, 3, metric, null, compareValues);
assertEqual(r2.overThresholdTotal, null, 'senza soglia, overThresholdTotal è null');

// Mese senza alcun record: 0 settimane con dati, ma le settimane del mese esistono comunque
// (weeks.length riflette il calendario, i valori sono solo 0).
const r3 = computeWeeklyBreakdown([], 'data', 2026, 3, metric, 2400, compareValues);
assertEqual(r3.weeks.length, 6, 'mese vuoto: comunque 6 settimane, tutte a 0');
assertEqual(r3.total, 0, 'mese vuoto: totale 0');
assertEqual(r3.overThresholdTotal, 0, 'mese vuoto: nessuno straordinario');

if (failures > 0) { console.error(`\n${failures} test falliti.`); process.exit(1); }
console.log('\nTutti i test di weekly-breakdown sono passati.');
