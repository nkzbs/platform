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
// Un solo modulo sempre visibile (data e orario modificabili PRIMA di
// premere, non un tocco cieco sull'ora corrente) e un interruttore
// Entrata / Uscita: Entrata registra una nuova riga, Uscita chiude il turno
// aperto. L'interruttore segue lo stato (al lavoro → Uscita) ma si cambia a
// mano. Contatore grande delle ore di oggi (24/11/2026, scelta «1» tra sei
// bozze in docs/mockup-timbrature-ef.html). Niente stati nascosti o pagine a
// parte per l'uso di tutti i giorni (feedback dell'utente, due versioni
// precedenti erano troppo complicate).
const pad2 = (n) => String(n).padStart(2, '0')
const oggiLocale = () => { const d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) }
const oraLocale = () => { const d = new Date(); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) }
const shiftDay = (iso, delta) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + delta); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) }
const toMin = (hhmm) => { if (!hhmm) return null; const [h, m] = String(hhmm).slice(0, 5).split(':').map(Number); return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null }
const hhmm = (v) => (v ? String(v).slice(0, 5) : '')
const ore = (min) => { const t = Math.max(0, Math.round(min || 0)); return Math.floor(t / 60) + 'h ' + pad2(t % 60) + 'm' } // contatore grande: sempre «Xh YYm»
const durata = (min) => { if (min == null || min < 0) return '—'; const h = Math.floor(min / 60), m = Math.round(min % 60); return (h ? h + 'h ' : '') + (m || !h ? m + 'm' : '') }

export default function TimbratureWidget({ token, user, onNavigate }) {
  const api = useApi(token)
  const [mod, setMod] = useState(undefined) // undefined = in caricamento, null = nessun modulo dichiarato
  const [rows, setRows] = useState([])
  const [busy, setBusy] = useState('') // '' | 'entrata' | 'uscita'
  const [error, setError] = useState('')
  const [modo, setModo] = useState(null) // null = segue lo stato (al lavoro → uscita), altrimenti 'entrata' | 'uscita' scelto a mano
  const [dataScelta, setDataScelta] = useState(null) // null = oggi (o, per un'uscita, il giorno del turno aperto)
  const [ora, setOra] = useState(oraLocale())
  const [, ticchetta] = useState(0)

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
  useEffect(() => { const t = setInterval(() => ticchetta((n) => n + 1), 30000); return () => clearInterval(t) }, []) // il contatore avanza da solo mentre si è al lavoro

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

  const modoEff = modo || (aperta ? 'uscita' : 'entrata')
  const data = dataScelta || (modoEff === 'uscita' && aperta ? String(aperta.data[mod.data]).slice(0, 10) : oggi)
  const riparti = () => { setModo(null); setDataScelta(null); setOra(oraLocale()); load() }

  const registraEntrata = async () => {
    if (!data || !ora) { setError('Data e orario di entrata obbligatori'); return }
    setBusy('entrata'); setError('')
    const res = await api.post('/records/' + mod.module_slug, { [mod.data]: data, [mod.inizio]: ora })
    setBusy('')
    if (!res.ok) { setError((res.data && res.data.error) || 'Non riuscito'); return }
    riparti()
  }
  // La data dell'uscita non sposta il turno a un altro giorno (un turno ha una sola data):
  // sceglie QUALE turno aperto chiudere, quando ce n'è più di uno (es. uno dimenticato di ieri).
  const daChiudere = aperte.find((r) => String(r.data[mod.data]).slice(0, 10) === data) || null
  const registraUscita = async () => {
    if (!data || !ora) { setError('Data e orario di uscita obbligatori'); return }
    if (!daChiudere) { setError('Nessun turno aperto in quella data.'); return }
    setBusy('uscita'); setError('')
    const res = await api.put('/records/' + mod.module_slug + '/' + daChiudere.id, { ...daChiudere.data, [mod.fine]: ora })
    setBusy('')
    if (!res.ok) { setError((res.data && res.data.error) || 'Non riuscito'); return }
    riparti()
  }

  const inp = 'bg-surface-input border border-gray-800 rounded-xl px-3 py-2.5 text-sm text-ink min-w-0 w-full'
  const interruttore = (chiave, etichetta, attivoCls) => (
    <button type="button" role="radio" aria-checked={modoEff === chiave} onClick={() => setModo(chiave)}
      className={'py-2 rounded-lg text-sm transition ' + (modoEff === chiave ? attivoCls + ' text-white font-semibold' : 'text-gray-400 hover:text-ink')}>{etichetta}</button>
  )

  return (
    <div className="p-5">
      <div className="flex items-center justify-between gap-3 mb-1">
        <div className="flex items-center gap-2">
          <Icon name="clock" size={15} className={aperta ? 'text-green-500' : 'text-gray-500'} />
          <h2 className="text-sm font-semibold text-ink">Timbrature</h2>
        </div>
        <span className={'inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full ' + (aperta ? 'bg-green-900/30 text-green-400' : 'bg-surface-input text-gray-500')}>
          <span className={'w-2 h-2 rounded-full ' + (aperta ? 'bg-green-500' : 'bg-gray-600')} />
          {aperta ? 'Al lavoro dalle ' + hhmm(aperta.data[mod.inizio]) : 'Non al lavoro'}
        </span>
      </div>
      <div className="mt-2 text-4xl font-bold text-ink tracking-tight leading-none tabular-nums">{ore(totaleMin)}</div>
      <div className="text-xs text-gray-500 mt-1 mb-3">ore di oggi</div>
      {error && <div className="text-xs text-red-400 bg-red-900/20 border border-red-900/40 rounded-lg p-2.5 mb-3">{error}</div>}

      <div role="radiogroup" aria-label="Cosa registrare" className="grid grid-cols-2 gap-0.5 p-0.5 rounded-xl bg-surface-input border border-gray-800 mb-3">
        {interruttore('entrata', 'Entrata', 'bg-accent')}
        {interruttore('uscita', 'Uscita', 'bg-red-700')}
      </div>
      <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-2 mb-3">
        <input type="date" aria-label="Data" value={data} onChange={(e) => setDataScelta(e.target.value)} className={inp} />
        <input type="time" aria-label="Orario" value={ora} onChange={(e) => setOra(e.target.value)} className={inp} />
      </div>
      {modoEff === 'entrata'
        ? <button onClick={registraEntrata} disabled={!!busy} className="w-full bg-accent hover:opacity-90 disabled:opacity-50 text-white py-2.5 rounded-xl text-sm font-semibold transition">{busy === 'entrata' ? '...' : 'Registra entrata'}</button>
        : <button onClick={registraUscita} disabled={!!busy} className="w-full bg-red-700 hover:bg-red-600 disabled:opacity-50 text-white py-2.5 rounded-xl text-sm font-semibold transition">{busy === 'uscita' ? '...' : 'Registra uscita'}</button>}

      {turniOggi.length > 0 && (
        <div className="text-xs text-gray-500 mt-3 pt-3 border-t border-gray-800 flex flex-wrap gap-x-3 gap-y-0.5">
          {turniOggi.map((r) => <span key={r.id}>{hhmm(r.data[mod.inizio])} – {hhmm(r.data[mod.fine]) || 'in corso'}</span>)}
        </div>
      )}
      {onNavigate && (
        <button type="button" onClick={() => onNavigate(mod.module_slug)} className="text-xs text-gray-500 hover:text-accent transition mt-3 underline">
          Modifica o elimina un turno
        </button>
      )}
    </div>
  )
}
