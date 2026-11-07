import React, { useState, useEffect } from 'react'
import useApi from '../lib/useApi'
import Icon from './Icon'

// «Oggi da fare»: le righe con una scadenza (visite, provvigioni da incassare, richieste da evadere…) dei moduli che hanno acceso le scadenze negli Avvisi
// e dichiarato il campo scadenza (Builder → Ruoli del modulo). Divise in In ritardo / Oggi / Prossimi giorni; quelle già nello stato «fatto» non compaiono.
// Nessun nome di modulo scritto qui: l'elenco viene da /module-roles/agenda e le righe dall'elenco normale del modulo (che rispetta i permessi).
const GIORNI = 7
const MAX = 6
const oggiIso = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') }
const fmtDate = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '')
const giorniFra = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000)

export default function AgendaWidget({ token, onNavigate }) {
  const api = useApi(token)
  const [gruppi, setGruppi] = useState(null)

  useEffect(() => {
    (async () => {
      const mods = await api.get('/module-roles/agenda')
      const oggi = oggiIso()
      const voci = []
      for (const m of Array.isArray(mods) ? mods : []) {
        const recs = await api.get('/records/' + m.module_slug)
        for (const r of Array.isArray(recs) ? recs : []) {
          const d = r.data || {}
          const quando = String(d[m.scadenza] || '').slice(0, 10)
          if (!/^\d{4}-\d{2}-\d{2}$/.test(quando)) continue
          if (m.fatto && (d[m.stato] === m.fatto)) continue
          const delta = giorniFra(oggi, quando)
          if (delta > GIORNI) continue
          voci.push({ id: m.module_slug + '#' + r.id, modulo: m.module_slug, nomeModulo: m.name, titolo: d[m.descrizione] || m.noun_s || m.name, quando, delta })
        }
      }
      voci.sort((a, b) => a.quando.localeCompare(b.quando))
      setGruppi([
        { chiave: 'ritardo', titolo: 'In ritardo', colore: 'text-red-500', voci: voci.filter((v) => v.delta < 0) },
        { chiave: 'oggi', titolo: 'Oggi', colore: 'text-accent', voci: voci.filter((v) => v.delta === 0) },
        { chiave: 'presto', titolo: 'Nei prossimi ' + GIORNI + ' giorni', colore: 'text-gray-400', voci: voci.filter((v) => v.delta > 0) },
      ])
    })().catch(() => setGruppi([]))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (gruppi === null) return <div className="p-5 text-sm text-gray-600">Caricamento…</div>
  const totale = gruppi.reduce((t, g) => t + g.voci.length, 0)
  return (
    <div className="p-5">
      <div className="flex items-center gap-2 mb-3">
        <Icon name="calendar" size={15} className="text-accent" />
        <h2 className="text-sm font-semibold text-ink">Da fare{totale ? ' · ' + totale : ''}</h2>
      </div>
      {totale === 0 && <div className="text-xs text-gray-500">Niente in scadenza: giornata libera.</div>}
      {gruppi.filter((g) => g.voci.length).map((g) => (
        <div key={g.chiave} className="mb-3 last:mb-0">
          <div className={'text-[11px] uppercase tracking-wide mb-1 font-semibold ' + g.colore}>{g.titolo} · {g.voci.length}</div>
          <div className="divide-y divide-gray-800">
            {g.voci.slice(0, MAX).map((v) => (
              <button key={v.id} type="button" onClick={() => onNavigate && onNavigate(v.modulo)} className="w-full text-left flex items-center gap-3 py-2 hover:bg-white/[0.03] rounded">
                <span className="flex-1 min-w-0 text-sm text-ink break-words">{v.titolo}</span>
                <span className="text-xs text-gray-500 flex-shrink-0">{v.nomeModulo}{g.chiave !== 'oggi' ? ' · ' + (g.chiave === 'ritardo' ? 'da ' + Math.abs(v.delta) + ' gg' : fmtDate(v.quando)) : ''}</span>
              </button>
            ))}
          </div>
          {g.voci.length > MAX && <div className="text-xs text-gray-500 mt-1">… e altre {g.voci.length - MAX}</div>}
        </div>
      ))}
    </div>
  )
}
