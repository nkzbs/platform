import React from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icon'

// Pannello a pagina intera (slide-in da destra) per creazione/modifica record —
// sostituisce il vecchio modale centrato compresso (max-w-md/max-w-lg). Contenitore
// puro: titolo, corpo scrollabile, footer opzionale per i bottoni azione — nessuna
// logica di campo/form qui dentro, quella resta dove viveva già.
//
// createPortal verso document.body (2026-10-31, bug reale trovato dal vivo: "apre
// male" aperto da un widget della Dashboard) — i pannelli di vetro (.glass-panel)
// hanno un backdrop-filter, e per specifica CSS un backdrop-filter/filter su un
// antenato crea un nuovo "containing block" per i discendenti position:fixed: questo
// pannello, aperto da dentro una card di vetro, restava intrappolato nei confini di
// quella card invece di coprire tutta la pagina. Il portale lo sposta fuori
// dall'albero React (e dal DOM) della card, verso la radice — fixed torna a
// comportarsi come ci si aspetta, qualunque sia l'antenato da cui si apre.
function FormDrawer({ title, onClose, children, footer, wide, headerExtra }) {
  return createPortal(
    <div className="fixed inset-0 bg-black/70 z-50 flex justify-end" onClick={onClose}>
      <div
        className={'bg-surface-card h-full border-l border-gray-800 flex flex-col ' + (wide ? 'w-full max-w-3xl' : 'w-full max-w-xl')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 flex-shrink-0">
          <h2 className="text-lg font-bold text-ink">{title}</h2>
          <div className="flex items-center gap-3">
            {headerExtra}
            <button onClick={onClose} className="text-gray-500 hover:text-ink transition"><Icon name="x" size={18} /></button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="px-6 py-4 border-t border-gray-800 flex-shrink-0">{footer}</div>}
      </div>
    </div>,
    document.body
  )
}

export default FormDrawer
