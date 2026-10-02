import React, { useState, useEffect, useRef } from 'react'
import Icon from '../../components/Icon'
import Select from '../../components/Select'
import { STEP_KINDS } from './constants'

function newStep(type) {
  const id = 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5)
  if (type === 'own_field') return { id, type, field: '', label: '' }
  if (type === 'get_related') return { id, type, child_module: '', via: null, filtro: [], label: '' }
  if (type === 'related_field') return { id, type, relation: '', field: '', label: '' }
  if (type === 'aggregate') return { id, type, input: '', func: 'sum', field: '', label: '' }
  if (type === 'arithmetic') return { id, type, op: '*', a: '', b: '', label: '' }
  if (type === 'round') return { id, type, input: '', label: '' }
  if (type === 'compare') return { id, type, op: '>', a: '', b: '', label: '' }
  return { id, type }
}

// Selettore di riferimento per gli slot input/a/b di aggregate/arithmetic/round — o un
// passaggio precedente (filtrato per tipo di output compatibile) o un valore fisso.
function RefPicker({ value, onChange, steps, idx, wantType }) {
  const priorSteps = steps.slice(0, idx).filter((s) => STEP_KINDS[s.type] && STEP_KINDS[s.type].outputType === wantType)
  const isLiteral = value && typeof value === 'object' && 'literal' in value
  return (
    <div className="flex items-center gap-1.5">
      <Select
        value={isLiteral ? '__literal__' : (value || '')}
        onChange={(val) => onChange(val === '__literal__' ? { literal: 0 } : val)} placeholder="Seleziona..."
        options={[
          ...priorSteps.map((s) => ({ value: s.id, label: s.label || STEP_KINDS[s.type].label })),
          ...(wantType === 'number' ? [{ value: '__literal__', label: 'Valore fisso...' }] : []),
        ]} />
      {isLiteral && (
        <input type="number" className="w-16 bg-surface-page text-ink px-2 py-1.5 rounded-md text-xs outline-none border border-gray-700 focus:border-cp-primary transition"
          value={value.literal} onChange={(e) => onChange({ literal: parseFloat(e.target.value) || 0 })} />
      )}
    </div>
  )
}

