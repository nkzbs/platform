import React from 'react'
import { openUploadedFile } from '../lib/api'

// Come controllare una proposta dell'AI senza conoscere i dati: per ogni valore la riga del PDF in cui compare (calcolata dal progetto, non dal modello),
// un avviso se non si trova, e il pulsante per aprire il PDF. Se non c'era niente da leggere, lo dice.
const eur = (n) => Number(n || 0).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })
const fmt = (iso) => String(iso || '').split('-').reverse().join('/')

export default function AiSource({ fonte, proposta, token }) {
  const p = proposta || {}
  const campi = [['Importo', p.importo != null ? eur(p.importo) : null, 'importo'], ['Scadenza', p.scadenza ? fmt(p.scadenza) : null, 'scadenza'], ['Categoria', p.categoria || null, 'categoria']].filter((x) => x[1])
  if (!fonte) {
    return <div className="mt-2 text-[11px] text-gray-500">Non è registrato da dove l'AI ha letto questa proposta: controllala sul documento prima di accettare.</div>
  }
  return (
    <div className="mt-2 rounded-lg bg-surface-page border border-gray-800 p-2.5 text-[11px]">
      {!fonte.letto_pdf && <div className="text-amber-400 mb-1">Nessun PDF letto: l'AI ha usato solo il testo della mail. Controlla tu prima di accettare.</div>}
      {fonte.letto_pdf && campi.length > 0 && <div className="text-gray-500 mb-1">Dove l'AI l'ha letto, nel PDF:</div>}
      {fonte.letto_pdf && campi.map(([nome, valore, k]) => (
        <div key={k} className="flex gap-2 py-0.5">
          <span className="text-gray-500 w-16 flex-shrink-0">{nome}</span>
          {fonte.righe && fonte.righe[k]
            ? <span className="text-gray-300"><span className="text-ink font-medium">{valore}</span> — «{fonte.righe[k]}»</span>
            : <span className="text-amber-400"><span className="font-medium">{valore}</span> — non lo trovo scritto nel PDF: controlla</span>}
        </div>
      ))}
      {fonte.allegati && fonte.allegati.filter((a) => a.upload_id).length > 0 && (
        <div className="mt-1.5 flex gap-3 flex-wrap">
          {fonte.allegati.filter((a) => a.upload_id).map((a) => <button key={a.upload_id} type="button" onClick={() => openUploadedFile({ id: a.upload_id, name: a.name }, token)} className="text-accent hover:underline">Apri {a.name}</button>)}
        </div>
      )}
    </div>
  )
}
