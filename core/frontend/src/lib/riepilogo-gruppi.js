// Riepiloghi «da pagare» raggruppati: dei piani per creditore o categoria (vista «genitori con figli») e delle spese per categoria o mese.

const norm = (v) => String(v == null ? '' : v).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
export const normalizza = norm

// Dei piani (vista «genitori con figli») raggruppati per un campo del genitore, di solito il creditore:
// per ogni gruppo quanti piani aperti, quante rate restano e quanto resta da pagare. I piani saldati non contano.
// `righe` = le righe della vista ({ __id, residuo, n_children, n_done }), `perId` = i record del genitore per id,
// `chiave` = il campo da raggruppare, `saldato(riga)` = true per un piano chiuso,
// `traduci(valore)` (facoltativa) = cambia il valore prima di raggruppare (es. dal creditore alla categoria del fornitore); un risultato vuoto va in «Senza categoria».
export function riepilogoPerGruppo(righe, perId, chiave, saldato, traduci, vuoto) {
  const gruppi = {}
  ;(righe || []).forEach((p) => {
    if (saldato && saldato(p)) return
    const rec = perId && perId[p.__id]
    const valore = rec && rec.data ? rec.data[chiave] : null
    let nome = valore === undefined || valore === null ? '' : String(valore).trim()
    if (traduci) { if (!nome) return; nome = String(traduci(nome) || '').trim() || vuoto || 'Senza categoria' }
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

// Mappa «nome normalizzato → valore» da un elenco di record (es. i Fornitori: nome → categoria), per tradurre un creditore nella sua categoria.
export function mappaDaElenco(records, campoNome, campo) {
  const m = {}
  ;(records || []).forEach((r) => {
    const n = r && r.data ? norm(r.data[campoNome]) : ''
    const v = r && r.data ? String(r.data[campo] || '').trim() : ''
    if (n && v && !m[n]) m[n] = v
  })
  return m
}

const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre']
const nomeMese = (iso) => { const m = /^(\d{4})-(\d{2})/.exec(String(iso || '')); return m ? MESI[parseInt(m[2], 10) - 1] + ' ' + m[1] : '' }

// Le spese ancora da pagare, raggruppate. `q` = quali campi sono lo stato, l'importo, la categoria e la data (ruoli del modulo), `quale` = 'categoria' | 'mese'.
// Ritorna [{ nome, n, totale, ordine }]: per categoria dal più alto al più basso, per mese in ordine di tempo.
export function raggruppaDaPagare(records, q, quale) {
  const gruppi = {}
  ;(records || []).forEach((r) => {
    const d = r && r.data
    if (!d || d[q.stato] !== q.da_fare) return
    const importo = Number(d[q.importo]) || 0
    let nome, ordine = ''
    if (quale === 'mese') { nome = nomeMese(d[q.data]) || 'Senza data'; ordine = String(d[q.data] || '9999').slice(0, 7) } else { nome = String(d[q.categoria] || '').trim() || 'Senza categoria' }
    const g = gruppi[nome] || (gruppi[nome] = { nome, n: 0, totale: 0, ordine })
    g.n += 1; g.totale += importo
  })
  const out = Object.values(gruppi).map((g) => ({ ...g, totale: Math.round(g.totale * 100) / 100 }))
  return quale === 'mese' ? out.sort((a, b) => a.ordine.localeCompare(b.ordine)) : out.sort((a, b) => b.totale - a.totale || a.nome.localeCompare(b.nome))
}
