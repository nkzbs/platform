import React, { useState } from 'react'
import { API } from '../lib/api'
import Icon from './Icon'

// Registra un tenant che esiste già (container e dati creati altrove o da un
// Super Admin precedente): non ricrea nulla, riusa le sue chiavi originali, così i
// campi cifrati del suo database restano leggibili. Il tenant nasce "fermo" e si
// avvia dalla sua card con Avvia.
//
// Due strade: importare dal vecchio super-admin.db (consigliata: le chiavi si
// copiano da sole, lato server, senza digitarle) oppure inserire i dati a mano.

const inputCls = 'w-full bg-surface-page text-ink px-4 py-3 rounded-lg outline-none border border-gray-800 focus:border-cp-primary transition placeholder-gray-600'

export default function RegisterExistingModal({ token, onClose, onDone }) {
  const [step, setStep] = useState('file') // 'file' | 'pick' | 'manual' | 'done'
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [importId, setImportId] = useState(null)
  const [found, setFound] = useState([])
  const [selected, setSelected] = useState({})
  const [results, setResults] = useState([])
  const [manual, setManual] = useState({ name: '', slug: '', port: '', db_path: '', domain: '', encryption_key: '' })

  const auth = { Authorization: 'Bearer ' + token }
  const jsonHeaders = { ...auth, 'Content-Type': 'application/json' }

  const blockedReason = (t) => {
    if (t.already_registered) return 'già registrato'
    if (t.port_in_use) return 'porta ' + t.port + ' già usata'
    if (!t.has_encryption_key) return 'nel file manca la chiave: usa l\'inserimento manuale'
    return null
  }

  const uploadFile = async (file) => {
    if (!file) return
    setBusy(true)
    setError('')
    const form = new FormData()
    form.append('file', file)
    try {
      const res = await fetch(API + '/tenants/import/preview', { method: 'POST', headers: auth, body: form })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'File non valido'); return }
      setImportId(data.import_id)
      setFound(data.tenants)
      const preselected = {}
      data.tenants.forEach((t) => { if (!blockedReason(t)) preselected[t.slug] = true })
      setSelected(preselected)
      setStep('pick')
    } catch (e) {
      setError('Caricamento fallito: ' + e.message)
    } finally {
      setBusy(false)
    }
  }

  const importSelected = async () => {
    const slugs = Object.keys(selected).filter((s) => selected[s])
    if (slugs.length === 0) { setError('Seleziona almeno un tenant'); return }
    setBusy(true)
    setError('')
    try {
      const res = await fetch(API + '/tenants/import', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ import_id: importId, slugs }) })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Importazione fallita'); return }
      setResults(data.results)
      setStep('done')
      onDone()
    } catch (e) {
      setError('Importazione fallita: ' + e.message)
    } finally {
      setBusy(false)
    }
  }

  const registerManual = async () => {
    setBusy(true)
    setError('')
    try {
      const res = await fetch(API + '/tenants/register', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(manual) })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Registrazione fallita'); return }
      setResults([{ slug: data.slug, ok: true }])
      setStep('done')
      onDone()
    } catch (e) {
      setError('Registrazione fallita: ' + e.message)
    } finally {
      setBusy(false)
    }
  }

  const setField = (k) => (e) => setManual({ ...manual, [k]: e.target.value })

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-surface-card rounded-md p-6 w-full max-w-md border border-gray-800 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-ink mb-1">Registra tenant esistente</h2>
        <p className="text-sm text-gray-500 mb-5">
          Non crea né modifica nulla nei suoi dati: lo aggiunge a questo elenco, fermo, con le sue chiavi originali.
        </p>
        {error && <div className="bg-red-900/30 text-red-400 text-sm p-3 rounded-lg mb-4 border border-red-900/50">{error}</div>}

        {step === 'file' && (
          <div className="space-y-4">
            <label className="block border border-dashed border-gray-700 hover:border-cp-primary rounded-lg p-6 text-center cursor-pointer transition">
              <Icon name="download" size={20} />
              <div className="text-sm text-ink mt-2">{busy ? 'Leggo il file...' : 'Scegli il vecchio super-admin.db'}</div>
              <div className="text-xs text-gray-500 mt-1">Le chiavi dei tenant vengono copiate da sole, senza digitarle.</div>
              <input type="file" className="hidden" disabled={busy} onChange={(e) => uploadFile(e.target.files && e.target.files[0])} />
            </label>
            <button onClick={() => { setError(''); setStep('manual') }} className="w-full text-xs text-gray-400 hover:text-ink transition">
              Non ho il file: inserisco i dati a mano
            </button>
          </div>
        )}

        {step === 'pick' && (
          <div>
            <div className="space-y-2 mb-5">
              {found.length === 0 && <div className="text-sm text-gray-500">Nessun tenant trovato nel file.</div>}
              {found.map((t) => {
                const blocked = blockedReason(t)
                return (
                  <label key={t.slug} className={'flex items-start gap-3 p-3 rounded-lg border ' + (blocked ? 'border-gray-800 opacity-60' : 'border-gray-700 cursor-pointer hover:border-cp-primary')}>
                    <input type="checkbox" className="mt-1" disabled={!!blocked} checked={!!selected[t.slug]}
                      onChange={(e) => setSelected({ ...selected, [t.slug]: e.target.checked })} />
                    <div className="min-w-0">
                      <div className="text-sm text-ink">{t.name} <span className="text-xs text-gray-500 font-mono">{t.slug}</span></div>
                      <div className="text-xs text-gray-500 font-mono">:{t.port} &middot; {t.db_path}{t.domain ? ' · ' + t.domain : ''}</div>
                      {blocked && <div className="text-xs text-amber-400 mt-0.5">{blocked}</div>}
                    </div>
                  </label>
                )
              })}
            </div>
            <div className="flex gap-3">
              <button onClick={onClose} className="flex-1 bg-gray-800 hover:bg-gray-700 text-white py-3 rounded-lg transition">Annulla</button>
              <button onClick={importSelected} disabled={busy} className="flex-1 bg-cp-primary hover:bg-cp-primary-hover disabled:opacity-50 text-white py-3 rounded-lg transition">
                {busy ? 'Registro...' : 'Registra'}
              </button>
            </div>
          </div>
        )}

        {step === 'manual' && (
          <div>
            <div className="space-y-3 mb-6">
              <div><label className="text-xs text-gray-400 mb-1 block">Nome</label>
                <input className={inputCls} placeholder="es. Finance" value={manual.name} onChange={setField('name')} /></div>
              <div><label className="text-xs text-gray-400 mb-1 block">Slug</label>
                <input className={inputCls + ' font-mono'} placeholder="es. finance" value={manual.slug}
                  onChange={(e) => setManual({ ...manual, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })} /></div>
              <div className="flex gap-3">
                <div className="w-28"><label className="text-xs text-gray-400 mb-1 block">Porta</label>
                  <input className={inputCls + ' font-mono'} inputMode="numeric" placeholder="41001" value={manual.port} onChange={setField('port')} /></div>
                <div className="flex-1"><label className="text-xs text-gray-400 mb-1 block">Percorso del database</label>
                  <input className={inputCls + ' font-mono'} placeholder={'/data/' + (manual.slug || 'slug') + '.db'} value={manual.db_path} onChange={setField('db_path')} /></div>
              </div>
              <div><label className="text-xs text-gray-400 mb-1 block">Dominio (facoltativo)</label>
                <input className={inputCls + ' font-mono'} placeholder="finance.esempio.it" value={manual.domain} onChange={setField('domain')} /></div>
              <div><label className="text-xs text-gray-400 mb-1 block">Chiave di cifratura esistente</label>
                <input className={inputCls + ' font-mono'} type="password" autoComplete="off" value={manual.encryption_key} onChange={setField('encryption_key')} />
                <div className="text-xs text-gray-500 mt-1">Quella del tenant originale. Senza, i campi cifrati non si leggono più.</div></div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => { setError(''); setStep('file') }} className="flex-1 bg-gray-800 hover:bg-gray-700 text-white py-3 rounded-lg transition">Indietro</button>
              <button onClick={registerManual} disabled={busy} className="flex-1 bg-cp-primary hover:bg-cp-primary-hover disabled:opacity-50 text-white py-3 rounded-lg transition">
                {busy ? 'Registro...' : 'Registra'}
              </button>
            </div>
          </div>
        )}

        {step === 'done' && (
          <div>
            <div className="space-y-1.5 mb-5">
              {results.map((r) => (
                <div key={r.slug} className={'text-sm ' + (r.ok ? 'text-emerald-400' : 'text-amber-400')}>
                  {r.ok ? '✓ ' : '✗ '}<span className="font-mono">{r.slug}</span>{r.ok ? ' registrato' : ' — ' + r.error}
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-500 mb-5">I tenant registrati sono fermi: apri la loro card e premi <span className="text-gray-300">Avvia</span>. Il container viene ricreato sullo stesso volume dati.</p>
            <button onClick={onClose} className="w-full bg-cp-primary hover:bg-cp-primary-hover text-white py-3 rounded-lg transition">Chiudi</button>
          </div>
        )}
      </div>
    </div>
  )
}
