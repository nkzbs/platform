import React, { useState, useEffect } from 'react'
import useApi from '../lib/useApi'
import Icon from './Icon'

const EMPTY = { mittente: '', descrizione: '', gruppo: 'Casa', categoria: '', attiva: true }
const inputCls = 'w-full bg-surface-page text-ink px-3 py-2 rounded-lg outline-none border border-gray-800 focus:border-accent text-sm placeholder-gray-600'

// Quali mail diventano spese: per ogni mittente, il gruppo (Casa o Personale) e la categoria.
// Tabella gmail_rules, rotte /api/gmail-rules.
export default function GmailRulesPanel({ token, nested = false }) {
  const api = useApi(token)
  const [rows, setRows] = useState(null)
  const [edit, setEdit] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const load = async () => { const d = await api.get('/gmail-rules'); setRows(Array.isArray(d) ? d.map((x) => ({ id: x.id, data: x })) : []) }
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

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
            <p className="text-xs text-gray-500 mt-0.5 max-w-md">Le mail ricevute da questi mittenti diventano una spesa da smistare, nel gruppo e nella categoria indicati. Serve Google collegato.</p>
          </div>
        </div>
        {!edit && <button type="button" onClick={() => { setErr(''); setEdit({ id: null, data: { ...EMPTY } }) }} className="text-xs bg-accent hover:opacity-90 text-white px-3 py-1.5 rounded-lg font-medium flex-shrink-0">Aggiungi</button>}
      </div>

      {edit && (
        <div className="mt-4 bg-surface-footer border border-gray-800 rounded-lg p-4 space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <div><label className="block text-xs text-gray-500 mb-1">Mittente (email)</label><input className={inputCls} placeholder="bollette@a2a.it" value={edit.data.mittente} onChange={(e) => setEdit({ ...edit, data: { ...edit.data, mittente: e.target.value } })} /></div>
            <div><label className="block text-xs text-gray-500 mb-1">Descrizione</label><input className={inputCls} placeholder="A2A Energia" value={edit.data.descrizione || ''} onChange={(e) => setEdit({ ...edit, data: { ...edit.data, descrizione: e.target.value } })} /></div>
            <div><label className="block text-xs text-gray-500 mb-1">Gruppo</label>
              <select className={inputCls} value={edit.data.gruppo || 'Casa'} onChange={(e) => setEdit({ ...edit, data: { ...edit.data, gruppo: e.target.value } })}><option>Casa</option><option>Personale</option></select></div>
            <div><label className="block text-xs text-gray-500 mb-1">Categoria della spesa</label><input className={inputCls} placeholder="Elettricità" value={edit.data.categoria || ''} onChange={(e) => setEdit({ ...edit, data: { ...edit.data, categoria: e.target.value } })} /></div>
          </div>
          {err && <div className="text-xs text-amber-400">{err}</div>}
          <div className="flex gap-2">
            <button type="button" onClick={save} disabled={busy} className="text-xs bg-accent hover:opacity-90 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg font-medium">{busy ? 'Salvo…' : 'Salva'}</button>
            <button type="button" onClick={() => setEdit(null)} className="text-xs text-gray-400 hover:text-gray-200 px-3 py-1.5">Annulla</button>
          </div>
        </div>
      )}

      <div className="mt-4 divide-y divide-gray-800">
        {rows === null && <div className="text-xs text-gray-600 py-2">Caricamento…</div>}
        {rows && rows.length === 0 && !edit && <div className="text-xs text-gray-500 py-2">Nessuna regola: nessuna mail viene trasformata in spesa.</div>}
        {rows && rows.map((r) => (
          <div key={r.id} className="py-2.5 flex items-center gap-3 flex-wrap">
            <div className="min-w-0 flex-1">
              <div className={'text-sm ' + (r.data.attiva === false ? 'text-gray-500' : 'text-ink')}>{r.data.descrizione || r.data.mittente}</div>
              <div className="text-xs text-gray-500 mt-0.5"><span className="font-mono">{r.data.mittente}</span> → {r.data.gruppo || 'Casa'}{r.data.categoria ? ' · ' + r.data.categoria : ''}</div>
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
