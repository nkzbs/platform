// Ciò che la guida di un modulo può dire SENZA testo scritto a mano: lo ricava dallo schema (stessa fonte della scheda), quindi non invecchia.
// `schema` è l'esito di parseSchemaFrontend: { fields, relations, workflow, document_actions, external_actions, state_requirements }.
export function daSchema(schema) {
  const s = schema || {}
  const campi = [...(s.fields || []), ...(s.relations || [])]
  const etichetta = (k) => { const c = campi.find((x) => x.key === k); return (c && c.label) || k }
  const stati = (s.workflow && s.workflow.states) || []
  const trans = (s.workflow && s.workflow.transitions) || []
  const nomeStato = (k) => { const x = stati.find((y) => y.key === k); return (x && x.label) || k }

  // Il percorso: dallo stato iniziale seguendo la prima uscita non ancora visitata (i «Riprogramma / Annulla» che tornano indietro non allungano il percorso).
  const percorso = []
  let cur = stati.find((x) => x.initial) || stati[0]
  while (cur && !percorso.includes(cur.key)) {
    percorso.push(cur.key)
    const avanti = trans.find((t) => t.from === cur.key && !percorso.includes(t.to))
    cur = avanti ? stati.find((x) => x.key === avanti.to) : null
  }
  for (const x of stati) if (!percorso.includes(x.key)) percorso.push(x.key)

  const passaggi = (s.state_requirements || []).filter((b) => b.stato && (b.requisiti || []).length).map((b) => ({
    stato: nomeStato(b.stato), bloccante: !!b.bloccante,
    servono: b.requisiti.map((r) => r.label || (r.tipo === 'campo' ? etichetta(r.campo) : r.tipo === 'uno_di' ? (r.campi || []).map(etichetta).join(' o ') : r.valore || 'allegato')),
  }))
  return {
    percorso: percorso.map(nomeStato),
    datiChiave: (s.fields || []).filter((f) => f.dato_chiave).map((f) => f.label || f.key),
    passaggi,
    documenti: (s.document_actions || []).map((d) => d.label).filter(Boolean),
    azioni: (s.external_actions || []).map((a) => ({ label: a.label, daAttivare: a.adapter === 'da_attivare', servizio: a.servizio_richiesto || '', descrizione: a.descrizione || '' })),
    calendario: !!(s.calendar_views && s.calendar_views.length),
  }
}
