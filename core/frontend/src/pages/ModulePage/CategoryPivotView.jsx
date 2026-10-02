import React, { useState, useEffect } from 'react'
import useApi from '../../lib/useApi'

// Pivot per categoria su N anni, con delta% tra i due più recenti — GET
// /records/:slug/category-pivot/:key (records.js + category-pivot.js). Si aggiunge alla
// vista del modulo (come SchemaReports), non la sostituisce.
function formatValue(value, format) {
  const n = Number(value) || 0
  if (format === 'currency') return n.toLocaleString('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
  return n.toLocaleString('it-IT', { maximumFractionDigits: 0 })
}

function CategoryPivotView({ config, defaultModuleSlug, token }) {
  const api = useApi(token)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const sourceSlug = config.source_module || defaultModuleSlug

  useEffect(() => {
    setLoading(true)
    api.get('/records/' + sourceSlug + '/category-pivot/' + config.key).then((res) => { setData(res); setLoading(false) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceSlug, config.key])

  if (loading) return <div className="text-sm text-gray-600 py-6 text-center">Calcolo…</div>
  if (!data) return <div className="text-sm text-red-400 py-6 text-center">Impossibile calcolare questa vista.</div>
  const maxVal = Math.max(1, ...data.categories.map((c) => c.values[0].value))

  return (
    <div className="bg-surface-card rounded-md border border-gray-800 p-5">
      <div className="text-sm font-medium text-ink mb-4">{config.label}</div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 uppercase tracking-wider border-b border-gray-800">
              <th className="pb-2 pr-3 font-normal">Categoria</th>
              {data.years.map((y) => <th key={y} className="pb-2 pr-3 font-normal text-right">{y}</th>)}
              {data.years.length > 1 && <th className="pb-2 font-normal text-right">Δ%</th>}
            </tr>
          </thead>
          <tbody>
            {data.categories.map((c) => (
              <tr key={c.category} className="border-b border-gray-800/50">
                <td className="py-1.5 pr-3 text-ink align-top">
                  <div>{c.category}</div>
                  <div className="h-1.5 w-full rounded-full bg-gray-800 overflow-hidden mt-1">
                    <div className="h-full rounded-full bg-accent" style={{ width: Math.round((c.values[0].value / maxVal) * 100) + '%' }} />
                  </div>
                </td>
                {c.values.map((v) => <td key={v.year} className="py-1.5 pr-3 text-right font-mono text-gray-200 align-top">{formatValue(v.value, data.format)}</td>)}
                {data.years.length > 1 && (
                  <td className="py-1.5 text-right font-mono align-top" style={{ color: c.deltaPct == null ? '#6B7280' : c.deltaPct > 5 ? '#F87171' : c.deltaPct < -5 ? '#10B981' : '#9CA3AF' }}>
                    {c.deltaPct == null ? '—' : (c.deltaPct >= 0 ? '+' : '') + c.deltaPct + '%'}
                  </td>
                )}
              </tr>
            ))}
            {data.categories.length === 0 && <tr><td colSpan={data.years.length + 2} className="py-3 text-sm text-gray-600">Nessun dato.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default CategoryPivotView
