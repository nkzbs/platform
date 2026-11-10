import React from 'react'
import Icon from './Icon'

// Una riga di menu «azioni»: icona, nome, una riga di spiegazione. Stessa forma ovunque nel programma (elenco azioni del dettaglio, menu delle liste, menu delle righe).
export default function VoceMenu({ icon, label, desc, onClick, disabled, danger, badge, iconClassName }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} disabled={disabled} className={'w-full text-left px-3 py-2.5 hover:bg-white/5 transition flex items-start gap-3 disabled:opacity-50 ' + (danger ? 'hover:bg-red-900/20' : '')}>
      <Icon name={icon} size={18} className={(danger ? 'text-red-400' : 'text-accent') + ' mt-0.5 flex-shrink-0 ' + (iconClassName || '')} />
      <span className="flex-1 min-w-0">
        <span className={'block text-sm ' + (danger ? 'text-red-400' : 'text-ink')}>{label}</span>
        {desc && <span className="block text-xs text-gray-500 mt-0.5">{desc}</span>}
      </span>
      {badge && <span className="text-[10px] bg-gray-800 text-gray-400 rounded px-1.5 py-0.5 flex-shrink-0">{badge}</span>}
    </button>
  )
}
