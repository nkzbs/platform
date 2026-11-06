import React, { useEffect, useState } from 'react'
import Icon from './Icon'

// Sezione «abbinamenti» nel dettaglio di un record (blocco `match_view`): un elenco per ogni
// definizione del modulo — es. «Immobili adatti» su un Cliente. Sola lettura: il calcolo lo fa il
// server (GET /records/:slug/:id/abbinamenti/:key), che rispetta i permessi del modulo bersaglio.
// Se la condizione della definizione non è vera per questo record (es. solo gli acquirenti) la
// sezione non compare affatto.
function formatta(v) {
  if (typeof v === 'number') return v.toLocaleString('it-IT')
  if (typeof v === 'boolean') return v ? 'Sì' : 'No'
  return String(v)
}

function Elenco({ api, slug, recordId, def }) {
  const [esito, setEsito] = useState(undefined) // undefined = in caricamento, null = errore
  useEffect(() => {
    let annullato = false
    setEsito(undefined)
    api.get('/records/' + slug + '/' + recordId + '/abbinamenti/' + def.key).then((r) => { if (!annullato) setEsito(r) })
    return () => { annullato = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, recordId, def.key])

  if (esito === undefined) return <div className="glass-panel p-4 mb-5 text-xs text-gray-500">Cerco {def.label.toLowerCase()}…</div>
  if (esito === null || esito.applicabile === false) return null
  const { items = [], valutabili = 0, totale = 0 } = esito

  return (
    <div className="glass-panel p-4 mb-5" data-testid={'abbinamenti-' + def.key}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-xs font-semibold text-ink flex items-center gap-1.5"><Icon name="link" size={13} />{esito.titolo || def.label}</span>
        {valutabili > 0 && <span className="text-[11px] text-gray-500">{totale === 0 ? 'nessuno' : totale + (totale > items.length ? ' (primi ' + items.length + ')' : '')}</span>}
      </div>
      {valutabili === 0 ? (
        <div className="text-xs text-gray-500">Compila almeno uno dei campi usati per l'abbinamento, e qui compaiono i record che gli corrispondono.</div>
      ) : items.length === 0 ? (
        <div className="text-xs text-gray-500">Nessun record corrisponde ai criteri indicati.</div>
      ) : (
        <ul className="space-y-2">
          {items.map((it) => (
            <li key={it.id} className="border-b border-gray-800/60 pb-2 last:border-0 last:pb-0">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm text-ink truncate">{it.titolo}</span>
                <span className="text-[11px] text-gray-500 flex-shrink-0">{Math.round(it.punteggio * 100)}%</span>
              </div>
              {it.dettagli.length > 0 && <div className="text-xs text-gray-400 mt-0.5">{it.dettagli.map((d) => formatta(d.valore)).join(' · ')}</div>}
              <div className="flex flex-wrap gap-1 mt-1">
                {it.soddisfatte.map((l) => <span key={'s' + l} className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300">{l}</span>)}
                {it.mancanti.map((l) => <span key={'m' + l} className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/5 text-gray-500 line-through">{l}</span>)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function AbbinamentiSezione({ api, slug, recordId, definizioni }) {
  return <>{(definizioni || []).map((def) => <Elenco key={def.key} api={api} slug={slug} recordId={recordId} def={def} />)}</>
}
