// Riepilogo dei piani (vista «genitori con figli») raggruppato per un campo del genitore, di solito il creditore:
// per ogni gruppo quanti piani aperti, quante rate restano e quanto resta da pagare. I piani saldati non contano.
// `righe` = le righe della vista ({ __id, residuo, n_children, n_done }), `perId` = i record del genitore per id,
// `chiave` = il campo da raggruppare, `saldato(riga)` = true per un piano chiuso.
export function riepilogoPerGruppo(righe, perId, chiave, saldato) {
  const gruppi = {}
  ;(righe || []).forEach((p) => {
    if (saldato && saldato(p)) return
    const rec = perId && perId[p.__id]
    const valore = rec && rec.data ? rec.data[chiave] : null
    const nome = valore === undefined || valore === null ? '' : String(valore).trim()
    if (!nome) return
    const g = gruppi[nome] || (gruppi[nome] = { nome, piani: 0, rate: 0, residuo: 0 })
    g.piani += 1
    g.rate += Math.max(0, (p.n_children || 0) - (p.n_done || 0))
    g.residuo += Number(p.residuo) || 0
  })
  return Object.values(gruppi)
    .map((g) => ({ ...g, residuo: Math.round(g.residuo * 100) / 100 }))
    .sort((a, b) => b.residuo - a.residuo || a.nome.localeCompare(b.nome))
}
