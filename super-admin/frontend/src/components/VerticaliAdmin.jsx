import React, { useState, useEffect } from 'react'
import { API } from '../lib/api'
import Icon from './Icon'
import { MODULE_ICON_CHOICES } from '@shared/builder/constants.js'

// I verticali proposti ai tenant: gruppi di moduli con nome, icona e descrizione. Sono solo dati: i tenant li vedono come tessere in «Parti da un modello» e
// li installano scegliendo i moduli. Si crea scegliendo tra i moduli presenti in Libreria (si salva lo slug, che resta uguale tra una versione e l'altra).
// Eliminare un verticale non toglie i moduli da nessuna parte.
export default function VerticaliAdmin({ token, modules }) {
  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }
  const [lista, setLista] = useState([])
  const [aperto, setAperto] = useState(false)
  const [form, setForm] = useState(null) // { id?, name, icon, description, module_slugs, cerca }
  const [errore, setErrore] = useState('')
  const [info, setInfo] = useState('')
  const carica = () => fetch(API + '/registry/verticals', { headers }).then((r) => r.ok ? r.json() : []).then(setLista)
  useEffect(() => { carica() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const libreria = [...new Map(modules.map((m) => [m.slug, m])).values()].sort((a, b) => a.name.localeCompare(b.name))
  const salva = async () => {
    setErrore('')
    const r = await fetch(API + '/registry/verticals' + (form.id ? '/' + form.id : ''), { method: form.id ? 'PATCH' : 'POST', headers, body: JSON.stringify({ name: form.name, icon: form.icon, description: form.description, module_slugs: form.module_slugs }) })
    if (!r.ok) { setErrore(((await r.json().catch(() => ({}))).error) || 'Non riuscito'); return }
    setForm(null); carica()
  }
  const elimina = async (v) => {
    if (!window.confirm('Eliminare il verticale «' + v.name + '»? I moduli restano in Libreria e nei tenant dove sono già installati.')) return
    await fetch(API + '/registry/verticals/' + v.id, { method: 'DELETE', headers }); carica()
  }
  const ripristina = async () => {
    const r = await fetch(API + '/registry/verticals-ripristina', { method: 'POST', headers })
    const d = await r.json().catch(() => ({})); setInfo(r.ok ? (d.aggiunti ? d.aggiunti + ' verticale/i predefinito/i rimesso/i.' : 'Ci sono già tutti i predefiniti.') : (d.error || 'Non riuscito')); carica()
  }
  const toggle = (slug) => setForm((f) => ({ ...f, module_slugs: f.module_slugs.includes(slug) ? f.module_slugs.filter((x) => x !== slug) : [...f.module_slugs, slug] }))
  const input = 'w-full bg-surface-page text-ink px-3 py-2 rounded-lg text-sm outline-none border border-gray-800 focus:border-cp-primary'

  return (
    <section className="bg-surface-card border border-gray-800 rounded-xl p-4 mb-5">
      <button type="button" onClick={() => setAperto(!aperto)} className="w-full flex items-center justify-between gap-3 text-left">
        <span className="text-sm font-semibold text-ink">Verticali ({lista.length})</span>
        <Icon name={aperto ? 'chevron-down' : 'chevron-right'} size={14} />
      </button>
      {aperto && (
        <div className="mt-3">
          <p className="text-xs text-gray-500 mb-3">Punti di partenza che i tenant vedono in Libreria, sotto «Parti da un modello». Un verticale è un gruppo di moduli che funzionano insieme.</p>
          <div className="flex gap-2 flex-wrap mb-3">
            <button type="button" onClick={() => { setErrore(''); setForm({ name: '', icon: 'box', description: '', module_slugs: [], cerca: '' }) }} className="text-xs px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200 flex items-center gap-1.5"><Icon name="plus" size={13} />Nuovo verticale</button>
            <button type="button" onClick={ripristina} className="text-xs px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400" title="Rimette quelli predefiniti che hai eliminato, senza toccare gli altri">Ripristina i predefiniti</button>
          </div>
          {info && <div className="text-xs text-gray-400 mb-2">{info}</div>}
          <div className="divide-y divide-gray-800">
            {lista.map((v) => (
              <div key={v.id} className="py-2.5 flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-cp-primary/15 text-cp-primary flex items-center justify-center flex-shrink-0"><Icon name={v.icon} size={16} /></div>
                <div className="min-w-0 flex-1">
                  <div className="text-ink text-sm truncate">{v.name} <span className="text-gray-500 text-xs">· {v.moduli.length} moduli</span></div>
                  <div className="text-xs text-gray-500 truncate">{v.moduli.map((m) => m.name).join(', ')}{v.mancanti ? ' · ' + v.mancanti + ' non più in Libreria' : ''}</div>
                </div>
                <button type="button" onClick={() => { setErrore(''); setForm({ ...v, cerca: '' }) }} className="text-xs text-gray-400 hover:text-ink">Modifica</button>
                <button type="button" onClick={() => elimina(v)} className="text-xs text-gray-500 hover:text-red-400">Elimina</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {form && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setForm(null)}>
          <div className="bg-surface-card rounded-xl w-full max-w-lg border border-gray-800 p-5 max-h-[88vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-ink mb-3">{form.id ? 'Modifica verticale' : 'Nuovo verticale'}</h2>
            <label className="text-xs text-gray-500 block mb-1">Nome</label>
            <input className={input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <label className="text-xs text-gray-500 block mb-1 mt-3">A cosa serve</label>
            <textarea className={input + ' min-h-[60px]'} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <label className="text-xs text-gray-500 block mb-1 mt-3">Icona</label>
            <div className="flex flex-wrap gap-1.5">
              {MODULE_ICON_CHOICES.map((i) => <button key={i} type="button" onClick={() => setForm({ ...form, icon: i })} className={'w-9 h-9 rounded-lg flex items-center justify-center ' + (form.icon === i ? 'bg-cp-primary text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700')}><Icon name={i} size={16} /></button>)}
            </div>
            <label className="text-xs text-gray-500 block mb-1 mt-3">Moduli ({form.module_slugs.length} scelti)</label>
            <input className={input + ' mb-2'} placeholder="Cerca nella Libreria…" value={form.cerca} onChange={(e) => setForm({ ...form, cerca: e.target.value })} />
            <div className="max-h-56 overflow-y-auto border border-gray-800 rounded-lg divide-y divide-gray-800">
              {libreria.filter((m) => !form.cerca || (m.name + ' ' + m.slug).toLowerCase().includes(form.cerca.toLowerCase())).map((m) => (
                <label key={m.slug} className="flex items-center gap-2 px-3 py-1.5 text-sm text-ink cursor-pointer hover:bg-gray-800/50">
                  <input type="checkbox" checked={form.module_slugs.includes(m.slug)} onChange={() => toggle(m.slug)} />
                  <span className="truncate">{m.name}</span>
                </label>
              ))}
            </div>
            {errore && <div className="text-xs text-amber-400 mt-2">{errore}</div>}
            <div className="flex gap-2 mt-4 justify-end">
              <button onClick={() => setForm(null)} className="text-sm px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300">Annulla</button>
              <button onClick={salva} className="text-sm px-4 py-2 rounded-lg bg-cp-primary hover:bg-cp-primary-hover text-white">Salva</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
