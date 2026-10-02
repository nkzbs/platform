import React from 'react'
import Icon from './Icon'

// Indicatore di progresso per form multi-step — puramente presentazionale: chi lo
// usa gestisce lo stato del passo corrente e il contenuto di ciascun passo, questo
// componente disegna solo i pallini/titoli e lo stato (fatto/corrente/da fare).
function Wizard({ steps, currentIndex }) {
  return (
    // overflow-x-auto — stesso fix reale di super-admin/frontend/src/components/
    // Wizard.jsx (2026-08-31): senza, la riga di step (whitespace-nowrap) traboccava
    // oltre il bordo della card su schermo stretto invece di essere scrollabile.
    <div className="flex items-center mb-6 overflow-x-auto">
      {steps.map((s, i) => (
        <React.Fragment key={i}>
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className={
              'w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-semibold flex-shrink-0 ' +
              (i < currentIndex ? 'bg-accent text-white' : i === currentIndex ? 'bg-accent/20 border border-accent text-accent' : 'bg-gray-800 text-gray-600')
            }>
              {i < currentIndex ? <Icon name="check" size={11} /> : i + 1}
            </div>
            <span className={'text-xs whitespace-nowrap ' + (i === currentIndex ? 'text-ink font-medium' : i < currentIndex ? 'text-gray-400' : 'text-gray-600')}>
              {s.titolo}
            </span>
          </div>
          {i < steps.length - 1 && <div className="flex-1 h-px bg-gray-800 mx-3" />}
        </React.Fragment>
      ))}
    </div>
  )
}

export default Wizard
