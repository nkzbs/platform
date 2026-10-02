'use strict';

// Pivot: una riga per valore di un campo (es. categoria), una colonna per anno — con
// delta% tra i due anni più recenti — es. ReportFinancePage "Anno su anno" (2 anni) e
// "Storico utenze" (N anni). Motore puro, riusa periodBounds/aggregateMetric di
// period-view.js.
const { periodBounds, aggregateMetric } = require('./period-view');

// rows: TUTTI i record del modulo (già con {__id, ...data}, già filtrati dai filtri di
// blocco). years: array di anni DAL PIÙ RECENTE al più vecchio (es. [2026, 2025]).
function computeCategoryPivot(rows, dateField, groupByField, metric, years, compareValues) {
  const byYear = years.map((y) => {
    const bounds = periodBounds('anno', { y });
    return rows.filter((r) => { const d = r[dateField]; return d && d >= bounds.from && d <= bounds.to; });
  });

  const categoriesSet = new Set();
  rows.forEach((r) => { const v = r[groupByField]; if (v !== undefined && v !== null && v !== '') categoriesSet.add(String(v)); });

  const categories = [...categoriesSet].map((cat) => {
    const values = years.map((y, i) => {
      const inYearAndCat = byYear[i].filter((r) => String(r[groupByField]) === cat);
      return { year: y, value: aggregateMetric(inYearAndCat, metric, compareValues) };
    });
    const latest = values[0] ? values[0].value : 0;
    const previous = values[1] ? values[1].value : null;
    const deltaPct = previous !== null && previous !== 0 ? Math.round(((latest - previous) / previous) * 100) : (previous === 0 && latest > 0 ? 100 : null);
    return { category: cat, values, deltaPct };
  })
    .filter((c) => c.values.some((v) => v.value !== 0))
    .sort((a, b) => b.values[0].value - a.values[0].value);

  return { years, categories };
}

module.exports = { computeCategoryPivot };
