import React, { useState, useEffect, useRef } from 'react'
import { API } from '../lib/api'
import Icon from '../components/Icon'
import ProcessoEditor from '../components/analyses/ProcessoEditor'
import Manuale from '../components/analyses/Manuale'

// Analisi dei processi: racconti un'attività, l'AI propone i processi (mai salvati da soli), li rifinisci, vedi cosa copre la Libreria e cosa va costruito,
// apri il manuale (stampabile) e, se vuoi, crei il tenant con i moduli, i ruoli e gli stati del flusso che ne derivano. Si salva da sola mentre scrivi.
const card = 'bg-surface-card border border-gray-800 rounded-xl p-4 md:p-5 mb-4'
const input = 'w-full bg-surface-page text-ink px-3 py-2 rounded-lg outline-none border border-gray-800 focus:border-cp-primary transition text-sm placeholder-gray-600'
const btn = 'bg-cp-primary hover:bg-cp-primary-hover disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition'
const ghost = 'px-4 py-2 rounded-lg text-sm bg-surface-page hover:bg-gray-800 text-gray-300 transition border border-gray-800 disabled:opacity-50'
const slugify = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30)
const csv = (v) => String(v || '').split(',').map((x) => x.trim()).filter(Boolean)
const nuovoProcesso = (extra) => ({ nome: '', reparto: '', scopo: '', evento_innesco: '', input: '', output: '', ruoli_coinvolti: [], passaggi: [], eccezioni: [], documenti_collegati: [], sistemi_coinvolti: [], kpi: [], callout: [], registry_module_id: null, registry_module_reasoning: '', copertura: 'da_valutare', ...extra })

