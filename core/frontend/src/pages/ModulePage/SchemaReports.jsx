import React, { useState, useEffect } from 'react'
import useApi from '../../lib/useApi'

// Esegue e mostra i blocchi report_aggregate "raggruppati" (group_by/metric/func,
// autorati nel Builder — vedi BuilderPage/index.jsx) di un modulo, colpendo
// GET /records/:slug/report (records.js), la stessa aggregazione già usata dal
// pannello ad-hoc ReportPanel.jsx ma qui con configurazione FISSA decisa
// dall'admin nel Builder, non esplorabile dall'utente — l'equivalente
// dichiarativo di pagine oggi scritte a mano come ContabilitaGeneralePage.jsx.
//
// `aggregates`: array di blocchi { label, format, source_module, group_by,
// metric, func, metric_subtract } — passato dal chiamante (non letto qui
// direttamente dallo schema) così lo stesso componente serve sia per i blocchi
// del modulo corrente (ModulePage/index.jsx) sia per una vista dedicata che ne
// compone di più moduli diversi insieme (es. una futura pagina "Contabilità").
function formatValue(value, format) {
  const n = Number(value) || 0
  if (format === 'currency') return n.toLocaleString('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 })
  if (format === 'percent') return n.toFixed(1) + '%'
  if (format === 'ore') return (n / 60).toLocaleString('it-IT', { maximumFractionDigits: 1 }) + ' h'
  return n.toLocaleString('it-IT', { maximumFractionDigits: 2 })
}

function SingleReport({ aggregate, defaultModuleSlug, token }) {
  const api = useApi(token)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const sourceSlug = aggregate.source_module || defaultModuleSlug

  useEffect(() => {
    setLoading(true); setError('')
    const qs = new URLSearchParams({ group_by: aggregate.group_by, metric: aggregate.metric, func: aggregate.func || 'sum' })
    if (aggregate.metric_subtract) qs.set('metric_subtract', aggregate.metric_subtract)
    api.get('/records/' + sourceSlug + '/report?' + qs.toString()).then((res) => {
      if (!res) { setError('Impossibile calcolare questo report'); setLoading(false); return }
      setData(res); setLoading(false)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceSlug, aggregate.group_by, aggregate.metric, aggregate.func, aggregate.metric_subtract])

  if (loading) return <div className="text-sm text-gray-600 py-6 text-center">Calcolo…</div>
  if (error) return <div className="text-sm text-red-400 py-6 text-center">{error}</div>
  if (!data || data.groups.length === 0) return <div className="text-sm text-gray-600 py-6 text-center">Nessun dato.</div>

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-500 uppercase tracking-wider border-b border-gray-800">
            <th className="pb-2 pr-3 font-normal">{aggregate.group_label || 'Gruppo'}</th>
            <th className="pb-2 font-normal text-right">{aggregate.label}</th>
          </tr>
        </thead>
        <tbody>
          {data.groups.map((g) => (
            <tr key={g.label} className="border-b border-gray-800/50">
              <td className="py-1.5 pr-3 text-ink">{g.label}</td>
              <td className="py-1.5 text-right font-mono text-gray-200">{formatValue(g.value, aggregate.format)}</td>
            </tr>
          ))}
          <tr className="font-medium">
            <td className="py-1.5 pr-3 text-ink">Totale</td>
            <td className="py-1.5 text-right font-mono text-ink">{formatValue(data.total, aggregate.format)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

// Un blocco report_aggregate "a valore singolo" (senza group_by, con una key) — es. un
// "indice di salute" che combina altri aggregati per nome (vedi formula.js agg_ref).
// Colpisce GET /records/:slug/aggregate/:key (records.js), non /report — forma
// completamente diversa (un numero solo, non gruppi).
function SingleValueCard({ aggregate, defaultModuleSlug, token }) {
  const api = useApi(token)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const sourceSlug = aggregate.source_module || defaultModuleSlug

  useEffect(() => {
    setError('')
    api.get('/records/' + sourceSlug + '/aggregate/' + aggregate.key).then((res) => {
      if (!res) { setError('Errore'); return }
      setData(res)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceSlug, aggregate.key])

  return (
    <div className="bg-surface-page rounded-lg border border-gray-800 p-4">
      <div className="text-xs text-gray-500 mb-1.5 uppercase tracking-wider">{aggregate.label}</div>
      {error ? <div className="text-xs text-red-400">{error}</div> : (
        <div className="text-2xl font-bold text-ink tracking-[-0.7px]">{data ? formatValue(data.value, aggregate.format) : '…'}</div>
      )}
    </div>
  )
}

function SchemaReports({ aggregates, defaultModuleSlug, token }) {
  const grouped = (aggregates || []).filter((a) => a.group_by)
  // internal:true — un aggregato a valore singolo che esiste solo per essere referenziato
  // da un ALTRO aggregato (agg_ref), es. i pezzi di un "indice" composito — non è pensato
  // per essere letto da solo, quindi niente card propria (resta comunque calcolabile e
  // referenziabile, solo non mostrato qui).
  const singleValue = (aggregates || []).filter((a) => !a.group_by && a.key && !a.internal)
  const [tab, setTab] = useState(0)
  if (grouped.length === 0 && singleValue.length === 0) return null

  return (
    <div className="space-y-4">
      {singleValue.length > 0 && (
        <div className={'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-' + Math.min(4, singleValue.length) + ' gap-4'}>
          {singleValue.map((a, i) => <SingleValueCard key={a.key + i} aggregate={a} defaultModuleSlug={defaultModuleSlug} token={token} />)}
        </div>
      )}
      {grouped.length > 0 && (
        <div className="bg-surface-card rounded-md border border-gray-800 p-5">
          {grouped.length > 1 && (
            <div className="flex gap-1 mb-4 border-b border-gray-800 overflow-x-auto">
              {grouped.map((a, i) => (
                <button key={a.label + i} onClick={() => setTab(i)}
                  className={'px-4 py-2 text-sm whitespace-nowrap transition border-b-2 -mb-px ' + (tab === i ? 'border-accent text-accent' : 'border-transparent text-gray-500 hover:text-gray-300')}>
                  {a.label}
                </button>
              ))}
            </div>
          )}
          {grouped.length === 1 && <div className="text-sm font-medium text-ink mb-3">{grouped[0].label}</div>}
          <SingleReport aggregate={grouped[tab] || grouped[0]} defaultModuleSlug={defaultModuleSlug} token={token} />
        </div>
      )}
    </div>
  )
}

export default SchemaReports
