import React, { useState, useEffect, useCallback, useRef } from 'react'
import MappaOSM from '../../components/MappaOSM'
import { API, openUploadedFile } from '../../lib/api'
const toast = (message, type = 'success') => window.dispatchEvent(new CustomEvent('platform:toast', { detail: { message, type } }))
import useApi from '../../lib/useApi'
import Icon from '../../components/Icon'
import Tile from '../../components/Tile'
import FormDrawer from '../../components/FormDrawer'
import Select from '../../components/Select'
import FieldEditorInput from './FieldEditorInput'
import { parseSchemaFrontend } from '../../lib/schema-v3-frontend'
import { requisitiDallo } from '../../lib/requisiti-stato'
import AbbinamentiSezione from '../../components/AbbinamentiSezione'

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

// Un modulo può puntare a questo record con PIÙ relazioni (es. Trattative: «Venditore» e «Acquirente» verso lo stesso Cliente). Prima erano due voci uguali («Trattative 1» due volte)
// e la seconda cancellava le righe della prima. Ora è UNA voce per modulo che tiene tutte le relazioni (`relation_keys`) e unisce le righe, senza doppioni.
function unisciPerModulo(lista) {
  const per = new Map()
  for (const c of lista) {
    const e = per.get(c.module_slug)
    if (e) { e.relation_keys.push(c.relation_key); e.relation_labels.push(c.relation_label) } else per.set(c.module_slug, { ...c, relation_keys: [c.relation_key], relation_labels: [c.relation_label] })
  }
  return [...per.values()]
}
async function caricaRigheFiglie(api, c, recordId) {
  const liste = await Promise.all((c.relation_keys || [c.relation_key]).map((k) => api.get('/records/' + c.module_slug + '?rel=' + k + '&value=' + recordId)))
  if (liste.every((l) => !l)) return null
  const viste = new Set(), out = []
  for (const l of liste) for (const r of Array.isArray(l) ? l : []) if (!viste.has(r.id)) { viste.add(r.id); out.push(r) }
  return out
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
    api.get('/records/' + mod.slug + '/' + recordId).then((data) => {
      if (cancelled || !data) return
      setRecord(data)
    })
    api.get('/modules/' + mod.slug + '/children-modules').then((data) => { if (!cancelled && data) setChildren(unisciPerModulo(data)) })
    if (!cancelled && allegatiConfig) {
      api.get('/records/' + mod.slug + '/' + recordId + '/attachments').then((data) => { if (!cancelled && data) setAttachments(data) })
    }
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mod.slug, recordId])

  useEffect(() => {
    children.forEach((c) => {
      caricaRigheFiglie(api, c, recordId).then((data) => { if (data) setChildData((p) => ({ ...p, [c.module_slug]: data })) })
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
    caricaRigheFiglie(api, c, recordId).then((data) => { if (data) setChildData((p) => ({ ...p, [c.module_slug]: data })) })
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
        className="w-full min-w-0 max-w-full bg-surface-input text-ink px-2 py-1 rounded text-xs outline-none border border-gray-700 focus:border-accent"
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
    const res = await api.del('/records/' + mod.slug + '/' + recordId)
    const n = res.data && res.data.righe_collegate_eliminate
    if (n) toast('Eliminato anche ' + n + ' record' + (n === 1 ? '' : 'i') + ' collegat' + (n === 1 ? 'o' : 'i') + ' non ancora completat' + (n === 1 ? 'o' : 'i'))
    onClose()
    if (onDeleted) onDeleted()
  }

  // Azioni esterne (blocco `external_action` del modulo, dichiarato dal pacchetto del verticale o dal Builder): un pulsante sul record che chiama un servizio
  // esterno tramite un adattatore e scrive l'esito sul record. Il blocco dice come si chiama, quale connessione serve, quali campi servono, dove sta l'esito e con
  // quale vista mostrarlo (VISTE_AZIONE): qui non ci sono nomi di moduli né di servizi.
  const azioniEsterne = (schema && schema.external_actions) || []
  const [inEsecuzione, setInEsecuzione] = useState(null) // chiave dell'azione in corso
  const [vistaAperta, setVistaAperta] = useState({}) // l'esito di un'azione si mostra in una sezione chiusa; si apre da sola dopo averla eseguita
  // Perché un'azione non può partire (una frase, visibile in cima alla scheda e non solo in un avviso che sparisce): { testo, azione? }
  const [avviso, setAvviso] = useState(null)
  // Le connessioni che le azioni richiedono sono collegate? (null = non lo so ancora). Lo si dice prima, non dopo un errore.
  const [connessioni, setConnessioni] = useState(null)
  const connessioniRichieste = [...new Set(azioniEsterne.map((az) => az.connection).filter(Boolean))].join(',')
  useEffect(() => {
    if (!connessioniRichieste) return
    api.get('/connections').then((list) => { if (Array.isArray(list)) setConnessioni(Object.fromEntries(connessioniRichieste.split(',').map((id) => [id, !!(list.find((c) => c.id === id) || {}).connected]))) })
  }, [connessioniRichieste]) // eslint-disable-line react-hooks/exhaustive-deps
  const datoPresente = (d, k) => d[k] !== undefined && d[k] !== null && d[k] !== ''
  // Il costo da confermare prima di una richiesta a pagamento (lo chiede il server con un 409): { az, nome, costo, noto, ambiente, speso_mese, tetto }
  const [confermaCosto, setConfermaCosto] = useState(null)
  const euro = (n) => Number(n).toLocaleString('it-IT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 })
  const eseguiAzione = async (az, conferma = false) => {
    const d = (record && record.data) || {}
    if (az.adapter === 'da_attivare') { setConfermaCosto(null); setAvviso({ testo: '«' + az.label + '» è da attivare' + (az.servizio_richiesto ? ': serve ' + az.servizio_richiesto : '') + '. ' + (az.come_attivare || 'Quando il servizio è attivo, la funzione parte da qui senza altre modifiche.') }); return }
    if (Array.isArray(az.richiede_uno_di) && az.richiede_uno_di.length && !az.richiede_uno_di.some((k) => datoPresente(d, k))) { setAvviso({ testo: az.richiede_messaggio || 'Mancano dei dati per «' + az.label + '»: compilali da «Modifica» e riprova.', azione: 'modifica' }); return }
    if (az.connection && connessioni && connessioni[az.connection] === false) { setAvviso({ testo: 'La connessione «' + az.connection + '» non è collegata: senza di lei «' + az.label + '» non può partire. Si collega da Impostazioni → Connessioni.' }); return }
    setAvviso(null); setConfermaCosto(null)
    setInEsecuzione(az.key)
    const res = await api.post('/records/' + mod.slug + '/' + recordId + '/azione/' + az.key, { conferma })
    setInEsecuzione(null)
    if (!res.ok && res.data && res.data.code === 'conferma_costo') { setConfermaCosto({ az, ...res.data }); return }
    if (!res.ok) { setAvviso({ testo: '«' + az.label + '» non è riuscita: ' + ((res.data && res.data.error) || 'errore sconosciuto') + '.' }); return }
    setRecord(res.data.record)
    setVistaAperta((p) => ({ ...p, [az.key]: true }))
    toast(az.label + ': fatto')
    if (onSaved) onSaved(res.data.record)
  }
  // PDF dell'esito di un'azione: nasce sul server da ciò che è già salvato sul record (nessuna nuova chiamata al servizio).
  const scaricaAzionePdf = async (az) => {
    const r = await fetch(API + '/records/' + mod.slug + '/' + recordId + '/azione/' + az.key + '/pdf', { method: 'POST', headers: { Authorization: 'Bearer ' + token } })
    if (!r.ok) { const j = await r.json().catch(() => ({})); toast(j.error || 'Creazione del PDF non riuscita', 'error'); return }
    const url = URL.createObjectURL(await r.blob())
    const a = document.createElement('a')
    a.href = url; a.download = az.key + '-' + recordId + '.pdf'
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  }

  // Documenti da modello (blocco `document_action` del modulo, dichiarato dal Builder). Due
  // passi distinti perché il testo generato va rivisto PRIMA dell'invio ("mostrato a schermo
  // che verifica con possibilità di modifica da parte dell'utente admin", richiesto dal vivo):
  // «anteprima» riempie la bozza e non spedisce nulla, «invia» manda esattamente il testo nel
  // riquadro (che l'admin può aver modificato). Il destinatario lo decide il server.
  const documenti = (schema && schema.document_actions) || []
  const [docInPreparazione, setDocInPreparazione] = useState(null) // chiave del documento in corso
  const [inviandoDoc, setInviandoDoc] = useState(false)
  const [bozzaDoc, setBozzaDoc] = useState(null) // { key, label, icon, oggetto, corpo, destinatario } oppure null = pannello chiuso
  // Il pannello del documento si apre sotto il report e gli abbinamenti, fuori schermo: appena si apre ci si porta lì.
  const pannelloDocRef = useRef(null)
  useEffect(() => { if (bozzaDoc && pannelloDocRef.current) pannelloDocRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, [bozzaDoc && bozzaDoc.key]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Scheda leggibile: i campi vuoti si nascondono, i campi con una «sezione» si raggruppano (la prima aperta, le altre chiuse), i «dati chiave» stanno in alto ──
  const [mostraVuoti, setMostraVuoti] = useState(false)
  const [gruppiAperti, setGruppiAperti] = useState({})
  const [menuFunz, setMenuFunz] = useState(false)
  const [menuDoc, setMenuDoc] = useState(false)
  const valoreVuoto = (f) => { const v = record && record.data ? record.data[f.key] : undefined; return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0) }
  const campiRiempiti = fields.filter((f) => !valoreVuoto(f))
  const nVuoti = fields.length - campiRiempiti.length
  const gruppiCampi = (() => {
    const out = [], indice = new Map()
    for (const f of (mostraVuoti ? fields : campiRiempiti)) {
      const nome = typeof f.sezione === 'string' ? f.sezione.trim() : ''
      if (!indice.has(nome)) { indice.set(nome, out.length); out.push({ nome, campi: [] }) }
      out[indice.get(nome)].campi.push(f)
    }
    return out
  })()
  const gruppoAperto = (g, i) => (gruppiAperti[g.nome] !== undefined ? gruppiAperti[g.nome] : i === 0)
  const datiChiave = fields.filter((f) => f.dato_chiave && !valoreVuoto(f))
  const formatoChiave = (f, v) => { const n = Number(v); if ((f.type === 'date' || f.type === 'datetime') && /^\d{4}-\d{2}-\d{2}/.test(String(v))) { const t = String(v); const g = t.slice(8, 10) + '/' + t.slice(5, 7) + '/' + t.slice(0, 4); return f.type === 'datetime' && t.length >= 16 ? g + ' ' + t.slice(11, 16) : g } if (f.type === 'computed' && !isNaN(n)) return n.toLocaleString('it-IT', { maximumFractionDigits: 2, useGrouping: 'always' }); if (f.type === 'currency' && !isNaN(n)) return n.toLocaleString('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }); if (f.type === 'number' && !isNaN(n)) return n.toLocaleString('it-IT'); return Array.isArray(v) ? v.join(', ') : String(v) }
  const apriDocumento = async (az) => {
    setDocInPreparazione(az.key)
    const res = await api.post('/records/' + mod.slug + '/' + recordId + '/documento/' + az.key + '/anteprima', {})
    setDocInPreparazione(null)
    if (!res.ok) { setAvviso({ testo: 'Non riesco a preparare «' + az.label + '»: ' + ((res.data && res.data.error) || 'errore sconosciuto') + '.' }); return }
    setAvviso(null)
    const consensi = {}
    ;(az.consents || []).forEach((c) => { consensi[c.field] = !!(record && record.data && record.data[c.field]) })
    setBozzaDoc({ key: az.key, label: az.label, icon: az.icon || 'mail', oggetto: res.data.oggetto, corpo: res.data.corpo, destinatario: res.data.destinatario, firma: az.delivery === 'firma', consents: az.consents || [], consensi, signedType: az.signed_type || az.key + '_firmato', file: null })
  }

  // Documento da firmare: si scarica il PDF del testo approvato, si firma su carta, si ricarica la
  // scansione/foto e si registrano i consensi spuntati sul foglio (data, versione e scadenza dei dati
  // le calcola il server dal documento).
  const [lavorandoFirma, setLavorandoFirma] = useState(false)
  const scaricaPdf = async () => {
    setLavorandoFirma(true)
    try {
      const r = await fetch(API + '/records/' + mod.slug + '/' + recordId + '/documento/' + bozzaDoc.key + '/pdf', {
        method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ corpo: bozzaDoc.corpo }),
      })
      if (!r.ok) { const j = await r.json().catch(() => ({})); toast(j.error || 'Creazione del PDF non riuscita', 'error'); return }
      const url = URL.createObjectURL(await r.blob())
      const a = document.createElement('a')
      a.href = url; a.download = bozzaDoc.key + '-' + recordId + '.pdf'
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 2000)
    } finally { setLavorandoFirma(false) }
  }
  const registraFirmato = async () => {
    if (!bozzaDoc.file) { toast('Scegli prima il file firmato (PDF o foto)', 'error'); return }
    setLavorandoFirma(true)
    try {
      const body = new FormData()
      body.append('file', bozzaDoc.file)
      const up = await fetch(API + '/uploads', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body })
      if (!up.ok) { const j = await up.json().catch(() => ({})); toast(j.error || 'Caricamento non riuscito', 'error'); return }
      const uploaded = await up.json()
      const res = await api.post('/records/' + mod.slug + '/' + recordId + '/documento/' + bozzaDoc.key + '/firmato', { upload_id: uploaded.id, consensi: bozzaDoc.consensi })
      if (!res.ok) { toast((res.data && res.data.error) || 'Registrazione non riuscita', 'error'); return }
      const fatto = bozzaDoc
      setBozzaDoc(null)
      toast('«' + fatto.label + '» firmato registrato' + (res.data.stato_aggiornato ? ' — stato del record aggiornato' : ''))
      const r = await api.get('/records/' + mod.slug + '/' + recordId)
      if (r) { setRecord(r); if (onSaved) onSaved(r) }
      loadAttachments()
    } finally { setLavorandoFirma(false) }
  }
  const inviaDocumento = async () => {
    setInviandoDoc(true)
    const res = await api.post('/records/' + mod.slug + '/' + recordId + '/documento/' + bozzaDoc.key + '/invia', { oggetto: bozzaDoc.oggetto, corpo: bozzaDoc.corpo })
    setInviandoDoc(false)
    if (!res.ok) { toast((res.data && res.data.error) || 'Invio non riuscito', 'error'); return }
    const inviato = bozzaDoc
    setBozzaDoc(null)
    toast(res.data.stato_aggiornato ? '«' + inviato.label + '» inviato — stato del record aggiornato' : '«' + inviato.label + '» inviato')
    // api.get restituisce direttamente il record (o null), non {ok, data}: prima qui si controllava r.ok e il record non si ricaricava mai dopo l'invio.
    const r = await api.get('/records/' + mod.slug + '/' + recordId)
    if (r) { setRecord(r); if (onSaved) onSaved(r) }
  }

  return (
    <FormDrawer
      title={mod.name + ' — dettaglio'}
      onClose={editing ? () => setEditing(false) : onClose}
      wide
      headerExtra={(
        <>
          {!editing && record && azioniEsterne.filter((az) => az.adapter !== 'da_attivare').map((az) => (
            <button key={az.key} onClick={() => eseguiAzione(az)} disabled={inEsecuzione !== null} title={az.descrizione || undefined} className={'text-xs border border-gray-700 hover:border-accent text-accent rounded-lg px-3 py-2 min-h-[36px] whitespace-nowrap flex items-center gap-1.5 flex-shrink-0 disabled:opacity-50 transition' + (az.adapter === 'da_attivare' || (az.connection && connessioni && connessioni[az.connection] === false) ? ' opacity-60' : '')}>
              <Icon name={az.icon || 'sparkles'} size={12} />{inEsecuzione === az.key ? 'Un attimo…' : az.label}
            </button>
          ))}
          {!editing && record && azioniEsterne.some((az) => az.adapter === 'da_attivare') && (
            <div className="relative flex-shrink-0">
              <button onClick={() => setMenuFunz((x) => !x)} aria-haspopup="menu" aria-expanded={menuFunz} className="text-xs border border-gray-700 hover:border-accent text-accent rounded-lg px-3 py-2 min-h-[36px] whitespace-nowrap flex items-center gap-1.5 flex-shrink-0 disabled:opacity-50 transition"><Icon name="sparkles" size={12} />Altre funzioni<Icon name="chevron-down" size={11} /></button>
              {menuFunz && (
                <div role="menu" className="fixed left-3 right-3 top-auto mt-1 z-30 sm:absolute sm:left-auto sm:right-0 sm:top-full sm:w-80 bg-surface-card border border-gray-700 rounded-lg shadow-lg py-1">
                  <div className="px-3 py-1.5 text-[11px] text-gray-500">Previste, ma legate a un servizio esterno ancora da attivare.</div>
                  {azioniEsterne.filter((az) => az.adapter === 'da_attivare').map((az) => (
                    <button key={az.key} role="menuitem" onClick={() => { setMenuFunz(false); eseguiAzione(az) }} className="w-full text-left px-3 py-2 hover:bg-white/5 transition flex items-start gap-2">
                      <Icon name={az.icon || 'sparkles'} size={13} className="mt-0.5 text-gray-500 flex-shrink-0" />
                      <span className="flex-1 min-w-0"><span className="block text-xs text-ink">{az.label} <span className="ml-1 text-[10px] uppercase tracking-wide bg-amber-400/15 border border-amber-500/50 text-ink rounded px-1.5 py-0.5">da attivare</span></span><span className="block text-[11px] text-gray-500">{az.descrizione}</span></span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {!editing && record && !bozzaDoc && documenti.length === 1 && documenti.map((az) => (
            <button key={az.key} onClick={() => apriDocumento(az)} disabled={docInPreparazione !== null} title={az.delivery === 'firma' ? 'Si scarica il PDF da firmare e poi si ricarica la scansione firmata' : 'Prepara l\'email: il testo si rivede e si modifica prima di spedirla'} className="text-xs border border-gray-700 hover:border-accent text-accent rounded-lg px-3 py-2 min-h-[36px] whitespace-nowrap flex items-center gap-1.5 flex-shrink-0 disabled:opacity-50 transition">
              <Icon name={az.icon || 'mail'} size={12} />{docInPreparazione === az.key ? 'Preparo…' : az.label}{az.delivery !== 'firma' && docInPreparazione !== az.key && <span className="text-gray-500"> · email</span>}
            </button>
          ))}
          {!editing && record && !bozzaDoc && documenti.length > 1 && (
            <div className="relative">
              <button onClick={() => setMenuDoc((x) => !x)} disabled={docInPreparazione !== null} aria-haspopup="menu" aria-expanded={menuDoc} className="text-xs border border-gray-700 hover:border-accent text-accent rounded-lg px-3 py-2 min-h-[36px] whitespace-nowrap flex items-center gap-1.5 flex-shrink-0 disabled:opacity-50 transition">
                <Icon name="file" size={12} />{docInPreparazione !== null ? 'Preparo…' : 'Documenti'}<Icon name="chevron-down" size={11} />
              </button>
              {menuDoc && (
                <div role="menu" className="fixed left-3 right-3 top-auto mt-1 z-30 sm:absolute sm:left-auto sm:right-0 sm:top-full sm:min-w-[260px] bg-surface-card border border-gray-700 rounded-lg shadow-lg py-1">
                  {documenti.map((az) => (
                    <button key={az.key} role="menuitem" onClick={() => { setMenuDoc(false); apriDocumento(az) }} className="w-full text-left px-3 py-2 hover:bg-white/5 transition flex items-start gap-2">
                      <Icon name={az.icon || 'mail'} size={13} className="mt-0.5 text-accent flex-shrink-0" />
                      <span><span className="block text-xs text-ink">{az.label}</span><span className="block text-[11px] text-gray-500">{az.delivery === 'firma' ? 'PDF da firmare, poi si ricarica la scansione' : 'Email da rivedere prima di spedirla'}</span></span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {!editing && record && <button onClick={startEditing} className="text-xs border border-gray-700 hover:border-accent text-accent rounded-lg px-3 py-2 min-h-[36px] whitespace-nowrap flex items-center gap-1.5 flex-shrink-0 disabled:opacity-50 transition"><Icon name="edit" size={12} />Modifica</button>}
          {!editing && record && canDelete && <button onClick={remove} className="text-xs border border-gray-700 hover:border-red-400 text-red-400/80 hover:text-red-400 rounded-lg px-3 py-2 min-h-[36px] whitespace-nowrap flex items-center gap-1.5 flex-shrink-0 transition"><Icon name="trash" size={12} />Elimina</button>}
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
            {confermaCosto && (
              <div className="bg-accent/10 border border-accent/30 text-xs p-3 rounded-lg mb-4" role="alertdialog" aria-label="Conferma del costo">
                <div className="font-semibold text-ink mb-1">{confermaCosto.az.label}: conferma il costo</div>
                <div className="mb-2 leading-snug text-gray-400">
                  {confermaCosto.ambiente === 'prova'
                    ? 'Sei in ambiente di prova: la richiesta non si paga' + (confermaCosto.noto ? '. In produzione costerebbe circa ' + euro(confermaCosto.costo) + ' (listino, IVA esclusa).' : '. In produzione il prezzo non è indicato.')
                    : confermaCosto.noto
                      ? 'La richiesta costa circa ' + euro(confermaCosto.costo) + ' (listino, IVA esclusa). Spesa del mese: ' + euro(confermaCosto.speso_mese) + (confermaCosto.tetto ? ' su un tetto di ' + euro(confermaCosto.tetto) : '') + '.'
                      : 'Il prezzo di questa richiesta non è indicato nel listino: si registra a 0 € finché non lo scrivi in Impostazioni → Connessioni → OpenAPI.it. Spesa del mese: ' + euro(confermaCosto.speso_mese) + '.'}
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={() => eseguiAzione(confermaCosto.az, true)} className="bg-accent hover:opacity-90 text-white px-3 py-1.5 rounded-lg font-medium">Procedi</button>
                  <button type="button" onClick={() => setConfermaCosto(null)} className="bg-gray-800 hover:bg-gray-700 text-gray-200 px-3 py-1.5 rounded-lg">Annulla</button>
                </div>
              </div>
            )}
            {avviso && (
              <div className="bg-amber-400/15 border border-amber-500/50 text-ink text-xs p-3 rounded-lg mb-4 flex items-start gap-2" role="alert">
                <span className="flex-1">{avviso.testo}</span>
                {avviso.azione === 'modifica' && <button onClick={() => { setAvviso(null); startEditing() }} className="underline text-accent flex-shrink-0">Modifica</button>}
                <button onClick={() => setAvviso(null)} aria-label="Chiudi l'avviso" className="flex-shrink-0 opacity-70 hover:opacity-100"><Icon name="x" size={12} /></button>
              </div>
            )}
            {bozzaDoc && (
              <div ref={pannelloDocRef} className="glass-panel p-4 mb-5 border-accent/30">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-xs font-semibold text-ink flex items-center gap-1.5"><Icon name={bozzaDoc.icon} size={13} />{bozzaDoc.label} — {bozzaDoc.firma ? 'rivedi, scarica, firma e ricarica' : 'rivedi o modifica prima di inviare'}</span>
                </div>
                {!bozzaDoc.firma && (<>
                <label className="text-xs text-gray-400 block mb-1">Oggetto</label>
                <input value={bozzaDoc.oggetto} onChange={(e) => setBozzaDoc({ ...bozzaDoc, oggetto: e.target.value })}
                  className="w-full bg-surface-page border border-gray-800 rounded-lg px-3 py-2 text-sm text-ink mb-3" />
                </>)}
                <label className="text-[10px] uppercase tracking-[0.14em] text-accent font-semibold block mb-1.5">Testo del documento</label>
                <textarea value={bozzaDoc.corpo} onChange={(e) => setBozzaDoc({ ...bozzaDoc, corpo: e.target.value })} rows={16}
                  className="w-full bg-surface-page border border-gray-800 focus:border-accent/60 outline-none rounded-xl px-4 py-3 text-[13px] text-gray-200 leading-[1.7] mb-1 resize-y" />
                <div className="text-[10px] text-gray-600 mb-3">Le righe tutte in maiuscolo diventano sezioni del PDF; «Etichetta: valore» diventa un campo con la riga per scrivere; «[ ] testo» una casella.</div>
                {bozzaDoc.firma ? (
                  <>
                    <div className="flex gap-2 mb-4">
                      <button onClick={() => setBozzaDoc(null)} className="flex-1 bg-gray-800 hover:bg-gray-700 text-white py-2 rounded-lg transition text-sm">Chiudi</button>
                      <button onClick={scaricaPdf} disabled={lavorandoFirma} className="flex-1 bg-accent hover:opacity-90 disabled:opacity-50 text-white py-2 rounded-lg transition text-sm font-medium flex items-center justify-center gap-1.5"><Icon name="download" size={13} />Scarica PDF da firmare</button>
                    </div>
                    <div className="border-t border-gray-800 pt-3">
                      <div className="text-xs font-semibold text-ink mb-2">Documento firmato</div>
                      {attachments.filter((a) => a.tipo === bozzaDoc.signedType).length > 0 && (
                        <div className="text-xs text-gray-400 mb-2">Già registrati: {attachments.filter((a) => a.tipo === bozzaDoc.signedType).map((a) => a.original_name + ' (' + String(a.created_at).slice(0, 10) + ')').join(', ')}</div>
                      )}
                      {bozzaDoc.consents.length > 0 && (
                        <div className="mb-3">
                          <div className="text-xs text-gray-400 mb-1.5">Consensi dati sul foglio firmato</div>
                          {bozzaDoc.consents.map((c) => (
                            <label key={c.field} className="flex items-center gap-2 text-sm text-gray-200 mb-1 cursor-pointer">
                              <input type="checkbox" checked={!!bozzaDoc.consensi[c.field]} onChange={(e) => setBozzaDoc({ ...bozzaDoc, consensi: { ...bozzaDoc.consensi, [c.field]: e.target.checked } })} />
                              {c.label || c.field}
                            </label>
                          ))}
                        </div>
                      )}
                      <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => setBozzaDoc({ ...bozzaDoc, file: (e.target.files && e.target.files[0]) || null })}
                        className="w-full text-xs text-gray-300 mb-3 file:mr-3 file:rounded-lg file:border-0 file:bg-gray-800 file:px-3 file:py-2 file:text-white" />
                      <button onClick={registraFirmato} disabled={lavorandoFirma || !bozzaDoc.file} className="w-full bg-accent hover:opacity-90 disabled:opacity-50 text-white py-2 rounded-lg transition text-sm font-medium">{lavorandoFirma ? 'Un attimo…' : 'Registra documento firmato'}</button>
                    </div>
                  </>
                ) : (
                  <>
                    {bozzaDoc.destinatario
                      ? <div className="text-xs text-gray-400 mb-3">Sarà spedito a <span className="text-ink">{bozzaDoc.destinatario}</span></div>
                      : <div className="text-xs text-red-400 mb-3">Non c'è un indirizzo email a cui spedirlo: aggiungilo al record (o al record collegato) da "Modifica" prima di inviare.</div>}
                    <div className="flex gap-2">
                      <button onClick={() => setBozzaDoc(null)} className="flex-1 bg-gray-800 hover:bg-gray-700 text-white py-2 rounded-lg transition text-sm">Annulla</button>
                      <button onClick={inviaDocumento} disabled={inviandoDoc || !bozzaDoc.destinatario} className="flex-1 bg-accent hover:opacity-90 disabled:opacity-50 text-white py-2 rounded-lg transition text-sm font-medium">{inviandoDoc ? 'Invio…' : 'Invia via email'}</button>
                    </div>
                  </>
                )}
              </div>
            )}
            {workflow && workflow.states.length > 1 && (
              <div className="flex flex-wrap items-center gap-1.5 mb-4 text-xs" aria-label="Percorso dello stato">
                {workflow.states.map((st, i) => {
                  const attuale = st.key === record.data._stato
                  return (
                    <React.Fragment key={st.key}>
                      {i > 0 && <Icon name="chevron-right" size={11} className="text-gray-600" />}
                      <span className={attuale ? 'px-2.5 py-1 rounded-lg font-medium' : 'text-gray-500'} style={attuale ? { backgroundColor: (st.color || '#6B7280') + '26', color: st.color || '#9CA3AF' } : undefined}>{st.label}</span>
                    </React.Fragment>
                  )
                })}
              </div>
            )}
            {workflow && requisitiDallo(record.data._stato, workflow, schema && schema.state_requirements, record.data, attachments).map((r) => (
              <div key={r.stato} className={'rounded-lg border p-3 mb-4 text-xs ' + (r.pronto ? 'bg-green-500/10 border-green-500/40' : 'bg-amber-400/15 border-amber-500/50')}>
                <div className="font-semibold text-ink mb-1.5">
                  {r.pronto ? 'Tutto pronto per passare a «' + r.label + '»' : 'Per passare a «' + r.label + '» manca'}
                  {r.bloccante && !r.pronto && <span className="font-normal text-gray-400"> · senza, il passaggio non è permesso</span>}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {r.voci.map((v) => (
                    <span key={v.label} className={'flex items-center gap-1 ' + (v.ok ? 'text-gray-500' : 'text-ink font-medium')}>
                      <Icon name={v.ok ? 'check' : 'x'} size={11} className={v.ok ? 'text-green-500' : 'text-amber-500'} />{v.label}
                    </span>
                  ))}
                </div>
              </div>
            ))}
            {datiChiave.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
                {datiChiave.map((f) => {
                  const testo = formatoChiave(f, record.data[f.key])
                  return (
                    <div key={f.key} className={'bg-surface-page rounded-lg p-3 border border-gray-800 min-w-0' + (String(testo).length > 18 ? ' col-span-2' : '')}>
                      <div className="text-[11px] text-gray-500">{f.label}</div>
                      <div className="text-base font-semibold text-ink break-words">{testo}</div>
                    </div>
                  )
                })}
              </div>
            )}
            {children.some((c) => (childData[c.module_slug] || []).length > 0) && (
              <div className="mb-4 bg-surface-page border border-gray-800 rounded-lg px-3 py-2.5">
                <div className="text-xs font-semibold text-gray-400 mb-1.5 flex items-center gap-1.5"><Icon name="link" size={11} />Collegati</div>
                <div className="flex flex-wrap gap-x-5 gap-y-1">
                  {children.filter((c) => (childData[c.module_slug] || []).length > 0).map((c) => (
                    <button key={c.module_slug} type="button" onClick={() => { setOpenSection('child:' + c.module_slug); setTimeout(() => { const el = document.getElementById('collegati-' + c.module_slug); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, 50) }}
                      className="text-sm text-ink hover:text-accent transition flex items-center gap-1.5">
                      <Icon name={c.module_icon || 'box'} size={12} className="text-gray-500" />{c.module_name} <span className="text-accent font-semibold">{(childData[c.module_slug] || []).length}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {((schema && schema.map_views) || []).map((mv) => {
              const indirizzo = (mv.campi || []).map((k) => record.data[k]).filter((v) => (typeof v === 'string' && v.trim()) || typeof v === 'number').join(', ')
              return indirizzo ? <MappaOSM key={mv.key || mv.label} token={token} titolo={mv.label} indirizzo={indirizzo} paese={mv.paese} /> : null
            })}
            {azioniEsterne.map((az) => {
              const voce = az.vista && VISTE_AZIONE[az.vista]
              const esito = az.risultato_in && record.data[az.risultato_in]
              if (!voce || !esito) return null
              const C = az.campi || {}, aperta = !!vistaAperta[az.key], Vista = voce.Vista
              return (
                <div key={az.key} className="mb-4">
                  <button type="button" onClick={() => setVistaAperta((p) => ({ ...p, [az.key]: !aperta }))} aria-expanded={aperta}
                    className="w-full text-left bg-surface-page border border-gray-800 rounded-lg px-3 py-2.5 flex items-center gap-2 hover:border-gray-600 transition">
                    <Icon name={aperta ? 'chevron-down' : 'chevron-right'} size={13} className="text-gray-500 flex-shrink-0" />
                    <Icon name={az.icon || 'sparkles'} size={13} className="text-accent flex-shrink-0" />
                    <span className="text-sm font-semibold text-ink flex-shrink-0">{az.label}</span>
                    <span className="text-xs text-gray-500 truncate">{voce.sintesi ? voce.sintesi(esito, record.data, az) : ''}</span>
                  </button>
                  {aperta && (
                    <div className="mt-2">
                      <Vista report={esito} dati={record.data} campi={C} titolo={record.data[C.titolo]} indirizzo={[C.indirizzo, C.comune, C.provincia].map((k) => record.data[k]).filter(Boolean).join(', ')} onPdf={az.pdf ? () => scaricaAzionePdf(az) : null} />
                    </div>
                  )}
                </div>
              )
            })}
            <AbbinamentiSezione api={api} slug={mod.slug} recordId={recordId} definizioni={schema && schema.match_views} />
            <div className="space-y-2 mb-5">
              {gruppiCampi.map((g, gi) => (
                <div key={g.nome || '_'} className="space-y-2">
                  {g.nome && (
                    <button type="button" onClick={() => setGruppiAperti((p) => ({ ...p, [g.nome]: !gruppoAperto(g, gi) }))} aria-expanded={gruppoAperto(g, gi)}
                      className="w-full flex items-center gap-1.5 text-xs font-semibold text-gray-400 hover:text-gray-200 transition pt-2">
                      <Icon name={gruppoAperto(g, gi) ? 'chevron-down' : 'chevron-right'} size={12} />{g.nome}<span className="text-gray-600 font-normal">· {g.campi.length}</span>
                    </button>
                  )}
                  {(!g.nome || gruppoAperto(g, gi)) && g.campi.map((f) => (
                <div key={f.key} className="flex items-center justify-between text-sm border-b border-gray-800/60 pb-2">
                  <span className="text-gray-500">{f.label}{f.type === 'computed' && <span className="text-gray-700"> (calcolato)</span>}</span>
                  <span className={'text-gray-200 text-right break-words min-w-0 ml-4' + (f.type === 'encrypted' ? ' font-mono' : '')}>
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
                </div>
              ))}
              {nVuoti > 0 && (
                <button type="button" onClick={() => setMostraVuoti((x) => !x)} className="text-xs text-accent hover:opacity-80 transition pt-1">
                  {mostraVuoti ? 'Nascondi i campi vuoti' : 'Mostra anche i ' + nVuoti + (nVuoti === 1 ? ' campo vuoto' : ' campi vuoti')}
                </button>
              )}
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
                <div key={c.module_slug} id={'collegati-' + c.module_slug} className="mb-4 p-3 rounded-lg bg-surface-page border border-gray-800">
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
                                  <td key={f.key} className="px-3 py-2 text-gray-300">
                                    {f.type === 'file'
                                      ? (cr.data[f.key] && cr.data[f.key].id
                                          ? <button onClick={() => openUploadedFile(cr.data[f.key], token)} className="text-accent hover:opacity-80 transition flex items-center gap-1"><Icon name="file" size={11} />{cr.data[f.key].name}</button>
                                          : '')
                                      : f.type === 'boolean' || f.type === 'checkbox'
                                      ? (cr.data[f.key] ? <Icon name="check" size={12} /> : '')
                                      : (cr.data[f.key] !== undefined && cr.data[f.key] !== null ? String(cr.data[f.key]) : '')}
                                  </td>
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
                        </tbody>
                      </table>
                      </div>
                    )}
                    {rows.length === 0 && !isAddingRow && (
                      <div className="text-xs text-gray-600 p-3">Nessuna riga — usa &quot;Aggiungi riga&quot; per iniziare</div>
                    )}
                    {/* "Aggiungi riga" a schede impilate (un campo per riga, etichetta sopra), non più dentro la
                       tabella: su mobile, con 4-5 colonne, una riga di <td> stretti schiacciava i controlli l'uno
                       sull'altro (il menu "Seleziona..." del Tipo copriva il resto del form) — segnalato
                       dall'utente il 29/10 ("allegare un file è complicato"). Stesso identico stato/logica di
                       prima, solo il contenitore cambia. */}
                    {isAddingRow && (
                      <div className="p-3 border-t border-green-800/40 bg-green-950/20 space-y-2.5">
                        {displayFields.map((f) => (
                          <div key={f.key}>
                            <label className="text-[10px] text-gray-500 block mb-1">{f.label}</label>
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
                                <input type="file" className="w-full text-xs text-gray-400 file:mr-2 file:py-1.5 file:px-3 file:rounded file:border-0 file:bg-gray-800 file:text-gray-300 file:text-xs hover:file:bg-gray-700 file:cursor-pointer cursor-pointer"
                                  onChange={(e) => uploadChildFile(c.module_slug, f.key, e.target.files[0])} />
                                {childUploading[c.module_slug + '.' + f.key] && <div className="text-[10px] text-gray-500 mt-0.5">Caricamento...</div>}
                                {addForm[f.key] && !childUploading[c.module_slug + '.' + f.key] && (
                                  <div className="text-xs text-green-400 mt-0.5 flex items-center gap-1 truncate"><Icon name="check" size={10} />{addForm[f.key].name}</div>
                                )}
                              </div>
                            ) : (
                              <input
                                type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : f.type === 'time' ? 'time' : 'text'}
                                className="w-full min-w-0 max-w-full bg-surface-input text-ink px-2 py-1.5 rounded text-xs outline-none border border-gray-700 focus:border-green-500"
                                placeholder={f.label}
                                value={addForm[f.key] || ''}
                                onChange={(e) => setChildAddForms((p) => ({ ...p, [c.module_slug]: { ...(p[c.module_slug] || {}), [f.key]: e.target.value } }))}
                              />
                            )}
                          </div>
                        ))}
                        {cRelations.slice(0, 2).map((r) => {
                          const relData = childRelatedRecs[r.target_module]
                          return (
                            <div key={r.key}>
                              <label className="text-[10px] text-gray-500 block mb-1">{r.label}</label>
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
                                  className="w-full bg-surface-input text-ink px-2 py-1.5 rounded text-xs outline-none border border-gray-700 focus:border-green-500"
                                  placeholder={r.label}
                                  value={addForm[r.key] || ''}
                                  onChange={(e) => setChildAddForms((p) => ({ ...p, [c.module_slug]: { ...(p[c.module_slug] || {}), [r.key]: e.target.value } }))}
                                />
                              )}
                            </div>
                          )
                        })}
                        <div className="flex gap-2 pt-1">
                          <button onClick={() => setChildAddingRow((p) => ({ ...p, [c.module_slug]: false }))} className="flex-1 bg-gray-800 hover:bg-gray-700 text-ink py-1.5 rounded text-xs transition">Annulla</button>
                          <button onClick={() => saveChildRow(c)} disabled={isSaving} className="flex-1 bg-green-600 hover:opacity-90 disabled:opacity-50 text-white py-1.5 rounded text-xs font-medium transition">{isSaving ? 'Salvo...' : 'Salva'}</button>
                        </div>
                      </div>
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

// Report della valutazione appena fatta (2026-11-01) — un pannello a schermo con i dati
// grezzi di OpenAPI.it messi in ordine, più una copia stampabile via window.print() dietro
// un portal su document.body (stesso meccanismo già in uso per la Guida dei verticali in
// components/VerticaliLibreria.jsx: solo quella porzione resta visibile quando si stampa).
// Non il report multi-pagina con mappe/foto di un concorrente — solo i numeri che OpenAPI.it
// restituisce davvero, onestamente presentati: niente inventato per sembrare più completo.
// Separatore delle migliaia sempre (anche a 4 cifre, che «it-IT» di solito non raggruppa): coerente col PDF.
function fmtNum(n) { return (n || n === 0) && !isNaN(Number(n)) ? String(Math.round(Number(n))).replace(/\B(?=(\d{3})+(?!\d))/g, '.') : '—' }
function fmtEuro(n) { return fmtNum(n) === '—' ? '—' : fmtNum(n) + ' €' }
// Barra orizzontale con etichetta e valore: la stessa lettura delle barre del PDF.
function BarraReport({ etichetta, valore, massimo, testo }) {
  return (
    <div className="flex items-center gap-2 text-[11px] py-[3px]">
      <span className="w-28 shrink-0 text-gray-500 truncate">{etichetta}</span>
      <div className="flex-1 h-2 rounded-full bg-gray-800/60 overflow-hidden"><div className="h-full rounded-full bg-accent" style={{ width: Math.max(3, Math.min(100, (valore / (massimo || 1)) * 100)) + '%' }} /></div>
      <span className="w-24 shrink-0 text-right text-ink font-medium">{testo}</span>
    </div>
  )
}

function SezioneReport({ titolo, sotto, children }) {
  return (
    <section className="rounded-xl border border-gray-800 bg-surface-page/60 p-3.5">
      <h4 className="text-[13px] font-semibold text-ink mb-0.5 flex items-center gap-2"><span className="w-1 h-3.5 rounded-full bg-accent" />{titolo}</h4>
      {sotto && <div className="text-[11px] text-gray-500 mb-2 ml-3">{sotto}</div>}
      <div className={sotto ? '' : 'mt-2'}>{children}</div>
    </section>
  )
}

const pctIt = (n) => (n == null || n === '' || isNaN(Number(n)) ? '—' : String(Math.round(Number(n) * 10) / 10).replace('.', ',') + '%')

// Report di valutazione: stessa struttura del PDF (riquadri con le quotazioni, valore stimato, considerazioni, tabelle e barre).
function ReportValutazione({ report, titolo, indirizzo, onPdf, dati = {}, campi = {} }) {
  const d = (report && report.dettaglio) || {}
  const q = d.quotazione || {}
  const med = parseFloat(String(q.med || '').replace(/[^0-9.]/g, '')) || null
  const demo = d.demografico || {}
  const mq = parseFloat(dati[campi.superficie]) || null
  const comparabili = (report && report.comparabili) || []
  const omiRow = report && report.omi
  const dinamicita = d.capoluoghi_vendite_zona && typeof d.capoluoghi_vendite_zona === 'object' ? Object.entries(d.capoluoghi_vendite_zona) : []
  const tempiVendita = Array.isArray(d.tempistiche) && Array.isArray(d.tempistiche[0]) ? d.tempistiche[0] : []
  const dimensioni = Array.isArray(d.dimensioni) ? d.dimensioni : []
  const ripartizione = (d.ripartizione_annunci && d.ripartizione_annunci.vendita) ? Object.values(d.ripartizione_annunci.vendita).sort((a, b) => b.percentuale - a.percentuale) : []
  const fotovoltaico = report && report.fotovoltaico
  const zonaSismicaUff = report && report.zonaSismicaUfficiale
  const considerazioni = report && report.considerazioni
  const norm = (x) => String(x || '').toLowerCase().replace(/[^a-zà-ú0-9]/g, '')
  const comuneRecord = dati[campi.comune]
  const altroLuogo = comuneRecord && d.citta && norm(comuneRecord) !== norm(d.citta)
  const pop = demo.pop || {}, stock = demo.stock || {}
  const territorio = [
    demo.rischio_sismico && ['Rischio sismico (OpenAPI.it)', demo.rischio_sismico],
    zonaSismicaUff && zonaSismicaUff.zona != null && ['Zona sismica ufficiale (ISPRA)', zonaSismicaUff.zona + (zonaSismicaUff.zona === 1 ? ' · alta' : zonaSismicaUff.zona === 4 ? ' · bassa' : '')],
    fotovoltaico && fotovoltaico.kwh_per_kwp_anno && ['Resa fotovoltaico (PVGIS)', Number(fotovoltaico.kwh_per_kwp_anno).toLocaleString('it-IT') + ' kWh/anno per kW'],
    fotovoltaico && fotovoltaico.irraggiamento_kwh_mq_anno && ['Irraggiamento medio', Number(fotovoltaico.irraggiamento_kwh_mq_anno).toLocaleString('it-IT') + ' kWh/m² all\'anno'],
  ].filter(Boolean)
  const zona = [
    demo.geo && demo.geo.nome_localita && ['Area', demo.geo.nome_localita],
    pop.media_componenti_famiglia && ['Componenti per famiglia', String(pop.media_componenti_famiglia).replace('.', ',') + ' (nuclei ' + (pop.dimensione_nuclei_familiari || '—') + ')'],
    pop.livello_anzianita && ['Età della popolazione', pop.livello_anzianita],
    pop.livello_istruzione && ['Istruzione', pop.livello_istruzione],
    pop.livello_disoccupazione && ['Disoccupazione', pop.livello_disoccupazione],
    stock.prc_abitazioni_di_proprieta && ['Abitazioni di proprietà', pctIt(stock.prc_abitazioni_di_proprieta)],
    stock.prc_abitazioni_vuote_o_2_case && ['Vuote o seconde case', pctIt(stock.prc_abitazioni_vuote_o_2_case)],
    stock.mq_abitazione_media && ['Superficie media abitazioni', Math.round(stock.mq_abitazione_media) + ' mq'],
  ].filter(Boolean)
  const coppie = (righe) => righe.map(([e, v]) => (
    <div key={e} className="flex justify-between gap-3 text-[11px] py-[3px] border-b border-gray-800/60 last:border-0"><span className="text-gray-500">{e}</span><span className="text-ink font-medium text-right">{v}</span></div>
  ))

  return (
    <div className="glass-panel p-4 mb-5 border-accent/30">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.14em] text-accent font-semibold flex items-center gap-1.5"><Icon name="sparkles" size={12} />Report di valutazione</div>
          <div className="text-ink text-lg font-semibold leading-tight mt-0.5 truncate" style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}>{titolo || 'Immobile'}</div>
          <div className="text-xs text-gray-500 truncate">{indirizzo || d.formatted}</div>
        </div>
        <button onClick={onPdf} className="shrink-0 text-xs px-3 py-1.5 rounded-lg bg-accent hover:opacity-90 text-white flex items-center gap-1.5 font-medium"><Icon name="download" size={12} />Scarica PDF</button>
      </div>

      {altroLuogo && (
        <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-300 text-[11px] px-3 py-2">
          I dati di mercato si riferiscono a «{d.formatted || d.citta}», che non coincide con il comune dell'immobile ({comuneRecord}). Controlla l'indirizzo e rifai la valutazione prima di usarli.
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 mb-2">
        {[['Minimo', q.min, false], ['Medio', med, true], ['Massimo', q.max, false]].map(([l, v, evid]) => (
          <div key={l} className={'rounded-xl p-3 border ' + (evid ? 'bg-accent border-accent text-white' : 'bg-surface-page border-gray-800')}>
            <div className={'text-[10px] uppercase tracking-wide ' + (evid ? 'text-white/70' : 'text-gray-500')}>{l} €/mq</div>
            <div className={'text-xl font-semibold mt-0.5 ' + (evid ? 'text-white' : 'text-ink')} style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}>{fmtNum(v)}</div>
          </div>
        ))}
      </div>
      {mq && med ? (
        <div className="rounded-xl border border-accent/50 px-3.5 py-2.5 mb-3 flex items-end justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-gray-500">Valore stimato · media × {mq.toLocaleString('it-IT')} mq</div>
            <div className="text-2xl font-semibold text-accent" style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}>{fmtEuro(Math.round(med * mq))}</div>
          </div>
          <div className="text-[11px] text-gray-500 text-right">Intervallo<br /><span className="text-ink font-medium">{fmtEuro(Math.round(q.min * mq))} – {fmtEuro(Math.round(q.max * mq))}</span></div>
        </div>
      ) : <div className="text-[11px] text-gray-500 italic mb-3">Valore stimato non calcolabile: manca la superficie dell'immobile.</div>}

      {considerazioni && (
        <blockquote className="mb-3 rounded-xl bg-surface-page border-l-[3px] border-accent px-3.5 py-2.5 text-xs text-gray-300 italic leading-relaxed">{considerazioni}</blockquote>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {omiRow && Array.isArray(omiRow.values) && omiRow.values.length > 0 && (
          <SezioneReport titolo="Quotazioni OMI" sotto={'Zona ' + (omiRow.omi_zone || '—') + (omiRow.zone && omiRow.zone.description ? ' · ' + omiRow.zone.description : '')}>
            <table className="w-full text-[11px]"><tbody>
              {omiRow.values.map((v, i) => (
                <tr key={i} className="border-b border-gray-800/60 last:border-0"><td className="py-1 text-gray-500">{v.property_type}</td><td className="py-1 text-right text-ink font-medium">{v.sale ? fmtNum(v.sale.min) + ' – ' + fmtNum(v.sale.max) : '—'}<span className="text-gray-600 font-normal"> €/mq</span></td></tr>
              ))}
            </tbody></table>
          </SezioneReport>
        )}
        <SezioneReport titolo="Comparabili nella zona">
          {comparabili.length > 0 ? (
            <table className="w-full text-[11px]"><tbody>
              {comparabili.slice(0, 8).map((c, i) => (
                <tr key={i} className="border-b border-gray-800/60 last:border-0"><td className="py-1 text-gray-500">{c.property_type || 'Immobile'}{c.total_sqm ? ' · ' + c.total_sqm + ' mq' : ''}<div className="text-[10px] text-gray-600">{c.municipality || ''}</div></td><td className="py-1 text-right text-ink font-medium">{fmtEuro(c.price)}{c.price_per_sqm ? <div className="text-[10px] text-gray-600 font-normal">{Math.round(c.price_per_sqm)} €/mq</div> : null}</td></tr>
              ))}
            </tbody></table>
          ) : <div className="text-[11px] text-gray-500 italic">Nessun annuncio comparabile trovato vicino a questo indirizzo.</div>}
        </SezioneReport>
        {dinamicita.length > 0 && (
          <SezioneReport titolo="Andamento del mercato" sotto="Abitazioni vendute ogni anno in zona">
            {dinamicita.map(([anno, v]) => <BarraReport key={anno} etichetta={anno + ' · ' + String(v.dinamicita_mercato_residenziale || '').toLowerCase()} valore={Number(v.numero_abitazioni_vendute) || 0} massimo={Math.max(...dinamicita.map(([, x]) => Number(x.numero_abitazioni_vendute) || 0), 1)} testo={v.numero_abitazioni_vendute + ' (' + (Number(v.perc_variazione_annuale) > 0 ? '+' : '') + pctIt(v.perc_variazione_annuale) + ')'} />)}
          </SezioneReport>
        )}
        {tempiVendita.length > 0 && (
          <SezioneReport titolo="Tempi medi di vendita" sotto="Per superficie dell'immobile">
            {tempiVendita.map((t, i) => <BarraReport key={i} etichetta={String(t.label).replace(/^(\d+) (\d+) Mq$/, '$1-$2 mq')} valore={Number(t.media_giorni) || 0} massimo={Math.max(...tempiVendita.map((x) => Number(x.media_giorni) || 0), 1)} testo={t.media_giorni + ' giorni'} />)}
          </SezioneReport>
        )}
        {ripartizione.length > 0 && (
          <SezioneReport titolo="Annunci in vendita per tipologia">
            {ripartizione.map((r, i) => <BarraReport key={i} etichetta={r.tipologia} valore={Number(r.percentuale) || 0} massimo={Math.max(...ripartizione.map((x) => Number(x.percentuale) || 0), 1)} testo={pctIt(r.percentuale)} />)}
          </SezioneReport>
        )}
        {dimensioni.length > 0 && (
          <SezioneReport titolo="Annunci per superficie">
            {dimensioni.map((x, i) => <BarraReport key={i} etichetta={x.label} valore={Number(x.percentuale) || 0} massimo={Math.max(...dimensioni.map((y) => Number(y.percentuale) || 0), 1)} testo={pctIt(x.percentuale)} />)}
          </SezioneReport>
        )}
        {territorio.length > 0 && <SezioneReport titolo="Territorio">{coppie(territorio)}</SezioneReport>}
        {zona.length > 0 && <SezioneReport titolo="La zona">{coppie(zona)}</SezioneReport>}
      </div>
      <div className="text-[10px] text-gray-600 mt-3">Stima indicativa su quotazioni medie di zona e dati pubblici (OpenAPI.it, OMI, ISPRA, PVGIS): non sostituisce una perizia.</div>
    </div>
  )
}

export default RecordDetailModal

// Le viste con cui mostrare l'esito di un'azione esterna (campo `vista` del blocco). Un elenco chiuso, come gli adattatori sul server.
function sintesiValutazione(report, dati, az) {
  const q = (report && report.dettaglio && report.dettaglio.quotazione) || {}
  const num = (v) => { const x = parseFloat(String(v == null ? '' : v).replace(/[^0-9.]/g, '')); return isNaN(x) ? null : x }
  const it = (x) => x.toLocaleString('it-IT', { maximumFractionDigits: 0, useGrouping: 'always' })
  const E = (az && az.esito) || {}
  const min = num(q.min), max = num(q.max), valore = parseFloat(dati[E.valore]), data = dati[E.data]
  return [min != null && max != null ? it(min) + '–' + it(max) + ' €/mq' : null, valore ? 'stima ' + it(valore) + ' €' : null, data ? String(data).slice(0, 10).split('-').reverse().join('/') : null].filter(Boolean).join(' · ')
}
const VISTE_AZIONE = { valutazione_immobiliare: { Vista: ReportValutazione, sintesi: sintesiValutazione } }
