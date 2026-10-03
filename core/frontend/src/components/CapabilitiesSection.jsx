import React, { useState, useEffect } from 'react'
import useApi from '../lib/useApi'
import Icon from './Icon'

// Capacità del progetto, nella Libreria accanto ai moduli: stesso gesto "Installa". Un progetto nuovo non ne ha nessuna; quando ne
// installi una compare dove serve (menu, dashboard, Impostazioni) e smette di comparire quando la rimuovi. I dati non si toccano.
export default function CapabilitiesSection({ token, onChanged }) {
  const api = useApi(token)
  const [list, setList] = useState(null)
  const [busy, setBusy] = useState(null)
  const [q, setQ] = useState('')

  const load = async () => { const d = await api.get('/features'); setList(Array.isArray(d) ? d : []) }
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = async (f) => {
    if (f.enabled && !window.confirm('Rimuovere «' + f.label + '»? Smette di comparire e di lavorare; i dati restano e la puoi reinstallare.')) return
    setBusy(f.key)
    const res = await api.put('/features/' + f.key, { enabled: !f.enabled })
    setBusy(null)
    if (res.ok) { await load(); if (onChanged) onChanged() }
  }

  if (list === null || list.length === 0) return null
  const match = (f) => !q || (f.label + ' ' + f.description).toLowerCase().includes(q)
  const installed = list.filter((f) => f.enabled && match(f)), available = list.filter((f) => !f.enabled && match(f))

  const card = (f) => (
    <div key={f.key} className="bg-surface-card border border-gray-800 rounded-xl p-5 flex flex-col">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-surface-page border border-gray-800 flex items-center justify-center text-accent flex-shrink-0"><Icon name="plug" size={16} /></div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-ink">{f.label}</h3>
          <p className="text-xs text-gray-500 mt-0.5">{f.description}</p>
        </div>
      </div>
      <div className="mt-4 pt-3 border-t border-gray-800 flex items-center justify-between gap-2">
        <span className="text-[11px] text-gray-600">Capacità</span>
        <button type="button" onClick={() => toggle(f)} disabled={busy === f.key}
          className={f.enabled ? 'text-xs text-gray-400 hover:text-red-400 px-2 py-1 disabled:opacity-60' : 'text-xs bg-accent hover:opacity-90 disabled:opacity-60 text-white px-4 py-1.5 rounded-lg font-medium'}>
          {f.enabled ? 'Rimuovi' : 'Installa'}
        </button>
      </div>
    </div>
  )

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <h2 className="text-sm font-semibold text-ink">Capacità</h2>
        <input value={q} onChange={(e) => setQ(e.target.value.toLowerCase())} placeholder="Cerca capacità..." className="bg-surface-card text-ink px-3 py-1.5 rounded-lg text-xs outline-none border border-gray-800 focus:border-accent placeholder-gray-600" />
      </div>
      <p className="text-xs text-gray-500 mb-3">Funzioni in più che un progetto può avere: notifiche WhatsApp, mail che diventano righe, Sito Web, e le funzioni di finanza personale. Un progetto nuovo parte senza.</p>
      {installed.length > 0 && <><div className="text-[11px] uppercase tracking-wide text-gray-500 mb-2">Installate</div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 mb-4">{installed.map(card)}</div></>}
      {available.length > 0 && <><div className="text-[11px] uppercase tracking-wide text-gray-500 mb-2">Disponibili</div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{available.map(card)}</div></>}
      {installed.length === 0 && available.length === 0 && <div className="text-xs text-gray-600">Nessuna capacità corrisponde alla ricerca.</div>}
    </div>
  )
}
