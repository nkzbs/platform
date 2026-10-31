import React, { useState, useEffect } from 'react'
import useApi from '../../lib/useApi'
import Icon from '../../components/Icon'
import RecordDetailModal from './RecordDetailModal'

// Vista navigabile per periodo (mese o anno) — GET /records/:slug/period-view/:key
// (records.js + period-view.js). Sostituisce l'intera vista del modulo, stesso
// trattamento di le altre viste. Se il modulo ha un workflow,
// aggiunge da sola due cose che sennò servirebbero pagine a parte: chip di filtro per
// stato (stesso concetto di filter_tab, ma sullo stato invece che su un campo select) e
// un cerchio cliccabile per riga (tap-to-pay).
//
// Il cerchio USA lo stesso togglePair (coppia di stati A<->B, es. da_pagare<->pagato)
// di ModulePage/index.jsx e ChecklistWidget.jsx — non "l'unica transizione disponibile
// dallo stato corrente" come una prima versione faceva. Bug reale trovato dall'utente:
// con 3 stati in catena (da_smistare -> da_pagare <-> pagato), OGNI stato ha esattamente
// una transizione uscente, quindi "riempi se non c'è transizione" non riempiva MAI il
// cerchio — pagato e da_pagare sembravano visivamente identici (entrambi vuoti, solo il
// bordo cambiava colore), mentre ChecklistWidget (Dashboard) mostra correttamente pieno
// quando pagato — risultato: voci spuntate in Dashboard ma NON spuntate nel modulo.
function findTogglePair(workflow) {
  if (!workflow || !workflow.transitions) return null
  for (const t1 of workflow.transitions) {
    if (workflow.transitions.some((t2) => t2.from === t1.to && t2.to === t1.from)) return { off: t1.from, on: t1.to }
  }
  return null
}

