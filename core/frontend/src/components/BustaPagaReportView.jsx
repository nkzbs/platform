import React, { useEffect, useState } from 'react'
import useApi from '../lib/useApi'
import Icon from './Icon'

// Report ore (busta paga vs timbrature) e saldi ferie/permessi/ROL, dentro il modulo Busta Paga
// stesso (richiesto dall'utente il 2026-10-25: "Platoform è la base, BOT è opzionale" — questa
// informazione non può esistere solo nel bot Telegram). Stessa logica già testata via il bot
// (bot-payslip.js), qui solo una presentazione diversa. Generico: si mostra solo se il modulo che
// si sta guardando è DAVVERO quello dichiarato come "bustapaga" (Builder → Ruoli del modulo) —
// nessun nome di modulo scritto qui, stesso principio di TimbratureWidget/ImportPayslip.
export default function BustaPagaReportView({ token, mod }) {
  const api = useApi(token)
  const [attivo, setAttivo] = useState(undefined) // undefined = in caricamento
  const [ore, setOre] = useState(null)
  const [saldi, setSaldi] = useState(null)

  useEffect(() => {
    let vivo = true
    api.get('/module-roles/bustapaga').then((list) => {
      const m = Array.isArray(list) && list.length ? list[0] : null
      if (!vivo) return
      if (!m || m.module_slug !== mod.slug) { setAttivo(false); return }
      setAttivo(true)
      Promise.all([api.get('/busta-paga-report/ore'), api.get('/busta-paga-report/saldi')]).then(([o, s]) => {
        if (!vivo) return
        if (o && o.disponibile) setOre(o)
        if (s && s.disponibile) setSaldi(s)
      })
    })
    return () => { vivo = false }
  }, [mod.slug]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!attivo) return null

  const tile = (label, v) => v ? (
    <div className="bg-surface-page rounded-lg px-3 py-2 flex-1 min-w-[120px]">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-lg font-bold text-ink">{v.valore}</div>
      <div className="text-[11px] text-gray-500">da {v.label}</div>
    </div>
  ) : null

  const righeConDati = ore && ore.righe ? ore.righe.filter((r) => r.pagate != null || r.timbrate != null) : []

  if (!saldi && righeConDati.length === 0) return null

  return (
    <div className="bg-surface-card border border-gray-800 rounded-lg p-4 mb-6">
      <div className="flex items-center gap-2 mb-3 text-sm font-medium text-ink">
        <Icon name="bar-chart" size={15} />Report busta paga
      </div>
      {saldi && (saldi.ferie || saldi.permessi || saldi.rol) && (
        <div className="flex gap-2 flex-wrap mb-4">
          {tile('Ferie residue', saldi.ferie)}
          {tile('Permessi/ex-festività', saldi.permessi)}
          {tile('ROL/banca ore', saldi.rol)}
        </div>
      )}
      {righeConDati.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-800">
                <th className="py-1.5 pr-3 font-medium">Periodo</th>
                <th className="py-1.5 pr-3 font-medium">Ore pagate</th>
                <th className="py-1.5 pr-3 font-medium">{ore.ha_timbrature ? 'Ore timbrate' : ''}</th>
                <th className="py-1.5 font-medium">{ore.ha_timbrature ? 'Scarto' : ''}</th>
              </tr>
            </thead>
            <tbody>
              {righeConDati.map((r) => (
                <tr key={r.periodo} className="border-b border-gray-900 last:border-0">
                  <td className="py-1.5 pr-3 text-gray-300">{r.label}</td>
                  <td className="py-1.5 pr-3 text-ink font-mono">{r.pagate != null ? r.pagate + 'h' : '—'}</td>
                  <td className="py-1.5 pr-3 text-ink font-mono">{ore.ha_timbrature ? (r.timbrate != null ? r.timbrate + 'h' : 'nessuna timbratura') : ''}</td>
                  <td className={'py-1.5 font-mono font-medium ' + (r.diff != null && Math.abs(r.diff) >= 0.5 ? 'text-amber-400' : 'text-gray-500')}>
                    {ore.ha_timbrature ? (r.diff != null ? (Math.abs(r.diff) >= 0.5 ? (r.diff > 0 ? '+' : '') + r.diff + 'h' : 'torna') : '—') : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!ore?.ha_timbrature && righeConDati.length > 0 && (
        <div className="text-xs text-gray-500 mt-2">Non hai un modulo di timbrature: mostro solo le ore pagate.</div>
      )}
    </div>
  )
}
