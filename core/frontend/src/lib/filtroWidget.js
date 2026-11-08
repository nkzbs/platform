// Il filtro dei widget della Dashboard (Percorso, Segnali, Contatori) e dell'elenco di un modulo è LO STESSO: un widget conta i record che passano il filtro, e il clic apre il modulo con
// quel filtro già applicato, così il numero del riquadro e le righe dell'elenco coincidono sempre. Nessun nome di modulo né di campo scritto qui: arrivano dal widget.
//   filtro: { campo, op, valore }   campo = chiave di un campo (o `_stato` per lo stato del flusso)
//   op: '=' | '!=' | 'vuoto' | 'non_vuoto' | 'scaduto' (data passata) | 'entro_giorni' (da oggi a oggi + valore giorni) | 'questo_mese' | '<' | '>' (numeri)
export const oggiIso = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') }
const giorniDa = (iso, n) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') }
const vuoto = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)

export const OPERATORI = [
  ['=', 'è uguale a'], ['!=', 'è diverso da'], ['vuoto', 'è vuoto'], ['non_vuoto', 'è compilato'],
  ['scaduto', 'è una data passata'], ['entro_giorni', 'è entro N giorni'], ['questo_mese', 'è in questo mese'], ['<', 'è minore di'], ['>', 'è maggiore di'],
]

export function corrisponde(record, filtro, oggi = oggiIso()) {
  if (!filtro || !filtro.campo) return true
  const d = (record && record.data) || {}
  const v = d[filtro.campo]
  const data = String(v || '').slice(0, 10)
  switch (filtro.op) {
    case '=': return Array.isArray(v) ? v.map(String).includes(String(filtro.valore)) : String(v) === String(filtro.valore)
    case '!=': return Array.isArray(v) ? !v.map(String).includes(String(filtro.valore)) : String(v) !== String(filtro.valore)
    case 'vuoto': return vuoto(v)
    case 'non_vuoto': return !vuoto(v)
    case 'scaduto': return /^\d{4}-\d{2}-\d{2}$/.test(data) && data < oggi
    case 'entro_giorni': return /^\d{4}-\d{2}-\d{2}$/.test(data) && data >= oggi && data <= giorniDa(oggi, Number(filtro.valore) || 0)
    case 'questo_mese': return data.slice(0, 7) === oggi.slice(0, 7)
    case '<': return !vuoto(v) && parseFloat(v) < parseFloat(filtro.valore)
    case '>': return !vuoto(v) && parseFloat(v) > parseFloat(filtro.valore)
    default: return true
  }
}
// Una voce può avere più condizioni insieme (tutte vere): `filtri` è un elenco; `filtro` ne è uno solo.
export const elencoFiltri = (voce) => (Array.isArray(voce && voce.filtri) ? voce.filtri : voce && voce.filtro ? [voce.filtro] : [])
export const passaTutti = (record, filtri, oggi) => filtri.every((f) => corrisponde(record, f, oggi))

// Il clic su un widget: ricorda il filtro e apre il modulo; il modulo lo legge una volta sola (`leggiApertura`).
const CHIAVE = 'nav_apri'
export function apriModulo(onNavigate, slug, filtri = []) {
  try { sessionStorage.setItem(CHIAVE, JSON.stringify({ slug, filtri })) } catch (e) { /* senza storage si apre il modulo senza filtro */ }
  if (onNavigate) onNavigate(slug)
}
export function leggiApertura(slug) {
  try {
    const raw = sessionStorage.getItem(CHIAVE)
    if (!raw) return null
    const x = JSON.parse(raw)
    if (!x || x.slug !== slug) return null
    sessionStorage.removeItem(CHIAVE)
    return Array.isArray(x.filtri) ? x.filtri : []
  } catch (e) { return null }
}