// L'editor a catena di blocchi vero — additivo rispetto a FormulaEditor (testo), mai
// usato insieme sullo stesso campo. Ogni passaggio produce un valore tipizzato
// referenziabile dai successivi; l'anteprima gira sullo stesso endpoint /formula/check,
// solo passando `steps` invece di `expr`.
function StepChainEditor({ steps, onChange, fieldCache, api, context }) {
  const debounceRef = React.useRef(null)
  const [check, setCheck] = useState(null)
  const [checking, setChecking] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)

  const list = steps || []

  useEffect(() => {
    if (list.length === 0) { setCheck(null); setChecking(false); return }
    setChecking(true)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      const res = await api.post('/builder/formula/check', { steps: list, context: context || null })
      setCheck(res.data)
      setChecking(false)
    }, 450)
    return () => clearTimeout(debounceRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(list), context && context.currentModule])

  const updateStep = (idx, patch) => onChange(list.map((s, i) => (i === idx ? { ...s, ...patch } : s)))
  const removeStep = (idx) => onChange(list.filter((_, i) => i !== idx))
  const addStep = (type) => { onChange([...list, newStep(type)]); setPickerOpen(false) }

  // Moduli che hanno almeno una relazione many_to_one verso il modulo corrente — stessa
  // logica di children-modules lato server, calcolata qui lato client dalla cache già
  // caricata, per popolare il selettore di "Ottieni record collegati" senza round-trip.
  const childCandidates = context && context.currentModule
    ? fieldCache.filter((m) => (m.relations || []).some((r) => r.type === 'many_to_one' && r.target_module === context.currentModule))
    : []
  const relationsToCurrent = (childSlug) =>
    (fieldCache.find((m) => m.slug === childSlug)?.relations || []).filter((r) => r.type === 'many_to_one' && r.target_module === context.currentModule)

  const ownFieldOptions = (context && context.currentModule
    ? (fieldCache.find((m) => m.slug === context.currentModule)?.fields || [])
    : []).filter((f) => ['number', 'currency', 'time'].includes(f.type))

  // Relazioni N:1 DICHIARATE SUL modulo corrente (in avanti, verso ciò che punta) — es.
  // da "Righe Ordine" la relazione "prodotto" verso "Prodotti". L'opposto di
  // childCandidates/relationsToCurrent sopra, che invece guardano ai FIGLI (chi punta A me).
  const ownRelations = context && context.currentModule
    ? (fieldCache.find((m) => m.slug === context.currentModule)?.relations || []).filter((r) => r.type === 'many_to_one')
    : []
  const relatedFieldOptions = (relationKey) => {
    const rel = ownRelations.find((r) => r.key === relationKey)
    if (!rel) return []
    return (fieldCache.find((m) => m.slug === rel.target_module)?.fields || [])
      .filter((f) => ['number', 'currency', 'time', 'computed'].includes(f.type))
  }

  return (
    <div>
      <div className="space-y-2 mb-2">
        {list.map((s, idx) => {
          const kind = STEP_KINDS[s.type]
          if (!kind) return null
          return (
            <div key={s.id} className="bg-surface-page rounded-lg border-l-[3px] p-2.5" style={{ borderLeftColor: kind.color }}>
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0" style={{ background: kind.bg, color: kind.color }}>
                    <Icon name={kind.icon} size={11} />
                  </div>
                  <span className="text-[11px] font-semibold text-gray-300 flex-shrink-0">{kind.label}</span>
                  <input placeholder="nome (opzionale)" value={s.label || ''} onChange={(e) => updateStep(idx, { label: e.target.value })}
                    className="min-w-0 flex-1 bg-transparent text-[11px] text-gray-500 placeholder-gray-700 outline-none border-b border-transparent focus:border-gray-700 transition" />
                </div>
                <button onClick={() => removeStep(idx)} className="text-red-400/50 hover:text-red-400 transition flex-shrink-0"><Icon name="trash" size={12} /></button>
              </div>

              {s.type === 'own_field' && (
                <Select className="w-full"
                  value={s.field} onChange={(val) => updateStep(idx, { field: val })} placeholder="Seleziona campo..."
                  options={ownFieldOptions.map((f) => ({ value: f.key, label: f.label + ' (' + f.key + ')' }))} />
              )}

              {s.type === 'get_related' && (
                <div>
                  <div className="flex items-center gap-2">
                    <Select className="flex-1"
                      value={s.child_module} onChange={(val) => updateStep(idx, { child_module: val, via: null })} placeholder="Seleziona modulo..."
                      options={childCandidates.map((m) => ({ value: m.slug, label: m.name }))} />
                    {s.child_module && relationsToCurrent(s.child_module).length > 1 && (
                      <Select className="flex-1"
                        value={s.via || ''} onChange={(val) => updateStep(idx, { via: val })} placeholder="quale relazione?"
                        options={relationsToCurrent(s.child_module).map((r) => ({ value: r.key, label: r.label }))} />
                    )}
                  </div>
                  {s.child_module && (() => {
                    const filtro = s.filtro || []
                    const childFields = fieldCache.find((m) => m.slug === s.child_module)?.fields || []
                    const setFiltro = (next) => updateStep(idx, { filtro: next })
                    return (
                      <div className="mt-2 pt-2 border-t border-gray-800 space-y-1.5">
                        <div className="text-[10px] text-gray-600">Filtro opzionale (tutte le condizioni, es. escludi bozze/annullati)</div>
                        {filtro.map((f, fi) => (
                          <div key={fi} className="flex items-center gap-1.5">
                            <Select className="flex-1" value={f.campo || ''}
                              onChange={(val) => setFiltro(filtro.map((x, xi) => xi === fi ? { ...x, campo: val } : x))} placeholder="Campo..."
                              options={[{ value: '_stato', label: '_stato' }, ...childFields.map((cf) => ({ value: cf.key, label: cf.label }))]} />
                            <Select className="w-24" value={f.op || '=='}
                              onChange={(val) => setFiltro(filtro.map((x, xi) => xi === fi ? { ...x, op: val } : x))}
                              options={[
                                { value: '==', label: '=' }, { value: '!=', label: '≠' },
                                { value: '<', label: '<' }, { value: '>', label: '>' },
                                { value: '<=', label: '≤' }, { value: '>=', label: '≥' },
                              ]} />
                            <input className="flex-1 bg-surface-card text-ink px-2 py-1 rounded-md text-[11px] outline-none border border-gray-700 placeholder-gray-600"
                              placeholder="valore" value={f.valore ?? ''} onChange={(e) => setFiltro(filtro.map((x, xi) => xi === fi ? { ...x, valore: e.target.value } : x))} />
                            <button onClick={() => setFiltro(filtro.filter((_, xi) => xi !== fi))} className="text-red-400/60 hover:text-red-400 transition"><Icon name="trash" size={11} /></button>
                          </div>
                        ))}
                        <button onClick={() => setFiltro([...filtro, { campo: '', op: '==', valore: '' }])}
                          className="w-full py-1 rounded-md bg-gray-800 hover:bg-gray-700 text-gray-400 text-[10px] font-medium transition">+ Condizione filtro</button>
                      </div>
                    )
                  })()}
                </div>
              )}

              {s.type === 'related_field' && (
                <div className="flex items-center gap-2">
                  <Select className="flex-1"
                    value={s.relation} onChange={(val) => updateStep(idx, { relation: val, field: '' })} placeholder="Seleziona relazione..."
                    options={ownRelations.map((r) => ({ value: r.key, label: r.label }))} />
                  {s.relation && (
                    <Select className="flex-1"
                      value={s.field} onChange={(val) => updateStep(idx, { field: val })} placeholder="Seleziona campo..."
                      options={relatedFieldOptions(s.relation).map((f) => ({ value: f.key, label: f.label + (f.type === 'computed' ? ' (calcolato)' : '') }))} />
                  )}
                </div>
              )}

              {s.type === 'aggregate' && (
                <div className="flex items-center gap-2 flex-wrap">
                  <RefPicker value={s.input} onChange={(v) => updateStep(idx, { input: v })} steps={list} idx={idx} wantType="record_list" />
                  <Select
                    value={s.func} onChange={(val) => updateStep(idx, { func: val })}
                    options={[
                      { value: 'sum', label: 'Somma' }, { value: 'avg', label: 'Media' }, { value: 'count', label: 'Conta' },
                      { value: 'min', label: 'Minimo' }, { value: 'max', label: 'Massimo' },
                    ]} />
                  {s.func !== 'count' && (() => {
                    const inputStep = list.find((x) => x.id === s.input)
                    const childFields = inputStep ? (fieldCache.find((m) => m.slug === inputStep.child_module)?.fields || []) : []
                    return (
                      <Select
                        value={s.field} onChange={(val) => updateStep(idx, { field: val })} placeholder="campo..."
                        options={childFields.filter((f) => ['number', 'currency', 'time', 'computed'].includes(f.type)).map((f) => ({ value: f.key, label: f.label + (f.type === 'computed' ? ' (calcolato)' : '') }))} />
                    )
                  })()}
                </div>
              )}

              {s.type === 'arithmetic' && (
                <div className="flex items-center gap-2 flex-wrap">
                  <RefPicker value={s.a} onChange={(v) => updateStep(idx, { a: v })} steps={list} idx={idx} wantType="number" />
                  <Select className="w-24"
                    value={s.op} onChange={(val) => updateStep(idx, { op: val })}
                    options={[{ value: '+', label: '+' }, { value: '-', label: '−' }, { value: '*', label: '×' }, { value: '/', label: '÷' }]} />
                  <RefPicker value={s.b} onChange={(v) => updateStep(idx, { b: v })} steps={list} idx={idx} wantType="number" />
                </div>
              )}

              {s.type === 'round' && (
                <RefPicker value={s.input} onChange={(v) => updateStep(idx, { input: v })} steps={list} idx={idx} wantType="number" />
              )}

              {s.type === 'compare' && (
                <div className="flex items-center gap-2 flex-wrap">
                  <RefPicker value={s.a} onChange={(v) => updateStep(idx, { a: v })} steps={list} idx={idx} wantType="number" />
                  <Select className="w-24"
                    value={s.op} onChange={(val) => updateStep(idx, { op: val })}
                    options={[
                      { value: '>', label: '>' }, { value: '<', label: '<' },
                      { value: '>=', label: '≥' }, { value: '<=', label: '≤' },
                      { value: '==', label: '=' }, { value: '!=', label: '≠' },
                    ]} />
                  <RefPicker value={s.b} onChange={(v) => updateStep(idx, { b: v })} steps={list} idx={idx} wantType="number" />
                </div>
              )}
            </div>
          )
        })}

        {list.length === 0 && (
          <div className="text-[11px] text-gray-600 border border-dashed border-gray-800 rounded-lg py-4 text-center">Nessun passaggio — aggiungine uno per iniziare.</div>
        )}
      </div>

      <div className="relative">
        <button onClick={() => setPickerOpen((s) => !s)}
          className="w-full py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-medium transition flex items-center justify-center gap-1.5">
          <Icon name="plus" size={12} />Aggiungi passaggio
        </button>
        {pickerOpen && (
          <div className="absolute z-20 mt-1 w-full bg-surface-card border border-gray-700 rounded-lg shadow-xl p-1.5">
            {Object.entries(STEP_KINDS).map(([type, kind]) => (
              <div key={type} onClick={() => addStep(type)}
                className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-white/5 cursor-pointer">
                <div className="w-5 h-5 rounded flex items-center justify-center flex-shrink-0" style={{ background: kind.bg, color: kind.color }}>
                  <Icon name={kind.icon} size={11} />
                </div>
                <span className="text-xs text-gray-300">{kind.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 text-[11px] mt-1.5 min-h-[14px]">
        {checking && <span className="text-gray-600">Verifica in corso…</span>}
        {!checking && check && check.valid && (
          <span className="text-green-400 flex items-center gap-1">
            <Icon name="check" size={11} />
            Valida — risultato attuale: <span className="font-mono">{typeof check.value === 'number' ? check.value.toLocaleString('it-IT', { maximumFractionDigits: 2 }) : String(check.value)}</span>
          </span>
        )}
        {!checking && check && !check.valid && (
          <span className="text-red-400 flex items-center gap-1"><Icon name="x" size={11} />{check.errors[0]}</span>
        )}
      </div>

      {check && check.valid && check.breakdown && check.breakdown.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {check.breakdown.map((b, i) => (
            <span key={i} className="text-[10px] bg-surface-page border border-gray-800 text-gray-500 px-2 py-1 rounded-md font-mono">
              {b.label} = {typeof b.value === 'number' ? b.value.toLocaleString('it-IT', { maximumFractionDigits: 2 }) : String(b.value)}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export { newStep, RefPicker, StepChainEditor }
export default StepChainEditor
