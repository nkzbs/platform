import React from 'react'
import Icon from '../Icon'

// Stepper visivo a fasi connesse: un cerchio+icona per fase, con una linea che le
// collega colorata secondo lo stato (fatta/corrente/da fare). Usato sia come indice
// di dove si è nell'analisi (fasi fisse, senza avanzamento reale) sia per seguire un
// avanzamento vero (creazione del tenant, compilazione automatica con «Fai tutto»).
// doneUpTo: indice fino al quale (incluso) le fasi sono fatte; activeIndex: la fase
// in corso, evidenziata e con un piccolo respiro (pulse). Se doneUpTo è omesso si
// deduce da activeIndex (tutto ciò che la precede è fatto).
export default function Stepper({ steps, activeIndex, doneUpTo }) {
  const fattoFino = doneUpTo != null ? doneUpTo : activeIndex - 1
  return (
    <div className="flex items-start">
      {steps.map((s, i) => {
        const fatto = i <= fattoFino
        const corrente = i === activeIndex
        return (
          <React.Fragment key={s.key}>
            <div className="flex flex-col items-center flex-shrink-0">
              <div className={'w-8 h-8 rounded-full flex items-center justify-center border-2 transition-colors ' +
                (fatto ? 'bg-green-900/30 border-green-500 text-green-400' : corrente ? 'bg-cp-primary/15 border-cp-primary text-cp-primary animate-pulse' : 'bg-surface-page border-gray-800 text-gray-600')}>
                <Icon name={fatto ? 'check' : s.icon} size={14} />
              </div>
              <div className={'mt-1.5 text-[11px] text-center whitespace-nowrap ' + (fatto ? 'text-green-400' : corrente ? 'text-ink font-medium' : 'text-gray-600')}>{s.label}</div>
            </div>
            {i < steps.length - 1 && <div className={'flex-1 h-0.5 mt-4 mx-1 rounded transition-colors ' + (i <= fattoFino ? 'bg-green-500/60' : 'bg-gray-800')} />}
          </React.Fragment>
        )
      })}
    </div>
  )
}
