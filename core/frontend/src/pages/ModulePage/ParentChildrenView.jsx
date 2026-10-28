import React, { useState, useEffect } from 'react'
import useApi from '../../lib/useApi'
import RecordDetailModal from './RecordDetailModal'
import { parseSchemaFrontend } from '../../lib/schema-v3-frontend'

// Lista di genitori con riepilogo dei figli — GET /records/:slug/parent-children/:key
// (records.js + parent-children-view.js). Sostituisce l'intera vista del modulo, stesso
// trattamento di PeriodView.
function eur(n) {
  return (n || 0).toLocaleString('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 })
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

function ParentChildrenView({ config, mod, schema, token, tableColumns, records, user }) {
  const api = useApi(token)
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState(null)
  const [detailId, setDetailId] = useState(null)
  const [childDetailId, setChildDetailId] = useState(null)
  const [childMod, setChildMod] = useState(null)
  const [childSchema, setChildSchema] = useState(null)
  // Righe del modulo "genitore" per il titolo. Quando la vista è una scheda di un ALTRO modulo (es. la scheda Debiti dentro
  // Spese Personali) la pagina non ha le righe dei debiti: le carico qui, altrimenti il titolo sarebbe solo "#id".
  const [ownRecords, setOwnRecords] = useState(null)
  const needsOwn = !records || !records.length || !tableColumns || !tableColumns.length

  const openChild = async (id) => {
    if (!childMod) {
      const m = await api.get('/modules/' + config.children_module)
      if (m) { setChildMod(m); setChildSchema(parseSchemaFrontend(m.schema_json)) }
    }
    setChildDetailId(id)
  }

  const load = () => {
    setLoading(true)
    api.get('/records/' + mod.slug + '/parent-children/' + config.key).then((res) => {
      setData(res); setLoading(false)
    })
  }
  useEffect(() => { load() }, [mod.slug, config.key]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!needsOwn) return
    api.get('/records/' + mod.slug).then((r) => setOwnRecords(Array.isArray(r) ? r : []))
  }, [mod.slug, needsOwn]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <div className="text-gray-500 text-sm">Caricamento...</div>
  if (!data) return <div className="text-sm text-red-400">Impossibile calcolare questa vista.</div>

  const recordById = {}
  ;(needsOwn ? ownRecords || [] : records).forEach((r) => { recordById[r.id] = r })
  // Campo del titolo: la prima colonna della tabella; per un altro modulo, un campo "nome" se c'è, altrimenti il primo campo.
  const fields = (schema && schema.fields) || []
  const titleKey = (tableColumns && tableColumns[0] && tableColumns[0].key)
    || (fields.find((f) => ['nome', 'name', 'titolo', 'descrizione'].includes(f.key)) || fields[0] || {}).key

  return (
    <div>
      <div className="space-y-3">
        {data.rows.map((p) => {
          const rec = recordById[p.__id]
          return (
            <div key={p.__id} className="bg-surface-card rounded-md border border-gray-800 p-5">
              <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                <div className="min-w-0 cursor-pointer" onClick={() => setDetailId(p.__id)}>
                  <div className="text-ink font-medium hover:text-accent transition">{rec && titleKey ? String(rec.data[titleKey] ?? '—') : '#' + p.__id}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{rec && rec.data.creditore && rec.data.creditore !== rec.data[titleKey] ? rec.data.creditore + ' · ' : ''}{eur(p.totale)} totale · {p.n_done}/{p.n_children} completati</div>
                </div>
                {p.residuo <= 0 && p.n_children > 0 && <span className="text-xs text-green-400 flex-shrink-0">Saldato</span>}
              </div>
              <div className="h-1.5 rounded-full bg-gray-800 overflow-hidden mb-3">
                <div className="h-full bg-green-500 rounded-full" style={{ width: p.pct + '%' }} />
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {p.children.map((c, i) => (
                  <button key={c.__id} onClick={() => openChild(c.__id)}
                    className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold transition flex-shrink-0"
                    style={{ backgroundColor: c.done ? '#10B981' : 'transparent', border: '2px solid ' + (c.done ? '#10B981' : '#374151'), color: c.done ? '#fff' : '#9CA3AF' }}>
                    {i + 1}
                  </button>
                ))}
              </div>
            </div>
          )
        })}
        {data.rows.length === 0 && <div className="text-sm text-gray-600">Nessun elemento.</div>}
      </div>

      {detailId && mod && schema && (
        <RecordDetailModal mod={mod} schema={schema} recordId={detailId} relatedCache={{}} token={token} user={user} canDelete={canDeleteOn(schema, user)}
          onClose={() => setDetailId(null)} onSaved={() => { setDetailId(null); load() }} onDeleted={() => { setDetailId(null); load() }} />
      )}
      {childDetailId && childMod && childSchema && (
        <RecordDetailModal mod={childMod} schema={childSchema} recordId={childDetailId} relatedCache={{}} token={token} user={user} canDelete={canDeleteOn(childSchema, user)}
          onClose={() => setChildDetailId(null)} onSaved={() => { setChildDetailId(null); load() }} onDeleted={() => { setChildDetailId(null); load() }} />
      )}
    </div>
  )
}

export default ParentChildrenView
