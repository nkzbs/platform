import React, { useState } from 'react'
import Icon from '../Icon'
import Select from '../Select'
import { API } from '../../lib/api'

// Editor di un processo dell'analisi: scopo, evento che lo fa partire, input e output, ruoli coinvolti, passaggi in ordine (anche bivi), eccezioni, documenti,
// sistemi, KPI, note, e quale modulo della Libreria lo copre. «Suggerisci con AI» propone i campi dal nome: si applica SOLO ai campi ancora vuoti, mai a quelli già scritti.
// I ruoli di tipo «utente» diventano ruoli reali nel tenant; i passaggi diventano gli stati del flusso del modulo.
const TIPO_RUOLO = [{ value: 'utente', label: 'Utente (diventa un ruolo nel tenant)' }, { value: 'sistema', label: 'Sistema (automatico)' }, { value: 'esterno', label: 'Esterno (es. commercialista)' }]
const TIPO_CALLOUT = [{ value: 'nota', label: 'Nota' }, { value: 'limite', label: 'Limite di processo' }, { value: 'lezione', label: 'Lezione appresa' }]
const COPERTURA = [{ value: 'da_valutare', label: 'Da valutare' }, { value: 'coperto', label: 'Coperto' }, { value: 'da_costruire', label: 'Da costruire' }]
const inputClass = 'bg-surface-page text-ink px-3 py-2 rounded-lg outline-none border border-gray-800 focus:border-cp-primary transition text-sm disabled:opacity-60 min-w-0'

const Field = ({ label, children }) => <div><label className="text-xs text-gray-500 mb-1 block">{label}</label>{children}</div>
const Section = ({ label, children }) => (
  <div className="bg-surface-page/60 rounded-lg p-3 border border-gray-800/60">
    <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-2">{label}</div>
    <div className="space-y-2.5">{children}</div>
  </div>
)
const IconButton = ({ icon, onClick, title, danger }) => (
  <button type="button" onClick={onClick} title={title} aria-label={title} className={'flex-shrink-0 p-1 transition ' + (danger ? 'text-gray-600 hover:text-red-400' : 'text-gray-600 hover:text-ink')}><Icon name={icon} size={14} /></button>
)
const AddButton = ({ onClick, children }) => (
  <button type="button" onClick={onClick} className="text-sm text-cp-primary hover:opacity-80 transition flex items-center gap-1 mt-1.5"><Icon name="plus" size={11} />{children}</button>
)

