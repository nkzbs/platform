import React, { useState, useEffect, useRef } from 'react'
import { API } from '../lib/api'
import Icon from '../components/Icon'
import ProcessoEditor, { applySuggestion, needsEnrichment } from '../components/analyses/ProcessoEditor'
import Manuale from '../components/analyses/Manuale'
import Guida from '../components/analyses/Guida'
import CorreggiAParole from '../components/analyses/CorreggiAParole'
import { STAMPA_CSS } from '../components/analyses/stampa'

// Analisi dei processi: racconti un'attività, l'AI propone i processi (mai salvati da soli), li rifinisci, vedi cosa copre la Libreria e cosa va costruito,
// apri il manuale (stampabile) e, se vuoi, crei il tenant con i moduli, i ruoli e gli stati del flusso che ne derivano. Si salva da sola mentre scrivi.
const card = 'bg-surface-card border border-gray-800 rounded-xl p-4 md:p-5 mb-4'
const input = 'w-full bg-surface-page text-ink px-3 py-2 rounded-lg outline-none border border-gray-800 focus:border-cp-primary transition text-sm placeholder-gray-600'
const btn = 'bg-cp-primary hover:bg-cp-primary-hover disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition'
const ghost = 'px-4 py-2 rounded-lg text-sm bg-surface-page hover:bg-gray-800 text-gray-300 transition border border-gray-800 disabled:opacity-50'
const slugify = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30)
const csv = (v) => String(v || '').split(',').map((x) => x.trim()).filter(Boolean)
const FASI_UI = [['container', 'Avvio il container'], ['database', 'Preparo il database'], ['dominio', 'Collego il dominio'], ['moduli', 'Installo i moduli'], ['ruoli', 'Creo ruoli e stati del flusso']]
const nuovoProcesso = (extra) => ({ nome: '', reparto: '', scopo: '', evento_innesco: '', input: '', output: '', ruoli_coinvolti: [], passaggi: [], eccezioni: [], documenti_collegati: [], sistemi_coinvolti: [], kpi: [], callout: [], registry_module_id: null, registry_module_reasoning: '', copertura: 'da_valutare', ...extra })

