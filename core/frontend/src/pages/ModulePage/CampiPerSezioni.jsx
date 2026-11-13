import React, { useState } from 'react'
import Icon from '../../components/Icon'

// Il form di inserimento e di modifica a sezioni: in alto ciò che serve davvero (i campi obbligatori, sempre aperti), poi le sezioni dello schema (`sezione` di ogni
// campo) chiuse, ognuna con «compilati / totali»; si aprono toccando il titolo. Se nessun campo ha una sezione il form resta un elenco semplice, come prima.
// `renderCampo(f)` disegna il campo (l'input lo decide chi usa il componente); `valori` serve solo a contare quanti campi di una sezione sono già compilati.
const pieno = (v) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0) && v !== false

export default function CampiPerSezioni({ campi, valori, renderCampo }) {
  const [aperte, setAperte] = useState({})
  const conSezioni = campi.some((f) => typeof f.sezione === 'string' && f.sezione.trim())
  if (!conSezioni) return <>{campi.map(renderCampo)}</>
  const essenziali = campi.filter((f) => f.required)
  const gruppi = []
  const indice = new Map()
  for (const f of campi.filter((x) => !x.required)) {
    const nome = typeof f.sezione === 'string' && f.sezione.trim() ? f.sezione.trim() : 'Altri dati'
    if (!indice.has(nome)) { indice.set(nome, gruppi.length); gruppi.push({ nome, campi: [] }) }
    gruppi[indice.get(nome)].campi.push(f)
  }
  const aperta = (g, i) => (aperte[g.nome] !== undefined ? aperte[g.nome] : !essenziali.length && i === 0)
  return (
    <>
      {essenziali.length > 0 && (
        <div className="space-y-3">
          <div className="text-xs font-semibold text-gray-400">Da compilare</div>
          {essenziali.map(renderCampo)}
        </div>
      )}
      <div className="text-xs text-gray-500">{essenziali.length > 0 ? 'Il resto è facoltativo: apri una sezione quando ti serve, si può completare anche dopo.' : 'Apri una sezione per compilarla.'}</div>
      {gruppi.map((g, i) => {
        const compilati = g.campi.filter((f) => pieno((valori || {})[f.key])).length
        const open = aperta(g, i)
        return (
          <div key={g.nome} className="border border-gray-800 rounded-xl overflow-hidden">
            <button type="button" onClick={() => setAperte((p) => ({ ...p, [g.nome]: !open }))} className="w-full flex items-center justify-between gap-2 px-3 py-3 text-left hover:bg-white/5 transition">
              <span className="text-sm font-medium text-ink">{g.nome}</span>
              <span className="flex items-center gap-2 text-xs text-gray-500 flex-shrink-0">
                <span className={compilati ? 'text-green-500' : ''}>{compilati}/{g.campi.length}</span>
                <Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} />
              </span>
            </button>
            {open && <div className="px-3 pb-3 pt-1 space-y-3 border-t border-gray-800">{g.campi.map(renderCampo)}</div>}
          </div>
        )
      })}
    </>
  )
}
