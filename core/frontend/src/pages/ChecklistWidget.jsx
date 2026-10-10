import React, { useState, useEffect, useCallback } from 'react'
import useApi from '../lib/useApi'
import Icon from '../components/Icon'
import RecordDetailModal from './ModulePage/RecordDetailModal'
import { parseSchemaFrontend } from '../lib/schema-v3-frontend'

// Formatta un Date in 'YYYY-MM-DD' usando i campi LOCALI (getFullYear/getMonth/
// getDate), MAI toISOString(): quella converte in UTC prima di tagliare la stringa,
// quindi a mezzanotte locale in un fuso con offset positivo (es. CEST, UTC+2)
// restituisce il giorno PRECEDENTE — un record datato esattamente sul bordo della
// finestra spariva o appariva un giorno prima del previsto. Bug pre-esistente,
// silenzioso perché di un giorno solo; qui reso esplicito e corretto.
function isoLocal(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

// Finestra del "mese corrente" (1° all'ultimo giorno), in formato ISO — usata dal
// periodo 'questo_mese'. Calcolata lato client apposta: cambia ogni giorno, non ha
// senso salvarla nella config del widget, va ricalcolata ad ogni apertura.
// `cutoffDay` (2-28, opzionale) replica lo stesso pattern già usato da
// `meseTarget`/`giorno_cutoff` in DashboardPage.jsx per il widget "Riepilogo
// mensile": se oggi è al giorno di cutoff o oltre, il mese mostrato per intero è
// il PROSSIMO invece di quello corrente — utile per chi ha spese datate a fine
// mese (es. il 27-28, come le rate) e vuole iniziare a vederle in anticipo invece
// di aspettare che scocchi il 1°. Non è una finestra "dal giorno N al giorno N-1
// del successivo" (prima versione, sbagliata: tagliava fuori proprio le spese di
// fine mese che il cutoff avrebbe dovuto anticipare) — è sempre un mese di
// calendario intero, solo scelto in anticipo.
function currentMonthRange(cutoffDay, offset = 0) {
  const cutoff = cutoffDay >= 2 && cutoffDay <= 28 ? cutoffDay : null
  const now = new Date()
  let year = now.getFullYear()
  let month = now.getMonth()
  if (cutoff && now.getDate() >= cutoff) {
    month += 1
    if (month > 11) { month = 0; year += 1 }
  }
  // `offset` = mesi avanti (+) o indietro (-) rispetto al mese di partenza: serve alle frecce del widget.
  const from = new Date(year, month + offset, 1)
  const to = new Date(year, month + offset + 1, 0)
  return { from: isoLocal(from), to: isoLocal(to), label: from.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' }) }
}

// Widget "Checklist multi-modulo": combina i record di più moduli sorgente (ognuno
// con la propria convenzione di campo importo/stato/data, non un nome fisso) in
// un'unica lista spuntabile, filtrata per periodo. Lo spunta scrive SUBITO il record
// (PUT /:slug/:id sostituisce l'intero campo data — quindi qui si parte sempre dal
// record completo già caricato, non da un patch parziale, altrimenti si perderebbero
// gli altri campi al salvataggio).
// Trova la coppia di stati "on/off" di un workflow — stesso algoritmo già usato in
// ModulePage/index.jsx (quickToggle): cerca uno stato A e uno stato B con
// transizioni A->B E B->A entrambe definite, nessuna config aggiuntiva richiesta.
function findTogglePair(mod) {
  if (!mod) return null
  const schema = parseSchemaFrontend(mod.schema_json)
  const transitions = schema.workflow && schema.workflow.transitions
  if (!transitions) return null
  for (const t1 of transitions) {
    if (transitions.some((t2) => t2.from === t1.to && t2.to === t1.from)) return { off: t1.from, on: t1.to }
  }
  return null
}

// Campo scadenza (flag `scadenza: true` su un campo data) — stesso algoritmo
// generico già usato in ModulePage/index.jsx per colorare il cerchio per urgenza,
// qui riusato così il widget riflette lo stesso stato senza duplicarne la logica.
function findScadenzaField(mod) {
  if (!mod) return null
  const schema = parseSchemaFrontend(mod.schema_json)
  const fields = (schema && schema.fields) || []
  return fields.find((f) => f.scadenza && (f.type === 'date' || f.type === 'datetime')) || null
}

function formatAmount(n) {
  return n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'
}

function ChecklistWidget({ config, token, label, color, modules, user, onMese }) {
  const api = useApi(token)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState(null)
  const [detail, setDetail] = useState(null) // { module_slug, recordId } — riga aperta nel modal
  const [monthOffset, setMonthOffset] = useState(0) // frecce del mese: 0 = quello di partenza, -1 = il precedente...

  const sources = config?.sources || []
  const period = config?.period || 'tutti'
  const apriDettaglio = !!config?.apri_dettaglio
  // Per ogni modulo sorgente, se lo stato è "_stato" (workflow, non un checkbox
  // semplice) serve la coppia on/off per sapere verso quale stato transizionare —
  // stessa logica del toggle rapido già generico in ModulePage.
  const togglePairBySlug = {}
  const scadenzaFieldBySlug = {}
  // Solo per la scelta visiva cerchio-vs-checkbox — la logica di stato (isChecked/
  // toggle) resta sempre quella vera, quick_toggle=0 non deve romperla, cambia solo
  // come la riga si disegna (stesso principio del gate in ModulePage).
  const quickToggleDisabledBySlug = {}
  sources.forEach((s) => {
    if (s.status_field === '_stato') {
      const mod = modules.find((m) => m.slug === s.module_slug)
      togglePairBySlug[s.module_slug] = findTogglePair(mod)
      scadenzaFieldBySlug[s.module_slug] = findScadenzaField(mod)
      quickToggleDisabledBySlug[s.module_slug] = mod && mod.quick_toggle === 0
    }
  })
  const todayStr = new Date().toISOString().slice(0, 10)

  const load = useCallback(async () => {
    setLoading(true)
    let effectiveFrom = null, effectiveTo = null
    if (period === 'questo_mese') {
      const r = currentMonthRange(config?.giorno_cutoff, monthOffset)
      effectiveFrom = r.from; effectiveTo = r.to
    } else if (period === 'personalizzato') {
      effectiveFrom = config?.from || null
      effectiveTo = config?.to || null
    }

    const all = []
    for (const src of sources) {
      let path = '/records/' + src.module_slug
      if (src.date_field && (effectiveFrom || effectiveTo)) {
        const qs = new URLSearchParams()
        qs.set('date_field', src.date_field)
        if (effectiveFrom) qs.set('from', effectiveFrom)
        if (effectiveTo) qs.set('to', effectiveTo)
        path += '?' + qs.toString()
      }
      const records = await api.get(path)
      if (records) {
        records.forEach((r) => all.push({ ...r, _source: src }))
      }
    }

    // Ordine di lettura: dal più vecchio al più recente nel periodo — un record senza
    // valore nel campo data va in fondo, non deve rompere l'ordinamento degli altri.
    all.sort((a, b) => {
      const da = a.data[a._source.date_field]
      const db_ = b.data[b._source.date_field]
      if (!da && !db_) return 0
      if (!da) return 1
      if (!db_) return -1
      return new Date(da) - new Date(db_)
    })

    setRows(all)
    setLoading(false)
  }, [JSON.stringify(sources), period, config?.giorno_cutoff, config?.from, config?.to, monthOffset])

  useEffect(() => { load() }, [load])

  const isChecked = (row) => {
    const { status_field } = row._source
    if (status_field === '_stato') {
      const pair = togglePairBySlug[row._source.module_slug]
      return pair ? row.data._stato === pair.on : false
    }
    return !!row.data[status_field]
  }

  const toggle = async (row) => {
    const { module_slug, status_field } = row._source
    setSavingId(row.id)
    if (status_field === '_stato') {
      const pair = togglePairBySlug[module_slug]
      if (!pair) { setSavingId(null); return }
      const target = row.data._stato === pair.on ? pair.off : pair.on
      const result = await api.post('/records/' + module_slug + '/' + row.id + '/transition', { to: target })
      if (result.ok) {
        setRows((prev) => prev.map((r) => (r.id === row.id && r._source.module_slug === module_slug ? { ...r, data: { ...r.data, _stato: target } } : r)))
      }
    } else {
      const nextData = { ...row.data, [status_field]: !row.data[status_field] }
      const result = await api.put('/records/' + module_slug + '/' + row.id, nextData)
      if (result.ok) {
        setRows((prev) => prev.map((r) => (r.id === row.id && r._source.module_slug === module_slug ? { ...r, data: nextData } : r)))
      }
    }
    setSavingId(null)
  }

  const monthNav = period === 'questo_mese' ? currentMonthRange(config?.giorno_cutoff, monthOffset) : null
  // Dice alla dashboard quale mese stai guardando con le frecce (null = quello di partenza), così il Riepilogo si allinea.
  const meseVisto = monthNav && monthOffset !== 0 ? monthNav.from.slice(0, 7) : null
  useEffect(() => { if (onMese) onMese(meseVisto) }, [meseVisto]) // eslint-disable-line react-hooks/exhaustive-deps
  const moduleLabel = (slug) => (modules.find((m) => m.slug === slug) || {}).name || slug

  const totale = rows.reduce((s, r) => s + (parseFloat(r.data[r._source.amount_field]) || 0), 0)
  const daPagare = rows
    .filter((r) => !isChecked(r))
    .reduce((s, r) => s + (parseFloat(r.data[r._source.amount_field]) || 0), 0)

  return (
    <div>
      <div className="px-5 pt-4 pb-3 border-b border-gray-800 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="text-sm font-medium text-ink">{label}</div>
          {monthNav && (
            <div className="flex items-center gap-1 text-xs text-gray-400">
              <button type="button" onClick={() => setMonthOffset((o) => o - 1)} className="px-1.5 py-1 rounded hover:bg-gray-800" aria-label="Mese precedente"><Icon name="chevron-left" size={13} /></button>
              <span className="min-w-[110px] text-center capitalize text-gray-300">{monthNav.label}</span>
              <button type="button" onClick={() => setMonthOffset((o) => o + 1)} className="px-1.5 py-1 rounded hover:bg-gray-800" aria-label="Mese successivo"><Icon name="chevron-right" size={13} /></button>
              {monthOffset !== 0 && <button type="button" onClick={() => setMonthOffset(0)} className="ml-1 text-accent hover:underline">Torna a oggi</button>}
            </div>
          )}
        </div>
        <div className="flex items-center gap-4 text-xs">
          <div className="text-gray-500">Totale <span className="text-ink font-semibold">{formatAmount(totale)}</span></div>
          <div className="text-gray-500">Da pagare <span className="font-semibold" style={{ color }}>{formatAmount(daPagare)}</span></div>
        </div>
      </div>
      <div className="divide-y divide-gray-800 max-h-72 overflow-y-auto">
        {loading && <div className="px-5 py-6 text-sm text-gray-600">Caricamento…</div>}
        {!loading && rows.length === 0 && <div className="px-5 py-6 text-sm text-gray-600">Nessuna spesa nel periodo selezionato.</div>}
        {!loading && rows.map((r) => {
          const { module_slug, amount_field, status_field, date_field } = r._source
          const checked = isChecked(r)
          const amount = parseFloat(r.data[amount_field]) || 0
          const dateVal = date_field ? r.data[date_field] : null
          // Prima proprietà "leggibile" del record diversa da importo/stato/data, per
          // dare un'etichetta minima alla riga senza richiedere una configurazione
          // aggiuntiva di quale sia il "titolo" — pragmatico, non perfetto.
          const titleKey = Object.keys(r.data).find((k) => ![amount_field, status_field, date_field].includes(k) && typeof r.data[k] === 'string')
          const title = titleKey ? r.data[titleKey] : 'Spesa #' + r.id
          // Stesso cerchio colorato per urgenza già usato in ModulePage, riusato qui
          // solo per le sorgenti a workflow (_stato) — le altre restano un checkbox
          // semplice, non hanno una coppia di stati da cui dedurre "scaduto".
          const pair = status_field === '_stato' && !quickToggleDisabledBySlug[module_slug] ? togglePairBySlug[module_slug] : null
          const scadenzaField = pair ? scadenzaFieldBySlug[module_slug] : null
          const scaduto = pair && scadenzaField && !checked && r.data[scadenzaField.key] && r.data[scadenzaField.key] < todayStr
          const urgente = pair && scadenzaField && !scaduto && !checked && r.data[scadenzaField.key] &&
            Math.ceil((new Date(r.data[scadenzaField.key]) - new Date()) / 86400000) <= 3
          const checkbox = pair ? (
            <button onClick={() => toggle(r)} disabled={savingId === r.id}
              className="w-5 h-5 rounded-full flex items-center justify-center transition flex-shrink-0"
              style={{
                backgroundColor: checked ? '#10B981' : 'transparent',
                border: '2px solid ' + (checked ? '#10B981' : scaduto ? '#F87171' : urgente ? '#F59E0B' : '#374151'),
              }}
              title={checked ? 'Segna ' + pair.off : 'Segna ' + pair.on}>
              {checked && <Icon name="check" size={10} className="text-white" />}
            </button>
          ) : (
            <button onClick={() => toggle(r)} disabled={savingId === r.id}
              className={'w-4 h-4 rounded flex-shrink-0 border flex items-center justify-center transition ' + (checked ? 'bg-green-600 border-green-600' : 'border-gray-600 hover:border-gray-400')}>
              {checked && <Icon name="check" size={10} />}
            </button>
          )
          // Su schermi stretti checkbox+badge modulo+data+importo tutti sulla stessa
          // riga lasciavano al titolo pochi pixel — troncato a 1-2 caratteri (segnalato
          // dall'utente su mobile). Sotto sm: due righe (titolo+importo sopra, badge+
          // data sotto, indentati sotto il titolo); da sm in su torna una riga sola
          // identica a prima (il secondo blocco diventa inline via sm:flex-row).
          return (
            <div key={module_slug + '-' + r.id} className="px-5 py-2.5 flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 text-sm">
              <div className="flex items-center gap-3 min-w-0">
                {checkbox}
                <span
                  onClick={apriDettaglio ? () => setDetail({ module_slug, recordId: r.id }) : undefined}
                  className={'flex-1 min-w-0 truncate ' + (checked ? 'text-gray-500 line-through' : 'text-gray-300') + (apriDettaglio ? ' cursor-pointer hover:text-ink' : '')}>
                  {title}
                </span>
                <span className="text-sm font-medium text-gray-300 flex-shrink-0 sm:hidden">{formatAmount(amount)}</span>
              </div>
              <div className="flex items-center gap-2 pl-8 sm:pl-0 flex-shrink-0">
                <span className="text-[10px] text-gray-600 px-1.5 py-0.5 rounded bg-surface-page border border-gray-800 flex-shrink-0">{moduleLabel(module_slug)}</span>
                {dateVal && <span className="text-xs text-gray-600 flex-shrink-0">{new Date(dateVal).toLocaleDateString('it-IT')}</span>}
                <span className="hidden sm:inline text-sm font-medium text-gray-300 flex-shrink-0 w-24 text-right">{formatAmount(amount)}</span>
              </div>
            </div>
          )
        })}
      </div>
      {detail && (() => {
        const mod = modules.find((m) => m.slug === detail.module_slug)
        if (!mod) return null
        return (
          <RecordDetailModal
            mod={mod}
            schema={parseSchemaFrontend(mod.schema_json)}
            recordId={detail.recordId}
            relatedCache={{}}
            token={token}
            user={user}
            onClose={() => setDetail(null)}
            onSaved={() => { setDetail(null); load() }}
          />
        )
      })()}
    </div>
  )
}

export default ChecklistWidget
