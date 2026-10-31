import React from 'react'
import Icon from './Icon'

// ─── TILE BENTO ──────────────────────────────────────────────────────────────
// Building block del layout "a bento" — copia sincronizzata a mano da
// super-admin/frontend/src/components/Tile.jsx (2026-08-16, portato anche nei
// tenant). Un Tile mostra solo un riepilogo a colpo d'occhio (icona, etichetta,
// valore, sottotitolo) — il dettaglio completo vive nel pannello che il
// genitore renderizza sotto la griglia quando il tile è `active`.
// `color` (opzionale, 2026-09-04, richiesto dall'utente: "un po' di colore non fa
// male") — tinge solo l'icona, mai testo/bordo, per non intaccare la leggibilità
// dei 40+ punti dove questo componente è già in uso senza `color` (default
// invariato, grigio monocromatico com'era prima).
function Tile({ icon, label, value, sub, active, onClick, color }) {
  return (
    <button onClick={onClick} className={'text-left glass-panel p-3 transition w-full ' + (active ? 'ring-1 ring-accent' : 'hover:bg-white/5')}>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5 min-w-0" style={color ? { color } : undefined}>
          <Icon name={icon} size={13} className={'flex-shrink-0' + (color ? '' : ' text-gray-500')} />
          <span className={'text-[10px] uppercase tracking-wide truncate' + (color ? '' : ' text-gray-500')}>{label}</span>
        </div>
        <Icon name={active ? 'chevron-down' : 'chevron-right'} size={12} className="text-gray-600 flex-shrink-0" />
      </div>
      <div className="text-ink text-sm font-semibold truncate">{value}</div>
      {sub && <div className="text-[11px] text-gray-500 truncate mt-0.5">{sub}</div>}
    </button>
  )
}

export default Tile
