'use strict';
// «Eredita» da una relazione (proprietà `eredita` del blocco relazione: { campo_mio: campo_del_record_collegato }): quando scegli il record collegato e il tuo campo è vuoto,
// lo compila con quello del record collegato (es. un'attività legata a una trattativa prende l'immobile e il cliente della trattativa). Mai sopra un valore già scritto.
// Si applica quando il record viene creato o salvato dal server; una relazione verso un record che non esiste non fa nulla.
const vuoto = (v) => v === undefined || v === null || v === '';
function applicaEredita(db, schema, dati) {
  const out = { ...dati };
  for (const r of (schema && schema.relations) || []) {
    if (!r.eredita || typeof r.eredita !== 'object' || vuoto(out[r.key]) || !r.target_module) continue;
    const rec = db.prepare('SELECT data FROM records WHERE id = ? AND module_slug = ?').get(out[r.key], r.target_module);
    if (!rec) continue;
    let d; try { d = JSON.parse(rec.data); } catch (e) { continue; }
    for (const [mio, loro] of Object.entries(r.eredita)) if (vuoto(out[mio]) && !vuoto(d[loro])) out[mio] = d[loro];
  }
  return out;
}
module.exports = { applicaEredita };
