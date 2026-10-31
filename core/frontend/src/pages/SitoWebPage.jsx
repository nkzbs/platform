import React, { useState, useEffect } from 'react'
import useApi from '../lib/useApi'
import Icon from '../components/Icon'
import Tile from '../components/Tile'
import { parseSchemaFrontend } from '../lib/schema-v3-frontend'

// Sito Web (2026-09-04, richiesto dall'utente: motore standard per qualunque tenant,
// non solo e-commerce — "lo vorrei standard per tutti", verticale e-commerce lo
// seed già completo). Editor a bottoni (aggiungi/sposta su-giù/elimina/nascondi).
// Drag-and-drop per il riordino (2026-09-04, richiesto esplicitamente più tardi
// nella stessa sessione — la nota precedente lo escludeva, decisione ribaltata):
// HTML5 drag-and-drop nativo (dragstart/dragover/drop), coerente con "niente
// librerie nuove" già seguito per i grafici SVG a mano — nessuna dipendenza
// aggiunta. Le frecce su/giù restano accanto (accessibilità: la tastiera non
// aziona un drag nativo).
// Sito Web è funzionalità CORE (2026-09-05, richiesto dall'utente: "il
// modulo così non è gestibile tramite builder -> fallo diventare
// funzionalità core") — prima galleria/testimonianze/html_custom erano
// "PRO" (richiedevano il modulo Store installato), ora ogni blocco è
// sempre disponibile per ogni tenant, gratis: un'unica lista, niente più
// distinzione BASE/PRO.
// Stesso allowlist fisso di core/backend/src/site-renderer.js (ICONS) — se
// cambia uno, va cambiato anche l'altro: un nome fuori da questa lista non fa
// crashare nulla (il motore lo ignora silenziosamente), ma non renderizza
// alcuna icona, quindi va tenuto visibile qui nel testo di aiuto del campo.
const ICON_KEYS = ['leaf', 'gear', 'truck', 'flame', 'dots', 'cup', 'heart', 'trophy', 'users', 'shield', 'headphones', 'book']

const BASE_BLOCK_TYPES = [
  { type: 'header', label: 'Intestazione (nav)' },
  { type: 'hero', label: 'Sezione principale (hero)' },
  { type: 'riga', label: 'Riga (colonne affiancate)' },
  { type: 'testo', label: 'Testo' },
  { type: 'immagine', label: 'Immagine' },
  { type: 'griglia_prodotti', label: 'Griglia prodotti' },
  { type: 'timeline', label: 'Timeline (passi numerati)' },
  { type: 'valori', label: 'Griglia valori' },
  { type: 'form', label: 'Modulo di contatto (raccolta richieste)' },
  { type: 'cta', label: 'Invito all\'azione (CTA)' },
  { type: 'galleria', label: 'Galleria immagini' },
  { type: 'testimonianze', label: 'Testimonianze' },
  { type: 'divisore', label: 'Divisore/spaziatura' },
  { type: 'video', label: 'Video (YouTube/Vimeo/file)' },
  { type: 'accordion', label: 'Domande frequenti (FAQ)' },
  { type: 'configuratore', label: 'Configuratore interattivo (quiz)' },
  { type: 'ticker', label: 'Striscia di testo a scorrimento' },
  { type: 'statistiche', label: 'Numeri/statistiche animate' },
  { type: 'html_custom', label: 'HTML/CSS personalizzato' },
  { type: 'footer', label: 'Piè di pagina' },
]
// Tipi ammessi DENTRO una colonna di 'riga' (2026-09-05) — niente header/
// footer (chrome di pagina, non ha senso affiancarlo ad altro). 'riga' è
// ammessa (nesting, "guardati Elementor e Divi"): BlockEditor più sotto
// chiama già se stesso ricorsivamente per i figli, quindi una riga dentro
// una colonna riusa lo stesso form riga/colonne senza codice nuovo — il
// motore lato server ha un tetto di profondità (MAX_RIGA_DEPTH in
// site-renderer.js) come unico guard contro un annidamento patologico.
const CHILD_BLOCK_TYPES = BASE_BLOCK_TYPES.filter((t) => !['header', 'footer'].includes(t.type))

// Sezioni pronte (2026-09-05, "andiamo avanti con Divi") — libreria di
// preset: combinazioni di blocchi già esistenti inserite in un colpo solo,
// stesso identico lavoro di cliccare "+ Blocco" più volte, solo raggruppato.
// MAI dati finti dentro: solo struttura vuota da riempire (es. 3 voci vuote
// in una griglia valori), coerente col resto della piattaforma ("niente
// dati finti, mai"). Ogni preset è una FUNZIONE, non un array condiviso —
// due inserimenti dello stesso preset non devono mai finire per riferirsi
// allo stesso oggetto di config, altrimenti modificarne uno cambierebbe
// anche l'altro a insaputa dell'admin.
const BLOCK_PRESETS = [
  {
    key: 'hero-chi-siamo',
    label: 'Hero + Chi siamo',
    description: 'Un\'apertura con titolo, poi un blocco di testo',
    blocks: () => [
      { type: 'hero', config: emptyConfigFor('hero') },
      { type: 'testo', config: { title: 'Chi siamo', body: '' } },
    ],
  },
  {
    key: 'valori-3',
    label: 'Valori a 3 colonne',
    description: 'Tre punti di forza da compilare',
    blocks: () => [{ type: 'valori', config: { title: '', items: [{}, {}, {}] } }],
  },
  {
    key: 'timeline-3',
    label: 'Percorso a 3 passi',
    description: 'Una timeline con tre tappe da compilare',
    blocks: () => [{ type: 'timeline', config: { title: '', steps: [{}, {}, {}] } }],
  },
  {
    key: 'cta-form',
    label: 'Invito all\'azione + Modulo',
    description: 'Un CTA seguito da un form di contatto',
    blocks: () => [
      { type: 'cta', config: emptyConfigFor('cta') },
      {
        type: 'form',
        config: {
          title: 'Contattaci', intro: '', submit_label: 'Invia',
          fields: [
            { key: 'nome', label: 'Nome', type: 'testo', required: true },
            { key: 'email', label: 'Email', type: 'email', required: true },
          ],
        },
      },
    ],
  },
  {
    key: 'due-colonne-testo-immagine',
    label: 'Due colonne: testo + immagine',
    description: 'Una riga affiancata, pronta per foto e descrizione',
    blocks: () => [{
      type: 'riga',
      config: { columns: [
        { width: 50, blocks: [{ type: 'testo', config: emptyConfigFor('testo') }] },
        { width: 50, blocks: [{ type: 'immagine', config: emptyConfigFor('immagine') }] },
      ] },
    }],
  },
]

function emptyConfigFor(type) {
  if (type === 'header') return { site_name: '', nav_links: [], cta_label: '', cta_url: '' }
  if (type === 'footer') return { site_name: '', tagline: '', columns: [], copyright_text: '' }
  if (type === 'hero') return { headline: '', subheadline: '', image_url: '', cta_label: '', cta_url: '' }
  if (type === 'testo') return { title: '', body: '' }
  if (type === 'immagine') return { image_url: '', alt: '', caption: '' }
  if (type === 'cta') return { title: '', cta_label: '', cta_url: '' }
  if (type === 'griglia_prodotti') return { title: '', source_module_slug: '', campo_nome: '', campo_prezzo: '', campo_descrizione: '', campo_immagine: '', campo_categoria: '', filter_field: '', filter_value: '', mostra_prezzo: true }
  if (type === 'riga') return { columns: [{ width: 50, blocks: [] }, { width: 50, blocks: [] }] }
  if (type === 'form') return { title: '', intro: '', fields: [], submit_label: 'Invia' }
  if (type === 'timeline') return { title: '', steps: [] }
  if (type === 'valori') return { title: '', items: [] }
  if (type === 'galleria') return { title: '', image_urls: [] }
  if (type === 'testimonianze') return { title: '', items: [] }
  if (type === 'divisore') return { spaziatura: 'media' }
  if (type === 'video') return { video_url: '', title: '' }
  if (type === 'accordion') return { title: '', items: [] }
  if (type === 'configuratore') return { title: '', intro: '', esiti: [], steps: [] }
  if (type === 'ticker') return { items: [] }
  if (type === 'statistiche') return { items: [] }
  if (type === 'html_custom') return { html: '' }
  return {}
}

// setDeep (2026-09-04, click-to-edit) — scrive `value` in `obj` seguendo un
// percorso di profondità arbitraria (es. ['columns','0','links','1','label']
// per un link dentro una colonna del footer), copiando immutabilmente solo
// il ramo toccato — il resto dell'oggetto resta lo STESSO riferimento
// (importante per non forzare re-render inutili altrove). I segmenti
// numerici sono indici di array (dataset.swField li manda come stringa,
// convertiti qui), gli altri sono chiavi di oggetto.
// getDeep (2026-09-05, canvas WYSIWYG fase D — bug reale trovato scrivendola:
// array-item-action leggeva b.config[field] diretto, mai un percorso
// composto — per un blocco valori/timeline ANNIDATO, field porta il prefisso
// completo, es. "columns.0.blocks.0.config.items", e config[field] non
// esiste mai su quella chiave letterale). Compagno di sola lettura di
// setDeep, stessa convenzione sugli indici numerici.
function getDeep(obj, parts) {
  return parts.reduce((acc, key) => {
    if (acc == null) return acc
    return acc[/^\d+$/.test(key) ? parseInt(key, 10) : key]
  }, obj)
}
function setDeep(obj, parts, value) {
  const [head, ...rest] = parts
  const isIndex = /^\d+$/.test(head)
  const idx = isIndex ? parseInt(head, 10) : head
  if (rest.length === 0) {
    if (isIndex) { const copy = [...obj]; copy[idx] = value; return copy }
    return { ...obj, [idx]: value }
  }
  const child = obj ? obj[idx] : undefined
  const updatedChild = setDeep(child, rest, value)
  if (isIndex) { const copy = [...(obj || [])]; copy[idx] = updatedChild; return copy }
  return { ...obj, [idx]: updatedChild }
}

// blockPath (2026-09-05, canvas WYSIWYG fase C) — stesso schema di percorso
// già usato lato server per stile/drag/toolbar dei blocchi annidati
// (site-renderer.js): "1" per un blocco di primo livello, "1.c0.b0" per un
// blocco nella colonna 0 della riga 1, a qualunque profondità. Tre funzioni
// generiche invece di codice duplicato in ogni handler postMessage:
// updateBlocksAtPath naviga/modifica l'array dei blocchi FRATELLI del
// blocco al percorso dato (generalizza sposta/duplica/elimina/inserisci/
// riordina — tutte operazioni sull'array-fratelli, mai un salto da un
// contenitore all'altro, fuori scope per questo pezzo); containerKeyOf
// confronta se due percorsi condividono lo stesso contenitore (necessario
// per rifiutare un riordino che proverebbe a spostare un blocco DENTRO un
// contenitore diverso dal suo); lastIndexOf legge l'indice del blocco
// nell'array dei fratelli.
function updateBlocksAtPath(blocksJson, path, arrayFn) {
  const segments = String(path).split('.')
  function recur(list, segStart) {
    const idx = parseInt(segStart === 0 ? segments[0] : segments[segStart].slice(1), 10)
    if (segStart >= segments.length - 1) return arrayFn(list, idx)
    const colIdx = parseInt(segments[segStart + 1].slice(1), 10)
    return list.map((b, i) => {
      if (i !== idx || !b || b.type !== 'riga') return b
      const columns = (b.config.columns || []).map((col, ci) => {
        if (ci !== colIdx) return col
        return { ...col, blocks: recur(col.blocks || [], segStart + 2) }
      })
      return { ...b, config: { ...b.config, columns } }
    })
  }
  return recur(blocksJson, 0)
}
function containerKeyOf(path) {
  const segments = String(path).split('.')
  return segments.slice(0, -1).join('.')
}
function lastIndexOf(path) {
  const segments = String(path).split('.')
  const last = segments[segments.length - 1]
  return parseInt(segments.length === 1 ? last : last.slice(1), 10)
}

// Multi-selezione di blocchi (2026-09-05, "abbiamo Divi?" — fase 4). Scope
// esplicito: solo duplica/elimina, mai riordino di gruppo (spostare blocchi
// non contigui in un colpo solo non ha una destinazione ovvia — fuori
// scope, non un dimenticato).
// Un ordinamento GLOBALE (non un raggruppamento per contenitore) è
// necessario, non solo un dettaglio di stile: un semplice raggruppamento
// per containerKeyOf elabora i gruppi in ordine arbitrario, e cancellare un
// blocco di primo livello PRIMA di elaborare un blocco annidato dentro una
// riga successiva invalida silenziosamente il suo indice di primo livello
// (la riga si è spostata) — trovato scrivendo un test a mano prima di
// fidarsi del raggruppamento ingenuo. L'ordine corretto: indice di primo
// livello DECRESCENTE come chiave primaria (mai spostare l'indice di un
// contenitore ancora da attraversare), indice locale (lastIndexOf)
// DECRESCENTE come chiave secondaria per i pareggi (due blocchi nella
// STESSA riga/colonna, coerente col riordino dentro un singolo contenitore).
function topIndexOf(path) {
  return parseInt(String(path).split('.')[0], 10)
}
function applyMultiAction(blocksJson, paths, action) {
  const sorted = [...paths].sort((a, b) => {
    const topDiff = topIndexOf(b) - topIndexOf(a)
    return topDiff !== 0 ? topDiff : lastIndexOf(b) - lastIndexOf(a)
  })
  let result = blocksJson
  sorted.forEach((p) => {
    result = updateBlocksAtPath(result, p, (list, idx) => {
      if (!list[idx]) return list
      const copy = [...list]
      if (action === 'duplicate') copy.splice(idx + 1, 0, JSON.parse(JSON.stringify(copy[idx])))
      else if (action === 'delete') copy.splice(idx, 1)
      return copy
    })
  })
  return result
}

