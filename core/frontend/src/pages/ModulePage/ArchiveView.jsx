import React, { useState, useEffect, useMemo, useRef } from 'react'
import { API } from '../../lib/api'
import useApi from '../../lib/useApi'
import Icon from '../../components/Icon'

// Vista ad archivio: cartelle (i valori del primo campo "scelta"), file come schede con anteprima, interruttore Schede/Elenco.
// Generica: nessun nome di modulo o di campo. Cartelle = primo campo select; file = primo campo di tipo file; titolo = primo campo di testo
// (o la prima colonna), data = primo campo data. Cambiare cartella a un file (trascinandolo o dal dettaglio) modifica solo quel campo select.
const optVal = (o) => (typeof o === 'string' ? o : o.value)
const optLabel = (o) => (typeof o === 'string' ? o : o.label || o.value)
const ext = (name) => (String(name || '').split('.').pop() || '').toLowerCase()
const KIND = (name) => {
  const e = ext(name)
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic'].includes(e)) return 'img'
  if (e === 'pdf') return 'pdf'
  if (['xls', 'xlsx', 'csv', 'ods'].includes(e)) return 'sheet'
  if (['doc', 'docx', 'odt', 'rtf', 'txt'].includes(e)) return 'doc'
  return 'file'
}
const KIND_STYLE = {
  pdf: { c: '#EF4444', l: 'PDF' }, img: { c: '#8B5CF6', l: 'IMG' }, sheet: { c: '#10B981', l: 'XLS' }, doc: { c: '#3B82F6', l: 'DOC' }, file: { c: '#6B7280', l: 'FILE' },
}
const PALETTE = ['#6366F1', '#10B981', '#F59E0B', '#EF4444', '#06B6D4', '#8B5CF6', '#EC4899', '#84CC16', '#F97316', '#14B8A6', '#3B82F6']
const colorFor = (i) => PALETTE[i % PALETTE.length]
const fmtDate = (v) => (v ? String(v).slice(0, 10).split('-').reverse().join('/') : '')

// Miniatura di un'immagine: il file è protetto, quindi si scarica con il token e si mostra da blob, solo quando la scheda entra nello schermo.
function Thumb({ file, token, kind }) {
  const ref = useRef(null)
  const [url, setUrl] = useState(null)
  useEffect(() => {
    if (kind !== 'img' || !file || !file.id) return undefined
    let vivo = true, obj = null
    const io = new IntersectionObserver(async (en) => {
      if (!en[0].isIntersecting) return
      io.disconnect()
      try {
        const res = await fetch(API + '/uploads/' + file.id, { headers: { Authorization: 'Bearer ' + token } })
        if (!res.ok || !vivo) return
        obj = URL.createObjectURL(await res.blob()); setUrl(obj)
      } catch (e) { /* resta l'icona */ }
    }, { rootMargin: '200px' })
    if (ref.current) io.observe(ref.current)
    return () => { vivo = false; io.disconnect(); if (obj) URL.revokeObjectURL(obj) }
  }, [file && file.id, kind]) // eslint-disable-line react-hooks/exhaustive-deps
  const st = KIND_STYLE[kind]
  return (
    <div ref={ref} className="relative h-28 rounded-lg overflow-hidden flex items-center justify-center" style={{ background: st.c + '14' }}>
      {url
        ? <img src={url} alt="" className="w-full h-full object-cover" />
        : <div className="flex flex-col items-center gap-1">
            <span style={{ color: st.c }}><Icon name="file" size={30} /></span>
            <span className="text-[10px] font-bold tracking-wider" style={{ color: st.c }}>{st.l}</span>
          </div>}
      {url && <span className="absolute bottom-1 right-1 text-[9px] font-bold px-1.5 py-0.5 rounded bg-black/50 text-white">{st.l}</span>}
    </div>
  )
}