function formatValue(value, format) {
  const n = Number(value) || 0
  if (format === 'currency') return n.toLocaleString('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 })
  if (format === 'ore') return (n / 60).toLocaleString('it-IT', { maximumFractionDigits: 1 }) + ' h'
  return n.toLocaleString('it-IT', { maximumFractionDigits: 2 })
}

// Stesso calcolo di ModulePage/index.jsx (canDo('delete')): qui RecordDetailModal non lo riceveva affatto
// (sempre "niente permesso", Elimina mai visibile neanche per admin — segnalato dall'utente il 28/10).
function canDeleteOn(schema, user) {
  const rules = schema && schema.permissions && schema.permissions.rules
  if (!Array.isArray(rules) || rules.length === 0) return true
  const rule = rules.find((r) => r.role === (user && user.role))
  if (rule) return !!rule.delete
  return (user && user.role) === 'admin'
}

function PeriodView({ config, mod, schema, token, tableColumns, records, user }) {
  const api = useApi(token)
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState(null)
  const [period, setPeriod] = useState(null)
  const [detailId, setDetailId] = useState(null)
  const [stateFilter, setStateFilter] = useState(null)

  const load = (p) => {
    setLoading(true)
    const qs = p ? '?y=' + p.y + (p.m ? '&m=' + p.m : '') + (p.w ? '&w=' + p.w : '') : ''
    api.get('/records/' + mod.slug + '/period-view/' + config.key + qs).then((res) => {
      setData(res); setPeriod(res ? res.period : null); setLoading(false)
    })
  }
  useEffect(() => { load(null) }, [mod.slug, config.key]) // eslint-disable-line react-hooks/exhaustive-deps

  const workflow = schema && schema.workflow
  const togglePair = mod.quick_toggle === 0 ? null : findTogglePair(workflow)
  const toggle = async (r) => {
    if (!togglePair) return
    const to = r._stato === togglePair.on ? togglePair.off : togglePair.on
    await api.post('/records/' + mod.slug + '/' + r.__id + '/transition', { to })
    load(period)
  }

  if (loading && !data) return <div className="text-gray-500 text-sm">Caricamento...</div>
  if (!data) return <div className="text-sm text-red-400">Impossibile calcolare questa vista.</div>

  const recordById = {}
  ;(records || []).forEach((r) => { recordById[r.id] = r })
  const visibleRows = stateFilter ? data.rows.filter((r) => r._stato === stateFilter) : data.rows

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <button onClick={() => load(data.prev)} className="w-8 h-8 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 flex items-center justify-center">
          <Icon name="chevron-left" size={16} />
        </button>
        <span className="text-sm text-ink font-medium min-w-[80px] text-center">{data.label}</span>
        <button onClick={() => load(data.next)} className="w-8 h-8 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 flex items-center justify-center">
          <Icon name="chevron-right" size={16} />
        </button>
      </div>

      <div className={'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-' + Math.min(4, data.metrics.length) + ' gap-4 mb-6'}>
        {data.metrics.map((m, i) => {
          const cmp = data.compareMetrics && data.compareMetrics[i]
          return (
            <div key={m.key} className="glass-panel p-5">
              <div className="text-xs text-gray-500 mb-2 uppercase tracking-wider">{m.label}</div>
              <div className="text-2xl font-bold text-ink tracking-[-0.7px]">{formatValue(m.value, m.format)}</div>
              {cmp && <div className="text-xs text-gray-500 mt-0.5">{data.compareLabel}: {formatValue(cmp.value, cmp.format)}</div>}
            </div>
          )
        })}
      </div>

      {workflow && workflow.states && workflow.states.length > 0 && (
        <div className="flex items-center gap-1 mb-4 flex-wrap">
          <button onClick={() => setStateFilter(null)} className={'px-3 py-1.5 rounded-lg text-xs font-medium transition ' + (stateFilter === null ? 'bg-accent text-white' : 'bg-gray-800 text-gray-400 hover:text-ink')}>Tutti</button>
          {workflow.states.map((s) => (
            <button key={s.key} onClick={() => setStateFilter(stateFilter === s.key ? null : s.key)}
              className={'px-3 py-1.5 rounded-lg text-xs font-medium transition ' + (stateFilter === s.key ? 'bg-accent text-white' : 'bg-gray-800 text-gray-400 hover:text-ink')}>
              {s.label}
            </button>
          ))}
        </div>
      )}

      <div className="glass-panel overflow-hidden">
        {visibleRows.length === 0 ? (
          <div className="p-8 text-center text-gray-600 text-sm">Nessun record in questo periodo.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 uppercase tracking-wider border-b border-gray-800">
                {workflow && <th className="w-8"></th>}
                {tableColumns.slice(0, 4).map((c) => <th key={c.key} className="px-4 py-2 font-normal">{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((r) => {
                const checked = togglePair && r._stato === togglePair.on
                return (
                  <tr key={r.__id} className="border-b border-gray-800/50 last:border-0 hover:bg-gray-800/30">
                    {workflow && (
                      <td className="px-2">
                        {togglePair ? (
                          <button onClick={() => toggle(r)}
                            className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
                            style={{ backgroundColor: checked ? '#10B981' : 'transparent', border: '2px solid ' + (checked ? '#10B981' : '#374151') }}
                            title={checked ? 'Segna ' + togglePair.off : 'Segna ' + togglePair.on}>
                            {checked && <Icon name="check" size={10} className="text-white" />}
                          </button>
                        ) : (
                          <div className="w-5 h-5 rounded-full flex-shrink-0" style={{ backgroundColor: (workflow.states.find((s) => s.key === r._stato) || {}).color || '#374151' }} />
                        )}
                      </td>
                    )}
                    {tableColumns.slice(0, 4).map((c, i) => {
                      const rec = recordById[r.__id]
                      return <td key={c.key} className="px-4 py-2 text-gray-300 cursor-pointer" onClick={() => setDetailId(r.__id)}>{rec ? String(rec.data[c.key] ?? '—') : (i === 0 ? String(r[c.key] ?? '—') : '—')}</td>
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {detailId && mod && schema && (
        <RecordDetailModal mod={mod} schema={schema} recordId={detailId} relatedCache={{}} token={token} user={user} canDelete={canDeleteOn(schema, user)}
          onClose={() => setDetailId(null)} onSaved={() => { setDetailId(null); load(period) }} onDeleted={() => { setDetailId(null); load(period) }} />
      )}
    </div>
  )
}

export default PeriodView