export default function AnalisiPage({ token, onNavigate }) {
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
  const [tf, setTf] = useState({ name: '', slug: '' })
  const [created, setCreated] = useState(null)
  const timer = useRef(null)

  const loadList = async () => { const r = await req('GET', ''); if (r.ok) setList(r.data) }
  useEffect(() => { loadList(); req('GET', '/library').then((r) => r.ok && setModules(r.data)) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const open = async (id) => {
    const r = await req('GET', '/' + id)
    if (r.ok) { setA(r.data); setProposte([]); setShowManuale(false); setCreated(null); setMsg(null); setTf({ name: r.data.name, slug: slugify(r.data.name) }) }
  }
  const create = async () => {
    if (!newName.trim()) { setMsg({ ok: false, text: 'Dai un nome all\'analisi.' }); return }
    const r = await req('POST', '', { name: newName })
    if (r.ok) { setNewName(''); loadList(); open(r.data.id) } else setMsg({ ok: false, text: r.data.error || 'Non riuscito.' })
  }
  const remove = async () => {
    if (!window.confirm('Togliere l\'analisi «' + a.name + '»? Il tenant eventualmente creato resta.')) return
    const r = await req('DELETE', '/' + a.id)
    if (r.ok) { setA(null); loadList() }
  }

  // Salvataggio automatico: dopo mezzo secondo senza modifiche si manda tutto; la risposta aggiorna solo il riepilogo, mai ciò che si sta scrivendo.
  const change = (patch) => {
    setA((cur) => {
      const next = { ...cur, ...patch }
      clearTimeout(timer.current); setSaving('saving')
      timer.current = setTimeout(async () => {
        const r = await req('PATCH', '/' + next.id, { name: next.name, descrizione: next.descrizione, profilo: next.profilo, processi: next.processi })
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

  const creaTenant = async () => {
    if (!tf.name.trim() || !tf.slug.trim()) { setMsg({ ok: false, text: 'Servono nome e indirizzo del tenant.' }); return }
    if (!window.confirm('Creare il tenant «' + tf.name + '» con ' + a.blueprint.moduli_ids.length + ' moduli e i ruoli dell\'analisi?')) return
    setBusy('tenant'); setMsg(null)
    const r = await req('POST', '/' + a.id + '/create-tenant', { name: tf.name, slug: tf.slug })
    setBusy('')
    if (r.ok) { setCreated(r.data); setA({ ...a, tenant_slug: r.data.slug }); loadList() } else setMsg({ ok: false, text: r.data.error || 'Non riuscito.' })
  }

  // ── elenco ──
  if (!a) {
    return (
      <div className="max-w-3xl">
        <h1 className="text-lg font-bold text-ink tracking-[-0.35px] mb-1">Analisi dei processi</h1>
        <p className="text-gray-500 text-sm mb-6">Racconta come funziona un'attività: l'AI propone i processi, tu li rifinisci, e ne esce il manuale e, se vuoi, il tenant.</p>
        <div className={card}>
          <div className="flex gap-2 flex-wrap">
            <input className={input + ' flex-1 min-w-[200px]'} placeholder="Nome dell'analisi (es. Officina Rossi)" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} />
            <button type="button" className={btn} onClick={create}>Nuova analisi</button>
          </div>
          {msg && <div className={'text-xs mt-2 ' + (msg.ok ? 'text-green-400' : 'text-amber-400')}>{msg.text}</div>}
        </div>
        {list && list.length === 0 && <div className="text-sm text-gray-500">Nessuna analisi ancora.</div>}
        <div className="space-y-2">
          {(list || []).map((x) => (
            <button key={x.id} type="button" onClick={() => open(x.id)} className="w-full text-left bg-surface-card border border-gray-800 hover:border-gray-600 rounded-xl p-4 transition flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-ink truncate">{x.name}</div>
                <div className="text-xs text-gray-500 mt-0.5">{x.n_processi} processi{x.n_da_costruire ? ' · ' + x.n_da_costruire + ' da costruire' : ''}{x.tenant_slug ? ' · tenant ' + x.tenant_slug : ''}</div>
              </div>
              <Icon name="chevron-right" size={14} className="text-gray-600 flex-shrink-0" />
            </button>
          ))}
        </div>
      </div>
    )
  }

  const b = a.blueprint, pr = a.profilo || {}
  const setProfilo = (patch) => change({ profilo: { ...pr, ...patch } })
  const stampa = () => window.print()

  return (
    <div className="max-w-3xl">
      <style>{'@media print{body *{visibility:hidden}#manuale,#manuale *{visibility:visible}#manuale{position:absolute;left:0;top:0;width:100%;border:0!important}}'}</style>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <button type="button" onClick={() => { setA(null); loadList() }} className="text-gray-500 hover:text-ink transition flex items-center gap-1 text-sm"><Icon name="chevron-left" size={14} />Analisi</button>
        <input className={input + ' flex-1 min-w-[180px] font-semibold'} value={a.name} onChange={(e) => change({ name: e.target.value })} aria-label="Nome dell'analisi" />
        <span className="text-xs text-gray-500 w-16 text-right">{saving === 'saving' ? 'Salvo…' : saving === 'saved' ? 'Salvato' : saving === 'error' ? 'Non salvato' : ''}</span>
      </div>
      {msg && <div className={'text-sm mb-3 ' + (msg.ok ? 'text-green-400' : 'text-amber-400')}>{msg.text}</div>}

      {showManuale ? (
        <>
          <div className="flex gap-2 mb-3 flex-wrap"><button type="button" className={ghost} onClick={() => setShowManuale(false)}>← Torna all'analisi</button><button type="button" className={btn} onClick={stampa}>Stampa o salva in PDF</button></div>
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
                <ProcessoEditor key={i} processo={p} modules={modules} token={token} onChange={(patch) => setProcesso(i, patch)} onRemove={() => change({ processi: a.processi.filter((_, k) => k !== i) })} />
              ))}
            </div>
            {a.processi.length === 0 && <div className="text-sm text-gray-500 mb-2">Nessun processo: proponili dal racconto o aggiungili a mano.</div>}
            <button type="button" className={ghost + ' mt-3'} onClick={() => change({ processi: [...a.processi, nuovoProcesso({})] })}><Icon name="plus" size={12} className="inline mr-1 -mt-0.5" />Aggiungi un processo</button>
          </section>

          {a.processi.length > 0 && (
            <section className={card}>
              <h2 className="text-sm font-semibold text-ink mb-3">3. Cosa copre la Libreria</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-3">
                {[['Processi', b.processi], ['Coperti', b.coperto], ['Da valutare', b.da_valutare], ['Da costruire', b.da_costruire.length]].map(([l, v]) => (
                  <div key={l} className="bg-surface-page rounded-lg p-3 border border-gray-800"><div className="text-[11px] text-gray-500">{l}</div><div className="text-xl font-semibold text-ink">{v}</div></div>
                ))}
              </div>
              {b.da_costruire.length > 0 && <p className="text-xs text-gray-500 mb-3">Da costruire: {b.da_costruire.join(', ')}. Si costruiscono nel Super Builder.</p>}
              <div className="flex gap-2 flex-wrap"><button type="button" className={btn} onClick={() => setShowManuale(true)}>Apri il manuale</button></div>
            </section>
          )}

          {a.processi.length > 0 && (
            <section className={card}>
              <h2 className="text-sm font-semibold text-ink mb-1">4. Crea il tenant</h2>
              {a.tenant_slug ? (
                <p className="text-sm text-gray-400">Da questa analisi è nato il tenant <b className="text-ink">{a.tenant_slug}</b>. <button type="button" className="text-cp-primary underline" onClick={() => onNavigate && onNavigate('tenants')}>Vai ai tenant</button></p>
              ) : (
                <>
                  <p className="text-xs text-gray-500 mb-3">Installa i {b.moduli_ids.length} moduli scelti e crea i {b.ruoli_utente} ruoli degli utenti; i passaggi diventano gli stati del flusso dei moduli. Non tocca un modulo che ha già i suoi. Fino a questo tocco non è stato scritto niente.</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mb-3">
                    <input className={input} placeholder="Nome del tenant" value={tf.name} onChange={(e) => setTf({ name: e.target.value, slug: slugify(e.target.value) })} />
                    <input className={input + ' font-mono'} placeholder="indirizzo (solo minuscole e trattini)" value={tf.slug} onChange={(e) => setTf({ ...tf, slug: slugify(e.target.value) })} />
                  </div>
                  <button type="button" className={btn} onClick={creaTenant} disabled={busy === 'tenant'}>{busy === 'tenant' ? 'Creo il tenant… (può volerci un minuto)' : 'Crea il tenant'}</button>
                </>
              )}
              {created && (
                <div className="mt-4 bg-green-900/20 border border-green-900/40 rounded-lg p-3 text-sm text-green-300">
                  <div className="font-medium mb-1">Tenant creato: {created.name}</div>
                  <div className="text-xs text-green-400/80">Moduli installati: {created.modules_installed}{created.config_summary ? ' · ruoli creati: ' + created.config_summary.roles_created.length + ' · moduli configurati: ' + created.config_summary.modules_configured.length : ''}</div>
                  <div className="text-xs mt-2">Accesso admin (si vede una volta sola): <span className="font-mono">{created.initial_credentials.username}</span> / <span className="font-mono">{created.initial_credentials.password}</span></div>
                </div>
              )}
            </section>
          )}
          <div className="text-right"><button type="button" onClick={remove} className="text-xs text-gray-600 hover:text-red-400 transition">Togli questa analisi</button></div>
        </>
      )}
    </div>
  )
}
