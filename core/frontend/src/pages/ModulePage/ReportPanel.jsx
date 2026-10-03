import React, { useState, useEffect } from 'react'
import useApi from '../../lib/useApi'
import Icon from '../../components/Icon'
import { pieChartSvg } from '../../lib/chart-svg'

const PERIOD_LABELS = { tutti: 'Tutti i periodi', questo_mese: 'Questo mese', mese_precedente: 'Mese precedente', quest_anno: 'Quest\'anno', anno_precedente: 'Anno precedente' }
const AGG_LABELS = { sum: 'Somma', avg: 'Media', count: 'Conteggio', min: 'Minimo', max: 'Massimo' }

function getDateRange(period) {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth() // 0-based
  const pad = (n) => String(n).padStart(2, '0')
  const fmt = (yr, mo, d) => `${yr}-${pad(mo + 1)}-${pad(d)}`

  if (period === 'questo_mese') {
    const last = new Date(y, m + 1, 0).getDate()
    return { from: fmt(y, m, 1), to: fmt(y, m, last), cFrom: fmt(m === 0 ? y - 1 : y, m === 0 ? 11 : m - 1, 1), cTo: fmt(m === 0 ? y - 1 : y, m === 0 ? 11 : m - 1, new Date(m === 0 ? y - 1 : y, m === 0 ? 12 : m, 0).getDate()) }
  }
  if (period === 'mese_precedente') {
    const pm = m === 0 ? 11 : m - 1; const py = m === 0 ? y - 1 : y
    const last = new Date(py, pm + 1, 0).getDate()
    const ppm = pm === 0 ? 11 : pm - 1; const ppy = pm === 0 ? py - 1 : py
    const plast = new Date(ppy, ppm + 1, 0).getDate()
    return { from: fmt(py, pm, 1), to: fmt(py, pm, last), cFrom: fmt(ppy, ppm, 1), cTo: fmt(ppy, ppm, plast) }
  }
  if (period === 'quest_anno') {
    return { from: `${y}-01-01`, to: `${y}-12-31`, cFrom: `${y - 1}-01-01`, cTo: `${y - 1}-12-31` }
  }
  if (period === 'anno_precedente') {
    return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31`, cFrom: `${y - 2}-01-01`, cTo: `${y - 2}-12-31` }
  }
  return { from: '', to: '', cFrom: '', cTo: '' }
}

function ReportPanel({ moduleSlug, fields, token }) {
  const api = useApi(token)
  const groupableFields = fields.filter((f) => ['select', 'checkbox', 'boolean'].includes(f.type))
  const metricFields = fields.filter((f) => ['number', 'currency'].includes(f.type))
  const dateFields = fields.filter((f) => f.type === 'date')

  const [groupBy, setGroupBy] = useState(groupableFields[0]?.key || '')
  const [metric, setMetric] = useState(metricFields[0]?.key || '')
  const [func, setFunc] = useState('sum')
  const [period, setPeriod] = useState('tutti')
  const [dateField, setDateField] = useState(dateFields[0]?.key || '')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [explain, setExplain] = useState(null) // { busy } | { text } | { error }

  useEffect(() => { setExplain(null) }, [groupBy, metric, func, period, dateField, moduleSlug])

  // Manda all'assistente solo i totali già mostrati qui sotto, mai le singole righe.
  const askExplain = async () => {
    setExplain({ busy: true })
    const withCompare = !!(data && data.compare_groups)
    const res = await api.post('/ai/explain-report', {
      titolo: moduleSlug.replace(/_/g, ' '),
      periodo: PERIOD_LABELS[period] || '',
      metrica: (metricFields.find((f) => f.key === metric) || {}).label || metric,
      funzione: func,
      totale: data.total,
      totale_confronto: withCompare ? data.compare_total : undefined,
      gruppi: data.groups.map((g) => ({ label: g.label, value: g.value, confronto: withCompare ? ((data.compare_groups.find((c) => c.label === g.label) || {}).value || 0) : undefined })),
    })
    if (res.ok && res.data.text) setExplain({ text: res.data.text })
    else if (res.data && res.data.code === 'ai_budget_exceeded') setExplain({ error: 'Il tetto di spesa mensile dell\'assistente è raggiunto: riprende il mese prossimo.' })
    else if (res.data && res.data.code === 'ai_unverified') setExplain({ error: 'Non sono riuscito a scrivere una spiegazione affidabile. Riprova.' })
    else setExplain({ error: 'L\'assistente non è disponibile in questo momento.' })
  }

  useEffect(() => {
    if (!groupBy || !metric) { setData(null); return }
    setLoading(true)
    const { from, to, cFrom, cTo } = getDateRange(period)
    const qs = new URLSearchParams({ group_by: groupBy, metric, func })
    if (period !== 'tutti' && dateField) {
      qs.set('date_field', dateField)
      if (from) qs.set('date_from', from)
      if (to) qs.set('date_to', to)
      if (cFrom) { qs.set('compare_from', cFrom); qs.set('compare_to', cTo) }
    }
    api.get('/records/' + moduleSlug + '/report?' + qs.toString()).then((res) => {
      setData(res); setLoading(false)
    })
  }, [groupBy, metric, func, period, dateField])

  if (groupableFields.length === 0 || metricFields.length === 0) {
    return (
      <div className="bg-surface-card rounded-md border border-gray-800 border-dashed p-8 text-center">
        <div className="text-gray-500 text-sm mb-1">Report non disponibile per questo modulo</div>
        <div className="text-gray-600 text-xs">Serve almeno un campo Selezione/Casella di spunta (per raggruppare) e un campo Numero/Valuta (da aggregare).</div>
      </div>
    )
  }

  const chart = data && data.groups.length > 0 ? pieChartSvg(data.groups, { size: 220 }) : null
  const hasCompare = data && data.compare_groups

  const delta = (curr, prev) => {
    if (!prev || prev === 0) return null
    const pct = ((curr - prev) / Math.abs(prev)) * 100
    return pct
  }

  return (
    <div className="bg-surface-card rounded-md border border-gray-800 p-6">
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <Icon name="bar-chart" size={15} />
          Raggruppa per
          <select className="bg-surface-page text-ink px-3 py-1.5 rounded-lg text-sm outline-none border border-gray-800 focus:border-accent transition" value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
            {groupableFields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-400">
          {AGG_LABELS[func]} di
          <select className="bg-surface-page text-ink px-3 py-1.5 rounded-lg text-sm outline-none border border-gray-800 focus:border-accent transition" value={metric} onChange={(e) => setMetric(e.target.value)}>
            {metricFields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
          </select>
        </div>
        <select className="bg-surface-page text-ink px-3 py-1.5 rounded-lg text-sm outline-none border border-gray-800 focus:border-accent transition" value={func} onChange={(e) => setFunc(e.target.value)}>
          {Object.entries(AGG_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>

        {dateFields.length > 0 && (
          <div className="flex items-center gap-2 text-sm text-gray-400 border-l border-gray-800 pl-3">
            <Icon name="calendar" size={14} />
            <select className="bg-surface-page text-ink px-3 py-1.5 rounded-lg text-sm outline-none border border-gray-800 focus:border-accent transition" value={period} onChange={(e) => setPeriod(e.target.value)}>
              <option value="tutti">Tutti i periodi</option>
              <option value="questo_mese">Questo mese</option>
              <option value="mese_precedente">Mese precedente</option>
              <option value="quest_anno">Quest'anno</option>
              <option value="anno_precedente">Anno precedente</option>
            </select>
            {period !== 'tutti' && dateFields.length > 1 && (
              <select className="bg-surface-page text-ink px-3 py-1.5 rounded-lg text-sm outline-none border border-gray-800 focus:border-accent transition" value={dateField} onChange={(e) => setDateField(e.target.value)}>
                {dateFields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
              </select>
            )}
          </div>
        )}
      </div>

      {loading && <div className="text-sm text-gray-600 py-12 text-center">Calcolo…</div>}
      {!loading && data && data.groups.length === 0 && <div className="text-sm text-gray-600 py-12 text-center">Nessun dato da mostrare.</div>}
      {!loading && chart && (
        <div className="flex items-start gap-8 flex-wrap">
          <div className="w-[220px] h-[220px] flex-shrink-0" dangerouslySetInnerHTML={{ __html: chart.svg }} />
          <div className="flex-1 min-w-[200px]">
            <div className="flex items-center justify-between text-xs text-gray-500 uppercase tracking-wide mb-2">
              <span>Totale · {(data.total || 0).toLocaleString('it-IT', { maximumFractionDigits: 2 })}</span>
              {hasCompare && <span className="text-gray-600">vs {(data.compare_total || 0).toLocaleString('it-IT', { maximumFractionDigits: 2 })}</span>}
            </div>
            <div className="space-y-1.5">
              {data.groups.map((g, i) => {
                const cg = hasCompare && data.compare_groups.find((c) => c.label === g.label)
                const d = hasCompare && cg ? delta(g.value, cg.value) : null
                return (
                  <div key={g.label} className="flex items-center gap-2 text-sm">
                    <span className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: ['#3B82F6','#10B981','#F59E0B','#EF4444','#8B5CF6','#EC4899','#06B6D4','#84CC16'][i % 8] }} />
                    <span className="text-gray-400 truncate flex-1">{g.label}</span>
                    <span className="text-gray-200 font-mono">{g.value.toLocaleString('it-IT', { maximumFractionDigits: 2 })}</span>
                    {d !== null && (
                      <span className={'text-xs font-mono ' + (d >= 0 ? 'text-green-400' : 'text-red-400')}>
                        {d >= 0 ? '+' : ''}{d.toFixed(1)}%
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
          <div className="w-full mt-1">
            <button type="button" onClick={askExplain} disabled={!!(explain && explain.busy)}
              className="flex items-center gap-2 text-sm text-accent hover:underline disabled:opacity-60 disabled:no-underline">
              <Icon name="wand" size={14} />
              {explain && explain.busy ? 'Sto leggendo il report…' : 'Spiega questo report'}
            </button>
            {explain && explain.text && (
              <div className="mt-3 rounded-lg bg-surface-page border border-gray-800 p-4 text-sm text-gray-300 leading-relaxed whitespace-pre-line">
                {explain.text}
                <div className="text-xs text-gray-600 mt-3">Scritto dall'assistente a partire dai totali qui sopra; i numeri sono controllati, ma verifica sempre sul report.</div>
              </div>
            )}
            {explain && explain.error && <div className="mt-3 text-sm text-amber-400">{explain.error}</div>}
          </div>
        </div>
      )}
    </div>
  )
}

export default ReportPanel
