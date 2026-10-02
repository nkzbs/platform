import React, { useState, useEffect } from 'react'
import useApi from '../../lib/useApi'
import RecordDetailModal from './RecordDetailModal'

// Vista bucketizzata per distanza (in giorni) da oggi — es. Scadenzario (giorni alla
// scadenza) — GET /records/:slug/distance-buckets/:key (records.js + distance-buckets.js).
// Sostituisce l'intera vista del modulo, stesso trattamento di ReconciliationView.
function formatValue(value, format) {
  const n = Number(value) || 0
  if (format === 'currency') return n.toLocaleString('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 })
  return n.toLocaleString('it-IT', { maximumFractionDigits: 2 })
}

const COLORS = ['#F87171', '#F59E0B', '#2563EB', '#6B7280', '#8B5CF6', '#10B981']

function DistanceBucketsView({ config, mod, schema, token, tableColumns, records }) {
  const api = useApi(token)
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState(null)
  const [activeBucket, setActiveBucket] = useState(null)
  const [detailId, setDetailId] = useState(null)

  const load = () => {
    setLoading(true)
    api.get('/records/' + mod.slug + '/distance-buckets/' + config.key).then((res) => {
      setData(res); setLoading(false)
    })
  }
  useEffect(() => { load() }, [mod.slug, config.key]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <div className="text-gray-500 text-sm">Caricamento...</div>
  if (!data) return <div className="text-sm text-red-400">Impossibile calcolare questa vista.</div>

  const recordById = {}
  ;(records || []).forEach((r) => { recordById[r.id] = r })

  const visible = activeBucket ? data.rows.filter((r) => r.bucket === activeBucket) : data.rows.filter((r) => r.bucket)

  return (
    <div>
      <div className={'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-' + Math.min(4, data.buckets.length) + ' gap-4 mb-6'}>
        {data.buckets.map((b, i) => (
          <button key={b.key} onClick={() => setActiveBucket(activeBucket === b.key ? null : b.key)}
            className={'text-left bg-surface-card rounded-md border p-5 transition ' + (activeBucket === b.key ? 'border-accent' : 'border-gray-800 hover:border-gray-700')}>
            <div className="text-xs text-gray-500 mb-2 uppercase tracking-wider">{b.label}</div>
            <div className="text-3xl font-bold mb-1" style={{ color: COLORS[i % COLORS.length] }}>{b.count}</div>
            {config.metric_field && <div className="text-xs text-gray-500">{formatValue(b.total, data.format)}</div>}
          </button>
        ))}
      </div>

      <div className="bg-surface-card rounded-md border border-gray-800 overflow-hidden">
        {visible.length === 0 ? (
          <div className="p-8 text-center text-gray-600 text-sm">Nessun record.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 uppercase tracking-wider border-b border-gray-800">
                {tableColumns.slice(0, 3).map((c) => <th key={c.key} className="px-4 py-2 font-normal">{c.label}</th>)}
                <th className="px-4 py-2 font-normal">Giorni</th>
                {config.metric_field && <th className="px-4 py-2 font-normal text-right">{config.metric_label || 'Valore'}</th>}
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const rec = recordById[r.__id]
                return (
                  <tr key={r.__id} className="border-b border-gray-800/50 last:border-0 hover:bg-gray-800/30 cursor-pointer" onClick={() => setDetailId(r.__id)}>
                    {tableColumns.slice(0, 3).map((c) => <td key={c.key} className="px-4 py-2 text-gray-300">{rec ? String(rec.data[c.key] ?? '—') : '—'}</td>)}
                    <td className="px-4 py-2 text-gray-400">{r.giorni < 0 ? Math.abs(r.giorni) + ' gg fa' : r.giorni + ' gg'}</td>
                    {config.metric_field && <td className="px-4 py-2 text-right font-mono text-gray-200">{formatValue(r.metricValue, data.format)}</td>}
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {detailId && mod && schema && (
        <RecordDetailModal mod={mod} schema={schema} recordId={detailId} relatedCache={{}} token={token}
          onClose={() => setDetailId(null)} onSaved={() => { setDetailId(null); load() }} />
      )}
    </div>
  )
}

export default DistanceBucketsView
