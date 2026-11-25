import React, { useState, useEffect, useCallback } from 'react'
import useApi from '../lib/useApi'
import { API } from '../lib/api'
import Icon from './Icon'

// Impostazioni → Privacy e GDPR. Cinque schede: Stato (checklist), Trattamenti (art. 30), Fornitori (art. 28), Violazioni (art. 33) e Persona (ricerca ed
// esportazione dei dati di una persona, art. 15 e 20). Sono aiuti per il titolare del trattamento, non un parere legale: le bozze vanno riviste.
const SCHEDE = [['stato', 'Stato'], ['trattamenti', 'Trattamenti'], ['fornitori', 'Fornitori'], ['violazioni', 'Violazioni'], ['persona', 'Persona']]
const COLORE = { ok: 'text-emerald-500', attenzione: 'text-amber-500', manca: 'text-red-500' }
const ICONA = { ok: 'check', attenzione: 'alert-triangle', manca: 'alert-triangle' }
const input = 'w-full bg-gray-800 text-ink text-sm rounded-lg px-3 py-2'
const bottone = 'bg-accent hover:opacity-90 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition'
const secondario = 'bg-gray-800 hover:bg-gray-700 text-ink px-4 py-2 rounded-lg text-sm transition'

const DEFINIZIONI = {
  trattamenti: {
    titolo: 'Registro dei trattamenti', intro: 'Per ogni attività che usa dati personali: perché, di chi, quali dati, su che base, per quanto tempo. Con «Precompila» parti da bozze generiche: rivedile e togli «Da verificare».',
    campi: [['nome', 'Attività', 'text'], ['finalita', 'Finalità', 'area'], ['interessati', 'Di chi sono i dati', 'text'], ['categorie_dati', 'Quali dati', 'area'], ['base_giuridica', 'Base giuridica', 'text'], ['destinatari', 'A chi vanno', 'text'], ['extra_ue', 'Fuori dall\'UE?', 'text'], ['conservazione', 'Per quanto tempo', 'text'], ['misure', 'Misure di sicurezza', 'area'], ['da_verificare', 'Ancora una bozza da verificare', 'check']],
    riga: (r) => [r.nome, r.base_giuridica, r.conservazione], bozza: (r) => !!r.da_verificare,
  },
  fornitori: {
    titolo: 'Fornitori e accordi di trattamento', intro: 'Chi riceve o tratta dati personali per te. Con ognuno serve un accordo di trattamento (art. 28): segna quando è firmato.',
    campi: [['nome', 'Fornitore', 'text'], ['servizio', 'Cosa fa', 'text'], ['dati', 'Quali dati riceve', 'area'], ['paese', 'Dove sono i dati', 'text'], ['dpa_stato', 'Accordo di trattamento', 'select', [['da_firmare', 'Da firmare'], ['firmato', 'Firmato'], ['non_serve', 'Non serve']]], ['dpa_data', 'Data dell\'accordo', 'date'], ['note', 'Note', 'area']],
    riga: (r) => [r.nome, r.paese, { da_firmare: 'Accordo da firmare', firmato: 'Accordo firmato', non_serve: 'Accordo non necessario' }[r.dpa_stato]], bozza: (r) => r.dpa_stato === 'da_firmare',
  },
  violazioni: {
    titolo: 'Registro delle violazioni dei dati', intro: 'Ogni perdita, accesso non autorizzato o invio sbagliato di dati personali, anche se poi non è servita la notifica. Se c\'è rischio per le persone, il Garante va avvisato entro 72 ore da quando lo scopri.',
    campi: [['scoperta_il', 'Scoperta il', 'datetime'], ['descrizione', 'Cosa è successo', 'area'], ['dati_coinvolti', 'Quali dati', 'area'], ['interessati_n', 'Quante persone', 'number'], ['rischio', 'Rischio per le persone', 'select', [['basso', 'Basso'], ['medio', 'Medio'], ['alto', 'Alto']]], ['misure', 'Cosa hai fatto', 'area'], ['notificata_garante_il', 'Notificata al Garante il', 'date'], ['comunicata_interessati_il', 'Comunicata alle persone il', 'date'], ['stato', 'Stato', 'select', [['aperta', 'Aperta'], ['chiusa', 'Chiusa']]]],
    riga: (r) => [r.descrizione, (r.scoperta_il || '').replace('T', ' ').slice(0, 16), r.stato === 'chiusa' ? 'Chiusa' : 'Aperta · rischio ' + r.rischio], bozza: (r) => r.stato === 'aperta' && r.rischio !== 'basso' && !r.notificata_garante_il,
  },
}

