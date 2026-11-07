// I REQUISITI PER STATO: cosa serve a un record per passare a un certo stato del flusso, dichiarato nello schema del modulo (blocco `state_requirements`) e non nel codice.
// Funzioni pure, usate sia dal server (che può impedire il passaggio se il blocco è `bloccante`) sia dalla scheda (che mostra «per passare a… manca»).
//   blocco:     { block_type: 'state_requirements', stato: <chiave dello stato di arrivo>, bloccante: bool, requisiti: [ ... ] }
//   requisito:  { label, tipo: 'campo', campo }                 il campo (anche una relazione o un esito salvato sul record) ha un valore
//               { label, tipo: 'uno_di', campi: [..] }          almeno uno dei campi ha un valore
//               { label, tipo: 'allegato', valore }             il record ha un allegato di quel tipo
const pieno = (v) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0)

export function requisitoSoddisfatto(r, dati, allegati) {
  const d = dati || {}
  if (!r) return false
  if (r.tipo === 'campo') return pieno(d[r.campo])
  if (r.tipo === 'uno_di') return (Array.isArray(r.campi) ? r.campi : []).some((k) => pieno(d[k]))
  if (r.tipo === 'allegato') return (allegati || []).some((a) => a && a.tipo === r.valore)
  return false // un tipo che non conosco non si dà per soddisfatto
}

// I requisiti di UN blocco, con l'esito di ciascuno: [{ label, ok }]
export function valutaRequisiti(blocco, dati, allegati) {
  return ((blocco && blocco.requisiti) || []).map((r) => ({ label: r.label || '(requisito senza nome)', ok: requisitoSoddisfatto(r, dati, allegati) }))
}

// Il blocco che riguarda lo stato di arrivo (null se non ce n'è o non ha requisiti).
export function bloccoPerStato(blocchi, stato) {
  return (blocchi || []).find((b) => b && b.stato === stato && Array.isArray(b.requisiti) && b.requisiti.length) || null
}

// Per la scheda: per ogni passaggio possibile dallo stato attuale che ha requisiti, { stato, label, bloccante, voci: [{label, ok}], pronto }.
export function requisitiDallo(stato, workflow, blocchi, dati, allegati) {
  const out = [], visti = new Set()
  for (const t of ((workflow && workflow.transitions) || [])) {
    if (t.from !== stato || visti.has(t.to)) continue
    visti.add(t.to)
    const b = bloccoPerStato(blocchi, t.to)
    if (!b) continue
    const voci = valutaRequisiti(b, dati, allegati)
    const st = ((workflow && workflow.states) || []).find((x) => x.key === t.to)
    out.push({ stato: t.to, label: (st && st.label) || t.to, bloccante: !!b.bloccante, voci, pronto: voci.every((v) => v.ok) })
  }
  return out
}
