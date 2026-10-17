import React, { useState } from 'react'
import useApi from '../../lib/useApi'
import Icon from '../../components/Icon'

// Cerca da fonte esterna (Builder, Fase 4 — block_type 'api_source'): cerca su
// un'API esterna via lo script search_script della fonte, poi importa il risultato
// scelto via document_script — stesso trattamento di un record creato a mano
// (defaults, unicità, permessi, automazioni, storico), vedi routes/records.js.
function SourceSearchModal({ mod, sources, token, onClose, onImported }) {
  const api = useApi(token)
  const [sourceKey, setSourceKey] = useState(sources[0].key)
  const source = sources.find((s) => s.key === sourceKey) || sources[0]
  const [query, setQuery] = useState('')
  const [type, setType] = useState(source.input_text_enabled ? 'text' : 'barcode')
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState(null)
  const [error, setError] = useState(null)
  const [importingIdx, setImportingIdx] = useState(null)

  const search = async () => {
    if (!query.trim()) return
    setLoading(true); setError(null); setResults(null)
    const { ok, data } = await api.post('/records/' + mod.slug + '/sources/' + source.key + '/search', { query, type })
    setLoading(false)
    if (ok) setResults(data.results || [])
    else setError((data && data.error) || 'Errore nella ricerca')
  }

  const importa = async (r, i) => {
    setImportingIdx(i); setError(null)
    const { ok, data } = await api.post('/records/' + mod.slug + '/sources/' + source.key + '/import', { params: r.params || {} })
    setImportingIdx(null)
    if (ok) onImported(data)
    else setError((data && data.error) || 'Errore nell\'importazione')
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-surface-card rounded-md border border-gray-800 w-full max-w-lg max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-gray-800 flex-shrink-0">
          <div className="flex items-center gap-2 text-ink font-semibold">
            <Icon name="search" size={16} />Cerca da fonte esterna
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-ink transition"><Icon name="x" size={18} /></button>
        </div>
        <div className="p-4 space-y-3 overflow-y-auto">
          {sources.length > 1 && (
            <select className="w-full bg-surface-page text-ink px-3 py-2 rounded-lg text-sm outline-none border border-gray-700"
              value={sourceKey} onChange={(e) => { setSourceKey(e.target.value); setResults(null); setError(null) }}>
              {sources.map((s) => <option key={s.key} value={s.key}>{s.label || s.key}</option>)}
            </select>
          )}
          <div className="flex items-center gap-2">
            <input autoFocus className="flex-1 bg-surface-page text-ink px-3 py-2 rounded-lg text-sm outline-none border border-gray-700 focus:border-accent transition placeholder-gray-600"
              placeholder={type === 'barcode' ? 'Codice a barre...' : 'Cosa cerchi...'} value={query}
              onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} />
            <button onClick={search} disabled={loading || !query.trim()} className="bg-accent hover:opacity-90 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition flex-shrink-0">
              {loading ? 'Cerco…' : 'Cerca'}
            </button>
          </div>
          {source.input_text_enabled && source.input_barcode_enabled && (
            <div className="flex gap-3 text-xs text-gray-500">
              <label className="flex items-center gap-1.5 cursor-pointer"><input type="radio" checked={type === 'text'} onChange={() => setType('text')} />Testo</label>
              <label className="flex items-center gap-1.5 cursor-pointer"><input type="radio" checked={type === 'barcode'} onChange={() => setType('barcode')} />Codice a barre</label>
            </div>
          )}
          {error && <div className="text-sm text-red-400 bg-red-900/10 border border-red-900/40 rounded-lg p-2">{error}</div>}
          {results && results.length === 0 && <div className="text-sm text-gray-600">Nessun risultato.</div>}
          {results && results.length > 0 && (
            <div className="space-y-1.5">
              {results.map((r, i) => (
                <div key={i} className="flex items-center justify-between gap-2 bg-surface-page rounded-lg border border-gray-700 p-2.5">
                  <div className="min-w-0">
                    <div className="text-sm text-ink truncate">{r.title || '(senza titolo)'}</div>
                    {r.subtitle && <div className="text-xs text-gray-500 truncate">{r.subtitle}</div>}
                  </div>
                  <button onClick={() => importa(r, i)} disabled={importingIdx !== null}
                    className="text-xs bg-accent hover:opacity-90 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg transition flex-shrink-0">
                    {importingIdx === i ? 'Importo…' : 'Importa'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default SourceSearchModal
