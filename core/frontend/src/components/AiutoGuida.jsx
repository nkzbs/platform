import React, { useState } from 'react'
import useApi from '../lib/useApi'
import Portal from './Portal'
import Icon from './Icon'
import RichText from './RichText'

// Il «?» della guida generale (accanto al titolo della Dashboard): l'introduzione del verticale e «Per iniziare» per il ruolo di chi guarda, con due scorciatoie: la guida completa e il giro guidato.
// Se il tenant non ha una guida (nessun pacchetto) il «?» porta comunque alla guida di Platform.
export default function AiutoGuida({ token, user, onNavigate, onStartTour }) {
  const api = useApi(token)
  const [aperto, setAperto] = useState(false)
  const [g, setG] = useState(null)
  const apri = () => { setAperto(true); if (g === null) api.get('/guida').then((d) => setG(d || {})).catch(() => setG({})) }
  const passi = g && g.per_ruolo ? (g.per_ruolo[user && user.role] || g.per_ruolo.default) : null
  const vai = (fn) => () => { setAperto(false); fn() }
  return (
    <>
      <button type="button" onClick={apri} aria-label="Aiuto: come si lavora qui" title="Come si lavora qui" className="w-7 h-7 rounded-full border border-gray-700 text-gray-400 hover:text-accent hover:border-accent text-sm font-semibold flex items-center justify-center flex-shrink-0">?</button>
      {aperto && (
        <Portal>
          <div className="fixed inset-0 bg-black/70 flex items-start sm:items-center justify-center z-50 p-3" onClick={() => setAperto(false)}>
            <div role="dialog" aria-label="Come si lavora qui" onClick={(e) => e.stopPropagation()} className="bg-surface-card rounded-md p-5 sm:p-6 w-full max-w-xl border border-gray-800 max-h-[88vh] overflow-y-auto">
              <div className="flex items-center gap-2 mb-4">
                <h2 className="flex-1 text-base font-bold text-ink">{(g && g.introduzione && g.introduzione.titolo) || 'Guida'}</h2>
                <button type="button" onClick={() => setAperto(false)} aria-label="Chiudi" className="text-gray-500 hover:text-ink"><Icon name="x" size={16} /></button>
              </div>
              {g === null ? <div className="text-sm text-gray-600">Caricamento…</div> : (
                <div className="space-y-4">
                  {g.introduzione && (g.introduzione.testo || []).map((p, i) => <p key={i} className="text-sm text-gray-300 leading-relaxed"><RichText text={p} /></p>)}
                  {passi && (passi.passi || []).length > 0 && (
                    <div>
                      <div className="text-xs font-semibold text-ink uppercase tracking-wide mb-2">{passi.titolo || 'Per iniziare'}</div>
                      <ol className="space-y-2 list-decimal pl-5 text-sm text-gray-300 leading-relaxed marker:text-accent">{passi.passi.map((p, i) => <li key={i}><RichText text={p} /></li>)}</ol>
                    </div>
                  )}
                  {!g.presente && <p className="text-sm text-gray-400">Qui trovi come funziona Platform: moduli, campi, collegamenti, permessi e automazioni.</p>}
                </div>
              )}
              <div className="flex items-center gap-3 flex-wrap mt-5 pt-4 border-t border-gray-800">
                <button type="button" onClick={vai(() => onNavigate('guida'))} className="text-sm px-3.5 py-2 rounded-lg bg-accent text-white hover:opacity-90">Apri tutta la guida</button>
                {onStartTour && <button type="button" onClick={vai(onStartTour)} className="text-sm px-3.5 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200 flex items-center gap-1.5"><Icon name="flag" size={13} />Fai il giro guidato</button>}
              </div>
            </div>
          </div>
        </Portal>
      )}
    </>
  )
}
