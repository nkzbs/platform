import React, { useState, useEffect } from 'react'
import useApi from '../lib/useApi'
import Icon from './Icon'

// Funzioni facoltative di questo progetto: spente non compaiono nel menu e non lavorano. Un progetto nuovo le ha tutte spente.
export default function FeaturesTab({ token, onChanged }) {
  const api = useApi(token)
  const [list, setList] = useState(null)
  const [busy, setBusy] = useState(null)

  const load = async () => { const d = await api.get('/features'); setList(Array.isArray(d) ? d : []) }
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = async (f) => {
    setBusy(f.key)
    const res = await api.put('/features/' + f.key, { enabled: !f.enabled })
    setBusy(null)
    if (res.ok) { await load(); if (onChanged) onChanged() }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <p className="text-sm text-gray-500">Funzioni che servono solo ad alcuni progetti. Se non ti servono lasciale spente: non compaiono nel menu e non lavorano.</p>
      {list === null && <div className="text-xs text-gray-600">Caricamento…</div>}
      {list && list.map((f) => (
        <section key={f.key} className="bg-surface-card border border-gray-800 rounded-xl p-5 flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-surface-page border border-gray-800 flex items-center justify-center text-accent flex-shrink-0"><Icon name="box" size={16} /></div>
            <div>
              <h2 className="text-sm font-semibold text-ink">{f.label}</h2>
              <p className="text-xs text-gray-500 mt-0.5 max-w-md">{f.description}</p>
            </div>
          </div>
          <button type="button" role="switch" aria-checked={f.enabled} onClick={() => toggle(f)} disabled={busy === f.key}
            className={'w-10 h-[22px] rounded-full transition-colors relative flex-shrink-0 mt-1 disabled:opacity-60 ' + (f.enabled ? 'bg-accent' : 'bg-gray-700')}>
            <span className={'absolute top-[3px] left-0 w-4 h-4 rounded-full bg-white transition-transform ' + (f.enabled ? 'translate-x-[21px]' : 'translate-x-[3px]')} />
          </button>
        </section>
      ))}
    </div>
  )
}
