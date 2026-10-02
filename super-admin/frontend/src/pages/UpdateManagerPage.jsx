import React, { useEffect, useState } from 'react'
import { API } from '../lib/api'
import Icon from '../components/Icon'
import Select from '../components/Select'

// ─── UPDATE MANAGER ─────────────────────────────────────────────────────────────
// Workflow pensato per una struttura con molti tenant: si valida un aggiornamento
// a mano su UN tenant di prova (redeploy immediato, mirato), poi — solo se va bene
// — lo si mette in coda per la propagazione notturna a TUTTI i tenant attivi
// (update-scheduler.js nel backend, gira all'ora configurata). Nessun riavvio di
// massa nel mezzo della giornata, nessun secret copiato a mano in uno script.
//
// Tutto ciò che riguarda "cosa è vero adesso" (immagine caricata, chi l'ha già
// presa) viene letto dal vivo da Docker via GET /update-manager (vedi backend) —
// mai da uno stato salvato che potrebbe essere disallineato dalla realtà. Causa
// diretta: un incidente reale in cui un retag manuale dimenticato ha lasciato
// :latest fermo per ore senza che nulla se ne accorgesse (vedi STATO_LAVORI.md).

const ACTION_LABELS = {
  'tenant.redeploy': 'Redeploy singolo',
  'tenant.redeploy_all': 'Propagazione a tutti',
  'update_manager.image_import': 'Immagine caricata',
  'update_manager.rollback': 'Rollback',
}

const timeAgo = (iso) => {
  if (!iso) return ''
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'proprio ora'
  if (mins < 60) return mins + ' min fa'
  const hours = Math.floor(mins / 60)
  if (hours < 24) return hours + ' or' + (hours === 1 ? 'a' : 'e') + ' fa'
  const days = Math.floor(hours / 24)
  return days + ' giorn' + (days === 1 ? 'o' : 'i') + ' fa'
}

// Riusata sia per la voce più recente in "Storico" (espansa) sia per quella che
// prima viveva ad hoc in fondo alla sezione "Propaga a tutti" — stessa forma dati
// (details.results di un tenant.redeploy_all), un solo posto dove renderla.
function RedeployResultsList({ results }) {
  return (
    <div className="space-y-1">
      {results.map((r) => (
        <div key={r.slug} className="flex items-center justify-between text-xs font-mono">
          <span className="text-gray-400">{r.slug}</span>
          {r.ok ? <span className="text-cp-success flex items-center gap-1"><Icon name="check" size={11} /> aggiornato</span>
            : r.skipped === 'active_session' ? <span className="text-cp-warning">saltato — sessione attiva</span>
            : r.skipped === 'auto_update_disabled' ? <span className="text-gray-500">escluso</span>
            : <span className="text-cp-danger">{r.error || 'errore'}</span>}
        </div>
      ))}
    </div>
  )
}

