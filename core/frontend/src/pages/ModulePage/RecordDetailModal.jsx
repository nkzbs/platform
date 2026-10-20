import React, { useState, useEffect, useCallback } from 'react'
import { API, openUploadedFile } from '../../lib/api'
const toast = (message, type = 'success') => window.dispatchEvent(new CustomEvent('platform:toast', { detail: { message, type } }))
import useApi from '../../lib/useApi'
import Icon from '../../components/Icon'
import Tile from '../../components/Tile'
import FormDrawer from '../../components/FormDrawer'
import Select from '../../components/Select'
import FieldEditorInput from './FieldEditorInput'
import { parseSchemaFrontend } from '../../lib/schema-v3-frontend'

function VaultPinGate({ token, userId, onUnlocked }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)
  const [settingUp, setSettingUp] = useState(false)
  const [setupPin, setSetupPin] = useState('')
  const [setupPin2, setSetupPin2] = useState('')
  const [hasPinLoaded, setHasPinLoaded] = useState(false)
  const [hasPin, setHasPin] = useState(false)

  useEffect(() => {
    fetch('/api/users/me/vault-pin/status', { headers: { Authorization: 'Bearer ' + token } })
      .then((r) => r.json()).then((d) => { setHasPin(!!d.has_pin); setHasPinLoaded(true) })
      .catch(() => { setHasPinLoaded(true) })
  }, [token])

  const verify = async () => {
    setChecking(true); setError('')
    const res = await fetch('/api/users/me/vault-pin/verify', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
    })
    const data = await res.json()
    setChecking(false)
    if (data.no_pin || data.ok) {
      sessionStorage.setItem('vault_unlocked_' + userId, '1')
      onUnlocked()
    } else {
      setError('PIN non corretto')
    }
  }

  const setupVaultPin = async () => {
    if (setupPin.length < 4) { setError('PIN di almeno 4 cifre'); return }
    if (setupPin !== setupPin2) { setError('I PIN non coincidono'); return }
    setChecking(true); setError('')
    await fetch('/api/users/me/vault-pin/setup', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: setupPin }),
    })
    setChecking(false)
    sessionStorage.setItem('vault_unlocked_' + userId, '1')
    onUnlocked()
  }

  if (!hasPinLoaded) return <div className="text-gray-500 text-sm py-4 text-center">Verifica PIN vault...</div>

  if (!hasPin && !settingUp) {
    return (
      <div className="py-4 text-center">
        <div className="text-sm text-gray-400 mb-4">Questo record contiene campi cifrati. Imposta un PIN vault per proteggerli.</div>
        <button onClick={() => setSettingUp(true)} className="bg-accent hover:opacity-90 text-white px-5 py-2 rounded-lg text-sm transition">Imposta PIN vault</button>
        <button onClick={onUnlocked} className="block mx-auto mt-2 text-xs text-gray-600 hover:text-gray-400 transition">Salta (mostra senza PIN)</button>
      </div>
    )
  }

  if (!hasPin && settingUp) {
    return (
      <div className="py-4 space-y-3">
        <div className="text-sm text-gray-400 mb-2">Scegli un PIN (min. 4 cifre) per proteggere i campi cifrati:</div>
        <input type="password" inputMode="numeric" maxLength={12} placeholder="Nuovo PIN"
          className="w-full bg-surface-page text-ink px-4 py-3 rounded-lg text-sm outline-none border border-gray-800 focus:border-accent transition"
          value={setupPin} onChange={(e) => setSetupPin(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && document.getElementById('setup-pin2').focus()} />
        <input id="setup-pin2" type="password" inputMode="numeric" maxLength={12} placeholder="Conferma PIN"
          className="w-full bg-surface-page text-ink px-4 py-3 rounded-lg text-sm outline-none border border-gray-800 focus:border-accent transition"
          value={setupPin2} onChange={(e) => setSetupPin2(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && setupVaultPin()} />
        {error && <div className="text-xs text-red-400">{error}</div>}
        <button onClick={setupVaultPin} disabled={checking} className="w-full bg-accent hover:opacity-90 disabled:opacity-50 text-white py-2.5 rounded-lg text-sm transition font-medium">
          {checking ? 'Impostazione...' : 'Conferma PIN'}
        </button>
      </div>
    )
  }

  return (
    <div className="py-4 space-y-3">
      <div className="text-sm text-gray-400 mb-2">Inserisci il PIN vault per visualizzare i campi cifrati:</div>
      <input type="password" inputMode="numeric" maxLength={12} placeholder="PIN vault" autoFocus
        className="w-full bg-surface-page text-ink px-4 py-3 rounded-lg text-sm outline-none border border-gray-800 focus:border-accent transition"
        value={pin} onChange={(e) => setPin(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && verify()} />
      {error && <div className="text-xs text-red-400">{error}</div>}
      <button onClick={verify} disabled={checking} className="w-full bg-accent hover:opacity-90 disabled:opacity-50 text-white py-2.5 rounded-lg text-sm transition font-medium">
        {checking ? 'Verifica...' : 'Sblocca'}
      </button>
    </div>
  )
}

function RecordDetailModal({ mod, schema, recordId, relatedCache, onClose, token, onSaved, user, canDelete, onDeleted }) {
  const api = useApi(token)
  const [record, setRecord] = useState(null)
  const [children, setChildren] = useState([])
  const [childData, setChildData] = useState({})
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState({})
  const [uploading, setUploading] = useState({})
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [transitioning, setTransitioning] = useState(false)
  const [revealedFields, setRevealedFields] = useState({})
  const toggleReveal = useCallback((key) => setRevealedFields((p) => ({ ...p, [key]: !p[key] })), [])
  const userId = user && user.id
  const hasEncryptedFields = (schema && schema.fields || []).some((f) => f.type === 'encrypted')
  const vaultKey = 'vault_unlocked_' + userId
  const [vaultUnlocked, setVaultUnlocked] = useState(() => !hasEncryptedFields || !!sessionStorage.getItem('vault_unlocked_' + userId))
  const [m2mLinks, setM2mLinks] = useState({})
  const [m2mNewTarget, setM2mNewTarget] = useState({})
  const [m2mNewData, setM2mNewData] = useState({})
  const [history, setHistory] = useState([])
  // Bento (2026-08-16) — "Dettagli" (campi+relazioni singole, sempre in cima)
  // resta invariato; tutto il resto (stato, relazioni collegate, allegati,
  // cronologia, ciascun modulo figlio) diventa una tile, un pannello alla
  // volta sotto — stesso pattern di ImpostazioniPage/PartnersPage. Nessuna
  // sezione tocca lo stato/le funzioni esistenti, cambia solo come sono
  // mostrate. `null` = nessuna tile aperta.
  const [openSection, setOpenSection] = useState(null)
  const toggleSection = (key) => setOpenSection((s) => (s === key ? null : key))
  const allegatiConfig = schema && schema.allegati
  const [attachments, setAttachments] = useState([])
  const [uploadingAtt, setUploadingAtt] = useState(false)
  const [uploadProgress, setUploadProgress] = useState([])
  const [attTipo, setAttTipo] = useState('')
  const [childSchemas, setChildSchemas] = useState({})
  const [childRelatedRecs, setChildRelatedRecs] = useState({})
  const [childAddForms, setChildAddForms] = useState({})
  const [childAddingRow, setChildAddingRow] = useState({})
  const [childEditingRow, setChildEditingRow] = useState({})
  const [childEditForms, setChildEditForms] = useState({})
  const [childSaving, setChildSaving] = useState({})
  const [childUploading, setChildUploading] = useState({})
  const loadAttachments = () => {
    if (!allegatiConfig) return
    api.get('/records/' + mod.slug + '/' + recordId + '/attachments').then((data) => { if (data) setAttachments(data) })
  }

  // Upload multiplo: più file insieme, uno stato per file (in corso/ok/errore) invece
  // di uno alla volta — generico, beneficia qualunque modulo con allegati configurati.
  const uploadAttachments = async (fileList) => {
    const files = Array.from(fileList || [])
    if (files.length === 0) return
    setUploadingAtt(true)
    setUploadProgress(files.map((f) => ({ name: f.name, status: 'pending' })))
    let ok = 0, err = 0
    for (let i = 0; i < files.length; i++) {
      setUploadProgress((p) => p.map((x, j) => (j === i ? { ...x, status: 'uploading' } : x)))
      try {
        const body = new FormData()
        body.append('file', files[i])
        const res = await fetch(API + '/uploads', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body })
        if (!res.ok) throw new Error()
        const uploaded = await res.json()
        await api.post('/records/' + mod.slug + '/' + recordId + '/attachments', { upload_id: uploaded.id, tipo: attTipo || null })
        setUploadProgress((p) => p.map((x, j) => (j === i ? { ...x, status: 'ok' } : x)))
        ok++
      } catch (e) {
        setUploadProgress((p) => p.map((x, j) => (j === i ? { ...x, status: 'error' } : x)))
        err++
      }
    }
    setUploadingAtt(false)
    loadAttachments()
    toast(err === 0 ? (ok > 1 ? ok + ' allegati caricati' : 'Allegato caricato') : `${ok} caricati, ${err} falliti`, err === 0 ? 'success' : 'error')
  }

  const deleteAttachment = async (attId) => {
    await api.del('/records/' + mod.slug + '/' + recordId + '/attachments/' + attId)
    loadAttachments()
  }

  useEffect(() => {
    let cancelled = false
    api.get('/records/' + mod.slug + '/' + recordId).then((data) => { if (!cancelled && data) setRecord(data) })
    api.get('/modules/' + mod.slug + '/children-modules').then((data) => { if (!cancelled && data) setChildren(data) })
    if (!cancelled && allegatiConfig) {
      api.get('/records/' + mod.slug + '/' + recordId + '/attachments').then((data) => { if (!cancelled && data) setAttachments(data) })
    }
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mod.slug, recordId])

  useEffect(() => {
    children.forEach((c) => {
      api.get('/records/' + c.module_slug + '?rel=' + c.relation_key + '&value=' + recordId).then((data) => {
        if (data) setChildData((p) => ({ ...p, [c.module_slug]: data }))
      })
      api.get('/modules/' + c.module_slug).then((modData) => {
        if (!modData) return
        const sch = parseSchemaFrontend(modData.schema_json)
        setChildSchemas((p) => ({ ...p, [c.module_slug]: sch }))
        // Prefetch records for each relation in this child schema
        const rels = (sch && sch.relations) || []
        rels.filter((r) => r.key !== c.relation_key && r.target_module).forEach((r) => {
          api.get('/records/' + r.target_module).then((recs) => {
            if (!recs) return
            const byId = {}
            recs.forEach((rec) => { byId[rec.id] = r.display_field ? (rec.data[r.display_field] ?? ('#' + rec.id)) : (rec.data[Object.keys(rec.data)[0]] ?? ('#' + rec.id)) })
            setChildRelatedRecs((p) => ({ ...p, [r.target_module]: { records: recs, byId } }))
          })
        })
      })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [children, recordId])

  const reloadChild = useCallback((c) => {
    api.get('/records/' + c.module_slug + '?rel=' + c.relation_key + '&value=' + recordId).then((data) => {
      if (data) setChildData((p) => ({ ...p, [c.module_slug]: data }))
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordId])

  // Upload di un campo "file" dentro la riga "Aggiungi riga" di un modulo figlio
  // (es. il campo File di Documenti, aggiunto da dentro una Spesa) — stesso pattern
  // di uploadFileInModal sui campi del record principale. Prima mancava del tutto:
  // il campo file nella riga inline cadeva nel ramo di default (input di testo),
  // quindi non c'era nessun modo reale di allegare un file da lì.
  const uploadChildFile = async (moduleSlug, fieldKey, file) => {
    if (!file) return
    setChildUploading((p) => ({ ...p, [moduleSlug + '.' + fieldKey]: true }))
    const body = new FormData()
    body.append('file', file)
    const res = await fetch(API + '/uploads', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body })
    setChildUploading((p) => ({ ...p, [moduleSlug + '.' + fieldKey]: false }))
    if (res.ok) {
      const uploaded = await res.json()
      setChildAddForms((p) => ({ ...p, [moduleSlug]: { ...(p[moduleSlug] || {}), [fieldKey]: uploaded } }))
    } else {
      toast('Upload non riuscito', 'error')
    }
  }

  const saveChildRow = async (c) => {
    setChildSaving((p) => ({ ...p, [c.module_slug]: true }))
    const formData = { ...(childAddForms[c.module_slug] || {}), [c.relation_key]: recordId }
    const result = await api.post('/records/' + c.module_slug, formData)
    setChildSaving((p) => ({ ...p, [c.module_slug]: false }))
    if (result && result.ok) {
      setChildAddForms((p) => ({ ...p, [c.module_slug]: {} }))
      setChildAddingRow((p) => ({ ...p, [c.module_slug]: false }))
      reloadChild(c)
      toast('Riga aggiunta')
    } else {
      toast('Errore nel salvataggio', 'error')
    }
  }

  const deleteChildRow = async (c, childRecordId) => {
    await api.del('/records/' + c.module_slug + '/' + childRecordId)
    reloadChild(c)
    toast('Riga eliminata')
  }

  // Modifica di una riga figlia GIÀ salvata (es. correggere quantità/prezzo su una
  // riga ordine già aggiunta) — prima esisteva solo aggiungi/elimina, nessun modo di
  // correggere un valore senza cancellare la riga e rifarla da capo (segnalato da un
  // utente reale, 2026-08-14). Stesso endpoint generico PUT già usato per il record
  // padre, qui applicato al record figlio.
  const startEditingChildRow = (c, cr) => {
    setChildEditingRow((p) => ({ ...p, [c.module_slug]: cr.id }))
    setChildEditForms((p) => ({ ...p, [c.module_slug]: { ...cr.data } }))
  }
  const cancelEditingChildRow = (c) => {
    setChildEditingRow((p) => ({ ...p, [c.module_slug]: null }))
  }
  const saveChildRowEdit = async (c) => {
    const rowId = childEditingRow[c.module_slug]
    if (!rowId) return
    setChildSaving((p) => ({ ...p, [c.module_slug]: true }))
    const result = await api.put('/records/' + c.module_slug + '/' + rowId, childEditForms[c.module_slug] || {})
    setChildSaving((p) => ({ ...p, [c.module_slug]: false }))
    if (result && result.ok) {
      setChildEditingRow((p) => ({ ...p, [c.module_slug]: null }))
      reloadChild(c)
      toast('Riga aggiornata')
    } else {
      toast((result && result.data && result.data.error) || 'Errore nel salvataggio', 'error')
    }
  }

  // Input per un campo di una riga figlia (Aggiungi riga E modifica riga esistente
  // usano lo stesso switch — un solo posto da tenere allineato invece di due copie
  // che potrebbero divergere silenziosamente).
  const renderChildFieldInput = (f, value, onChange) => {
    if (f.type === 'select') {
      return (
        <Select value={value || ''} onChange={onChange}
          options={(f.options || []).map((o) => (typeof o === 'object' ? o : { value: o, label: o }))} />
      )
    }
    if (f.type === 'boolean' || f.type === 'checkbox') {
      return <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} className="ml-1" />
    }
    if (f.type === 'file') {
      return <span className="text-[10px] text-gray-600">{value && value.name ? value.name : 'non modificabile qui'}</span>
    }
    return (
      <input
        type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : f.type === 'time' ? 'time' : 'text'}
        className="w-full bg-surface-input text-ink px-2 py-1 rounded text-xs outline-none border border-gray-700 focus:border-accent"
        placeholder={f.label}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
      />
    )
  }

  const fields = (schema && schema.fields) || []
  const relations = (schema && schema.relations) || []
  const m2mRelations = relations.filter((r) => r.type === 'many_to_many')
  const editableFields = fields.filter((f) => f.type !== 'computed')
  const workflow = schema && schema.workflow

  const loadM2mLinks = (relKey, targetModule) => {
    api.get('/m2m/' + mod.slug + '/' + recordId + '/' + relKey).then((data) => {
      if (data) setM2mLinks((p) => ({ ...p, [relKey]: data }))
    })
  }

  useEffect(() => {
    if (recordId && m2mRelations.length > 0) {
      m2mRelations.forEach((r) => loadM2mLinks(r.key, r.target_module))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordId, schema])

  const addM2mLink = async (r) => {
    const targetId = m2mNewTarget[r.key]
    if (!targetId) return
    const data = m2mNewData[r.key] || {}
    await api.post('/m2m/' + mod.slug + '/' + recordId + '/' + r.key, { target_module: r.target_module, target_id: targetId, data })
    setM2mNewTarget((p) => ({ ...p, [r.key]: '' }))
    setM2mNewData((p) => ({ ...p, [r.key]: {} }))
    loadM2mLinks(r.key, r.target_module)
  }

  const removeM2mLink = async (r, targetId) => {
    await api.del('/m2m/' + mod.slug + '/' + recordId + '/' + r.key + '/' + targetId)
    loadM2mLinks(r.key, r.target_module)
  }

  const loadHistory = async () => {
    const data = await api.get('/records/' + mod.slug + '/' + recordId + '/history')
    if (data) setHistory(data)
  }

  useEffect(() => { if (openSection === 'cronologia') loadHistory() }, [openSection, recordId])

  const doTransition = async (to) => {
    setTransitioning(true)
    const res = await api.post('/records/' + mod.slug + '/' + recordId + '/transition', { to })
    setTransitioning(false)
    if (!res.ok) { toast((res.data && res.data.error) || 'Transizione non riuscita', 'error'); return }
    setRecord(res.data)
    if (openSection === 'cronologia') loadHistory()
    toast('Stato aggiornato')
    if (onSaved) onSaved(res.data)
  }

  const startEditing = () => {
    setEditForm({ ...record.data })
    setSaveError('')
    setEditing(true)
  }

  const uploadFileInModal = async (fieldKey, file) => {
    if (!file) return
    setUploading((p) => ({ ...p, [fieldKey]: true }))
    const body = new FormData()
    body.append('file', file)
    const res = await fetch(API + '/uploads', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body })
    setUploading((p) => ({ ...p, [fieldKey]: false }))
    if (res.ok) {
      const uploaded = await res.json()
      setEditForm((p) => ({ ...p, [fieldKey]: uploaded }))
    } else {
      window.alert('Upload non riuscito')
    }
  }

  const save = async () => {
    setSaving(true)
    setSaveError('')
    const res = await api.put('/records/' + mod.slug + '/' + recordId, editForm)
    setSaving(false)
    if (!res.ok) {
      setSaveError((res.data && res.data.error) || 'Salvataggio non riuscito')
      return
    }
    setRecord(res.data)
    setEditing(false)
    if (openSection === 'cronologia') loadHistory()
    toast('Modifiche salvate')
    if (onSaved) onSaved(res.data)
  }

  // Elimina — prima esisteva solo nell'icona a cestino della riga in elenco, non qui
  // dentro: chi apriva il record per guardarlo/modificarlo non trovava modo di
  // cancellarlo (segnalato dall'utente il 2026-10-20). Stesso endpoint del cestino
  // in elenco, con conferma: qui l'azione è più deliberata (si è aperto il record
  // apposta), a differenza del cestino al volo nell'elenco.
  const remove = async () => {
    if (!window.confirm('Eliminare questo record? Non si può annullare.')) return
    await api.del('/records/' + mod.slug + '/' + recordId)
    onClose()
    if (onDeleted) onDeleted()
  }

  return (
    <FormDrawer
      title={mod.name + ' — dettaglio'}
      onClose={editing ? () => setEditing(false) : onClose}
      wide
      headerExtra={(
        <>
          {!editing && record && <button onClick={startEditing} className="text-xs text-accent hover:opacity-80 transition flex items-center gap-1"><Icon name="edit" size={12} />Modifica</button>}
          {!editing && record && canDelete && <button onClick={remove} className="text-xs text-red-400/70 hover:text-red-400 transition flex items-center gap-1"><Icon name="trash" size={12} />Elimina</button>}
        </>
      )}
    >
        {!vaultUnlocked ? (
          <VaultPinGate token={token} userId={userId} onUnlocked={() => setVaultUnlocked(true)} />
        ) : !record ? (
          <div className="text-gray-500 text-sm">Caricamento...</div>
        ) : editing ? (
          <>
            {saveError && <div className="bg-red-900/30 text-red-400 text-xs p-3 rounded-lg mb-3 border border-red-900/50">{saveError}</div>}
            <div className="space-y-3 mb-5">
              {editableFields.map((f) => (
                <div key={f.key}>
                  <label className="text-xs text-gray-400 block mb-1">{f.label}{f.required && ' *'}</label>
                  <FieldEditorInput f={f} value={editForm[f.key]} onChange={(v) => setEditForm({ ...editForm, [f.key]: v })} uploading={uploading[f.key]} onUploadFile={(file) => uploadFileInModal(f.key, file)} />
                </div>
              ))}
              {relations.map((r) => {
                const cache = relatedCache[r.key]
                return (
                  <div key={r.key}>
                    <label className="text-xs text-gray-400 block mb-1">{r.label}</label>
                    <Select
                      value={editForm[r.key] || ''}
                      onChange={(v) => setEditForm({ ...editForm, [r.key]: v })}
                      placeholder={'Seleziona ' + r.label.toLowerCase() + '...'}
                      options={((cache && cache.records) || []).map((rec) => ({ value: rec.id, label: r.display_field ? (rec.data[r.display_field] ?? ('#' + rec.id)) : ('#' + rec.id) }))}
                    />
                  </div>
                )
              })}
            </div>
            <div className="flex gap-3">
              <button onClick={() => setEditing(false)} className="flex-1 bg-gray-800 hover:bg-gray-700 text-white py-2.5 rounded-lg transition">Annulla</button>
              <button onClick={save} disabled={saving} className="flex-1 bg-accent hover:opacity-90 disabled:opacity-50 text-white py-2.5 rounded-lg transition font-medium">{saving ? 'Salvataggio...' : 'Salva'}</button>
            </div>
          </>
        ) : (
          <>
            <div className="space-y-2 mb-5">
              {fields.map((f) => (
                <div key={f.key} className="flex items-center justify-between text-sm border-b border-gray-800/60 pb-2">
                  <span className="text-gray-500">{f.label}{f.type === 'computed' && <span className="text-gray-700"> (calcolato)</span>}</span>
                  <span className="text-gray-200 font-mono">
                    {f.type === 'encrypted'
                      ? (record.data[f.key]
                          ? <span className="flex items-center gap-1.5">
                              <span className="font-mono text-gray-200">{revealedFields[f.key] ? record.data[f.key] : '••••••••'}</span>
                              <button onClick={() => toggleReveal(f.key)} className="text-gray-500 hover:text-gray-300 transition"><Icon name={revealedFields[f.key] ? 'eye-off' : 'eye'} size={13} /></button>
                            </span>
                          : '—')
                      : f.type === 'giacenza'
                      ? (record.data[f.key] && typeof record.data[f.key] === 'object'
                          ? <span className="flex flex-wrap gap-2">
                              {(f.locations || []).map((loc) => (
                                <span key={loc.key} className="text-xs text-gray-400">{loc.label}: <span className="text-gray-200">{record.data[f.key][loc.key] ?? 0}</span></span>
                              ))}
                            </span>
                          : '—')
                      : f.type === 'file'
                      ? (record.data[f.key] && record.data[f.key].id
                          ? <button onClick={() => openUploadedFile(record.data[f.key], token)} className="text-accent hover:opacity-80 transition flex items-center gap-1 font-sans"><Icon name="file" size={12} />{record.data[f.key].name}</button>
                          : '—')
                      : f.type === 'mappa'
                      ? (record.data[f.key]
                          ? <a href={'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(record.data[f.key])} target="_blank" rel="noreferrer" className="text-accent hover:opacity-80 transition flex items-center gap-1 font-sans"><Icon name="link" size={12} />{record.data[f.key]}</a>
                          : '—')
                      : f.type === 'scaglioni'
                      ? (() => {
                          let righe = []
                          try { righe = JSON.parse(record.data[f.key] || '[]'); if (!Array.isArray(righe)) righe = [] } catch (e) { righe = [] }
                          if (righe.length === 0) return '—'
                          return (
                            <span className="flex flex-col items-end gap-0.5 font-sans">
                              {righe.map((r, i) => (
                                <span key={i} className="text-xs text-gray-300">
                                  {i === righe.length - 1 ? 'oltre' : 'fino a €' + r.soglia}: <span className="text-gray-200 font-mono">{r.perc}%</span>
                                </span>
                              ))}
                            </span>
                          )
                        })()
                      : (record.data[f.key] !== undefined && record.data[f.key] !== null ? String(record.data[f.key]) : '—')}
                  </span>
                </div>
              ))}
              {relations.map((r) => {
                const cache = relatedCache[r.key]
                const label = cache && cache.byId[record.data[r.key]]
                return (
                  <div key={r.key} className="flex items-center justify-between text-sm border-b border-gray-800/60 pb-2">
                    <span className="text-gray-500">{r.label}</span>
                    <span className="text-gray-200">{label || (record.data[r.key] ? '#' + record.data[r.key] : '—')}</span>
                  </div>
                )
              })}
            </div>

            {(workflow || m2mRelations.length > 0 || allegatiConfig || children.length > 0) && (
              <div className="grid grid-cols-2 gap-2 mb-3">
                {workflow && (() => {
                  const statoCorrente = workflow.states.find((s) => s.key === record.data._stato)
                  return <Tile icon="git-branch" label="Stato" active={openSection === 'stato'} onClick={() => toggleSection('stato')}
                    value={statoCorrente ? statoCorrente.label : '—'} sub={(workflow.transitions || []).filter((t) => t.from === record.data._stato).length + ' transizioni disponibili'} />
                })()}
                {m2mRelations.length > 0 && (
                  <Tile icon="link" label="Relazioni collegate" active={openSection === 'relazioni'} onClick={() => toggleSection('relazioni')}
                    value={m2mRelations.map((r) => (m2mLinks[r.key] || []).length).reduce((a, b) => a + b, 0) + ' collegate'}
                    sub={m2mRelations.map((r) => r.label).join(', ')} />
                )}
                {allegatiConfig && (
                  <Tile icon="file" label="Allegati" active={openSection === 'allegati'} onClick={() => toggleSection('allegati')}
                    value={attachments.length + (attachments.length === 1 ? ' file' : ' file')} sub={attachments.length === 0 ? 'Nessun allegato' : 'Carica/consulta'} />
                )}
                <Tile icon="refresh" label="Cronologia" active={openSection === 'cronologia'} onClick={() => toggleSection('cronologia')}
                  value={history.length + (history.length === 1 ? ' modifica' : ' modifiche')} sub="Modifiche registrate" />
                {children.map((c) => (
                  <Tile key={c.module_slug} icon={c.module_icon || 'box'} label={c.module_name} active={openSection === 'child:' + c.module_slug} onClick={() => toggleSection('child:' + c.module_slug)}
                    value={(childData[c.module_slug] || []).length + ' righe'} sub="Modulo collegato" />
                ))}
              </div>
            )}

            {openSection === 'relazioni' && m2mRelations.length > 0 && (
              <div className="mb-4">
            {m2mRelations.map((r) => {
              const links = m2mLinks[r.key] || []
              const targetRecs = (relatedCache[r.key] && relatedCache[r.key].records) || []
              const attrs = r.attributes || []
              const linked = new Set(links.map((l) => String(l.target_id)))
              const available = targetRecs.filter((rec) => !linked.has(String(rec.id)))
              return (
                <div key={r.key} className="mb-4">
                  <div className="text-xs font-semibold text-gray-400 mb-2 flex items-center gap-1.5"><Icon name="link" size={11} />{r.label}</div>
                  {links.length > 0 && (
                    <div className="bg-surface-page rounded-lg border border-gray-800 overflow-hidden mb-2">
                      <table className="w-full text-xs">
                        <thead><tr className="border-b border-gray-800">{[r.label, ...attrs.map((a) => a.label), ''].map((h, i) => <th key={i} className="text-left px-3 py-1.5 text-gray-600">{h}</th>)}</tr></thead>
                        <tbody>
                          {links.map((l) => {
                            const target = targetRecs.find((rec) => rec.id === l.target_id)
                            return (
                              <tr key={l.id} className="border-b border-gray-800/50 last:border-0">
                                <td className="px-3 py-1.5 text-gray-300">{target ? (r.display_field ? (target.data[r.display_field] ?? '#' + target.id) : '#' + target.id) : '#' + l.target_id}</td>
                                {attrs.map((a) => <td key={a.key} className="px-3 py-1.5 text-gray-300">{l.data[a.key] ?? '—'}</td>)}
                                <td className="px-3 py-1.5 text-right"><button onClick={() => removeM2mLink(r, l.target_id)} className="text-red-400/50 hover:text-red-400 transition"><Icon name="x" size={11} /></button></td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {available.length > 0 && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <select className="bg-surface-page text-ink px-2 py-1.5 rounded-md text-xs outline-none border border-gray-700" value={m2mNewTarget[r.key] || ''} onChange={(e) => setM2mNewTarget((p) => ({ ...p, [r.key]: e.target.value }))}>
                        <option value="">+ Aggiungi {r.label.toLowerCase()}...</option>
                        {available.map((rec) => <option key={rec.id} value={rec.id}>{r.display_field ? (rec.data[r.display_field] ?? '#' + rec.id) : '#' + rec.id}</option>)}
                      </select>
                      {attrs.map((a) => (
                        <input key={a.key} className="w-24 bg-surface-page text-ink px-2 py-1.5 rounded-md text-xs outline-none border border-gray-700" placeholder={a.label}
                          value={(m2mNewData[r.key] || {})[a.key] || ''} onChange={(e) => setM2mNewData((p) => ({ ...p, [r.key]: { ...(p[r.key] || {}), [a.key]: e.target.value } }))} />
                      ))}
                      {m2mNewTarget[r.key] && <button onClick={() => addM2mLink(r)} className="text-xs text-accent hover:opacity-80 transition">Aggiungi</button>}
                    </div>
                  )}
                </div>
              )
            })}
              </div>
            )}

            {openSection === 'stato' && workflow && (() => {
              const statoCorrente = workflow.states.find((s) => s.key === record.data._stato)
              const transizioni = (workflow.transitions || []).filter((t) => t.from === record.data._stato)
              return (
                <div className="mb-5 p-3 rounded-lg bg-surface-page border border-gray-800">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-gray-500">Stato</span>
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: statoCorrente ? statoCorrente.color : '#6B7280' }} />
                      <span className="text-xs text-gray-300">{statoCorrente ? statoCorrente.label : '—'}</span>
                    </div>
                  </div>
                  {transizioni.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {transizioni.map((t) => {
                        const statoTarget = workflow.states.find((s) => s.key === t.to)
                        return (
                          <button key={t.to} onClick={() => doTransition(t.to)} disabled={transitioning}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition disabled:opacity-50 bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700">
                            {statoTarget && <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: statoTarget.color }} />}
                            {t.label}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })()}

            {openSection === 'cronologia' && (
              <div className="mb-4 p-3 rounded-lg bg-surface-page border border-gray-800">
                <div className="space-y-1">
                  {history.length === 0 && <div className="text-xs text-gray-600 py-1">Nessuna modifica registrata</div>}
                  {history.map((h) => {
                    const ACTION_LABEL = { create: 'Creato', update: 'Modificato', delete: 'Eliminato', transition: 'Transizione' }
                    return (
                      <div key={h.id} className="text-xs py-1.5 border-b border-gray-800/40 last:border-0 flex items-start justify-between gap-3">
                        <div>
                          <span className="text-gray-400 font-medium">{ACTION_LABEL[h.action] || h.action}</span>
                          {h.action === 'transition' && h.before_data && h.after_data && (
                            <span className="text-gray-600"> {h.before_data._stato} → {h.after_data._stato}</span>
                          )}
                          {h.actor && <span className="text-gray-600"> · {h.actor}</span>}
                        </div>
                        <span className="text-gray-600 flex-shrink-0">{new Date(h.created_at).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {openSection === 'allegati' && allegatiConfig && (
              <div className="mb-4 p-3 rounded-lg bg-surface-page border border-gray-800">
                <div className="flex items-center gap-2 text-xs font-semibold text-gray-400 mb-3">
                  <Icon name="file" size={12} /> Allegati
                  <span className="text-gray-600 font-normal">({attachments.length})</span>
                </div>
                {attachments.length > 0 && (
                  <div className="space-y-1.5 mb-3">
                    {attachments.map((att) => (
                      <div key={att.id} className="flex items-center gap-2 bg-surface-page rounded-lg px-3 py-2 border border-gray-800">
                        <Icon name="file" size={12} className="text-gray-500" />
                        <button onClick={() => openUploadedFile({ id: att.upload_id, name: att.original_name }, token)} className="flex-1 text-left text-xs text-accent hover:opacity-80 transition truncate">
                          {att.original_name}
                        </button>
                        {att.tipo && <span className="text-[10px] text-gray-600 bg-gray-800 px-1.5 py-0.5 rounded">{att.tipo}</span>}
                        <button onClick={() => deleteAttachment(att.id)} className="text-red-400/50 hover:text-red-400 transition flex-shrink-0"><Icon name="trash" size={11} /></button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-2 flex-wrap">
                  {(allegatiConfig.types || []).length > 0 && (
                    <select className="bg-surface-page text-ink px-2 py-1.5 rounded-md text-xs outline-none border border-gray-700" value={attTipo} onChange={(e) => setAttTipo(e.target.value)}>
                      <option value="">Tipo allegato...</option>
                      {(allegatiConfig.types || []).map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  )}
                  <label className={'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ' + (uploadingAtt ? 'opacity-50' : 'bg-gray-800 hover:bg-gray-700 text-gray-300')}>
                    <Icon name="upload" size={12} />
                    {uploadingAtt ? 'Caricamento...' : 'Carica allegati'}
                    <input type="file" multiple className="hidden" disabled={uploadingAtt} onChange={(e) => uploadAttachments(e.target.files)} />
                  </label>
                </div>
                {uploadProgress.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {uploadProgress.map((f, i) => (
                      <div key={i} className="flex items-center gap-2 text-[11px] text-gray-500">
                        <Icon name={f.status === 'ok' ? 'check' : f.status === 'error' ? 'x' : 'upload'} size={10}
                          className={f.status === 'ok' ? 'text-green-400' : f.status === 'error' ? 'text-red-400' : 'text-gray-500'} />
                        <span className="truncate">{f.name}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {children.filter((c) => openSection === 'child:' + c.module_slug).map((c) => {
              const cSchema = childSchemas[c.module_slug]
              const cFields = cSchema ? (cSchema.fields || []).filter((f) => f.key !== c.relation_key && f.type !== 'computed') : []
              const cRelations = cSchema ? (cSchema.relations || []).filter((r) => r.key !== c.relation_key) : []
              const displayFields = cFields.slice(0, 6)
              const rows = childData[c.module_slug] || []
              const isAddingRow = !!childAddingRow[c.module_slug]
              const addForm = childAddForms[c.module_slug] || {}
              const isSaving = !!childSaving[c.module_slug]
              // Campi calcolati del figlio (es. margini, ammortamenti residui...): esclusi
              // da displayFields perché non compilabili nel form "Aggiungi riga", ma vanno
              // comunque mostrati in lettura — qualunque campo computed di qualunque modulo,
              // non solo casi specifici (prima qui viveva un'eccezione hardcoded solo per
              // "attrezzature" viste da "clienti"; ora è lo stesso trattamento generico di
              // ogni altro campo computed dell'app).
              const computedFields = cSchema ? (cSchema.fields || []).filter((f) => f.key !== c.relation_key && f.type === 'computed') : []
              return (
                // Stesso involucro "pannello aperto" di stato/cronologia/allegati (bg-surface-page
                // + bordo + padding) — prima questo pannello aveva solo l'header nudo con la
                // tabella boxata sotto, senza il bordo esterno che rende ovvio "questa è la card
                // che si è aperta" — segnalato dall'utente ("la parte che si apre non si capisce
                // bene"). Aggiunta anche una X di chiusura esplicita nell'header: prima l'unico
                // modo di richiudere era ritrovare e ricliccare la stessa tile più in alto.
                <div key={c.module_slug} className="mb-4 p-3 rounded-lg bg-surface-page border border-gray-800">
                  <div className="flex items-center gap-2 text-xs font-semibold text-gray-400 mb-3 flex-wrap">
                    <Icon name={c.module_icon || 'box'} size={12} />{c.module_name}
                    <span className="text-gray-600 font-normal">({rows.length})</span>
                    <button
                      onClick={() => setChildAddingRow((p) => ({ ...p, [c.module_slug]: !isAddingRow }))}
                      className="ml-auto flex items-center gap-1 text-[10px] text-green-400 hover:text-green-300 bg-green-400/10 hover:bg-green-400/20 px-2 py-0.5 rounded transition"
                    >
                      <Icon name={isAddingRow ? 'x' : 'plus'} size={10} />
                      {isAddingRow ? 'Annulla' : 'Aggiungi riga'}
                    </button>
                    <button onClick={() => setOpenSection(null)} className="text-gray-500 hover:text-ink transition"><Icon name="x" size={12} /></button>
                  </div>
                  <div className="bg-surface-input rounded-lg border border-gray-800 overflow-hidden">
                    {(rows.length > 0 || displayFields.length > 0) && (
                      // overflow-x-auto SOLO sulla tabella, non sul contenitore esterno (che
                      // deve restare overflow-hidden per gli angoli arrotondati) — con molte
                      // colonne, e ancora di più quando "Aggiungi riga" sostituisce celle di
                      // sola lettura con input/select più larghi, la tabella può superare la
                      // larghezza del pannello. Prima il contenitore la tagliava silenziosamente
                      // (overflow-hidden ovunque): l'ultima colonna — il bottone Salva della riga
                      // in aggiunta — spariva del tutto invece di restare raggiungibile scorrendo.
                      <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        {displayFields.length > 0 && (
                          <thead>
                            <tr className="border-b border-gray-800">
                              {displayFields.map((f) => (
                                <th key={f.key} className="px-3 py-1.5 text-left text-[10px] text-gray-600 font-medium">{f.label}</th>
                              ))}
                              {cRelations.slice(0, 2).map((r) => (
                                <th key={r.key} className="px-3 py-1.5 text-left text-[10px] text-gray-600 font-medium">{r.label}</th>
                              ))}
                              {computedFields.map((f) => (
                                <th key={f.key} className="px-3 py-1.5 text-left text-[10px] text-gray-600 font-medium">{f.label}</th>
                              ))}
                              <th className="px-2 py-1.5 w-6"></th>
                            </tr>
                          </thead>
                        )}
                        <tbody>
                          {rows.map((cr) => {
                            const isEditingThisRow = childEditingRow[c.module_slug] === cr.id
                            const editForm = childEditForms[c.module_slug] || {}
                            if (isEditingThisRow) {
                              return (
                                <tr key={cr.id} className="border-b border-accent/40 bg-blue-950/20">
                                  {displayFields.map((f) => (
                                    <td key={f.key} className="px-1.5 py-1.5">
                                      {renderChildFieldInput(f, editForm[f.key], (v) => setChildEditForms((p) => ({ ...p, [c.module_slug]: { ...(p[c.module_slug] || {}), [f.key]: v } })))}
                                    </td>
                                  ))}
                                  {cRelations.slice(0, 2).map((r) => {
                                    const relData = childRelatedRecs[r.target_module]
                                    return (
                                      <td key={r.key} className="px-1.5 py-1.5">
                                        {relData ? (
                                          <Select
                                            value={editForm[r.key] || ''}
                                            onChange={(v) => setChildEditForms((p) => ({ ...p, [c.module_slug]: { ...(p[c.module_slug] || {}), [r.key]: v } }))}
                                            placeholder={r.label + '...'}
                                            options={relData.records.map((rec) => ({ value: rec.id, label: relData.byId[rec.id] || '#' + rec.id }))}
                                          />
                                        ) : (
                                          <input type="text" className="w-full bg-surface-input text-ink px-2 py-1 rounded text-xs outline-none border border-gray-700 focus:border-accent"
                                            placeholder={r.label} value={editForm[r.key] || ''}
                                            onChange={(e) => setChildEditForms((p) => ({ ...p, [c.module_slug]: { ...(p[c.module_slug] || {}), [r.key]: e.target.value } }))} />
                                        )}
                                      </td>
                                    )
                                  })}
                                  {computedFields.map((f) => (
                                    <td key={f.key} className="px-3 py-2 text-gray-500 font-mono text-[10px]">{cr.data[f.key] !== undefined && cr.data[f.key] !== null ? String(cr.data[f.key]) : '—'}</td>
                                  ))}
                                  <td className="px-1.5 py-1.5 whitespace-nowrap">
                                    <button onClick={() => saveChildRowEdit(c)} disabled={!!childSaving[c.module_slug]} className="text-green-400 hover:text-green-300 disabled:opacity-50 transition mr-1.5"><Icon name="check" size={13} /></button>
                                    <button onClick={() => cancelEditingChildRow(c)} className="text-gray-500 hover:text-gray-300 transition"><Icon name="x" size={13} /></button>
                                  </td>
                                </tr>
                              )
                            }
                            return (
                              <tr key={cr.id} className="border-b border-gray-800/50 last:border-0 hover:bg-gray-900/30 group">
                                {displayFields.map((f) => (
                                  <td key={f.key} className="px-3 py-2 text-gray-300">{cr.data[f.key] !== undefined && cr.data[f.key] !== null ? String(cr.data[f.key]) : ''}</td>
                                ))}
                                {cRelations.slice(0, 2).map((r) => (
                                  <td key={r.key} className="px-3 py-2 text-gray-500 text-[10px]">{cr.data[r.key] ? '#' + cr.data[r.key] : ''}</td>
                                ))}
                                {computedFields.map((f) => (
                                  <td key={f.key} className="px-3 py-2 text-gray-400 font-mono">{cr.data[f.key] !== undefined && cr.data[f.key] !== null ? String(cr.data[f.key]) : '—'}</td>
                                ))}
                                <td className="px-2 py-2 whitespace-nowrap">
                                  <button onClick={() => startEditingChildRow(c, cr)} className="text-gray-600 hover:text-accent transition mr-2 opacity-0 group-hover:opacity-100"><Icon name="edit" size={11} /></button>
                                  <button onClick={() => deleteChildRow(c, cr.id)} className="text-red-400/40 hover:text-red-400 transition"><Icon name="trash" size={11} /></button>
                                </td>
                              </tr>
                            )
                          })}
                          {isAddingRow && (
                            <tr className="border-t border-green-800/40 bg-green-950/20">
                              {displayFields.map((f) => (
                                <td key={f.key} className="px-1.5 py-1.5">
                                  {f.type === 'select' ? (
                                    <Select
                                      value={addForm[f.key] || ''}
                                      onChange={(v) => setChildAddForms((p) => ({ ...p, [c.module_slug]: { ...(p[c.module_slug] || {}), [f.key]: v } }))}
                                      options={(f.options || []).map((o) => (typeof o === 'object' ? o : { value: o, label: o }))}
                                    />
                                  ) : f.type === 'boolean' || f.type === 'checkbox' ? (
                                    <input type="checkbox" checked={!!addForm[f.key]} onChange={(e) => setChildAddForms((p) => ({ ...p, [c.module_slug]: { ...(p[c.module_slug] || {}), [f.key]: e.target.checked } }))} className="ml-1" />
                                  ) : f.type === 'file' ? (
                                    <div>
                                      <input type="file" className="w-full text-[10px] text-gray-400 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:bg-gray-800 file:text-gray-300 file:text-[10px] hover:file:bg-gray-700 file:cursor-pointer cursor-pointer"
                                        onChange={(e) => uploadChildFile(c.module_slug, f.key, e.target.files[0])} />
                                      {childUploading[c.module_slug + '.' + f.key] && <div className="text-[10px] text-gray-500 mt-0.5">Caricamento...</div>}
                                      {addForm[f.key] && !childUploading[c.module_slug + '.' + f.key] && (
                                        <div className="text-[10px] text-green-400 mt-0.5 flex items-center gap-1 truncate"><Icon name="check" size={10} />{addForm[f.key].name}</div>
                                      )}
                                    </div>
                                  ) : (
                                    <input
                                      type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : f.type === 'time' ? 'time' : 'text'}
                                      className="w-full bg-surface-input text-ink px-2 py-1 rounded text-xs outline-none border border-gray-700 focus:border-green-500"
                                      placeholder={f.label}
                                      value={addForm[f.key] || ''}
                                      onChange={(e) => setChildAddForms((p) => ({ ...p, [c.module_slug]: { ...(p[c.module_slug] || {}), [f.key]: e.target.value } }))}
                                    />
                                  )}
                                </td>
                              ))}
                              {cRelations.slice(0, 2).map((r) => {
                                const relData = childRelatedRecs[r.target_module]
                                return (
                                  <td key={r.key} className="px-1.5 py-1.5">
                                    {relData ? (
                                      <Select
                                        value={addForm[r.key] || ''}
                                        onChange={(v) => setChildAddForms((p) => ({ ...p, [c.module_slug]: { ...(p[c.module_slug] || {}), [r.key]: v } }))}
                                        placeholder={r.label + '...'}
                                        options={relData.records.map((rec) => ({ value: rec.id, label: relData.byId[rec.id] || '#' + rec.id }))}
                                      />
                                    ) : (
                                      <input
                                        type="text"
                                        className="w-full bg-surface-input text-ink px-2 py-1 rounded text-xs outline-none border border-gray-700 focus:border-green-500"
                                        placeholder={r.label}
                                        value={addForm[r.key] || ''}
                                        onChange={(e) => setChildAddForms((p) => ({ ...p, [c.module_slug]: { ...(p[c.module_slug] || {}), [r.key]: e.target.value } }))}
                                      />
                                    )}
                                  </td>
                                )
                              })}
                              {computedFields.map((f) => <td key={f.key} className="px-1.5 py-1.5" />)}
                              <td className="px-1.5 py-1.5">
                                <button onClick={() => saveChildRow(c)} disabled={isSaving} className="text-green-400 hover:text-green-300 disabled:opacity-50 transition"><Icon name="check" size={13} /></button>
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                      </div>
                    )}
                    {rows.length === 0 && !isAddingRow && (
                      <div className="text-xs text-gray-600 p-3">Nessuna riga — usa &quot;Aggiungi riga&quot; per iniziare</div>
                    )}
                  </div>
                </div>
              )
            })}
          </>
        )}
    </FormDrawer>
  )
}

export default RecordDetailModal
