import React, { useState, useRef } from 'react'
import { API } from '../lib/api'
import useApi from '../lib/useApi'
import Icon from '../components/Icon'

function BackupPage({ token }) {
  const api = useApi(token)
  const [downloading, setDownloading] = useState(false)
  const [exportingJson, setExportingJson] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [restoreResult, setRestoreResult] = useState(null)
  const [confirmFile, setConfirmFile] = useState(null)
  const fileRef = useRef(null)

  const download = async () => {
    setDownloading(true)
    try {
      const res = await fetch(API + '/backup/download', { headers: { Authorization: 'Bearer ' + token } })
      if (!res.ok) { window.alert('Backup non riuscito'); return }
      const disposition = res.headers.get('Content-Disposition') || ''
      const match = disposition.match(/filename="([^"]+)"/)
      const filename = match ? match[1] : 'backup.db'
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setDownloading(false)
    }
  }

  const downloadJson = async () => {
    setExportingJson(true)
    try {
      const data = await api.get('/backup/export-json')
      if (!data) { window.alert('Export non riuscito'); return }
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `backup-${data.tenant}-${data.exported_at.slice(0, 19).replace(/[T:]/g, '-')}.json`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setExportingJson(false)
    }
  }

  const onPickFile = (e) => {
    const file = e.target.files[0]
    if (file) setConfirmFile(file)
  }

  const doRestore = async () => {
    if (!confirmFile) return
    setRestoring(true)
    setRestoreResult(null)
    try {
      const text = await confirmFile.text()
      const payload = JSON.parse(text)
      const { ok, data } = await api.post('/backup/import-json', payload)
      if (ok) {
        setRestoreResult({ success: true, ...data })
        window.dispatchEvent(new CustomEvent('platform:toast', { detail: { message: 'Ripristino completato', type: 'success' } }))
      } else {
        setRestoreResult({ success: false, error: data.error })
      }
    } catch (e) {
      setRestoreResult({ success: false, error: e.message })
    } finally {
      setRestoring(false)
      setConfirmFile(null)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const btnPrimary = 'w-full bg-accent hover:opacity-90 disabled:opacity-50 text-white py-2.5 rounded-lg transition font-medium flex items-center justify-center gap-2 text-sm'
  const btnSecondary = 'w-full bg-gray-800 hover:bg-gray-700 text-ink py-2.5 rounded-lg transition font-medium flex items-center justify-center gap-2 text-sm cursor-pointer'
  return (
    <>
      <div className="glass-panel p-5 flex flex-col">
        <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-accent/15 flex items-center justify-center flex-shrink-0"><Icon name="file" size={18} className="text-accent" /></div>
            <div>
              <div className="text-ink font-medium mb-0.5">Backup completo (.db)</div>
              <div className="text-sm text-gray-500">Il database intero: record, moduli, utenti e configurazioni.</div>
            </div>
          </div>
        <div className="mt-auto pt-5 space-y-2">
          <button onClick={download} disabled={downloading} className={btnPrimary}>
            <Icon name="file" size={14} />{downloading ? 'Download in corso...' : 'Scarica backup'}
          </button>
        </div>
      </div>

      <div className="glass-panel p-5 flex flex-col">
        <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-accent/15 flex items-center justify-center flex-shrink-0"><Icon name="upload" size={18} className="text-accent" /></div>
            <div>
              <div className="text-ink font-medium mb-0.5">Esporta e ripristina (JSON)</div>
              <div className="text-sm text-gray-500">Moduli con schema, record e allegati; ripristinabile su un tenant nuovo. Esclude utenti e password.</div>
            </div>
          </div>
        <div className="mt-auto pt-5 space-y-2">
          <button onClick={downloadJson} disabled={exportingJson} className={btnPrimary}>
            <Icon name="download" size={14} />{exportingJson ? 'Export in corso...' : 'Esporta JSON'}
          </button>
          <input ref={fileRef} type="file" accept="application/json" onChange={onPickFile} className="hidden" id="restore-file-input" />
          <label htmlFor="restore-file-input" className={btnSecondary}>
            <Icon name="file" size={14} />Ripristina da file...
          </label>
        </div>
      </div>

      {confirmFile && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-surface-card rounded-md p-6 w-full max-w-md border border-red-900/50">
            <h2 className="text-lg font-bold text-ink mb-2">Ripristinare da backup?</h2>
            <p className="text-sm text-red-400 mb-4">Attenzione: i record dei moduli presenti in "{confirmFile.name}" verranno sovrascritti, e se il file contiene allegati anche tutti quelli attuali verranno sostituiti. L'operazione non è reversibile.</p>
            <div className="flex gap-3">
              <button onClick={() => { setConfirmFile(null); if (fileRef.current) fileRef.current.value = '' }} className="flex-1 bg-gray-800 hover:bg-gray-700 text-white py-3 rounded-lg transition">Annulla</button>
              <button onClick={doRestore} disabled={restoring} className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white py-3 rounded-lg transition font-medium">
                {restoring ? 'Ripristino...' : 'Conferma ripristino'}
              </button>
            </div>
          </div>
        </div>
      )}

      {restoreResult && (
        <div className={'col-span-full rounded-xl border p-4 text-sm ' + (restoreResult.success ? 'bg-green-900/20 border-green-800 text-green-400' : 'bg-red-900/20 border-red-800 text-red-400')}>
          {restoreResult.success
            ? `Ripristinati ${restoreResult.recordRipristinati} record su ${restoreResult.moduliInteressati} moduli (${restoreResult.moduliCreati} moduli nuovi creati)`
              + (restoreResult.uploadsRipristinati || restoreResult.uploadsFalliti
                ? ` — allegati: ${restoreResult.uploadsRipristinati || 0} ripristinati` + (restoreResult.uploadsFalliti ? `, ${restoreResult.uploadsFalliti} falliti` : '') + '.'
                : '.')
            : `Errore: ${restoreResult.error}`}
        </div>
      )}
    </>
  )
}

export default BackupPage
