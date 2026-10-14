import React, { useState, useRef, useEffect } from 'react'
import useApi from '../lib/useApi'
import Icon from './Icon'

// «Carica busta paga» (potenziamento "payslip" del modulo): carichi il PDF della busta paga,
// l'AI legge periodo/lordo/netto/ore pagate/trattenute e li confronta con le ore già timbrate
// in quel mese (modulo di tipo presenze, se c'è). L'AI propone, non scrive: confermi tu.
const MAX = 3 * 1024 * 1024
const toBase64 = (file) => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(',')[1] || ''); r.onerror = reject; r.readAsDataURL(file) })
const toMin = (hhmm) => { if (!hhmm) return null; const [h, m] = String(hhmm).slice(0, 5).split(':').map(Number); return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null }
const durata = (min) => { if (min == null) return '—'; const h = Math.floor(min / 60), m = Math.round(min % 60); return (h ? h + 'h ' : '') + (m || !h ? m + 'm' : '') }

export default function ImportPayslip({ token, mod, user, onCreated }) {
  const api = useApi(token)
  const [enabled, setEnabled] = useState(false)
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState(null)
  const [b64, setB64] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [f, setF] = useState(null) // campi proposti, modificabili
  const [oreTimbrate, setOreTimbrate] = useState(undefined) // undefined = non calcolate, null = nessun modulo presenze
  const input = useRef(null)

  useEffect(() => { api.get('/module-ai/' + mod.slug + '/enabled').then((d) => setEnabled(!!(d && Array.isArray(d.features) && d.features.includes('payslip')))) }, [mod.slug]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!enabled) return null

  const reset = () => { setOpen(false); setFile(null); setB64(''); setF(null); setErr(''); setBusy(false); setOreTimbrate(undefined); if (input.current) input.current.value = '' }

  const confrontaOre = async (periodo) => {
    if (!periodo) { setOreTimbrate(null); return }
    const list = await api.get('/module-roles/presenze')
    const p = Array.isArray(list) && list.length ? list[0] : null
    if (!p) { setOreTimbrate(null); return }
    const recs = await api.get('/records/' + p.module_slug)
    const mese = String(periodo).slice(0, 7)
    const mie = (Array.isArray(recs) ? recs : []).filter((r) => r.user_id === user.id && r.data && r.data[p.data] && String(r.data[p.data]).slice(0, 7) === mese)
    let min = 0
    for (const r of mie) { const a = toMin(r.data[p.inizio]), b = toMin(r.data[p.fine]); if (a != null && b != null) min += Math.max(0, b - a) }
    setOreTimbrate(min)
  }

  const scegli = async (e) => {
    const file0 = e.target.files && e.target.files[0]
    if (!file0) return
    setErr(''); setF(null); setOreTimbrate(undefined)
    if (file0.size > MAX) { setErr('Il PDF è troppo grande (massimo 3 MB).'); return }
    setFile(file0); setBusy(true)
    const base64 = await toBase64(file0); setB64(base64)
    const r = await api.post('/ai/payslip/' + mod.slug + '/proposta', { filename: file0.name, base64 })
    setBusy(false)
    if (!r.ok) { setErr((r.data && r.data.error) || 'L\'AI non è disponibile in questo momento.'); return }
    const p = r.data.proposta || {}
    setF({ periodo: p.periodo ? String(p.periodo).slice(0, 7) : '', lordo: p.lordo != null ? String(p.lordo) : '', netto: p.netto != null ? String(p.netto) : '', ore_pagate: p.ore_pagate != null ? String(p.ore_pagate) : '', trattenute: p.trattenute != null ? String(p.trattenute) : '', confidenza: p.confidenza || '' })
    confrontaOre(p.periodo)
  }
  const crea = async () => {
    setBusy(true); setErr('')
    const netto = parseFloat(String(f.netto).replace(',', '.'))
    const ore = parseFloat(String(f.ore_pagate).replace(',', '.'))
    const lordo = f.lordo ? parseFloat(String(f.lordo).replace(',', '.')) : undefined
    const trattenute = f.trattenute ? parseFloat(String(f.trattenute).replace(',', '.')) : undefined
    const r = await api.post('/ai/payslip/' + mod.slug + '/crea', { filename: file.name, base64: b64, campi: { data: f.periodo + '-01', netto, ore_pagate: ore, lordo, trattenute } })
    setBusy(false)
    if (!r.ok) { setErr((r.data && r.data.error) || 'Non sono riuscito a registrare la busta paga.'); return }
    window.dispatchEvent(new CustomEvent('platform:toast', { detail: { message: r.data.message, type: 'success' } }))
    reset(); if (onCreated) onCreated()
  }
  const inp = 'w-full bg-surface-page text-ink px-3 py-2 rounded-lg outline-none border border-gray-800 focus:border-accent text-sm'
  const oreDecimali = f && f.ore_pagate ? parseFloat(String(f.ore_pagate).replace(',', '.')) : null
  const delta = f && oreTimbrate != null && Number.isFinite(oreDecimali) ? Math.round(oreTimbrate - oreDecimali * 60) : null

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="bg-gray-800 hover:bg-gray-700 text-accent px-3 py-2 rounded-lg text-sm font-medium transition flex items-center gap-1.5"><Icon name="wand" size={14} />Carica busta paga</button>
      {open && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-surface-card rounded-md p-6 w-full max-w-lg border border-gray-800 max-h-[90vh] overflow-y-auto">
            <h2 className="text-base font-bold text-ink">Carica busta paga</h2>
            <div className="text-sm text-gray-400 mb-4">Carica il PDF della busta paga: l'AI legge periodo, lordo, netto e ore pagate e le confronta con le timbrature di quel mese. Controlli e confermi.</div>
            <input ref={input} type="file" accept="application/pdf" onChange={scegli} className="block w-full text-sm text-gray-400 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-gray-800 file:text-ink hover:file:bg-gray-700 mb-4" />
            {busy && !f && <div className="text-xs text-gray-400 mb-3">✨ L'AI sta leggendo il PDF…</div>}
            {f && (
              <div className="space-y-3 mb-4">
                <div className="text-xs text-gray-400"><span className="text-accent font-medium">✨ L'AI ha letto il PDF</span>{f.confidenza ? ' (sicurezza: ' + f.confidenza + ')' : ''}. Controlla i campi.</div>
                <div><label className="text-xs text-gray-400 block mb-1">Periodo (mese)</label><input type="month" className={inp} value={f.periodo} onChange={(e) => { setF({ ...f, periodo: e.target.value }); confrontaOre(e.target.value) }} /></div>
                <div className="grid grid-cols-3 gap-3">
                  <div><label className="text-xs text-gray-400 block mb-1">Lordo (€)</label><input className={inp} inputMode="decimal" value={f.lordo} onChange={(e) => setF({ ...f, lordo: e.target.value })} /></div>
                  <div><label className="text-xs text-gray-400 block mb-1">Netto (€)</label><input className={inp} inputMode="decimal" value={f.netto} onChange={(e) => setF({ ...f, netto: e.target.value })} /></div>
                  <div><label className="text-xs text-gray-400 block mb-1">Trattenute (€)</label><input className={inp} inputMode="decimal" value={f.trattenute} onChange={(e) => setF({ ...f, trattenute: e.target.value })} /></div>
                </div>
                <div><label className="text-xs text-gray-400 block mb-1">Ore pagate</label><input className={inp} inputMode="decimal" value={f.ore_pagate} onChange={(e) => setF({ ...f, ore_pagate: e.target.value })} /></div>
                {oreTimbrate !== undefined && (
                  <div className={'text-xs rounded-lg p-2.5 border ' + (delta != null && Math.abs(delta) >= 30 ? 'bg-amber-900/20 border-amber-900/40 text-amber-300' : 'bg-gray-900 border-gray-800 text-gray-400')}>
                    {oreTimbrate == null ? 'Nessun modulo di timbrature dichiarato: non posso confrontare le ore.' : (
                      <>Timbrate quel mese: <span className="text-ink font-medium">{durata(oreTimbrate)}</span>{delta != null && <> — differenza dalle ore pagate: <span className="text-ink font-medium">{durata(Math.abs(delta))}</span> {delta > 0 ? 'in più timbrate' : delta < 0 ? 'in meno timbrate' : '(coincidono)'}</>}</>
                    )}
                  </div>
                )}
              </div>
            )}
            {err && <div className="text-sm text-red-400 bg-red-900/20 border border-red-900/40 rounded-lg p-3 mb-3">{err}</div>}
            <div className="flex gap-3">
              <button type="button" onClick={reset} className="flex-1 bg-gray-800 hover:bg-gray-700 text-ink py-2.5 rounded-lg text-sm transition">Annulla</button>
              <button type="button" onClick={crea} disabled={busy || !f || !f.periodo || !f.netto || !f.ore_pagate} className="flex-1 bg-accent hover:opacity-90 disabled:opacity-50 text-white py-2.5 rounded-lg text-sm font-medium transition">{busy && f ? 'Un momento…' : 'Registra'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
