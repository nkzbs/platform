import React, { useState, useEffect, useMemo } from 'react'
import useApi from '../lib/useApi'
import Icon from '../components/Icon'

// Lo «store» delle funzioni (Impostazioni → Store funzioni): le funzioni che non servono a tutti (firma, fattura elettronica, valutazione immobiliare…) si accendono qui,
// come in uno store di plugin. Cosa c'è e perché è accesa lo dice il server (rotta /funzioni): una funzione inclusa nel pacchetto del tenant o usata da un modulo
// resta accesa; solo quelle accese a mano si spengono.
const MOTIVI = { pacchetto: 'Inclusa nel pacchetto', usata: 'Usata da un modulo', prova: 'Attiva (prova)', scelta: 'Attiva' }
const tinta = (hex, a) => { const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return 'rgba(88,74,236,' + a + ')'; const n = parseInt(m[1], 16); return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')' }

function Scheda({ f, occupata, onCambia }) {
  return (
    <div className="glass-panel rounded-2xl p-4 flex flex-col gap-3 h-full" style={{ boxShadow: f.attiva ? '0 0 0 1.5px ' + tinta(f.colore, 0.55) : undefined }}>
      <div className="flex items-start gap-3">
        <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'linear-gradient(135deg,' + tinta(f.colore, 0.28) + ',' + tinta(f.colore, 0.1) + ')', color: f.colore }}>
          <Icon name={f.icona} size={22} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-ink font-semibold text-sm leading-tight">{f.nome}</div>
          <div className="text-[11px] text-gray-500 mt-0.5">{f.categoria}</div>
          {f.attiva && <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full inline-flex items-center gap-1 mt-1.5" style={{ background: tinta(f.colore, 0.16), color: f.colore }}><Icon name="check" size={10} />{MOTIVI[f.motivo] || 'Attiva'}</span>}
        </div>
      </div>
      <p className="text-xs text-gray-400 leading-relaxed flex-1">{f.descrizione}</p>
      <div className="flex items-center justify-between gap-2 pt-1">
        <span className="text-[11px] text-gray-500 min-w-0 truncate">{f.costo}</span>
        {f.attiva
          ? (f.puo_spegnere
            ? <button disabled={occupata} onClick={() => onCambia(f, false)} className="text-xs px-3 py-1.5 rounded-lg border border-gray-700 text-gray-300 hover:bg-white/5 disabled:opacity-50 shrink-0">Disattiva</button>
            : <span className="text-[11px] text-gray-500 shrink-0">Non si spegne</span>)
          : <button disabled={occupata} onClick={() => onCambia(f, true)} className="text-xs px-3 py-1.5 rounded-lg bg-accent text-white font-medium hover:opacity-90 disabled:opacity-50 shrink-0 flex items-center gap-1"><Icon name="plus" size={12} />Attiva</button>}
      </div>
    </div>
  )
}

export default function FunzioniStore({ token }) {
  const api = useApi(token)
  const [lista, setLista] = useState(null)
  const [errore, setErrore] = useState('')
  const [occupata, setOccupata] = useState(false)
  const [filtro, setFiltro] = useState('tutte') // tutte | attive | disponibili
  const [categoria, setCategoria] = useState('')
  const [cerca, setCerca] = useState('')
  useEffect(() => { api.get('/funzioni').then((d) => setLista(d && Array.isArray(d.funzioni) ? d.funzioni : [])).catch(() => setLista([])) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const cambia = async (f, accendi) => {
    setErrore(''); setOccupata(true)
    const r = await api.post('/funzioni/' + f.id + (accendi ? '/attiva' : '/spegni'), {})
    setOccupata(false)
    if (!r.ok) { setErrore((r.data && r.data.error) || 'Non riuscito.'); return }
    if (r.data && Array.isArray(r.data.funzioni)) setLista(r.data.funzioni)
  }
  const categorie = useMemo(() => [...new Set((lista || []).map((f) => f.categoria))], [lista])
  const visibili = useMemo(() => (lista || []).filter((f) => (filtro === 'tutte' || (filtro === 'attive') === f.attiva) && (!categoria || f.categoria === categoria) && (!cerca.trim() || (f.nome + ' ' + f.descrizione).toLowerCase().includes(cerca.trim().toLowerCase()))), [lista, filtro, categoria, cerca])
  if (!lista) return <p className="text-sm text-gray-500">Carico…</p>
  const nAttive = lista.filter((f) => f.attiva).length
  const Pill = ({ attivo, onClick, children }) => <button onClick={onClick} className={'text-xs px-3 py-1.5 rounded-full transition shrink-0 ' + (attivo ? 'bg-accent text-white font-medium' : 'bg-white/5 text-gray-400 hover:text-ink')}>{children}</button>

  return (
    <div className="max-w-5xl">
      <div className="rounded-2xl p-5 mb-5 text-white" style={{ background: 'linear-gradient(135deg,#584aec,#8b5cf6)' }}>
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] opacity-90"><Icon name="store" size={14} />Store funzioni</div>
        <div className="text-lg font-bold mt-1">Accendi solo ciò che ti serve</div>
        <div className="text-xs opacity-85 mt-1">{nAttive} {nAttive === 1 ? 'funzione attiva' : 'funzioni attive'} su {lista.length}. Spegnerne una non cancella dati: smette solo di lavorare e sparisce dal Builder.</div>
      </div>
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500"><Icon name="search" size={14} /></span>
          <input value={cerca} onChange={(e) => setCerca(e.target.value)} placeholder="Cerca una funzione" className="w-full bg-surface-page text-ink text-sm rounded-lg pl-9 pr-3 py-2 outline-none border border-gray-800 focus:border-accent" />
        </div>
        <div className="flex gap-2 overflow-x-auto">
          <Pill attivo={filtro === 'tutte'} onClick={() => setFiltro('tutte')}>Tutte</Pill>
          <Pill attivo={filtro === 'attive'} onClick={() => setFiltro('attive')}>Attive</Pill>
          <Pill attivo={filtro === 'disponibili'} onClick={() => setFiltro('disponibili')}>Disponibili</Pill>
        </div>
      </div>
      {categorie.length > 1 && (
        <div className="flex gap-2 overflow-x-auto mb-4">
          <Pill attivo={!categoria} onClick={() => setCategoria('')}>Ogni categoria</Pill>
          {categorie.map((c) => <Pill key={c} attivo={categoria === c} onClick={() => setCategoria(c)}>{c}</Pill>)}
        </div>
      )}
      {errore && <div className="text-xs text-amber-400 mb-3">{errore}</div>}
      {visibili.length === 0
        ? <p className="text-sm text-gray-500 py-8 text-center">Nessuna funzione con questi filtri.</p>
        : <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">{visibili.map((f) => <Scheda key={f.id} f={f} occupata={occupata} onCambia={cambia} />)}</div>}
    </div>
  )
}
