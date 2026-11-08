import React, { useEffect, useState } from 'react'
import useApi from '../lib/useApi'
import { apriModulo, elencoFiltri, passaTutti } from '../lib/filtroWidget'

// «Segnali»: un gruppo di conteggi con soglia («mandati in scadenza», «trattative ferme», «documenti mancanti»…). Ogni voce conta i record di un modulo che passano uno o più filtri e si clicca:
// apre il modulo con gli stessi filtri applicati. Le voci a zero spariscono (con «tutto a posto» se sono tutte a zero): un segnale vuoto non deve occupare spazio.
//   config.voci: [{ etichetta, modulo, filtri: [{ campo, op, valore }], tono: 'avviso' | 'errore' | 'ok' }]
const TONO = { errore: 'text-red-400', avviso: 'text-amber-400', ok: 'text-emerald-400' }

export default function SegnaliWidget({ token, config, label, onNavigate }) {
  const api = useApi(token)
  const voci = (config && config.voci) || []
  const [conteggi, setConteggi] = useState(null)
  useEffect(() => {
    (async () => {
      const cache = {}
      const out = []
      for (const v of voci) {
        if (!v.modulo) { out.push(0); continue }
        if (!cache[v.modulo]) cache[v.modulo] = await api.get('/records/' + v.modulo)
        const recs = Array.isArray(cache[v.modulo]) ? cache[v.modulo] : []
        out.push(recs.filter((r) => passaTutti(r, elencoFiltri(v))).length)
      }
      setConteggi(out)
    })().catch(() => setConteggi(voci.map(() => 0)))
  }, [JSON.stringify(voci)]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!voci.length) return <div className="p-5 text-sm text-gray-500">Nessun segnale configurato.</div>
  const attivi = voci.map((v, i) => ({ v, n: conteggi ? conteggi[i] : null })).filter((x) => x.n === null || x.n > 0)
  return (
    <div className="p-5">
      <div className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-3">{label || 'Da sistemare'}</div>
      {conteggi && attivi.length === 0 && <div className="text-sm text-emerald-400">Tutto a posto: niente da sistemare.</div>}
      <div className="flex flex-wrap gap-2">
        {attivi.map(({ v, n }) => (
          <button key={v.etichetta} type="button" onClick={() => apriModulo(onNavigate, v.modulo, elencoFiltri(v))} title="Apri l'elenco filtrato"
            className="flex items-center gap-2 border border-gray-700 hover:border-accent rounded-lg px-3 py-2 text-sm transition">
            <b className={'text-base ' + (TONO[v.tono] || TONO.avviso)}>{n === null ? '…' : n}</b><span className="text-gray-300">{v.etichetta}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
