import React, { useState, useEffect } from 'react'
import useApi from '../../lib/useApi'
import Icon from '../../components/Icon'

// Tabella con tutti i 12 mesi di un anno (navigabile), ciascuno con le sue metriche,
// opzionalmente confrontato con lo stesso mese dell'anno precedente — GET
// /records/:slug/yearly-breakdown/:key (records.js + yearly-breakdown.js). Si aggiunge
// alla vista del modulo (come SchemaReports), non la sostituisce.
function formatValue(value, format) {
  const n = Number(value) || 0
  if (format === 'currency') return n.toLocaleString('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
  return n.toLocaleString('it-IT', { maximumFractionDigits: 0 })
}

function YearlyBreakdownView({ config, defaultModuleSlug, token }) {
  const api = useApi(token)
  const [year, setYear] = useState(new Date().getFullYear())
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const sourceSlug = config.source_module || defaultModuleSlug

  useEffect(() => {
    setLoading(true)
    api.get('/records/' + sourceSlug + '/yearly-breakdown/' + config.key + '?y=' + year).then((res) => { setData(res); setLoading(false) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceSlug, config.key, year])

  if (loading) return <div className="text-sm text-gray-600 py-6 text-center">Calcolo…</div>
  if (!data) return <div className="text-sm text-red-400 py-6 text-center">Impossibile calcolare questa vista.</div>

  return (
    <div className="bg-surface-card rounded-md border border-gray-800 p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="text-sm font-medium text-ink">{config.label}</div>
        <div className="flex items-center gap-2">
          <button onClick={() => setYear((y) => y - 1)} className="w-7 h-7 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 flex items-center justify-center"><Icon name="chevron-left" size={14} /></button>
          <span className="text-sm text-ink font-medium w-12 text-center">{year}</span>
          <button onClick={() => setYear((y) => y + 1)} className="w-7 h-7 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 flex items-center justify-center"><Icon name="chevron-right" size={14} /></button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 uppercase tracking-wider border-b border-gray-800">
              <th className="pb-2 pr-3 font-normal">Mese</th>
              {data.months[0].metrics.map((m) => <th key={m.key} className="pb-2 pr-3 font-normal text-right">{m.label} {year}</th>)}
              {data.compareTotals && data.months[0].metrics.map((m) => <th key={'c' + m.key} className="pb-2 font-normal text-right text-gray-600">{m.label} {year - 1}</th>)}
            </tr>
          </thead>
          <tbody>
            {data.months.map((mo) => (
              <tr key={mo.m} className="border-b border-gray-800/50">
                <td className="py-1.5 pr-3 text-ink">{mo.label}</td>
                {mo.metrics.map((m) => <td key={m.key} className="py-1.5 pr-3 text-right font-mono text-gray-200">{formatValue(m.value, m.format)}</td>)}
                {mo.compareMetrics && mo.compareMetrics.map((m) => <td key={'c' + m.key} className="py-1.5 text-right font-mono text-gray-600">{formatValue(m.value, m.format)}</td>)}
              </tr>
            ))}
            <tr className="font-medium">
              <td className="py-1.5 pr-3 text-ink">Totale anno</td>
              {data.totals.map((m) => <td key={m.key} className="py-1.5 pr-3 text-right font-mono text-ink">{formatValue(m.value, m.format)}</td>)}
              {data.compareTotals && data.compareTotals.map((m) => <td key={'c' + m.key} className="py-1.5 text-right font-mono text-gray-500">{formatValue(m.value, m.format)}</td>)}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default YearlyBreakdownView
