import React, { useState, useEffect } from 'react'
import useApi from '../lib/useApi'
import Icon from './Icon'

// Suggerimenti di miglioramento: cosa osserva il tenant sull'uso dei moduli (calcolato in locale, senza AI) e, su richiesta, la spiegazione e la proposta dell'AI.
// Sono osservazioni, non giudizi: servono a chiedersi «ci serve ancora?». L'AI riceve la struttura e i conteggi, mai i valori delle righe. Niente si applica da solo: si modifica dal Builder.
const REGOLA = {
  campo_poco_usato: { etichetta: 'Campo poco usato', icona: 'eye-off' },
  testo_da_strutturare: { etichetta: 'Potrebbe essere una scelta', icona: 'list' },
  righe_ferme: { etichetta: 'Righe ferme', icona: 'clock' },
  stato_mai_usato: { etichetta: 'Passaggio mai usato', icona: 'git-branch' },
}
const AZIONE = { rendi_scelta: 'Trasformare in una scelta', togli_campo: 'Togliere o nascondere il campo', sblocca_righe: 'Sbloccare le righe ferme', aggiungi_passaggio: 'Aggiungere un passaggio', togli_passaggio: 'Togliere il passaggio', altro: 'Da valutare' }

export default function SuggestionsTab({ token, onOpenInBuilder }) {
  const api = useApi(token)
  const [data, setData] = useState(null) // { items, ai_accesa }
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState(null)
  const [mostraIgnorati, setMostraIgnorati] = useState(false)

  const load = async () => { const d = await api.get('/suggestions'); if (d) setData(d) }
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const scansiona = async () => {
    setBusy('scan'); setMsg(null)
    const r = await api.post('/suggestions/scan', {})
    setBusy('')
    if (r.ok) { setData((d) => ({ ...d, items: r.data.items })); setMsg({ ok: true, text: r.data.nuove ? r.data.nuove + ' nuove osservazioni.' : 'Nessuna novità.' }) } else setMsg({ ok: false, text: (r.data && r.data.error) || 'Non riuscito.' })
  }
  const stato = async (it, status) => { await api.patch('/suggestions/' + it.id, { status }); load() }
  const proponi = async (it) => {
    setBusy('p' + it.id); setMsg(null)
    const r = await api.post('/suggestions/' + it.id + '/propose', {})
    setBusy('')
    if (r.ok) load(); else setMsg({ ok: false, text: (r.data && r.data.error) || 'L\'AI non risponde.' })
  }

  if (!data) return <div className="max-w-2xl text-sm text-gray-500">Caricamento…</div>
  const aperti = data.items.filter((i) => i.status === 'open'), ignorati = data.items.filter((i) => i.status === 'dismissed')
  const card = (it) => {
    const R = REGOLA[it.rule_key] || { etichetta: it.rule_key, icona: 'info' }
    return (
      <section key={it.id} className={'bg-surface-card border border-gray-800 rounded-xl p-4 ' + (it.status === 'dismissed' ? 'opacity-60' : '')}>
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-surface-page border border-gray-800 flex items-center justify-center text-accent flex-shrink-0"><Icon name={R.icona} size={14} /></div>
          <div className="min-w-0 flex-1">
            <div className="text-[11px] uppercase tracking-wide text-gray-500">{R.etichetta}</div>
            <div className="text-sm text-ink mt-0.5">{it.title}</div>
            {it.ai && (
              <div className="mt-3 bg-accent/10 border border-accent/30 rounded-lg p-3 text-sm">
                <div className="text-gray-300">{it.ai.spiegazione}</div>
                <ul className="mt-2 space-y-1 text-xs text-gray-300 list-disc ml-4">{it.ai.cosa_fare.map((c, i) => <li key={i}>{c}</li>)}</ul>
                <div className="text-xs text-gray-500 mt-2">Direzione: {AZIONE[it.ai.azione] || AZIONE.altro}</div>
              </div>
            )}
            <div className="flex flex-wrap gap-2 mt-3">
              {it.status === 'open' && !it.ai && <button onClick={() => proponi(it)} disabled={!!busy || !data.ai_accesa} title={data.ai_accesa ? '' : 'Accendi l\'AI in Impostazioni → AI'} className="text-xs bg-accent hover:opacity-90 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg font-medium flex items-center gap-1.5"><Icon name="sparkles" size={12} />{busy === 'p' + it.id ? 'Penso…' : 'Spiega e proponi'}</button>}
              {onOpenInBuilder && it.status === 'open' && <button onClick={() => onOpenInBuilder(it.module_slug)} className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-200 px-3 py-1.5 rounded-lg">Apri il modulo nel Builder</button>}
              {it.status === 'open' ? <button onClick={() => stato(it, 'dismissed')} className="text-xs text-gray-500 hover:text-ink px-2 py-1.5">Ignora</button> : <button onClick={() => stato(it, 'open')} className="text-xs text-gray-400 hover:text-ink px-2 py-1.5">Riapri</button>}
            </div>
          </div>
        </div>
      </section>
    )
  }
  return (
    <div className="max-w-2xl space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <p className="text-sm text-gray-500 max-w-md">Come usi i tuoi moduli: campi mai compilati, righe ferme, passaggi mai usati. Sono osservazioni sui numeri, non giudizi: servono a chiedersi se qualcosa serve ancora. Si aggiornano ogni giorno.</p>
        <button onClick={scansiona} disabled={!!busy} className="text-xs bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-200 px-3 py-2 rounded-lg flex-shrink-0">{busy === 'scan' ? 'Controllo…' : 'Controlla adesso'}</button>
      </div>
      {msg && <div className={'text-xs ' + (msg.ok ? 'text-green-400' : 'text-amber-400')}>{msg.text}</div>}
      {aperti.length === 0 && <div className="bg-surface-card border border-gray-800 rounded-xl p-5 text-sm text-gray-400">Nessun suggerimento: i tuoi moduli sono usati come previsto, oppure hanno ancora poche righe per dire qualcosa (servono almeno 20 righe).</div>}
      {aperti.map(card)}
      {ignorati.length > 0 && (
        <>
          <button onClick={() => setMostraIgnorati((x) => !x)} className="text-xs text-gray-500 hover:text-ink">{mostraIgnorati ? '▾' : '▸'} Ignorati ({ignorati.length})</button>
          {mostraIgnorati && ignorati.map(card)}
        </>
      )}
    </div>
  )
}
