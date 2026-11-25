import React, { useState, useEffect } from 'react'
import useApi from '../lib/useApi'
import { parseSchemaFrontend } from '../lib/schema-v3-frontend'
import Portal from './Portal'
import ImportaModuloPdf from './ImportaModuloPdf'

// «Nuova vendita»: un percorso a passi dalla trattativa. Per ogni passo (venditore, immobile, acquirente…) scegli una scheda che c'è già oppure ne crei una nuova
// (da modulo PDF o a mano, con i campi essenziali della relazione); alla fine nasce la trattativa già collegata. Nessun nome di modulo o di campo qui:
// i passi stanno nel blocco `creazione_guidata` del modulo (`procedura`: [{ campo, titolo?, facoltativo? }]), il resto lo dicono le relazioni dello schema.
const nomeDi = (r) => (r && r.data && (r.data.nome || r.data.titolo)) || (r ? '#' + r.id : '')

function Passo({ api, token, schema, passo, valore, onScelto }) {
  const rel = (schema.relations || []).find((r) => r.key === passo.campo)
  const [modo, setModo] = useState('esistente') // esistente | mano
  const [elenco, setElenco] = useState([])
  const [campi, setCampi] = useState([])
  const [form, setForm] = useState({})
  const [pdfAperto, setPdfAperto] = useState(false)
  const [nomiCreati, setNomiCreati] = useState({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const bersaglio = rel && rel.target_module
  useEffect(() => {
    if (!bersaglio) return
    api.get('/records/' + bersaglio).then((d) => setElenco(Array.isArray(d) ? d : []))
    api.get('/modules/' + bersaglio).then((m) => {
      if (!m) return
      const tutti = (parseSchemaFrontend(m.schema_json).fields || []).filter((f) => f.type !== 'computed')
      const sub = rel.quick_create && Array.isArray(rel.quick_create.fields_subset) && rel.quick_create.fields_subset.length ? rel.quick_create.fields_subset : null
      setCampi(sub ? tutti.filter((f) => sub.includes(f.key)) : tutti.slice(0, 6))
    })
  }, [bersaglio]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!rel) return <div className="text-sm text-red-400">Il collegamento «{passo.campo}» non esiste in questo modulo.</div>
  const puoCreare = !!(rel.quick_create && rel.quick_create.enabled)
  const crea = async () => {
    setBusy(true); setErr('')
    const r = await api.post('/records/' + bersaglio + '/quick-create', { via_module: schema._slug, via_relation: rel.key, data: form })
    setBusy(false)
    if (!r.ok) { setErr((r.data && r.data.error) || 'Creazione non riuscita'); return }
    setElenco((e) => [...e, r.data]); setNomiCreati((n) => ({ ...n, [r.data.id]: nomeDi(r.data) })); onScelto(r.data.id); setModo('esistente')
  }
  const campoInput = (f) => {
    const base = 'w-full bg-gray-800 text-ink text-sm rounded-lg px-3 py-2'
    if (f.type === 'select' && Array.isArray(f.options)) return <select className={base} value={form[f.key] || ''} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}><option value="">—</option>{f.options.map((o) => <option key={o} value={o}>{o}</option>)}</select>
    return <input className={base} type={['number', 'currency', 'percent'].includes(f.type) ? 'number' : 'text'} value={form[f.key] || ''} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
  }
  return (
    <div className="space-y-3">
      <div className="flex gap-2 text-xs">
        <button type="button" onClick={() => setModo('esistente')} className={'px-3 py-1.5 rounded-lg ' + (modo === 'esistente' ? 'bg-accent text-white' : 'bg-gray-800 text-gray-300')}>Scheda esistente</button>
        {puoCreare && <button type="button" onClick={() => setModo('mano')} className={'px-3 py-1.5 rounded-lg ' + (modo === 'mano' ? 'bg-accent text-white' : 'bg-gray-800 text-gray-300')}>Nuova a mano</button>}
        <button type="button" onClick={() => setPdfAperto(true)} className="px-3 py-1.5 rounded-lg bg-gray-800 text-gray-300">Nuova da PDF</button>
      </div>
      {modo === 'esistente' && (
        <select className="w-full bg-gray-800 text-ink text-sm rounded-lg px-3 py-2" value={valore || ''} onChange={(e) => onScelto(e.target.value ? Number(e.target.value) : null)}>
          <option value="">{passo.facoltativo ? 'Nessuno per ora' : 'Scegli…'}</option>
          {elenco.map((r) => <option key={r.id} value={r.id}>{nomiCreati[r.id] || nomeDi(r)}</option>)}
        </select>
      )}
      {modo === 'mano' && (
        <div className="space-y-2">
          {campi.map((f) => <label key={f.key} className="block text-xs text-gray-400">{f.label || f.key}{campoInput(f)}</label>)}
          {err && <div className="text-sm text-red-400">{err}</div>}
          <button type="button" onClick={crea} disabled={busy} className="bg-accent text-white text-sm px-4 py-2 rounded-lg disabled:opacity-50">{busy ? 'Salvo…' : 'Salva e usa'}</button>
        </div>
      )}
      {pdfAperto && <ImportaModuloPdf token={token} mod={{ slug: bersaglio, name: rel.label || bersaglio }} senzaVoce aperto onChiudi={() => setPdfAperto(false)}
        onCreated={(r) => { if (r && r.id) { api.get('/records/' + bersaglio).then((d) => { setElenco(Array.isArray(d) ? d : []); onScelto(r.id) }) } }} />}
    </div>
  )
}

export default function NuovaVendita({ token, mod, schema, procedura, onNavigate, onChiudi, onCreata }) {
  const api = useApi(token)
  const passi = procedura.filter((p) => p.campo)
  const [i, setI] = useState(0)
  const [scelte, setScelte] = useState({})
  const [titolo, setTitolo] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const ultimo = i === passi.length
  const passo = passi[i]
  const rel = passo && (schema.relations || []).find((r) => r.key === passo.campo)
  const avanti = () => setI(i + 1)
  const salva = async () => {
    setBusy(true); setErr('')
    const corpo = { titolo: titolo.trim(), ...Object.fromEntries(Object.entries(scelte).filter(([, v]) => v)) }
    const r = await api.post('/records/' + mod.slug, corpo)
    setBusy(false)
    if (!r.ok) { setErr((r.data && r.data.error) || 'Non sono riuscito a creare la trattativa.'); return }
    window.dispatchEvent(new CustomEvent('platform:toast', { detail: { message: 'Trattativa creata', type: 'success' } }))
    onChiudi(); if (onCreata) onCreata(r.data)
  }
  return (
    <Portal>
      <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
        <div className="bg-surface-card rounded-md p-6 w-full max-w-lg border border-gray-800 max-h-[90vh] overflow-y-auto">
          <div className="text-xs text-gray-500 mb-1">Passo {Math.min(i + 1, passi.length + 1)} di {passi.length + 1}</div>
          <h2 className="text-base font-bold text-ink mb-4">{ultimo ? 'Titolo della trattativa' : (passo.titolo || (rel && rel.label) || passo.campo)}{!ultimo && passo.facoltativo ? ' (facoltativo)' : ''}</h2>
          {!ultimo && <Passo key={passo.campo} api={api} token={token} schema={{ ...schema, _slug: mod.slug }} passo={passo} valore={scelte[passo.campo]} onScelto={(id) => setScelte((s) => ({ ...s, [passo.campo]: id }))} />}
          {ultimo && <input className="w-full bg-gray-800 text-ink text-sm rounded-lg px-3 py-2" value={titolo} onChange={(e) => setTitolo(e.target.value)} placeholder="Es. Vendita via Roma 12" autoFocus />}
          {err && <div className="text-sm text-red-400 bg-red-900/20 border border-red-900/40 rounded-lg p-3 mt-3">{err}</div>}
          <div className="flex gap-3 mt-5">
            <button type="button" onClick={i > 0 ? () => setI(i - 1) : onChiudi} className="flex-1 bg-gray-800 hover:bg-gray-700 text-ink py-2.5 rounded-lg text-sm transition">{i > 0 ? 'Indietro' : 'Annulla'}</button>
            {!ultimo && <button type="button" onClick={avanti} disabled={!passo.facoltativo && !scelte[passo.campo]} className="flex-1 bg-accent hover:opacity-90 disabled:opacity-50 text-white py-2.5 rounded-lg text-sm font-medium transition">Avanti</button>}
            {ultimo && <button type="button" onClick={salva} disabled={busy || !titolo.trim()} className="flex-1 bg-accent hover:opacity-90 disabled:opacity-50 text-white py-2.5 rounded-lg text-sm font-medium transition">{busy ? 'Creo…' : 'Crea trattativa'}</button>}
          </div>
        </div>
      </div>
    </Portal>
  )
}
