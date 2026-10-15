import React, { useState, useEffect } from 'react'
import useApi from '../lib/useApi'
import Icon from './Icon'

// Timbrature rapide (2026-10-14, richiesto dall'utente): entrata/uscita e il
// recap della giornata, dalla dashboard invece che solo dal bot Telegram.
// Generico come il resto della piattaforma: legge QUALE modulo è di tipo
// "presenze" da Builder → Ruoli del modulo (stessa dichiarazione già usata
// da bot-timbrature.js), nessun nome di modulo scritto qui. Scrive con la
// stessa API /records di sempre — stessi permessi di chiunque altro,
// "solo propri" per chi non è admin compreso.
// Due righe sempre visibili, data e orario sempre modificabili PRIMA di
// premere (non un tocco cieco sull'ora corrente): Entrata registra una
// nuova riga, Uscita chiude l'ultimo turno aperto. Niente stati nascosti
// o pagine a parte per l'uso di tutti i giorni (feedback dell'utente,
// due versioni precedenti erano troppo complicate).
const pad2 = (n) => String(n).padStart(2, '0')
const oggiLocale = () => { const d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) }
const oraLocale = () => { const d = new Date(); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) }
const shiftDay = (iso, delta) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + delta); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) }
const toMin = (hhmm) => { if (!hhmm) return null; const [h, m] = String(hhmm).slice(0, 5).split(':').map(Number); return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null }
const hhmm = (v) => (v ? String(v).slice(0, 5) : '')
const durata = (min) => { if (min == null || min < 0) return '—'; const h = Math.floor(min / 60), m = Math.round(min % 60); return (h ? h + 'h ' : '') + (m || !h ? m + 'm' : '') }

