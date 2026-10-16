import React, { useState } from 'react'

// «Proponi alla Libreria»: manda a Super Admin la STRUTTURA di un modulo (mai le righe), che la approva o la rifiuta.
// Usata sia dalla Libreria sia dal Builder (bottone nell'intestazione del modulo): stessa modale, stessa rotta.
// api = useApi(token); onSent() serve a ricaricare l'elenco «Proposte inviate».
export default function ProponiAllaLibreriaModal({ api, module, description = '', onClose, onSent }) {
  const [form, setForm] = useState({ description: description || module.description || '', note: '', busy: false, errore: '', fatto: false })
  const invia = async () => {
    setForm((p) => ({ ...p, busy: true, errore: '' }))
    const r = await api.post('/modules/' + module.slug + '/propose-to-registry', { description: form.description, note: form.note })
    if (r.ok) { setForm((p) => ({ ...p, busy: false, fatto: true })); if (onSent) onSent() } else setForm((p) => ({ ...p, busy: false, errore: (r.data && r.data.error) || 'Non riuscito.' }))
  }
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => !form.busy && onClose()}>
      <div className="bg-surface-card rounded-xl w-full max-w-md border border-gray-800 p-5" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-ink mb-1">Proponi «{module.name}» alla Libreria</h2>
        {form.fatto ? (
          <>
            <p className="text-sm text-gray-400 mt-2">Proposta inviata. Parte solo la <b className="text-ink">struttura</b> del modulo (campi, stati, relazioni), mai le righe. Super Admin la approva o la rifiuta con un motivo: lo vedi in Libreria, sotto «Proposte inviate».</p>
            <button onClick={onClose} className="mt-4 text-sm px-4 py-2 rounded-lg bg-accent hover:opacity-90 text-white">Chiudi</button>
          </>
        ) : (
          <>
            <p className="text-xs text-gray-500 mb-3">Parte solo lo schema (campi, stati, relazioni), mai i dati. Controlla che nei nomi delle scelte non ci siano nomi di persone o aziende. Non entra nella Libreria da solo: la approva Super Admin.</p>
            <label className="text-xs text-gray-500 block mb-1">A cosa serve (la vedranno gli altri progetti)</label>
            <textarea className="w-full bg-surface-page text-ink px-3 py-2 rounded-lg text-sm outline-none border border-gray-800 focus:border-accent min-h-[70px]" value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} />
            <label className="text-xs text-gray-500 block mb-1 mt-3">Nota per Super Admin (facoltativa)</label>
            <input className="w-full bg-surface-page text-ink px-3 py-2 rounded-lg text-sm outline-none border border-gray-800 focus:border-accent" placeholder="Es. lo usiamo ogni giorno da un anno" value={form.note} onChange={(e) => setForm((p) => ({ ...p, note: e.target.value }))} />
            {form.errore && <div className="text-xs text-amber-400 mt-2">{form.errore}</div>}
            <div className="flex gap-2 mt-4 justify-end">
              <button onClick={onClose} disabled={form.busy} className="text-sm px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300">Annulla</button>
              <button onClick={invia} disabled={form.busy} className="text-sm px-4 py-2 rounded-lg bg-accent hover:opacity-90 disabled:opacity-50 text-white">{form.busy ? 'Invio…' : 'Invia la proposta'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