function Campo({ def, valore, onChange }) {
  const [chiave, etichetta, tipo, opzioni] = def
  const v = valore == null ? '' : valore
  return (
    <label className="block text-xs text-gray-400">
      {tipo === 'check'
        ? <span className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={!!valore} onChange={(e) => onChange(chiave, e.target.checked ? 1 : 0)} />{etichetta}</span>
        : <>{etichetta}
          {tipo === 'area' ? <textarea rows={2} className={input + ' mt-1'} value={v} onChange={(e) => onChange(chiave, e.target.value)} />
            : tipo === 'select' ? <select className={input + ' mt-1'} value={v} onChange={(e) => onChange(chiave, e.target.value)}>{opzioni.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
              : <input className={input + ' mt-1'} type={tipo === 'number' ? 'number' : tipo === 'date' ? 'date' : tipo === 'datetime' ? 'datetime-local' : 'text'} value={v} onChange={(e) => onChange(chiave, e.target.value)} />}</>}
    </label>
  )
}

function Registro({ tipo, api, onCambiato }) {
  const def = DEFINIZIONI[tipo]
  const [righe, setRighe] = useState(null)
  const [modifica, setModifica] = useState(null) // { id?, ...campi }
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const carica = useCallback(() => api.get('/gdpr/' + tipo).then((d) => setRighe(Array.isArray(d) ? d : [])), [tipo]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setModifica(null); carica() }, [tipo]) // eslint-disable-line react-hooks/exhaustive-deps
  const salva = async () => {
    setBusy(true); setErr('')
    const { id, creato_il, aggiornato_il, chiave, ...dati } = modifica
    const r = id ? await api.put('/gdpr/' + tipo + '/' + id, dati) : await api.post('/gdpr/' + tipo, dati)
    setBusy(false)
    if (!r.ok) { setErr((r.data && r.data.error) || 'Non sono riuscito a salvare.'); return }
    setModifica(null); carica(); onCambiato()
  }
  const elimina = async (r) => { if (!window.confirm('Eliminare questa voce?')) return; await api.del('/gdpr/' + tipo + '/' + r.id); carica(); onCambiato() }
  const precompila = async () => { const r = await api.post('/gdpr/precompila', {}); if (r.ok) { carica(); onCambiato() } }
  if (!righe) return <p className="text-sm text-gray-500">Carico…</p>
  const nuovo = () => setModifica(Object.fromEntries(def.campi.map(([k, , t, o]) => [k, t === 'select' ? o[0][0] : t === 'check' ? 0 : '']).concat(tipo === 'violazioni' ? [['scoperta_il', new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)]] : [])))
  return (
    <div className="space-y-3">
      <div><h3 className="text-sm font-bold text-ink">{def.titolo}</h3><p className="text-xs text-gray-400 mt-1">{def.intro}</p></div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={bottone} onClick={nuovo}>Aggiungi</button>
        {tipo !== 'violazioni' && <button type="button" className={secondario} onClick={precompila}>Precompila</button>}
      </div>
      {modifica && (
        <div className="bg-surface-card border border-gray-800 rounded-xl p-4 space-y-3">
          {def.campi.map((c) => <Campo key={c[0]} def={c} valore={modifica[c[0]]} onChange={(k, v) => setModifica({ ...modifica, [k]: v })} />)}
          {err && <div className="text-sm text-red-400">{err}</div>}
          <div className="flex gap-2"><button type="button" className={secondario} onClick={() => setModifica(null)}>Annulla</button><button type="button" className={bottone} disabled={busy} onClick={salva}>{busy ? 'Salvo…' : 'Salva'}</button></div>
        </div>
      )}
      {righe.length === 0 && !modifica && <p className="text-sm text-gray-500">Ancora niente. {tipo !== 'violazioni' ? 'Usa «Precompila» per partire da una bozza.' : 'Meglio così: registra qui ogni episodio, anche piccolo.'}</p>}
      <ul className="space-y-2">
        {righe.map((r) => { const [a, b, c] = def.riga(r); return (
          <li key={r.id} className="bg-surface-card border border-gray-800 rounded-xl p-3 flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-sm text-ink font-medium break-words">{a}{def.bozza(r) && <span className="ml-2 text-xs text-amber-500 font-normal">{tipo === 'trattamenti' ? 'Da verificare' : tipo === 'fornitori' ? 'Da firmare' : 'Da notificare'}</span>}</div>
              <div className="text-xs text-gray-400 break-words">{[b, c].filter(Boolean).join(' · ')}</div>
            </div>
            <button type="button" className="text-xs text-accent" onClick={() => setModifica({ ...r })}>Modifica</button>
            <button type="button" className="text-red-400/70 hover:text-red-400" aria-label="Elimina" onClick={() => elimina(r)}><Icon name="trash" size={14} /></button>
          </li>) })}
      </ul>
    </div>
  )
}

