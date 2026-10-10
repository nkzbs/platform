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

export default function ArchiveView({ mod, schema, records, token, canEdit, onOpen, onChanged }) {
  const api = useApi(token)
  const fields = (schema && schema.fields) || []
  const folderField = fields.find((f) => f.type === 'select')
  const fileField = fields.find((f) => f.type === 'file')
  const titleField = fields.find((f) => (f.type === 'text') && f.key !== (folderField && folderField.key)) || fields[0]
  const dateField = fields.find((f) => f.type === 'date' || f.type === 'datetime')

  const [vista, setVista] = useState(() => { try { return localStorage.getItem('archivio_vista') || 'schede' } catch (e) { return 'schede' } })
  const setV = (v) => { setVista(v); try { localStorage.setItem('archivio_vista', v) } catch (e) { /* storage non disponibile */ } }
  const [cartella, setCartella] = useState(null) // null = tutte; '' = senza cartella; altro = valore
  const [anteprima, setAnteprima] = useState(null)
  const [dropSu, setDropSu] = useState(null)
  const [msg, setMsg] = useState('')

  const folders = useMemo(() => (folderField && Array.isArray(folderField.options) ? folderField.options.map((o) => ({ value: optVal(o), label: optLabel(o) })) : []), [folderField])
  const items = useMemo(() => records.map((r) => {
    const file = fileField ? r.data[fileField.key] : null
    const fv = folderField ? r.data[folderField.key] : ''
    const f = folders.find((x) => x.value === fv)
    return {
      id: r.id, record: r, file: file && file.id ? file : null, kind: KIND(file && file.name), title: String((titleField && r.data[titleField.key]) || (file && file.name) || 'Senza titolo'),
      folderValue: fv || '', folder: f ? f.label : (fv || ''), date: dateField ? r.data[dateField.key] : '',
    }
  }), [records, fileField, folderField, titleField, dateField, folders])

  const count = (v) => items.filter((i) => i.folderValue === v).length
  const senza = items.filter((i) => !i.folderValue || !folders.some((f) => f.value === i.folderValue)).length
  const visibili = items.filter((i) => cartella === null ? true : cartella === '' ? (!i.folderValue || !folders.some((f) => f.value === i.folderValue)) : i.folderValue === cartella)
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || b.id - a.id)

  const sposta = async (item, valore) => {
    if (!canEdit || !folderField || item.folderValue === valore) return
    const r = await api.put('/records/' + mod.slug + '/' + item.id, { ...item.record.data, [folderField.key]: valore })
    if (r.ok) { setMsg('«' + item.title + '» spostato in ' + ((folders.find((f) => f.value === valore) || {}).label || 'nessuna cartella') + '.'); setAnteprima((a) => (a && a.id === item.id ? { ...a, folderValue: valore, folder: (folders.find((f) => f.value === valore) || {}).label || '' } : a)); onChanged && onChanged() }
    else setMsg((r.data && r.data.error) || 'Non sono riuscito a spostarlo.')
  }
  useEffect(() => { if (!msg) return undefined; const t = setTimeout(() => setMsg(''), 4000); return () => clearTimeout(t) }, [msg])

  const apri = (it) => { if (it.file) setAnteprima(it); else onOpen(it.id) }

  const Tile = ({ value, label, n, color, drop }) => {
    const sel = cartella === value
    return (
      <button type="button" onClick={() => setCartella(sel && value !== null ? null : value)}
        onDragOver={drop ? (e) => { e.preventDefault(); setDropSu(value) } : undefined} onDragLeave={drop ? () => setDropSu(null) : undefined}
        onDrop={drop ? (e) => { e.preventDefault(); setDropSu(null); const id = Number(e.dataTransfer.getData('text/plain')); const it = items.find((x) => x.id === id); if (it) sposta(it, value) } : undefined}
        className={'flex-shrink-0 sm:flex-shrink flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-left transition min-w-[130px] sm:min-w-0 ' + (sel ? 'border-accent bg-accent/10' : dropSu === value ? 'border-accent border-dashed bg-accent/5' : 'border-gray-800 hover:border-gray-700 bg-surface-card')}>
        <span className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: color + '22', color }}><Icon name={value === null ? 'grid' : 'folder'} size={16} /></span>
        <span className="min-w-0">
          <span className="block text-sm text-ink font-medium truncate">{label}</span>
          <span className="block text-[11px] text-gray-500">{n} {n === 1 ? 'documento' : 'documenti'}</span>
        </span>
      </button>
    )
  }

  return (
    <div>
      {folderField && (
        <div className="flex gap-2 overflow-x-auto pb-2 mb-3 sm:grid sm:grid-cols-3 lg:grid-cols-6 sm:overflow-visible">
          <Tile value={null} label="Tutti" n={items.length} color="#64748B" />
          {folders.map((f, i) => <Tile key={f.value} value={f.value} label={f.label} n={count(f.value)} color={colorFor(i)} drop={canEdit} />)}
          {senza > 0 && <Tile value="" label="Senza cartella" n={senza} color="#9CA3AF" drop={canEdit} />}
        </div>
      )}

      <div className="flex items-center justify-between mb-3">
        <div className="text-xs text-gray-500 min-w-0">{visibili.length} {visibili.length === 1 ? 'documento' : 'documenti'}{cartella ? ' in «' + ((folders.find((f) => f.value === cartella) || {}).label || cartella) + '»' : ''}</div>
        {canEdit && folderField && vista === 'schede' && <div className="hidden lg:block text-xs text-gray-500 flex-1 ml-2 truncate">· trascina una scheda su una cartella per spostarla</div>}
        <div className="flex rounded-lg border border-gray-800 overflow-hidden text-xs flex-shrink-0 ml-2">
          {[['schede', 'Schede'], ['elenco', 'Elenco']].map(([k, l]) => <button key={k} type="button" onClick={() => setV(k)} className={'px-3 py-1.5 transition ' + (vista === k ? 'bg-accent text-white' : 'text-gray-400 hover:text-ink')}>{l}</button>)}
        </div>
      </div>
      {msg && <div className="text-xs text-green-500 bg-green-500/10 border border-green-500/30 rounded-lg px-3 py-2 mb-3">{msg}</div>}

      {visibili.length === 0 ? (
        <div className="bg-surface-card rounded-md p-12 text-center border border-gray-800 text-gray-500">Nessun documento qui.</div>
      ) : vista === 'schede' ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {visibili.map((it) => {
            return (
              <div key={it.id} draggable={canEdit && !!folderField} onDragStart={(e) => e.dataTransfer.setData('text/plain', String(it.id))} onClick={() => apri(it)}
                className="bg-surface-card rounded-xl border border-gray-800 hover:border-gray-600 p-2.5 cursor-pointer transition group">
                <Thumb file={it.file} token={token} kind={it.kind} />
                <div className="mt-2 px-0.5">
                  <div className="text-sm text-ink font-medium leading-snug break-words line-clamp-2" title={it.title}>{it.title}</div>
                  <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                    {it.folder && <span className="text-[10px] px-1.5 py-0.5 rounded-md" style={{ background: colorFor(Math.max(0, folders.findIndex((f) => f.value === it.folderValue))) + '22', color: colorFor(Math.max(0, folders.findIndex((f) => f.value === it.folderValue))) }}>{it.folder}</span>}
                    {it.date && <span className="text-[11px] text-gray-500">{fmtDate(it.date)}</span>}
                    {!it.file && <span className="text-[10px] text-amber-500">senza file</span>}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="bg-surface-card rounded-md border border-gray-800 divide-y divide-gray-800/60 overflow-hidden">
          {visibili.map((it) => {
            const st = KIND_STYLE[it.kind]
            return (
              <div key={it.id} onClick={() => apri(it)} className="flex items-center gap-3 px-4 py-3 hover:bg-white/5 cursor-pointer">
                <span className="w-9 h-9 rounded-lg flex items-center justify-center text-[10px] font-bold flex-shrink-0" style={{ background: st.c + '1f', color: st.c }}>{st.l}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-ink break-words">{it.title}</div>
                  <div className="text-xs text-gray-500">{[it.folder, fmtDate(it.date)].filter(Boolean).join(' · ')}</div>
                </div>
                <Icon name="chevron-right" size={15} className="text-gray-600 flex-shrink-0" />
              </div>
            )
          })}
        </div>
      )}

      {anteprima && <Preview item={anteprima} token={token} folders={folders} folderField={folderField} canEdit={canEdit} onMove={sposta} onDetail={() => { const id = anteprima.id; setAnteprima(null); onOpen(id) }} onClose={() => setAnteprima(null)} />}
    </div>
  )
}
