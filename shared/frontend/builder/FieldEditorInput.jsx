import React, { useState } from 'react'
import Icon from '@app/components/Icon'
import Select from '@app/components/Select'
import BarcodeScanModal from './BarcodeScanModal.jsx'

// ─── MODULE GENERIC PAGE ──────────────────────────────────────────────────────
// Mostra il dettaglio di un record: campi propri (inclusi i computed, sempre freschi),
// relazioni risolte al valore leggibile, e — per ogni modulo che ha una relazione verso
// questo modulo (children-modules, derivato automaticamente) — l'elenco dei record figli
// filtrati server-side. Generico: funziona per qualsiasi coppia di moduli in ogni fork.
// Renderer condiviso per l'input di un campo — usato sia dal form "Nuovo record" sia
// dalla modifica inline nel modale dettaglio, così i due punti non divergono nel
// tempo (prima solo il form "Nuovo record" sapeva disegnare i vari tipi di campo, il
// modale dettaglio era sempre e solo in sola lettura).
function FieldEditorInput({ f, value, onChange, uploading, onUploadFile, placeholder: placeholderProp }) {
  const [showSecret, setShowSecret] = useState(false)
  const [scanning, setScanning] = useState(false)
  if (f.type === 'soglia') {
    return <div className="text-xs text-gray-600 py-2">Calcolato automaticamente dai dati del record.</div>
  }
  if (f.type === 'soglia_data') {
    return <div className="text-xs text-gray-600 py-2">Calcolato automaticamente dalla data del record.</div>
  }
  if (f.type === 'scaglioni') {
    // Scaglioni progressivi (es. provvigione a percentuale crescente sul fatturato):
    // { soglia, perc }[], l'ultimo scaglione (percentuale più alta) è quello "aperto"
    // e per convenzione non ha soglia (si applica oltre l'ultima soglia definita).
    // Salvato come JSON — stessa forma già letta da registra_provvigione — ma editato
    // a righe invece che come testo grezzo.
    let righe = []
    try { righe = JSON.parse(value || '[]'); if (!Array.isArray(righe)) righe = [] } catch (e) { righe = [] }
    const setRighe = (next) => onChange(JSON.stringify(next))
    const updateRiga = (i, patch) => setRighe(righe.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
    const removeRiga = (i) => setRighe(righe.filter((_, idx) => idx !== i))
    const addRiga = () => setRighe([...righe, { soglia: 0, perc: 0 }])
    return (
      <div className="space-y-2">
        {righe.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="flex-1">
              <label className="text-[10px] text-gray-600 block mb-0.5">{i === righe.length - 1 ? 'Oltre (€)' : 'Fino a (€)'}</label>
              <input type="number" className="w-full bg-surface-page text-ink px-3 py-2 rounded-lg text-sm outline-none border border-gray-800 focus:border-accent transition"
                value={r.soglia ?? ''} onChange={(e) => updateRiga(i, { soglia: e.target.value === '' ? 0 : Number(e.target.value) })} />
            </div>
            <div className="flex-1">
              <label className="text-[10px] text-gray-600 block mb-0.5">Percentuale %</label>
              <input type="number" step="0.1" className="w-full bg-surface-page text-ink px-3 py-2 rounded-lg text-sm outline-none border border-gray-800 focus:border-accent transition"
                value={r.perc ?? ''} onChange={(e) => updateRiga(i, { perc: e.target.value === '' ? 0 : Number(e.target.value) })} />
            </div>
            <button type="button" onClick={() => removeRiga(i)} className="text-red-400/50 hover:text-red-400 transition mt-4"><Icon name="trash" size={14} /></button>
          </div>
        ))}
        <button type="button" onClick={addRiga} className="text-accent hover:opacity-80 text-xs transition flex items-center gap-1">
          <Icon name="plus" size={12} />Aggiungi scaglione
        </button>
        {righe.length === 0 && <div className="text-[10px] text-gray-600">Nessuno scaglione — "Aggiungi scaglione" per iniziare.</div>}
      </div>
    )
  }
  if (f.type === 'encrypted') {
    // Generatore locale (crypto.getRandomValues, mai inviato in chiaro finché
    // l'utente non salva) — comodo per campi password del Vault, ma disponibile
    // su qualunque campo 'encrypted' di qualunque modulo, non solo il vault.
    const generatePassword = () => {
      const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*'
      const bytes = new Uint32Array(20)
      crypto.getRandomValues(bytes)
      onChange(Array.from(bytes, (b) => charset[b % charset.length]).join(''))
      setShowSecret(true)
    }
    return (
      <div className="relative">
        <input className="w-full bg-surface-page text-ink px-4 py-3 rounded-lg text-sm outline-none border border-gray-800 focus:border-accent transition placeholder-gray-600 pr-16"
          type={showSecret ? 'text' : 'password'} value={value || ''} onChange={(e) => onChange(e.target.value)}
          placeholder="Valore cifrato" autoComplete="new-password" />
        <button type="button" onClick={generatePassword} title="Genera password" className="absolute right-9 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition">
          <Icon name="refresh" size={14} />
        </button>
        <button type="button" onClick={() => setShowSecret((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition">
          <Icon name={showSecret ? 'eye-off' : 'eye'} size={15} />
        </button>
      </div>
    )
  }
  if (f.type === 'textarea') {
    return <textarea className="w-full bg-surface-page text-ink px-4 py-3 rounded-lg text-sm outline-none border border-gray-800 focus:border-accent transition placeholder-gray-600 resize-none" rows={3} placeholder={f.placeholder || ''} value={value || ''} onChange={(e) => onChange(e.target.value)} />
  }
  if ((f.type === 'select' || f.type === 'multiselect') && f.options) {
    return <Select value={value || ''} onChange={onChange} options={f.options.map((o) => ({ value: o, label: o }))} />
  }
  // 'boolean' è un alias legacy di 'checkbox' — alcuni moduli più vecchi (es. Coffee,
  // portato da un'app standalone pre-piattaforma) hanno campi salvati con questo type
  // invece del nome ufficiale. Senza questo alias il campo cadeva nel ramo di default
  // (input di testo vuoto) invece di un vero checkbox — bug reale segnalato da un
  // utente reale su Coffee (campo "Attivo" su Clienti/Prodotti/Agenti/Fornitori/ecc.,
  // 11 campi su 10 moduli). Non serve normalizzare i dati esistenti, basta accettare
  // entrambi i nomi qui.
  if (f.type === 'checkbox' || f.type === 'boolean') {
    return <input type="checkbox" checked={value || false} onChange={(e) => onChange(e.target.checked)} className="accent-accent" />
  }
  if (f.type === 'file') {
    return (
      <div>
        <input type="file" className="w-full text-xs text-gray-400 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-gray-800 file:text-gray-300 file:text-xs hover:file:bg-gray-700 file:cursor-pointer cursor-pointer"
          onChange={(e) => onUploadFile && onUploadFile(e.target.files[0])} />
        {uploading && <div className="text-xs text-gray-500 mt-1">Caricamento...</div>}
        {value && !uploading && (
          <div className="text-xs text-green-400 mt-1 flex items-center gap-1"><Icon name="check" size={11} />{value.name}{value.size ? ' (' + Math.round(value.size / 1024) + ' KB)' : ''}</div>
        )}
      </div>
    )
  }
  // Mappa: indirizzo/luogo in testo libero + link diretto a Google Maps. Nessuna API
  // key richiesta (è un link di ricerca, non un embed), coerente col resto del
  // prototipo dove ogni integrazione esterna reale è dichiarata come tale — qui non
  // c'è nulla da "connettere", è solo un URL costruito dal valore del campo.
  if (f.type === 'giacenza') {
    const locs = (f.locations || [])
    const val = value && typeof value === 'object' ? value : {}
    return (
      <div className="space-y-1.5">
        {locs.map((loc) => (
          <div key={loc.key} className="flex items-center gap-2">
            <span className="text-xs text-gray-500 w-28 truncate">{loc.label}</span>
            <input type="number" min="0" step="1"
              className="w-24 bg-surface-page text-ink px-2 py-1.5 rounded-md text-xs outline-none border border-gray-800 focus:border-accent transition"
              value={val[loc.key] !== undefined ? val[loc.key] : ''}
              onChange={(e) => onChange({ ...val, [loc.key]: e.target.value === '' ? 0 : Number(e.target.value) })} />
          </div>
        ))}
        {locs.length === 0 && <div className="text-xs text-gray-600">Nessuna location configurata nel Builder.</div>}
      </div>
    )
  }
  if (f.type === 'mappa') {
    return (
      <div className="flex items-center gap-2">
        <input className="flex-1 bg-surface-page text-ink px-4 py-3 rounded-lg text-sm outline-none border border-gray-800 focus:border-accent transition placeholder-gray-600"
          placeholder="Indirizzo o luogo" value={value || ''} onChange={(e) => onChange(e.target.value)} />
        {value && (
          <a href={'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(value)} target="_blank" rel="noreferrer"
            className="flex-shrink-0 text-accent hover:opacity-80 transition p-2" title="Apri in Google Maps">
            <Icon name="link" size={16} />
          </a>
        )}
      </div>
    )
  }
  // Campo libero come 'text', con in più un pulsante che apre la fotocamera per
  // leggere il codice a barre al posto di digitarlo — comodo per archiviare
  // oggetti in magazzino. Lo stesso valore resta sempre modificabile a mano
  // nell'input (la scansione è una scorciatoia, non l'unico modo di compilarlo).
  if (f.type === 'barcode') {
    return (
      <div className="flex items-center gap-2">
        <input className="flex-1 bg-surface-page text-ink px-4 py-3 rounded-lg text-sm outline-none border border-gray-800 focus:border-accent transition placeholder-gray-600"
          placeholder={placeholderProp || f.placeholder || 'Codice a barre'} value={value || ''} onChange={(e) => onChange(e.target.value)} />
        <button type="button" onClick={() => setScanning(true)} title="Scansiona" className="flex-shrink-0 text-accent hover:opacity-80 transition p-2">
          <Icon name="barcode" size={18} />
        </button>
        {scanning && (
          <BarcodeScanModal
            onDetected={(code) => { onChange(code); setScanning(false) }}
            onClose={() => setScanning(false)}
          />
        )}
      </div>
    )
  }
  const ph = placeholderProp || f.placeholder || ''
  // min-w-0/max-w-full (26/10/2026, segnalato dal vivo): su iOS Safari il controllo
  // nativo di un <input type="date"> ha una larghezza intrinseca propria che può
  // superare quella del contenitore — "w-full" da solo non basta a farla rispettare,
  // il campo Data sfondava il bordo destro dello schermo su telefono.
  return (
    <input className="w-full min-w-0 max-w-full bg-surface-page text-ink px-4 py-3 rounded-lg text-sm outline-none border border-gray-800 focus:border-accent transition placeholder-gray-600"
      type={f.type === 'date' ? 'date' : f.type === 'datetime' ? 'datetime-local' : f.type === 'time' ? 'time' : (f.type === 'number' || f.type === 'currency') ? 'number' : f.type === 'email' ? 'email' : f.type === 'phone' ? 'tel' : f.type === 'url' ? 'url' : 'text'}
      placeholder={ph} value={value || ''} onChange={(e) => onChange(e.target.value)} />
  )
}

export default FieldEditorInput
