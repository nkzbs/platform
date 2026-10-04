import React, { useState, useEffect } from 'react'
import useApi from '../lib/useApi'

// Ultimi invii WhatsApp: quando, di che tipo, e se sono davvero partiti (esito vero per destinatario).
const KIND = { riepilogo: 'Riepilogo del mattino', monitoraggio: 'Come sta andando', avviso: 'Riga nuova', prova: 'Prova', automazione: 'Automazione', altro: 'Altro' }
const when = (iso) => new Date(String(iso).replace(' ', 'T') + 'Z').toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

export default function WhatsAppLogPanel({ token, refreshKey }) {
  const api = useApi(token)
  const [rows, setRows] = useState(null)
  const [open, setOpen] = useState(null)
  useEffect(() => { api.get('/connections/whatsapp_callmebot/log?limit=20').then((d) => setRows(Array.isArray(d) ? d : [])) }, [refreshKey]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className="mt-4 pt-4 border-t border-gray-800">
      <h2 className="text-sm font-semibold text-ink">Ultimi invii</h2>
      <p className="text-xs text-gray-500 mt-0.5">Ogni messaggio con l'esito vero: se non è arrivato, qui c'è il motivo.</p>
      <div className="mt-3 divide-y divide-gray-800">
        {rows === null && <div className="text-xs text-gray-600 py-2">Caricamento…</div>}
        {rows && rows.length === 0 && <div className="text-xs text-gray-500 py-2">Nessun messaggio inviato finora.</div>}
        {rows && rows.map((r) => (
          <div key={r.id} className="py-2">
            <button type="button" onClick={() => setOpen(open === r.id ? null : r.id)} className="w-full flex items-center gap-2 text-left">
              <span className={'text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 ' + (r.esito === 'inviato' ? 'bg-green-900/30 text-green-400' : r.esito === 'parziale' ? 'bg-amber-900/30 text-amber-400' : 'bg-red-900/30 text-red-400')}>{r.esito}</span>
              <span className="text-xs text-ink flex-shrink-0">{KIND[r.kind] || r.kind}</span>
              <span className="text-xs text-gray-500 truncate">{r.testo.replace(/\s+/g, ' ')}</span>
              <span className="text-[11px] text-gray-600 ml-auto flex-shrink-0">{when(r.created_at)}</span>
            </button>
            {open === r.id && (
              <div className="mt-2 text-xs text-gray-400 bg-surface-footer border border-gray-800 rounded-lg p-3 whitespace-pre-wrap">
                {r.testo}
                <div className="mt-2 text-gray-500">{r.dettaglio}</div>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
