import React, { useState } from 'react'
import useApi from '../lib/useApi'
import Icon from './Icon'

// «Chiedi ai dati»: scrivi una domanda ("quanto ho speso di luce nel 2025?"); l'AI la traduce in un filtro strutturato (mai una query libera) e il progetto
// lo esegue sui tuoi dati. Il risultato mostra anche cosa è stato capito, così puoi controllare. Solo con l'AI accesa (Impostazioni → AI).
const eur = (n) => Number(n || 0).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })
const ESEMPI = ['Quanto ho speso in totale lo scorso anno?', 'Quanto ho speso di luce nel 2025?', 'Qual è la spesa più alta di quest\'anno?']

export default function AskData({ token }) {
  const api = useApi(token)
  const [open, setOpen] = useState(false)
  const [domanda, setDomanda] = useState('')
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState(null) // risultato
  const [err, setErr] = useState('')

  const chiedi = async (testo) => {
    const d = (testo != null ? testo : domanda).trim()
    if (d.length < 4) return
    setDomanda(d); setBusy(true); setErr(''); setRes(null)
    const r = await api.post('/ai/ask', { domanda: d })
    setBusy(false)
    if (r.ok) setRes(r.data)
    else if (r.data && r.data.code === 'ai_budget_exceeded') setErr('Il tetto di spesa mensile dell\'AI è raggiunto: riprende il mese prossimo.')
    else if (r.data && r.data.code === 'ai_unanswerable') setErr('Non so rispondere a questa domanda con i dati che ho. Prova a dirla in un altro modo (' + (r.data.error || '') + ').')
    else setErr((r.data && r.data.error) || 'L\'AI non è disponibile in questo momento.')
  }
  const isMese = res && res.righe.length > 0 && /^\d{4}-\d{2}$/.test(res.righe[0].etichetta)
  const max = res ? Math.max(1, ...res.righe.map((x) => Math.abs(x.valore))) : 1
  const monthLabel = (ym) => new Date(ym + '-01T00:00:00').toLocaleDateString('it-IT', { month: 'short', year: 'numeric' })

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="flex items-center gap-1.5 text-sm text-accent hover:underline flex-shrink-0" title="Chiedi ai tuoi dati">
        <Icon name="wand" size={14} /><span className="hidden sm:inline">Chiedi ai dati</span>
      </button>
      {open && (
        <div className="fixed inset-0 bg-black/70 flex items-start justify-center z-50 p-4 pt-[10vh]" onClick={(e) => { if (e.target === e.currentTarget) setOpen(false) }}>
          <div className="bg-surface-card rounded-md p-6 w-full max-w-xl border border-gray-800 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-bold text-ink flex items-center gap-2"><Icon name="wand" size={16} className="text-accent" />Chiedi ai tuoi dati</h2>
              <button type="button" onClick={() => setOpen(false)} className="text-gray-500 hover:text-ink" aria-label="Chiudi">×</button>
            </div>
            <form onSubmit={(e) => { e.preventDefault(); chiedi() }} className="flex gap-2">
              <input autoFocus className="flex-1 bg-surface-page text-ink px-3 py-2.5 rounded-lg outline-none border border-gray-800 focus:border-accent text-sm" placeholder="Es. quanto ho speso di luce nel 2025?" value={domanda} onChange={(e) => setDomanda(e.target.value)} />
              <button type="submit" disabled={busy || domanda.trim().length < 4} className="bg-accent hover:opacity-90 disabled:opacity-50 text-white px-4 rounded-lg text-sm font-medium">{busy ? '…' : 'Chiedi'}</button>
            </form>
            {!res && !busy && !err && (
              <div className="mt-3 flex flex-wrap gap-2">{ESEMPI.map((e) => <button key={e} type="button" onClick={() => chiedi(e)} className="text-xs text-gray-400 hover:text-ink border border-gray-800 hover:border-gray-700 rounded-full px-3 py-1">{e}</button>)}</div>
            )}
            {busy && <div className="mt-4 text-sm text-gray-400">Sto cercando nei tuoi dati…</div>}
            {err && <div className="mt-4 text-sm text-amber-400">{err}</div>}
            {res && (
              <div className="mt-4">
                <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">{res.titolo || 'Risultato'}</div>
                <div className="text-3xl font-mono text-ink">{res.righe.length === 0 ? '—' : (/Numero di righe/.test(res.filtro[1]) ? res.totale : eur(res.totale))}</div>
                <div className="text-xs text-gray-500 mt-0.5">{res.n_righe} {res.n_righe === 1 ? 'riga' : 'righe'}{res.esclusi_da_smistare > 0 ? ' · ' + res.esclusi_da_smistare + ' ancora da smistare, non contate' : ''}</div>
                {res.righe.length > 1 && (
                  <div className="mt-3 space-y-1">
                    {res.righe.slice(0, 24).map((x) => (
                      <div key={x.etichetta} className="flex items-center gap-3 text-sm">
                        <span className="w-28 truncate text-gray-300">{isMese ? monthLabel(x.etichetta) : x.etichetta}</span>
                        <div className="flex-1 h-1.5 rounded-full bg-gray-800 overflow-hidden"><div className="h-full rounded-full bg-accent" style={{ width: Math.round((Math.abs(x.valore) / max) * 100) + '%' }} /></div>
                        <span className="w-24 text-right font-mono text-gray-200">{/Numero di righe/.test(res.filtro[1]) ? x.valore : eur(x.valore)}</span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="mt-4 pt-3 border-t border-gray-800">
                  <div className="text-[11px] text-gray-500 mb-1.5">Ho capito così (controlla):</div>
                  <div className="flex flex-wrap gap-1.5">{res.filtro.map((f) => <span key={f} className="text-xs bg-surface-page border border-gray-800 rounded-full px-2.5 py-0.5 text-gray-300">{f}</span>)}</div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
