import React, { useState } from 'react'
import FieldEditorInput from './FieldEditorInput'

// Anteprima vera del modulo mentre lo si costruisce (2026-08-16) — sostituisce il
// vecchio dump JSON grezzo (schema_json v3 in un <pre>). Riusa FieldEditorInput
// (copia locale sincronizzata a mano da core/frontend/.../ModulePage/
// FieldEditorInput.jsx, vedi commento in quel file) — lo STESSO rendering usato
// per il form "Nuovo record" di un utente vero del tenant. Legge lo schema DRAFT
// corrente (anche le modifiche non ancora salvate) — per questo è puramente
// client-side, nessuna fetch al backend, si aggiorna da solo ad ogni modifica.
// Le relazioni non hanno un vero picker qui (richiederebbe caricare record reali
// da un modulo collegato): mostrano solo l'etichetta, scope volutamente ridotto —
// il valore principale è vedere campi/etichette/tipi come li vedrà un utente vero.
function BuilderPreviewPanel({ schema }) {
  const [values, setValues] = useState({})
  const fieldSteps = (schema?.steps || []).filter((s) => s.block_type === 'field')
  const relationSteps = (schema?.steps || []).filter((s) => s.block_type === 'relation')

  if (fieldSteps.length === 0 && relationSteps.length === 0) {
    return <div className="text-xs text-gray-600 py-8 text-center">Nessun campo ancora — aggiungine uno per vedere l'anteprima.</div>
  }

  return (
    <div className="space-y-3">
      {fieldSteps.map((f) => (
        <div key={f.id}>
          <label className="text-xs text-gray-400 mb-1 block">{f.label || f.key}</label>
          <FieldEditorInput f={f} value={values[f.key]} onChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))} />
        </div>
      ))}
      {relationSteps.map((r) => (
        <div key={r.id}>
          <label className="text-xs text-gray-400 mb-1 block">{r.label || r.key}</label>
          <select disabled className="w-full bg-surface-page text-gray-600 px-4 py-3 rounded-lg text-sm border border-gray-800 cursor-not-allowed">
            <option>record collegati — non mostrati in anteprima</option>
          </select>
        </div>
      ))}
    </div>
  )
}

export default BuilderPreviewPanel
