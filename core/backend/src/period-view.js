'use strict';

// Vista navigabile per periodo (mese o anno) — es. SpeseFinancePage (mese corrente,
// avanti/indietro), ReportFinancePage (anno corrente vs precedente). Motore puro (nessuna
// query db), stesso pattern di distance-buckets.js/financial-statement.js: la route risolve
// i dati, questo modulo fa solo l'aritmetica.

// Settimana ISO (lunedì-domenica, la settimana che contiene il 4 gennaio è sempre la
// settimana 1 — definizione standard ISO 8601). Calcolata via date UTC per evitare
// spostamenti di fuso orario sui confini di giorno.
function fmtDate(d) {
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
}
function isoWeekMonday(y, w) {
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const jan4Dow = (jan4.getUTCDay() + 6) % 7; // lunedì=0..domenica=6
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - jan4Dow);
  const monday = new Date(week1Monday);
  monday.setUTCDate(week1Monday.getUTCDate() + (w - 1) * 7);
  return monday;
}
// Da una data qualunque, l'anno/settimana ISO a cui appartiene — il giovedì della sua
// settimana determina l'anno ISO (stesso motivo per cui il 4 gennaio è sempre in
// settimana 1: il 4 gennaio cade sempre entro il primo giovedì dell'anno).
function dateToIsoYearWeek(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // sposta al giovedì della stessa settimana
  const isoYear = d.getUTCFullYear();
  const week1Monday = isoWeekMonday(isoYear, 1);
  const week = Math.round((d.getTime() - week1Monday.getTime()) / (7 * 86400000)) + 1;
  return { y: isoYear, w: week };
}
function shiftWeek(period, weeks) {
  const monday = isoWeekMonday(period.y, period.w);
  monday.setUTCDate(monday.getUTCDate() + weeks * 7);
  return dateToIsoYearWeek(monday);
}

// period: {y, m} per 'mese' (m 1-12), {y} per 'anno', {y, w} per 'settimana' (settimana
// ISO). Ritorna i bound YYYY-MM-DD (stringa, confrontabile lessicograficamente come tutte
// le date ISO di questo motore) e un'etichetta.
function periodBounds(granularity, period) {
  if (granularity === 'anno') {
    return { from: period.y + '-01-01', to: period.y + '-12-31', label: String(period.y) };
  }
  if (granularity === 'settimana') {
    const monday = isoWeekMonday(period.y, period.w);
    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);
    return { from: fmtDate(monday), to: fmtDate(sunday), label: 'S' + period.w + ' ' + period.y };
  }
  const mm = String(period.m).padStart(2, '0');
  const lastDay = new Date(period.y, period.m, 0).getDate();
  return { from: period.y + '-' + mm + '-01', to: period.y + '-' + mm + '-' + String(lastDay).padStart(2, '0'), label: mm + '/' + period.y };
}

// Periodo immediatamente precedente della stessa lunghezza (mese scorso, anno scorso,
// settimana ISO scorsa).
function previousPeriod(granularity, period) {
  if (granularity === 'anno') return { y: period.y - 1 };
  if (granularity === 'settimana') return shiftWeek(period, -1);
  if (period.m === 1) return { y: period.y - 1, m: 12 };
  return { y: period.y, m: period.m - 1 };
}

function shiftPeriod(granularity, period, dir) {
  if (granularity === 'anno') return { y: period.y + dir };
  if (granularity === 'settimana') return shiftWeek(period, dir);
  let m = period.m + dir, y = period.y;
  if (m < 1) { m = 12; y -= 1; }
  if (m > 12) { m = 1; y += 1; }
  return { y, m };
}

function aggregateOne(rows, field, func) {
  if (func === 'count') return rows.length;
  const vals = rows.map((r) => Number(r[field]) || 0);
  if (func === 'avg') return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  return vals.reduce((a, b) => a + b, 0); // sum, default
}

// Ogni metrica può avere un filtro proprio, IN AGGIUNTA ai filtri del blocco (già
// applicati a monte da chi chiama) — es. "Totale" (tutte le righe) e "Pagato" (solo
// _stato=pagato) nello stesso periodo, senza due blocchi period_view separati (un
// modulo ne ammette uno solo). compareValues iniettata dal chiamante (vive in
// formula.js, evitare una dipendenza circolare qui).
function aggregateMetric(rows, metric, compareValues) {
  const scoped = metric.filter ? rows.filter((r) => compareValues(r[metric.filter.field], metric.filter.op || '==', metric.filter.value)) : rows;
  return aggregateOne(scoped, metric.field, metric.func || 'sum');
}

// rows: TUTTI i record del modulo (già con {__id, ...data}, già filtrati dai filtri di
// blocco) — filtra qui solo per periodo. metricsConfig: [{key,label,field,func,format,filter}].
function computePeriodView(rows, dateField, granularity, period, metricsConfig, comparePrevious, compareValues) {
  const { from, to, label } = periodBounds(granularity, period);
  const inPeriod = rows.filter((r) => { const d = r[dateField]; return d && d >= from && d <= to; });
  const metrics = (metricsConfig || []).map((m) => ({ key: m.key, label: m.label, format: m.format || 'number', value: aggregateMetric(inPeriod, m, compareValues) }));

  let compareMetrics = null, compareLabel = null;
  if (comparePrevious) {
    const prevPeriod = previousPeriod(granularity, period);
    const prevBounds = periodBounds(granularity, prevPeriod);
    const inPrev = rows.filter((r) => { const d = r[dateField]; return d && d >= prevBounds.from && d <= prevBounds.to; });
    compareMetrics = (metricsConfig || []).map((m) => ({ key: m.key, label: m.label, format: m.format || 'number', value: aggregateMetric(inPrev, m, compareValues) }));
    compareLabel = prevBounds.label;
  }

  return { label, metrics, compareLabel, compareMetrics, rows: inPeriod };
}

module.exports = { periodBounds, previousPeriod, shiftPeriod, computePeriodView, isoWeekMonday, dateToIsoYearWeek, aggregateMetric };
