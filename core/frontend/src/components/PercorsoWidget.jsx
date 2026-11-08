import React, { useEffect, useState } from 'react'
import useApi from '../lib/useApi'
import { apriModulo } from '../lib/filtroWidget'

// «Percorso a fasi»: un conteggio per ogni stato del flusso di un modulo (es. Da valutare → In mandato → In vendita…), con una barra proporzionale al totale. Ogni fase si clicca e apre il modulo
// già filtrato su quello stato. Standard: serve solo il modulo (config non necessaria); gli stati e i colori sono quelli del flusso dichiarato nel modulo.
export const statiDelModulo = (modulo) => {
  let s = modulo && modulo.schema_json
  if (typeof s === 'string') { try { s = JSON.parse(s) } catch (e) { s = null } }
  return ((s && s.steps) || []).filter((x) => x.block_type === 'workflow_state').map((x) => ({ key: x.key, label: x.label || x.key, color: x.color }))
}

export default function PercorsoWidget({ token, moduleSlug, label, modules, onNavigate }) {
  const api = useApi(token)
  const [records, setRecords] = useState(null)
  const modulo = (modules || []).find((m) => m.slug === moduleSlug)
  const stati = statiDelModulo(modulo)
  useEffect(() => { api.get('/records/' + moduleSlug).then((r) => setRecords(Array.isArray(r) ? r : [])).catch(() => setRecords([])) }, [moduleSlug]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!stati.length) return <div className="p-5 text-sm text-gray-500">Questo modulo non ha un percorso a stati.</div>
  const conta = (k) => (records || []).filter((r) => r.data && r.data._stato === k).length
  const tot = Math.max(1, ...stati.map((s) => conta(s.key)))
  return (
    <div className="p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold">{label || (modulo && modulo.name) || 'Percorso'}</div>
        <button type="button" onClick={() => apriModulo(onNavigate, moduleSlug, [])} className="text-xs text-accent hover:underline">Apri {modulo ? modulo.name.toLowerCase() : 'il modulo'} →</button>
      </div>
      <div className="flex gap-2 sm:gap-3">
        {stati.map((s) => {
          const n = conta(s.key)
          return (
            <button key={s.key} type="button" onClick={() => apriModulo(onNavigate, moduleSlug, [{ campo: '_stato', op: '=', valore: s.key }])} title={'Apri: ' + s.label}
              className={'flex-1 min-w-0 text-left rounded-lg px-1.5 py-1 hover:bg-white/[0.04] transition' + (records !== null && n === 0 ? ' opacity-55' : '')}>
              <div className="text-2xl font-bold text-ink leading-tight">{records === null ? '…' : n}</div>
              <div className="h-1.5 rounded bg-gray-800 my-1.5 overflow-hidden"><div className="h-full rounded" style={{ width: records === null ? 0 : Math.max(n ? 8 : 0, Math.round((n / tot) * 100)) + '%', backgroundColor: s.color || 'rgb(var(--accent))' }} /></div>
              <div className="text-[11.5px] text-gray-500 truncate">{s.label}</div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
