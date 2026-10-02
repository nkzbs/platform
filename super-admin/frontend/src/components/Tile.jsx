import React from 'react'
import Icon from './Icon'

// ─── TILE BENTO ──────────────────────────────────────────────────────────────
// Building block del layout "a bento" richiesto dall'utente (2026-08-16) per
// sostituire le card Cliente/Partner — prima un unico blocco denso con tutti i
// campi sempre visibili ("non mi piace il full page"). Un Tile mostra solo un
// riepilogo a colpo d'occhio (icona, etichetta, valore, sottotitolo) — il
// dettaglio completo vive nel pannello che il genitore renderizza sotto la
// griglia quando il tile è `active`. Condiviso tra ClientCard.jsx e
// PartnersPage.jsx — stesso linguaggio visivo in entrambe le pagine.
function Tile({ icon, label, value, sub, active, onClick }) {
  return (
    <button onClick={onClick} className={'text-left bg-surface-page rounded-xl border p-3 transition w-full ' + (active ? 'border-cp-primary' : 'border-gray-800 hover:border-gray-700')}>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5 text-gray-500 min-w-0">
          <Icon name={icon} size={13} className="flex-shrink-0" />
          <span className="text-[10px] uppercase tracking-wide truncate">{label}</span>
        </div>
        <Icon name={active ? 'chevron-down' : 'chevron-right'} size={12} className="text-gray-600 flex-shrink-0" />
      </div>
      <div className="text-ink text-sm font-semibold truncate">{value}</div>
      {sub && <div className="text-[11px] text-gray-500 truncate mt-0.5">{sub}</div>}
    </button>
  )
}

export default Tile
