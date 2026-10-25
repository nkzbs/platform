import React, { useEffect, useState } from 'react'
import useApi from '../lib/useApi'
import Icon from './Icon'

// "Sincronizza Drive": non aspettare il giro automatico di 15 minuti del
// poller (richiesto dall'utente il 25/10/2026: "un tasto aggiorna nei
// documenti per forzare il sync"). Generico come BustaPagaReportView: si
// mostra solo se QUESTO modulo è davvero quello che drive-poller.js gestisce.
export default function DriveSyncButton({ token, mod, onSynced }) {
  const api = useApi(token)
  const [attivo, setAttivo] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let vivo = true
    api.get('/drive-poller/status').then((d) => { if (vivo && d) setAttivo(!!d.disponibile && d.modulo === mod.slug) })
    return () => { vivo = false }
  }, [mod.slug]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!attivo) return null

  const sync = async () => {
    setBusy(true)
    const r = await api.post('/drive-poller/sync', {})
    setBusy(false)
    if (!r.ok || !r.data || r.data.errore || r.data.disponibile === false) {
      const msg = (r.data && (r.data.error || r.data.errore)) || 'Sincronizzazione fallita'
      window.dispatchEvent(new CustomEvent('platform:toast', { detail: { message: msg, type: 'error' } }))
      return
    }
    const { importati = 0, spostati = 0 } = r.data
    const msg = importati || spostati
      ? 'Drive sincronizzato: ' + (importati ? importati + ' nuovo/i' : '') + (importati && spostati ? ', ' : '') + (spostati ? spostati + ' riordinato/i' : '')
      : 'Drive sincronizzato: nessuna novità'
    window.dispatchEvent(new CustomEvent('platform:toast', { detail: { message: msg, type: 'success' } }))
    if (importati && onSynced) onSynced()
  }

  return (
    <button onClick={sync} disabled={busy} className="bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-400 hover:text-gray-200 px-3 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2" title="Controlla subito se ci sono file nuovi su Drive">
      <Icon name="refresh" size={14} className={busy ? 'animate-spin' : ''} />{busy ? 'Sincronizzo…' : 'Sincronizza Drive'}
    </button>
  )
}
