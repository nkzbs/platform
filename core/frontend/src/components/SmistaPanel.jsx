import React, { useState, useEffect, useRef } from 'react'
import useApi from '../lib/useApi'
import { parseSchemaFrontend } from '../lib/schema-v3-frontend'
import AiSource from './AiSource'

// Smistare una riga "nuova": un pagamento solo, in rate, o già pagata. Cosa fa ogni scelta lo dice il pannello prima di confermare.
// Stati, campi e piano a rate li dichiara il modulo (Builder → Avvisi); il server fa il lavoro (POST /api/smista/:modulo/:id). Nessuna AI.
const eur = (n) => Number(n || 0).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })
const fmt = (iso) => String(iso || '').split('-').reverse().join('/')
const addMonths = (iso, k) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + k); return d.toISOString().slice(0, 10) }
const today = () => new Date().toISOString().slice(0, 10)

export default function SmistaPanel({ token, q, row, modules, onClose, onDone }) {
  const api = useApi(token)
  const d = row.data
  const mod = (modules || []).find((m) => m.slug === q.module_slug)
  const catField = mod && q.categoria ? (parseSchemaFrontend(mod.schema_json).fields || []).find((f) => f.key === q.categoria) : null
  const catOptions = catField && Array.isArray(catField.options) ? catField.options.map((o) => (typeof o === 'string' ? o : o.value)) : []

  const [modo, setModo] = useState('uno')
  const [importo, setImporto] = useState(d[q.importo] != null && d[q.importo] !== '' ? String(d[q.importo]) : '')
  const [scadenza, setScadenza] = useState(d[q.scadenza] || '')
  const [categoria, setCategoria] = useState(d[q.categoria] || '')
  const [nRate, setNRate] = useState(3)
  const [prima, setPrima] = useState(d[q.scadenza] || d[q.data] || today())
  const [pagataIl, setPagataIl] = useState(today())
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  // Proposta dell'AI (se il modulo ha "Smistare" acceso): precompila i campi che non hai ancora toccato
  const [ai, setAi] = useState(q.ai ? { loading: true } : null)
  const touched = useRef({})
  const touch = (k) => { touched.current[k] = true }
  useEffect(() => {
    if (!q.ai) return
    let vivo = true
    api.post('/smista/' + q.module_slug + '/' + row.id + '/proposta', {}).then((res) => {
      if (!vivo) return
      if (!res.ok) { setAi({ errore: true }); return }
      const p = res.data && res.data.proposta
      if (!p) { setAi({ vuota: true, motivo: res.data && res.data.motivo }); return }
      if (p.importo != null && !touched.current.importo) setImporto(String(p.importo))
      if (p.scadenza && !touched.current.scadenza) { setScadenza(p.scadenza); setPrima((x) => (touched.current.prima ? x : p.scadenza)) }
      if (p.categoria && !touched.current.categoria && (catOptions.length === 0 || catOptions.includes(p.categoria))) setCategoria(p.categoria)
      setAi({ proposta: p, suggestion_id: res.data.suggestion_id, fonte: res.data.fonte || null })
    })
    return () => { vivo = false }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const imp = parseFloat(String(importo).replace(',', '.')) || 0
  const n = Math.max(2, Math.min(60, parseInt(nRate, 10) || 2))
  const rata = imp > 0 ? Math.round((imp / n) * 100) / 100 : 0
  const scelte = [['uno', 'Un pagamento', 'Resta una sola riga, passa a «' + q.da_fare.replace(/_/g, ' ') + '».']]
  if (q.rate) scelte.push(['rate', 'Dividi in rate', 'Crea un piano a rate: le rate sostituiscono questa riga.'])
  if (q.fatto) scelte.push(['pagata', 'Già pagata', 'La riga passa direttamente a «' + q.fatto.replace(/_/g, ' ') + '».'])
  const manca = modo === 'rate' && !(imp > 0)

  const conferma = async () => {
    setBusy(true); setErr('')
    const body = { suggestion_id: ai && ai.suggestion_id, modo, importo: importo === '' ? undefined : imp, scadenza: scadenza || undefined, categoria: categoria || undefined }
    if (modo === 'rate') { body.n_rate = n; body.data_prima_rata = prima }
    if (modo === 'pagata') body.data_pagamento = pagataIl
    const res = await api.post('/smista/' + q.module_slug + '/' + row.id, body)
    setBusy(false)
    if (!res.ok) { setErr((res.data && res.data.error) || 'Non sono riuscito a smistare questa riga.'); return }
    window.dispatchEvent(new CustomEvent('platform:toast', { detail: { message: res.data.message, type: 'success' } }))
    onDone(res.data.message)
  }

  const inp = 'w-full bg-surface-page text-ink px-3 py-2 rounded-lg outline-none border border-gray-800 focus:border-accent text-sm'
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-surface-card rounded-md p-6 w-full max-w-lg border border-gray-800 max-h-[90vh] overflow-y-auto">
        <h2 className="text-base font-bold text-ink">Smista</h2>
        <div className="text-sm text-gray-400 mb-4">{d[q.descrizione] || '(senza descrizione)'} · {q.name}</div>

        {ai && (
          <div className="rounded-lg border border-accent/30 bg-accent/5 p-3 mb-4 text-xs">
            {ai.loading && <span className="text-gray-400">✨ L'AI sta leggendo la bolletta…</span>}
            {ai.errore && <span className="text-gray-500">L'AI non è disponibile in questo momento: compila a mano.</span>}
            {ai.vuota && <span className="text-gray-500">{/niente da leggere/.test(ai.motivo || '') ? 'Questa riga non ha un PDF né un testo da leggere: l\'AI non può proporre niente. Compila a mano (o allega il PDF alla riga).' : 'L\'AI non ha trovato niente di certo in questa riga: compila a mano.'}</span>}
            {ai.proposta && (
              <span className="text-gray-300">
                <span className="text-accent font-medium">✨ L'AI ha letto la bolletta</span>
                {[ai.proposta.categoria, ai.proposta.importo != null ? eur(ai.proposta.importo) : null, ai.proposta.scadenza ? 'scade il ' + fmt(ai.proposta.scadenza) : null, ai.proposta.fornitore].filter(Boolean).join(' · ') ? ': ' + [ai.proposta.categoria, ai.proposta.importo != null ? eur(ai.proposta.importo) : null, ai.proposta.scadenza ? 'scade il ' + fmt(ai.proposta.scadenza) : null, ai.proposta.fornitore].filter(Boolean).join(' · ') : ''}
                {ai.proposta.confidenza ? ' (sicurezza: ' + ai.proposta.confidenza + ')' : ''}. Ho compilato i campi: controlla e conferma.
              </span>
            )}
            {ai.proposta && <AiSource fonte={ai.fonte} proposta={ai.proposta} token={token} />}
          </div>
        )}
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div><label className="text-xs text-gray-400 block mb-1">Importo (€)</label><input className={inp} inputMode="decimal" value={importo} onChange={(e) => { touch('importo'); setImporto(e.target.value) }} placeholder="da verificare" /></div>
          <div><label className="text-xs text-gray-400 block mb-1">Scadenza</label><input type="date" className={inp} value={scadenza} onChange={(e) => { touch('scadenza'); setScadenza(e.target.value) }} /></div>
          <div><label className="text-xs text-gray-400 block mb-1">Categoria</label>
            {catOptions.length > 0
              ? <select className={inp} value={categoria} onChange={(e) => { touch('categoria'); setCategoria(e.target.value) }}><option value="">—</option>{catOptions.map((o) => <option key={o} value={o}>{o}</option>)}</select>
              : <input className={inp} value={categoria} onChange={(e) => setCategoria(e.target.value)} disabled={!q.categoria} />}
          </div>
        </div>

        <div className="space-y-2 mb-4">
          {scelte.map(([k, titolo, desc]) => (
            <label key={k} className={'flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition ' + (modo === k ? 'border-accent bg-accent/5' : 'border-gray-800 hover:border-gray-700')}>
              <input type="radio" name="smista-modo" className="mt-1" checked={modo === k} onChange={() => setModo(k)} />
              <span className="flex-1">
                <span className="block text-sm text-ink font-medium">{titolo}</span>
                <span className="block text-xs text-gray-500">{desc}</span>
                {modo === k && k === 'rate' && (
                  <span className="mt-2 grid grid-cols-2 gap-2 block">
                    <span><span className="text-xs text-gray-400 block mb-1">Numero di rate</span><input type="number" min="2" max="60" className={inp} value={nRate} onChange={(e) => setNRate(e.target.value)} /></span>
                    <span><span className="text-xs text-gray-400 block mb-1">Data della prima rata</span><input type="date" className={inp} value={prima} onChange={(e) => { touch('prima'); setPrima(e.target.value) }} /></span>
                    <span className="col-span-2 text-xs text-ink">{imp > 0 ? n + ' rate da ' + eur(rata) + ', dal ' + fmt(prima) + ' al ' + fmt(addMonths(prima, n - 1)) + (Math.round(rata * n * 100) / 100 !== Math.round(imp * 100) / 100 ? ' (arrotondate: ' + eur(rata * n) + ' in tutto)' : '') : 'Indica l\'importo per calcolare le rate.'}</span>
                  </span>
                )}
                {modo === k && k === 'pagata' && (
                  <span className="mt-2 block"><span className="text-xs text-gray-400 block mb-1">Pagata il</span><input type="date" className={inp + ' max-w-[180px]'} value={pagataIl} onChange={(e) => setPagataIl(e.target.value)} /></span>
                )}
              </span>
            </label>
          ))}
        </div>

        {!(imp > 0) && modo !== 'rate' && <div className="text-xs text-amber-400 mb-3">L'importo è 0 o mancante: controllalo nella bolletta prima di confermare.</div>}
        {err && <div className="text-sm text-red-400 bg-red-900/20 border border-red-900/40 rounded-lg p-3 mb-3">{err}</div>}
        <div className="flex gap-3">
          <button type="button" onClick={onClose} className="flex-1 bg-gray-800 hover:bg-gray-700 text-ink py-2.5 rounded-lg text-sm transition">Annulla</button>
          <button type="button" onClick={conferma} disabled={busy || manca} className="flex-1 bg-accent hover:opacity-90 disabled:opacity-50 text-white py-2.5 rounded-lg text-sm font-medium transition">{busy ? 'Un momento…' : 'Conferma'}</button>
        </div>
      </div>
    </div>
  )
}
