import React, { useState } from 'react'
import useApi from '../lib/useApi'
import Icon from '../components/Icon'
import Select from '../components/Select'
import { parseSchemaFrontend } from '../lib/schema-v3-frontend'

// Stesso formato CSV di nico (Blob con BOM, ';' come separatore, campi tra virgolette
// con "" per l'escape) — ma generico su qualunque modulo del tenant invece di 5
// export hardcoded, coerente con "ogni nuova capacità va costruita riusabile da
// qualsiasi modulo/tenant".
function toCSV(rows, columns) {
  const esc = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"'
  const header = columns.map((c) => esc(c.label)).join(';')
  const lines = rows.map((r) => columns.map((c) => esc(r[c.key])).join(';'))
  return [header, ...lines].join('\r\n')
}

function downloadCSV(filename, csv) {
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function todayISO() { return new Date().toISOString().slice(0, 10) }

// Export e Backup uniti in una pagina sola (2026-08-29, richiesto esplicitamente
// dall'utente) — prima due voci di menu separate per due modi diversi di portare
// via/al sicuro gli stessi dati del tenant. Backup resta un tab visibile solo agli
// admin (stesso gate che aveva da solo, prima invariato in App.jsx), Export resta
// visibile a chiunque lo vedesse già (nessuna restrizione nuova).
function ExportDatiPage({ token, modules, user }) {
  const api = useApi(token)
  const [slug, setSlug] = useState('')
  const [exporting, setExporting] = useState(false)

  const exportable = modules.filter((m) => m.slug !== 'dashboard').sort((a, b) => a.name.localeCompare(b.name))

  const doExport = async () => {
    if (!slug) return
    setExporting(true)
    const mod = modules.find((m) => m.slug === slug)
    const schema = parseSchemaFrontend(mod.schema_json)
    const records = await api.get('/records/' + slug)
    if (!records) { setExporting(false); return }

    // Risolvo le relazioni al valore leggibile (display_field o, in mancanza, il
    // primo campo testuale del modulo target) invece di esportare l'id grezzo.
    const relLookups = {}
    for (const rel of schema.relations || []) {
      const targetMod = modules.find((m) => m.slug === rel.target_module)
      if (!targetMod) continue
      const targetRecords = await api.get('/records/' + rel.target_module)
      if (!targetRecords) continue
      const targetSchema = parseSchemaFrontend(targetMod.schema_json)
      const dispField = rel.display_field || (targetSchema.fields.find((f) => f.type === 'text') || {}).key
      const map = {}
      targetRecords.forEach((r) => { map[r.id] = dispField ? r.data[dispField] : ('#' + r.id) })
      relLookups[rel.key] = map
    }

    const columns = [
      { key: '_id', label: 'ID' },
      ...(schema.fields || []).filter((f) => f.type !== 'computed' || true).map((f) => ({ key: f.key, label: f.label })),
      ...(schema.relations || []).map((r) => ({ key: r.key, label: r.label })),
      { key: '_stato', label: 'Stato' },
      { key: '_created_at', label: 'Creato il' },
    ]
    const rows = records.map((r) => {
      const row = { _id: r.id, _stato: r.data._stato || '', _created_at: r.created_at }
      ;(schema.fields || []).forEach((f) => { row[f.key] = r.data[f.key] })
      ;(schema.relations || []).forEach((rel) => { row[rel.key] = relLookups[rel.key] ? (relLookups[rel.key][r.data[rel.key]] ?? '') : (r.data[rel.key] ?? '') })
      return row
    })

    downloadCSV(`platform-${slug}-${todayISO()}.csv`, toCSV(rows, columns))
    setExporting(false)
  }

  return (
    <div className="bg-surface-card rounded-md p-5 border border-gray-800 flex flex-col">
      <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-accent/15 flex items-center justify-center flex-shrink-0"><Icon name="download" size={18} className="text-accent" /></div>
            <div>
              <div className="text-ink font-medium mb-0.5">Esporta in CSV</div>
              <div className="text-sm text-gray-500">Tutti i record di un modulo, con le relazioni risolte al valore leggibile.</div>
            </div>
          </div>
      <div className="mt-auto pt-5 space-y-2">
        <Select value={slug} onChange={setSlug} placeholder="Seleziona modulo..."
          options={exportable.map((m) => ({ value: m.slug, label: m.name }))} />
        <button onClick={doExport} disabled={!slug || exporting}
          className="w-full bg-accent hover:opacity-90 disabled:opacity-50 text-white py-2.5 rounded-lg transition font-medium flex items-center justify-center gap-2 text-sm">
          <Icon name="download" size={14} />{exporting ? 'Esportazione...' : 'Esporta CSV'}
        </button>
      </div>
    </div>
  )
}

export default ExportDatiPage
