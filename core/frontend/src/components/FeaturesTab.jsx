import React, { useState, useEffect } from 'react'
import useApi from '../lib/useApi'

// Le funzioni facoltative del progetto (Suggerimenti, Report, Sito Web, WhatsApp...): spente, non compaiono nel menu né nelle schede.
// Qui si accendono e si spengono; cambiare non cancella niente (i dati restano, la funzione smette solo di farsi vedere e di lavorare).
export default function FeaturesTab({ token, onChanged }) {
  const api = useApi(token)
  const [lista, setLista] = useState(null)
  const [errore, setErrore] = useState('')
  const carica = () => api.get('/features').then((d) => Array.isArray(d) && setLista(d))
  useEffect(() => { carica() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const cambia = async (f) => {
    setErrore('')
    const r = await api.put('/features/' + f.key, { enabled: !f.enabled })
    if (!r.ok) { setErrore((r.data && r.data.error) || 'Non riuscito.'); return }
    setLista((l) => l.map((x) => (x.key === f.key ? { ...x, enabled: !f.enabled } : x)))
    if (onChanged) onChanged()
  }
  if (!lista) return <p className="text-sm text-gray-500">Carico…</p>
  return (
    <div className="max-w-2xl">
      <p className="text-sm text-gray-500 mb-4">Accendi solo ciò che ti serve. Spegnere una funzione non cancella i dati: la nasconde e la ferma.</p>
      {errore && <div className="text-xs text-amber-400 mb-3">{errore}</div>}
      <div className="divide-y divide-gray-800 glass-panel">
        {lista.map((f) => (
          <div key={f.key} className="flex items-start justify-between gap-4 p-4">
            <div className="min-w-0"><div className="text-ink text-sm font-medium">{f.label}</div><div className="text-xs text-gray-500 mt-0.5">{f.description}</div></div>
            <button onClick={() => cambia(f)} role="switch" aria-checked={f.enabled} aria-label={f.label}
              className={'relative w-11 h-6 rounded-full flex-shrink-0 transition ' + (f.enabled ? 'bg-accent' : 'bg-gray-700')}>
              <span className={'absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ' + (f.enabled ? 'left-[22px]' : 'left-0.5')} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
