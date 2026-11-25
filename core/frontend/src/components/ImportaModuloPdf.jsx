import React, { useState, useEffect, useRef } from 'react'
import useApi from '../lib/useApi'
import Icon from './Icon'
import VoceMenu from './VoceMenu'
import Portal from './Portal'

// «Importa da modulo PDF»: carichi il modulo originale dell'agenzia compilato (cliente o immobile) e il sistema propone i dati per una scheda nuova.
// Non indovina: ciò che non sta nella scheda o ha più scelte possibili resta in un elenco a parte, da sistemare a mano. Controlli e confermi.
// La voce compare solo nei moduli che hanno moduli PDF originali (lo dice il server).
const MAX = 4 * 1024 * 1024
const toBase64 = (file) => new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(',')[1] || ''); r.onerror = reject; r.readAsDataURL(file) })
const mostra = (v) => (v === true ? 'Sì' : Array.isArray(v) ? v.join(', ') : /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v).split('-').reverse().join('/') : String(v))

// `aperto`/`onChiudi`: la finestra si può aprire da fuori (la scelta «da PDF» della creazione guidata); `senzaVoce` nasconde la voce del menu.
export default function ImportaModuloPdf({ token, mod, onCreated, aperto, onChiudi, senzaVoce }) {
  const api = useApi(token)
  const [disponibile, setDisponibile] = useState(false)
  const [apertoDa, setOpen] = useState(false)
  const open = apertoDa || !!aperto
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [p, setP] = useState(null) // la proposta del server
  const [esclusi, setEsclusi] = useState({}) // campi che l'agente non vuole importare
  const input = useRef(null)

  useEffect(() => { api.get('/records/' + mod.slug + '/importa-modulo').then((d) => setDisponibile(!!(d && Array.isArray(d.modelli) && d.modelli.length))) }, [mod.slug]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!disponibile) return null

  const reset = () => { setOpen(false); if (onChiudi) onChiudi(); setP(null); setErr(''); setBusy(false); setEsclusi({}); if (input.current) input.current.value = '' }

  const scegli = async (e) => {
    const file = e.target.files && e.target.files[0]
    if (!file) return
    setErr(''); setP(null); setEsclusi({})
    if (file.size > MAX) { setErr('Il PDF è troppo grande (massimo 4 MB).'); return }
    setBusy(true)
    const r = await api.post('/records/' + mod.slug + '/importa-modulo/proposta', { pdf_base64: await toBase64(file) })
    setBusy(false)
    if (!r.ok) { setErr((r.data && r.data.error) || 'Non riesco a leggere il PDF.'); return }
    setP(r.data)
  }

  const crea = async () => {
    setBusy(true); setErr('')
    const dati = {}
    for (const c of p.campi) if (!esclusi[c.key]) dati[c.key] = c.valore
    const r = await api.post('/records/' + mod.slug, dati)
    setBusy(false)
    if (!r.ok) { setErr((r.data && r.data.error) || 'Non sono riuscito a creare la scheda.'); return }
    window.dispatchEvent(new CustomEvent('platform:toast', { detail: { message: 'Scheda creata dal modulo PDF', type: 'success' } }))
    reset(); if (onCreated) onCreated(r.data)
  }

  const importati = p ? p.campi.filter((c) => !esclusi[c.key]).length : 0
  return (
    <>
      {!senzaVoce && <VoceMenu icon="file" label="Importa da modulo PDF" desc="Carica il modulo dell'agenzia compilato: i dati diventano una scheda nuova" onClick={() => setOpen(true)} />}
      {open && (
        <Portal>
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
            <div className="bg-surface-card rounded-md p-6 w-full max-w-lg border border-gray-800 max-h-[90vh] overflow-y-auto">
              <h2 className="text-base font-bold text-ink">Importa da modulo PDF</h2>
              <div className="text-sm text-gray-400 mb-4">Carica il modulo originale compilato: il sistema lo riconosce e propone i dati della nuova scheda «{mod.name}». Controlli e confermi.</div>
              <input ref={input} type="file" accept="application/pdf" onChange={scegli} className="block w-full text-sm text-gray-400 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-gray-800 file:text-ink hover:file:bg-gray-700 mb-3" />
              {busy && !p && <div className="text-xs text-gray-400 mb-3">Sto leggendo il modulo…</div>}
              {p && (
                <div className="space-y-3 mb-4">
                  <div className="text-xs text-gray-400"><span className="text-accent font-medium">{p.modello.titolo}</span> · {p.campi.length ? importati + ' dati da inserire' : 'nessun dato compilato trovato'}</div>
                  {p.campi.length > 0 && (
                    <ul className="divide-y divide-gray-800 border border-gray-800 rounded-lg">
                      {p.campi.map((c) => (
                        <li key={c.key} className="flex items-start gap-3 px-3 py-2 text-sm">
                          <input type="checkbox" className="mt-1" checked={!esclusi[c.key]} onChange={(e) => setEsclusi({ ...esclusi, [c.key]: !e.target.checked })} aria-label={'Importa ' + c.label} />
                          <div className="min-w-0 flex-1"><div className="text-xs text-gray-500">{c.label}</div><div className="text-ink break-words">{mostra(c.valore)}</div></div>
                        </li>
                      ))}
                    </ul>
                  )}
                  {p.non_collegati.length > 0 && (
                    <div className="text-xs text-gray-400 bg-gray-800/50 rounded-lg p-3">
                      <div className="font-medium text-ink mb-1">Da sistemare a mano ({p.non_collegati.length})</div>
                      <ul className="space-y-1">{p.non_collegati.map((n, i) => <li key={i}><span className="text-ink">{n.voce}</span>: {n.valore} <span className="text-gray-500">— {n.motivo}</span></li>)}</ul>
                    </div>
                  )}
                </div>
              )}
              {err && <div className="text-sm text-red-400 bg-red-900/20 border border-red-900/40 rounded-lg p-3 mb-3">{err}</div>}
              <div className="flex gap-3">
                <button type="button" onClick={reset} className="flex-1 bg-gray-800 hover:bg-gray-700 text-ink py-2.5 rounded-lg text-sm transition">Annulla</button>
                <button type="button" onClick={crea} disabled={busy || !p || !importati} className="flex-1 bg-accent hover:opacity-90 disabled:opacity-50 text-white py-2.5 rounded-lg text-sm font-medium transition flex items-center justify-center gap-1.5"><Icon name="plus" size={14} />{busy && p ? 'Un momento…' : 'Crea la scheda'}</button>
              </div>
            </div>
          </div>
        </Portal>
      )}
    </>
  )
}