function RuoliField({ value, onChange, disabled }) {
  const ruoli = value || []
  const update = (i, patch) => onChange(ruoli.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-1">Ruoli coinvolti</div>
      <div className="space-y-1.5">
        {ruoli.map((r, i) => (
          <div key={i} className="flex items-center gap-1.5 flex-wrap">
            <input disabled={disabled} placeholder="Nome ruolo (es. Ricezione)" className={'flex-1 min-w-[140px] ' + inputClass} value={r.nome || ''} onChange={(e) => update(i, { nome: e.target.value })} />
            <select disabled={disabled} className={inputClass} value={r.tipo || 'utente'} onChange={(e) => update(i, { tipo: e.target.value })}>{TIPO_RUOLO.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select>
            {!disabled && <IconButton icon="x" danger onClick={() => onChange(ruoli.filter((_, idx) => idx !== i))} title="Togli il ruolo" />}
          </div>
        ))}
      </div>
      {!disabled && <AddButton onClick={() => onChange([...ruoli, { nome: '', tipo: 'utente' }])}>Aggiungi ruolo</AddButton>}
    </div>
  )
}

// Un passaggio è «step» o «decisione» (un bivio, rombo ambra): resta una lista in ordine, si segna solo DOVE c'è il bivio.
function PassaggiField({ value, onChange, disabled, ruoliDisponibili }) {
  const passaggi = value || []
  const update = (i, patch) => onChange(passaggi.map((p, idx) => (idx === i ? { ...p, ...patch } : p)))
  const move = (i, dir) => { const j = i + dir; if (j < 0 || j >= passaggi.length) return; const n = [...passaggi]; [n[i], n[j]] = [n[j], n[i]]; onChange(n) }
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-1">Passaggi (in ordine)</div>
      <datalist id="ruoli-datalist">{ruoliDisponibili.map((r) => <option key={r} value={r} />)}</datalist>
      <div className="space-y-1.5">
        {passaggi.map((p, i) => {
          const dec = p.tipo === 'decisione'
          return (
            <div key={i} className={'flex items-start gap-1.5 bg-surface-card rounded-lg p-1.5 border ' + (dec ? 'border-amber-800/60' : 'border-gray-800')}>
              <button type="button" disabled={disabled} title={dec ? 'Bivio: tocca per renderlo un passaggio normale' : 'Passaggio normale: tocca per segnarlo come bivio'} onClick={() => update(i, { tipo: dec ? 'step' : 'decisione' })}
                className={'w-5 h-5 flex-shrink-0 mt-1.5 flex items-center justify-center text-[10px] font-semibold transition ' + (dec ? 'rotate-45 bg-amber-900/40 text-amber-400 border border-amber-700' : 'rounded-full bg-gray-800 text-gray-400')}>
                <span className={dec ? '-rotate-45' : ''}>{i + 1}</span>
              </button>
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex gap-1.5 flex-wrap">
                  <input disabled={disabled} placeholder={dec ? 'Domanda del bivio (es. Preventivo approvato?)' : 'Titolo del passaggio'} className={'flex-1 min-w-[140px] ' + inputClass} value={p.titolo || ''} onChange={(e) => update(i, { titolo: e.target.value })} />
                  <input disabled={disabled} list="ruoli-datalist" placeholder="Ruolo" className={'w-28 flex-shrink-0 ' + inputClass} value={p.ruolo || ''} onChange={(e) => update(i, { ruolo: e.target.value })} />
                </div>
                <input disabled={disabled} placeholder={dec ? 'Esiti possibili (es. Sì: prosegue, No: torna al cliente)' : 'Descrizione'} className={'w-full ' + inputClass} value={p.descrizione || ''} onChange={(e) => update(i, { descrizione: e.target.value })} />
              </div>
              {!disabled && (
                <div className="flex flex-col items-center flex-shrink-0">
                  <IconButton icon="arrow-up" onClick={() => move(i, -1)} title="Sposta su" />
                  <IconButton icon="arrow-down" onClick={() => move(i, 1)} title="Sposta giù" />
                  <IconButton icon="x" danger onClick={() => onChange(passaggi.filter((_, idx) => idx !== i))} title="Togli il passaggio" />
                </div>
              )}
            </div>
          )
        })}
      </div>
      {!disabled && <AddButton onClick={() => onChange([...passaggi, { titolo: '', ruolo: '', descrizione: '', tipo: 'step' }])}>Aggiungi passaggio</AddButton>}
    </div>
  )
}

function StringListField({ label, value, onChange, disabled, placeholder }) {
  const items = value || []
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-1">{label}</div>
      <div className="space-y-1.5">
        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input disabled={disabled} placeholder={placeholder} className={'flex-1 ' + inputClass} value={item} onChange={(e) => onChange(items.map((x, idx) => (idx === i ? e.target.value : x)))} />
            {!disabled && <IconButton icon="x" danger onClick={() => onChange(items.filter((_, idx) => idx !== i))} title="Togli" />}
          </div>
        ))}
      </div>
      {!disabled && <AddButton onClick={() => onChange([...items, ''])}>Aggiungi</AddButton>}
    </div>
  )
}

function CalloutField({ value, onChange, disabled }) {
  const items = value || []
  const update = (i, patch) => onChange(items.map((x, idx) => (idx === i ? { ...x, ...patch } : x)))
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-1">Note</div>
      <div className="space-y-1.5">
        {items.map((c, i) => (
          <div key={i} className="flex items-start gap-1.5 flex-wrap">
            <select disabled={disabled} className={'w-36 flex-shrink-0 ' + inputClass} value={c.tipo || 'nota'} onChange={(e) => update(i, { tipo: e.target.value })}>{TIPO_CALLOUT.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select>
            <input disabled={disabled} placeholder="Testo" className={'flex-1 min-w-[140px] ' + inputClass} value={c.testo || ''} onChange={(e) => update(i, { testo: e.target.value })} />
            {!disabled && <IconButton icon="x" danger onClick={() => onChange(items.filter((_, idx) => idx !== i))} title="Togli" />}
          </div>
        ))}
      </div>
      {!disabled && <AddButton onClick={() => onChange([...items, { tipo: 'nota', testo: '' }])}>Aggiungi nota</AddButton>}
    </div>
  )
}

// Un processo ha ancora da compilare qualcosa di importante?
export const needsEnrichment = (p) => !p.scopo || !p.evento_innesco || !p.input || !p.output || !(p.passaggi && p.passaggi.length)

