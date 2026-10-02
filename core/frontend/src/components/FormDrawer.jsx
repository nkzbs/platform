import React from 'react'
import Icon from './Icon'

// Pannello a pagina intera (slide-in da destra) per creazione/modifica record —
// sostituisce il vecchio modale centrato compresso (max-w-md/max-w-lg). Contenitore
// puro: titolo, corpo scrollabile, footer opzionale per i bottoni azione — nessuna
// logica di campo/form qui dentro, quella resta dove viveva già.
function FormDrawer({ title, onClose, children, footer, wide, headerExtra }) {
  return (
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
    </div>
  )
}

export default FormDrawer
