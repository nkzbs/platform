import React, { useState } from 'react'
import { raggruppaDaPagare } from '../lib/riepilogo-gruppi'

// «Da pagare»: le righe di un modulo di spese ancora da pagare, raggruppate per categoria o per mese (menu a tendina), con il totale.
// Quali campi sono lo stato, l'importo, la categoria e la data lo dichiara il modulo (ruoli, Builder → Ruoli del modulo): nessun nome scritto qui.
const eur = (n) => (n || 0).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })

export default function DaPagareBox({ q, records }) {
  const [quale, setQuale] = useState('categoria')
  const scelte = [['categoria', 'Categoria', !!q.categoria], ['mese', 'Mese', !!q.data]].filter((x) => x[2])
  if (!q || !q.stato || !q.da_fare || !q.importo || scelte.length === 0) return null
  const attiva = scelte.some((x) => x[0] === quale) ? quale : scelte[0][0]
  const gruppi = raggruppaDaPagare(records, q, attiva)
  if (gruppi.length === 0) return null
  const totale = gruppi.reduce((t, g) => t + g.totale, 0)
  const n = gruppi.reduce((t, g) => t + g.n, 0)
  return (
    <div className="mb-4 rounded-2xl border border-gray-800 bg-surface-card p-4">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <div className="text-[11px] uppercase tracking-wide text-gray-500">Ancora da pagare per</div>
        {scelte.length > 1
          ? <select aria-label="Raggruppa per" value={attiva} onChange={(e) => setQuale(e.target.value)} className="bg-surface-page text-ink text-xs font-medium rounded-lg border border-gray-700 px-2 py-1 outline-none focus:border-accent">{scelte.map((x) => <option key={x[0]} value={x[0]}>{x[1]}</option>)}</select>
          : <div className="text-[11px] uppercase tracking-wide text-gray-500">{scelte[0][1].toLowerCase()}</div>}
        <div className="ml-auto text-xs text-gray-500">{n} {n === 1 ? 'voce' : 'voci'} · <span className="text-ink font-medium">{eur(totale)}</span></div>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {gruppi.map((g) => (
          <div key={g.nome} className="flex-shrink-0 min-w-[130px] rounded-xl border border-gray-800 bg-surface-page px-3 py-2">
            <div className="text-xs text-gray-400 truncate max-w-[180px]">{g.nome}</div>
            <div className="text-base font-semibold text-ink">{eur(g.totale)}</div>
            <div className="text-[10px] text-gray-500">{g.n} {g.n === 1 ? 'voce' : 'voci'}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
