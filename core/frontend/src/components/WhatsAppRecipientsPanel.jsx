import React, { useState, useEffect } from 'react'
import useApi from '../lib/useApi'
import Icon from './Icon'

const TAGS = [
  { id: 'scadenza', label: 'Scadenze', hint: 'Riepilogo del mattino e avvisi di scadenza' },
  { id: 'bolletta', label: 'Bollette', hint: 'Una bolletta nuova da smistare' },
  { id: 'rata', label: 'Rate', hint: 'Rate in arrivo' },
  { id: 'report', label: 'Report', hint: 'Il report periodico' },
  { id: 'backup', label: 'Backup', hint: 'Esito dei backup' },
  { id: 'saldo_basso', label: 'Saldo basso', hint: 'Un conto scende sotto la soglia' },
]
const EMPTY = { nome: '', numero: '', triggers: ['scadenza'], attivo: true }
const inputCls = 'w-full bg-surface-page text-ink px-3 py-2 rounded-lg outline-none border border-gray-800 focus:border-accent text-sm placeholder-gray-600'

// Chi riceve quali messaggi WhatsApp (tabella whatsapp_recipients, rotte /api/whatsapp-recipients).
export default function WhatsAppRecipientsPanel({ token, nested = false }) {
  const api = useApi(token)
  const [rows, setRows] = useState(null)
  const [edit, setEdit] = useState(null) // { id|null, data }
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const load = async () => { const d = await api.get('/whatsapp-recipients'); setRows(Array.isArray(d) ? d.map((x) => ({ id: x.id, data: x })) : []) }
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    setErr('')
    const d = edit.data
    if (!d.nome.trim() || !d.numero.trim()) { setErr('Servono nome e numero.'); return }
    setBusy(true)
    const res = edit.id ? await api.put('/whatsapp-recipients/' + edit.id, d) : await api.post('/whatsapp-recipients', d)
    setBusy(false)
    if (res.ok) { setEdit(null); load() } else setErr((res.data && res.data.error) || 'Non sono riuscito a salvare.')
  }
  const remove = async (r) => {
    if (!window.confirm('Togliere ' + r.data.nome + ' dai destinatari?')) return
    await api.del('/whatsapp-recipients/' + r.id); load()
  }
  const toggleActive = async (r) => { await api.put('/whatsapp-recipients/' + r.id, { ...r.data, attivo: r.data.attivo === false }); load() }
  const setTag = (id) => setEdit((e) => { const t = e.data.triggers || []; return { ...e, data: { ...e.data, triggers: t.includes(id) ? t.filter((x) => x !== id) : [...t, id] } } })

  return (
    <section className={nested ? 'mt-4 pt-4 border-t border-gray-800' : 'bg-surface-card border border-gray-800 rounded-xl p-5'}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-surface-page border border-gray-800 flex items-center justify-center text-accent flex-shrink-0"><Icon name="message-circle" size={16} /></div>
          <div>
            <h2 className="text-sm font-semibold text-ink">Destinatari WhatsApp</h2>
            <p className="text-xs text-gray-500 mt-0.5 max-w-md">Chi riceve i messaggi e di quali notifiche. Funziona con il collegamento WhatsApp in Connessioni.</p>
          </div>
        </div>
        {!edit && <button type="button" onClick={() => { setErr(''); setEdit({ id: null, data: { ...EMPTY } }) }} className="text-xs bg-accent hover:opacity-90 text-white px-3 py-1.5 rounded-lg font-medium flex-shrink-0">Aggiungi</button>}
      </div>

      {edit && (
        <div className="mt-4 bg-surface-footer border border-gray-800 rounded-lg p-4 space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <div><label className="block text-xs text-gray-500 mb-1">Nome</label><input className={inputCls} value={edit.data.nome} onChange={(e) => setEdit({ ...edit, data: { ...edit.data, nome: e.target.value } })} /></div>
            <div><label className="block text-xs text-gray-500 mb-1">Numero (con prefisso)</label><input className={inputCls} placeholder="+39 333 1234567" value={edit.data.numero} onChange={(e) => setEdit({ ...edit, data: { ...edit.data, numero: e.target.value } })} /></div>
          </div>
          <div>
            <div className="text-xs text-gray-500 mb-1.5">Quali notifiche riceve</div>
            <div className="flex flex-wrap gap-2">
              {TAGS.map((t) => {
                const on = (edit.data.triggers || []).includes(t.id)
                return <button key={t.id} type="button" title={t.hint} onClick={() => setTag(t.id)} className={'px-2.5 py-1 rounded-full text-xs border transition ' + (on ? 'bg-accent/15 border-accent text-accent' : 'border-gray-700 text-gray-400 hover:border-gray-500')}>{t.label}</button>
              })}
            </div>
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
        {rows && rows.length === 0 && !edit && <div className="text-xs text-gray-500 py-2">Nessun destinatario: nessun messaggio WhatsApp parte. Aggiungi il tuo numero.</div>}
        {rows && rows.map((r) => (
          <div key={r.id} className="py-2.5 flex items-center gap-3 flex-wrap">
            <div className="min-w-0 flex-1">
              <div className={'text-sm ' + (r.data.attivo === false ? 'text-gray-500' : 'text-ink')}>{r.data.nome} <span className="text-gray-500 font-mono text-xs">{r.data.numero}</span></div>
              <div className="text-xs text-gray-500 mt-0.5">{(r.data.triggers || []).map((t) => (TAGS.find((x) => x.id === t) || { label: t }).label).join(' · ') || 'Nessuna notifica'}</div>
            </div>
            <button type="button" role="switch" aria-checked={r.data.attivo !== false} onClick={() => toggleActive(r)} title={r.data.attivo === false ? 'Disattivato' : 'Attivo'}
              className={'w-8 h-[18px] rounded-full transition-colors relative flex-shrink-0 ' + (r.data.attivo !== false ? 'bg-accent' : 'bg-gray-700')}>
              <span className={'absolute top-[2px] left-0 w-[14px] h-[14px] rounded-full bg-white transition-transform ' + (r.data.attivo !== false ? 'translate-x-[16px]' : 'translate-x-[2px]')} />
            </button>
            <button type="button" onClick={() => { setErr(''); setEdit({ id: r.id, data: { ...EMPTY, ...r.data } }) }} className="text-xs text-gray-400 hover:text-ink">Modifica</button>
            <button type="button" onClick={() => remove(r)} className="text-xs text-gray-500 hover:text-red-400">Togli</button>
          </div>
        ))}
      </div>
    </section>
  )
}
