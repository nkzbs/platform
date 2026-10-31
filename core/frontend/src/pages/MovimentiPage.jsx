import React, { useState, useEffect, useRef } from 'react'
import useApi from '../lib/useApi'
import { API } from '../lib/api'
import Icon from '../components/Icon'

const eur = (n) => (n == null ? '—' : Math.abs(n).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €')
const monthLabel = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' }) }
const shift = (ym, d) => { const [y, m] = ym.split('-').map(Number); const t = y * 12 + (m - 1) + d; return Math.floor(t / 12) + '-' + String((t % 12) + 1).padStart(2, '0') }
const KIND = { stipendio: 'Stipendio', commissioni: 'Commissioni', giro_interno: 'Giro tra tuoi conti', prelievo: 'Prelievo', carta: 'Carta', utenza: 'Utenza', bonifico_in: 'Bonifico in entrata', bonifico_out: 'Bonifico', altro: 'Altro', altro_in: 'Entrata' }
const FILTERS = [['da_registrare', 'Da registrare'], ['tutti', 'Tutti'], ['giri', 'Giri tra conti'], ['entrate', 'Entrate']]

// Movimenti del conto letti dagli estratti (PDF): si vede cosa succede davvero e si completa Finance.
export default function MovimentiPage({ token }) {
  const api = useApi(token)
  const fileRef = useRef(null)
  const [month, setMonth] = useState(shift(new Date().toISOString().slice(0, 7), -1))
  const [filter, setFilter] = useState('da_registrare')
  const [summary, setSummary] = useState(null)
  const [rows, setRows] = useState(null)
  const [cats, setCats] = useState([])
  const [pick, setPick] = useState({}) // id -> categoria scelta
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState(null)
  const [err, setErr] = useState('')

  const load = async () => {
    const [s, r] = await Promise.all([api.get('/bank/summary?month=' + month), api.get('/bank/movements?month=' + month + '&filter=' + filter)])
    setSummary(s); setRows(Array.isArray(r) ? r : [])
  }
  useEffect(() => { load() }, [month, filter]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    // le categorie vengono dal modulo che ha dichiarato di ricevere le spese dall'estratto conto (Builder → Ruoli del modulo)
    api.get('/bank/target').then((t) => { if (t && Array.isArray(t.categorie)) setCats(t.categorie) })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const upload = async (files) => {
    if (!files || !files.length) return
    setUploading(true); setErr(''); setResult(null)
    const fd = new FormData()
    for (const f of files) fd.append('files', f)
    try {
      const res = await fetch(API + '/bank/import', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: fd })
      const data = await res.json()
      if (!res.ok) setErr(data.error || 'Caricamento non riuscito.')
      else { setResult(data); await load() }
    } catch (e) { setErr('Caricamento non riuscito.') }
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
  }
  const register = async (m) => {
    const res = await api.post('/bank/movements/' + m.id + '/register', { categoria: pick[m.id] || m.category_hint || 'Altro' })
    if (!res.ok) setErr((res.data && res.data.error) || 'Non sono riuscito a registrare la spesa.'); else load()
  }
  const ignore = async (m) => { await api.post('/bank/movements/' + m.id + '/ignore', {}); load() }

  const tile = (label, value, sub, tone) => (
    <div className="glass-panel p-3 min-w-[150px] flex-1">
      <div className="text-[11px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className={'text-lg font-semibold font-mono mt-0.5 ' + (tone || 'text-ink')}>{value}</div>
      {sub && <div className="text-[11px] text-gray-500 mt-0.5">{sub}</div>}
    </div>
  )
  const has = summary && summary.movimenti > 0

  return (
    <div className="max-w-5xl">
      <h1 className="text-lg font-bold text-ink tracking-[-0.35px]">Movimenti bancari</h1>
      <p className="text-gray-500 text-sm mt-0.5 mb-5">Carica l'estratto conto in PDF: vedi cosa succede davvero sul conto e completi le spese che non hai registrato. Il PDF non viene conservato, restano solo i movimenti.</p>

      <section className="glass-panel p-5 mb-5">
        <div className="flex items-center gap-3 flex-wrap">
          <input ref={fileRef} type="file" accept="application/pdf,.pdf" multiple onChange={(e) => upload(e.target.files)} disabled={uploading}
            className="text-sm text-gray-400 file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-accent file:text-white file:text-sm file:font-medium file:cursor-pointer" />
          {uploading && <span className="text-xs text-gray-500">Leggo gli estratti…</span>}
        </div>
        {err && <div className="mt-3 text-sm text-amber-400">{err}</div>}
        {result && (
          <div className="mt-3 text-xs space-y-1">
            {result.results.map((r, i) => (
              <div key={i} className={r.error ? 'text-amber-400' : 'text-gray-300'}>
                {r.error ? '✗ ' + (r.file || '') + ': ' + r.error : '✓ ' + r.account + ' (' + (r.periodo.da || '?') + ' → ' + (r.periodo.a || '?') + '): ' + r.nuovi + ' nuovi, ' + r.duplicati + ' già presenti'}
              </div>
            ))}
            <div className="text-gray-500">Abbinati automaticamente a Finance: {result.abbinati}</div>
          </div>
        )}
      </section>

      <div className="flex items-center gap-1 text-sm text-gray-400 mb-3">
        <button type="button" onClick={() => setMonth(shift(month, -1))} className="px-2 py-1 rounded hover:bg-gray-800" aria-label="Mese precedente"><Icon name="chevron-left" size={14} /></button>
        <span className="min-w-[140px] text-center capitalize text-ink">{monthLabel(month)}</span>
        <button type="button" onClick={() => setMonth(shift(month, 1))} className="px-2 py-1 rounded hover:bg-gray-800" aria-label="Mese successivo"><Icon name="chevron-right" size={14} /></button>
      </div>

      {!has && summary && <div className="text-sm text-gray-500 py-8 text-center glass-panel">Nessun movimento per questo mese. Carica un estratto che lo comprenda.</div>}
      {has && (
        <>
          <div className="flex gap-3 flex-wrap mb-3">
            {tile('Entrate reali', eur(summary.entrate_reali))}
            {tile('Uscite reali', eur(summary.uscite_reali), 'esclusi i giri tra tuoi conti')}
            {tile('Giri tra tuoi conti', eur(summary.giri_interni), 'es. Conto Casa, Prepagata')}
            {tile('Non registrate in Finance', eur(summary.non_registrate), summary.non_registrate_n + ' movimenti', summary.non_registrate > 0 ? 'text-amber-400' : 'text-green-400')}
          </div>
          <div className="flex gap-2 mb-3 flex-wrap">
            {FILTERS.map(([k, label]) => (
              <button key={k} type="button" onClick={() => setFilter(k)} className={'px-3 py-1 rounded-full text-xs border transition ' + (filter === k ? 'bg-accent/15 border-accent text-accent' : 'border-gray-700 text-gray-400 hover:border-gray-500')}>{label}</button>
            ))}
          </div>
          <div className="glass-panel divide-y divide-gray-800">
            {rows === null && <div className="p-4 text-xs text-gray-600">Caricamento…</div>}
            {rows && rows.length === 0 && <div className="p-4 text-sm text-gray-500">{filter === 'da_registrare' ? 'Niente da registrare in questo mese: tutto ciò che è uscito è già in Finance.' : 'Nessun movimento.'}</div>}
            {rows && rows.map((m) => (
              <div key={m.id} className="p-3 flex items-center gap-3 flex-wrap text-sm">
                <div className="w-20 text-xs text-gray-500 font-mono">{m.date.slice(8, 10) + '/' + m.date.slice(5, 7)}</div>
                <div className="min-w-0 flex-1">
                  <div className={'truncate ' + (m.ignored ? 'text-gray-600' : 'text-gray-200')} title={m.description}>{m.merchant || m.description.slice(0, 70)}</div>
                  <div className="text-[11px] text-gray-500 mt-0.5">{KIND[m.kind] || m.kind}{m.match_id ? ' · già in Finance ✓' : ''}{m.ignored ? ' · ignorato' : ''}</div>
                </div>
                <div className={'w-28 text-right font-mono ' + (m.amount >= 0 ? 'text-green-400' : 'text-gray-200')}>{(m.amount >= 0 ? '+' : '−') + eur(m.amount)}</div>
                {filter === 'da_registrare' && !m.ignored && (
                  <div className="flex items-center gap-2">
                    {cats.length > 0 ? (
                      <select value={pick[m.id] || m.category_hint || 'Altro'} onChange={(e) => setPick({ ...pick, [m.id]: e.target.value })} className="bg-surface-page text-ink px-2 py-1 rounded-lg text-xs border border-gray-800">
                        {[...new Set([m.category_hint, ...cats].filter(Boolean))].map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    ) : <span className="text-xs text-gray-500">{m.category_hint || 'Altro'}</span>}
                    <button type="button" onClick={() => register(m)} className="text-xs bg-accent hover:opacity-90 text-white px-2.5 py-1 rounded-lg font-medium">Registra</button>
                    <button type="button" onClick={() => ignore(m)} className="text-xs text-gray-500 hover:text-gray-300">Ignora</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
