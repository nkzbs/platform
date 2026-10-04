import React, { useState, useEffect } from 'react'
import useApi from '../lib/useApi'
import Icon from './Icon'

const EMPTY = { mittente: '', descrizione: '', gruppo: 'Casa', modulo: '', tipo: 'bolletta', categoria: '', attiva: true }
const inputCls = 'w-full bg-surface-page text-ink px-3 py-2 rounded-lg outline-none border border-gray-800 focus:border-accent text-sm placeholder-gray-600'

// Quali mail diventano spese: per ogni mittente, il gruppo (Casa o Personale) e la categoria.
// Tabella gmail_rules, rotte /api/gmail-rules.
export default function GmailRulesPanel({ token, nested = false }) {
  const api = useApi(token)
  const [rows, setRows] = useState(null)
  const [edit, setEdit] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [unknown, setUnknown] = useState([]) // mail che sembrano bollette da mittenti senza regola
  const [dest, setDest] = useState([]) // moduli che possono ricevere righe dalle mail (dichiarati nel Builder)

  const load = async () => {
    const d = await api.get('/gmail-rules'); setRows(Array.isArray(d) ? d.map((x) => ({ id: x.id, data: x })) : [])
    const u = await api.get('/gmail-unknown'); setUnknown(Array.isArray(u) ? u : [])
  }
  useEffect(() => { load(); api.get('/module-roles').then((d) => setDest(Array.isArray(d) ? d.filter((m) => m.kind === 'spesa' && m.uses.includes('mail')) : [])) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    setErr('')
    const d = edit.data
    if (!/^\S+@\S+\.\S+$/.test(d.mittente.trim())) { setErr('Il mittente deve essere un indirizzo email (es. bollette@a2a.it).'); return }
    setBusy(true)
    const body = { ...d, mittente: d.mittente.trim() }
    const res = edit.id ? await api.put('/gmail-rules/' + edit.id, body) : await api.post('/gmail-rules', body)
    setBusy(false)
    if (res.ok) { setEdit(null); load() } else setErr((res.data && res.data.error) || 'Non sono riuscito a salvare.')
  }
  const remove = async (r) => {
    if (!window.confirm('Togliere la regola per ' + r.data.mittente + '?')) return
    await api.del('/gmail-rules/' + r.id); load()
  }
  const toggleActive = async (r) => { await api.put('/gmail-rules/' + r.id, { ...r.data, attiva: r.data.attiva === false }); load() }

  return (
    <section className={nested ? 'mt-4 pt-4 border-t border-gray-800' : 'bg-surface-card border border-gray-800 rounded-xl p-5 mt-4'}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-surface-page border border-gray-800 flex items-center justify-center text-accent flex-shrink-0"><Icon name="mail" size={16} /></div>
          <div>
            <h2 className="text-sm font-semibold text-ink">Regole Gmail</h2>
            <p className="text-xs text-gray-500 mt-0.5 max-w-md">Le mail ricevute da questi mittenti diventano una riga da smistare, nel modulo e nella categoria indicati. Serve Google collegato.</p>
          </div>
        </div>
        {!edit && <button type="button" onClick={() => { setErr(''); setEdit({ id: null, data: { ...EMPTY } }) }} className="text-xs bg-accent hover:opacity-90 text-white px-3 py-1.5 rounded-lg font-medium flex-shrink-0">Aggiungi</button>}
      </div>

      {edit && (
        <div className="mt-4 bg-surface-footer border border-gray-800 rounded-lg p-4 space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <div><label className="block text-xs text-gray-500 mb-1">Mittente (email)</label><input className={inputCls} placeholder="bollette@a2a.it" value={edit.data.mittente} onChange={(e) => setEdit({ ...edit, data: { ...edit.data, mittente: e.target.value } })} /></div>
            <div><label className="block text-xs text-gray-500 mb-1">Descrizione</label><input className={inputCls} placeholder="A2A Energia" value={edit.data.descrizione || ''} onChange={(e) => setEdit({ ...edit, data: { ...edit.data, descrizione: e.target.value } })} /></div>
            <div><label className="block text-xs text-gray-500 mb-1">Modulo di destinazione</label>
              <select className={inputCls} value={edit.data.modulo || ''} onChange={(e) => setEdit({ ...edit, data: { ...edit.data, modulo: e.target.value } })}>
                {dest.length === 0 && <option value="">Nessun modulo dichiarato (Builder → Ruoli del modulo)</option>}
                {dest.length > 0 && !edit.data.modulo && <option value="">Scegli il modulo…</option>}
                {dest.map((m) => <option key={m.module_slug} value={m.module_slug}>{m.name}</option>)}
              </select></div>
            <div><label className="block text-xs text-gray-500 mb-1">Cosa legge dalla mail</label>
              <select className={inputCls} value={edit.data.tipo || 'bolletta'} onChange={(e) => setEdit({ ...edit, data: { ...edit.data, tipo: e.target.value } })}>
                <option value="bolletta">Bolletta: importo e scadenza (da testo e PDF)</option>
                <option value="semplice">Semplice: solo oggetto, data e allegati</option>
              </select></div>
            <div><label className="block text-xs text-gray-500 mb-1">Categoria della riga</label><input className={inputCls} placeholder="Elettricità" value={edit.data.categoria || ''} onChange={(e) => setEdit({ ...edit, data: { ...edit.data, categoria: e.target.value } })} /></div>
          </div>
          {err && <div className="text-xs text-amber-400">{err}</div>}
          <div className="flex gap-2">
            <button type="button" onClick={save} disabled={busy} className="text-xs bg-accent hover:opacity-90 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg font-medium">{busy ? 'Salvo…' : 'Salva'}</button>
            <button type="button" onClick={() => setEdit(null)} className="text-xs text-gray-400 hover:text-gray-200 px-3 py-1.5">Annulla</button>
          </div>
        </div>
      )}

      {unknown.length > 0 && !edit && (
        <div className="mt-4 rounded-lg bg-amber-900/15 border border-amber-900/40 p-3">
          <div className="text-xs font-medium text-amber-400 mb-1">Mail non riconosciute · {unknown.length}</div>
          <div className="text-[11px] text-gray-500 mb-2">Sembrano bollette ma nessuna regola le riconosce, quindi non finiscono in «da smistare». Crea una regola o ignora il mittente.</div>
          <div className="divide-y divide-gray-800">
            {unknown.slice(0, 6).map((u) => (
              <div key={u.id} className="py-1.5 flex items-center gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-ink truncate">{u.oggetto}</div>
                  <div className="text-[11px] text-gray-500 font-mono truncate">{u.mittente}</div>
                </div>
                <button type="button" onClick={() => { setErr(''); setEdit({ id: null, data: { ...EMPTY, mittente: u.mittente, descrizione: u.oggetto.slice(0, 60), modulo: dest.length === 1 ? dest[0].module_slug : '' } }) }} className="text-xs text-accent hover:underline">Crea regola</button>
                <button type="button" onClick={async () => { await api.post('/gmail-unknown/' + u.id + '/ignore', {}); load() }} className="text-xs text-gray-500 hover:text-gray-300">Ignora</button>
              </div>
            ))}
          </div>
          {unknown.length > 6 && <div className="text-[11px] text-gray-500 mt-1">… e altre {unknown.length - 6}</div>}
        </div>
      )}

      <div className="mt-4 divide-y divide-gray-800">
        {rows === null && <div className="text-xs text-gray-600 py-2">Caricamento…</div>}
        {rows && rows.length === 0 && !edit && <div className="text-xs text-gray-500 py-2">Nessuna regola: nessuna mail viene trasformata in spesa.</div>}
        {rows && rows.map((r) => (
          <div key={r.id} className="py-2.5 flex items-center gap-3 flex-wrap">
            <div className="min-w-0 flex-1">
              <div className={'text-sm ' + (r.data.attiva === false ? 'text-gray-500' : 'text-ink')}>{r.data.descrizione || r.data.mittente}</div>
              <div className="text-xs text-gray-500 mt-0.5"><span className="font-mono">{r.data.mittente}</span> → {(dest.find((m) => m.module_slug === r.data.modulo) || {}).name || r.data.gruppo || 'Casa'}{r.data.tipo === 'semplice' ? ' · semplice' : ''}{r.data.categoria ? ' · ' + r.data.categoria : ''}</div>
            </div>
            <button type="button" role="switch" aria-checked={r.data.attiva !== false} onClick={() => toggleActive(r)} title={r.data.attiva === false ? 'Disattivata' : 'Attiva'}
              className={'w-8 h-[18px] rounded-full transition-colors relative flex-shrink-0 ' + (r.data.attiva !== false ? 'bg-accent' : 'bg-gray-700')}>
              <span className={'absolute top-[2px] left-0 w-[14px] h-[14px] rounded-full bg-white transition-transform ' + (r.data.attiva !== false ? 'translate-x-[16px]' : 'translate-x-[2px]')} />
            </button>
            <button type="button" onClick={() => { setErr(''); setEdit({ id: r.id, data: { ...EMPTY, ...r.data } }) }} className="text-xs text-gray-400 hover:text-ink">Modifica</button>
            <button type="button" onClick={() => remove(r)} className="text-xs text-gray-500 hover:text-red-400">Togli</button>
          </div>
        ))}
      </div>
    </section>
  )
}
