import React, { useState, useEffect } from 'react'
import useApi from '../../lib/useApi'
import Icon from '../../components/Icon'

// Barre orizzontali con le settimane ISO di un mese (4-6 a seconda del mese) + un totale
// "oltre soglia" opzionale (es. straordinari oltre 40h/settimana) — GET
// /records/:slug/weekly-breakdown/:key (records.js + weekly-breakdown.js). Si aggiunge
// alla vista del modulo (come SchemaReports), non la sostituisce.
const MESI = ['', 'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre']

function formatValue(value, format) {
  const n = Number(value) || 0
  if (format === 'currency') return n.toLocaleString('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
  return n.toLocaleString('it-IT', { maximumFractionDigits: 1 })
}

function WeeklyBreakdownView({ config, defaultModuleSlug, token }) {
  const api = useApi(token)
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const sourceSlug = config.source_module || defaultModuleSlug

  useEffect(() => {
    setLoading(true)
    api.get('/records/' + sourceSlug + '/weekly-breakdown/' + config.key + '?y=' + year + '&m=' + month).then((res) => { setData(res); setLoading(false) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceSlug, config.key, year, month])

  const shiftMonth = (dir) => {
    let m = month + dir, y = year
    if (m < 1) { m = 12; y -= 1 }
    if (m > 12) { m = 1; y += 1 }
    setMonth(m); setYear(y)
  }

  if (loading) return <div className="text-sm text-gray-600 py-6 text-center">Calcolo…</div>
  if (!data) return <div className="text-sm text-red-400 py-6 text-center">Impossibile calcolare questa vista.</div>
  const maxVal = Math.max(1, ...data.weeks.map((w) => w.value), config.threshold != null ? Number(config.threshold) : 0)

  return (
    <div className="bg-surface-card rounded-md border border-gray-800 p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="text-sm font-medium text-ink">{config.label}</div>
        <div className="flex items-center gap-2">
          <button onClick={() => shiftMonth(-1)} className="w-7 h-7 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 flex items-center justify-center"><Icon name="chevron-left" size={14} /></button>
          <span className="text-sm text-ink font-medium w-28 text-center">{MESI[month]} {year}</span>
          <button onClick={() => shiftMonth(1)} className="w-7 h-7 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 flex items-center justify-center"><Icon name="chevron-right" size={14} /></button>
        </div>
      </div>
      <div className="space-y-2">
        {data.weeks.map((w) => (
          <div key={w.label} className="flex items-center gap-3">
            <span className="text-xs text-gray-500 w-8 flex-shrink-0">{w.label}</span>
            <div className="flex-1 h-4 rounded bg-gray-800 overflow-hidden relative">
              <div className="h-full bg-accent rounded" style={{ width: Math.min(100, (w.value / maxVal) * 100) + '%' }} />
              {config.threshold != null && (
                <div className="absolute top-0 bottom-0" style={{ left: Math.min(100, (Number(config.threshold) / maxVal) * 100) + '%', borderLeft: '2px dashed #9CA3AF' }} />
              )}
            </div>
            <span className="text-xs text-gray-400 font-mono w-16 text-right flex-shrink-0">{formatValue(w.value, data.format)}</span>
          </div>
        ))}
        {data.weeks.length === 0 && <div className="text-sm text-gray-600">Nessuna settimana in questo mese.</div>}
      </div>
      <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-800 text-sm">
        <span className="text-gray-500">Totale mese</span>
        <span className="font-mono text-ink">{formatValue(data.total, data.format)}</span>
      </div>
      {data.overThresholdTotal != null && (
        <div className="flex items-center justify-between mt-1 text-sm">
          <span className="text-gray-500">Oltre soglia</span>
          <span className="font-mono" style={{ color: data.overThresholdTotal > 0 ? '#F87171' : '#10B981' }}>{formatValue(data.overThresholdTotal, data.format)}</span>
        </div>
      )}
    </div>
  )
}

export default WeeklyBreakdownView
