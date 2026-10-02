import React, { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icon'

// Copiato da core/frontend/src/components/Select.jsx (stesso ragionamento di
// sincronizzazione manuale già in uso per pages/BuilderPage/ — nessun meccanismo
// shared/ per i componenti React, solo per Icon.jsx/AutomationActionsList.jsx).
// Usa gli stessi token bg-surface-page/text-ink già presenti in questa app
// (super-admin/frontend/src/index.css), quindi porting diretto senza adattamenti.
//
// Dropdown su misura al posto del <select> nativo — lo stesso <select> del
// browser non permette di restilizzare il popup delle opzioni in nessun browser
// comune (solo il box chiuso), quindi anche con un tema curato il menu a tendina
// aperto resta sempre quello di sistema, fuori posto. Qui il pannello aperto è
// HTML/CSS nostro, coerente col resto del tema (chiaro/scuro incluso).
//
// options: [{ value, label }]. actionOption (opzionale): una riga in fondo,
// visivamente distinta, per un'azione diversa da "seleziona questo valore" (es.
// "+ Nuovo cliente..." nei relation picker con quick_create) — al click chiama
// actionOption.onClick() invece di onChange().
// Sopra questa soglia (2026-09-12, "il menu a tendina non funziona bene" —
// segnalato con 187 moduli nel Registro dentro un elenco semplice senza
// ricerca: non era un bug di click/selezione, era letteralmente impossibile
// trovare una singola voce scorrendo 187 righe) compare un campo di ricerca
// in cima al pannello. Sotto la soglia resta un elenco semplice — un
// dropdown con 3-5 opzioni non ha bisogno di un campo in più da cliccare.
const SEARCH_THRESHOLD = 8

function Select({ value, onChange, options, placeholder, disabled, actionOption, className }) {
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(-1)
  const [query, setQuery] = useState('')
  const searchRef = useRef(null)
  // Il pannello apriva sempre in absolute DENTRO il proprio contenitore — dentro una
  // tabella di righe annidate (es. "Aggiungi riga" su Giacenza Furgone, Listini...) quel
  // contenitore ha overflow-hidden/overflow-x-auto per non far scappare la tabella dal
  // pannello: un pannello più alto del contenitore (facilissimo con poche righe esistenti,
  // es. "(0)") veniva TAGLIATO via, invisibile, anche se le opzioni c'erano davvero — bug
  // reale segnalato da un utente su Coffee ("non si vedono i prodotti"), intermittente
  // perché dipende da quanto contenitore c'è intorno. Portato fuori via portal
  // (document.body, position:fixed, coordinate reali da getBoundingClientRect) — stessa
  // tecnica standard per ogni dropdown/tooltip che deve poter "scappare" da un antenato che
  // taglia, indipendentemente da dove il Select viene usato in futuro.
  const [panelPos, setPanelPos] = useState(null) // {top, left, width, openUpward} in coordinate viewport (position:fixed)
  const ref = useRef(null)
  const panelRef = useRef(null)

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && ref.current.contains(e.target)) return
      if (panelRef.current && panelRef.current.contains(e.target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Il pannello è in position:fixed (coordinate viewport, non si sposta da solo se un
  // antenato scorre) — più semplice chiuderlo allo scroll che inseguirlo in tempo reale,
  // coerente con l'uso reale (si riapre con un click, non è un elemento persistente).
  useEffect(() => {
    if (!open) return
    const closeOnScroll = () => setOpen(false)
    window.addEventListener('scroll', closeOnScroll, true)
    window.addEventListener('resize', closeOnScroll)
    return () => {
      window.removeEventListener('scroll', closeOnScroll, true)
      window.removeEventListener('resize', closeOnScroll)
    }
  }, [open])

  const selected = (options || []).find((o) => String(o.value) === String(value))
  const selectedIndex = (options || []).findIndex((o) => String(o.value) === String(value))
  const showSearch = (options || []).length > SEARCH_THRESHOLD
  // Filtro solo se il campo ricerca è davvero mostrato — sotto la soglia
  // "query" resta sempre '' (mai digitata, il campo non esiste), quindi
  // filteredOptions coincide con options: nessun comportamento diverso per
  // i dropdown piccoli già in uso ovunque nell'app.
  const filteredOptions = (showSearch && query)
    ? (options || []).filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))
    : (options || [])

  const commit = (val) => { onChange(val); setOpen(false); setHighlight(-1); setQuery('') }

  const PANEL_MAX_HEIGHT = 256

  const toggleOpen = () => {
    setOpen((o) => {
      const next = !o
      if (next) {
        setHighlight(selectedIndex)
        setQuery('')
        if (ref.current) {
          const rect = ref.current.getBoundingClientRect()
          const spaceBelow = window.innerHeight - rect.bottom
          const spaceAbove = rect.top
          const openUpward = spaceBelow < PANEL_MAX_HEIGHT && spaceAbove > spaceBelow
          setPanelPos({
            left: rect.left,
            width: rect.width,
            top: openUpward ? null : rect.bottom + 4,
            bottom: openUpward ? window.innerHeight - rect.top + 4 : null,
          })
        }
      }
      return next
    })
  }

  // Il campo ricerca prende il focus da solo all'apertura — altrimenti
  // andrebbe cliccato una seconda volta dopo aver già cliccato per aprire
  // il pannello, un passaggio in più inutile ogni singola volta.
  useEffect(() => {
    if (open && showSearch && searchRef.current) searchRef.current.focus()
  }, [open, showSearch])

  const onKeyDown = (e) => {
    if (disabled) return
    const opts = filteredOptions
    if (e.key === 'Enter' || e.key === ' ') {
      // Uno spazio nel campo ricerca deve scrivere uno spazio, non selezionare —
      // solo il campo del bottone chiuso usa Spazio per aprire il pannello.
      if (e.key === ' ' && showSearch && open) return
      e.preventDefault()
      if (!open) { toggleOpen(); return }
      if (highlight >= 0 && highlight < opts.length) commit(opts[highlight].value)
      else if (actionOption && highlight === opts.length) { setOpen(false); actionOption.onClick() }
      return
    }
    if (e.key === 'Escape') { setOpen(false); return }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) { toggleOpen(); return }
      setHighlight((h) => Math.min(h + 1, opts.length - 1 + (actionOption ? 1 : 0)))
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => Math.max(h - 1, 0))
    }
  }

  return (
    <div className={'relative ' + (className || '')} ref={ref}>
      <button type="button" disabled={disabled} onClick={toggleOpen} onKeyDown={onKeyDown}
        className={'w-full flex items-center justify-between gap-2 bg-surface-page text-ink px-4 py-3 rounded-lg text-sm outline-none border transition text-left disabled:opacity-50 ' +
          (open ? 'border-cp-primary' : 'border-gray-800 hover:border-gray-700')}>
        <span className={selected ? '' : 'text-gray-600'}>{selected ? selected.label : (placeholder || 'Seleziona...')}</span>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={14} className="text-gray-600 flex-shrink-0" />
      </button>
      {open && panelPos && createPortal(
        <div ref={panelRef} className="fixed z-[60] max-h-64 overflow-y-auto bg-surface-card border border-gray-700 rounded-lg shadow-xl py-1"
          style={{ left: panelPos.left, width: panelPos.width, top: panelPos.top ?? undefined, bottom: panelPos.bottom ?? undefined }}>
          {showSearch && (
            <div className="sticky top-0 bg-surface-card px-2 pb-1.5 pt-0.5 -mt-1 border-b border-gray-800 mb-1">
              <input ref={searchRef} value={query} type="text" placeholder="Cerca…"
                onChange={(e) => { setQuery(e.target.value); setHighlight(0) }} onKeyDown={onKeyDown}
                className="w-full bg-surface-page text-ink px-2.5 py-1.5 rounded-md text-sm outline-none border border-gray-800 focus:border-cp-primary transition" />
            </div>
          )}
          {filteredOptions.length === 0 && !actionOption && (
            <div className="px-4 py-2.5 text-sm text-gray-600">Nessuna opzione</div>
          )}
          {filteredOptions.map((o, i) => (
            <button type="button" key={o.value} onClick={() => commit(o.value)} onMouseEnter={() => setHighlight(i)}
              className={'w-full text-left px-4 py-2 text-sm transition flex items-center justify-between gap-2 ' +
                (String(o.value) === String(value) ? 'text-cp-primary' : 'text-gray-300') +
                (highlight === i ? ' bg-white/5' : '')}>
              {o.label}
              {String(o.value) === String(value) && <Icon name="check" size={13} />}
            </button>
          ))}
          {actionOption && (
            <button type="button" onClick={() => { setOpen(false); actionOption.onClick() }} onMouseEnter={() => setHighlight(filteredOptions.length)}
              className={'w-full text-left px-4 py-2 text-sm text-cp-primary transition border-t border-gray-800 mt-1 pt-2 ' + (highlight === filteredOptions.length ? 'bg-white/5' : '')}>
              {actionOption.label}
            </button>
          )}
        </div>,
        document.body
      )}
    </div>
  )
}

export default Select
