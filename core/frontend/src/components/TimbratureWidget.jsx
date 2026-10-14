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
const pad2 = (n) => String(n).padStart(2, '0')
const oggiLocale = () => { const d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) }
const oraLocale = () => { const d = new Date(); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) }
const shiftDay = (iso, delta) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + delta); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) }
const toMin = (hhmm) => { if (!hhmm) return null; const [h, m] = String(hhmm).slice(0, 5).split(':').map(Number); return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null }
const hhmm = (v) => (v ? String(v).slice(0, 5) : '')
const durata = (min) => { if (min == null || min < 0) return '—'; const h = Math.floor(min / 60), m = Math.round(min % 60); return (h ? h + 'h ' : '') + (m || !h ? m + 'm' : '') }

export default function TimbratureWidget({ token, user }) {
  const api = useApi(token)
  const [mod, setMod] = useState(undefined) // undefined = in caricamento, null = nessun modulo dichiarato
  const [rows, setRows] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [edit, setEdit] = useState(null) // null | { id: null|number, data, inizio, fine }
  const [, setTick] = useState(0) // forza il ricalcolo del minutaggio in corso ogni minuto

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
  useEffect(() => { const iv = setInterval(() => setTick((t) => t + 1), 60000); return () => clearInterval(iv) }, [])

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

  const entra = async () => {
    setBusy(true); setError('')
    const res = await api.post('/records/' + mod.module_slug, { [mod.data]: oggi, [mod.inizio]: oraLocale() })
    setBusy(false)
    if (!res.ok) { setError((res.data && res.data.error) || 'Non riuscito'); return }
    load()
  }
  const esce = async () => {
    if (!aperta) return
    setBusy(true); setError('')
    const res = await api.put('/records/' + mod.module_slug + '/' + aperta.id, { ...aperta.data, [mod.fine]: oraLocale() })
    setBusy(false)
    if (!res.ok) { setError((res.data && res.data.error) || 'Non riuscito'); return }
    load()
  }

  const apriNuovo = () => setEdit({ id: null, data: oggi, inizio: oraLocale(), fine: '' })
  const apriRiga = (r) => setEdit({ id: r.id, data: String(r.data[mod.data]).slice(0, 10), inizio: hhmm(r.data[mod.inizio]), fine: hhmm(r.data[mod.fine]) })
  const salva = async () => {
    if (!edit.data || !edit.inizio) { setError('Data e orario di entrata obbligatori'); return }
    setBusy(true); setError('')
    const payload = { [mod.data]: edit.data, [mod.inizio]: edit.inizio, [mod.fine]: edit.fine || null }
    const base = edit.id ? (rows.find((r) => r.id === edit.id) || {}).data || {} : {}
    const res = edit.id
      ? await api.put('/records/' + mod.module_slug + '/' + edit.id, { ...base, ...payload })
      : await api.post('/records/' + mod.module_slug, payload)
    setBusy(false)
    if (!res.ok) { setError((res.data && res.data.error) || 'Non riuscito'); return }
    setEdit(null); load()
  }
  const elimina = async () => {
    if (!edit.id) return
    setBusy(true); setError('')
    const res = await api.del('/records/' + mod.module_slug + '/' + edit.id)
    setBusy(false)
    if (!res.ok) { setError('Non riuscito'); return }
    setEdit(null); load()
  }

  return (
    <div className="p-5">
      <div className="flex items-center gap-2 mb-3">
        <Icon name="clock" size={15} className={aperta ? 'text-green-500' : 'text-gray-500'} />
        <h2 className="text-sm font-semibold text-ink">Timbrature</h2>
      </div>
      {error && <div className="text-xs text-red-400 bg-red-900/20 border border-red-900/40 rounded-lg p-2.5 mb-3">{error}</div>}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className={'text-sm font-medium ' + (aperta ? 'text-green-400' : 'text-gray-400')}>
            {aperta ? '🟢 Al lavoro dalle ' + hhmm(aperta.data[mod.inizio]) : '⚪ Non al lavoro'}
          </div>
          <div className="text-xs text-gray-500 mt-0.5">Oggi: <span className="text-ink font-medium">{durata(totaleMin)}</span></div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button onClick={aperta ? esce : entra} disabled={busy} className={'px-4 py-2.5 rounded-lg text-sm font-medium transition disabled:opacity-50 ' + (aperta ? 'bg-red-700 hover:bg-red-600 text-white' : 'bg-accent hover:opacity-90 text-white')}>
            {busy ? '...' : aperta ? 'Esci' : 'Entra'}
          </button>
          <button onClick={aperta ? () => apriRiga(aperta) : apriNuovo} disabled={busy} title="Inserisci data e orario a mano" className="p-2.5 rounded-lg text-gray-400 hover:text-ink hover:bg-gray-800 transition disabled:opacity-50">
            <Icon name="edit" size={15} />
          </button>
        </div>
      </div>
      {turniOggi.length > 0 && (
        <div className="text-xs text-gray-500 mt-3 pt-3 border-t border-gray-800 space-y-0.5">
          {turniOggi.map((r) => (
            <button key={r.id} onClick={() => apriRiga(r)} className="block w-full text-left hover:text-ink transition">
              {hhmm(r.data[mod.inizio])} – {hhmm(r.data[mod.fine]) || 'in corso'}
            </button>
          ))}
        </div>
      )}
      {edit && (
        <div className="mt-3 pt-3 border-t border-gray-800 space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <div><label className="text-[10px] text-gray-500 block mb-1">Data</label><input type="date" value={edit.data} onChange={(e) => setEdit({ ...edit, data: e.target.value })} className="w-full bg-gray-900 border border-gray-800 rounded-lg px-2 py-1.5 text-sm text-ink" /></div>
            <div><label className="text-[10px] text-gray-500 block mb-1">Entrata</label><input type="time" value={edit.inizio} onChange={(e) => setEdit({ ...edit, inizio: e.target.value })} className="w-full bg-gray-900 border border-gray-800 rounded-lg px-2 py-1.5 text-sm text-ink" /></div>
            <div><label className="text-[10px] text-gray-500 block mb-1">Uscita</label><input type="time" value={edit.fine} onChange={(e) => setEdit({ ...edit, fine: e.target.value })} className="w-full bg-gray-900 border border-gray-800 rounded-lg px-2 py-1.5 text-sm text-ink" /></div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={salva} disabled={busy} className="px-3 py-1.5 rounded-lg text-sm font-medium bg-accent hover:opacity-90 text-white transition disabled:opacity-50">Salva</button>
            {edit.id != null && <button onClick={elimina} disabled={busy} className="px-3 py-1.5 rounded-lg text-sm font-medium text-red-400 hover:bg-red-900/20 transition disabled:opacity-50">Elimina</button>}
            <button onClick={() => setEdit(null)} disabled={busy} className="px-3 py-1.5 rounded-lg text-sm text-gray-400 hover:text-ink transition disabled:opacity-50">Annulla</button>
          </div>
        </div>
      )}
    </div>
  )
}
