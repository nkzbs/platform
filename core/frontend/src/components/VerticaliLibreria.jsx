import React, { useState, useEffect } from 'react'
import useApi from '../lib/useApi'
import Icon from './Icon'

// «Parti da un modello»: i verticali proposti (gruppi di moduli che funzionano insieme) a tessere. Un tocco apre l'elenco dei moduli: si toglie
// la spunta a quelli che non servono e si installa il resto in un colpo solo (i moduli già presenti restano come sono). Poi si collegano e si
// modificano come tutti gli altri. Se la Libreria non risponde o non ci sono verticali, la sezione non compare.
export default function VerticaliLibreria({ token, installatiSlugs, onInstalled }) {
  const api = useApi(token)
  const [verticali, setVerticali] = useState([])
  const [aperto, setAperto] = useState(null)
  const [scelti, setScelti] = useState([])
  const [stato, setStato] = useState({ busy: false, errore: '' })
  useEffect(() => { api.get('/modules/registry-verticals').then((d) => Array.isArray(d) && setVerticali(d)) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  if (!verticali.length) return null

  const apri = (v) => { setAperto(v); setScelti(v.moduli.filter((m) => !installatiSlugs.has(m.slug)).map((m) => m.id)); setStato({ busy: false, errore: '' }) }
  const chiudi = () => { if (!stato.busy) setAperto(null) }
  const installa = async () => {
    setStato({ busy: true, errore: '' })
    const r = await api.post('/modules/registry/bulk-install', { ids: scelti })
    if (r.ok) { setStato({ busy: false, errore: '' }); setAperto(null); onInstalled(r.data) } else setStato({ busy: false, errore: (r.data && r.data.error) || 'Installazione non riuscita.' })
  }
  const toggle = (id) => setScelti((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))

  return (
    <div className="mb-6">
      <h2 className="text-sm font-semibold text-ink mb-1">Parti da un modello</h2>
      <p className="text-gray-500 text-xs mb-3">Un gruppo di moduli già pensati per funzionare insieme. Scegli quali tenere, poi li modifichi come tutti gli altri.</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {verticali.map((v) => {
          const presenti = v.moduli.filter((m) => installatiSlugs.has(m.slug)).length
          return (
            <button key={v.id} onClick={() => apri(v)} className="bg-surface-card rounded-xl border border-gray-800 hover:border-gray-700 transition p-4 flex flex-col items-center text-center gap-2">
              <div className="w-12 h-12 rounded-xl bg-accent/15 text-accent flex items-center justify-center"><Icon name={v.icon || 'box'} size={22} /></div>
              <div className="text-ink font-medium text-sm">{v.name}</div>
              <div className="text-[11px] text-gray-500">{v.moduli.length} moduli{presenti > 0 ? ' · ' + presenti + ' già installati' : ''}</div>
            </button>
          )
        })}
      </div>

      {aperto && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={chiudi}>
          <div className="bg-surface-card rounded-xl w-full max-w-md border border-gray-800 p-5 max-h-[88vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-ink mb-1">{aperto.name}</h2>
            {aperto.description && <p className="text-sm text-gray-400 mb-3">{aperto.description}</p>}
            <div className="divide-y divide-gray-800 border border-gray-800 rounded-lg">
              {aperto.moduli.map((m) => {
                const gia = installatiSlugs.has(m.slug)
                return (
                  <label key={m.id} className={'flex items-start gap-3 px-3 py-2.5 ' + (gia ? 'opacity-60' : 'cursor-pointer hover:bg-gray-800/40')}>
                    <input type="checkbox" className="mt-1 flex-shrink-0" disabled={gia} checked={gia || scelti.includes(m.id)} onChange={() => toggle(m.id)} />
                    <div className="min-w-0"><div className="text-sm text-ink">{m.name}{gia ? <span className="text-xs text-gray-500"> · già installato</span> : null}</div>{m.description && <div className="text-xs text-gray-500 line-clamp-2">{m.description}</div>}</div>
                  </label>
                )
              })}
            </div>
            <p className="text-xs text-gray-500 mt-2">I moduli di cui questi hanno bisogno (per esempio i clienti) vengono aggiunti da soli.</p>
            {stato.errore && <div className="text-xs text-amber-400 mt-2">{stato.errore}</div>}
            <div className="flex gap-2 mt-4 justify-end">
              <button onClick={chiudi} disabled={stato.busy} className="text-sm px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300">Annulla</button>
              <button onClick={installa} disabled={stato.busy || !scelti.length} className="text-sm px-4 py-2 rounded-lg bg-accent hover:opacity-90 disabled:opacity-50 text-white">{stato.busy ? 'Installo…' : 'Installa ' + scelti.length + ' moduli'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