export default function TimbratureWidget({ token, user, onNavigate }) {
  const api = useApi(token)
  const [mod, setMod] = useState(undefined) // undefined = in caricamento, null = nessun modulo dichiarato
  const [rows, setRows] = useState([])
  const [busy, setBusy] = useState('') // '' | 'entrata' | 'uscita'
  const [error, setError] = useState('')
  const [eData, setEData] = useState(oggiLocale())
  const [eOra, setEOra] = useState(oraLocale())
  const [uData, setUData] = useState(oggiLocale())
  const [uOra, setUOra] = useState(oraLocale())

  const load = async () => {
    const list = await api.get('/module-roles/presenze')
    const m = Array.isArray(list) && list.length ? list[0] : null
    setMod(m)
    if (m) {
      const recs = await api.get('/records/' + m.module_slug)
      setRows(Array.isArray(recs) ? recs.filter((r) => r.user_id === user.id) : [])
    }
  }
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (mod === undefined) return <div className="p-5 text-sm text-gray-600">Caricamento…</div>
  if (mod === null) return (
    <div className="p-5">
      <div className="flex items-center gap-2 mb-1"><Icon name="clock" size={15} className="text-gray-500" /><h2 className="text-sm font-semibold text-ink">Timbrature</h2></div>
      <div className="text-xs text-gray-500">Nessun modulo di timbrature dichiarato (Builder → Ruoli del modulo → tipo «Timbrature»).</div>
    </div>
  )

  const oggi = oggiLocale()
  const mie = rows.filter((r) => r.data && r.data[mod.data])
  const aperte = mie.filter((r) => toMin(r.data[mod.inizio]) != null && toMin(r.data[mod.fine]) == null && String(r.data[mod.data]).slice(0, 10) >= shiftDay(oggi, -1))
    .sort((a, b) => String(b.data[mod.data]).localeCompare(String(a.data[mod.data])) || toMin(b.data[mod.inizio]) - toMin(a.data[mod.inizio]))
  const aperta = aperte[0] || null

  const turniOggi = mie.filter((r) => String(r.data[mod.data]).slice(0, 10) === oggi).sort((a, b) => (toMin(a.data[mod.inizio]) || 0) - (toMin(b.data[mod.inizio]) || 0))
  let totaleMin = turniOggi.reduce((t, r) => { const a = toMin(r.data[mod.inizio]), b = toMin(r.data[mod.fine]); return t + (a != null && b != null ? Math.max(0, b - a) : 0) }, 0)
  if (aperta && String(aperta.data[mod.data]).slice(0, 10) === oggi) totaleMin += Math.max(0, toMin(oraLocale()) - toMin(aperta.data[mod.inizio]))

  const registraEntrata = async () => {
    if (!eData || !eOra) { setError('Data e orario di entrata obbligatori'); return }
    setBusy('entrata'); setError('')
    const res = await api.post('/records/' + mod.module_slug, { [mod.data]: eData, [mod.inizio]: eOra })
    setBusy('')
    if (!res.ok) { setError((res.data && res.data.error) || 'Non riuscito'); return }
    setEData(oggiLocale()); setEOra(oraLocale()); load()
  }
  // La data della riga «Uscita» non sposta il turno a un altro giorno (un turno ha una sola data):
  // sceglie QUALE turno aperto chiudere, quando ce n'è più di uno (es. uno dimenticato di ieri).
  const daChiudere = aperte.find((r) => String(r.data[mod.data]).slice(0, 10) === uData) || null
  const registraUscita = async () => {
    if (!uData || !uOra) { setError('Data e orario di uscita obbligatori'); return }
    if (!daChiudere) { setError('Nessun turno aperto in quella data.'); return }
    setBusy('uscita'); setError('')
    const res = await api.put('/records/' + mod.module_slug + '/' + daChiudere.id, { ...daChiudere.data, [mod.fine]: uOra })
    setBusy('')
    if (!res.ok) { setError((res.data && res.data.error) || 'Non riuscito'); return }
    setUData(oggiLocale()); setUOra(oraLocale()); load()
  }

  const inp = 'bg-gray-900 border border-gray-800 rounded-lg px-2 py-1.5 text-sm text-ink min-w-0'

  return (
    <div className="p-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <Icon name="clock" size={15} className={aperta ? 'text-green-500' : 'text-gray-500'} />
          <h2 className="text-sm font-semibold text-ink">Timbrature</h2>
        </div>
        <div className="text-xs text-gray-500">Oggi: <span className="text-ink font-medium">{durata(totaleMin)}</span></div>
      </div>
      {error && <div className="text-xs text-red-400 bg-red-900/20 border border-red-900/40 rounded-lg p-2.5 mb-3">{error}</div>}
      <div className={'text-xs mb-3 ' + (aperta ? 'text-green-400' : 'text-gray-500')}>{aperta ? '🟢 Al lavoro dalle ' + hhmm(aperta.data[mod.inizio]) : '⚪ Non al lavoro'}</div>

      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-gray-400 w-14 flex-shrink-0">Entrata</span>
          <input type="date" value={eData} onChange={(e) => setEData(e.target.value)} className={inp + ' flex-1'} />
          <input type="time" value={eOra} onChange={(e) => setEOra(e.target.value)} className={inp + ' w-24'} />
          <button onClick={registraEntrata} disabled={!!busy} className="bg-accent hover:opacity-90 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition flex-shrink-0">
            {busy === 'entrata' ? '...' : 'Entra'}
          </button>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-gray-400 w-14 flex-shrink-0">Uscita</span>
          <input type="date" value={uData} onChange={(e) => setUData(e.target.value)} className={inp + ' flex-1'} />
          <input type="time" value={uOra} onChange={(e) => setUOra(e.target.value)} className={inp + ' w-24'} />
          <button onClick={registraUscita} disabled={!!busy || !daChiudere} title={daChiudere ? '' : 'Nessun turno aperto in quella data'} className="bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition flex-shrink-0">
            {busy === 'uscita' ? '...' : 'Esci'}
          </button>
        </div>
      </div>

      {turniOggi.length > 0 && (
        <div className="text-xs text-gray-500 mt-3 pt-3 border-t border-gray-800 space-y-0.5">
          {turniOggi.map((r) => <div key={r.id}>{hhmm(r.data[mod.inizio])} – {hhmm(r.data[mod.fine]) || 'in corso'}</div>)}
        </div>
      )}
      {onNavigate && (
        <button type="button" onClick={() => onNavigate(mod.module_slug)} className="text-xs text-gray-500 hover:text-accent transition mt-3 underline">
          Apri il modulo (modifica o elimina un turno) →
        </button>
      )}
    </div>
  )
}
