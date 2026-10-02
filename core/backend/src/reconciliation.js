'use strict';

// Motore di riconciliazione a doppia lista — Primitiva J del piano "100% Builder".
// Stesso principio di formula-soglia.js: funzioni pure, nessuna dipendenza da db,
// testabili in isolamento. L'integrazione (lettura schema/record reali) è
// responsabilità del chiamante (routes/records.js).
//
// Generalizza RiconciliazioneBancariaPage.jsx: due liste (A = da riconciliare, B =
// candidati interni non ancora collegati), un'euristica di abbinamento (stesso
// importo+direzione, data più vicina), conferma manuale che scrive un collegamento
// su A (mai su B — B resta la fonte "di verità" dei movimenti interni).

const DAY_MS = 86400000;
function toDayCount(v) {
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  return Math.floor(d.getTime() / DAY_MS);
}

function getByPath(row, path) {
  // "campo" diretto, o "relazione.campo" per leggere dal record collegato via
  // many_to_one — stessa notazione già in uso per group_by di report_aggregate,
  // risolta dal chiamante (qui riceviamo già il valore, non la relazione).
  return row[path];
}

// Direzione di una riga A: 'entrata' o 'uscita', da un campo diretto (already signed:
// importo negativo=uscita) oppure da un campo di tipo select + lista di valori che
// contano come "entrata" (tutto il resto è uscita) — replica esattamente il pattern
// reale (TIPI_ENTRATA in RiconciliazioneBancariaPage.jsx).
function directionOfA(row, config) {
  if (config.direction_field) {
    const val = getByPath(row, config.direction_field);
    return (config.direction_positive_values || []).includes(val) ? 'entrata' : 'uscita';
  }
  const amount = parseFloat(getByPath(row, config.amount_field)) || 0;
  return amount >= 0 ? 'entrata' : 'uscita';
}

function amountOfA(row, config) {
  return Math.abs(parseFloat(getByPath(row, config.amount_field)) || 0);
}

// Riga B: importo e direzione da metric/metric_subtract (stessa convenzione già usata
// da report_aggregate — es. dare/avere di una riga di movimento contabile), il segno
// del risultato decide la direzione.
function amountAndDirectionOfB(row, config) {
  const metric = parseFloat(getByPath(row, config.metric)) || 0;
  const sub = config.metric_subtract ? (parseFloat(getByPath(row, config.metric_subtract)) || 0) : 0;
  const net = metric - sub;
  return { amount: Math.abs(net), direction: net >= 0 ? 'entrata' : 'uscita' };
}

// Suggerisce il miglior candidato B per una riga A: stesso importo (tolleranza fissa,
// coerente con la contabilità: differenze di centesimi non contano come "diverso") e
// stessa direzione, poi il più vicino per data. Nessun match -> null.
function suggestMatch(aRow, bCandidates, config) {
  const targetAmount = amountOfA(aRow, config.source_a);
  const targetDirection = directionOfA(aRow, config.source_a);
  const aDay = toDayCount(getByPath(aRow, config.source_a.date_field));
  const matches = bCandidates.filter((b) => {
    const { amount, direction } = amountAndDirectionOfB(b, config.source_b);
    return direction === targetDirection && Math.abs(amount - targetAmount) < 0.01;
  });
  if (matches.length === 0) return null;
  if (aDay === null) return matches[0];
  return matches.slice().sort((b1, b2) => {
    const d1 = toDayCount(getByPath(b1, config.source_b.date_field));
    const d2 = toDayCount(getByPath(b2, config.source_b.date_field));
    const dist1 = d1 === null ? Infinity : Math.abs(d1 - aDay);
    const dist2 = d2 === null ? Infinity : Math.abs(d2 - aDay);
    return dist1 - dist2;
  })[0];
}

module.exports = { directionOfA, amountOfA, amountAndDirectionOfB, suggestMatch, toDayCount };
