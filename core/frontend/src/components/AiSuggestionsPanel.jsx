import React, { useState, useEffect } from 'react'
import useApi from '../lib/useApi'
import Icon from './Icon'

// Proposte dell'assistente AI, in dashboard: bollette di casa e personali in un solo elenco. L'AI PROPONE e non scrive:
// ogni proposta si accetta (applica i campi al record) o si ignora. Compare solo se c'è qualcosa da vedere o da chiedere.
const MODULO_LABEL = { spese_casa: 'Spese casa', spese_personali: 'Spese personali' }
const fmtEur = (n) => (n == null ? '—' : Number(n).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' }))

function Change({ label, from, to }) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className="text-gray-500 w-20 flex-shrink-0">{label}</span>
      {from != null && from !== '' && <span className="text-gray-600 line-through">{from}</span>}
      {from != null && from !== '' && <Icon name="arrow-down" size={10} className="text-gray-600 -rotate-90" />}
      <span className="text-ink font-medium">{to}</span>
    </div>
  )
}

export default function AiSuggestionsPanel({ token, isAdmin }) {
  const api = useApi(token)
  const [items, setItems] = useState([])
  const [toAsk, setToAsk] = useState([]) // righe "da smistare" per cui non è ancora stata chiesta una proposta
  const [toAskTotal, setToAskTotal] = useState(0)
  const [busyId, setBusyId] = useState(null)
  const [asking, setAsking] = useState(false)
  const [msg, setMsg] = useState(null) // { ok, text }

  const load = async () => {
    if (!isAdmin) return
    const data = await api.get('/ai/overview')
    if (data) { setItems(data.items || []); setToAsk(data.to_ask || []); setToAskTotal(data.to_ask_total || 0) }
  }
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (!isAdmin) return null

  const decide = async (id, action) => {
    setBusyId(id)
    const res = await api.post('/ai/suggestions/' + id + '/' + action, {})
    setBusyId(null)
    if (!res.ok) { setMsg({ ok: false, text: (res.data && res.data.error) || 'Operazione non riuscita' }); return }
    setMsg(null)
    await load()
  }

  const askAll = async () => {
    setAsking(true)
    setMsg(null)
    let created = 0, last = null
    for (const r of toAsk) {
      const res = await api.post('/ai/suggest/' + r.module_slug + '/' + r.record_id, {})
      if (!res.ok) { last = res.data; if (res.data && res.data.code === 'ai_budget_exceeded') break; continue }
      if (res.data && res.data.id) created++
    }
    setAsking(false)
    await load()
    if (last && last.code === 'ai_budget_exceeded') setMsg({ ok: false, text: 'Tetto mensile AI raggiunto: le richieste riprendono il mese prossimo.' })
    else if (created === 0) setMsg({ ok: true, text: last ? (last.error || 'Assistente non disponibile') : 'Nessun suggerimento utile per queste righe.' })
  }

  if (items.length === 0 && toAsk.length === 0 && !msg) return null

  return (
    <div className="bg-accent/5 border border-accent/25 rounded-xl p-4 mb-5">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-accent/15 text-accent flex items-center justify-center flex-shrink-0"><Icon name="wand" size={15} /></div>
          <div>
            <div className="text-sm font-medium text-ink">Assistente{items.length ? ' · ' + items.length + (items.length === 1 ? ' proposta' : ' proposte') : ''}</div>
            <div className="text-xs text-gray-500">Propone categoria, importo e scadenza. Non cambia nulla finché non accetti.</div>
          </div>
        </div>
        {toAsk.length > 0 && (
          <button onClick={askAll} disabled={asking} className="text-xs bg-accent hover:opacity-90 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg transition font-medium">
            {asking ? 'Chiedo...' : 'Chiedi per le righe da smistare (' + toAskTotal + ')'}
          </button>
        )}
      </div>

      {msg && <div className={'text-xs p-2.5 rounded-lg mb-3 ' + (msg.ok ? 'bg-surface-card text-gray-400' : 'bg-amber-900/20 text-amber-400 border border-amber-900/40')}>{msg.text}</div>}

      <div className="space-y-2">
        {items.map((s) => {
          const p = s.proposta
          return (
            <div key={s.id} className="bg-surface-card border border-gray-800 rounded-lg p-3 flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0 flex-1">
                <div className="text-sm text-ink font-medium truncate">{s.record.descrizione} <span className="text-gray-500 font-normal">· {fmtEur(s.record.importo)} · {s.record.data} · {MODULO_LABEL[s.module_slug] || s.module_slug}</span></div>
                <div className="mt-1.5 space-y-0.5">
                  {p.categoria && p.categoria !== s.corrente.categoria && <Change label="Categoria" from={s.corrente.categoria} to={p.categoria} />}
                  {p.importo != null && p.importo !== Number(s.corrente.importo || 0) && <Change label="Importo" from={s.corrente.importo ? fmtEur(s.corrente.importo) : null} to={fmtEur(p.importo)} />}
                  {p.scadenza && p.scadenza !== s.corrente.scadenza && <Change label="Scadenza" from={s.corrente.scadenza} to={p.scadenza} />}
                  {p.fornitore && <Change label="Fornitore" from={null} to={p.fornitore} />}
                  {p.modulo && p.modulo !== s.module_slug && <div className="text-xs text-amber-400">Sembra una voce di «{MODULO_LABEL[p.modulo] || p.modulo}»: lo sposto a mano se è così.</div>}
                </div>
                <div className="text-[11px] text-gray-600 mt-1.5">Sicurezza della proposta: {p.confidenza}</div>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button onClick={() => decide(s.id, 'accept')} disabled={busyId === s.id} className="text-xs bg-accent hover:opacity-90 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg transition font-medium">Accetta</button>
                <button onClick={() => decide(s.id, 'dismiss')} disabled={busyId === s.id} className="text-xs text-gray-400 hover:text-ink px-2.5 py-1.5 rounded-lg transition">Ignora</button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
