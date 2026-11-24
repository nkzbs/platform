// Lo stile grafico di Super Admin (Classico / Bento pastello / Bento vetro). Super Admin non ha un'azienda con impostazioni salvate sul server:
// la scelta resta in questo browser (localStorage), e si applica come nei tenant: data-stile sull'elemento radice (CSS in shared/frontend/stile-bento.css).
const CHIAVE = 'sa_stile'
const AMMESSI = ['bento_pastello', 'bento_vetro']
export const leggiStile = () => { try { const v = localStorage.getItem(CHIAVE); return AMMESSI.includes(v) ? v : '' } catch (e) { return '' } }
export const applicaStile = (stile) => { if (AMMESSI.includes(stile)) document.documentElement.dataset.stile = stile; else delete document.documentElement.dataset.stile }
export const salvaStile = (stile) => { try { if (stile) localStorage.setItem(CHIAVE, stile); else localStorage.removeItem(CHIAVE) } catch (e) { /* senza memoria locale vale solo per questa visita */ } applicaStile(stile) }
export const STILI = [
  { chiave: '', nome: 'Classico', nota: "Com'è sempre stato: riquadri scuri o chiari con bordo sottile.", colori: [] },
  { chiave: 'bento_pastello', nome: 'Bento pastello', nota: 'Riquadri morbidi e pieni, una tinta tenue per ogni tipo.', colori: ['#d6efff', '#e3dcff', '#ffe3d2', '#d8f4df', '#fff0b8', '#ffd9ea'] },
  { chiave: 'bento_vetro', nome: 'Bento vetro', nota: 'Riquadri trasparenti su uno sfondo sfumato.', colori: ['#9fd8ff', '#c3b0ff', '#ffc9a8', '#a6ecc0', '#ffe27a', '#ffa9cf'] },
]
