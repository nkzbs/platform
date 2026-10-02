import React, { useState, useEffect } from 'react'
import { API } from '../../lib/api'
import useApi from '../../lib/useApi'
import Icon from '../../components/Icon'
import FieldEditorInput from './FieldEditorInput'
import { parseSchemaFrontend } from '../../lib/schema-v3-frontend'

// Primitiva "Creazione con scelta" (block_type branch_create) — un bottone che chiede
// prima una scelta (es. "Diretto" / "A rate") e poi mostra campi diversi, creando il
// record in un modulo diverso a seconda della scelta. Copre il pattern reale di
// SpeseFinancePage.jsx ("Nuovo pagamento": diretto -> crea una spesa in QUESTO modulo,
// a rate -> crea un debito in un modulo diverso, con campi completamente diversi) senza
// codice pagina-specifico: la scelta, i campi per ramo e il modulo di destinazione sono
// tutta configurazione nello schema (config.branches), non logica scritta a mano.
//
// I campi di un ramo (branch.fields: [{key, label?}]) NON portano più un proprio "type"
// da configurare a mano: alla selezione del ramo si carica lo schema REALE del modulo di
// destinazione e si risolve ogni campo per chiave, riusando FieldEditorInput — lo stesso
// renderer di "Nuovo record"/modifica inline. Prima versione forzava text/number/date/
// textarea per ogni campo: un campo select (es. "categoria" di una spesa) sarebbe stato
// un input di testo libero, con rischio concreto di introdurre valori-categoria fuori
// dalle opzioni reali (già capitato con dati storici — vedi "Contributo Casa"/"Risparmi"
// come categorie estranee trovate in entrate). Fallback a un campo testo semplice solo
// se la chiave non corrisponde a nessun campo reale del modulo target.
function BranchCreateModal({ config, defaultModuleSlug, token, onClose, onCreated }) {
  const api = useApi(token)
  const branches = config.branches || []
  const [branchIdx, setBranchIdx] = useState(0)
  const [formByBranch, setFormByBranch] = useState({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [targetFields, setTargetFields] = useState(null)
  const [uploading, setUploading] = useState({})

  const branch = branches[branchIdx] || null
  const form = formByBranch[branchIdx] || {}
  const setForm = (updater) => setFormByBranch((p) => ({ ...p, [branchIdx]: typeof updater === 'function' ? updater(p[branchIdx] || {}) : updater }))

  useEffect(() => {
    if (!branch) { setTargetFields(null); return }
    setTargetFields(null)
    const targetSlug = branch.target_module || defaultModuleSlug
    api.get('/modules/' + targetSlug).then((m) => {
      if (m) setTargetFields(parseSchemaFrontend(m.schema_json).fields || [])
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchIdx])

  const resolveField = (f) => (targetFields && targetFields.find((tf) => tf.key === f.key)) || { key: f.key, label: f.label || f.key, type: 'text' }

  const uploadFileInModal = async (key, file) => {
    if (!file) return
    setUploading((p) => ({ ...p, [key]: true }))
    const body = new FormData()
    body.append('file', file)
    const res = await fetch(API + '/uploads', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body })
    setUploading((p) => ({ ...p, [key]: false }))
    if (res.ok) {
      const uploaded = await res.json()
      setForm((f) => ({ ...f, [key]: uploaded }))
    }
  }

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true); setError('')
    const targetSlug = branch.target_module || defaultModuleSlug
    const payload = { ...(branch.defaults || {}), ...form }
    const res = await api.post('/records/' + targetSlug, payload)
    setSaving(false)
    if (!res.ok) { setError((res.data && res.data.error) || 'Salvataggio non riuscito'); return }
    onCreated()
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-surface-card rounded-md p-6 w-full max-w-md border border-gray-800 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-ink">{config.label || 'Nuovo'}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-ink transition"><Icon name="x" size={16} /></button>
        </div>

        {branches.length === 0 ? (
          <div className="text-sm text-gray-600">Nessuna opzione configurata per questo blocco.</div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            {branches.length > 1 && (
              <div className="flex gap-1.5 bg-surface-page border border-gray-800 rounded-lg p-1 mb-1">
                {branches.map((b, i) => (
                  <button key={i} type="button" onClick={() => setBranchIdx(i)}
                    className={'flex-1 text-sm font-medium px-3 py-2 rounded-md transition ' + (i === branchIdx ? 'bg-accent text-white' : 'text-gray-400 hover:text-ink')}>
                    {b.label}
                  </button>
                ))}
              </div>
            )}
            {targetFields === null ? (
              <div className="text-sm text-gray-600 py-4 text-center">Caricamento campi…</div>
            ) : (branch.fields || []).map((f) => {
              const resolved = resolveField(f)
              return (
                <div key={f.key}>
                  <label className="text-xs text-gray-400 block mb-1">{f.label || resolved.label}</label>
                  <FieldEditorInput f={resolved} value={form[f.key]} onChange={(v) => setForm({ ...form, [f.key]: v })}
                    uploading={uploading[f.key]} onUploadFile={(file) => uploadFileInModal(f.key, file)} />
                </div>
              )
            })}
            {error && <div className="text-xs text-red-400">{error}</div>}
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={onClose} className="flex-1 bg-gray-800 hover:bg-gray-700 text-white py-2.5 rounded-lg transition">Annulla</button>
              <button type="submit" disabled={saving} className="flex-1 bg-accent hover:opacity-90 disabled:opacity-50 text-white py-2.5 rounded-lg transition font-medium">{saving ? 'Salvo...' : 'Salva'}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

export default BranchCreateModal