// Cosa applicare di un suggerimento a un processo: SOLO i campi ancora vuoti, mai ciò che è già scritto. Usata dal bottone del singolo processo e da «Completa tutti».
export function applySuggestion(p, s) {
  const patch = {}
  for (const k of ['scopo', 'evento_innesco', 'output', 'input']) if (!p[k] && s[k]) patch[k] = s[k]
  for (const k of ['ruoli_coinvolti', 'passaggi', 'sistemi_coinvolti', 'kpi']) if ((!p[k] || p[k].length === 0) && s[k] && s[k].length) patch[k] = s[k]
  if (!p.registry_module_id && s.registry_module_id) { patch.registry_module_id = s.registry_module_id; patch.copertura = 'coperto' }
  if (!s.registry_module_id && s.registry_module_reasoning) { patch.registry_module_reasoning = s.registry_module_reasoning; if (!p.registry_module_id && (!p.copertura || p.copertura === 'da_valutare')) patch.copertura = 'da_costruire' }
  return patch
}

function SuggestAI({ p, onChange, token, modules }) {
  const [state, setState] = useState('idle') // idle | loading | error | ready
  const [error, setError] = useState('')
  const [s, setS] = useState(null)
  const suggest = async () => {
    setState('loading'); setError('')
    try {
      const res = await fetch(API + '/analyses/suggest-processo', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ nome: p.nome, reparto: p.reparto }) })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Errore'); setState('error'); return }
      setS(data); setState('ready')
    } catch (e) { setError('Errore di rete'); setState('error') }
  }
  // «Applica» riempie SOLO ciò che è ancora vuoto
  const apply = () => { onChange(applySuggestion(p, s)); setState('idle'); setS(null) }
  if (state === 'idle') {
    const ok = p.nome && p.nome.trim()
    return (
      <button type="button" onClick={suggest} disabled={!ok} className="w-full text-left bg-cp-primary/10 hover:bg-cp-primary/20 disabled:opacity-40 border border-cp-primary/30 px-3.5 py-3 rounded-lg transition flex items-center gap-3">
        <span className="w-8 h-8 rounded-full bg-cp-primary/20 text-cp-primary flex items-center justify-center flex-shrink-0"><Icon name="sparkles" size={15} /></span>
        <span><span className="text-sm text-cp-primary font-medium block">Suggerisci con AI</span><span className="text-xs text-gray-500 block mt-0.5">{ok ? 'Propone scopo, passaggi, ruoli e modulo dal nome del processo' : 'Scrivi prima il nome del processo'}</span></span>
      </button>
    )
  }
  if (state === 'loading') return <div className="text-sm text-gray-400 flex items-center gap-2 px-1 py-1"><Icon name="sparkles" size={13} className="animate-pulse" />Preparo i suggerimenti…</div>
  if (state === 'error') return <div className="bg-red-900/20 border border-red-900/40 rounded-lg px-3 py-2 text-xs text-red-400 flex items-center justify-between gap-2"><span>{error}</span><button type="button" onClick={() => setState('idle')} className="text-gray-500 hover:text-ink flex-shrink-0">Chiudi</button></div>
  const mod = s.registry_module_id ? modules.find((m) => m.id === s.registry_module_id) : null
  return (
    <div className="bg-cp-primary/10 border border-cp-primary/30 rounded-lg p-2.5 space-y-1.5">
      <div className="text-xs uppercase tracking-wide text-cp-primary font-semibold flex items-center gap-1"><Icon name="sparkles" size={11} />Suggerimento</div>
      {s.scopo && <div className="text-sm text-gray-300"><span className="text-gray-500">Scopo: </span>{s.scopo}</div>}
      {s.evento_innesco && <div className="text-sm text-gray-300"><span className="text-gray-500">Evento: </span>{s.evento_innesco}</div>}
      {s.output && <div className="text-sm text-gray-300"><span className="text-gray-500">Output: </span>{s.output}</div>}
      {s.passaggi.length > 0 && <div className="text-sm text-gray-300"><span className="text-gray-500">Passaggi: </span>{s.passaggi.length} proposti</div>}
      {s.ruoli_coinvolti.length > 0 && <div className="text-sm text-gray-300"><span className="text-gray-500">Ruoli: </span>{s.ruoli_coinvolti.map((r) => r.nome).join(', ')}</div>}
      {mod ? <div className="text-sm text-gray-300"><span className="text-gray-500">Modulo consigliato: </span>{mod.name}{s.registry_module_reasoning ? ' (' + s.registry_module_reasoning + ')' : ''}</div>
        : s.registry_module_reasoning && <div className="text-sm text-gray-500 italic">{s.registry_module_reasoning}</div>}
      <div className="flex gap-1.5 pt-1 flex-wrap">
        <button type="button" onClick={apply} className="text-sm bg-cp-primary hover:bg-cp-primary-hover text-white px-3 py-1.5 rounded-lg transition">Applica ai campi vuoti</button>
        <button type="button" onClick={() => { setState('idle'); setS(null) }} className="text-sm bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-1.5 rounded-lg transition">Scarta</button>
      </div>
    </div>
  )
}

