'use strict';

// Settimane ISO che ricadono in un mese, ciascuna con la sua metrica — es.
// TimbratureFinancePage, grafico "ore per settimana" + straordinari (soglia oltre le
// 40h/settimana). Diverso da yearly_breakdown (12 mesi fissi di UN anno): qui il numero
// di settimane per mese varia (4 o 5) e una settimana può iniziare nel mese
// precedente/finire nel successivo — le righe restano filtrate al mese PRIMA di essere
// raggruppate per settimana (stesso criterio della vecchia pagina: solo i giorni che
// ricadono davvero nel mese contano, anche se la loro settimana ISO no). Riusa
// periodBounds/aggregateMetric/isoWeekMonday/dateToIsoYearWeek di period-view.js.
const { periodBounds, aggregateMetric, isoWeekMonday, dateToIsoYearWeek } = require('./period-view');

// rows: TUTTI i record del modulo (già con {__id, ...data}, già filtrati dai filtri di
// blocco). metric: {field, func, filter?}. threshold: se presente (numero), calcola anche
// over_threshold_total = somma di max(0, valore_settimana - threshold) su tutte le
// settimane restituite.
function computeWeeklyBreakdown(rows, dateField, year, month, metric, threshold, compareValues) {
  const monthBounds = periodBounds('mese', { y: year, m: month });
  const inMonth = rows.filter((r) => { const d = r[dateField]; return d && d >= monthBounds.from && d <= monthBounds.to; });

  const first = new Date(Date.UTC(year, month - 1, 1));
  const last = new Date(Date.UTC(year, month, 0));
  let cursor = dateToIsoYearWeek(first);
  const weeks = [];
  let guard = 0;
  while (guard++ < 6) {
    const monday = isoWeekMonday(cursor.y, cursor.w);
    if (monday > last) break;
    const bounds = periodBounds('settimana', cursor);
    const inWeek = inMonth.filter((r) => { const d = r[dateField]; return d >= bounds.from && d <= bounds.to; });
    const value = aggregateMetric(inWeek, metric, compareValues);
    weeks.push({ year: cursor.y, week: cursor.w, label: 'S' + cursor.w, from: bounds.from, to: bounds.to, value });
    const nextMonday = new Date(monday);
    nextMonday.setUTCDate(nextMonday.getUTCDate() + 7);
    cursor = dateToIsoYearWeek(nextMonday);
  }

  const total = weeks.reduce((s, w) => s + w.value, 0);
  const overThresholdTotal = threshold != null ? weeks.reduce((s, w) => s + Math.max(0, w.value - threshold), 0) : null;
  return { year, month, weeks, total, overThresholdTotal };
}

module.exports = { computeWeeklyBreakdown };
