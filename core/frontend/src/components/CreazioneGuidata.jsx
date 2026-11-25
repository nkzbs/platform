import React, { useState, useEffect } from 'react'
import useApi from '../lib/useApi'
import Portal from './Portal'

// «Creazione guidata» di un modulo (blocco `creazione_guidata`, si imposta dal Builder). Due pezzi:
//  - SceltaNuovo: premendo «Nuovo», prima si sceglie se partire da un modulo PDF o inserire a mano;
//  - ProponiCollegato: dopo la creazione, «Vuoi creare già una trattativa?» (per ogni regola di `dopo`). Sì crea la scheda collegata e ci porta
//    nel suo modulo; No non fa niente. Nessun nome di modulo o di campo qui: tutto viene dal blocco.

const Finestra = ({ children }) => (
  <Portal>
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-surface-card rounded-md p-6 w-full max-w-md border border-gray-800">{children}</div>
    </div>
  </Portal>
)

export function SceltaNuovo({ nome, onPdf, onManuale, onAnnulla }) {
  return (
    <Finestra>
      <h2 className="text-base font-bold text-ink mb-1">Nuova scheda — {nome}</h2>
      <div className="text-sm text-gray-400 mb-4">Come vuoi partire?</div>
      <div className="space-y-2">
        <button type="button" onClick={onPdf} className="w-full text-left bg-gray-800 hover:bg-gray-700 rounded-lg px-4 py-3 transition">
          <div className="text-sm font-medium text-ink">Da modulo PDF</div>
          <div className="text-xs text-gray-400">Carichi il modulo dell'agenzia compilato: i dati si compilano da soli</div>
        </button>
        <button type="button" onClick={onManuale} className="w-full text-left bg-gray-800 hover:bg-gray-700 rounded-lg px-4 py-3 transition">
          <div className="text-sm font-medium text-ink">Inserimento a mano</div>
          <div className="text-xs text-gray-400">Compili tu i campi</div>
        </button>
      </div>
      <button type="button" onClick={onAnnulla} className="mt-4 w-full text-sm text-gray-400 hover:text-ink">Annulla</button>
    </Finestra>
  )
}

// Il campo che collega la scheda nuova: fisso (`campo`) oppure scelto da un valore della scheda appena creata (`per_valore`: { campo, mappa, predefinito }).
export function campoDiCollegamento(regola, dati) {
  const pv = regola.per_valore
  if (pv && pv.campo) return (pv.mappa || {})[dati && dati[pv.campo]] || pv.predefinito || regola.campo || ''
  return regola.campo || ''
}
export function titoloProposto(regola, dati) {
  const nome = (dati && (dati.nome || dati.titolo)) || Object.values(dati || {}).find((v) => typeof v === 'string' && v.trim()) || ''
  return String(regola.titolo || '{nome}').replace('{nome}', nome).trim()
}

export function ProponiCollegato({ token, mod, recordId, regole, onNavigate, onChiudi }) {
  const api = useApi(token)
  const [dati, setDati] = useState(null)
  const [i, setI] = useState(0)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => { api.get('/records/' + mod.slug + '/' + recordId).then((r) => setDati((r && r.data) || {})) }, [recordId]) // eslint-disable-line react-hooks/exhaustive-deps
  const regola = regole[i]
  if (!regola || !dati) return null
  const prossima = () => { setErr(''); if (i + 1 < regole.length) setI(i + 1); else onChiudi() }
  const si = async () => {
    setBusy(true); setErr('')
    const campo = campoDiCollegamento(regola, dati)
    const corpo = { [regola.campo_titolo || 'titolo']: titoloProposto(regola, dati), ...(campo ? { [campo]: recordId } : {}) }
    const r = await api.post('/records/' + regola.modulo, corpo)
    setBusy(false)
    if (!r.ok) { setErr((r.data && r.data.error) || 'Non sono riuscito a crearla.'); return }
    window.dispatchEvent(new CustomEvent('platform:toast', { detail: { message: 'Scheda creata', type: 'success' } }))
    onChiudi(); if (onNavigate) onNavigate(regola.modulo)
  }
  return (
    <Finestra>
      <h2 className="text-base font-bold text-ink mb-4">{regola.domanda || 'Vuoi creare già una scheda collegata?'}</h2>
      {err && <div className="text-sm text-red-400 bg-red-900/20 border border-red-900/40 rounded-lg p-3 mb-3">{err}</div>}
      <div className="flex gap-3">
        <button type="button" onClick={prossima} disabled={busy} className="flex-1 bg-gray-800 hover:bg-gray-700 text-ink py-2.5 rounded-lg text-sm transition">No, grazie</button>
        <button type="button" onClick={si} disabled={busy} className="flex-1 bg-accent hover:opacity-90 disabled:opacity-50 text-white py-2.5 rounded-lg text-sm font-medium transition">{busy ? 'Creo…' : 'Sì, crea'}</button>
      </div>
    </Finestra>
  )
}