// slugifyKey (2026-09-05, blocco 'form') — l'admin scrive solo l'etichetta
// del campo (es. "Nome e cognome"), la chiave che finisce in blocks_json (e
// nel <input name="...">, e nella whitelist lato server) è derivata in
// automatico — un campo tecnico in più da compilare a mano per ogni riga
// sarebbe attrito senza motivo reale. `existing` evita collisioni tra due
// etichette che si slugificano allo stesso modo (es. "Email" ed "email ").
function slugifyKey(label, existing) {
  const base = (label || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'campo'
  let key = base, i = 2
  while (existing.includes(key)) { key = base + '_' + i; i++ }
  return key
}

function Field({ label, value, onChange, textarea, placeholder }) {
  return (
    <label className="block mb-2">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      {textarea ? (
        <textarea value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
          className="w-full bg-surface-input border border-gray-800 rounded-md px-2.5 py-1.5 text-sm text-ink" rows={3} />
      ) : (
        <input value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
          className="w-full bg-surface-input border border-gray-800 rounded-md px-2.5 py-1.5 text-sm text-ink" />
      )}
    </label>
  )
}

// Formattazione di testo (2026-09-05, "abbiamo Divi?" — fase 3) — SOLO per
// body/intro (mai title/label/button, vedi il piano). Niente contenteditable
// (rischio concreto di markup diverso tra browser su Grassetto/Corsivo,
// timing di cattura dell'innerHTML): resta la stessa <textarea> di sempre,
// i bottoni avvolgono la SELEZIONE corrente con i tag letterali
// <strong>/<em>/<a href="...">, che il sanificatore server-side (già
// scritto per riconoscere esattamente questi) trasforma in HTML vero. Il
// ref serve a leggere selectionStart/End e a rimettere il focus/la
// selezione dopo l'inserimento (altrimenti il click sul bottone toglie il
// focus dalla textarea e l'utente perde il punto in cui si trovava).
function wrapSelection(ref, before, after, placeholder) {
  const el = ref.current
  if (!el) return null
  const start = el.selectionStart, end = el.selectionEnd
  const value = el.value
  const selected = value.slice(start, end) || placeholder
  const next = value.slice(0, start) + before + selected + after + value.slice(end)
  const cursorStart = start + before.length
  const cursorEnd = cursorStart + selected.length
  return { next, cursorStart, cursorEnd }
}
function RichField({ label, value, onChange, placeholder }) {
  const ref = React.useRef(null)
  const applyWrap = (before, after, placeholder) => {
    const result = wrapSelection(ref, before, after, placeholder)
    if (!result) return
    onChange(result.next)
    requestAnimationFrame(() => {
      if (!ref.current) return
      ref.current.focus()
      ref.current.setSelectionRange(result.cursorStart, result.cursorEnd)
    })
  }
  return (
    <label className="block mb-2">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className="flex gap-1 mb-1">
        <button type="button" title="Grassetto" onClick={() => applyWrap('<strong>', '</strong>', 'testo')}
          className="text-xs font-bold px-2 py-0.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 transition">B</button>
        <button type="button" title="Corsivo" onClick={() => applyWrap('<em>', '</em>', 'testo')}
          className="text-xs italic px-2 py-0.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 transition">I</button>
        <button type="button" title="Link" onClick={() => applyWrap('<a href="https://">', '</a>', 'testo')}
          className="text-xs px-2 py-0.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 transition underline">Link</button>
      </div>
      <textarea ref={ref} value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="w-full bg-surface-input border border-gray-800 rounded-md px-2.5 py-1.5 text-sm text-ink" rows={3} />
    </label>
  )
}

// Carica da computer o incolla un URL (2026-09-05, richiesto dall'utente:
// "ma nel backend come potrò modificare il frontend?" — il campo immagine
// principale di hero/testo/immagine era SOLO un URL da incollare, un tenant
// reale senza foto già online da qualche parte non aveva modo di caricarla).
// FileReader -> data URI, stesso formato già accettato ovunque (vedi
// image_url nel renderer, già un data:image/... in produzione).
function ImageField({ label, value, onChange, placeholder }) {
  return (
    <div className="mb-2">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      {value && <img src={value} alt="" className="w-full h-28 object-cover rounded-md mb-1.5 border border-gray-800" />}
      <input type="file" accept="image/*" className="w-full text-xs text-gray-400 mb-1.5"
        onChange={(e) => {
          const file = e.target.files && e.target.files[0]
          if (!file) return
          const reader = new FileReader()
          reader.onload = () => onChange(reader.result)
          reader.readAsDataURL(file)
        }} />
      <input value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder={placeholder || 'oppure incolla un URL immagine'}
        className="w-full bg-surface-input border border-gray-800 rounded-md px-2.5 py-1.5 text-sm text-ink" />
    </div>
  )
}

// Editor per singolo blocco (2026-09-04) — un case per type, coerente col renderer
// server-side (site-renderer.js): stessi campi, stesso significato, mai un editor
// generico che non sa cosa sta davvero modificando.
// Stile per singolo blocco (2026-09-05, "guardati Elementor e Divi" — un
// controllo generico VALIDO PER QUALUNQUE TIPO di blocco, non un campo
// dentro il config specifico del tipo: coerente col fatto che anche
// anchor_id (sopra) vive fuori da config per lo stesso motivo. Collassato
// di default per non appesantire ogni blocco con 4 campi quasi mai usati.
// I 4 campi in comune tra desktop (base) e i due override per dispositivo —
// stessa forma dei dati, cambia solo DOVE scrivono (2026-09-05, "vai su
// tutto": l'anteprima responsive già mostrava i 3 formati, ora può anche
// impostare valori diversi per ciascuno, non lo stesso CSS ovunque).
// Design-token globali (2026-09-05, "abbiamo Divi?" — fase 1) — chip
// cliccabili invece di un <select> controllato: il campo sotto può
// contenere sia un hex libero sia un token, un select "vero" dovrebbe
// sincronizzarsi con entrambi i casi in modo ambiguo. Un bottone scrive
// semplicemente "var(--sw-X)" nello stesso campo stringa di sempre — MAI
// al posto del campo libero, solo un modo più rapido di riempirlo.
const DESIGN_TOKEN_KEYS = [['primary', 'Primario'], ['secondary', 'Secondario'], ['background', 'Sfondo'], ['text', 'Testo']]
function TokenChips({ onPick }) {
  return (
    <div className="flex flex-wrap gap-1 mb-2 -mt-1">
      <span className="text-[10px] text-gray-600 self-center">usa un colore del Tema:</span>
      {DESIGN_TOKEN_KEYS.map(([k, label]) => (
        <button key={k} type="button" onClick={() => onPick(`var(--sw-${k})`)}
          className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-400 transition">{label}</button>
      ))}
    </div>
  )
}
function StyleFields({ vals, set }) {
  return (<>
    <Field label="Sfondo (colore CSS, es. #f5f5f4)" value={vals.background} onChange={(v) => set('background', v)} />
    <TokenChips onPick={(v) => set('background', v)} />
    <Field label="Spaziatura interna (CSS, es. 40px o 20px 10px)" value={vals.padding} onChange={(v) => set('padding', v)} />
    <label className="block mb-2">
      <div className="text-xs text-gray-500 mb-1">Allineamento testo</div>
      <select value={vals.text_align || ''} onChange={(e) => set('text_align', e.target.value)} className="w-full bg-surface-input border border-gray-800 rounded-md px-2.5 py-1.5 text-sm text-ink">
        <option value="">— predefinito —</option>
        <option value="left">Sinistra</option>
        <option value="center">Centro</option>
        <option value="right">Destra</option>
      </select>
    </label>
    <Field label="Colore testo (CSS, es. #1c1917)" value={vals.color} onChange={(v) => set('color', v)} />
    <TokenChips onPick={(v) => set('color', v)} />
  </>)
}

// Popup (2026-09-05, "andiamo avanti con Divi" — popup builder semplice, un
// oggetto piatto su page.popup_json, non un mini-composer a blocchi — vedi
// commento gemello in db.js sul perché). Stato locale come title/blocks_json:
// persiste solo al "Salva" della pagina, coerente con tutto il resto
// dell'editor (nessun salvataggio a parte per questo pannello).
function PopupEditor({ popup, onChange }) {
  const p = popup || {}
  const set = (key, val) => onChange({ ...p, [key]: val })
  return (<>
    <label className="flex items-center gap-2 text-sm text-ink mb-3">
      <input type="checkbox" checked={!!p.enabled} onChange={(e) => set('enabled', e.target.checked)} />
      Popup attivo su questa pagina
    </label>
    {p.enabled && (<>
      <label className="block mb-2">
        <div className="text-xs text-gray-500 mb-1">Quando comparire</div>
        <select value={p.trigger || 'delay'} onChange={(e) => set('trigger', e.target.value)} className="w-full bg-surface-input border border-gray-800 rounded-md px-2.5 py-1.5 text-sm text-ink">
          <option value="delay">Dopo qualche secondo</option>
          <option value="exit_intent">Quando il mouse sta per lasciare la pagina (solo desktop)</option>
        </select>
      </label>
      {(p.trigger || 'delay') === 'delay' && (
        <Field label="Secondi di attesa" value={p.delay_seconds !== undefined ? String(p.delay_seconds) : '3'}
          onChange={(v) => set('delay_seconds', Math.max(0, parseInt(v, 10) || 0))} />
      )}
      <Field label="Titolo" value={p.title} onChange={(v) => set('title', v)} />
      <Field label="Testo" value={p.body} onChange={(v) => set('body', v)} textarea />
      <ImageField label="Immagine (opzionale)" value={p.image_url} onChange={(v) => set('image_url', v)} />
      <div className="grid grid-cols-2 gap-2">
        <Field label="Testo bottone (opz.)" value={p.cta_label} onChange={(v) => set('cta_label', v)} />
        <Field label="Link bottone (opz.)" value={p.cta_url} onChange={(v) => set('cta_url', v)} />
      </div>
      <div className="text-[11px] text-gray-500 mt-1">Non ricompare nella stessa visita dopo essere stato chiuso. Nessun equivalente del trigger "mouse in uscita" su mobile.</div>
    </>)}
  </>)
}

function BlockStyleEditor({ block, onChange }) {
  const [open, setOpen] = useState(false)
  const [device, setDevice] = useState('desktop')
  const so = block.style_overrides || {}
  const setBase = (key, val) => onChange({ ...block, style_overrides: { ...so, [key]: val || undefined } })
  const setDevOverride = (dev) => (key, val) => onChange({ ...block, style_overrides: { ...so, [dev]: { ...(so[dev] || {}), [key]: val || undefined } } })
  return (
    <div className="mb-2 border border-gray-800 rounded-md">
      <button type="button" onClick={() => setOpen(!open)} className="w-full text-left px-2.5 py-1.5 text-xs text-gray-400 hover:text-gray-200 transition flex items-center justify-between">
        <span>Stile avanzato (sfondo, spaziatura, allineamento)</span>
        <span>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="p-2.5 pt-0">
          <div className="flex items-center gap-1 mb-2 bg-gray-900 rounded-lg p-0.5 w-fit">
            {[['desktop', 'Desktop'], ['tablet', 'Tablet'], ['mobile', 'Mobile']].map(([d, label]) => (
              <button key={d} type="button" onClick={() => setDevice(d)}
                className={'text-[11px] px-2 py-1 rounded-md transition ' + (device === d ? 'bg-accent text-white' : 'text-gray-400 hover:text-gray-200')}>
                {label}
              </button>
            ))}
          </div>
          {device === 'desktop'
            ? <>
                <StyleFields vals={so} set={setBase} />
                {/* Animazione di comparsa (2026-09-05, "andiamo avanti con Divi" — oltre
                    il fade-in generico unico che c'era prima). Solo nella scheda Desktop,
                    non per dispositivo: un'animazione diversa per breakpoint non avrebbe
                    un vero valore d'uso, a differenza di sfondo/spaziatura/allineamento. */}
                <label className="block mb-2">
                  <div className="text-xs text-gray-500 mb-1">Animazione alla comparsa (scroll)</div>
                  <select value={so.animation || ''} onChange={(e) => setBase('animation', e.target.value)} className="w-full bg-surface-input border border-gray-800 rounded-md px-2.5 py-1.5 text-sm text-ink">
                    <option value="">Dissolvenza dal basso (predefinita)</option>
                    <option value="left">Scorri da sinistra</option>
                    <option value="right">Scorri da destra</option>
                    <option value="zoom">Zoom in avanti</option>
                    <option value="none">Nessuna (sempre visibile)</option>
                  </select>
                </label>
              </>
            : <>
                <div className="text-[11px] text-gray-500 mb-2">Solo i campi qui sotto compilati sostituiscono quelli Desktop, sotto i {device === 'tablet' ? '900px' : '640px'} di larghezza.</div>
                <StyleFields vals={so[device] || {}} set={setDevOverride(device)} />
              </>}
        </div>
      )}
    </div>
  )
}

