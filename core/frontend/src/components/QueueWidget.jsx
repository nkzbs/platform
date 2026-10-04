import React, { useState, useEffect } from 'react'
import useApi from '../lib/useApi'
import Icon from './Icon'
import SmistaPanel from './SmistaPanel'

// Coda "da smistare": le righe nello stato "nuovo" dei moduli che lo hanno dichiarato (Builder → Avvisi). Nessun nome di modulo scritto qui.
const MAX = 8
const fmtEur = (n) => (Number(n) > 0 ? Number(n).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' }) : '')
const fmtDate = (iso) => (iso ? String(iso).split('-').reverse().join('/') : '')

export default function QueueWidget({ token, onNavigate, modules }) {
  const api = useApi(token)
  const [queues, setQueues] = useState(null) // [{ q, rows }]

  const load = () => {
    (async () => {
      const qs = await api.get('/module-roles/queues')
      const out = []
      for (const q of Array.isArray(qs) ? qs : []) {
        const recs = await api.get('/records/' + q.module_slug)
        const rows = (Array.isArray(recs) ? recs : []).filter((r) => r.data && r.data[q.stato] === q.nuovo)
        out.push({ q, rows })
      }
      setQueues(out)
    })()
  }
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const [panel, setPanel] = useState(null) // { q, row }
  const [done, setDone] = useState(null) // { text, module_slug } dopo uno smistamento

  if (queues === null) return <div className="p-5 text-sm text-gray-600">Caricamento…</div>
  const total = queues.reduce((t, x) => t + x.rows.length, 0)

  return (
    <div className="p-5">
      <div className="flex items-center gap-2 mb-3">
        <Icon name="inbox" size={15} className={total ? 'text-amber-500' : 'text-gray-500'} />
        <h2 className="text-sm font-semibold text-ink">Da smistare{total ? ' · ' + total : ''}</h2>
      </div>
      {done && (
        <div className="flex items-start gap-2 text-xs text-green-400 bg-green-900/20 border border-green-900/40 rounded-lg p-2.5 mb-3">
          <span className="flex-1">{done.text}</span>
          {onNavigate && <button type="button" onClick={() => onNavigate(done.module_slug)} className="underline flex-shrink-0">Apri {done.name}</button>}
          <button type="button" onClick={() => setDone(null)} className="text-gray-500 flex-shrink-0" aria-label="Chiudi">×</button>
        </div>
      )}
      {total === 0 && <div className="text-xs text-gray-500">Niente da smistare.</div>}
      {queues.filter((x) => x.rows.length).map(({ q, rows }) => (
        <div key={q.module_slug} className="mb-3 last:mb-0">
          <button type="button" onClick={() => onNavigate && onNavigate(q.module_slug)} className="text-[11px] uppercase tracking-wide text-gray-500 hover:text-accent mb-1">{q.name} · {rows.length} {rows.length === 1 ? q.noun_s : q.noun_p}</button>
          <div className="divide-y divide-gray-800">
            {rows.slice(0, MAX).map((r) => (
              <div key={r.id} className="flex items-center gap-3 py-1.5 hover:bg-white/[0.03] rounded">
                <button type="button" onClick={() => onNavigate && onNavigate(q.module_slug)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
                  <span className="text-sm text-ink truncate flex-1">{r.data[q.descrizione] || '(senza descrizione)'}</span>
                  <span className="text-xs text-gray-400 flex-shrink-0">{fmtEur(r.data[q.importo]) || 'importo da verificare'}</span>
                  <span className="text-xs text-gray-500 flex-shrink-0 w-20 text-right">{fmtDate(r.data[q.scadenza] || r.data[q.data])}</span>
                </button>
                {q.da_fare && <button type="button" onClick={() => setPanel({ q, row: r })} className="text-xs bg-accent hover:opacity-90 text-white px-2.5 py-1 rounded-lg flex-shrink-0">Smista</button>}
              </div>
            ))}
          </div>
          {rows.length > MAX && <div className="text-xs text-gray-500 mt-1">… e altre {rows.length - MAX}</div>}
        </div>
      ))}
      {panel && <SmistaPanel token={token} q={panel.q} row={panel.row} modules={modules} onClose={() => setPanel(null)} onDone={(text) => { setDone({ text, module_slug: panel.q.module_slug, name: panel.q.name }); setPanel(null); load() }} />}
    </div>
  )
}
