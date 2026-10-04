import React, { useState, useEffect, useRef } from 'react'
import useApi from '../lib/useApi'
import Icon from './Icon'

// «Importa da PDF» (potenziamento "Importare" del modulo): carichi una bolletta o una fattura, l'AI legge il PDF e propone i campi; controlli e confermi.
// La riga nasce nello stato «nuovo» con il PDF allegato e passa dalla coda «Da smistare». L'AI propone, non scrive: sei tu a confermare.
const MAX = 3 * 1024 * 1024
const eur = (n) => Number(n || 0).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })
const toBase64 = (file) => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(',')[1] || ''); r.onerror = reject; r.readAsDataURL(file) })

export default function ImportPdf({ token, mod, onCreated }) {
  const api = useApi(token)
  const [enabled, setEnabled] = useState(false)
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState(null)
  const [b64, setB64] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [f, setF] = useState(null) // campi proposti, modificabili
  const [opts, setOpts] = useState([]) // categorie ammesse dal modulo (le dà il server, dai ruoli del modulo)
  const input = useRef(null)

  useEffect(() => { api.get('/module-ai/' + mod.slug + '/enabled').then((d) => setEnabled(!!(d && Array.isArray(d.features) && d.features.includes('import')))) }, [mod.slug]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!enabled) return null

  const reset = () => { setOpen(false); setFile(null); setB64(''); setF(null); setErr(''); setBusy(false); if (input.current) input.current.value = '' }

  const scegli = async (e) => {
    const file0 = e.target.files && e.target.files[0]
    if (!file0) return
    setErr(''); setF(null)
    if (file0.size > MAX) { setErr('Il PDF è troppo grande (massimo 3 MB).'); return }
    setFile(file0); setBusy(true)
    const base64 = await toBase64(file0); setB64(base64)
    const r = await api.post('/ai/import/' + mod.slug + '/proposta', { filename: file0.name, base64 })
    setBusy(false)
    if (!r.ok) { setErr((r.data && r.data.error) || 'L\'AI non è disponibile in questo momento.'); return }
    const p = r.data.proposta || {}
    setOpts(Array.isArray(r.data.categorie) ? r.data.categorie : [])
    setF({ descrizione: p.fornitore || file0.name.replace(/\.pdf$/i, ''), importo: p.importo != null ? String(p.importo) : '', scadenza: p.scadenza || '', categoria: p.categoria || '', confidenza: p.confidenza || '' })
  }
  const crea = async () => {
    setBusy(true); setErr('')
    const imp = parseFloat(String(f.importo).replace(',', '.'))
    const r = await api.post('/ai/import/' + mod.slug + '/crea', { filename: file.name, base64: b64, campi: { descrizione: f.descrizione, importo: Number.isFinite(imp) ? imp : 0, scadenza: f.scadenza || undefined, categoria: f.categoria || undefined } })
    setBusy(false)
    if (!r.ok) { setErr((r.data && r.data.error) || 'Non sono riuscito a creare la riga.'); return }
    window.dispatchEvent(new CustomEvent('platform:toast', { detail: { message: r.data.message, type: 'success' } }))
    reset(); if (onCreated) onCreated()
  }
  const inp = 'w-full bg-surface-page text-ink px-3 py-2 rounded-lg outline-none border border-gray-800 focus:border-accent text-sm'

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="bg-gray-800 hover:bg-gray-700 text-accent px-3 py-2 rounded-lg text-sm font-medium transition flex items-center gap-1.5"><Icon name="wand" size={14} />Importa da PDF</button>
      {open && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-surface-card rounded-md p-6 w-full max-w-lg border border-gray-800 max-h-[90vh] overflow-y-auto">
            <h2 className="text-base font-bold text-ink">Importa da PDF</h2>
            <div className="text-sm text-gray-400 mb-4">Carica una bolletta o una fattura: l'AI legge il PDF e propone la riga di «{mod.name}». Controlli e confermi.</div>
            <input ref={input} type="file" accept="application/pdf" onChange={scegli} className="block w-full text-sm text-gray-400 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-gray-800 file:text-ink hover:file:bg-gray-700 mb-4" />
            {busy && !f && <div className="text-xs text-gray-400 mb-3">✨ L'AI sta leggendo il PDF…</div>}
            {f && (
              <div className="space-y-3 mb-4">
                <div className="text-xs text-gray-400"><span className="text-accent font-medium">✨ L'AI ha letto il PDF</span>{f.confidenza ? ' (sicurezza: ' + f.confidenza + ')' : ''}. Controlla i campi{f.importo ? ': ' + eur(parseFloat(f.importo)) : ''}.</div>
                <div><label className="text-xs text-gray-400 block mb-1">Descrizione</label><input className={inp} value={f.descrizione} onChange={(e) => setF({ ...f, descrizione: e.target.value })} /></div>
                <div className="grid grid-cols-3 gap-3">
                  <div><label className="text-xs text-gray-400 block mb-1">Importo (€)</label><input className={inp} inputMode="decimal" value={f.importo} onChange={(e) => setF({ ...f, importo: e.target.value })} /></div>
                  <div><label className="text-xs text-gray-400 block mb-1">Scadenza</label><input type="date" className={inp} value={f.scadenza} onChange={(e) => setF({ ...f, scadenza: e.target.value })} /></div>
                  <div><label className="text-xs text-gray-400 block mb-1">Categoria</label>
                    {opts.length ? <select className={inp} value={f.categoria} onChange={(e) => setF({ ...f, categoria: e.target.value })}><option value="">—</option>{opts.map((o) => <option key={o} value={o}>{o}</option>)}</select> : <input className={inp} value={f.categoria} onChange={(e) => setF({ ...f, categoria: e.target.value })} />}
                  </div>
                </div>
              </div>
            )}
            {err && <div className="text-sm text-red-400 bg-red-900/20 border border-red-900/40 rounded-lg p-3 mb-3">{err}</div>}
            <div className="flex gap-3">
              <button type="button" onClick={reset} className="flex-1 bg-gray-800 hover:bg-gray-700 text-ink py-2.5 rounded-lg text-sm transition">Annulla</button>
              <button type="button" onClick={crea} disabled={busy || !f} className="flex-1 bg-accent hover:opacity-90 disabled:opacity-50 text-white py-2.5 rounded-lg text-sm font-medium transition">{busy && f ? 'Un momento…' : 'Crea la riga'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