// La descrizione del modulo da costruire, dal processo: è ciò che si manda al Super Builder, che lo propone e tu lo rifinisci.
export function promptModulo(p) {
  const l = [`Modulo «${p.nome}»${p.reparto ? ' (' + p.reparto + ')' : ''}.`]
  if (p.scopo) l.push('Scopo: ' + p.scopo + '.')
  if (p.evento_innesco) l.push('Parte quando: ' + p.evento_innesco + '.')
  if (p.input) l.push('Serve già pronto: ' + p.input + '.')
  if (p.output) l.push('Produce: ' + p.output + '.')
  if ((p.passaggi || []).length) l.push('Passaggi in ordine (diventano gli stati del flusso): ' + p.passaggi.map((s, i) => (i + 1) + '. ' + (s.titolo || s.descrizione) + (s.ruolo ? ' [' + s.ruolo + ']' : '')).join('; ') + '.')
  if ((p.ruoli_coinvolti || []).length) l.push('Ruoli: ' + p.ruoli_coinvolti.map((r) => r.nome).join(', ') + '.')
  if ((p.documenti_collegati || []).length) l.push('Documenti: ' + p.documenti_collegati.join(', ') + '.')
  return l.join(' ')
}

export default function ProcessoEditor({ processo, onChange, onRemove, modules, token, onBuild, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  const p = processo
  const ruoliDisponibili = (p.ruoli_coinvolti || []).map((r) => r.nome).filter(Boolean)
  const copertura = p.copertura || 'da_valutare'
  const badge = copertura === 'coperto' ? 'bg-green-900/30 text-green-400' : copertura === 'da_costruire' ? 'bg-red-900/30 text-red-400' : 'bg-gray-800 text-gray-400'
  return (
    <div className="bg-surface-card rounded-lg border border-gray-800 overflow-hidden">
      <div className="flex items-center flex-wrap gap-1.5 p-2">
        <button type="button" onClick={() => setOpen((x) => !x)} aria-label={open ? 'Chiudi' : 'Apri'} className="text-gray-500 hover:text-ink transition flex-shrink-0"><Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} /></button>
        <input placeholder="Nome del processo (es. Accettazione)" className={'flex-1 min-w-[160px] ' + inputClass} value={p.nome || ''} onChange={(e) => onChange({ nome: e.target.value })} />
        <span className={'text-[11px] px-2 py-1 rounded flex-shrink-0 ' + badge}>{COPERTURA.find((c) => c.value === copertura).label}</span>
        <IconButton icon="x" danger onClick={onRemove} title="Togli il processo" />
      </div>
      {open && (
        <div className="p-3 pt-2.5 space-y-3 border-t border-gray-800">
          {needsEnrichment(p) && <SuggestAI p={p} onChange={onChange} token={token} modules={modules} />}
          <Section label="Modulo che lo copre">
            <div className="flex gap-2 flex-wrap items-center">
              <Select className="flex-1 min-w-[180px]" placeholder="Nessun modulo scelto…" value={p.registry_module_id || ''} options={modules.map((m) => ({ value: m.id, label: m.name }))}
                onChange={(val) => { const id = val ? parseInt(val, 10) : null; onChange({ registry_module_id: id, copertura: id ? 'coperto' : (copertura === 'da_costruire' ? 'da_costruire' : 'da_valutare') }) }} />
              <Select className="w-40" value={copertura} options={COPERTURA} onChange={(val) => onChange({ copertura: val })} />
            </div>
            <div>
              <div className="text-[11px] text-gray-500 mb-1">Altri moduli che usa</div>
              <div className="flex gap-1.5 flex-wrap items-center">
                {(p.moduli_extra || []).map((id) => { const m = modules.find((x) => x.id === id); return m ? <span key={id} className="text-xs bg-gray-800 text-gray-200 rounded-md pl-2 pr-1 py-1 flex items-center gap-1">{m.name}<button type="button" aria-label={'Togli ' + m.name} onClick={() => onChange({ moduli_extra: p.moduli_extra.filter((x) => x !== id) })} className="text-gray-500 hover:text-red-400 px-1">×</button></span> : null })}
                <Select className="w-44" placeholder="+ Aggiungi modulo…" value="" options={modules.filter((m) => m.id !== p.registry_module_id && !(p.moduli_extra || []).includes(m.id)).map((m) => ({ value: m.id, label: m.name }))}
                  onChange={(val) => val && onChange({ moduli_extra: [...(p.moduli_extra || []), parseInt(val, 10)] })} />
              </div>
            </div>
            {(p.manca || []).length > 0 && (
              <div className="text-xs text-amber-400 flex items-start gap-1.5"><Icon name="alert-triangle" size={12} className="mt-0.5 flex-shrink-0" /><span>Nessun modulo copre: {p.manca.join('; ')}.</span></div>
            )}
            {copertura === 'da_costruire' && !p.registry_module_id && (
              <div className="text-xs text-gray-500 flex items-start gap-1.5"><Icon name="alert-triangle" size={12} className="text-red-400 mt-0.5 flex-shrink-0" /><span>Nessun modulo copre questo processo.{p.registry_module_reasoning ? ' ' + p.registry_module_reasoning : ''}</span></div>
            )}
            {copertura === 'da_costruire' && !p.registry_module_id && onBuild && (
              <button type="button" onClick={() => onBuild({ prompt: promptModulo(p), moduleName: p.nome })} className="text-xs bg-cp-primary/20 hover:bg-cp-primary/30 text-cp-primary px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 w-fit"><Icon name="sparkles" size={12} />Costruiscilo nel Super Builder</button>
            )}
          </Section>
          <Section label="Il processo">
            <Field label="Scopo"><input placeholder="Es. Trasformare un ordine in un lavoro consegnato" className={'w-full ' + inputClass} value={p.scopo || ''} onChange={(e) => onChange({ scopo: e.target.value })} /></Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <Field label="Cosa lo fa partire"><input placeholder="Es. Arriva un cliente" className={'w-full ' + inputClass} value={p.evento_innesco || ''} onChange={(e) => onChange({ evento_innesco: e.target.value })} /></Field>
              <Field label="Cosa serve già pronto"><input placeholder="Es. Anagrafica cliente" className={'w-full ' + inputClass} value={p.input || ''} onChange={(e) => onChange({ input: e.target.value })} /></Field>
              <Field label="Cosa produce"><input placeholder="Es. Lavoro accettato" className={'w-full ' + inputClass} value={p.output || ''} onChange={(e) => onChange({ output: e.target.value })} /></Field>
              <Field label="Reparto"><input placeholder="Es. Ricezione" className={'w-full ' + inputClass} value={p.reparto || ''} onChange={(e) => onChange({ reparto: e.target.value })} /></Field>
            </div>
          </Section>
          <div className="bg-surface-page/60 rounded-lg p-3 border border-gray-800/60 space-y-3">
            <RuoliField value={p.ruoli_coinvolti} onChange={(v) => onChange({ ruoli_coinvolti: v })} />
            <PassaggiField value={p.passaggi} onChange={(v) => onChange({ passaggi: v })} ruoliDisponibili={ruoliDisponibili} />
          </div>
          <div className="bg-surface-page/60 rounded-lg p-3 border border-gray-800/60 space-y-3">
            <StringListField label="Eccezioni" value={p.eccezioni} onChange={(v) => onChange({ eccezioni: v })} placeholder="Es. Lavoro urgente: salta il preventivo" />
            <StringListField label="Documenti collegati" value={p.documenti_collegati} onChange={(v) => onChange({ documenti_collegati: v })} placeholder="Es. Modulo di accettazione" />
            <StringListField label="Sistemi coinvolti" value={p.sistemi_coinvolti} onChange={(v) => onChange({ sistemi_coinvolti: v })} placeholder="Es. Foglio Excel condiviso" />
            <StringListField label="KPI" value={p.kpi} onChange={(v) => onChange({ kpi: v })} placeholder="Es. Preventivo inviato entro 24 ore" />
            <CalloutField value={p.callout} onChange={(v) => onChange({ callout: v })} />
          </div>
        </div>
      )}
    </div>
  )
}
