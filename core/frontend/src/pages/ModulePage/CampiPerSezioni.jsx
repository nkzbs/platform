import React, { useState } from 'react'
import Icon from '../../components/Icon'

// Il form di inserimento e di modifica a sezioni, pensato per leggersi a colpo d'occhio: in alto una barra di avanzamento e ciò che serve davvero (i campi
// obbligatori, in un riquadro evidenziato, sempre aperti), poi le sezioni dello schema (`sezione` di ogni campo), ognuna con il suo colore, il conteggio
// «compilati/totali» e una fascia colorata a sinistra; si aprono toccando il titolo. Ogni campo sta in una casella propria. Se nessun campo ha una sezione il
// form resta un elenco semplice (ma con le caselle). `renderCampo(f)` disegna il campo; `valori` serve solo a contare i campi già compilati.
const pieno = (v) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0) && v !== false
const COLORI = ['#584aec', '#0d9488', '#d97706', '#db2777', '#16a34a', '#7c3aed', '#0891b2', '#ea580c']
const tinta = (hex, a) => hex + Math.round(a * 255).toString(16).padStart(2, '0')

const Casella = ({ f, renderCampo, colore }) => (
  <div key={f.key} className="rounded-lg p-2.5 border" style={{ background: f.required ? tinta(colore, 0.07) : 'rgba(127,127,127,0.06)', borderColor: f.required ? tinta(colore, 0.35) : 'rgba(127,127,127,0.18)' }}>
    {renderCampo(f)}
  </div>
)

export default function CampiPerSezioni({ campi, valori, renderCampo }) {
  const [aperte, setAperte] = useState({})
  const conSezioni = campi.some((f) => typeof f.sezione === 'string' && f.sezione.trim())
  const v = valori || {}
  if (!conSezioni) return <>{campi.map((f) => <Casella key={f.key} f={f} renderCampo={renderCampo} colore={COLORI[0]} />)}</>
  const essenziali = campi.filter((f) => f.required)
  const gruppi = []
  const indice = new Map()
  for (const f of campi.filter((x) => !x.required)) {
    const nome = typeof f.sezione === 'string' && f.sezione.trim() ? f.sezione.trim() : 'Altri dati'
    if (!indice.has(nome)) { indice.set(nome, gruppi.length); gruppi.push({ nome, campi: [] }) }
    gruppi[indice.get(nome)].campi.push(f)
  }
  const aperta = (g, i) => (aperte[g.nome] !== undefined ? aperte[g.nome] : !essenziali.length && i === 0)
  const totale = campi.length
  const fatti = campi.filter((f) => pieno(v[f.key])).length
  const manca = essenziali.filter((f) => !pieno(v[f.key])).length
  return (
    <>
      <div>
        <div className="flex items-center justify-between text-xs mb-1.5">
          <span className="text-gray-500">{fatti} campi compilati su {totale}</span>
          {essenziali.length > 0 && <span className={manca ? 'text-amber-500 font-medium' : 'text-green-500 font-medium'}>{manca ? (manca === 1 ? 'Manca 1 campo necessario' : 'Mancano ' + manca + ' campi necessari') : 'Tutto il necessario è compilato'}</span>}
        </div>
        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(127,127,127,0.18)' }}><div className="h-full rounded-full transition-all" style={{ width: Math.round((fatti / Math.max(1, totale)) * 100) + '%', background: COLORI[0] }} /></div>
      </div>
      {essenziali.length > 0 && (
        <div className="rounded-xl p-3 space-y-2.5 border" style={{ background: tinta(COLORI[0], 0.06), borderColor: tinta(COLORI[0], 0.4) }}>
          <div className="text-sm font-semibold" style={{ color: COLORI[0] }}>Da compilare</div>
          {essenziali.map((f) => <Casella key={f.key} f={f} renderCampo={renderCampo} colore={COLORI[0]} />)}
        </div>
      )}
      <div className="text-xs text-gray-500">{essenziali.length > 0 ? 'Il resto è facoltativo: apri una sezione quando ti serve, si può completare anche dopo.' : 'Apri una sezione per compilarla.'}</div>
      {gruppi.map((g, i) => {
        const colore = COLORI[(i + 1) % COLORI.length]
        const compilati = g.campi.filter((f) => pieno(v[f.key])).length
        const open = aperta(g, i)
        const completa = compilati === g.campi.length
        return (
          <div key={g.nome} className="rounded-xl overflow-hidden border" style={{ borderColor: tinta(colore, 0.35), borderLeft: '5px solid ' + colore }}>
            <button type="button" onClick={() => setAperte((p) => ({ ...p, [g.nome]: !open }))} className="w-full flex items-center justify-between gap-2 px-3 py-3 text-left transition hover:opacity-90" style={{ background: tinta(colore, open ? 0.14 : 0.08) }}>
              <span className="text-sm font-semibold text-ink">{g.nome}</span>
              <span className="flex items-center gap-2 text-xs flex-shrink-0">
                <span className="px-2 py-0.5 rounded-full font-medium" style={{ background: completa ? '#16a34a22' : tinta(colore, 0.16), color: completa ? '#16a34a' : colore }}>{completa ? '✓ ' : ''}{compilati}/{g.campi.length}</span>
                <Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} className="text-gray-500" />
              </span>
            </button>
            {open && <div className="p-3 space-y-2.5" style={{ background: tinta(colore, 0.04) }}>{g.campi.map((f) => <Casella key={f.key} f={f} renderCampo={renderCampo} colore={colore} />)}</div>}
          </div>
        )
      })}
    </>
  )
}