// Anteprima a tutto schermo: immagine, PDF (visualizzatore del browser) o, per gli altri tipi, il solo scarico.
function Preview({ item, token, folders, folderField, canEdit, onMove, onDetail, onClose }) {
  const [url, setUrl] = useState(null)
  const [err, setErr] = useState('')
  const { file, kind } = item
  useEffect(() => {
    let vivo = true, obj = null
    setUrl(null); setErr('')
    if (!file || !file.id) return undefined
    fetch(API + '/uploads/' + file.id, { headers: { Authorization: 'Bearer ' + token } }).then(async (r) => {
      if (!r.ok) {
        const d = await r.json().catch(() => ({}))
        const m = String(d.error || '')
        throw new Error(/Drive|invalid_grant|Refresh/i.test(m) ? 'Google Drive non risponde: il collegamento a Google è scaduto. Ricollega Google dalle impostazioni delle integrazioni.' : r.status === 404 ? 'Il file non si trova più (' + (m || 'assente') + ').' : 'Non riesco ad aprire il file' + (m ? ': ' + m : '.'))
      }
      const b = await r.blob(); if (!vivo) return
      obj = URL.createObjectURL(kind === 'pdf' && b.type !== 'application/pdf' ? new Blob([b], { type: 'application/pdf' }) : b); setUrl(obj)
    }).catch((e) => vivo && setErr(e.message))
    return () => { vivo = false; if (obj) URL.revokeObjectURL(obj) }
  }, [file && file.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const k = (e) => { if (e.key === 'Escape') onClose() }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [onClose])
  const st = KIND_STYLE[kind]
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-0 sm:p-6" onClick={onClose}>
      <div className="bg-surface-card w-full h-full sm:h-[90vh] sm:max-w-5xl sm:rounded-xl border border-gray-800 flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-3">
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0" style={{ background: st.c + '22', color: st.c }}>{st.l}</span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-ink truncate">{item.title}</div>
            <div className="text-xs text-gray-500 truncate">{[item.folder, fmtDate(item.date)].filter(Boolean).join(' · ')}</div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-ink p-1" aria-label="Chiudi"><Icon name="x" size={18} /></button>
        </div>
        <div className="flex-1 min-h-0 bg-black/10 flex items-center justify-center overflow-auto">
          {err && <div className="text-sm text-red-400 p-6">{err}</div>}
          {!err && !url && <div className="text-sm text-gray-500">Apro il file…</div>}
          {url && kind === 'img' && <img src={url} alt={item.title} className="max-w-full max-h-full object-contain" />}
          {url && kind === 'pdf' && <iframe src={url} title={item.title} className="w-full h-full border-0" />}
          {url && kind !== 'img' && kind !== 'pdf' && (
            <div className="text-center p-8">
              <span style={{ color: st.c }}><Icon name="file" size={48} /></span>
              <div className="text-sm text-ink mt-3">{file.name}</div>
              <div className="text-xs text-gray-500 mt-1">Per questo tipo di file non c'è un'anteprima: scaricalo per aprirlo.</div>
            </div>
          )}
        </div>
        <div className="px-4 py-3 border-t border-gray-800 flex items-center gap-2 flex-wrap">
          {canEdit && folderField && (
            <label className="flex items-center gap-2 text-xs text-gray-400">
              Cartella
              <select className="bg-surface-page text-ink px-2 py-1.5 rounded-lg text-sm border border-gray-800 outline-none focus:border-accent" value={item.folderValue || ''} onChange={(e) => onMove(item, e.target.value)}>
                <option value="">— nessuna —</option>
                {folders.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </label>
          )}
          <span className="flex-1" />
          <button onClick={onDetail} className="text-sm px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200">Dettagli</button>
          {url && <a href={url} target="_blank" rel="noreferrer" className="text-sm px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-200">Apri in una scheda</a>}
          {url && <a href={url} download={file && file.name} className="text-sm px-3 py-1.5 rounded-lg bg-accent hover:opacity-90 text-white">Scarica</a>}
        </div>
      </div>
    </div>
  )
}

// Anno di un documento: quello scritto nel titolo (es. «ClientStatements_20190830…», «CU-2021…») se c'è, altrimenti l'anno della data del record.
const ANNO = /(?:^|[^0-9])((?:19|20)\d{2})(?=\d{4}(?![0-9])|[^0-9]|$)/
const annoDi = (titolo, data) => { const m = ANNO.exec(String(titolo || '')); if (m) return m[1]; const d = String(data || '').slice(0, 4); return /^\d{4}$/.test(d) ? d : '' }
const SOTTO_CARTELLE_DA = 8 // una cartella con almeno 8 file e almeno 2 anni diversi si divide in sottocartelle per anno

export default function ArchiveView({ mod, schema, records, token, canEdit, onOpen, onChanged, searching }) {
  const api = useApi(token)
  const fields = (schema && schema.fields) || []
  const folderField = fields.find((f) => f.type === 'select')
  const fileField = fields.find((f) => f.type === 'file')
  const titleField = fields.find((f) => (f.type === 'text') && f.key !== (folderField && folderField.key)) || fields[0]
  const dateField = fields.find((f) => f.type === 'date' || f.type === 'datetime')

  const [vista, setVista] = useState(() => { try { return localStorage.getItem('archivio_vista') || 'schede' } catch (e) { return 'schede' } })
  const setV = (v) => { setVista(v); try { localStorage.setItem('archivio_vista', v) } catch (e) { /* storage non disponibile */ } }
  // Dove sono: [] = radice (solo cartelle); [cartella]; [cartella, anno]
  const [path, setPath] = useState([])
  const [anteprima, setAnteprima] = useState(null)
  const [dropSu, setDropSu] = useState(null)
  const [msg, setMsg] = useState('')

  const folders = useMemo(() => (folderField && Array.isArray(folderField.options) ? folderField.options.map((o) => ({ value: optVal(o), label: optLabel(o) })) : []), [folderField])
  const items = useMemo(() => records.map((r) => {
    const file = fileField ? r.data[fileField.key] : null
    const fv = folderField ? r.data[folderField.key] : ''
    const f = folders.find((x) => x.value === fv)
    const titolo = String((titleField && r.data[titleField.key]) || (file && file.name) || 'Senza titolo')
    const data = dateField ? r.data[dateField.key] : ''
    return {
      id: r.id, record: r, file: file && file.id ? file : null, kind: KIND(file && file.name), title: titolo,
      folderValue: f ? fv : '', folder: f ? f.label : '', date: data, anno: annoDi(titolo, data),
    }
  }), [records, fileField, folderField, titleField, dateField, folders])

  const inCartella = (v) => items.filter((i) => i.folderValue === v)
  const senzaCartella = items.filter((i) => !i.folderValue)
  const [cart, anno] = path
  const correnti = cart === undefined ? [] : cart === '' ? senzaCartella : inCartella(cart)
  const anni = [...new Set(correnti.map((i) => i.anno))]
  const dividi = correnti.length >= SOTTO_CARTELLE_DA && anni.filter(Boolean).length >= 2
  const sottoCartelle = dividi ? anni.sort((a, b) => (b || '0').localeCompare(a || '0')).map((a) => ({ anno: a, n: correnti.filter((i) => i.anno === a).length })) : []
  const mostraFile = searching ? items : (cart === undefined ? [] : (dividi && anno === undefined ? [] : correnti.filter((i) => !dividi || i.anno === anno)))
  const ordinati = [...mostraFile].sort((a, b) => (searching || !dividi ? String(b.date || '').localeCompare(String(a.date || '')) : 0) || String(b.title).localeCompare(String(a.title), undefined, { numeric: true }))
  const nomeCartella = (v) => (v === '' ? 'Senza cartella' : (folders.find((f) => f.value === v) || {}).label || v)

  const sposta = async (item, valore) => {
    if (!canEdit || !folderField || item.folderValue === valore) return
    const r = await api.put('/records/' + mod.slug + '/' + item.id, { ...item.record.data, [folderField.key]: valore })
    if (r.ok) { setMsg('«' + item.title + '» spostato in ' + nomeCartella(valore) + '.'); setAnteprima((a) => (a && a.id === item.id ? { ...a, folderValue: valore, folder: valore ? nomeCartella(valore) : '' } : a)); onChanged && onChanged() }
    else setMsg((r.data && r.data.error) || 'Non sono riuscito a spostarlo.')
  }
  useEffect(() => { if (!msg) return undefined; const t = setTimeout(() => setMsg(''), 4000); return () => clearTimeout(t) }, [msg])
  const apri = (it) => { if (it.file) setAnteprima(it); else onOpen(it.id) }

  // Cartella grande: icona, nome, numero di documenti
  const Cartella = ({ nome, n, color, onClick, drop, value, sub }) => (
    <button type="button" onClick={onClick}
      onDragOver={drop ? (e) => { e.preventDefault(); setDropSu(value) } : undefined} onDragLeave={drop ? () => setDropSu(null) : undefined}
      onDrop={drop ? (e) => { e.preventDefault(); setDropSu(null); const id = Number(e.dataTransfer.getData('text/plain')); const it = items.find((x) => x.id === id); if (it) sposta(it, value) } : undefined}
      className={'group text-left rounded-2xl border p-4 transition ' + (dropSu === value && drop ? 'border-accent border-dashed bg-accent/5' : n === 0 ? 'border-gray-800/70 bg-surface-card/50 hover:border-gray-700' : 'border-gray-800 bg-surface-card hover:border-gray-600 hover:-translate-y-0.5')}>
      <span className="w-12 h-12 rounded-xl flex items-center justify-center mb-3 transition" style={{ background: color + (n === 0 ? '12' : '22'), color: n === 0 ? color + '88' : color }}><Icon name="folder" size={26} /></span>
      <span className="block text-sm text-ink font-semibold leading-snug break-words">{nome}</span>
      <span className="block text-xs text-gray-500 mt-0.5">{n === 0 ? 'vuota' : n + (n === 1 ? ' documento' : ' documenti')}{sub ? ' · ' + sub : ''}</span>
    </button>
  )

  const inCima = path.length > 0 && !searching
  const briciole = (
    <div className="flex items-center gap-1.5 text-sm mb-4 flex-wrap">
      <button type="button" onClick={() => setPath([])} className="text-accent hover:underline font-medium">Archivio</button>
      {cart !== undefined && <><Icon name="chevron-right" size={13} className="text-gray-600" />{anno === undefined ? <span className="text-ink font-semibold">{nomeCartella(cart)}</span> : <button type="button" onClick={() => setPath([cart])} className="text-accent hover:underline font-medium">{nomeCartella(cart)}</button>}</>}
      {anno !== undefined && <><Icon name="chevron-right" size={13} className="text-gray-600" /><span className="text-ink font-semibold">{anno || 'Senza anno'}</span></>}
    </div>
  )

  const listaFile = (
    <>
      <div className="flex items-center justify-between mb-3 gap-2">
        <div className="text-xs text-gray-500 min-w-0">{ordinati.length} {ordinati.length === 1 ? 'documento' : 'documenti'}{searching ? ' trovati in tutto l\'archivio' : ''}</div>
        <div className="flex rounded-lg border border-gray-800 overflow-hidden text-xs flex-shrink-0">
          {[['schede', 'Schede'], ['elenco', 'Elenco']].map(([k, l]) => <button key={k} type="button" onClick={() => setV(k)} className={'px-3 py-1.5 transition ' + (vista === k ? 'bg-accent text-white' : 'text-gray-400 hover:text-ink')}>{l}</button>)}
        </div>
      </div>
      {ordinati.length === 0 ? (
        <div className="bg-surface-card rounded-md p-12 text-center border border-gray-800 text-gray-500">Nessun documento qui.</div>
      ) : vista === 'schede' ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {ordinati.map((it) => {
            const ci = Math.max(0, folders.findIndex((f) => f.value === it.folderValue))
            return (
              <div key={it.id} draggable={canEdit && !!folderField} onDragStart={(e) => e.dataTransfer.setData('text/plain', String(it.id))} onClick={() => apri(it)}
                className="bg-surface-card rounded-xl border border-gray-800 hover:border-gray-600 p-2.5 cursor-pointer transition">
                <Thumb file={it.file} token={token} kind={it.kind} />
                <div className="mt-2 px-0.5">
                  <div className="text-sm text-ink font-medium leading-snug break-words line-clamp-2" title={it.title}>{it.title}</div>
                  <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                    {(searching || !inCima) && it.folder && <span className="text-[10px] px-1.5 py-0.5 rounded-md" style={{ background: colorFor(ci) + '22', color: colorFor(ci) }}>{it.folder}</span>}
                    {it.anno && <span className="text-[11px] text-gray-500">{it.anno}</span>}
                    {!it.file && <span className="text-[10px] text-amber-500">senza file</span>}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="bg-surface-card rounded-md border border-gray-800 divide-y divide-gray-800/60 overflow-hidden">
          {ordinati.map((it) => {
            const st = KIND_STYLE[it.kind]
            return (
              <div key={it.id} onClick={() => apri(it)} className="flex items-center gap-3 px-4 py-3 hover:bg-white/5 cursor-pointer">
                <span className="w-9 h-9 rounded-lg flex items-center justify-center text-[10px] font-bold flex-shrink-0" style={{ background: st.c + '1f', color: st.c }}>{st.l}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-ink break-words">{it.title}</div>
                  <div className="text-xs text-gray-500">{[it.folder, it.anno].filter(Boolean).join(' · ')}</div>
                </div>
                <Icon name="chevron-right" size={15} className="text-gray-600 flex-shrink-0" />
              </div>
            )
          })}
        </div>
      )}
    </>
  )

  return (
    <div>
      {msg && <div className="text-xs text-green-500 bg-green-500/10 border border-green-500/30 rounded-lg px-3 py-2 mb-3">{msg}</div>}

      {searching ? listaFile : (
        <>
          {path.length > 0 && briciole}
          {path.length === 0 && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                {folders.map((f, i) => <Cartella key={f.value} nome={f.label} n={inCartella(f.value).length} color={colorFor(i)} value={f.value} drop={canEdit} onClick={() => setPath([f.value])} sub={(() => { const a = [...new Set(inCartella(f.value).map((x) => x.anno).filter(Boolean))].sort(); return a.length > 1 ? a[0] + '–' + a[a.length - 1] : '' })()} />)}
                {senzaCartella.length > 0 && <Cartella nome="Senza cartella" n={senzaCartella.length} color="#9CA3AF" value="" drop={canEdit} onClick={() => setPath([''])} />}
              </div>
              {canEdit && folderField && <div className="hidden lg:block text-xs text-gray-500 mt-4">Per spostare un file basta trascinarlo su una cartella: apri una cartella e trascina, oppure usa «Cartella» nell'anteprima.</div>}
            </>
          )}
          {cart !== undefined && dividi && anno === undefined && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              {sottoCartelle.map((c, i) => <Cartella key={c.anno || 'x'} nome={c.anno || 'Senza anno'} n={c.n} color={colorFor(i + 2)} onClick={() => setPath([cart, c.anno])} />)}
            </div>
          )}
          {cart !== undefined && !(dividi && anno === undefined) && listaFile}
        </>
      )}

      {anteprima && <Preview item={anteprima} token={token} folders={folders} folderField={folderField} canEdit={canEdit} onMove={sposta} onDetail={() => { const id = anteprima.id; setAnteprima(null); onOpen(id) }} onClose={() => setAnteprima(null)} />}
    </div>
  )
}
