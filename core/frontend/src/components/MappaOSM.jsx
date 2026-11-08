import React, { useState, useEffect } from 'react'
import useApi from '../lib/useApi'
import Icon from './Icon'
import { griglia, urlTessera, ZOOM_MIN, ZOOM_MAX } from '../lib/tile-osm'

// Mappa di OpenStreetMap nella scheda (blocco `map_view`): l'indirizzo scritto nella scheda si cerca su Nominatim (dal nostro server, con cache) e le tessere si disegnano qui,
// senza librerie. Se l'indirizzo non si trova la mappa non compare. Fonte da citare: «© OpenStreetMap contributors».
const TILE = 256
export default function MappaOSM({ token, titolo, indirizzo, paese, servizi }) {
  const api = useApi(token)
  const [punto, setPunto] = useState(undefined) // undefined = sto cercando, null = non trovato, {lat,lon} = trovato
  const [z, setZ] = useState(16)
  useEffect(() => {
    let annullato = false
    setPunto(undefined)
    api.get('/geocode?q=' + encodeURIComponent(indirizzo) + (paese ? '&paese=' + encodeURIComponent(paese) : '')).then((r) => { if (!annullato) setPunto(r && r.trovato ? { lat: r.lat, lon: r.lon } : null) }).catch(() => { if (!annullato) setPunto(null) })
    return () => { annullato = true }
  }, [indirizzo, paese]) // eslint-disable-line react-hooks/exhaustive-deps

  // Servizi vicini (opzionale): il server li cerca in secondo plano (il servizio pubblico può metterci 30-40 secondi): si richiede ogni 5 secondi, al massimo per 2 minuti.
  const [elenco, setElenco] = useState(undefined) // undefined = cerco, null = non disponibile, { categorie } = pronto
  useEffect(() => {
    if (!servizi || !punto) return undefined
    let annullato = false, timer = null, tentativi = 0
    setElenco(undefined)
    const chiedi = () => api.get('/geocode/servizi?lat=' + punto.lat + '&lon=' + punto.lon).then((r) => {
      if (annullato) return
      if (r && r.disponibile) setElenco(r)
      else if (r && r.in_corso && ++tentativi < 24) timer = setTimeout(chiedi, 5000)
      else setElenco(null)
    }).catch(() => { if (!annullato) setElenco(null) })
    chiedi()
    return () => { annullato = true; if (timer) clearTimeout(timer) }
  }, [servizi, punto && punto.lat, punto && punto.lon]) // eslint-disable-line react-hooks/exhaustive-deps

  if (punto === null) return null
  const g = punto ? griglia(punto.lat, punto.lon, z) : null
  return (
    <div className="mb-4 bg-surface-page border border-gray-800 rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2">
        <Icon name="map-pin" size={13} className="text-gray-500" />
        <div className="flex-1 min-w-0"><div className="text-xs font-semibold text-gray-400">{titolo || 'Dove si trova'}</div><div className="text-[11px] text-gray-500 truncate">{indirizzo}</div></div>
        {punto && <a href={'https://www.openstreetmap.org/?mlat=' + punto.lat + '&mlon=' + punto.lon + '#map=' + z + '/' + punto.lat + '/' + punto.lon} target="_blank" rel="noreferrer" className="text-xs text-accent hover:opacity-80 flex-shrink-0">Apri la mappa</a>}
        {punto && <a href={'https://www.openstreetmap.org/directions?to=' + punto.lat + '%2C' + punto.lon} target="_blank" rel="noreferrer" className="text-xs text-accent hover:opacity-80 flex-shrink-0">Percorso</a>}
      </div>
      <div className="relative overflow-hidden bg-gray-800/40" style={{ height: 240 }} aria-label={'Mappa: ' + indirizzo} role="img">
        {punto === undefined && <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-500">Cerco l'indirizzo…</div>}
        {g && (
          <>
            <div className="absolute" style={{ left: '50%', top: '50%', width: TILE * 5, height: TILE * 3, transform: `translate(${-(2 + g.fx) * TILE}px, ${-(1 + g.fy) * TILE}px)` }}>
              {g.tessere.map((t) => <img key={t.dx + ':' + t.dy} src={urlTessera(z, t.x, t.y)} alt="" width={TILE} height={TILE} loading="lazy" draggable={false} className="absolute select-none" style={{ left: (t.dx + 2) * TILE, top: (t.dy + 1) * TILE }} />)}
            </div>
            <svg className="absolute" style={{ left: '50%', top: '50%', transform: 'translate(-50%, -100%)' }} width="28" height="38" viewBox="0 0 28 38" aria-hidden="true"><path d="M14 1C7 1 2 6.4 2 13c0 9 12 24 12 24s12-15 12-24C26 6.4 21 1 14 1z" fill="#dc2626" stroke="#fff" strokeWidth="2" /><circle cx="14" cy="13" r="4.5" fill="#fff" /></svg>
            <div className="absolute right-2 top-2 flex flex-col gap-1">
              <button type="button" onClick={() => setZ((v) => Math.min(ZOOM_MAX, v + 1))} disabled={z >= ZOOM_MAX} aria-label="Avvicina" className="w-8 h-8 rounded bg-white/90 text-gray-800 text-lg leading-none shadow disabled:opacity-40">+</button>
              <button type="button" onClick={() => setZ((v) => Math.max(ZOOM_MIN, v - 1))} disabled={z <= ZOOM_MIN} aria-label="Allontana" className="w-8 h-8 rounded bg-white/90 text-gray-800 text-lg leading-none shadow disabled:opacity-40">−</button>
            </div>
            <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="absolute right-0 bottom-0 bg-white/85 text-[10px] text-gray-700 px-1.5 py-0.5">© OpenStreetMap contributors</a>
          </>
        )}
      </div>
      {servizi && punto && (
        <div className="px-3 py-2.5 border-t border-gray-800">
          <div className="text-xs font-semibold text-gray-400 mb-1.5">Servizi vicini <span className="font-normal text-gray-500">(entro 1 km, a piedi: stima)</span></div>
          {elenco === undefined && <div className="text-[11px] text-gray-500">Cerco i servizi vicini… può servire qualche decina di secondi la prima volta.</div>}
          {elenco === null && <div className="text-[11px] text-gray-500">Servizi vicini non disponibili ora: il servizio di OpenStreetMap non ha risposto. Riapri la scheda più tardi.</div>}
          {elenco && (
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
              {elenco.categorie.map((c) => (
                <li key={c.chiave} className="text-[11px] leading-snug">
                  <div className="text-gray-300 font-medium">{c.label}</div>
                  <div className="text-gray-500 break-words">{c.piu_vicino ? (c.piu_vicino.nome ? c.piu_vicino.nome + ' · ' : '') + c.piu_vicino.metri + ' m, ~' + c.piu_vicino.minuti + ' min' + (c.quanti > 1 ? ' (' + c.quanti + ' in zona)' : '') : 'nessuno nel raggio'}</div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