function UpdateManagerPage({ token }) {
  const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }
  const [status, setStatus] = useState(null)
  const [history, setHistory] = useState([])
  const [historyLimit, setHistoryLimit] = useState(10)
  const [expandedHistoryId, setExpandedHistoryId] = useState(null)
  const [importing, setImporting] = useState(false)
  const [importMsg, setImportMsg] = useState(null)
  const [rollingBack, setRollingBack] = useState(false)
  const [rollbackMsg, setRollbackMsg] = useState(null)

  const loadStatus = async () => {
    const res = await fetch(API + '/update-manager', { headers })
    if (res.ok) setStatus(await res.json())
  }
  const loadHistory = async (limit) => {
    const res = await fetch(API + '/update-manager/history?limit=' + (limit || historyLimit), { headers })
    if (res.ok) {
      const data = await res.json()
      setHistory(data)
      const firstBatch = data.find((h) => h.action === 'tenant.redeploy_all')
      if (firstBatch) setExpandedHistoryId(firstBatch.id)
    }
  }
  const changeHistoryLimit = (limit) => {
    setHistoryLimit(limit)
    loadHistory(limit)
  }

  useEffect(() => { loadStatus(); loadHistory() }, [])

  const exportUrl = API + '/update-manager/export?token=' + encodeURIComponent(token)

  const importImage = async (file) => {
    if (!file) return
    setImporting(true); setImportMsg(null)
    const form = new FormData()
    form.append('image', file)
    try {
      const res = await fetch(API + '/update-manager/import', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: form })
      const data = await res.json()
      setImporting(false)
      setImportMsg(res.ok
        ? { ok: true, text: 'Immagine caricata e attivata come platform-core:latest' + (data.current_image ? ' — ' + data.current_image.short_id : '') + '.' }
        : { ok: false, text: data.error || 'Errore' })
      if (res.ok) { loadStatus(); loadHistory() }
    } catch (e) {
      setImporting(false)
      setImportMsg({ ok: false, text: e.message })
    }
  }

  const rollback = async () => {
    setRollingBack(true); setRollbackMsg(null)
    const res = await fetch(API + '/update-manager/rollback', { method: 'POST', headers })
    const data = await res.json()
    setRollingBack(false)
    setRollbackMsg(res.ok
      ? { ok: true, text: 'Tornato alla versione precedente (' + data.current_image.short_id + '). I tenant devono essere ridistribuiti (redeploy) per ricevere davvero l\'immagine ripristinata.' }
      : { ok: false, text: data.error || 'Errore' })
    if (res.ok) { loadStatus(); loadHistory() }
  }

  const currentImage = status && status.current_image
  const previousImage = status && status.previous_image

  return (
    <div>
      <h1 className="text-lg font-bold text-ink tracking-[-0.35px] mb-1">Update Manager</h1>
      <p className="text-gray-500 text-sm mb-6">Prepara qui la nuova immagine platform-core, poi ridistribuiscila ai tenant da qui o dalla pagina Tenant.</p>

      <div className="bg-surface-card rounded-md border border-gray-800 p-5 mb-6">
        <div className="text-xs font-semibold text-ink mb-1">Immagine platform-core</div>
        <p className="text-xs text-gray-500 mb-3">Pensato per più server, ciascuno col proprio Super Admin: scarica l'immagine aggiornata da qui e caricala nell'Update Manager dell'altro server — nessun trasferimento manuale via SSH.</p>
        <div className="flex items-center gap-3 flex-wrap mb-4">
          <a href={exportUrl} className="text-sm bg-gray-800 hover:bg-gray-700 text-white px-4 py-2 rounded-lg transition font-medium inline-flex items-center gap-2">
            <Icon name="download" size={14} /> Scarica ultima immagine (.tar.gz)
          </a>
          <label className="text-sm bg-cp-primary hover:bg-cp-primary-hover text-white px-4 py-2 rounded-lg transition font-medium cursor-pointer inline-flex items-center gap-2">
            <Icon name="upload" size={14} /> {importing ? 'Caricamento...' : 'Carica immagine (.tar.gz)'}
            <input type="file" accept=".tar.gz,.gz" className="hidden" disabled={importing} onChange={(e) => importImage(e.target.files[0])} />
          </label>
        </div>
        {importMsg && (
          <div className={'mb-4 text-xs p-3 rounded-lg ' + (importMsg.ok ? 'bg-cp-success-bg text-cp-success' : 'bg-cp-warning-bg text-cp-warning')}>
            {importMsg.text}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="bg-surface-page border border-gray-800 rounded-lg p-3">
            <div className="text-[11px] text-gray-500 mb-1.5">Immagine corrente (:latest)</div>
            {currentImage ? (
              <div className="text-sm text-gray-300">
                <span className="font-mono text-ink">{currentImage.short_id}</span>
                <div className="text-[11px] text-gray-500 mt-0.5">creata {timeAgo(currentImage.created)} · {currentImage.size_mb} MB</div>
              </div>
            ) : (
              <div className="text-xs text-gray-600">Nessuna immagine platform-core:latest trovata su questo host.</div>
            )}
          </div>
          <div className="bg-surface-page border border-gray-800 rounded-lg p-3">
            <div className="text-[11px] text-gray-500 mb-1.5">Versione precedente (rollback)</div>
            {previousImage ? (
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm text-gray-300">
                  <span className="font-mono text-ink">{previousImage.short_id}</span>
                  <div className="text-[11px] text-gray-500 mt-0.5">creata {timeAgo(previousImage.created)}</div>
                </div>
                <button onClick={rollback} disabled={rollingBack} className="text-xs bg-cp-warning-bg hover:opacity-80 disabled:opacity-50 text-cp-warning px-3 py-1.5 rounded-lg transition flex items-center gap-1.5 flex-shrink-0">
                  <Icon name="refresh" size={11} />{rollingBack ? 'Ripristino...' : 'Rollback'}
                </button>
              </div>
            ) : (
              <div className="text-xs text-gray-600">Nessun rollback disponibile — verrà creato automaticamente al prossimo aggiornamento rilevato.</div>
            )}
          </div>
        </div>
        {rollbackMsg && (
          <div className={'mt-3 text-xs p-3 rounded-lg ' + (rollbackMsg.ok ? 'bg-cp-success-bg text-cp-success' : 'bg-cp-warning-bg text-cp-warning')}>
            {rollbackMsg.text}
          </div>
        )}
      </div>

      <div className="bg-surface-card rounded-md border border-gray-800 p-5">
        <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
          <div className="text-xs font-semibold text-ink flex items-center gap-2"><Icon name="activity" size={14} />Storico</div>
          <Select className="w-32" value={historyLimit} onChange={changeHistoryLimit}
            options={[{ value: 10, label: 'Ultimi 10' }, { value: 25, label: 'Ultimi 25' }, { value: 50, label: 'Ultimi 50' }, { value: 100, label: 'Ultimi 100' }]} />
        </div>
        <p className="text-xs text-gray-500 mb-3">Ultime azioni dell'Update Manager — redeploy singoli, propagazioni notturne, immagini caricate, rollback.</p>
        {history.length === 0 ? (
          <div className="text-xs text-gray-600">Nessuna azione registrata ancora.</div>
        ) : (
          <div className="divide-y divide-gray-800/70 border border-gray-800 rounded-lg overflow-hidden">
            {history.map((h) => {
              const isBatch = h.action === 'tenant.redeploy_all'
              const expanded = expandedHistoryId === h.id
              return (
                <div key={h.id} className="px-3 py-2.5">
                  <div className={'flex items-center justify-between gap-3 flex-wrap text-xs ' + (isBatch ? 'cursor-pointer' : '')}
                    onClick={() => isBatch && setExpandedHistoryId(expanded ? null : h.id)}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-gray-300 font-medium">{ACTION_LABELS[h.action] || h.action}</span>
                      {h.target && <span className="text-gray-600 font-mono">{h.target}</span>}
                      <span className="text-gray-600">· {h.actor}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-gray-600">{timeAgo(h.created_at)}</span>
                      {isBatch && <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={12} />}
                    </div>
                  </div>
                  {isBatch && expanded && h.details && h.details.results && (
                    <div className="mt-2 pt-2 border-t border-gray-800/70">
                      <RedeployResultsList results={h.details.results} />
                    </div>
                  )}
                  {h.action === 'update_manager.image_import' && h.details && (
                    <div className="mt-1 text-[11px] text-gray-600 font-mono">{h.details.loaded_ref} · {h.details.size_mb} MB</div>
                  )}
                  {h.action === 'tenant.redeploy' && h.details && h.details.forced && (
                    <div className="mt-1 text-[11px] text-amber-500">forzato</div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export default UpdateManagerPage
