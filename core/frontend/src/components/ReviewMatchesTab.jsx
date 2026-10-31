import React, { useState, useEffect } from 'react'
import useApi from '../lib/useApi'
import Icon from './Icon'

// Revisione a mano delle proposte di collegamento lette con l'AI (30/10/2026,
// dopo che l'abbinamento automatico per solo importo si è rivelato troppo
// ambiguo su dati reali — vedi NOTE-DI-RILASCIO). Una proposta alla volta:
// chi guarda sceglie la spesa giusta tra le candidate (o nessuna), mai
// un collegamento scritto senza conferma esplicita.
export default function ReviewMatchesTab({ token }) {
  const api = useApi(token)
  const [items, setItems] = useState(null)
  const [busy, setBusy] = useState(null)

  const load = () => api.get('/receipt-match/pending').then((d) => Array.isArray(d) && setItems(d))
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const confirm = async (id, target_slug, target_id) => {
    setBusy(id)
    const r = await api.post('/receipt-match/' + id + '/confirm', { target_slug, target_id })
    setBusy(null)
    if (r.ok) { setItems((p) => p.filter((x) => x.id !== id)); window.dispatchEvent(new CustomEvent('platform:toast', { detail: { message: 'Collegato', type: 'success' } })) }
    else window.dispatchEvent(new CustomEvent('platform:toast', { detail: { message: 'Salvataggio fallito', type: 'error' } }))
  }
  const skip = async (id) => {
    setBusy(id)
    const r = await api.post('/receipt-match/' + id + '/skip', {})
    setBusy(null)
    if (r.ok) setItems((p) => p.filter((x) => x.id !== id))
  }

  if (!items) return <p className="text-sm text-gray-500">Carico…</p>

  return (
    <div className="max-w-3xl space-y-4">
      <p className="text-sm text-gray-500">Proposte di collegamento tra un documento (ricevuta/bolletta) e la spesa a cui potrebbe appartenere, lette con l'AI. Niente viene collegato senza una conferma qui. {items.length} da rivedere.</p>

      {items.length === 0 && <div className="text-sm text-gray-600 glass-panel p-6 text-center">Nessuna proposta in sospeso.</div>}

      {items.map((it) => (
        <div key={it.id} className="glass-panel p-4">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="min-w-0">
              <div className="text-sm font-medium text-ink truncate">{it.titolo || ('Documento #' + it.source_id)}</div>
              <div className="text-xs text-gray-500 mt-0.5">
                {it.proposta.error ? ('Non letto: ' + it.proposta.error) :
                  'Importo letto: ' + (it.proposta.importo != null ? it.proposta.importo + ' €' : '—') +
                  (it.proposta.fornitore ? ' · ' + it.proposta.fornitore : '') +
                  (it.proposta.scadenza ? ' · scadenza ' + it.proposta.scadenza : '') +
                  ' · confidenza ' + (it.proposta.confidenza || '—')}
              </div>
            </div>
            <button onClick={() => skip(it.id)} disabled={busy === it.id} className="flex-shrink-0 text-xs text-gray-500 hover:text-gray-300 px-2.5 py-1.5 rounded-lg hover:bg-white/5 transition">Salta</button>
          </div>

          {it.candidati.length === 0 ? (
            <div className="text-xs text-gray-600">Nessuna spesa con questo importo.</div>
          ) : (
            <div className="space-y-1.5">
              {it.candidati.map((c) => (
                <button key={c.slug + '-' + c.id} onClick={() => confirm(it.id, c.slug, c.id)} disabled={busy === it.id}
                  className="w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-gray-800 hover:border-accent hover:bg-accent/5 transition text-left disabled:opacity-50">
                  <span className="text-xs text-gray-300 truncate">{c.descrizione || '(senza descrizione)'} <span className="text-gray-600">· {c.slug === 'spese_casa' ? 'Spese Casa' : 'Spese Personali'}</span></span>
                  <span className="text-xs text-gray-500 flex-shrink-0 flex items-center gap-2">{c.importo} € · {c.data}<Icon name="link" size={12} /></span>
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
