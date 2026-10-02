'use strict';

// Tabella con tutti e 12 i mesi di un anno, ciascuno con le sue metriche — opzionalmente
// affiancate allo stesso mese dell'anno precedente (anno-su-anno) — es. ReportFinancePage,
// tab "Riepilogo mensile". Diverso da period_view (che mostra UN periodo attivo + il
// precedente adiacente): qui i 12 mesi convivono nella stessa risposta, serve per una vera
// tabella/grafico "mese per mese", non per la navigazione avanti/indietro. Riusa
// periodBounds/aggregateMetric di period-view.js — stessa aritmetica, vista diversa.
const { periodBounds, aggregateMetric } = require('./period-view');

const MESI = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];

// rows: TUTTI i record del modulo (già con {__id, ...data}, già filtrati dai filtri di
// blocco). metricsConfig: [{key,label,field,func,format,filter}].
function computeYearlyBreakdown(rows, dateField, year, metricsConfig, comparePreviousYear, compareValues) {
  const rowsInBounds = (bounds) => rows.filter((r) => { const d = r[dateField]; return d && d >= bounds.from && d <= bounds.to; });

  const months = MESI.map((label, i) => {
    const m = i + 1;
    const bounds = periodBounds('mese', { y: year, m });
    const inMonth = rowsInBounds(bounds);
    const metrics = (metricsConfig || []).map((mc) => ({ key: mc.key, label: mc.label, format: mc.format || 'number', value: aggregateMetric(inMonth, mc, compareValues) }));
    let compareMetrics = null;
    if (comparePreviousYear) {
      const prevBounds = periodBounds('mese', { y: year - 1, m });
      const inPrevMonth = rowsInBounds(prevBounds);
      compareMetrics = (metricsConfig || []).map((mc) => ({ key: mc.key, label: mc.label, format: mc.format || 'number', value: aggregateMetric(inPrevMonth, mc, compareValues) }));
    }
    return { m, label, metrics, compareMetrics };
  });

  const sumAcrossMonths = (getter) => (metricsConfig || []).map((mc, i) => ({
    key: mc.key, label: mc.label, format: mc.format || 'number',
    value: months.reduce((s, mo) => s + (getter(mo) ? getter(mo)[i].value : 0), 0),
  }));
  const totals = sumAcrossMonths((mo) => mo.metrics);
  const compareTotals = comparePreviousYear ? sumAcrossMonths((mo) => mo.compareMetrics) : null;

  return { year, months, totals, compareTotals };
}

module.exports = { computeYearlyBreakdown, MESI };