function Persona({ token, api }) {
  const [q, setQ] = useState('')
  const [trovate, setTrovate] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const cerca = async () => {
    setBusy(true); setErr(''); setTrovate(null)
    const res = await fetch(API + '/gdpr/persona?q=' + encodeURIComponent(q), { headers: { Authorization: 'Bearer ' + token } })
    const d = await res.json().catch(() => null)
    setBusy(false)
    if (!res.ok) { setErr((d && d.error) || 'Ricerca non riuscita'); return }
    setTrovate(d)
  }
  const esporta = async () => {
    const res = await fetch(API + '/gdpr/persona/esporta?q=' + encodeURIComponent(q), { headers: { Authorization: 'Bearer ' + token } })
    if (!res.ok) { setErr('Esportazione non riuscita'); return }
    const url = URL.createObjectURL(await res.blob())
    const a = document.createElement('a'); a.href = url; a.download = 'dati-persona.json'; a.click(); URL.revokeObjectURL(url)
  }
  const perModulo = (trovate || []).reduce((m, t) => { (m[t.nome_modulo] = m[t.nome_modulo] || []).push(t); return m }, {})
  return (
    <div className="space-y-3">
      <div><h3 className="text-sm font-bold text-ink">Richiesta di una persona</h3><p className="text-xs text-gray-400 mt-1">Cerca per nome e cognome, mail, telefono o codice fiscale: vedi dove compare. «Esporta» scarica tutte le sue schede (diritto di accesso e portabilità, art. 15 e 20). Per cancellare, apri la scheda e eliminala dal suo modulo. La ricerca è sul testo: controlla sempre a mano omonimie e allegati.</p></div>
      <div className="flex gap-2">
        <input className={input} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && q.trim().length >= 4) cerca() }} placeholder="Nome, mail, telefono o codice fiscale" />
        <button type="button" className={bottone} disabled={busy || q.trim().length < 4} onClick={cerca}>Cerca</button>
      </div>
      {err && <div className="text-sm text-red-400">{err}</div>}
      {trovate && (trovate.length === 0 ? <p className="text-sm text-gray-500">Nessuna scheda trovata.</p> : (
        <div className="space-y-3">
          <div className="flex items-center gap-3"><span className="text-sm text-ink">{trovate.length} schede trovate</span><button type="button" className={secondario} onClick={esporta}>Esporta i dati</button></div>
          {Object.entries(perModulo).map(([nome, lista]) => (
            <div key={nome} className="bg-surface-card border border-gray-800 rounded-xl p-3"><div className="text-xs text-gray-400 mb-1">{nome} ({lista.length})</div><ul className="text-sm text-ink space-y-0.5">{lista.map((t) => <li key={t.id} className="break-words">{t.etichetta}</li>)}</ul></div>
          ))}
        </div>
      ))}
    </div>
  )
}

export default function GdprPanel({ token, onVaiScheda }) {
  const api = useApi(token)
  const [scheda, setScheda] = useState('stato')
  const [voci, setVoci] = useState(null)
  const caricaStato = useCallback(() => api.get('/gdpr/stato').then((d) => setVoci(Array.isArray(d) ? d : [])), []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { caricaStato() }, [caricaStato])
  return (
    <div className="space-y-4">
      <div className="flex gap-1 p-1 rounded-xl bg-surface-card border border-gray-800 w-full overflow-x-auto md:w-auto md:inline-flex">
        {SCHEDE.map(([k, nome]) => <button key={k} type="button" onClick={() => setScheda(k)} className={'flex-1 md:flex-none whitespace-nowrap px-4 py-2 rounded-lg text-sm transition ' + (scheda === k ? 'bg-accent text-white font-medium' : 'text-gray-400 hover:text-ink')}>{nome}</button>)}
      </div>
      {scheda === 'stato' && (
        <div className="space-y-3">
          <p className="text-xs text-gray-400">Una vista d'insieme di cosa è a posto. Non è un parere legale: per i casi dubbi serve un DPO o un avvocato.</p>
          {!voci ? <p className="text-sm text-gray-500">Carico…</p> : (
            <ul className="space-y-2">
              {voci.map((v) => (
                <li key={v.chiave} className="bg-surface-card border border-gray-800 rounded-xl p-3 flex items-start gap-3">
                  <span className={'mt-0.5 ' + COLORE[v.stato]}><Icon name={ICONA[v.stato]} size={16} /></span>
                  <span className="text-sm text-ink flex-1 break-words">{v.testo}</span>
                  {v.vai && v.stato !== 'ok' && <button type="button" className="text-xs text-accent" onClick={() => setScheda(v.vai)}>Apri</button>}
                </li>))}
            </ul>)}
        </div>
      )}
      {['trattamenti', 'fornitori', 'violazioni'].includes(scheda) && <Registro tipo={scheda} api={api} onCambiato={caricaStato} />}
      {scheda === 'persona' && <Persona token={token} api={api} />}
    </div>
  )
}
