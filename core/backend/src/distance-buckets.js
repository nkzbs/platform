'use strict';

// Raggruppa record per "distanza in giorni" da oggi rispetto a un campo data — es.
// Scadenzario (giorni alla scadenza: scadute/entro 7/entro 30/oltre 30). Motore puro
// (nessuna query db), stesso pattern di reconciliation.js/financial-statement.js: la
// route risolve i dati, questo modulo fa solo l'algoritmo di bucketing.
//
// bucketsConfig: [{ key, label, max_days }] IN ORDINE — il primo bucket il cui max_days
// è >= giorni vince; l'ultimo elemento può omettere max_days (o metterlo null) come
// catch-all "oltre tutti gli altri". "giorni" è (data - oggi) in giorni: negativo se nel
// passato (scaduto).
function assignBucket(giorni, bucketsConfig) {
  if (giorni === null) return null;
  for (const b of bucketsConfig) {
    if (b.max_days === null || b.max_days === undefined) return b.key;
    if (giorni <= b.max_days) return b.key;
  }
  return null;
}

// rows: [{ __id, giorni, metricValue }] già risolti dalla route (giorni già calcolato,
// filtri già applicati). Ritorna { buckets: [{key,label,count,total}], rows: [...con bucket]} }
function computeDistanceBuckets(rows, bucketsConfig, metricFormat) {
  const counts = {};
  const totals = {};
  bucketsConfig.forEach((b) => { counts[b.key] = 0; totals[b.key] = 0; });

  const withBucket = rows.map((r) => {
    const bucketKey = assignBucket(r.giorni, bucketsConfig);
    if (bucketKey) {
      counts[bucketKey] = (counts[bucketKey] || 0) + 1;
      totals[bucketKey] = (totals[bucketKey] || 0) + (Number(r.metricValue) || 0);
    }
    return { ...r, bucket: bucketKey };
  }).sort((a, b) => (a.giorni ?? Infinity) - (b.giorni ?? Infinity));

  const buckets = bucketsConfig.map((b) => ({ key: b.key, label: b.label, count: counts[b.key] || 0, total: totals[b.key] || 0 }));
  return { buckets, rows: withBucket, format: metricFormat || 'number' };
}

module.exports = { assignBucket, computeDistanceBuckets };