function BlockEditor({ block, onChange, moduleFieldsBySlug, installedModules }) {
  const c = block.config || {}
  const set = (key, val) => onChange({ ...block, config: { ...c, [key]: val } })

  if (block.type === 'header') return (<>
    <Field label="Nome sito (logo testuale)" value={c.site_name} onChange={(v) => set('site_name', v)} />
    <Field label="Nome sito (EN, opzionale — mostra il tasto IT/EN se compilato)" value={c.site_name_en} onChange={(v) => set('site_name_en', v)} />
    <Field label="Logo (SVG incollato, opzionale — mostrato prima del nome sito)" value={c.logo_svg} onChange={(v) => set('logo_svg', v)} textarea placeholder="<svg>...</svg>" />
    <Field label={'Link di navigazione, uno per riga: testo | indirizzo | testo EN (opzionale) | riga secondaria (si/no, opzionale)'} textarea
      value={(c.nav_links || []).map((l) => l.label + ' | ' + l.url + ' | ' + (l.label_en || '') + (l.sub ? ' | si' : '')).join('\n')}
      onChange={(v) => set('nav_links', v.split('\n').filter(Boolean).map((line) => {
        const [label, url, label_en, sub] = line.split('|')
        return {
          label: (label || '').trim(), url: (url || '#').trim(),
          ...((label_en || '').trim() ? { label_en: label_en.trim() } : {}),
          ...((sub || '').trim().toLowerCase() === 'si' ? { sub: true } : {}),
        }
      }))} />
    <Field label="Testo pulsante (opzionale)" value={c.cta_label} onChange={(v) => set('cta_label', v)} />
    <Field label="Testo pulsante (EN, opzionale)" value={c.cta_label_en} onChange={(v) => set('cta_label_en', v)} />
    <Field label="Link pulsante" value={c.cta_url} onChange={(v) => set('cta_url', v)} />
    <label className="flex items-center gap-1.5 text-xs text-gray-400 mb-2">
      <input type="checkbox" checked={!!c.overlay_su_hero} onChange={(e) => set('overlay_su_hero', e.target.checked)} />
      Trasparente sopra la foto del blocco successivo (es. hero), opaco solo dopo aver scrollato
    </label>
  </>)
  if (block.type === 'footer') return (<>
    <Field label="Nome sito" value={c.site_name} onChange={(v) => set('site_name', v)} />
    <Field label="Nome sito (EN, opzionale)" value={c.site_name_en} onChange={(v) => set('site_name_en', v)} />
    <Field label="Logo (SVG incollato, opzionale — mostrato prima del nome sito)" value={c.logo_svg} onChange={(v) => set('logo_svg', v)} textarea placeholder="<svg>...</svg>" />
    <Field label="Slogan (opzionale)" value={c.tagline} onChange={(v) => set('tagline', v)} />
    <Field label="Slogan (EN, opzionale)" value={c.tagline_en} onChange={(v) => set('tagline_en', v)} />
    <Field label={'Colonne di link, una per riga: Titolo :: testo|indirizzo ; testo|indirizzo'} textarea
      value={(c.columns || []).map((col) => col.title + ' :: ' + (col.links || []).map((l) => l.label + '|' + l.url).join(' ; ')).join('\n')}
      onChange={(v) => set('columns', v.split('\n').filter(Boolean).map((line) => {
        const [title, rest] = line.split('::')
        const links = (rest || '').split(';').filter(Boolean).map((pair) => { const [label, url] = pair.split('|'); return { label: (label || '').trim(), url: (url || '#').trim() } })
        return { title: (title || '').trim(), links }
      }))} />
    <Field label="Testo copyright (opzionale)" value={c.copyright_text} onChange={(v) => set('copyright_text', v)} />
    <Field label="Testo copyright (EN, opzionale)" value={c.copyright_text_en} onChange={(v) => set('copyright_text_en', v)} />
    <Field label={'Scritta a mano decorativa (opzionale, es. "La qualità che senti, il piacere che ricordi.")'} value={c.handwritten} onChange={(v) => set('handwritten', v)} textarea />
  </>)
  if (block.type === 'hero') return (<>
    <Field label="Occhiello (opzionale, sopra il titolo)" value={c.eyebrow} onChange={(v) => set('eyebrow', v)} />
    <Field label="Occhiello (EN, opzionale)" value={c.eyebrow_en} onChange={(v) => set('eyebrow_en', v)} />
    <Field label="Titolo" value={c.headline} onChange={(v) => set('headline', v)} />
    <Field label="Titolo (EN, opzionale — mostra il tasto IT/EN se compilato)" value={c.headline_en} onChange={(v) => set('headline_en', v)} />
    <Field label="Sottotitolo" value={c.subheadline} onChange={(v) => set('subheadline', v)} textarea />
    <Field label="Sottotitolo (EN, opzionale)" value={c.subheadline_en} onChange={(v) => set('subheadline_en', v)} textarea />
    <ImageField label="Immagine di sfondo" value={c.image_url} onChange={(v) => set('image_url', v)} />
    {c.image_url && (
      <label className="flex items-center gap-1.5 text-xs text-gray-400 mb-2">
        <input type="checkbox" checked={!!c.ken_burns} onChange={(e) => set('ken_burns', e.target.checked)} />
        Zoom lento continuo sulla foto (effetto Ken Burns)
      </label>
    )}
    {c.image_url && (
      <label className="flex items-center gap-1.5 text-xs text-gray-400 mb-2">
        <input type="checkbox" checked={!!c.parallax} onChange={(e) => set('parallax', e.target.checked)} />
        La foto si sposta più lentamente del resto durante lo scroll (parallax)
      </label>
    )}
    <Field label="Testo pulsante" value={c.cta_label} onChange={(v) => set('cta_label', v)} />
    <Field label="Testo pulsante (EN, opzionale)" value={c.cta_label_en} onChange={(v) => set('cta_label_en', v)} />
    <Field label="Link pulsante" value={c.cta_url} onChange={(v) => set('cta_url', v)} />
    <Field label="Secondo pulsante, stile secondario (opzionale)" value={c.cta_label2} onChange={(v) => set('cta_label2', v)} />
    <Field label="Secondo pulsante (EN, opzionale)" value={c.cta_label2_en} onChange={(v) => set('cta_label2_en', v)} />
    <Field label="Link secondo pulsante" value={c.cta_url2} onChange={(v) => set('cta_url2', v)} />
    <Field label={'Scritta a mano decorativa (opzionale, es. "Più di un caffè, una scelta consapevole.")'} value={c.handwritten} onChange={(v) => set('handwritten', v)} textarea />
  </>)
  if (block.type === 'testo') return (<>
    <Field label="Occhiello (opzionale, sopra il titolo)" value={c.eyebrow} onChange={(v) => set('eyebrow', v)} />
    <Field label="Occhiello (EN, opzionale)" value={c.eyebrow_en} onChange={(v) => set('eyebrow_en', v)} />
    <Field label="Titolo (opzionale)" value={c.title} onChange={(v) => set('title', v)} />
    <Field label="Titolo (EN, opzionale)" value={c.title_en} onChange={(v) => set('title_en', v)} />
    <RichField label="Testo" value={c.body} onChange={(v) => set('body', v)} />
    <RichField label="Testo (EN, opzionale — mostra il tasto IT/EN se compilato)" value={c.body_en} onChange={(v) => set('body_en', v)} />
    <ImageField label="Immagine affiancata (opzionale)" value={c.image_url} onChange={(v) => set('image_url', v)} />
    <Field label={'Nota laterale breve (solo se scuro e con foto, es. "Rispetto per le origini.")'} value={c.aside} onChange={(v) => set('aside', v)} />
    <Field label="Nota laterale (EN, opzionale)" value={c.aside_en} onChange={(v) => set('aside_en', v)} />
  </>)
  if (block.type === 'immagine') return (<>
    <ImageField label="Immagine" value={c.image_url} onChange={(v) => set('image_url', v)} />
    <Field label="Testo alternativo (accessibilità/SEO)" value={c.alt} onChange={(v) => set('alt', v)} />
    <Field label="Didascalia (opzionale)" value={c.caption} onChange={(v) => set('caption', v)} />
    {c.image_url && (
      <label className="flex items-center gap-1.5 text-xs text-gray-400 mb-2">
        <input type="checkbox" checked={!!c.parallax} onChange={(e) => set('parallax', e.target.checked)} />
        La foto si sposta più lentamente del resto durante lo scroll (parallax)
      </label>
    )}
  </>)
  if (block.type === 'cta') return (<>
    <Field label="Occhiello (opzionale, sopra il titolo)" value={c.eyebrow} onChange={(v) => set('eyebrow', v)} />
    <Field label="Occhiello (EN, opzionale)" value={c.eyebrow_en} onChange={(v) => set('eyebrow_en', v)} />
    <Field label="Titolo" value={c.title} onChange={(v) => set('title', v)} />
    <Field label="Titolo (EN, opzionale)" value={c.title_en} onChange={(v) => set('title_en', v)} />
    <RichField label="Testo introduttivo (opzionale)" value={c.intro} onChange={(v) => set('intro', v)} />
    <RichField label="Testo introduttivo (EN, opzionale)" value={c.intro_en} onChange={(v) => set('intro_en', v)} />
    <Field label="Testo pulsante" value={c.cta_label} onChange={(v) => set('cta_label', v)} />
    <Field label="Testo pulsante (EN, opzionale)" value={c.cta_label_en} onChange={(v) => set('cta_label_en', v)} />
    <Field label="Link pulsante" value={c.cta_url} onChange={(v) => set('cta_url', v)} />
  </>)
  if (block.type === 'griglia_prodotti') {
    const fields = moduleFieldsBySlug[c.source_module_slug] || []
    const fieldSelect = (label, key) => (
      <label className="block mb-2">
        <div className="text-xs text-gray-500 mb-1">{label}</div>
        <select value={c[key] || ''} onChange={(e) => set(key, e.target.value)} className="w-full bg-surface-input border border-gray-800 rounded-md px-2.5 py-1.5 text-sm text-ink">
          <option value="">—</option>
          {fields.map((f) => <option key={f.key} value={f.key}>{f.label} ({f.key})</option>)}
        </select>
      </label>
    )
    return (<>
      <Field label="Occhiello (opzionale, sopra il titolo)" value={c.eyebrow} onChange={(v) => set('eyebrow', v)} />
      <Field label="Occhiello (EN, opzionale)" value={c.eyebrow_en} onChange={(v) => set('eyebrow_en', v)} />
      <Field label="Titolo sezione" value={c.title} onChange={(v) => set('title', v)} />
      <RichField label="Testo introduttivo (opzionale)" value={c.intro} onChange={(v) => set('intro', v)} />
      <RichField label="Testo introduttivo (EN, opzionale)" value={c.intro_en} onChange={(v) => set('intro_en', v)} />
      <label className="block mb-2">
        <div className="text-xs text-gray-500 mb-1">Modulo prodotti</div>
        <select value={c.source_module_slug || ''} onChange={(e) => set('source_module_slug', e.target.value)} className="w-full bg-surface-input border border-gray-800 rounded-md px-2.5 py-1.5 text-sm text-ink">
          <option value="">— seleziona un modulo —</option>
          {installedModules.map((m) => <option key={m.slug} value={m.slug}>{m.name}</option>)}
        </select>
      </label>
      {c.source_module_slug && <>
        {fieldSelect('Campo nome prodotto', 'campo_nome')}
        {fieldSelect('Campo categoria (opzionale, mostrato come etichetta)', 'campo_categoria')}
        {fieldSelect('Campo descrizione (opzionale)', 'campo_descrizione')}
        {fieldSelect('Campo immagine (opzionale)', 'campo_immagine')}
        <label className="flex items-center gap-1.5 text-xs text-gray-400 mb-2">
          <input type="checkbox" checked={c.mostra_prezzo !== false} onChange={(e) => set('mostra_prezzo', e.target.checked)} />
          Mostra il prezzo (disattiva per un catalogo B2B senza prezzi pubblici)
        </label>
        {c.mostra_prezzo !== false && fieldSelect('Campo prezzo', 'campo_prezzo')}
        <div className="grid grid-cols-2 gap-2">
          {fieldSelect('Filtra per campo (opzionale)', 'filter_field')}
          <Field label="Valore richiesto (es. true, disponibile)" value={c.filter_value} onChange={(v) => set('filter_value', v)} />
        </div>
      </>}
      {!c.source_module_slug && <>
        <div className="text-xs text-gray-500 mb-2">Nessun modulo selezionato: inserisci i prodotti manualmente qui sotto (utile per un sito vetrina, es. le miscele di un brand, che non sono record di un modulo). Se in futuro colleghi un modulo, quello ha sempre la precedenza su questo elenco.</div>
        <Field label={'Un prodotto per riga, formato: nome | descrizione (opz.) | prezzo (opz.) | immagine URL (opz.) | categoria (opz.)'} textarea
          value={(c.items || []).map((p) => `${p.nome} | ${p.descrizione || ''} | ${p.prezzo != null ? p.prezzo : ''} | ${p.immagine || ''} | ${p.categoria || ''}`).join('\n')}
          onChange={(v) => set('items', v.split('\n').filter(Boolean).map((line) => {
            const [nome, descrizione, prezzo, immagine, categoria] = line.split('|')
            return {
              nome: (nome || '').trim(), descrizione: (descrizione || '').trim(),
              ...((prezzo || '').trim() ? { prezzo: Number((prezzo || '').trim()) } : {}),
              ...((immagine || '').trim() ? { immagine: (immagine || '').trim() } : {}),
              ...((categoria || '').trim() ? { categoria: (categoria || '').trim() } : {}),
            }
          }))} />
      </>}
    </>)
  }
  if (block.type === 'timeline') return (<>
    <Field label="Occhiello (opzionale, sopra il titolo)" value={c.eyebrow} onChange={(v) => set('eyebrow', v)} />
    <Field label="Occhiello (EN, opzionale)" value={c.eyebrow_en} onChange={(v) => set('eyebrow_en', v)} />
    <Field label="Titolo sezione (opzionale)" value={c.title} onChange={(v) => set('title', v)} />
    <Field label="Titolo sezione (EN, opzionale)" value={c.title_en} onChange={(v) => set('title_en', v)} />
    <RichField label="Testo introduttivo (opzionale)" value={c.intro} onChange={(v) => set('intro', v)} />
    <RichField label="Testo introduttivo (EN, opzionale)" value={c.intro_en} onChange={(v) => set('intro_en', v)} />
    <Field label={`Un passo per riga, formato: titolo | testo | titolo EN (opz.) | testo EN (opz.) | icona (opz.: ${ICON_KEYS.join(', ')}) | URL immagine (opz., ha la precedenza sull'icona)`} textarea
      value={(c.steps || []).map((s) => s.titolo + ' | ' + (s.testo || '') + ' | ' + (s.titolo_en || '') + ' | ' + (s.testo_en || '') + ' | ' + (s.icon || '') + (s.immagine ? ' | ' + s.immagine : '')).join('\n')}
      onChange={(v) => set('steps', v.split('\n').filter(Boolean).map((line) => {
        const [titolo, testo, titolo_en, testo_en, icon, immagine] = line.split('|')
        return {
          titolo: (titolo || '').trim(), testo: (testo || '').trim(),
          ...((titolo_en || '').trim() ? { titolo_en: titolo_en.trim() } : {}),
          ...((testo_en || '').trim() ? { testo_en: testo_en.trim() } : {}),
          ...((icon || '').trim() ? { icon: icon.trim() } : {}),
          ...((immagine || '').trim() ? { immagine: immagine.trim() } : {}),
        }
      }))} />
    <div className="text-xs text-gray-500 mb-1 mt-3">Foto/didascalia iniziale (opzionale, es. "Il chicco, all'origine")</div>
    <ImageField label="Foto iniziale" value={c.bookend_start?.immagine} onChange={(v) => set('bookend_start', { ...(c.bookend_start || {}), immagine: v })} />
    <Field label="Didascalia iniziale" value={c.bookend_start?.testo} onChange={(v) => set('bookend_start', { ...(c.bookend_start || {}), testo: v })} />
    <div className="text-xs text-gray-500 mb-1 mt-3">Foto/didascalia finale (opzionale, es. "La tazzina, dal cliente")</div>
    <ImageField label="Foto finale" value={c.bookend_end?.immagine} onChange={(v) => set('bookend_end', { ...(c.bookend_end || {}), immagine: v })} />
    <Field label="Didascalia finale" value={c.bookend_end?.testo} onChange={(v) => set('bookend_end', { ...(c.bookend_end || {}), testo: v })} />
  </>)
  if (block.type === 'valori') return (<>
    <Field label="Occhiello (opzionale, sopra il titolo)" value={c.eyebrow} onChange={(v) => set('eyebrow', v)} />
    <Field label="Occhiello (EN, opzionale)" value={c.eyebrow_en} onChange={(v) => set('eyebrow_en', v)} />
    <Field label="Titolo sezione (opzionale)" value={c.title} onChange={(v) => set('title', v)} />
    <Field label="Titolo sezione (EN, opzionale)" value={c.title_en} onChange={(v) => set('title_en', v)} />
    <RichField label="Testo introduttivo (opzionale)" value={c.intro} onChange={(v) => set('intro', v)} />
    <RichField label="Testo introduttivo (EN, opzionale)" value={c.intro_en} onChange={(v) => set('intro_en', v)} />
    <Field label={`Un valore per riga, formato: etichetta | titolo | testo | etichetta EN (opz.) | titolo EN (opz.) | testo EN (opz.) | icona (opz.: ${ICON_KEYS.join(', ')}) | URL immagine (opz.)`} textarea
      value={(c.items || []).map((v) => (v.eyebrow || '') + ' | ' + v.titolo + ' | ' + (v.testo || '') + ' | ' + (v.eyebrow_en || '') + ' | ' + (v.titolo_en || '') + ' | ' + (v.testo_en || '') + ' | ' + (v.icon || '') + (v.immagine ? ' | ' + v.immagine : '')).join('\n')}
      onChange={(v) => set('items', v.split('\n').filter(Boolean).map((line) => {
        const [eyebrow, titolo, testo, eyebrow_en, titolo_en, testo_en, icon, immagine] = line.split('|')
        return {
          eyebrow: (eyebrow || '').trim(), titolo: (titolo || '').trim(), testo: (testo || '').trim(),
          ...((eyebrow_en || '').trim() ? { eyebrow_en: eyebrow_en.trim() } : {}),
          ...((titolo_en || '').trim() ? { titolo_en: titolo_en.trim() } : {}),
          ...((testo_en || '').trim() ? { testo_en: testo_en.trim() } : {}),
          ...((icon || '').trim() ? { icon: icon.trim() } : {}),
          ...((immagine || '').trim() ? { immagine: immagine.trim() } : {}),
        }
      }))} />
  </>)
  if (block.type === 'galleria') return (
    <Field label="URL immagini (una per riga)" textarea value={(c.image_urls || []).join('\n')} onChange={(v) => set('image_urls', v.split('\n').map((s) => s.trim()).filter(Boolean))} />
  )
  if (block.type === 'testimonianze') return (
    <Field label={'Una per riga, formato: testo | autore'} textarea
      value={(c.items || []).map((t) => t.testo + ' | ' + (t.autore || '')).join('\n')}
      onChange={(v) => set('items', v.split('\n').filter(Boolean).map((line) => { const [testo, autore] = line.split('|'); return { testo: (testo || '').trim(), autore: (autore || '').trim() } }))} />
  )
  if (block.type === 'html_custom') return (
    <Field label="HTML/CSS" textarea value={c.html} onChange={(v) => set('html', v)} placeholder="<style>...</style>&#10;<div>...</div>" />
  )
  if (block.type === 'divisore') return (
    <label className="block mb-2">
      <div className="text-xs text-gray-500 mb-1">Spaziatura</div>
      <select value={c.spaziatura || 'media'} onChange={(e) => set('spaziatura', e.target.value)} className="w-full bg-surface-input border border-gray-800 rounded-md px-2.5 py-1.5 text-sm text-ink">
        <option value="piccola">Piccola</option>
        <option value="media">Media</option>
        <option value="grande">Grande</option>
      </select>
    </label>
  )
  if (block.type === 'video') return (<>
    <Field label="URL video (YouTube, Vimeo, o file .mp4 diretto)" value={c.video_url} onChange={(v) => set('video_url', v)} placeholder="https://www.youtube.com/watch?v=..." />
    <Field label="Titolo sopra il video (opzionale)" value={c.title} onChange={(v) => set('title', v)} />
  </>)
  if (block.type === 'accordion') return (<>
    <Field label="Titolo sezione (opzionale)" value={c.title} onChange={(v) => set('title', v)} />
    <Field label={'Una domanda per riga, formato: domanda | risposta'} textarea
      value={(c.items || []).map((it) => it.domanda + ' | ' + (it.risposta || '')).join('\n')}
      onChange={(v) => set('items', v.split('\n').filter(Boolean).map((line) => { const [domanda, risposta] = line.split('|'); return { domanda: (domanda || '').trim(), risposta: (risposta || '').trim() } }))} />
  </>)
  // Form di raccolta lead (2026-09-05) — la chiave di ogni campo è derivata
  // dall'etichetta (slugifyKey), mai scritta a mano: un campo tecnico in più
  // per riga sarebbe attrito senza motivo reale. Tipo scritto in italiano
  // nella textarea (coerente con lo stile "un campo per riga" già in uso per
  // timeline/valori/header/footer), mappato al vero type HTML qui.
  const FIELD_TYPE_LABEL = { text: 'testo', email: 'email', tel: 'telefono', textarea: 'paragrafo' }
  const FIELD_TYPE_FROM_LABEL = { testo: 'text', email: 'email', telefono: 'tel', paragrafo: 'textarea' }
  if (block.type === 'form') return (<>
    <Field label="Occhiello (opzionale, sopra il titolo)" value={c.eyebrow} onChange={(v) => set('eyebrow', v)} />
    <Field label="Occhiello (EN, opzionale)" value={c.eyebrow_en} onChange={(v) => set('eyebrow_en', v)} />
    <Field label="Titolo sezione (opzionale)" value={c.title} onChange={(v) => set('title', v)} />
    <Field label="Titolo sezione (EN, opzionale)" value={c.title_en} onChange={(v) => set('title_en', v)} />
    <RichField label="Testo introduttivo (opzionale)" value={c.intro} onChange={(v) => set('intro', v)} />
    <RichField label="Testo introduttivo (EN, opzionale)" value={c.intro_en} onChange={(v) => set('intro_en', v)} />
    <Field label={'Campi del modulo, uno per riga: etichetta | tipo (testo/email/telefono/paragrafo) | obbligatorio (si/no)'} textarea
      value={(c.fields || []).map((f) => `${f.label} | ${FIELD_TYPE_LABEL[f.type] || 'testo'} | ${f.required === false ? 'no' : 'si'}`).join('\n')}
      onChange={(v) => {
        const existing = []
        const fields = v.split('\n').filter(Boolean).map((line) => {
          const [labelRaw, typeRaw, reqRaw] = line.split('|')
          const label = (labelRaw || '').trim()
          const type = FIELD_TYPE_FROM_LABEL[(typeRaw || '').trim().toLowerCase()] || 'text'
          const key = slugifyKey(label, existing)
          existing.push(key)
          return { key, label, type, required: (reqRaw || 'si').trim().toLowerCase() !== 'no' }
        })
        set('fields', fields)
      }} />
    <Field label="Testo pulsante invio" value={c.submit_label} onChange={(v) => set('submit_label', v)} placeholder="Invia" />
  </>)
  // Configuratore (2026-09-06, confronto 1:1 col mockup — fase 4, "il pezzo
  // più grande"): stessa scelta di 'form' sopra, niente click-to-edit campo
  // per campo su domande/opzioni/esiti (struttura a 3 livelli, troppo
  // annidata per l'editor in-canvas) — un DSL testuale in due textarea,
  // stesso principio del campo "fields" di 'form' appena sopra. L'esito è
  // identificato dal suo stesso NOME (mai una sigla separata che l'admin
  // dovrebbe ricordarsi di riusare identica nelle opzioni): un'opzione
  // assegna punteggio scrivendo il nome esatto di un esito, non un codice.
  if (block.type === 'configuratore') return (<>
    <Field label="Occhiello (opzionale, sopra il titolo)" value={c.eyebrow} onChange={(v) => set('eyebrow', v)} />
    <Field label="Occhiello (EN, opzionale)" value={c.eyebrow_en} onChange={(v) => set('eyebrow_en', v)} />
    <Field label="Titolo sezione (opzionale)" value={c.title} onChange={(v) => set('title', v)} />
    <Field label="Titolo sezione (EN, opzionale)" value={c.title_en} onChange={(v) => set('title_en', v)} />
    <RichField label="Testo introduttivo (opzionale)" value={c.intro} onChange={(v) => set('intro', v)} />
    <RichField label="Testo introduttivo (EN, opzionale)" value={c.intro_en} onChange={(v) => set('intro_en', v)} />
    <Field label={'Esiti possibili, uno per riga: nome | descrizione | url immagine (opzionale) | testo del pulsante (opzionale) | destinazione pulsante tipo #miscele (opzionale)'} textarea
      value={(c.esiti || []).map((e) => [e.nome, e.descrizione, e.immagine, e.cta_label, e.cta_target].map((v) => v || '').join(' | ')).join('\n')}
      onChange={(v) => {
        const esiti = v.split('\n').filter((line) => line.trim()).map((line) => {
          const [nome, descrizione, immagine, cta_label, cta_target] = line.split('|').map((s) => (s || '').trim())
          return { key: nome, nome, descrizione, immagine, cta_label, cta_target }
        })
        set('esiti', esiti)
      }} />
    <Field label={"Domande, separate da una riga con soli '---'. Sotto ogni domanda, un'opzione per riga: etichetta => nome esito:punti, nome esito:punti"} textarea
      value={(c.steps || []).map((s) => [s.question || '', ...(s.options || []).map((o) => `${o.label} => ${Object.entries(o.scores || {}).map(([k, v]) => `${k}:${v}`).join(', ')}`)].join('\n')).join('\n---\n')}
      onChange={(v) => {
        const steps = v.split(/^---+$/m).map((b) => b.trim()).filter(Boolean).map((block2) => {
          const lines = block2.split('\n').map((l) => l.trim()).filter(Boolean)
          const [question, ...optLines] = lines
          const options = optLines.map((line) => {
            const [labelRaw, scoresRaw] = line.split('=>')
            const scores = {}
            ;(scoresRaw || '').split(',').forEach((pair) => {
              const [k, w] = pair.split(':')
              const key = (k || '').trim()
              const weight = parseFloat(w)
              if (key && !isNaN(weight)) scores[key] = weight
            })
            return { label: (labelRaw || '').trim(), scores }
          })
          return { question: question || '', options }
        })
        set('steps', steps)
      }} />
  </>)
  // Contatori animati (2026-09-06, confronto 1:1 col mockup — fase 6):
  // stesso DSL testuale già visto per 'valori' — un valore per riga.
  if (block.type === 'statistiche') return (<>
    <Field label={'Un numero per riga, formato: valore | suffisso (opz., es. %) | etichetta | etichetta EN (opz.)'} textarea
      value={(c.items || []).map((it) => [it.valore, it.suffisso || '', it.etichetta || '', it.etichetta_en || ''].join(' | ')).join('\n')}
      onChange={(v) => set('items', v.split('\n').filter(Boolean).map((line) => {
        const [valore, suffisso, etichetta, etichetta_en] = line.split('|').map((s) => (s || '').trim())
        return { valore: Number(valore) || 0, suffisso, etichetta, ...(etichetta_en ? { etichetta_en } : {}) }
      }))} />
  </>)
  // Ticker (2026-09-06, confronto 1:1 col mockup — fase 5): niente
  // occhiello/titolo, è una striscia di chrome pura (stesso livello di
  // 'divisore') — solo l'elenco dei testi che scorrono, uno per riga.
  if (block.type === 'ticker') return (<>
    <Field label="Testi in scorrimento, uno per riga" textarea
      value={(c.items || []).join('\n')}
      onChange={(v) => set('items', v.split('\n').map((s) => s.trim()).filter(Boolean))} />
  </>)
  // Riga/colonne (2026-09-05) — l'editor form è ricorsivo: ogni figlio dentro
  // una colonna è un blocco NORMALE, editato dallo stesso BlockEditor
  // (chiamata a se stesso). Il ridimensionamento vero delle colonne si fa
  // trascinando nell'Anteprima live (site-renderer.js, .sw-col-resize) — qui
  // solo aggiungi/rimuovi colonna (larghezza ridistribuita in parti uguali)
  // e aggiungi/rimuovi/riordina/edita i blocchi dentro ciascuna.
  if (block.type === 'riga') {
    const columns = c.columns || []
    const setColumns = (cols) => set('columns', cols)
    const redistribute = (cols) => {
      const n = cols.length
      const w = Math.floor(100 / n)
      return cols.map((col, i) => ({ ...col, width: i === n - 1 ? 100 - w * (n - 1) : w }))
    }
    const addColumn = () => setColumns(redistribute([...columns, { width: 0, blocks: [] }]))
    const removeColumn = (ci) => { const rest = columns.filter((_, i) => i !== ci); if (rest.length) setColumns(redistribute(rest)) }
    const updateColumn = (ci, col) => setColumns(columns.map((c2, i2) => i2 === ci ? col : c2))
    return (<>
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] text-gray-500">{columns.length} colonne — trascina il bordo tra due colonne nell'Anteprima live per ridimensionarle</div>
        <div className="flex gap-1 flex-shrink-0">
          <button type="button" onClick={addColumn} className="text-[11px] px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-300">+ colonna</button>
          {columns.length > 1 && <button type="button" onClick={() => removeColumn(columns.length - 1)} className="text-[11px] px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-300">- colonna</button>}
        </div>
      </div>
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}>
        {columns.map((col, ci) => (
          <div key={ci} className="border border-gray-800 rounded-md p-2 bg-black/20 min-w-0">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] text-gray-500">Colonna {ci + 1} — {col.width}%</span>
              {columns.length > 1 && <button type="button" onClick={() => removeColumn(ci)} className="p-0.5 rounded hover:bg-red-900/30 text-gray-500 hover:text-red-400"><Icon name="trash" size={11} /></button>}
            </div>
            <div className="space-y-2 mb-2">
              {(col.blocks || []).map((cb, bi) => (
                <div key={bi} className="glass-panel p-2">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[11px] text-gray-400 truncate">{CHILD_BLOCK_TYPES.find((t) => t.type === cb.type)?.label || cb.type}</span>
                    <div className="flex gap-1 flex-shrink-0">
                      <button type="button" disabled={bi === 0} onClick={() => {
                        const blocks = [...col.blocks];[blocks[bi - 1], blocks[bi]] = [blocks[bi], blocks[bi - 1]]
                        updateColumn(ci, { ...col, blocks })
                      }} className="p-0.5 rounded hover:bg-gray-800 text-gray-500 disabled:opacity-30"><Icon name="chevron-up" size={11} /></button>
                      <button type="button" disabled={bi === col.blocks.length - 1} onClick={() => {
                        const blocks = [...col.blocks];[blocks[bi], blocks[bi + 1]] = [blocks[bi + 1], blocks[bi]]
                        updateColumn(ci, { ...col, blocks })
                      }} className="p-0.5 rounded hover:bg-gray-800 text-gray-500 disabled:opacity-30"><Icon name="chevron-down" size={11} /></button>
                      <button type="button" onClick={() => updateColumn(ci, { ...col, blocks: col.blocks.filter((_, i2) => i2 !== bi) })}
                        className="p-0.5 rounded hover:bg-red-900/30 text-gray-500 hover:text-red-400"><Icon name="trash" size={11} /></button>
                    </div>
                  </div>
                  <BlockEditor block={cb}
                    onChange={(nb) => updateColumn(ci, { ...col, blocks: col.blocks.map((b2, i2) => i2 === bi ? nb : b2) })}
                    moduleFieldsBySlug={moduleFieldsBySlug} installedModules={installedModules} />
                  {/* Stile per blocco anche annidato (2026-09-05, "andiamo avanti con Divi") —
                      il motore lato server già lo supporta a qualunque profondità (blockPath
                      in site-renderer.js), qui solo l'entry point mancante nell'editor: senza
                      questo il backend avrebbe supportato una funzionalità irraggiungibile
                      dall'admin. Niente maniglia di drag qui (resta solo su/giù sopra) — il
                      riordino via canvas opera su indici piatti, non su percorsi annidati. */}
                  <BlockStyleEditor block={cb}
                    onChange={(nb) => updateColumn(ci, { ...col, blocks: col.blocks.map((b2, i2) => i2 === bi ? nb : b2) })} />
                </div>
              ))}
              {(col.blocks || []).length === 0 && <div className="text-[11px] text-gray-600">Colonna vuota</div>}
            </div>
            <div className="flex flex-wrap gap-1">
              {CHILD_BLOCK_TYPES.map((t) => (
                <button key={t.type} type="button"
                  onClick={() => updateColumn(ci, { ...col, blocks: [...(col.blocks || []), { type: t.type, config: emptyConfigFor(t.type) }] })}
                  className="text-[10px] px-1.5 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-400">+ {t.label}</button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>)
  }
  return null
}

function PageEditor({ token, pageId, onBack, installedModules, api }) {
  const [page, setPage] = useState(null)
  const [moduleFieldsBySlug, setModuleFieldsBySlug] = useState({})
  const [saving, setSaving] = useState(false)
  // Theme Builder (2026-09-05) — quando il tenant ha un header/footer
  // condiviso attivo, aggiungerne uno inline in QUESTA pagina non avrebbe
  // alcun effetto visibile (renderPageHtml lo ignora sempre a favore del
  // condiviso, vedi site-renderer.js) — nascosto dal selettore "+ Blocco"
  // per non far scoprire il limite solo a posteriori.
  const [theme, setTheme] = useState(null)
  useEffect(() => { api.get('/site-pages/theme').then(setTheme) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const insertableBlockTypes = BASE_BLOCK_TYPES.filter((t) =>
    !(theme && theme.header && t.type === 'header') && !(theme && theme.footer && t.type === 'footer'))
  // Tutti gli hook di questo componente vivono QUI, PRIMA del `return`
  // anticipato più sotto (`if (!page) return ...`) — bug reale trovato dal
  // vivo (React error #310, "Rendered more hooks than during the previous
  // render"): al primo giro `page` è null e il componente esce prima di
  // arrivare a un useState/useEffect dichiarato più in basso nel file; al
  // giro successivo (page caricata) quello stesso hook viene eseguito,
  // cambiando il numero totale di hook tra un render e l'altro — cosa che
  // React non accetta MAI, indipendentemente da dove il codice "sembra"
  // avere senso. Ogni hook aggiunto qui, mai più in basso.
  const [draggedIdx, setDraggedIdx] = useState(null)
  const [dragOverIdx, setDragOverIdx] = useState(null)
  // Anteprima live (2026-09-04, primo passo verso "stile Divi/Elementor" —
  // l'utente: "Divi è importante") — renderizza la bozza corrente (MAI
  // salvata) con lo stesso motore server-side della pagina pubblica vera,
  // via POST /site-pages/preview + <iframe srcDoc>, invece del vecchio
  // "salva, poi apri Anteprima in un'altra scheda". Debounce 600ms: senza,
  // ogni tasto premuto in un campo di testo farebbe un round-trip.
  const [showPreview, setShowPreview] = useState(false)
  // Anteprima responsive per dispositivo (2026-09-05, "guardati Elementor e
  // Divi" — lì si passa da desktop a tablet/mobile per VEDERE davvero come
  // renderizza il vero CSS responsive della pagina, non solo restringere la
  // finestra del browser). Cambia solo la larghezza dell'iframe: lo stesso
  // identico HTML/CSS della pagina pubblica reale, nessuna vista finta.
  const [previewDevice, setPreviewDevice] = useState('desktop')
  const PREVIEW_WIDTHS = { desktop: '100%', tablet: '768px', mobile: '390px' }
  const [previewHtml, setPreviewHtml] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)
  // skipNextFetchRef (2026-09-04, click-to-edit) — quando un edit arriva DAL
  // canvas stesso (postMessage sotto), lo stato React va aggiornato per
  // "Salva", ma l'iframe NON va ricaricato: il testo digitato è già visibile
  // lì (contenteditable), un reload perderebbe focus/cursore a metà parola.
  // Il ref (non uno state) evita un giro di render in più solo per il flag.
  const skipNextFetchRef = React.useRef(false)
  // Immagini cliccabili (2026-09-04, terzo passo dopo drag/click-to-edit
  // testo — l'utente: "vorrei qualcosa di operativo uguale a
  // divi/elementor") — click su un'immagine nel canvas apre questo popover
  // (mai un vero media-library/upload, fuori scope) invece del campo URL
  // sepolto nel form sotto. { block, field, value } o null se chiuso.
  const [imagePopup, setImagePopup] = useState(null)
  // Cronologia/autosave (2026-09-05, "andiamo avanti con Divi") — lista
  // caricata SOLO all'apertura del pannello (non ad ogni render): una
  // revisione in più esiste solo dopo un vero "Salva" andato a buon fine,
  // quindi non serve rincorrerla in tempo reale come l'anteprima live.
  // openPanel (2026-09-06, segnalato dall'utente: "sito web è ancora poco
  // chiara, vorrei dei bento vari che mi facciano capire in pochi istanti
  // cosa fare") — sostituisce tre booleani indipendenti (showRevisions/
  // showPopupEditor/showBindingPanel, prima tre bottoni piatti in mezzo a
  // una fila di 8 senza gerarchia): stesso pattern "un tile alla volta
  // aperto" già usato in ImpostazioniPage.jsx/TenantsPage.jsx/SitoWebPage
  // stesso (schermata elenco pagine, 2026-09-06 prima di questo).
  const [openPanel, setOpenPanel] = useState(null) // null | 'cronologia' | 'popup' | 'binding'
  const [revisions, setRevisions] = useState([])
  const [restoringId, setRestoringId] = useState(null)
  // "+" tra due blocchi (2026-09-05, canvas WYSIWYG fase D) — null quando
  // chiuso, altrimenti il blockPath ("at") dove inserire.
  const [blockPickerAt, setBlockPickerAt] = useState(null)
  // Valori dinamici (2026-09-05, "abbiamo Divi?" — fase 2, content-binding
  // generico) — scegli modulo -> record -> campo, copia il token
  // {{bind:modulo:id:campo}} negli appunti. Niente inserimento automatico
  // nel campo giusto (servirebbe cursore/selezione per ognuno dei
  // moltissimi campi di testo di questo editor, sproporzionato) — l'admin
  // incolla dove vuole, stesso principio già accettato altrove qui.
  const [bindingModule, setBindingModule] = useState('')
  const [bindingRecords, setBindingRecords] = useState([])
  const [bindingRecordId, setBindingRecordId] = useState('')
  const [bindingCopied, setBindingCopied] = useState('')
  // Canvas WYSIWYG, fase A (2026-09-05, piano approvato) — selezionare un
  // blocco nel canvas evidenzia e raggiunge la sua card nella sidebar,
  // invece di doverla cercare a memoria scorrendo la lista. Resta
  // evidenziata finché non se ne seleziona un'altra (nessun timer da
  // gestire/pulire, coerente con la selezione persistente di Elementor/Divi
  // invece di un lampeggio a tempo).
  const [selectedBlockIdx, setSelectedBlockIdx] = useState(null)
  // Multi-selezione (2026-09-05, "abbiamo Divi?" — fase 4) — Set di
  // blockPath (stringhe, mai indici), accanto a selectedBlockIdx (invariato,
  // resta la singola card evidenziata/raggiunta nella sidebar).
  const [multiSelected, setMultiSelected] = useState(() => new Set())
  const blockRefs = React.useRef([])
  // Undo di sessione, Ctrl/Cmd+Z (2026-09-05, canvas WYSIWYG fase E) — uno
  // stack di snapshot di blocks_json in un ref (mai persistito, si perde
  // ricaricando la pagina — la cronologia VERA, tra salvataggi, resta
  // site_page_revisions lato server). undoAnchorRef cattura lo stato SOLO
  // alla prima modifica di una raffica ravvicinata (es. ogni tasto premuto
  // scrivendo una frase) — un solo passo di undo per l'intera raffica,
  // stesso principio del debounce da 600ms già in uso per l'anteprima live.
  const undoStackRef = React.useRef([])
  const prevBlocksRef = React.useRef(null)
  const undoAnchorRef = React.useRef(null)
  const undoDebounceRef = React.useRef(null)

  useEffect(() => {
    api.get('/site-pages/' + pageId).then(setPage)
    setSelectedBlockIdx(null); setMultiSelected(new Set()); blockRefs.current = []
    undoStackRef.current = []; prevBlocksRef.current = null; undoAnchorRef.current = null
    if (undoDebounceRef.current) clearTimeout(undoDebounceRef.current)
  }, [pageId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!page) return
    if (prevBlocksRef.current === null) { prevBlocksRef.current = page.blocks_json; return }
    if (prevBlocksRef.current === page.blocks_json) return // stesso riferimento, nessuna modifica reale
    if (undoAnchorRef.current === null) undoAnchorRef.current = prevBlocksRef.current
    prevBlocksRef.current = page.blocks_json
    if (undoDebounceRef.current) clearTimeout(undoDebounceRef.current)
    undoDebounceRef.current = setTimeout(() => {
      undoStackRef.current.push(undoAnchorRef.current)
      if (undoStackRef.current.length > 50) undoStackRef.current.shift()
      undoAnchorRef.current = null
    }, 600)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page && page.blocks_json])

  // undo() estratta a parte (2026-09-05) — usata sia da Ctrl/Cmd+Z sia dal
  // pulsante "Annulla" in toolbar: un tasto solo ha scarsa scopribilità,
  // stesso principio già seguito per ogni altra azione di questo editor
  // (mai solo una scorciatoia senza un pulsante visibile equivalente).
  const undo = () => {
    if (undoDebounceRef.current && undoAnchorRef.current !== null) {
      clearTimeout(undoDebounceRef.current)
      undoStackRef.current.push(undoAnchorRef.current)
      undoAnchorRef.current = null
    }
    const prevSnapshot = undoStackRef.current.pop()
    if (prevSnapshot === undefined) return
    prevBlocksRef.current = prevSnapshot
    setPage((p) => p && ({ ...p, blocks_json: prevSnapshot }))
  }

  useEffect(() => {
    function onKeyDown(e) {
      if (!((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z')) return
      // Dentro un campo di testo della sidebar (input/textarea), l'utente
      // si aspetta l'undo NATIVO del browser su QUEL campo, non un salto
      // indietro di un intero passo dei blocchi — un contenteditable dentro
      // l'iframe del canvas è un documento separato, questo listener non lo
      // vede mai (nessun conflitto, l'undo nativo lì funziona già da solo).
      const tag = document.activeElement && document.activeElement.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      e.preventDefault()
      undo()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!showPreview || !page) return
    if (skipNextFetchRef.current) { skipNextFetchRef.current = false; return }
    setPreviewLoading(true)
    const t = setTimeout(() => {
      api.post('/site-pages/preview', { title: page.title, blocks_json: page.blocks_json, accent_color: page.accent_color, font_style: page.font_style })
        .then((res) => { if (res.ok) setPreviewHtml(res.data.html) })
        .finally(() => setPreviewLoading(false))
    }, 600)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPreview, page])

  // Click-to-edit (2026-09-04) — riceve gli edit fatti direttamente nel
  // canvas (vedi editAttrs() in site-renderer.js) e li scrive nello stato
  // React, così "Salva" li cattura — senza toccare `page` tramite setPage
  // diretto (che farebbe ripartire il fetch sopra), passa da un update
  // immutabile con skipNextFetchRef alzato prima. `field` può essere un nome
  // semplice ("title") o un percorso puntato dentro un array ("steps.2.titolo",
  // "items.0.eyebrow") — timeline/valori hanno più elementi ripetuti, non un
  // solo campo scalare per blocco.
  useEffect(() => {
    if (!showPreview) return
    function onMessage(e) {
      if (!e.data || e.data.source !== 'sitoweb-preview') return
      // Drag diretto nel canvas (2026-09-04) — a differenza di un edit di
      // testo (già visibile via contenteditable, mai un reload dell'iframe),
      // un riordino CAMBIA visivamente il layout: qui skipNextFetchRef resta
      // basso di proposito, l'effect sopra deve ricaricare l'anteprima con
      // il nuovo ordine reale.
      // Path-aware (2026-09-05, canvas WYSIWYG fase C) — from/to erano
      // sempre indici piatti prima di questo pezzo; ora possono essere un
      // percorso composto ("1.c0.b0") per un blocco annidato. Riordino
      // ammesso SOLO tra fratelli dello stesso contenitore (containerKeyOf
      // uguale) — spostare un blocco DA un contenitore ALL'ALTRO (es. da
      // una colonna al livello di primo livello, o tra due righe diverse)
      // resta fuori scope per questo pezzo, ignorato silenziosamente
      // invece di tentare una mutazione che rischierebbe di essere sbagliata.
      if (e.data.type === 'reorder') {
        const { from, to } = e.data
        if (from === to || containerKeyOf(from) !== containerKeyOf(to)) return
        setPage((prev) => {
          if (!prev) return prev
          const toIdx = lastIndexOf(to)
          const blocks_json = updateBlocksAtPath(prev.blocks_json, from, (list, fromIdx) => {
            if (!list[fromIdx]) return list
            const copy = [...list]
            const [moved] = copy.splice(fromIdx, 1)
            copy.splice(Math.max(0, Math.min(toIdx, copy.length)), 0, moved)
            return copy
          })
          return { ...prev, blocks_json }
        })
        return
      }
      // Trascinare un blocco nuovo dal pannello (2026-09-05) — simmetrico al
      // riordino sopra, ma inserisce invece di spostare: il pannello dei
      // pulsanti "+ tipo" vive in QUESTO documento (fuori dall'iframe), la
      // zona di drop invece è dentro l'iframe (site-renderer.js) — vedi il
      // commento lì sul dataTransfer nativo come unico canale possibile.
      // Path-aware (fase C): "at" può essere un percorso composto — in quel
      // caso il nuovo blocco entra nello STESSO contenitore del blocco su
      // cui si è rilasciato, alla sua posizione (mai in un contenitore
      // diverso, stesso limite del riordino sopra).
      if (e.data.type === 'insert-block') {
        insertBlockAt(e.data.at, e.data.blockType)
        return
      }
      // "+" tra due blocchi (2026-09-05, canvas WYSIWYG fase D) — apre un
      // piccolo popover di scelta tipo (stessa lista BASE_BLOCK_TYPES della
      // sidebar), la selezione chiama insertBlockAt esattamente come il
      // drag dalla sidebar sopra — nessuna logica di inserimento duplicata.
      if (e.data.type === 'open-block-picker') {
        setBlockPickerAt(e.data.at)
        return
      }
      // Toolbar fluttuante nel canvas (2026-09-05, "avanti con Divi" —
      // canvas WYSIWYG, primo pezzo: gestire un blocco DIRETTAMENTE dove lo
      // si guarda, non scorrendo la sidebar per trovare la sua card). Stesso
      // aggiornamento funzionale (setPage(prev => ...)) di reorder/insert-
      // block sopra: questo effect dipende solo da showPreview, quindi
      // `page` catturato dalla closure del componente sarebbe una copia
      // potenzialmente non aggiornata — mai leggerlo qui direttamente.
      // Elimina chiede conferma PRIMA di aggiornare lo stato (un intero
      // blocco, potenzialmente con molto contenuto, non un singolo campo);
      // duplica/sposta sono reversibili al volo, nessuna conferma.
      if (e.data.type === 'block-action') {
        const { action, idx } = e.data
        // Seleziona (2026-09-05, canvas WYSIWYG fase A, esteso in fase C) —
        // non tocca page/blocks_json, solo quale card evidenziare nella
        // sidebar. Per un blocco annidato (idx tipo "1.c0.b0") si evidenzia/
        // raggiunge la card della riga di primo livello che lo contiene —
        // non esiste ancora un ref per la card del singolo figlio dentro il
        // form della riga (renderizzata dinamicamente da BlockEditor),
        // approssimazione onesta finché non serve di più.
        // Multi-selezione (2026-09-05, "abbiamo Divi?" — fase 4) — Ctrl/Cmd+
        // click aggiunge/rimuove idx dal set invece di sostituire la
        // selezione singola (comportamento standard di file manager). Un
        // click semplice mentre un gruppo è attivo lo azzera — stesso
        // principio: la selezione singola ha sempre la precedenza su un
        // click "pulito", niente stato multiplo fantasma dopo.
        if (action === 'select') {
          if (e.data.multi) {
            setMultiSelected((prev) => {
              const next = new Set(prev)
              const key = String(idx)
              if (next.has(key)) next.delete(key); else next.add(key)
              return next
            })
            return
          }
          setSelectedBlockIdx(idx)
          setMultiSelected(new Set())
          const topIdx = parseInt(String(idx).split('.')[0], 10)
          const el = blockRefs.current[topIdx]
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
          return
        }
        if (action === 'delete' && !window.confirm('Eliminare questo blocco?')) return
        // Path-aware (2026-09-05, canvas WYSIWYG fase C) — idx era sempre un
        // indice piatto prima di questo pezzo; updateBlocksAtPath opera
        // identicamente su un blocco di primo livello ("1", nessun punto,
        // stesso comportamento di sempre) o annidato ("1.c0.b0").
        setPage((prev) => {
          if (!prev) return prev
          const blocks_json = updateBlocksAtPath(prev.blocks_json, idx, (list, i) => {
            if (!list[i]) return list
            const copy = [...list]
            if (action === 'duplicate') {
              copy.splice(i + 1, 0, JSON.parse(JSON.stringify(copy[i])))
            } else if (action === 'delete') {
              copy.splice(i, 1)
            } else if (action === 'move-up' && i > 0) {
              const tmp = copy[i - 1]; copy[i - 1] = copy[i]; copy[i] = tmp
            } else if (action === 'move-down' && i < copy.length - 1) {
              const tmp = copy[i + 1]; copy[i + 1] = copy[i]; copy[i] = tmp
            } else {
              return list
            }
            return copy
          })
          return { ...prev, blocks_json }
        })
        return
      }
      // Immagini e URL cliccabili (2026-09-04) — stesso popover per
      // entrambi (kind cambia solo l'etichetta mostrata), apre senza
      // toccare ancora lo stato React: il valore si scrive solo confermando
      // (vedi il pulsante "Applica" più sotto nel render), non al click.
      // `field` può essere un percorso punteggiato (nav_links.0.url) o un
      // nome semplice (image_url) — setDeep gestisce entrambi allo stesso
      // modo, nessuna distinzione necessaria qui.
      if (e.data.type === 'image-click' || e.data.type === 'url-click') {
        setImagePopup({ kind: e.data.type === 'url-click' ? 'url' : 'image', block: e.data.block, field: e.data.field, value: e.data.value || '' })
        return
      }
      // Icona cliccabile (2026-09-05, canvas WYSIWYG fase B) — stesso
      // popover di image/url-click (imagePopup), un ramo di rendering in
      // più (griglia di icone invece di un campo URL) invece di uno stato
      // separato: "Applica" scrive con lo stesso setDeep, nessuna
      // duplicazione della logica di scrittura.
      if (e.data.type === 'icon-click') {
        setImagePopup({ kind: 'icon', block: e.data.block, field: e.data.field, value: e.data.value || '' })
        return
      }
      // Aggiungi/rimuovi voce di lista (2026-09-05, canvas WYSIWYG fase B) —
      // stesso aggiornamento funzionale di ogni altro handler qui sopra.
      // Una voce aggiunta è un oggetto vuoto: il placeholder icona/i campi
      // di testo vuoti nel canvas guidano subito verso cosa compilare,
      // senza bisogno di valori segnaposto scritti a mano (mai dati finti).
      // getDeep/setDeep, non config[field] diretto (2026-09-05, bug reale —
      // stesso principio già seguito per image/url/icon-click): field porta
      // il fieldPrefix completo per un blocco annidato ("columns.0.blocks.
      // 0.config.items"), config[field] cercherebbe letteralmente quella
      // chiave invece di attraversare il percorso.
      if (e.data.type === 'array-item-action') {
        const { action, block, field, idx } = e.data
        setPage((prev) => {
          if (!prev || !prev.blocks_json[block]) return prev
          const b = prev.blocks_json[block]
          const parts = field.split('.')
          const arr = [...(getDeep(b.config, parts) || [])]
          if (action === 'add') {
            arr.push({})
          } else if (action === 'remove' && idx !== null && idx !== undefined && arr[idx] !== undefined) {
            arr.splice(idx, 1)
          } else {
            return prev
          }
          const blocks = prev.blocks_json.map((bb, i2) => i2 === block ? { ...bb, config: setDeep(bb.config, parts, arr) } : bb)
          return { ...prev, blocks_json: blocks }
        })
        return
      }
      // Ridimensionamento colonne (2026-09-05) — un solo messaggio al
      // rilascio del mouse (vedi editableSyncScript() in site-renderer.js),
      // mai durante il drag stesso. Come 'reorder': il layout cambia
      // visivamente, skipNextFetchRef resta basso apposta così l'anteprima
      // si ricarica con le percentuali reali confermate dal server.
      // Path-aware (2026-09-05, canvas WYSIWYG fase C) — "block" era sempre
      // l'indice piatto della riga; ora è il suo blockPath reale, valido
      // anche per una riga ANNIDATA che ridimensiona le proprie colonne
      // (bug reale corretto lato server nella stessa fase: prima una riga
      // annidata scriveva sempre sulla riga ANTENATA, mai su se stessa).
      if (e.data.type === 'resize-col') {
        const { block, colIdx, widthA, widthB } = e.data
        setPage((prev) => {
          if (!prev) return prev
          const blocks_json = updateBlocksAtPath(prev.blocks_json, block, (list, idx) => {
            const b = list[idx]
            if (!b) return list
            const columns = (b.config.columns || []).map((col, i) =>
              i === colIdx ? { ...col, width: Math.round(widthA) } : i === colIdx + 1 ? { ...col, width: Math.round(widthB) } : col)
            const copy = [...list]
            copy[idx] = { ...b, config: { ...b.config, columns } }
            return copy
          })
          return { ...prev, blocks_json }
        })
        return
      }
      const { block, field, value } = e.data
      setPage((prev) => {
        if (!prev || !prev.blocks_json[block]) return prev
        skipNextFetchRef.current = true
        const blocks = prev.blocks_json.map((b, idx) => idx === block
          ? { ...b, config: setDeep(b.config, field.split('.'), value) }
          : b)
        return { ...prev, blocks_json: blocks }
      })
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [showPreview])

  // Carica lo schema di ogni modulo referenziato da un blocco griglia_prodotti già
  // presente, così l'editor mostra subito le select dei campi invece di un menu vuoto.
  useEffect(() => {
    if (!page) return
    const slugs = [...new Set(page.blocks_json.filter((b) => b.type === 'griglia_prodotti' && b.config?.source_module_slug).map((b) => b.config.source_module_slug))]
    slugs.forEach((slug) => {
      if (moduleFieldsBySlug[slug]) return
      api.get('/modules/' + slug).then((m) => {
        if (!m) return
        const schema = parseSchemaFrontend(m.schema_json)
        setModuleFieldsBySlug((prev) => ({ ...prev, [slug]: schema.fields || [] }))
      })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page])

  if (!page) return <div className="text-gray-500 text-sm">Caricamento…</div>

  const setBlocks = (blocks) => setPage({ ...page, blocks_json: blocks })
  const addBlock = (type) => setBlocks([...page.blocks_json, { type, config: emptyConfigFor(type) }])
  const addPreset = (preset) => setBlocks([...page.blocks_json, ...preset.blocks()])
  // insertBlockAt (2026-09-05, canvas WYSIWYG fase D) — estratta a parte
  // perché usata da DUE punti: il postMessage insert-block esistente (drag
  // dalla sidebar) e il nuovo popover di scelta tipo aperto dal "+" tra due
  // blocchi nel canvas. setPage funzionale anche qui, riusabile da un
  // effect futuro senza il rischio di una closure su `page` non aggiornata.
  const insertBlockAt = (at, blockType) => {
    const newBlock = { type: blockType, config: emptyConfigFor(blockType) }
    setPage((prev) => {
      if (!prev) return prev
      if (String(at).indexOf('.') === -1) {
        const blocks = [...prev.blocks_json]
        const idx = Math.max(0, Math.min(parseInt(at, 10), blocks.length))
        blocks.splice(idx, 0, newBlock)
        return { ...prev, blocks_json: blocks }
      }
      const blocks_json = updateBlocksAtPath(prev.blocks_json, at, (list, idx) => {
        const copy = [...list]
        copy.splice(Math.max(0, Math.min(idx, copy.length)), 0, newBlock)
        return copy
      })
      return { ...prev, blocks_json }
    })
  }
  const updateBlock = (i, block) => setBlocks(page.blocks_json.map((b, idx) => idx === i ? block : b))
  const removeBlock = (i) => setBlocks(page.blocks_json.filter((_, idx) => idx !== i))
  const moveBlock = (i, dir) => {
    const j = i + dir
    if (j < 0 || j >= page.blocks_json.length) return
    const copy = [...page.blocks_json]
      ;[copy[i], copy[j]] = [copy[j], copy[i]]
    setBlocks(copy)
  }
  // Riordino via drag-and-drop: sposta il blocco trascinato alla posizione del
  // blocco su cui viene rilasciato (non uno scambio a coppie come le frecce —
  // un drag reale salta direttamente alla posizione target).
  const moveBlockTo = (from, to) => {
    if (from === to) return
    const copy = [...page.blocks_json]
    const [moved] = copy.splice(from, 1)
    copy.splice(to, 0, moved)
    setBlocks(copy)
  }
  // Se un modulo prodotti viene scelto per la prima volta su questo blocco, carica
  // subito il suo schema (altrimenti le select campo_* restano vuote finché non si
  // ricarica la pagina).
  const updateBlockAndMaybeLoadSchema = (i, block) => {
    updateBlock(i, block)
    const slug = block.config?.source_module_slug
    if (slug && !moduleFieldsBySlug[slug]) {
      api.get('/modules/' + slug).then((m) => {
        if (!m) return
        const schema = parseSchemaFrontend(m.schema_json)
        setModuleFieldsBySlug((prev) => ({ ...prev, [slug]: schema.fields || [] }))
      })
    }
  }

  const save = async () => {
    setSaving(true)
    const res = await api.patch('/site-pages/' + page.id, { title: page.title, meta_description: page.meta_description, blocks_json: page.blocks_json, published: page.published, accent_color: page.accent_color, font_style: page.font_style, popup_json: page.popup_json || null })
    setSaving(false)
    if (res.ok) setPage({ ...res.data })
  }

  const toggleRevisions = async () => {
    const opening = openPanel !== 'cronologia'
    setOpenPanel(opening ? 'cronologia' : null)
    if (opening) setRevisions(await api.get('/site-pages/' + page.id + '/revisions') || [])
  }

  const pickBindingModule = async (slug) => {
    setBindingModule(slug)
    setBindingRecordId('')
    setBindingRecords(slug ? (await api.get('/records/' + slug) || []) : [])
  }
  const copyBindingToken = async (field) => {
    const token = `{{bind:${bindingModule}:${bindingRecordId}:${field}}}`
    try { await navigator.clipboard.writeText(token) } catch (e) { /* clipboard non disponibile, il token resta comunque visibile a schermo */ }
    setBindingCopied(field)
    setTimeout(() => setBindingCopied(''), 1500)
  }

  // Conferma esplicita (2026-09-05) — ripristinare sostituisce la bozza corrente
  // NON ancora salvata nel form (se l'admin stava modificando qualcosa senza
  // aver premuto "Salva", quel lavoro andrebbe perso silenziosamente altrimenti).
  // Il ripristino stesso resta comunque annullabile lato server (vedi site.js),
  // ma questo avviso è sulla bozza locale, che il server non vede affatto.
  const restoreRevision = async (revId) => {
    if (!window.confirm('Ripristinare questa versione? Le modifiche non salvate nel form andranno perse.')) return
    setRestoringId(revId)
    const res = await api.post('/site-pages/' + page.id + '/revisions/' + revId + '/restore', {})
    setRestoringId(null)
    if (res.ok) {
      setPage({ ...res.data })
      setRevisions(await api.get('/site-pages/' + page.id + '/revisions') || [])
    }
  }

  return (
    <div>
      <button onClick={onBack} className="text-xs text-gray-500 hover:text-gray-300 mb-4 flex items-center gap-1">
        <Icon name="chevron-left" size={12} />Tutte le pagine
      </button>

      <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
        <input value={page.title} onChange={(e) => setPage({ ...page, title: e.target.value })}
          className="text-lg font-bold bg-transparent border-b border-gray-800 focus:border-accent outline-none text-ink flex-1 min-w-[200px]" />
        <div className="flex items-center gap-2">
          <button onClick={() => setShowPreview((s) => !s)}
            className={'text-xs px-2.5 py-1.5 rounded-lg transition flex items-center gap-1 ' + (showPreview ? 'bg-accent text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700')}>
            <Icon name="eye" size={12} />Anteprima live
          </button>
          <a href={'/negozio/' + page.slug} target="_blank" rel="noreferrer"
            className="text-xs px-2.5 py-1.5 rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 transition flex items-center gap-1">
            <Icon name="external-link" size={12} />Pagina pubblicata
          </a>
          <label className="flex items-center gap-1.5 text-xs text-gray-400">
            <input type="checkbox" checked={!!page.published} onChange={(e) => setPage({ ...page, published: e.target.checked })} />
            Pubblicata
          </label>
          {/* Annulla (2026-09-05, canvas WYSIWYG fase E) — stessa azione di
              Ctrl/Cmd+Z, pulsante visibile perché un tasto solo ha scarsa
              scopribilità. Resta abilitato anche a pila vuota (undo() non
              fa nulla in quel caso, nessun errore) — tracciare lo stato
              esatto della pila richiederebbe stato React sincronizzato con
              un ref aggiornato fuori dal ciclo di render, sproporzionato
              per un pulsante che al peggio non fa nulla se cliccato a vuoto. */}
          <button onClick={undo} title="Annulla l'ultima modifica (Ctrl/Cmd+Z)"
            className="text-xs px-2.5 py-1.5 rounded-lg transition flex items-center gap-1 bg-gray-800 text-gray-300 hover:bg-gray-700">
            <Icon name="undo" size={12} />Annulla
          </button>
          <button onClick={save} disabled={saving} className="text-sm bg-accent hover:bg-accent/90 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg transition">
            {saving ? 'Salvo…' : 'Salva'}
          </button>
        </div>
      </div>

      {/* Bento "cosa fare qui" (2026-09-06, segnalato dall'utente: "sito web
          è ancora poco chiara, vorrei dei bento vari che mi facciano
          capire in pochi istanti cosa fare") — Cronologia/Popup/Valori
          dinamici erano tre bottoni piatti in mezzo a una fila di 8 senza
          nessuna gerarchia. Anteprima/Pubblicata/Annulla/Salva restano
          sopra (azioni dirette o stato ambientale, non pannelli di
          dettaglio) — solo questi tre aprono un pannello sotto, un tile
          alla volta, stesso pattern già in uso altrove sulla piattaforma. */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-4">
        <Tile icon="clock" label="Cronologia" color="#06B6D4" active={openPanel === 'cronologia'} onClick={toggleRevisions}
          value={revisions.length ? revisions.length + ' revision' + (revisions.length === 1 ? 'e' : 'i') : 'Nessuna ancora'}
          sub="Ripristina una versione precedente" />
        <Tile icon="bell" label="Popup" color="#A855F7" active={openPanel === 'popup'} onClick={() => setOpenPanel((p) => p === 'popup' ? null : 'popup')}
          value={page.popup_json && page.popup_json.enabled ? 'Attivo' : 'Non attivo'}
          sub="Messaggio a comparsa sulla pagina" />
        <Tile icon="database" label="Valori dinamici" color="#F59E0B" active={openPanel === 'binding'} onClick={() => setOpenPanel((p) => p === 'binding' ? null : 'binding')}
          value="Da un modulo" sub="Copia un dato reale in un campo di testo" />
      </div>

      {/* Popup (2026-09-05, "andiamo avanti con Divi") — stato locale come
          title/blocks_json, persiste solo al "Salva" della pagina (nessun
          salvataggio a parte, coerente col resto dell'editor). */}
      {openPanel === 'popup' && (
        <div className="glass-panel mb-4 p-4">
          <PopupEditor popup={page.popup_json} onChange={(p) => setPage({ ...page, popup_json: p })} />
        </div>
      )}

      {/* Valori dinamici (2026-09-05, "abbiamo Divi?" — fase 2) — scegli
          modulo -> record -> campo, copia il token {{bind:...}} negli
          appunti. L'admin lo incolla dove vuole (titolo, testo, qualunque
          campo) — nessun inserimento automatico, servirebbe gestire
          cursore/selezione per ognuno dei moltissimi campi di questo
          editor, sproporzionato per il valore che aggiungerebbe. */}
      {openPanel === 'binding' && (
        <div className="glass-panel mb-4 p-4">
          <div className="text-sm font-semibold text-ink mb-1">Valori dinamici</div>
          <p className="text-[11px] text-gray-500 mb-3">Incolla il token copiato in QUALSIASI campo di testo (titolo, testo, ecc.) — verrà sostituito col dato reale e sempre aggiornato di quel record, non una copia congelata.</p>
          <div className="grid sm:grid-cols-2 gap-2 mb-2">
            <label className="block">
              <div className="text-xs text-gray-500 mb-1">Modulo</div>
              <select value={bindingModule} onChange={(e) => pickBindingModule(e.target.value)} className="w-full bg-surface-input border border-gray-800 rounded-md px-2.5 py-1.5 text-sm text-ink">
                <option value="">— scegli —</option>
                {installedModules.map((m) => <option key={m.slug} value={m.slug}>{m.name}</option>)}
              </select>
            </label>
            {bindingModule && (
              <label className="block">
                <div className="text-xs text-gray-500 mb-1">Record</div>
                <select value={bindingRecordId} onChange={(e) => setBindingRecordId(e.target.value)} className="w-full bg-surface-input border border-gray-800 rounded-md px-2.5 py-1.5 text-sm text-ink">
                  <option value="">— scegli —</option>
                  {bindingRecords.map((r) => <option key={r.id} value={r.id}>#{r.id} — {Object.values(r.data || {}).find((v) => typeof v === 'string' && v) || '(senza nome)'}</option>)}
                </select>
              </label>
            )}
          </div>
          {bindingRecordId && (
            <div className="flex flex-wrap gap-1.5">
              {Object.keys((bindingRecords.find((r) => String(r.id) === String(bindingRecordId)) || {}).data || {}).map((field) => (
                <button key={field} type="button" onClick={() => copyBindingToken(field)}
                  className="text-[11px] px-2 py-1 rounded-md bg-gray-800 hover:bg-gray-700 text-gray-300 transition">
                  {bindingCopied === field ? 'Copiato ✓' : `Copia "${field}"`}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Cronologia/autosave (2026-09-05, "andiamo avanti con Divi") — una
          revisione per ogni salvataggio che ha DAVVERO cambiato blocks_json
          (site.js), non un log di ogni tasto premuto. Ripristinare è a sua
          volta annullabile (il server crea una nuova revisione), quindi
          nessun avviso "azione irreversibile" qui — solo la conferma sulla
          bozza locale non salvata, l'unica cosa che davvero si perderebbe. */}
      {openPanel === 'cronologia' && (
        <div className="glass-panel overflow-hidden mb-4">
          <div className="px-4 py-2 border-b border-gray-800">
            <span className="text-xs font-semibold text-ink">Cronologia delle revisioni</span>
          </div>
          <div className="max-h-64 overflow-y-auto divide-y divide-gray-800">
            {revisions.length === 0 && <div className="px-4 py-3 text-xs text-gray-500">Nessuna revisione ancora — compare dopo il primo "Salva" che cambia il contenuto.</div>}
            {revisions.map((r) => (
              <div key={r.id} className="px-4 py-2 flex items-center justify-between gap-3 text-xs">
                <div className="min-w-0">
                  <div className="text-ink truncate">{new Date(r.created_at).toLocaleString('it-IT')}</div>
                  {r.created_by && <div className="text-gray-500">{r.created_by}</div>}
                </div>
                <button onClick={() => restoreRevision(r.id)} disabled={restoringId === r.id}
                  className="flex-shrink-0 text-[11px] px-2 py-1 rounded-md bg-gray-800 hover:bg-gray-700 text-gray-300 disabled:opacity-50 transition">
                  {restoringId === r.id ? 'Ripristino…' : 'Ripristina'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {showPreview && (
        <div className="glass-panel mb-4 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800">
            <span className="text-xs font-semibold text-ink">Anteprima live — bozza non salvata</span>
            <div className="flex items-center gap-2">
              {previewLoading && <span className="text-[11px] text-gray-500">aggiorno…</span>}
              <div className="flex items-center gap-1 bg-gray-900 rounded-lg p-0.5">
                {[['desktop', 'monitor'], ['tablet', 'tablet'], ['mobile', 'smartphone']].map(([d, icon]) => (
                  <button key={d} onClick={() => setPreviewDevice(d)} title={d}
                    className={'px-2 py-1 rounded-md transition ' + (previewDevice === d ? 'bg-accent text-white' : 'text-gray-400 hover:text-gray-200')}>
                    <Icon name={icon} size={13} />
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="bg-gray-950 flex justify-center overflow-x-auto py-3">
            <iframe title="Anteprima live" srcDoc={previewHtml} className="bg-white transition-all" style={{ height: '70vh', border: 0, width: PREVIEW_WIDTHS[previewDevice], maxWidth: '100%', flexShrink: 0 }} />
          </div>
        </div>
      )}

      {/* "+" tra due blocchi (2026-09-05, canvas WYSIWYG fase D) — stessa
          lista tipi dei pulsanti "+ tipo" della sidebar, la scelta chiama
          insertBlockAt esattamente come il drag dalla sidebar. */}
      {blockPickerAt !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setBlockPickerAt(null)}>
          <div className="bg-surface-card border border-gray-800 rounded-md p-4 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="text-sm font-semibold text-ink mb-3">Inserisci un blocco</div>
            <div className="flex flex-wrap gap-1.5">
              {insertableBlockTypes.map((t) => (
                <button key={t.type} type="button"
                  onClick={() => { insertBlockAt(blockPickerAt, t.type); setBlockPickerAt(null) }}
                  className="text-xs px-2.5 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 transition">
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {imagePopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setImagePopup(null)}>
          <div className="bg-surface-card border border-gray-800 rounded-md p-4 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="text-sm font-semibold text-ink mb-3">{imagePopup.kind === 'url' ? 'Cambia link' : imagePopup.kind === 'icon' ? 'Scegli icona' : 'Cambia immagine'}</div>
            {imagePopup.kind !== 'url' && imagePopup.kind !== 'icon' && imagePopup.value && <img src={imagePopup.value} alt="" className="w-full h-32 object-cover rounded-md mb-3 border border-gray-800" />}
            {imagePopup.kind !== 'url' && imagePopup.kind !== 'icon' && (
              <label className="block mb-2">
                <div className="text-xs text-gray-500 mb-1">Carica da computer</div>
                <input type="file" accept="image/*" className="w-full text-xs text-gray-400"
                  onChange={(e) => {
                    const file = e.target.files && e.target.files[0]
                    if (!file) return
                    const reader = new FileReader()
                    reader.onload = () => setImagePopup((prev) => prev && ({ ...prev, value: reader.result }))
                    reader.readAsDataURL(file)
                  }} />
              </label>
            )}
            {/* Griglia di chiavi testuali (2026-09-05, canvas WYSIWYG fase B),
                non un'anteprima grafica: coerente con l'unico altro punto
                dove si sceglie un'icona oggi (la textarea a DSL della
                sidebar elenca le stesse chiavi come testo puro) — le icone
                vere sono SVG minimi definiti solo lato server
                (site-renderer.js), non condivisi col set lucide di questa
                UI admin, marcarle diversamente avrebbe rischiato di
                confondere più che aiutare. */}
            {imagePopup.kind === 'icon' && (
              <div className="grid grid-cols-3 gap-1.5 mb-3">
                {ICON_KEYS.map((k) => (
                  <button key={k} type="button" onClick={() => setImagePopup({ ...imagePopup, value: k })}
                    className={'text-xs px-2 py-1.5 rounded-md transition ' + (imagePopup.value === k ? 'bg-accent text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700')}>
                    {k}
                  </button>
                ))}
                <button type="button" onClick={() => setImagePopup({ ...imagePopup, value: '' })}
                  className={'text-xs px-2 py-1.5 rounded-md transition ' + (!imagePopup.value ? 'bg-accent text-white' : 'bg-gray-800 text-gray-300 hover:bg-gray-700')}>
                  nessuna
                </button>
              </div>
            )}
            {imagePopup.kind !== 'icon' &&
              <Field label={imagePopup.kind === 'url' ? 'URL destinazione' : 'oppure incolla un URL immagine'} value={imagePopup.value} onChange={(v) => setImagePopup({ ...imagePopup, value: v })} placeholder={imagePopup.kind === 'url' ? '#contatti oppure https://...' : 'https://.../foto.jpg'} />}
            <div className="flex items-center justify-end gap-2 mt-3">
              <button onClick={() => setImagePopup(null)} className="text-xs px-3 py-1.5 rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 transition">Annulla</button>
              <button
                onClick={() => {
                  const { block, field, value } = imagePopup
                  // setDeep gestisce sia un percorso semplice (image_url) sia
                  // punteggiato (nav_links.0.url) allo stesso modo.
                  setPage((prev) => ({ ...prev, blocks_json: prev.blocks_json.map((b, idx) => idx === block ? { ...b, config: setDeep(b.config, field.split('.'), value) } : b) }))
                  setImagePopup(null)
                }}
                className="text-xs px-3 py-1.5 rounded-lg bg-accent text-white hover:bg-accent/90 transition">
                Applica
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="glass-panel p-4 mb-4">
        <div className="text-xs font-semibold text-ink mb-3">SEO</div>
        <Field label="Meta description (mostrata nei risultati di ricerca)" value={page.meta_description} onChange={(v) => setPage({ ...page, meta_description: v })} textarea />
      </div>

      <div className="glass-panel p-4 mb-4">
        <div className="text-xs font-semibold text-ink mb-3">Aspetto</div>
        <div className="flex items-end gap-4 flex-wrap">
          <label className="block">
            <div className="text-xs text-gray-500 mb-1">Colore d'accento</div>
            <input type="color" value={page.accent_color || '#2563EB'} onChange={(e) => setPage({ ...page, accent_color: e.target.value })} className="w-16 h-8 bg-transparent border border-gray-800 rounded cursor-pointer" />
          </label>
          <label className="block">
            <div className="text-xs text-gray-500 mb-1">Stile testo</div>
            <select value={page.font_style || 'sans'} onChange={(e) => setPage({ ...page, font_style: e.target.value })} className="bg-surface-input border border-gray-800 rounded-md px-2.5 py-1.5 text-sm text-ink">
              <option value="sans">Moderno (sans-serif)</option>
              <option value="serif">Editoriale (serif di sistema)</option>
              <option value="editorial">Editoriale premium (Fraunces + Inter)</option>
              <option value="dm_serif">Artigianale moderno (DM Serif Display + DM Sans)</option>
            </select>
          </label>
        </div>
      </div>

      {/* Multi-selezione (2026-09-05, "abbiamo Divi?" — fase 4) — compare
          solo con 2+ blocchi selezionati (Ctrl/Cmd+click sul ⚙ nel canvas).
          Solo duplica/elimina, mai riordino di gruppo (fuori scope, vedi
          applyMultiAction). */}
      {multiSelected.size > 1 && (
        <div className="flex items-center gap-3 bg-accent/10 border border-accent/40 rounded-md px-3 py-2 mb-3 text-xs">
          <span className="font-medium text-ink">{multiSelected.size} blocchi selezionati</span>
          <button onClick={() => {
            setPage((prev) => prev && ({ ...prev, blocks_json: applyMultiAction(prev.blocks_json, [...multiSelected], 'duplicate') }))
            setMultiSelected(new Set())
          }} className="px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-200 transition">Duplica tutti</button>
          <button onClick={() => {
            if (!window.confirm(`Eliminare ${multiSelected.size} blocchi?`)) return
            setPage((prev) => prev && ({ ...prev, blocks_json: applyMultiAction(prev.blocks_json, [...multiSelected], 'delete') }))
            setMultiSelected(new Set())
          }} className="px-2 py-1 rounded bg-gray-800 hover:bg-red-900/40 text-red-300 transition">Elimina tutti</button>
          <button onClick={() => setMultiSelected(new Set())} className="ml-auto text-gray-400 hover:text-gray-200">Deseleziona</button>
        </div>
      )}

      <div className="space-y-3 mb-4">
        {page.blocks_json.map((b, i) => (
          <div key={i}
            ref={(el) => { blockRefs.current[i] = el }}
            draggable
            onDragStart={() => setDraggedIdx(i)}
            onDragEnd={() => { setDraggedIdx(null); setDragOverIdx(null) }}
            onDragOver={(e) => { e.preventDefault(); if (draggedIdx !== null && draggedIdx !== i) setDragOverIdx(i) }}
            onDrop={(e) => { e.preventDefault(); if (draggedIdx !== null) moveBlockTo(draggedIdx, i); setDraggedIdx(null); setDragOverIdx(null) }}
            className={'bg-surface-card border rounded-md p-4 transition '
              + (b.hidden ? 'opacity-50 ' : '')
              // String(...) (2026-09-05, canvas WYSIWYG fase C): selectedBlockIdx
              // arriva sempre come stringa dal canvas (anche per un blocco di
              // primo livello, es. "0"), `i` qui è un numero — confronto diretto
              // fallirebbe sempre. startsWith copre anche un figlio annidato
              // selezionato (es. "1.c0.b0"): evidenzia la riga che lo contiene.
              + (selectedBlockIdx != null && (String(selectedBlockIdx) === String(i) || String(selectedBlockIdx).startsWith(i + '.')) ? 'ring-2 ring-accent ' : '')
              // Multi-selezione (2026-09-05, fase 4) — colore diverso
              // (ambra) dall'accento della selezione singola sopra, per non
              // confondere le due cose a colpo d'occhio quando coesistono.
              + ([...multiSelected].some((p) => p === String(i) || p.startsWith(i + '.')) ? 'ring-2 ring-amber-500 ' : '')
              + (draggedIdx === i ? 'opacity-30 border-gray-800 ' : dragOverIdx === i ? 'border-accent ' : 'border-gray-800 ')}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 min-w-0">
                <span className="cursor-grab active:cursor-grabbing text-gray-600 hover:text-gray-400 flex-shrink-0" title="Trascina per riordinare">
                  <Icon name="grip-vertical" size={14} />
                </span>
                <span className="text-sm font-medium text-ink truncate">{BASE_BLOCK_TYPES.find((t) => t.type === b.type)?.label || b.type}</span>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button onClick={() => updateBlock(i, { ...b, hidden: !b.hidden })}
                  title={b.hidden ? 'Nascosto — clicca per mostrare' : 'Visibile — clicca per nascondere'}
                  className={'p-1 rounded ' + (b.hidden ? 'bg-gray-700 text-amber-400' : 'hover:bg-gray-800 text-gray-400')}>
                  <Icon name={b.hidden ? 'eye-off' : 'eye'} size={14} />
                </button>
                <button onClick={() => updateBlock(i, { ...b, dark: !b.dark })}
                  title="Sezione scura" className={'p-1 rounded ' + (b.dark ? 'bg-gray-700 text-ink' : 'hover:bg-gray-800 text-gray-400')}>
                  <Icon name="moon" size={14} />
                </button>
                <button onClick={() => moveBlock(i, -1)} title="Sposta su" className="p-1 rounded hover:bg-gray-800 text-gray-400"><Icon name="chevron-up" size={14} /></button>
                <button onClick={() => moveBlock(i, 1)} title="Sposta giù" className="p-1 rounded hover:bg-gray-800 text-gray-400"><Icon name="chevron-down" size={14} /></button>
                <button onClick={() => removeBlock(i)} className="p-1 rounded hover:bg-red-900/30 text-gray-400 hover:text-red-400"><Icon name="trash" size={14} /></button>
              </div>
            </div>
            <label className="block mb-2">
              <div className="text-xs text-gray-500 mb-1">ID ancora (opzionale — per un link "#nome" da un altro blocco o dal menu)</div>
              <input value={b.anchor_id || ''} onChange={(e) => updateBlock(i, { ...b, anchor_id: e.target.value.trim() })} placeholder="es. contatti"
                className="w-full bg-surface-input border border-gray-800 rounded-md px-2.5 py-1.5 text-sm text-ink font-mono" />
            </label>
            <BlockEditor block={b} onChange={(nb) => updateBlockAndMaybeLoadSchema(i, nb)} moduleFieldsBySlug={moduleFieldsBySlug} installedModules={installedModules} />
            <BlockStyleEditor block={b} onChange={(nb) => updateBlock(i, nb)} />
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {insertableBlockTypes.map((t) => (
          <button key={t.type} onClick={() => addBlock(t.type)}
            draggable
            onDragStart={(e) => { e.dataTransfer.effectAllowed = 'copy'; e.dataTransfer.setData('text/plain', 'new-block:' + t.type) }}
            title="Trascina nel canvas per inserirlo in un punto preciso, o clicca per aggiungerlo in fondo"
            className="text-xs px-2.5 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 transition cursor-grab active:cursor-grabbing">
            + {t.label}
          </button>
        ))}
      </div>

      {/* Sezioni pronte (2026-09-05, "andiamo avanti con Divi") — inseriscono
          più blocchi vuoti insieme, alla fine della pagina (poi si riordina
          con le frecce/drag esistenti). Mai dati finti, solo struttura. */}
      <div className="mt-3 pt-3 border-t border-gray-800">
        <div className="text-[11px] text-gray-500 mb-2">Sezioni pronte — inseriscono più blocchi insieme, vuoti da compilare</div>
        <div className="flex items-center gap-2 flex-wrap">
          {BLOCK_PRESETS.map((preset) => (
            <button key={preset.key} onClick={() => addPreset(preset)} title={preset.description}
              className="text-xs px-2.5 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 transition flex items-center gap-1.5">
              <Icon name="layout-template" size={12} />{preset.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// Theme Builder (2026-09-05, "settimane di riprogettazione" scelto
// dall'utente dopo il piano canvas WYSIWYG) — header/footer condivisi tra
// TUTTE le pagine, editati UNA VOLTA sola qui invece che pagina per
// pagina. Riusa BlockEditor identico a quello di una pagina (header/footer
// non leggono moduleFieldsBySlug/installedModules, omessi qui a ragion
// veduta) — zero form nuovo da scrivere.
function ThemeEditor({ api, onBack }) {
  const [theme, setTheme] = useState(null)
  const [pages, setPages] = useState([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.get('/site-pages/theme').then(setTheme)
    api.get('/site-pages').then((p) => setPages(p || []))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (!theme) return <div className="text-gray-500 text-sm">Caricamento…</div>

  const save = async () => {
    setSaving(true)
    const res = await api.patch('/site-pages/theme', { header: theme.header, footer: theme.footer, design_tokens: theme.design_tokens || {}, scroll_progress: !!theme.scroll_progress, hover_effects: !!theme.hover_effects, eyebrow_swoosh: !!theme.eyebrow_swoosh })
    setSaving(false)
    if (res.ok) setTheme(res.data)
  }
  const setToken = (key, value) => setTheme({ ...theme, design_tokens: { ...(theme.design_tokens || {}), [key]: value } })

  // Migrazione volontaria (2026-09-05) — MAI automatica: copia il blocco
  // di QUELLA pagina nel Tema e lo rimuove da ogni pagina (fatto lato
  // server, un'unica azione atomica — vedi POST /theme/adopt-from/:id).
  const adopt = async (pageId, kind) => {
    const res = await api.post('/site-pages/theme/adopt-from/' + pageId, { kind })
    if (!res.ok) { alert(res.data?.error || 'Questa pagina non ha un blocco di quel tipo'); return }
    setTheme(await api.get('/site-pages/theme'))
  }

  return (
    <div>
      <button onClick={onBack} className="text-xs text-gray-500 hover:text-gray-300 mb-4 flex items-center gap-1">
        <Icon name="chevron-left" size={12} />Tutte le pagine
      </button>
      <h1 className="text-lg font-bold text-ink tracking-[-0.35px] mb-1 flex items-center gap-2">
        <Icon name="layout-template" size={17} />Tema
      </h1>
      <p className="text-gray-500 text-sm mb-6">Header, footer e colori condivisi da tutte le pagine — cambiarli qui li aggiorna ovunque, senza doverli modificare pagina per pagina.</p>

      <div className="glass-panel p-4 mb-4">
        <div className="text-sm font-semibold text-ink mb-1">Colori del Tema</div>
        <p className="text-[11px] text-gray-500 mb-3">Riutilizzabili da qualunque blocco (pulsanti "usa un colore del Tema" nello stile di un blocco) — cambiare un colore qui lo aggiorna ovunque sia stato usato, senza cercarlo blocco per blocco.</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {DESIGN_TOKEN_KEYS.map(([k, label]) => (
            <label key={k} className="block">
              <div className="text-xs text-gray-500 mb-1">{label}</div>
              <input type="color" value={(theme.design_tokens && theme.design_tokens[k]) || '#2563EB'}
                onChange={(e) => setToken(k, e.target.value)}
                className="w-full h-8 bg-transparent border border-gray-800 rounded cursor-pointer" />
            </label>
          ))}
        </div>
      </div>

      <div className="glass-panel p-4 mb-4">
        <div className="text-sm font-semibold text-ink mb-1">Effetti</div>
        <label className="flex items-center gap-1.5 text-xs text-gray-400 mb-2">
          <input type="checkbox" checked={!!theme.scroll_progress} onChange={(e) => setTheme({ ...theme, scroll_progress: e.target.checked })} />
          Barra di avanzamento scroll (linea in cima che si riempie mentre si scorre la pagina)
        </label>
        <label className="flex items-center gap-1.5 text-xs text-gray-400 mb-2">
          <input type="checkbox" checked={!!theme.hover_effects} onChange={(e) => setTheme({ ...theme, hover_effects: e.target.checked })} />
          Effetti al passaggio del mouse (spotlight sulle sezioni scure, inclinazione 3D sulle card prodotto, pulsanti che seguono il cursore — solo su desktop, mai su mobile/touch)
        </label>
        <label className="flex items-center gap-1.5 text-xs text-gray-400">
          <input type="checkbox" checked={!!theme.eyebrow_swoosh} onChange={(e) => setTheme({ ...theme, eyebrow_swoosh: e.target.checked })} />
          Sottolineatura decorativa disegnata sotto gli occhielli, quando la sezione entra in vista
        </label>
      </div>

      <div className="glass-panel p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-semibold text-ink">Intestazione (header)</div>
          <label className="flex items-center gap-1.5 text-xs text-gray-400">
            <input type="checkbox" checked={!!theme.header} onChange={(e) => setTheme({ ...theme, header: e.target.checked ? { type: 'header', config: {} } : null })} />
            Attivo
          </label>
        </div>
        {theme.header
          ? <BlockEditor block={theme.header} onChange={(h) => setTheme({ ...theme, header: h })} />
          : <div className="text-[11px] text-gray-600">Nessun header condiviso — attivalo qui sopra, oppure adottane uno già scritto in una pagina qui sotto.</div>}
      </div>

      <div className="glass-panel p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-semibold text-ink">Piè di pagina (footer)</div>
          <label className="flex items-center gap-1.5 text-xs text-gray-400">
            <input type="checkbox" checked={!!theme.footer} onChange={(e) => setTheme({ ...theme, footer: e.target.checked ? { type: 'footer', config: {} } : null })} />
            Attivo
          </label>
        </div>
        {theme.footer
          ? <BlockEditor block={theme.footer} onChange={(f) => setTheme({ ...theme, footer: f })} />
          : <div className="text-[11px] text-gray-600">Nessun footer condiviso — attivalo qui sopra, oppure adottane uno già scritto in una pagina qui sotto.</div>}
      </div>

      {pages.length > 0 && (
        <div className="glass-panel p-4 mb-4">
          <div className="text-xs font-semibold text-ink mb-1">Adotta da una pagina esistente</div>
          <p className="text-[11px] text-gray-500 mb-2">Se una pagina ha già un header/footer scritto a mano, copialo qui come Tema condiviso — verrà rimosso da quella pagina (e da ogni altra) una volta adottato.</p>
          <div className="flex flex-wrap gap-2">
            {pages.map((p) => (
              <div key={p.id} className="flex gap-1">
                <button onClick={() => adopt(p.id, 'header')} className="text-[11px] px-2 py-1 rounded-md bg-gray-800 hover:bg-gray-700 text-gray-300 transition">Header da "{p.title}"</button>
                <button onClick={() => adopt(p.id, 'footer')} className="text-[11px] px-2 py-1 rounded-md bg-gray-800 hover:bg-gray-700 text-gray-300 transition">Footer da "{p.title}"</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <button onClick={save} disabled={saving} className="text-sm bg-accent hover:bg-accent/90 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg transition">
        {saving ? 'Salvo…' : 'Salva Tema'}
      </button>
    </div>
  )
}

function SitoWebPage({ token }) {
  const api = useApi(token)
  const [pages, setPages] = useState(null)
  const [settings, setSettings] = useState(null)
  const [openPageId, setOpenPageId] = useState(null)
  const [openTheme, setOpenTheme] = useState(false)
  const [installedModules, setInstalledModules] = useState([])
  const [newSlug, setNewSlug] = useState('')
  const [newTitle, setNewTitle] = useState('')
  const [error, setError] = useState('')
  // Richieste ricevute (2026-09-05, piano Sito Web punto 4) — un form senza
  // un posto dove leggere le risposte non serve a niente: elenco globale (non
  // per-pagina, un tenant tipico ha un solo modulo di contatto comunque).
  const [leads, setLeads] = useState(null)
  // openTile (2026-09-06, segnalato dall'utente: "le sezioni sono poco
  // chiare e la UI non è intuitiva") — sostituisce il vecchio showLeads
  // isolato: stesso pattern "bento" già in uso in ImpostazioniPage.jsx e
  // TenantsPage.jsx (un tile alla volta aperto, un solo pannello di
  // dettaglio sotto la griglia), invece di card sciolte una sotto l'altra
  // senza un'intestazione che le raggruppi.
  const [openTile, setOpenTile] = useState(null)
  const toggleTile = (key) => setOpenTile((t) => (t === key ? null : key))

  const load = () => {
    api.get('/site-pages').then(setPages)
    api.get('/site-pages/settings').then((s) => s && setSettings(s))
    api.get('/site-pages/leads').then((l) => l && setLeads(l))
    api.get('/modules').then((mods) => {
      if (!mods) return
      setInstalledModules(mods.filter((m) => m.installed))
    })
  }
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const markLeadStatus = async (id, status) => {
    const res = await api.patch('/site-pages/leads/' + id, { status })
    if (res.ok) setLeads((prev) => prev.map((l) => l.id === id ? { ...l, status } : l))
  }

  const toggleSite = async (enabled) => {
    const res = await api.patch('/site-pages/settings', { site_enabled: enabled })
    if (res.ok) setSettings((s) => ({ ...s, site_enabled: enabled }))
  }

  const createPage = async () => {
    setError('')
    if (!newSlug.trim() || !newTitle.trim()) return
    const res = await api.post('/site-pages', { slug: newSlug.trim(), title: newTitle.trim() })
    if (res.ok) { setNewSlug(''); setNewTitle(''); load(); setOpenPageId(res.data.id) }
    else setError(res.data?.error || 'Errore nella creazione')
  }

  const deletePage = async (id) => {
    await api.del('/site-pages/' + id)
    load()
  }

  if (openPageId) {
    return <PageEditor token={token} pageId={openPageId} onBack={() => { setOpenPageId(null); load() }} installedModules={installedModules} api={api} />
  }
  if (openTheme) {
    return <ThemeEditor api={api} onBack={() => setOpenTheme(false)} />
  }

  return (
    <div>
      <h1 className="text-lg font-bold text-ink tracking-[-0.35px] mb-1 flex items-center gap-2">
        <Icon name="globe" size={17} />Sito Web
      </h1>
      <p className="text-gray-500 text-sm mb-6">Pagine pubbliche di base — nessun accesso richiesto per chi le visita, pensate anche per essere trovate dai motori di ricerca.</p>

      {settings && !settings.site_enabled && (
        <div className="rounded-md border border-gray-700 bg-gray-800/40 p-4 mb-4 flex items-center justify-between gap-3 flex-wrap">
          <span className="text-sm text-gray-300">Il Sito Web non è ancora attivo — le pagine restano invisibili al pubblico finché non lo accendi.</span>
          <button onClick={() => toggleSite(true)} className="text-sm bg-accent hover:bg-accent/90 text-white px-3 py-1.5 rounded-lg transition flex-shrink-0">Attiva</button>
        </div>
      )}
      {settings && !!settings.site_enabled && (
        <div className="rounded-md border border-green-800/50 bg-green-900/10 p-3 mb-4 flex items-center justify-between gap-3 flex-wrap text-sm text-green-300">
          <span className="flex items-center gap-2"><Icon name="check" size={14} />Sito Web attivo</span>
          <button onClick={() => toggleSite(false)} className="text-xs px-2.5 py-1 rounded-full bg-black/20 hover:bg-black/30 transition">Disattiva</button>
        </div>
      )}

      {/* Pagine (2026-09-06, segnalato dall'utente: "i contenuti vanno
          ordinati, le sezioni sono poco chiare") — è il contenuto
          PRIMARIO di questa schermata (l'elenco che si consulta e apre
          più spesso), promosso subito dopo lo stato attivo/non attivo
          invece di stare in fondo sotto tre card di impostazioni
          secondarie senza nessuna etichetta a separarle. */}
      <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Pagine</div>
      <div className="glass-panel divide-y divide-gray-800/70 mb-2">
        {pages && pages.length === 0 && <div className="text-gray-600 text-sm p-6">Nessuna pagina ancora — creane una qui sotto.</div>}
        {pages && pages.map((p) => (
          <div key={p.id} className="p-3.5 flex items-center justify-between gap-3">
            <button onClick={() => setOpenPageId(p.id)} className="text-left flex-1 min-w-0">
              <div className="text-sm text-ink font-medium">{p.title}</div>
              <div className="text-xs text-gray-600 font-mono">/negozio/{p.slug}</div>
            </button>
            <span className={'text-[10px] px-1.5 py-0.5 rounded ' + (p.published ? 'bg-green-900/30 text-green-400' : 'bg-gray-800 text-gray-500')}>
              {p.published ? 'Pubblicata' : 'Bozza'}
            </span>
            <button onClick={() => deletePage(p.id)} className="p-1.5 rounded hover:bg-red-900/30 text-gray-500 hover:text-red-400"><Icon name="trash" size={14} /></button>
          </div>
        ))}
      </div>

      <div className="glass-panel p-4 mb-6">
        <div className="text-xs font-semibold text-ink mb-3">Nuova pagina</div>
        {error && <div className="text-xs text-red-400 mb-2">{error}</div>}
        <div className="flex items-end gap-2 flex-wrap">
          <label className="block">
            <div className="text-xs text-gray-500 mb-1">Titolo</div>
            <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} className="bg-surface-input border border-gray-800 rounded-md px-2.5 py-1.5 text-sm text-ink" />
          </label>
          <label className="block">
            <div className="text-xs text-gray-500 mb-1">Indirizzo (es. "home")</div>
            <input value={newSlug} onChange={(e) => setNewSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} className="bg-surface-input border border-gray-800 rounded-md px-2.5 py-1.5 text-sm text-ink font-mono" />
          </label>
          <button onClick={createPage} className="text-sm bg-accent hover:bg-accent/90 text-white px-3 py-1.5 rounded-lg transition">Crea</button>
        </div>
      </div>

      {/* Personalizzazione e richieste — impostazioni SECONDARIE, raggruppate
          sotto un'etichetta e ridotte a bento (stesso pattern di
          ImpostazioniPage.jsx/TenantsPage.jsx: un tile alla volta aperto,
          niente più tre card sempre distese una sotto l'altra). */}
      <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Personalizzazione e richieste</div>
      <button onClick={() => setOpenTheme(true)}
        className="w-full glass-panel hover:bg-white/5 p-4 mb-3 flex items-center justify-between gap-3 transition text-left">
        <span className="flex items-center gap-2 text-sm font-semibold text-ink"><Icon name="layout-template" size={15} />Tema — header/footer condivisi tra le pagine</span>
        <Icon name="chevron-right" size={14} className="text-gray-500" />
      </button>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
        <Tile icon="inbox" label="Richieste ricevute" color="#F59E0B" active={openTile === 'richieste'} onClick={() => toggleTile('richieste')}
          value={leads ? `${leads.length} totali` : '—'}
          sub={leads && leads.some((l) => l.status === 'nuovo') ? `${leads.filter((l) => l.status === 'nuovo').length} nuove` : 'Nessuna nuova'} />
      </div>
      <p className="text-xs text-gray-500 -mt-1 mb-3">L'email a cui arrivano le notifiche dei moduli di contatto si imposta in <span className="text-gray-300">Impostazioni → Connessioni</span>.</p>

      {openTile === 'richieste' && (
        <div className="glass-panel mb-4 overflow-hidden">
          {(!leads || leads.length === 0) && <div className="text-gray-600 text-sm p-6">Nessuna richiesta ricevuta ancora.</div>}
          {leads && leads.length > 0 && (
            <div className="divide-y divide-gray-800/70">
              {leads.map((l) => (
                <div key={l.id} className="p-3.5">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="text-xs text-gray-500">/negozio/{l.page_slug} — {new Date(l.created_at).toLocaleString('it-IT')}</span>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {l.email_status && (
                        <span title={l.email_status === 'simulato' ? 'Email non configurata (connessione o indirizzo mancanti)' : l.email_status === 'errore' ? 'Invio email fallito' : 'Email inviata'}
                          className={'text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1 ' + (l.email_status === 'inviata' ? 'bg-green-900/30 text-green-400' : l.email_status === 'errore' ? 'bg-red-900/30 text-red-400' : 'bg-gray-800 text-gray-500')}>
                          <Icon name="mail" size={10} />{l.email_status === 'inviata' ? 'email inviata' : l.email_status === 'errore' ? 'email fallita' : 'email non configurata'}
                        </span>
                      )}
                      <span className={'text-[10px] px-1.5 py-0.5 rounded ' + (l.status === 'nuovo' ? 'bg-accent/20 text-accent' : l.status === 'archiviato' ? 'bg-gray-800 text-gray-500' : 'bg-green-900/30 text-green-400')}>{l.status}</span>
                      {l.status !== 'letto' && <button onClick={() => markLeadStatus(l.id, 'letto')} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-300">Segna letta</button>}
                      {l.status !== 'archiviato' && <button onClick={() => markLeadStatus(l.id, 'archiviato')} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-300">Archivia</button>}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                    {Object.entries(l.data || {}).map(([k, v]) => (
                      <div key={k} className="text-xs"><span className="text-gray-500">{k}:</span> <span className="text-ink">{v}</span></div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default SitoWebPage
