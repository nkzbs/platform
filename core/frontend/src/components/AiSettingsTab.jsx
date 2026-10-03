import React, { useState, useEffect } from 'react'
import useApi from '../lib/useApi'
import Icon from './Icon'

// Interruttore dell'assistente AI e consumo del mese. Spento finché non lo si accende.
export default function AiSettingsTab({ token }) {
  const api = useApi(token)
  const [state, setState] = useState(null) // { bollette_enabled, budget }
  const [busy, setBusy] = useState(false)
  const [keyInput, setKeyInput] = useState('')
  const [keyMsg, setKeyMsg] = useState(null) // { ok, text }

  const load = async () => { const d = await api.get('/ai/settings'); if (d) setState(d) }
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = async (key) => {
    setBusy(true)
    const res = await api.put('/ai/settings', { [key]: !state[key] })
    setBusy(false)
    if (res.ok) setState({ ...state, bollette_enabled: res.data.bollette_enabled, report_enabled: res.data.report_enabled })
  }

  const saveKey = async () => {
    setBusy(true); setKeyMsg(null)
    const res = await api.put('/ai/key', { key: keyInput })
    setBusy(false)
    if (res.ok) { setKeyInput(''); setState({ ...state, key: res.data }); setKeyMsg({ ok: true, text: 'Chiave salvata.' }) }
    else setKeyMsg({ ok: false, text: (res.data && res.data.error) || 'Non sono riuscito a salvare la chiave.' })
  }

  const removeKey = async () => {
    if (!window.confirm('Togliere la chiave? L\'assistente smette di funzionare finché non ne inserisci un\'altra.')) return
    setBusy(true); setKeyMsg(null)
    const res = await api.del('/ai/key')
    setBusy(false)
    if (res.ok) { const d = await api.get('/ai/settings'); if (d) setState(d); setKeyMsg({ ok: true, text: 'Chiave tolta.' }) }
    else setKeyMsg({ ok: false, text: 'Non sono riuscito a togliere la chiave.' })
  }

  const Switch = ({ k }) => state && (
    <button type="button" role="switch" aria-checked={state[k]} onClick={() => toggle(k)} disabled={busy}
      className={'w-10 h-[22px] rounded-full transition-colors relative flex-shrink-0 mt-1 disabled:opacity-60 ' + (state[k] ? 'bg-accent' : 'bg-gray-700')}>
      <span className={'absolute top-[3px] left-0 w-4 h-4 rounded-full bg-white transition-transform ' + (state[k] ? 'translate-x-[21px]' : 'translate-x-[3px]')} />
    </button>
  )

  const b = state && state.budget
  const pct = b ? Math.min(100, b.percent) : 0

  return (
    <div className="max-w-2xl space-y-4">
      <section className="bg-surface-card border border-gray-800 rounded-xl p-5">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-surface-page border border-gray-800 flex items-center justify-center text-accent flex-shrink-0"><Icon name="key" size={16} /></div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-ink">Chiave Mistral</h2>
            <p className="text-xs text-gray-500 mt-0.5 max-w-md">Ogni progetto ha la sua chiave e il suo tetto di spesa. La trovi nel tuo account Mistral, in «API keys».</p>
            {state && (
              <div className="mt-3 text-xs">
                {state.key && state.key.source === 'tenant' && <div className="text-green-400">Chiave di questo progetto salvata ({state.key.hint})</div>}
                {state.key && state.key.source === 'generale' && <div className="text-gray-400">Usa la chiave generale di Super Admin. Inserisci qui la tua per separare la spesa di questo progetto.</div>}
                {(!state.key || !state.key.configured) && <div className="text-amber-400">Nessuna chiave: l'assistente non funziona finché non ne inserisci una.</div>}
              </div>
            )}
            <div className="flex gap-2 mt-3 flex-wrap">
              <input type="password" autoComplete="off" spellCheck="false" value={keyInput} onChange={(e) => setKeyInput(e.target.value)} placeholder="Incolla la chiave Mistral"
                className="flex-1 min-w-[220px] bg-surface-page text-ink px-3 py-2 rounded-lg outline-none border border-gray-800 focus:border-accent text-sm placeholder-gray-600" />
              <button type="button" onClick={saveKey} disabled={busy || !keyInput.trim()} className="bg-accent hover:opacity-90 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition">Salva</button>
              {state && state.key && state.key.source === 'tenant' && (
                <button type="button" onClick={removeKey} disabled={busy} className="px-4 py-2 rounded-lg text-sm bg-surface-page hover:bg-gray-800 text-gray-300 transition border border-gray-800 disabled:opacity-50">Togli</button>
              )}
            </div>
            {keyMsg && <div className={'mt-2 text-xs ' + (keyMsg.ok ? 'text-green-400' : 'text-amber-400')}>{keyMsg.text}</div>}
            <div className="text-xs text-gray-600 mt-3">La chiave viene controllata con Mistral e conservata cifrata da Super Admin. Non viene mostrata di nuovo: se la perdi, ne inserisci un'altra.</div>
          </div>
        </div>
      </section>

      <section className="bg-surface-card border border-gray-800 rounded-xl p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-surface-page border border-gray-800 flex items-center justify-center text-accent flex-shrink-0"><Icon name="wand" size={16} /></div>
            <div>
              <h2 className="text-sm font-semibold text-ink">Smistamento bollette</h2>
              <p className="text-xs text-gray-500 mt-0.5 max-w-md">Quando arriva una bolletta da Gmail, l'assistente propone categoria, importo, scadenza e fornitore. Tu accetti o ignori: non cambia mai nulla da solo.</p>
            </div>
          </div>
          <Switch k="bollette_enabled" />
        </div>
        <div className="text-xs text-gray-500 mt-4 pt-4 border-t border-gray-800 space-y-1">
          <div>Le righe già nell'elenco delle spese si possono sottoporre all'assistente anche con l'interruttore spento, dal riquadro in cima alla pagina.</div>
          <div>All'AI arrivano solo mittente, oggetto e le prime righe del testo, <span className="text-gray-300">senza IBAN, telefoni, email e codici fiscali</span>.</div>
        </div>
      </section>

      <section className="bg-surface-card border border-gray-800 rounded-xl p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-surface-page border border-gray-800 flex items-center justify-center text-accent flex-shrink-0"><Icon name="bar-chart" size={16} /></div>
            <div>
              <h2 className="text-sm font-semibold text-ink">Commento al report mensile</h2>
              <p className="text-xs text-gray-500 mt-0.5 max-w-md">Il report del 1° del mese su WhatsApp si chiude con una frase che dice cosa è cambiato. Se l'assistente non risponde, il report parte lo stesso, senza commento.</p>
            </div>
          </div>
          <Switch k="report_enabled" />
        </div>
        <div className="text-xs text-gray-500 mt-4 pt-4 border-t border-gray-800 space-y-1">
          <div>All'AI arrivano <span className="text-gray-300">solo i totali per categoria</span> (con il confronto col mese prima), mai le singole spese né le descrizioni.</div>
          <div>Le percentuali le calcola il programma, non l'AI, e un commento che cita un numero non presente nei dati viene scartato. In ogni report c'è anche il pulsante «Spiega questo report», sempre disponibile.</div>
        </div>
      </section>

      <section className="bg-surface-card border border-gray-800 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-ink mb-1">Spesa del mese</h2>
        {!state ? <div className="text-xs text-gray-600">Caricamento...</div> : !b ? (
          <div className="text-xs text-gray-500">Consumo non disponibile in questo momento.</div>
        ) : (
          <>
            <div className="flex items-baseline justify-between mb-2">
              <div className="text-lg font-semibold text-ink font-mono">{b.spent_eur.toFixed(2)} €</div>
              <div className="text-xs text-gray-500">tetto {b.budget_eur.toFixed(2)} € al mese</div>
            </div>
            <div className="h-1.5 rounded-full bg-gray-800 overflow-hidden"><div className={'h-full rounded-full ' + (pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-accent')} style={{ width: pct + '%' }} /></div>
            <div className="text-xs text-gray-500 mt-2">{b.blocked ? 'Tetto raggiunto: le richieste riprendono il mese prossimo.' : 'A tetto raggiunto le richieste si fermano da sole. Ti arriva un avviso all\'80% e al 100%.'}</div>
          </>
        )}
      </section>
    </div>
  )
}
