import React from 'react'
import Icon from './Icon'

// Copiato pari pari da core/frontend/src/components/Wizard.jsx (F1, 2026-08-28) — stesso
// pattern già in uso per Tile.jsx/Icon.jsx/Select.jsx/RichText.jsx/PrintModal.jsx/
// PlatformLogo.jsx (vedi docs/frontend-behavior/super-admin-app-shell.md §6): nessuna
// fonte condivisa reale tra i due frontend, solo duplicazione manuale intenzionale.
// Indicatore di progresso per form multi-step — puramente presentazionale: chi lo
// usa gestisce lo stato del passo corrente e il contenuto di ciascun passo, questo
// componente disegna solo i pallini/titoli e lo stato (fatto/corrente/da fare).
// onStepClick (2026-09-08, opzionale, retrocompatibile) — quando presente ogni
// pallino/etichetta diventa un <button> che naviga al passo cliccato; l'uso
// esistente dentro AnalysesPanel (client-card, per-analisi) non lo passa e resta
// identico, puramente decorativo com'era.
function Wizard({ steps, currentIndex, onStepClick }) {
  return (
    // overflow-x-auto, non un flex-wrap: con 5+ step su schermo stretto la riga
    // (whitespace-nowrap sulle etichette) traboccava silenziosamente oltre il
    // bordo della card invece di essere raggiungibile a scroll — sembrava un'area
    // bianca vuota a destra (bug reale 2026-08-31, segnalato dall'utente da mobile).
    <div className="flex items-center mb-6 overflow-x-auto">
      {steps.map((s, i) => (
        <React.Fragment key={i}>
          {onStepClick ? (
            <button type="button" onClick={() => onStepClick(i)} className="flex items-center gap-2 flex-shrink-0 hover:opacity-80 transition">
              <div className={
                'w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-semibold flex-shrink-0 ' +
                (i < currentIndex ? 'bg-accent text-white' : i === currentIndex ? 'bg-accent/20 border border-accent text-accent' : 'bg-gray-800 text-gray-600')
              }>
                {i < currentIndex ? <Icon name="check" size={11} /> : i + 1}
              </div>
              <span className={'text-xs whitespace-nowrap ' + (i === currentIndex ? 'text-ink font-medium' : i < currentIndex ? 'text-gray-400' : 'text-gray-600')}>
                {s.titolo}
              </span>
            </button>
          ) : (
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
          )}
          {i < steps.length - 1 && <div className="flex-1 h-px bg-gray-800 mx-3" />}
        </React.Fragment>
      ))}
    </div>
  )
}

export default Wizard
