'use strict';

// Lista di record "genitore" con un riepilogo dei loro figli (conteggio fatti/totali,
// residuo, elenco figli ordinato per uno stato "fatto/non fatto") — es. PianiRateali:
// ogni Debito è un genitore, le sue Rate sono i figli (righe di spesa collegate),
// mostrate come pallini numerati con lo stato di pagamento. Motore puro (nessuna query
// db), stesso pattern di distance-buckets.js/financial-statement.js: la route risolve i
// dati, questo modulo fa solo l'aritmetica.
//
// parents: [{ __id, ...data }], childrenByParent: Map(parentId -> [{ __id, ...data }])
// già ordinati per children_order_field da chi chiama.
function computeParentChildren(parents, childrenByParent, config) {
  return parents.map((p) => {
    const children = childrenByParent.get(p.__id) || [];
    const done = children.filter((c) => c[config.children_status_field] === config.children_status_done_value);
    const totale = Number(p[config.amount_field]) || 0;
    const importoFatto = done.reduce((s, c) => s + (Number(c[config.child_amount_field]) || 0), 0);
    const residuo = Math.max(0, totale - importoFatto);
    const pct = children.length > 0 ? Math.round((done.length / children.length) * 100) : 0;
    return {
      __id: p.__id, totale, residuo, pct,
      n_children: children.length, n_done: done.length,
      children: children.map((c) => ({ __id: c.__id, done: c[config.children_status_field] === config.children_status_done_value })),
    };
  }).filter((p) => p.n_children > 0);
}

module.exports = { computeParentChildren };
