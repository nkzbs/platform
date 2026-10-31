import React from 'react'
import { API } from '../lib/api'
import Icon from './Icon'

// Ricerca nei record di tutti i moduli. Due stili: "glass" (pillola di vetro, usata nella
// testa della pagina su Dashboard/Report) e "panel" (campo largo in cima al pannello
// "Altro" del dock — 2026-10-31, spostata lì su richiesta dell'utente dopo aver visto un
// launcher macOS: "ricerca in alto, togliendola dalla testa della pagina"). onQueryChange,
// usato solo dal pannello, riporta il testo digitato così la griglia sotto può filtrarsi
// per nome mentre si scrive — stesso comportamento del launcher di riferimento.
export default function GlobalSearch({ token, onNavigate, glass, panel, onQueryChange }) {
  const [q, setQ] = React.useState('')
  const [results, setResults] = React.useState([])
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef(null)
  const debounce = React.useRef(null)

  React.useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const search = (val) => {
    setQ(val)
    if (onQueryChange) onQueryChange(val)
    if (debounce.current) clearTimeout(debounce.current)
    if (!val.trim() || val.trim().length < 2) { setResults([]); setOpen(false); return }
    debounce.current = setTimeout(async () => {
      const res = await fetch(API + '/search?q=' + encodeURIComponent(val.trim()), { headers: { Authorization: 'Bearer ' + token } })
      if (res.ok) { const data = await res.json(); setResults(data); setOpen(true) }
    }, 300)
  }

  const pick = (r) => { setQ(''); if (onQueryChange) onQueryChange(''); setOpen(false); onNavigate(r.module_slug) }

  return (
    <div className={'relative ' + (panel ? 'w-full' : 'flex-1 min-w-0 md:flex-none')} ref={ref}>
      <div className={'flex items-center gap-2 transition ' + (panel ? 'px-3.5 py-2.5 w-full rounded-xl bg-white/8 border border-white/10 focus-within:border-accent/60' : 'px-3.5 py-1.5 w-full md:w-56 ' + (glass ? 'glass-pill focus-within:border-accent' : 'bg-surface-card border border-gray-800 rounded-lg focus-within:border-blue-500'))}>
        <Icon name="search" size={panel ? 15 : 13} className="text-gray-500 flex-shrink-0" />
        <input className={'bg-transparent text-ink outline-none w-full placeholder-gray-600 ' + (panel ? 'text-sm' : 'text-sm')}
          placeholder="Cerca in tutti i moduli..." value={q} onChange={(e) => search(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)} />
      </div>
      {open && results.length > 0 && (
        <div className={'absolute top-full mt-1.5 w-[min(20rem,90vw)] bg-surface-card border border-gray-700 rounded-xl shadow-xl z-50 overflow-hidden max-h-72 overflow-y-auto ' + (panel ? 'left-0' : 'right-0 md:left-0')}>
          {results.map((r, i) => (
            <button key={i} onClick={() => pick(r)}
              className="w-full px-4 py-2.5 hover:bg-white/5 transition text-left flex items-center gap-3 border-b border-gray-800/50">
              <div className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0" style={{ backgroundColor: (r.module_color || '#2563EB') + '22', color: r.module_color || '#2563EB' }}>
                <Icon name={r.module_icon || 'box'} size={12} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm text-ink truncate">{r.label}</div>
                <div className="text-xs text-gray-500">{r.module_name} · #{r.record_id}</div>
              </div>
            </button>
          ))}
        </div>
      )}
      {open && results.length === 0 && q.length >= 2 && (
        <div className={'absolute top-full mt-1.5 w-64 bg-surface-card border border-gray-700 rounded-xl shadow-xl z-50 px-4 py-3 text-sm text-gray-500 ' + (panel ? 'left-0' : 'left-0')}>
          Nessun risultato per "{q}"
        </div>
      )}
    </div>
  )
}