export default function AnalisiPage({ token, onNavigate, onBuild }) {
  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }
  const req = async (method, path, body) => {
    const res = await fetch(API + '/analyses' + path, { method, headers, body: body ? JSON.stringify(body) : undefined })
    const data = await res.json().catch(() => ({}))
    return { ok: res.ok, data }
  }
  const [list, setList] = useState(null)
  const [a, setA] = useState(null) // l'analisi aperta
  const [modules, setModules] = useState([])
  const [saving, setSaving] = useState('') // '' | 'saving' | 'saved' | 'error'
  const [newName, setNewName] = useState('')
  const [msg, setMsg] = useState(null)
  const [proposte, setProposte] = useState([])
  const [busy, setBusy] = useState('')
  const [showProfilo, setShowProfilo] = useState(false)
  const [showManuale, setShowManuale] = useState(false)
  const [approfondendo, setApprofondendo] = useState(false)
  const approfondisci = async () => {
    setApprofondendo(true); setMsg(null)
    const r = await req('POST', '/' + a.id + '/approfondisci')
    setApprofondendo(false)
    if (r.ok) { setA(r.data); setMsg({ ok: true, text: 'Fatto: ho aggiunto i moduli in più e segnato cosa manca. Controlla e togli ciò che non serve.' }) } else setMsg({ ok: false, text: (r.data && r.data.error) || 'Non riuscito.' })
  }
  const [guida, setGuida] = useState(null) // la guida all'uso, caricata quando si apre
  const apriGuida = async () => { const r = await req('GET', '/' + a.id + '/guida'); if (r.ok) setGuida(r.data); else setMsg({ ok: false, text: (r.data && r.data.error) || 'Non riesco a preparare la guida.' }) }
  const [tf, setTf] = useState({ name: '', slug: '' })
  const [cr, setCr] = useState(null) // avanzamento della creazione del tenant: { fase, inizio, tempi, ... }
  const [credenziali, setCredenziali] = useState(null) // l'accesso admin: si vede una volta
  const [completa, setCompleta] = useState(null) // { fatti, totale, errori } mentre «Completa tutti» lavora
  const [now, setNow] = useState(Date.now())
  const [autoText, setAutoText] = useState('') // il racconto per «Fai tutto»
  const [vista, setVista] = useState('dettagli') // 'riepilogo' (per chi ha usato «Fai tutto») | 'dettagli'
  const [avvio, setAvvio] = useState(false)
  const poll = useRef(null)
  const timer = useRef(null)

  const loadList = async () => { const r = await req('GET', ''); if (r.ok) setList(r.data) }
  useEffect(() => { loadList(); req('GET', '/library').then((r) => r.ok && setModules(r.data)) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const open = async (id) => {
    const r = await req('GET', '/' + id)
    if (r.ok) { setA(r.data); setProposte([]); setShowManuale(false); setGuida(null); setVista(r.data.auto ? 'riepilogo' : 'dettagli'); setCr(r.data.creazione || null); setCredenziali(null); setCompleta(null); setMsg(null); setTf({ name: r.data.name, slug: slugify(r.data.name) }) }
  }
  const create = async () => {
    if (!newName.trim()) { setMsg({ ok: false, text: 'Dai un nome all\'analisi.' }); return }
    const r = await req('POST', '', { name: newName })
    if (r.ok) { setNewName(''); loadList(); open(r.data.id) } else setMsg({ ok: false, text: r.data.error || 'Non riuscito.' })
  }
  // Si toglie dall'elenco o dall'analisi aperta; il tenant eventualmente creato resta.
  const elimina = async (id, name, tenant) => {
    if (!window.confirm('Eliminare l\'analisi «' + name + '»?' + (tenant ? ' Il tenant «' + tenant + '» resta.' : ''))) return
    const r = await req('DELETE', '/' + id)
    if (r.ok) { if (a && a.id === id) setA(null); loadList() } else setMsg({ ok: false, text: r.data.error || 'Non riuscito.' })
  }
  const remove = () => elimina(a.id, a.name, a.tenant_slug)

  // Salvataggio automatico: dopo mezzo secondo senza modifiche si manda tutto; la risposta aggiorna solo il riepilogo, mai ciò che si sta scrivendo.
  const change = (patch) => {
    setA((cur) => {
      const next = { ...cur, ...(typeof patch === 'function' ? patch(cur) : patch) }
      clearTimeout(timer.current); setSaving('saving')
      timer.current = setTimeout(async () => {
        const r = await req('PATCH', '/' + next.id, { name: next.name, descrizione: next.descrizione, profilo: next.profilo, processi: next.processi, scelte: next.scelte })
        if (r.ok) { setA((c) => (c && c.id === r.data.id ? { ...c, blueprint: r.data.blueprint } : c)); setSaving('saved'); loadList() } else setSaving('error')
      }, 600)
      return next
    })
  }
  const setProcesso = (i, patch) => change({ processi: a.processi.map((p, k) => (k === i ? { ...p, ...patch } : p)) })

  const proponi = async () => {
    setBusy('proponi'); setMsg(null)
    const r = await req('POST', '/suggest-processi', { descrizione: a.descrizione })
    setBusy('')
    if (r.ok) { setProposte(r.data.processi); if (!r.data.processi.length) setMsg({ ok: false, text: 'L\'AI non ha proposto niente: racconta qualcosa di più.' }) } else setMsg({ ok: false, text: r.data.error || 'Non riuscito.' })
  }
  const aggiungi = (items) => {
    const have = new Set(a.processi.map((p) => p.nome.toLowerCase()))
    const nuovi = items.filter((p) => !have.has(p.nome.toLowerCase())).map((p) => nuovoProcesso(p))
    if (nuovi.length) change({ processi: [...a.processi, ...nuovi] })
    setProposte((cur) => cur.filter((p) => !items.includes(p)))
  }

  // La creazione parte in background: si segue l'avanzamento (fasi e tempi) finché non è finita.
  const seguiCreazione = (id) => {
    clearInterval(poll.current)
    poll.current = setInterval(async () => {
      const r = await req('GET', '/' + id + '/creazione')
      if (!r.ok) return
      setCr(r.data)
      if (r.data.credenziali) setCredenziali(r.data.credenziali)
      if (r.data.fase === 'finita' || r.data.fase === 'errore') { clearInterval(poll.current); if (r.data.tenant_slug) setA((c) => (c && c.id === id ? { ...c, tenant_slug: r.data.tenant_slug } : c)); loadList() }
    }, 1500)
  }
  useEffect(() => { if (a && cr && cr.fase && cr.fase !== 'finita' && cr.fase !== 'errore') seguiCreazione(a.id); return () => clearInterval(poll.current) }, [a && a.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!cr || !cr.fase || cr.fase === 'finita' || cr.fase === 'errore') return undefined; const i = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(i) }, [cr && cr.fase])
  // «Fai tutto»: un racconto, e l'analisi si compila da sola (proposta dei processi + completamento di ognuno). Poi si arriva al riepilogo.
  const faiTutto = async () => {
    setMsg(null); setAvvio(true)
    const r = await req('POST', '/auto', { descrizione: autoText })
    setAvvio(false)
    if (r.ok) { setAutoText(''); await open(r.data.id); loadList() } else setMsg({ ok: false, text: r.data.error || 'Non riuscito.' })
  }
  const FASI_AUTO = ['processi', 'completamento', 'approfondimento']
  const autoAttivo = a && a.auto && FASI_AUTO.includes(a.auto.fase)
  useEffect(() => {
    if (!autoAttivo) return undefined
    const i = setInterval(async () => { const r = await req('GET', '/' + a.id); if (r.ok) { setA((c) => (c && c.id === r.data.id ? { ...c, ...r.data } : c)); if (!(r.data.auto && FASI_AUTO.includes(r.data.auto.fase))) loadList() } }, 1500)
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => { clearInterval(i); clearInterval(t) }
  }, [a && a.id, autoAttivo]) // eslint-disable-line react-hooks/exhaustive-deps

  const creaTenant = async () => {
    if (!tf.name.trim() || !tf.slug.trim()) { setMsg({ ok: false, text: 'Servono nome e indirizzo del tenant.' }); return }
    if (!window.confirm('Creare il tenant «' + tf.name + '» con ' + a.blueprint.moduli_ids.length + ' moduli e i ruoli dell\'analisi?')) return
    setMsg(null); setCredenziali(null)
    const r = await req('POST', '/' + a.id + '/create-tenant', { name: tf.name, slug: tf.slug })
    if (r.ok) { setCr({ fase: 'container', inizio: Date.now(), tempi: {} }); seguiCreazione(a.id) } else setMsg({ ok: false, text: r.data.error || 'Non riuscito.' })
  }

  // «Completa tutti»: per ogni processo ancora incompleto chiede all'AI una proposta e la applica SOLO ai campi vuoti. Tre alla volta; un errore non ferma gli altri.
  const completaTutti = async () => {
    const da = a.processi.map((p, i) => ({ p, i })).filter(({ p }) => p.nome && p.nome.trim() && needsEnrichment(p))
    if (!da.length) { setMsg({ ok: true, text: 'Tutti i processi sono già completi.' }); return }
    if (!window.confirm('Completare ' + da.length + (da.length === 1 ? ' processo' : ' processi') + ' con l\'AI? Compila solo i campi vuoti: quello che hai scritto non si tocca. Costa ' + da.length + ' richieste.')) return
    setMsg(null); setCompleta({ fatti: 0, totale: da.length, errori: 0 })
    let next = 0
    const lavora = async () => {
      while (next < da.length) {
        const { p } = da[next++]
        const r = await req('POST', '/suggest-processo', { nome: p.nome, reparto: p.reparto })
        if (r.ok) change((cur) => ({ processi: cur.processi.map((x) => (x.nome === p.nome ? { ...x, ...applySuggestion(x, r.data) } : x)) }))
        setCompleta((c) => ({ ...c, fatti: c.fatti + 1, errori: c.errori + (r.ok ? 0 : 1) }))
        if (!r.ok && r.data && r.data.code === 'ai_not_configured') { next = da.length }
      }
    }
    await Promise.all([lavora(), lavora(), lavora()])
    setCompleta((c) => { setMsg({ ok: c.errori === 0, text: c.errori ? 'Completati ' + (c.totale - c.errori) + ' processi su ' + c.totale + '. Gli altri riprovali uno alla volta.' : 'Completati ' + c.totale + (c.totale === 1 ? ' processo.' : ' processi.') }); return null })
  }

  // ── elenco ──
  if (!a) {
    return (
      <div className="max-w-3xl">
        <h1 className="text-lg font-bold text-ink tracking-[-0.35px] mb-1">Analisi dei processi</h1>
        <p className="text-gray-500 text-sm mb-6">Racconta come funziona un'attività: l'AI propone i processi, tu li rifinisci, e ne esce il manuale e, se vuoi, il tenant.</p>
        <div className={card + ' border-cp-primary/40'}>
          <h2 className="text-sm font-semibold text-ink mb-1">Racconta l'attività: al resto pensiamo noi</h2>
          <p className="text-xs text-gray-500 mb-3">Scrivi come funziona, anche in modo disordinato. L'AI trova i processi, li completa e sceglie i moduli, i report e le AI adatti. Alla fine vedi un riepilogo e crei il tenant con un tocco. I dati personali vengono tolti prima.</p>
          <textarea className={input + ' min-h-[110px] leading-relaxed'} placeholder="Es. Siamo un'officina con 6 meccanici. Il cliente porta l'auto, la accettiamo e facciamo un preventivo. Se lo approva lavoriamo, a volte servono ricambi. Quando è pronta avvisiamo il cliente e fatturiamo…" value={autoText} onChange={(e) => setAutoText(e.target.value)} />
          <div className="mt-3 flex items-center gap-3 flex-wrap">
            <button type="button" className={btn} onClick={faiTutto} disabled={avvio || autoText.trim().length < 20}><Icon name="sparkles" size={13} className="inline mr-1.5 -mt-0.5" />{avvio ? 'Avvio…' : 'Fai tutto'}</button>
            <span className="text-xs text-gray-500">Circa un minuto.</span>
          </div>
          {msg && <div className={'text-xs mt-2 ' + (msg.ok ? 'text-green-400' : 'text-amber-400')}>{msg.text}</div>}
        </div>
        <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-2 mt-6">Oppure a passi</div>
        <div className={card}>
          <div className="flex gap-2 flex-wrap">
            <input className={input + ' flex-1 min-w-[200px]'} placeholder="Nome dell'analisi (es. Officina Rossi)" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} />
            <button type="button" className={ghost} onClick={create}>Nuova analisi</button>
          </div>
        </div>
        {list && list.length === 0 && <div className="text-sm text-gray-500">Nessuna analisi ancora.</div>}
        <div className="space-y-2">
          {(list || []).map((x) => (
            <div key={x.id} className="bg-surface-card border border-gray-800 hover:border-gray-600 rounded-xl transition flex items-center">
              <button type="button" onClick={() => open(x.id)} className="flex-1 min-w-0 text-left p-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-ink truncate">{x.name}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{x.n_processi} processi{x.n_da_costruire ? ' · ' + x.n_da_costruire + ' da costruire' : ''}{x.tenant_slug ? ' · tenant ' + x.tenant_slug : ''}</div>
                </div>
                <Icon name="chevron-right" size={14} className="text-gray-600 flex-shrink-0" />
              </button>
              <button type="button" onClick={() => elimina(x.id, x.name, x.tenant_slug)} aria-label={'Elimina ' + x.name} title="Elimina l'analisi" className="px-4 py-4 text-gray-600 hover:text-red-400 transition border-l border-gray-800 flex-shrink-0"><Icon name="trash" size={15} /></button>
            </div>
          ))}
        </div>
      </div>
    )
  }

  const b = a.blueprint, pr = a.profilo || {}
  const setProfilo = (patch) => change({ profilo: { ...pr, ...patch } })
  // Il pannello «Crea il tenant»: lo stesso nel riepilogo e nei dettagli (una funzione che ritorna JSX, non un componente: i campi non perdono il fuoco).
  const creaPanel = (num) => (
            <section className={card}>
              <h2 className="text-sm font-semibold text-ink mb-1">{num}Crea il tenant</h2>
              {cr && cr.fase && cr.fase !== 'finita' && cr.fase !== 'errore' ? (
                <div>
                  <p className="text-sm text-ink mb-2">Creo il tenant <b>{cr.nome || tf.name}</b>… {Math.max(0, Math.round((now - cr.inizio) / 1000))} secondi</p>
                  <div className="space-y-1.5">
                    {FASI_UI.map(([k, l]) => {
                      const idx = FASI_UI.findIndex(([x]) => x === (cr.fase === 'moduli_default' ? 'database' : cr.fase)), mio = FASI_UI.findIndex(([x]) => x === k)
                      const fatto = mio < idx, corrente = mio === idx
                      return <div key={k} className={'text-sm flex items-center gap-2 ' + (fatto ? 'text-green-400' : corrente ? 'text-ink' : 'text-gray-600')}><span className="w-4 text-center">{fatto ? '✓' : corrente ? '…' : '·'}</span>{l}</div>
                    })}
                  </div>
                  <p className="text-xs text-gray-500 mt-3">Puoi lasciare la pagina: la creazione continua e la ritrovi qui.</p>
                </div>
              ) : a.tenant_slug ? (
                <div>
                  <p className="text-sm text-gray-400">Da questa analisi è nato il tenant <b className="text-ink">{a.tenant_slug}</b>. <button type="button" className="text-cp-primary underline" onClick={() => onNavigate && onNavigate('tenants')}>Vai ai tenant</button></p>
                  {cr && cr.fase === 'finita' && (
                    <div className="mt-3 bg-green-900/20 border border-green-900/40 rounded-lg p-3 text-sm text-green-300">
                      <div className="font-medium mb-1">Tenant creato in {cr.secondi} secondi</div>
                      <div className="text-xs text-green-400/80">Moduli installati: {cr.moduli_installati} · ruoli creati: {cr.ruoli_creati} · moduli configurati: {cr.moduli_configurati}{cr.moduli_dichiarati != null ? ' · ruoli dichiarati: ' + cr.moduli_dichiarati + ' · report creati (spenti): ' + cr.report_creati : ''}</div>
                      {cr.tempi && <div className="text-xs text-green-400/60 mt-1">Dove è andato il tempo: {FASI_UI.filter(([k]) => cr.tempi[k] != null).map(([k, l]) => l + ' ' + cr.tempi[k] + ' s').join(' · ')}</div>}
                      {(cr.avvisi || []).map((v, i) => <div key={i} className="text-xs text-amber-300 mt-1">{v}</div>)}
                      {credenziali && <div className="text-xs mt-2">Accesso admin (si vede una volta sola): <span className="font-mono">{credenziali.username}</span> / <span className="font-mono">{credenziali.password}</span></div>}
                    </div>
                  )}
                </div>
              ) : (
                <>
                  {cr && cr.fase === 'errore' && <div className="mb-3 bg-red-900/20 border border-red-900/40 rounded-lg p-3 text-xs text-red-300">Creazione non riuscita: {cr.errore}</div>}
                  <p className="text-xs text-gray-500 mb-3">Installa i {b.moduli_ids.length} moduli{b.moduli_collegati && b.moduli_collegati.length ? ' (compresi quelli collegati: ' + b.moduli_collegati.join(', ') + ')' : ' scelti'} e crea i {b.ruoli_utente} ruoli degli utenti; i passaggi diventano gli stati del flusso dei moduli. Non tocca un modulo che ha già i suoi. Fino a questo tocco non è stato scritto niente.</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mb-3">
                    <input className={input} placeholder="Nome del tenant" value={tf.name} onChange={(e) => setTf({ name: e.target.value, slug: slugify(e.target.value) })} />
                    <input className={input + ' font-mono'} placeholder="indirizzo (solo minuscole e trattini)" value={tf.slug} onChange={(e) => setTf({ ...tf, slug: slugify(e.target.value) })} />
                  </div>
                  <button type="button" className={btn} onClick={creaTenant}>Crea il tenant</button>
                </>
              )}
            </section>
  )

  const stampa = () => window.print()

  // In compilazione: si vede cosa sta facendo, con i processi che compaiono man mano.
  if (autoAttivo) {
    const au = a.auto, sec = Math.max(0, Math.round((now - au.inizio) / 1000))
    return (
      <div className="max-w-3xl">
        <h1 className="text-lg font-bold text-ink tracking-[-0.35px] mb-1">{a.name}</h1>
        <p className="text-gray-500 text-sm mb-5">Sto compilando l'analisi… {sec} secondi. Puoi lasciare la pagina: continua da sola e la ritrovi qui.</p>
        <div className={card}>
          <div className="space-y-1.5 text-sm">
            <div className={au.fase === 'processi' ? 'text-ink' : 'text-green-400'}>{au.fase === 'processi' ? '… Cerco i processi dell\'attività' : '✓ Ho trovato ' + a.processi.length + ' processi'}</div>
            <div className={au.fase === 'completamento' ? 'text-ink' : 'text-gray-600'}>{au.fase === 'completamento' ? '… Completo i processi: ' + au.fatti + ' di ' + au.totale : '· Completo i processi'}</div>
            <div className={au.fase === 'approfondimento' ? 'text-ink' : 'text-gray-600'}>{au.fase === 'approfondimento' ? '… Controllo cosa serve davvero a ogni processo' : '· Controllo cosa serve davvero a ogni processo'}</div>
          </div>
          {a.processi.length > 0 && <div className="mt-4 flex flex-wrap gap-1.5">{a.processi.map((p, i) => <span key={i} className={'text-xs px-2.5 py-1 rounded-lg border ' + (needsEnrichment(p) ? 'border-gray-800 text-gray-500' : 'border-green-900/50 text-green-400')}>{p.nome}</span>)}</div>}
        </div>
      </div>
    )
  }

  // Il riepilogo: per chi ha usato «Fai tutto», una sola schermata e un solo tocco per creare il tenant.
  if (vista === 'riepilogo' && a.auto) {
    const esc = (a.scelte && a.scelte.escludi) || [], pr2 = b.proposte || { report: [], ai: [] }
    const report = pr2.report.filter((x) => !esc.includes(x.key)), ai = pr2.ai.filter((x) => !esc.includes(x.key))
    const incompleti = a.processi.filter((p) => needsEnrichment(p)).length
    const nomeMod = (id) => (modules.find((m) => m.id === id) || {}).name || ''
    return (
      <div className="max-w-3xl">
        <style>{STAMPA_CSS}</style>
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <button type="button" onClick={() => { setA(null); loadList() }} className="text-gray-500 hover:text-ink transition flex items-center gap-1 text-sm"><Icon name="chevron-left" size={14} />Analisi</button>
          <input className={input + ' flex-1 min-w-[180px] font-semibold'} value={a.name} onChange={(e) => change({ name: e.target.value })} aria-label="Nome dell'attività" />
          <button type="button" onClick={remove} aria-label="Elimina l'analisi" title="Elimina l'analisi" className="p-2 text-gray-500 hover:text-red-400 transition"><Icon name="trash" size={16} /></button>
        </div>
        {msg && <div className={'text-sm mb-3 ' + (msg.ok ? 'text-green-400' : 'text-amber-400')}>{msg.text}</div>}
        {a.auto.fase === 'errore' && <div className="mb-4 bg-red-900/20 border border-red-900/40 rounded-lg p-3 text-sm text-red-300">Non sono riuscito a compilare l'analisi: {a.auto.errore}. Puoi completarla a mano dai dettagli.</div>}
        <section className={card}>
          <h2 className="text-sm font-semibold text-ink mb-3">Ecco cosa ho preparato</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-3">
            {[['Processi', b.processi], ['Moduli', b.moduli_ids.length], ['Ruoli utente', b.ruoli_utente], ['Report (spenti)', report.length]].map(([l, v]) => (
              <div key={l} className="bg-surface-page rounded-lg p-3 border border-gray-800"><div className="text-[11px] text-gray-500">{l}</div><div className="text-xl font-semibold text-ink">{v}</div></div>
            ))}
          </div>
          {incompleti > 0 && <p className="text-xs text-amber-400 mb-2">{incompleti} {incompleti === 1 ? 'processo non è completo' : 'processi non sono completi'}: aprili dai dettagli e premi «Completa tutti i processi».</p>}
          {b.da_costruire.length > 0 && <p className="text-xs text-gray-500 mb-2">Nessun modulo copre: {b.da_costruire.join(', ')}. Si costruiscono nel Super Builder dai dettagli.</p>}
          <div className="divide-y divide-gray-800 mt-2">
            {a.processi.map((p, i) => (
              <div key={i} className="py-2 flex items-start justify-between gap-3">
                <div className="min-w-0"><div className="text-sm text-ink">{p.nome}{p.reparto ? <span className="text-gray-500"> · {p.reparto}</span> : null}</div>{p.scopo && <div className="text-xs text-gray-500 truncate">{p.scopo}</div>}</div>
                <span className={'text-[11px] px-2 py-1 rounded flex-shrink-0 ' + (p.registry_module_id ? 'bg-green-900/30 text-green-400' : 'bg-gray-800 text-gray-400')}>{p.registry_module_id ? nomeMod(p.registry_module_id) : 'da costruire'}</span>
              </div>
            ))}
          </div>
          {(report.length > 0 || ai.length > 0) && (
            <div className="mt-3 text-xs text-gray-500 space-y-1">
              {report.length > 0 && <div><b className="text-gray-400">Report spenti:</b> {report.map((x) => x.nome).join(', ')}</div>}
              {ai.length > 0 && <div><b className="text-gray-400">AI pronta (ferma finché non la accendi):</b> {[...new Set(ai.map((x) => x.modulo))].join(', ')}</div>}
              <div>Togli quello che non ti serve dai dettagli.</div>
            </div>
          )}
          <div className="flex gap-2 mt-4 flex-wrap"><button type="button" className={ghost} onClick={() => setVista('dettagli')}>Rivedi i dettagli</button><button type="button" className={ghost} onClick={() => { setVista('dettagli'); setShowManuale(true) }}>Apri il manuale</button><button type="button" className={ghost} onClick={() => { setVista('dettagli'); apriGuida() }}>Guida all'uso</button></div>
          <div className="mt-4"><CorreggiAParole analysisId={a.id} req={req} btn={btn} ghost={ghost} input={input} onApplied={(d) => { setA(d); setProposte([]) }} /></div>
        </section>
        {a.processi.length > 0 && creaPanel('')}
      </div>
    )
  }

  return (
    <div className="max-w-3xl">
      <style>{STAMPA_CSS}</style>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <button type="button" onClick={() => { setA(null); loadList() }} className="text-gray-500 hover:text-ink transition flex items-center gap-1 text-sm"><Icon name="chevron-left" size={14} />Analisi</button>
        {a.auto && <button type="button" onClick={() => setVista('riepilogo')} className="text-xs text-cp-primary hover:opacity-80 transition">Riepilogo</button>}
        <input className={input + ' flex-1 min-w-[180px] font-semibold'} value={a.name} onChange={(e) => change({ name: e.target.value })} aria-label="Nome dell'analisi" />
        <span className="text-xs text-gray-500 w-16 text-right">{saving === 'saving' ? 'Salvo…' : saving === 'saved' ? 'Salvato' : saving === 'error' ? 'Non salvato' : ''}</span>
        <button type="button" onClick={remove} aria-label="Elimina l'analisi" title="Elimina l'analisi" className="p-2 text-gray-500 hover:text-red-400 transition"><Icon name="trash" size={16} /></button>
      </div>
      {msg && <div className={'text-sm mb-3 ' + (msg.ok ? 'text-green-400' : 'text-amber-400')}>{msg.text}</div>}

      {guida ? (
        <>
          <div className="flex gap-2 mb-3 flex-wrap no-stampa"><button type="button" className={ghost} onClick={() => setGuida(null)}>← Torna all'analisi</button><button type="button" className={btn} onClick={stampa}>Stampa o salva in PDF</button></div>
          <Guida guida={guida} />
        </>
      ) : showManuale ? (
        <>
          <div className="flex gap-2 mb-3 flex-wrap no-stampa"><button type="button" className={ghost} onClick={() => setShowManuale(false)}>← Torna all'analisi</button><button type="button" className={btn} onClick={stampa}>Stampa o salva in PDF</button></div>
          <Manuale analysis={a} modules={modules} />
        </>
      ) : (
        <>
          <section className={card}>
            <h2 className="text-sm font-semibold text-ink mb-1">1. Racconta l'attività</h2>
            <p className="text-xs text-gray-500 mb-3">Come funziona, chi fa cosa, dove si inceppa. I dati personali (email, telefoni, IBAN) vengono tolti prima di mandare il testo all'AI.</p>
            <textarea className={input + ' min-h-[110px] leading-relaxed'} placeholder="Es. Siamo un'officina con 6 meccanici. Il cliente porta l'auto, la accettiamo e facciamo un preventivo…" value={a.descrizione} onChange={(e) => change({ descrizione: e.target.value })} />
            <div className="flex items-center gap-2 mt-3 flex-wrap">
              <button type="button" className={btn} onClick={proponi} disabled={busy === 'proponi' || a.descrizione.trim().length < 10}><Icon name="sparkles" size={13} className="inline mr-1.5 -mt-0.5" />{busy === 'proponi' ? 'Analizzo…' : 'Proponi i processi'}</button>
              <button type="button" className={ghost} onClick={() => setShowProfilo((s) => !s)}>{showProfilo ? 'Nascondi' : 'Aggiungi'} profilo dell'attività</button>
            </div>
            {showProfilo && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mt-3">
                <input className={input} placeholder="Settore" value={pr.settore || ''} onChange={(e) => setProfilo({ settore: e.target.value })} />
                <input className={input} placeholder="Dimensione (es. piccola, 6 persone)" value={pr.dimensione || ''} onChange={(e) => setProfilo({ dimensione: e.target.value })} />
                <input className={input} type="number" min="0" placeholder="Dipendenti" value={pr.numero_dipendenti || ''} onChange={(e) => setProfilo({ numero_dipendenti: e.target.value })} />
                <input className={input} type="number" min="0" placeholder="Sedi" value={pr.numero_sedi || ''} onChange={(e) => setProfilo({ numero_sedi: e.target.value })} />
                <input className={input} placeholder="Reparti (separati da virgola)" defaultValue={(pr.reparti || []).join(', ')} onBlur={(e) => setProfilo({ reparti: csv(e.target.value) })} />
                <input className={input} placeholder="Sistemi in uso (separati da virgola)" defaultValue={(pr.sistemi_esistenti || []).join(', ')} onBlur={(e) => setProfilo({ sistemi_esistenti: csv(e.target.value) })} />
                <input className={input + ' sm:col-span-2'} placeholder="Obiettivi" value={pr.obiettivi || ''} onChange={(e) => setProfilo({ obiettivi: e.target.value })} />
                <input className={input + ' sm:col-span-2'} placeholder="Criticità" value={pr.criticita || ''} onChange={(e) => setProfilo({ criticita: e.target.value })} />
              </div>
            )}
          </section>

          {proposte.length > 0 && (
            <section className={card + ' border-cp-primary/40'}>
              <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                <h2 className="text-sm font-semibold text-ink">Proposte dell'AI</h2>
                <div className="flex gap-2"><button type="button" className={btn} onClick={() => aggiungi(proposte)}>Aggiungi tutte</button><button type="button" className={ghost} onClick={() => setProposte([])}>Scarta</button></div>
              </div>
              <div className="divide-y divide-gray-800">
                {proposte.map((p, i) => (
                  <div key={i} className="py-2.5 flex items-start justify-between gap-3">
                    <div className="min-w-0"><div className="text-sm text-ink font-medium">{p.nome}{p.reparto ? <span className="text-gray-500 font-normal"> · {p.reparto}</span> : null}</div>
                      {p.scopo && <div className="text-xs text-gray-500 mt-0.5">{p.scopo}</div>}
                      <div className="text-xs mt-1 text-gray-500">{p.registry_module_id ? 'Modulo: ' + ((modules.find((m) => m.id === p.registry_module_id) || {}).name || '') : (p.registry_module_reasoning || 'Nessun modulo adatto trovato')}</div></div>
                    <button type="button" className={ghost + ' flex-shrink-0'} onClick={() => aggiungi([p])}>Aggiungi</button>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className={card}>
            <h2 className="text-sm font-semibold text-ink mb-1">2. I processi</h2>
            <p className="text-xs text-gray-500 mb-3">Apri un processo per scrivere ruoli e passaggi, o fallo compilare all'AI dal nome. Scegli il modulo che lo copre: se nessuno lo copre, segnalo «da costruire».</p>
            <div className="space-y-2">
              {a.processi.map((p, i) => (
                <ProcessoEditor key={i} processo={p} modules={modules} token={token} onBuild={onBuild} onChange={(patch) => setProcesso(i, patch)} onRemove={() => change({ processi: a.processi.filter((_, k) => k !== i) })} />
              ))}
            </div>
            {a.processi.length === 0 && <div className="text-sm text-gray-500 mb-2">Nessun processo: proponili dal racconto o aggiungili a mano.</div>}
            <div className="flex gap-2 flex-wrap mt-3">
              <button type="button" className={ghost} onClick={() => change({ processi: [...a.processi, nuovoProcesso({})] })}><Icon name="plus" size={12} className="inline mr-1 -mt-0.5" />Aggiungi un processo</button>
              {a.processi.some((p) => p.nome && p.nome.trim() && needsEnrichment(p)) && (
                <button type="button" className={btn} onClick={completaTutti} disabled={!!completa}><Icon name="sparkles" size={13} className="inline mr-1.5 -mt-0.5" />{completa ? 'Completo ' + completa.fatti + ' di ' + completa.totale + '…' : 'Completa tutti i processi (' + a.processi.filter((p) => p.nome && p.nome.trim() && needsEnrichment(p)).length + ')'}</button>
              )}
            </div>
          </section>

          {a.processi.length > 0 && (
            <section className={card}>
              <h2 className="text-sm font-semibold text-ink mb-3">3. Cosa copre la Libreria</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-3">
                {[['Processi', b.processi], ['Coperti', b.coperto], ['Da valutare', b.da_valutare], ['Da costruire', b.da_costruire.length]].map(([l, v]) => (
                  <div key={l} className="bg-surface-page rounded-lg p-3 border border-gray-800"><div className="text-[11px] text-gray-500">{l}</div><div className="text-xl font-semibold text-ink">{v}</div></div>
                ))}
              </div>
              {b.moduli_collegati && b.moduli_collegati.length > 0 && <p className="text-xs text-gray-500 mb-3">Moduli collegati che servono ai tuoi moduli e vengono aggiunti: {b.moduli_collegati.join(', ')}.</p>}
              {b.manca && b.manca.length > 0 && <p className="text-xs text-gray-500 mb-3">Non coperto da nessun modulo: {b.manca.map((m) => m.processo + ' (' + m.voci.join(', ') + ')').join('; ')}.</p>}
              {b.da_costruire.length > 0 && <p className="text-xs text-gray-500 mb-3">Da costruire: {b.da_costruire.join(', ')}. Si costruiscono nel Super Builder.</p>}
              <div className="flex gap-2 flex-wrap"><button type="button" className={btn} onClick={() => setShowManuale(true)}>Apri il manuale</button><button type="button" className={ghost} onClick={apriGuida}>Guida all'uso</button><button type="button" className={ghost} onClick={approfondisci} disabled={approfondendo}>{approfondendo ? 'Controllo…' : 'Cosa manca?'}</button></div>
              <div className="mt-4"><CorreggiAParole analysisId={a.id} req={req} btn={btn} ghost={ghost} input={input} onApplied={(d) => { setA(d); setProposte([]) }} /></div>
            </section>
          )}

          {!a.tenant_slug && b.proposte && (b.proposte.report.length > 0 || b.proposte.ai.length > 0) && (
            <section className={card}>
              <h2 className="text-sm font-semibold text-ink mb-1">4. Report e AI per questo tenant</h2>
              <p className="text-xs text-gray-500 mb-3">Dedotti da ciò che i moduli scelti dichiarano. I report nascono <b>spenti</b> (li accendi tu, con orario e destinatari); i potenziamenti AI restano fermi finché non accendi l'AI e inserisci una chiave nel tenant. Togli quello che non ti serve.</p>
              {[['Report', b.proposte.report], ['Potenziamenti AI', b.proposte.ai]].filter(([, l]) => l.length > 0).map(([titolo, l]) => (
                <div key={titolo} className="mb-2">
                  <div className="text-xs uppercase tracking-wide text-gray-500 font-semibold mb-1">{titolo}</div>
                  <div className="divide-y divide-gray-800">
                    {l.map((x) => {
                      const esc = (a.scelte && a.scelte.escludi) || []
                      return (
                        <label key={x.key} className="flex items-start gap-2.5 py-2 cursor-pointer">
                          <input type="checkbox" className="mt-1" checked={!esc.includes(x.key)} onChange={(e) => change({ scelte: { escludi: e.target.checked ? esc.filter((k) => k !== x.key) : [...esc, x.key] } })} />
                          <span className="text-sm"><span className="text-ink">{x.nome || (x.modulo + ' · ' + ({ triage: 'Smistare', explain: 'Spiegare', import: 'Importare' }[x.feature] || x.feature))}</span><span className="block text-xs text-gray-500">{x.perche}</span></span>
                        </label>
                      )
                    })}
                  </div>
                </div>
              ))}
            </section>
          )}

          {a.processi.length > 0 && creaPanel('5. ')}
        </>
      )}
    </div>
  )
}
