import React, { useState, useEffect } from 'react'
import Icon from './Icon'

// "Spiega con l'AI": un pulsante e il testo che torna. `ask(refresh)` fa la richiesta e ritorna { ok, data }; qui si gestiscono gli
// errori più comuni (tetto di spesa, manca la chiave, numero non verificato). `initial` è un testo già salvato; `resetKey` lo azzera.
export default function ExplainBox({ ask, initial = null, stale = false, resetKey = '', what = 'i numeri', note = '' }) {
  const [state, setState] = useState(initial ? { text: initial } : null) // { busy } | { text } | { error }
  useEffect(() => { setState(initial ? { text: initial } : null) }, [resetKey, initial])

  const run = async (refresh) => {
    setState({ busy: true })
    const res = await ask(refresh)
    const d = res && res.data
    if (res && res.ok && d && d.text) setState({ text: d.text })
    else if (d && d.code === 'ai_budget_exceeded') setState({ error: 'Il tetto di spesa mensile dell\'AI è raggiunto: riprende il mese prossimo.' })
    else if (d && d.code === 'ai_unverified') setState({ error: 'Non sono riuscito a scrivere una spiegazione affidabile. Riprova.' })
    else if (d && (d.code === 'ai_not_configured' || res.status === 503)) setState({ error: 'Manca la chiave Mistral: inseriscila nel Builder, in Potenziamenti AI.' })
    else if (d && d.code === 'ai_off') setState({ error: 'La spiegazione con l\'AI non è accesa.' })
    else setState({ error: 'L\'AI non è disponibile in questo momento.' })
  }
  const busy = !!(state && state.busy)
  return (
    <div className="mt-5 pt-4 border-t border-gray-800">
      <div className="flex items-center gap-3 flex-wrap">
        <button type="button" onClick={() => run(false)} disabled={busy} className="flex items-center gap-2 text-sm text-accent hover:underline disabled:opacity-60 disabled:no-underline">
          <Icon name="wand" size={14} />{busy ? 'Sto leggendo ' + what + '…' : state && state.text ? 'Aggiorna la spiegazione' : 'Spiega con l\'AI'}
        </button>
        {state && state.text && !busy && <button type="button" onClick={() => run(true)} className="text-xs text-gray-500 hover:text-gray-300">Riscrivi</button>}
      </div>
      {stale && !(state && state.text) && <div className="mt-2 text-xs text-gray-500">I numeri sono cambiati dall'ultima spiegazione: aggiornala per averne una nuova.</div>}
      {state && state.text && (
        <div className="mt-3 rounded-lg bg-surface-page border border-gray-800 p-4 text-sm text-gray-300 leading-relaxed whitespace-pre-line">
          {state.text}
          <div className="text-xs text-gray-600 mt-3">{note || 'Scritto dall\'AI a partire dai numeri qui sopra; ogni cifra citata è controllata.'}</div>
        </div>
      )}
      {state && state.error && <div className="mt-3 text-sm text-amber-400">{state.error}</div>}
    </div>
  )
}
