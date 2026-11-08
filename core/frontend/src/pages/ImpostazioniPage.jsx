import React, { useState, useEffect } from 'react'
import GmailRulesPanel from '../components/GmailRulesPanel'
import SiteLeadEmailPanel from '../components/SiteLeadEmailPanel'
import ExportDatiPage from './ExportDatiPage'
import BackupPage from './BackupPage'
import AiSettingsPage from '../components/AiSettingsPage'
import ReportsSettingsTab from '../components/ReportsSettingsTab'
import { API } from '../lib/api'
import useApi from '../lib/useApi'
import Icon from '../components/Icon'
import Tile from '../components/Tile'
import UsersPage from './UsersPage'
import AccountPage from './AccountPage'
import SuggestionsTab from '../components/SuggestionsTab'
import FeaturesTab from '../components/FeaturesTab'
import ExportServerCard from '../components/ExportServerCard'
import TelegramCard from '../components/TelegramCard'
import SitoWebPage from './SitoWebPage'
import SicurezzaTab from '../components/SicurezzaTab'
import ReviewMatchesTab from '../components/ReviewMatchesTab'
import MovimentiPage from './MovimentiPage'
import ListePage from './ListePage'
import AspettoTab from './AspettoTab'
import GlassPageBackground from '../components/GlassPageBackground'

// "Il mio account" unito qui (2026-08-29, richiesto esplicitamente dall'utente) —
// prima era una pagina a sé raggiunta dal proprio nome in fondo alla Sidebar.
// A differenza degli altri tab (tutti admin-only), il 2FA personale serve a
// QUALUNQUE utente loggato — per questo l'intera pagina, sotto, non è più
// admin-gated: un non-admin vede solo il tab "Il mio account", filtrato qui,
// non a monte in App.jsx.
// Connessioni (2026-08-23) — prima l'unico posto per gestire Google/altre
// integrazioni era sepolto dentro Store → dettaglio di UN modulo che le
// richiede (visibile solo se quel modulo dichiara connection_required) —
// l'utente stesso non trovava il bottone. Stessa identica logica/messaggi
// già in LibreriaPage.jsx (connectGoogle/disconnectGoogle/toggleDrive/warning
// drive_scope_ok), spostata qui dove è sempre visibile — nessuna riscrittura
// concettuale, solo un posto più naturale da controllare, anche quando non
// stai guardando un modulo specifico in quel momento.
function ConnessioniTab({ token, user, features = {} }) {
  const [tgStatus, setTgStatus] = useState(null) // Telegram ha il suo stato e la sua scheda, ma compare qui come gli altri servizi
  const api = useApi(token)
  const [connections, setConnections] = useState([])
  const [googleStatus, setGoogleStatus] = useState(null)
  const [openFor, setOpenFor] = useState(null)
  const [credForm, setCredForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [waTest, setWaTest] = useState(null) // { busy } oppure { esito, dettaglio, error }
  const [speseOa, setSpeseOa] = useState(null) // spese di OpenAPI.it: contatore del mese, tetto, prezzi, ultime richieste
  const [demoOa, setDemoOa] = useState(null) // dati dimostrativi: { disponibili, totale, presenti, piano?, busy?, risultato?, errore? }
  const [serviziOa, setServiziOa] = useState(null) // controllo dei servizi OpenAPI.it: { busy } oppure { ambiente, servizi } oppure { error }

  const loadConnections = async () => { const data = await api.get('/connections'); if (data) setConnections(data) }
  const loadGoogleStatus = async () => { const data = await api.get('/integrazioni/google/status'); if (data) setGoogleStatus(data) }
  const loadTelegramStatus = async () => { const data = await api.get('/telegram/status'); if (data) setTgStatus(data) }
  useEffect(() => { loadConnections(); loadGoogleStatus(); loadTelegramStatus() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const credFieldsFor = (id) => { const intg = connections.find((c) => c.id === id); return (intg && intg.cred_fields) || [] }
  const initialCredForm = (id) => { const f = {}; credFieldsFor(id).forEach((x) => { f[x.key] = '' }); return f }
  // Messaggio di prova WhatsApp: dice, per ogni destinatario, se è davvero partito.
  const testWhatsApp = async () => {
    setWaTest({ busy: true })
    const res = await api.post('/connections/whatsapp_callmebot/test', {})
    if (!res.ok) { setWaTest({ error: (res.data && res.data.error) || 'Prova non riuscita' }); return }
    setWaTest({ esito: res.data.esito, risultati: res.data.risultati })
  }
  // Quali servizi di OpenAPI.it la chiave collegata può usare davvero: una lettura gratuita per servizio, nessun controllo a pagamento.
  const controllaServizi = async () => {
    setServiziOa({ busy: true })
    const res = await api.post('/connections/openapi_it/servizi', {})
    if (!res.ok) { setServiziOa({ error: (res.data && res.data.error) || 'Controllo non riuscito' }); return }
    setServiziOa({ ambiente: res.data.ambiente, servizi: res.data.servizi })
  }
  const caricaSpeseOa = async () => { const d = await api.get('/connections/openapi_it/spese'); if (d) setSpeseOa(d) }
  const salvaImpostazioniOa = async (corpo) => {
    const res = await api.put('/connections/openapi_it/impostazioni', corpo)
    if (res.ok) setSpeseOa(res.data); else setSpeseOa((x) => ({ ...(x || {}), errore: (res.data && res.data.error) || 'Non salvato.' }))
  }
  useEffect(() => { if (openFor === 'openapi_it' && connections.some((c) => c.id === 'openapi_it' && c.connected)) caricaSpeseOa() }, [openFor, connections]) // eslint-disable-line react-hooks/exhaustive-deps
  const caricaDemoOa = async () => { const d = await api.get('/connections/openapi_it/dati-dimostrativi'); if (d) setDemoOa((x) => ({ ...(x || {}), ...d })) }
  // Carica i dati dimostrativi: la prima richiesta torna con il piano dei costi da confermare (409), la seconda (conferma) li carica davvero.
  const avviaDemoOa = async (conferma = false) => {
    setDemoOa((x) => ({ ...(x || {}), busy: true, errore: null, risultato: null }))
    const res = await api.post('/connections/openapi_it/dati-dimostrativi', { conferma })
    if (!res.ok && res.data && res.data.code === 'conferma_costo') { setDemoOa((x) => ({ ...(x || {}), busy: false, piano: res.data })); return }
    if (!res.ok) { setDemoOa((x) => ({ ...(x || {}), busy: false, piano: null, errore: (res.data && res.data.error) || 'Caricamento non riuscito.' })); return }
    setDemoOa((x) => ({ ...(x || {}), busy: false, piano: null, risultato: res.data, presenti: res.data.presenti, totale: Object.values(res.data.presenti || {}).reduce((a, b) => a + b, 0) }))
    caricaSpeseOa()
  }
  const togliDemoOa = async () => {
    if (!window.confirm('Togliere tutti i dati dimostrativi? I dati veri non si toccano.')) return
    setDemoOa((x) => ({ ...(x || {}), busy: true, errore: null, risultato: null }))
    const res = await api.del('/connections/openapi_it/dati-dimostrativi')
    setDemoOa((x) => ({ ...(x || {}), busy: false, piano: null, presenti: (res.data && res.data.presenti) || {}, totale: 0, rimossi: res.ok ? res.data.rimossi : null, errore: res.ok ? null : 'Rimozione non riuscita.' }))
  }
  useEffect(() => { if (openFor === 'openapi_it' && connections.some((c) => c.id === 'openapi_it' && c.connected)) caricaDemoOa() }, [openFor, connections]) // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (id) => { const next = openFor === id ? null : id; setOpenFor(next); if (next) setCredForm(initialCredForm(next)) }

  const connectGoogle = () => { window.location.href = API + '/integrazioni/google/oauth/start' }
  const disconnectGoogle = async () => {
    const res = await api.post('/integrazioni/google/disconnect', {})
    if (res && res.ok) { loadConnections(); loadGoogleStatus() }
  }
  const toggleDrive = async () => {
    const res = await api.put('/integrazioni/google/drive', { enabled: !(googleStatus && googleStatus.drive_enabled) })
    if (res && res.ok) loadGoogleStatus()
  }
  const saveCred = async (id) => {
    setSaving(true)
    const res = id === 'google'
      ? await api.put('/integrazioni/google/config', credForm)
      : await api.put('/connections/' + id + '/credentials', credForm)
    setSaving(false)
    if (res && res.ok) { setOpenFor(null); loadConnections() }
  }
  const toggleConnGeneric = async (id) => {
    const res = await api.post('/connections/' + id + '/toggle', {})
    if (res && res.ok) loadConnections()
  }

  const googleConnected = !!(googleStatus && googleStatus.connected)
  const rows = [
    { id: 'google', name: 'Google (Gmail / Calendar / Drive)', connected: googleConnected },
    ...connections.filter((c) => c.id !== 'google' && c.id !== 'telegram').map((c) => ({ id: c.id, name: c.name || c.id, connected: !!c.connected, intg: c })),
    { id: 'telegram', name: 'Telegram (bot)', connected: !!(tgStatus && tgStatus.configured) },
  ]

  return (
    <div className="max-w-2xl">
      <p className="text-sm text-gray-500 mb-4">Account e servizi esterni collegati a questa istanza — usati dai moduli che ne hanno bisogno (es. Gmail).</p>
      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.id} className="glass-panel p-3">
            <button onClick={() => toggle(row.id)} className="flex items-center gap-1.5 w-full text-left">
              <Icon name="plug" size={13} className={row.connected ? 'text-green-400' : 'text-amber-400'} />
              <span className="text-sm text-ink font-medium">{row.name}</span>
              <span className={'ml-auto px-2 py-0.5 rounded text-[10px] ' + (row.connected ? 'bg-green-900/30 text-green-400' : 'bg-amber-900/30 text-amber-400')}>
                {row.connected ? 'Connesso' : 'Da connettere'}
              </span>
              <Icon name={openFor === row.id ? 'chevron-down' : 'chevron-right'} size={13} className="text-gray-600" />
            </button>
            {openFor === row.id && (
              <div className="mt-3 bg-surface-footer border border-gray-800 rounded-lg p-3">
                {row.id === 'telegram' ? (
                  <TelegramCard token={token} user={user} mode="admin" bare onChange={setTgStatus} />
                ) : row.id === 'google' ? (
                  <div>
                    {googleConnected ? (
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs bg-green-900/30 text-green-400 border border-green-900/50 px-3 py-1.5 rounded-lg">Connesso{googleStatus.email ? ' — ' + googleStatus.email : ''}</span>
                        <button onClick={disconnectGoogle} className="text-xs text-gray-500 hover:text-red-400 transition px-2 py-1.5">Disconnetti</button>
                      </div>
                    ) : (
                      <button onClick={connectGoogle} className="text-xs bg-accent hover:opacity-90 text-white px-3 py-1.5 rounded-lg transition font-medium">Connetti con Google</button>
                    )}
                    {googleConnected && (
                      <>
                        <label className="flex items-center gap-2.5 mt-3 text-xs text-gray-400 cursor-pointer select-none">
                          <button type="button" role="switch" aria-checked={!!googleStatus.drive_enabled} onClick={toggleDrive}
                            className={'w-8 h-[18px] rounded-full transition-colors relative flex-shrink-0 ' + (googleStatus.drive_enabled ? 'bg-accent' : 'bg-gray-700')}>
                            <span className={'absolute top-[2px] left-0 w-[14px] h-[14px] rounded-full bg-white transition-transform ' + (googleStatus.drive_enabled ? 'translate-x-[16px]' : 'translate-x-[2px]')} />
                          </button>
                          Salva gli allegati su Google Drive invece che sul server
                        </label>
                        {googleStatus.drive_enabled && !googleStatus.drive_scope_ok && (
                          <div className="mt-2 text-xs bg-amber-900/20 text-amber-400 border border-amber-900/40 rounded-lg px-3 py-2">
                            Il permesso Drive non è (più) autorizzato — probabilmente ti sei connesso prima che venisse richiesto.
                            Gli allegati vengono comunque salvati sul server (mai persi), ma non su Drive finché non
                            {' '}<button onClick={connectGoogle} className="underline hover:text-amber-300 transition">ricolleghi Google</button>.
                          </div>
                        )}
                      </>
                    )}
                    {googleConnected && features.gmail && <GmailRulesPanel token={token} nested />}
                  </div>
                ) : (
                  <div>
                    <div className="space-y-2.5">
                      {credFieldsFor(row.id).map((f) => (
                        <div key={f.key}>
                          <label className="block text-xs text-gray-500 mb-1">{f.label}</label>
                          <input type="text" value={credForm[f.key] || ''} onChange={(e) => setCredForm((p) => ({ ...p, [f.key]: e.target.value }))}
                            placeholder={f.placeholder}
                            className="w-full bg-surface-card border border-gray-700 rounded-lg px-3 py-2 text-sm text-ink placeholder-gray-600 focus:border-accent focus:outline-none font-mono" />
                        </div>
                      ))}
                      {credFieldsFor(row.id).length === 0 && <div className="text-xs text-gray-500">Nessun campo credenziale definito per questa integrazione.</div>}
                    </div>
                    <div className="flex items-center gap-2 mt-3 flex-wrap">
                      <button onClick={() => saveCred(row.id)} disabled={saving}
                        className="text-xs bg-accent hover:opacity-90 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg transition font-medium">
                        {saving ? 'Salvataggio...' : 'Salva e connetti'}
                      </button>
                      {row.id === 'whatsapp_callmebot' && row.connected && (
                        <button onClick={testWhatsApp} disabled={waTest && waTest.busy}
                          className="text-xs bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-300 px-3 py-1.5 rounded-lg transition">
                          {waTest && waTest.busy ? 'Invio...' : 'Invia messaggio di prova'}
                        </button>
                      )}
                      {row.id === 'openapi_it' && row.connected && (
                        <button onClick={controllaServizi} disabled={serviziOa && serviziOa.busy}
                          className="text-xs bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-300 px-3 py-1.5 rounded-lg transition">
                          {serviziOa && serviziOa.busy ? 'Controllo…' : 'Controlla i servizi'}
                        </button>
                      )}
                      {row.connected && (
                        <button onClick={() => toggleConnGeneric(row.id)} className="text-xs text-gray-500 hover:text-red-400 transition px-2 py-1.5">Disconnetti</button>
                      )}
                      {row.intg && row.intg.credentials_masked && (
                        <span className="text-[10px] text-gray-600 ml-auto">attuali: {Object.keys(row.intg.credentials_masked).join(', ')}</span>
                      )}
                    </div>
                    {row.id === 'openapi_it' && row.connected && speseOa && speseOa.prezzi && (
                      <div className="mt-4 pt-4 border-t border-gray-800">
                        <div className="flex items-baseline gap-2 flex-wrap">
                          <span className="text-sm text-ink font-medium">Spese del mese</span>
                          <span className="text-xl font-semibold text-ink">{Number(speseOa.produzione.speso).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })}</span>
                          <span className="text-xs text-gray-500">{speseOa.produzione.richieste} {speseOa.produzione.richieste === 1 ? 'richiesta' : 'richieste'} in produzione{speseOa.tetto ? ' · tetto ' + Number(speseOa.tetto).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' }) : ''}</span>
                        </div>
                        {speseOa.prova.richieste > 0 && <div className="text-xs text-gray-500 mt-0.5">In ambiente di prova: {speseOa.prova.richieste} {speseOa.prova.richieste === 1 ? 'richiesta' : 'richieste'}, non pagate (sarebbero {Number(speseOa.prova.stimato).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })}).</div>}
                        <div className="text-[11px] text-gray-600 mt-1">È una stima di Platform sui prezzi di listino qui sotto (IVA esclusa): il conto vero è quello di openapi.com.</div>
                        {speseOa.errore && <div className="text-xs text-amber-400 mt-2">{speseOa.errore}</div>}
                        <label className="block mt-3">
                          <span className="text-xs text-gray-500">Tetto di spesa mensile in € (vuoto: nessun tetto)</span>
                          <input type="number" min="0" step="1" defaultValue={speseOa.tetto || ''} key={'tetto' + speseOa.tetto}
                            onBlur={(e) => { const v = e.target.value === '' ? null : parseFloat(e.target.value); if (v !== (speseOa.tetto || null)) salvaImpostazioniOa({ tetto_mensile: v }) }}
                            className="mt-1 w-40 bg-surface-card border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-ink" />
                        </label>
                        <details className="mt-3">
                          <summary className="text-xs text-gray-400 cursor-pointer">Prezzi per richiesta</summary>
                          <div className="mt-2 space-y-1">
                            {speseOa.prezzi.map((p) => (
                              <div key={p.servizio} className="flex items-center gap-2 text-xs">
                                <span className="flex-1 text-gray-300">{p.nome}</span>
                                <input type="number" min="0" step="0.01" placeholder="non indicato" defaultValue={p.prezzo === null ? '' : p.prezzo} key={p.servizio + p.prezzo}
                                  onBlur={(e) => { const v = e.target.value === '' ? null : parseFloat(e.target.value); if (v !== p.prezzo) salvaImpostazioniOa({ prezzi: { [p.servizio]: v === p.listino ? null : v } }) }}
                                  className="w-28 bg-surface-card border border-gray-700 rounded px-2 py-1 text-ink text-right" />
                                <span className="text-gray-600 w-4">€</span>
                              </div>
                            ))}
                          </div>
                        </details>
                        {speseOa.ultime.length > 0 && (
                          <details className="mt-3">
                            <summary className="text-xs text-gray-400 cursor-pointer">Ultime richieste</summary>
                            <div className="mt-2 space-y-0.5">
                              {speseOa.ultime.map((u, i) => (
                                <div key={i} className="flex gap-2 text-xs text-gray-400">
                                  <span className="text-gray-600 w-32 flex-shrink-0">{String(u.quando).slice(0, 16).replace('T', ' ')}</span>
                                  <span className="flex-1 truncate">{u.descrizione || u.servizio}</span>
                                  <span className="text-gray-500">{u.ambiente === 'prova' ? 'prova' : Number(u.costo).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })}</span>
                                </div>
                              ))}
                            </div>
                          </details>
                        )}
                      </div>
                    )}
                    {row.id === 'openapi_it' && row.connected && demoOa && demoOa.disponibili && (
                      <div className="mt-4 pt-4 border-t border-gray-800">
                        <div className="text-sm text-ink font-medium">Dati dimostrativi</div>
                        <div className="text-xs text-gray-500 mt-0.5 leading-snug">Per mostrare cosa sa fare il portale: imprese dalle visure camerali, annunci vicino ad alcuni indirizzi e qualche cliente, trattativa e provvigione inventati che li collegano. Ogni dato è segnato come dimostrativo e si toglie tutto con un clic: i dati veri non si toccano.</div>
                        {demoOa.totale > 0 ? (
                          <div className="mt-2 flex items-center gap-3 flex-wrap">
                            <span className="text-xs text-gray-300">{Object.entries(demoOa.presenti || {}).map(([m, n]) => n + ' in «' + m + '»').join(' · ')}</span>
                            <button onClick={togliDemoOa} disabled={demoOa.busy} className="text-xs bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-200 px-3 py-1.5 rounded-lg transition">Togli i dati dimostrativi ({demoOa.totale})</button>
                          </div>
                        ) : !demoOa.piano && (
                          <button onClick={() => avviaDemoOa(false)} disabled={demoOa.busy} className="mt-2 text-xs bg-accent hover:opacity-90 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg transition font-medium">{demoOa.busy ? 'Un attimo…' : 'Carica i dati dimostrativi'}</button>
                        )}
                        {demoOa.piano && (
                          <div className="mt-3 bg-accent/10 border border-accent/30 rounded-lg p-3 text-xs" role="alertdialog" aria-label="Conferma del costo">
                            <div className="font-semibold text-ink mb-1.5">Conferma cosa verrà chiesto a OpenAPI.it</div>
                            {demoOa.piano.piano.voci.map((v, i) => (
                              <div key={i} className="flex justify-between gap-3 text-gray-400 py-0.5">
                                <span>{v.descrizione}</span>
                                <span className="text-gray-300 whitespace-nowrap">{v.noto ? (v.costo_unitario === 0 ? 'senza costi' : v.richieste + ' × ' + Number(v.costo_unitario).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })) : 'prezzo non indicato'}</span>
                              </div>
                            ))}
                            <div className="mt-1.5 text-gray-300">
                              {demoOa.piano.ambiente === 'prova' ? 'Sei in ambiente di prova: non si paga. In produzione sarebbero circa ' : 'Costo previsto: circa '}
                              <span className="font-semibold text-ink">{Number(demoOa.piano.piano.totale).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })}</span>
                              {demoOa.piano.piano.ignoti > 0 ? ' più le richieste con prezzo non indicato (le imposti qui sopra)' : ''}. Spesa del mese: {Number(demoOa.piano.speso_mese).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' })}{demoOa.piano.tetto ? ' su un tetto di ' + Number(demoOa.piano.tetto).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' }) : ''}.
                            </div>
                            <div className="flex gap-2 mt-2.5">
                              <button onClick={() => avviaDemoOa(true)} disabled={demoOa.busy} className="bg-accent hover:opacity-90 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg font-medium">{demoOa.busy ? 'Carico…' : 'Procedi'}</button>
                              <button onClick={() => setDemoOa((x) => ({ ...x, piano: null }))} className="bg-gray-800 hover:bg-gray-700 text-gray-200 px-3 py-1.5 rounded-lg">Annulla</button>
                            </div>
                          </div>
                        )}
                        {demoOa.errore && <div className="text-xs text-amber-500 mt-2">{demoOa.errore}</div>}
                        {demoOa.rimossi && <div className="text-xs text-gray-400 mt-2">Tolti: {Object.entries(demoOa.rimossi).map(([m, n]) => n + ' in «' + m + '»').join(' · ') || 'niente'}.</div>}
                        {demoOa.risultato && (
                          <div className="text-xs mt-2 text-gray-300">
                            <div className="font-medium text-ink">Caricati: {Object.entries(demoOa.risultato.creati).map(([m, n]) => n + ' in «' + m + '»').join(' · ') || 'nessun dato'}.</div>
                            {demoOa.risultato.avvisi.map((a, i) => <div key={i} className="text-amber-500 mt-0.5">• {a}</div>)}
                          </div>
                        )}
                      </div>
                    )}
                    {row.id === 'openapi_it' && serviziOa && !serviziOa.busy && (
                      <div className={'text-xs mt-3 p-3 rounded-lg border ' + (serviziOa.error ? 'bg-amber-900/20 text-amber-400 border-amber-900/40' : 'bg-surface-page text-gray-300 border-gray-800')}>
                        {serviziOa.error ? serviziOa.error : (
                          <>
                            <div className="font-medium mb-1.5">Servizi di OpenAPI.it con la chiave collegata (ambiente di {serviziOa.ambiente})</div>
                            {serviziOa.servizi.map((sv) => (
                              <div key={sv.id} className="flex items-start gap-1.5 py-0.5">
                                <span className={sv.stato === 'attivo' || sv.stato === 'token_ok' ? 'text-green-400' : sv.stato === 'non_abilitato' ? 'text-red-400' : 'text-amber-400'}>{sv.stato === 'attivo' || sv.stato === 'token_ok' ? '✓' : sv.stato === 'non_abilitato' ? '✗' : '?'}</span>
                                <span><span className="text-ink">{sv.nome}</span> <span className="text-gray-500">— {sv.stato === 'attivo' ? 'attivo' : sv.stato === 'token_ok' ? 'token ottenuto' : sv.stato === 'non_abilitato' ? 'non abilitato' : 'da verificare'}. {sv.dettaglio}</span></span>
                              </div>
                            ))}
                            <div className="text-gray-600 mt-1.5">Per abilitare un servizio attivalo nella console di openapi.com (alcuni chiedono la verifica dell'identità e un contratto).</div>
                          </>
                        )}
                      </div>
                    )}
                    {row.id === 'whatsapp_callmebot' && waTest && !waTest.busy && (
                      <div className={'text-xs mt-3 p-3 rounded-lg border ' + (waTest.error || waTest.esito !== 'inviato' ? 'bg-amber-900/20 text-amber-400 border-amber-900/40' : 'bg-green-900/20 text-green-400 border-green-900/40')}>
                        {waTest.error ? waTest.error : (
                          <>
                            <div className="font-medium mb-1">{waTest.esito === 'inviato' ? 'Messaggio inviato: controlla il telefono.' : waTest.esito === 'parziale' ? 'Inviato solo ad alcuni destinatari.' : 'Messaggio NON inviato.'}</div>
                            {waTest.risultati.map((r) => <div key={r.nome}>{r.ok ? '✓' : '✗'} {r.nome}{r.ok ? '' : ': ' + r.reason}</div>)}
                          </>
                        )}
                      </div>
                    )}
                    {row.id === 'whatsapp_callmebot' && features.whatsapp && (
                      <div className="mt-4 pt-4 border-t border-gray-800 text-xs text-gray-500">Destinatari e log degli invii si trovano in <span className="text-gray-300">Report →</span></div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      {features.sito_web && (
        <div className="mt-4">
          <SiteLeadEmailPanel token={token} />
        </div>
      )}
    </div>
  )
}

// Ordine e visibilità nella sidebar — entrambi i meccanismi esistevano già lato
// backend (PUT /modules/reorder, colonna active già rispettata da GET
// /modules/installed) ma senza nessuna interfaccia che li usasse. Frecce invece di
// drag-and-drop: stesso pattern già in uso per il riordino dei widget dashboard
// (DashboardPage.jsx moveWidget), niente libreria nuova.
function ModuliTab({ token }) {
  const api = useApi(token)
  const [modules, setModules] = useState([])
  // Customer Overlay: quali moduli sono ancora identici a come sono nati da
  // un verticale ('core') e quali sono stati toccati dopo ('customized') —
  // slug -> stato, 'untracked' per un modulo mai clonato da un modello
  // (semplicemente non mostrato, non un errore).
  const [overlay, setOverlay] = useState({})

  const load = async () => {
    const data = await api.get('/modules')
    // Solo moduli DAVVERO installati — un modulo mai installato non compare mai in sidebar,
    // quindi non ha senso poterlo riordinare o nasconderlo da qui. 'dashboard' invece è incluso
    // di proposito: è un modulo reale come gli altri (is_system=1 lo protegge solo da
    // disinstallazione/eliminazione altrove), quindi può e deve essere riordinato come
    // qualunque voce — è il modo con cui un tenant sposta Dashboard sotto altre voci
    // che gli interessano di più in cima (es. Nico: Zone prima di Dashboard).
    if (data) setModules(data.filter((m) => m.installed).sort((a, b) => a.sort_order - b.sort_order))
    const overlayData = await api.get('/modules/overlay-status')
    if (overlayData) {
      const bySlug = {}
      overlayData.forEach((o) => { bySlug[o.slug] = o.status })
      setOverlay(bySlug)
    }
  }
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const move = async (slug, dir) => {
    const idx = modules.findIndex((m) => m.slug === slug)
    if ((dir === -1 && idx === 0) || (dir === 1 && idx === modules.length - 1)) return
    const reordered = [...modules]
    const tmp = reordered[idx]; reordered[idx] = reordered[idx + dir]; reordered[idx + dir] = tmp
    setModules(reordered) // ottimistico, subito visibile
    await api.put('/modules/reorder', { order: reordered.map((m) => m.slug) })
  }

  const toggleActive = async (m) => {
    setModules((prev) => prev.map((x) => (x.slug === m.slug ? { ...x, active: m.active ? 0 : 1 } : x)))
    await api.patch('/modules/' + m.slug, { active: m.active ? 0 : 1 })
  }

  return (
    <div>
      <p className="text-sm text-gray-500 mb-4">Ordine e visibilità nella sidebar — un modulo nascosto resta installato con i suoi dati, solo non compare nel menu.</p>
      <div className="space-y-1.5">
        {modules.map((m, i) => (
          <div key={m.slug} className="flex items-center gap-3 glass-panel px-3 py-2.5">
            <div className="flex flex-col flex-shrink-0">
              <button onClick={() => move(m.slug, -1)} disabled={i === 0} className="text-gray-600 hover:text-ink disabled:opacity-20 disabled:cursor-not-allowed transition">
                <Icon name="chevron-up" size={13} />
              </button>
              <button onClick={() => move(m.slug, 1)} disabled={i === modules.length - 1} className="text-gray-600 hover:text-ink disabled:opacity-20 disabled:cursor-not-allowed transition">
                <Icon name="chevron-down" size={13} />
              </button>
            </div>
            <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: m.color + '22', color: m.color }}>
              <Icon name={m.icon || 'box'} size={14} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm text-ink font-medium truncate flex items-center gap-1.5">
                {m.name}
                {!m.active && <span title="Spento o nascosto: non compare nel menu" className="text-[9px] px-1.5 py-0.5 rounded-full bg-gray-800 text-gray-400 flex-shrink-0">nascosto</span>}
                {overlay[m.slug] === 'customized' && (
                  <span title="Modificato rispetto al modello di partenza" className="text-[9px] px-1.5 py-0.5 rounded-full bg-cp-purple/30 text-cp-purple flex-shrink-0">personalizzato</span>
                )}
              </div>
              {m.group_name && <div className="text-[11px] text-gray-600">{m.group_name}</div>}
            </div>
            <button onClick={() => toggleActive(m)} title={m.active ? 'Visibile — clic per nascondere' : 'Nascosto — clic per mostrare'}
              className={'p-1.5 rounded-lg transition flex-shrink-0 ' + (m.active ? 'text-gray-400 hover:text-ink' : 'bg-gray-800 text-gray-600 hover:text-gray-400')}>
              <Icon name={m.active ? 'eye' : 'eye-off'} size={15} />
            </button>
          </div>
        ))}
        {modules.length === 0 && <div className="text-sm text-gray-600">Nessun modulo installato.</div>}
      </div>
    </div>
  )
}

// Barra laterale raggruppata (2026-10-18, richiesto dall'utente: "impronta
// SaaS enterprise" — sostituisce la barra di tab orizzontale del 28/09, che
// restava una striscia piatta di 12 voci senza alcuna gerarchia). Stesso
// principio già in uso altrove nell'app per "barra laterale + contenuto"
// (GuidaPage/index.jsx "Riferimento": colonna impilata su mobile, `md:w-80`
// fissa da `md:` in su) — non il drawer con overlay della Sidebar principale,
// quello resta riservato alla navigazione primaria.
function SettingsNav({ groups, active, onChange }) {
  return (
    <nav className="w-full md:w-56 flex-shrink-0 md:sticky md:top-20 md:self-start">
      <div className="space-y-5">
        {groups.map((g) => (
          <div key={g.label}>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-600 px-2.5 mb-1.5">{g.label}</div>
            <div className="space-y-0.5">
              {g.items.map((it) => (
                <button key={it.key} onClick={() => onChange(it.key)}
                  className={'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-left transition ' +
                    (active === it.key ? 'bg-accent/20 text-accent font-medium' : 'text-gray-400 hover:text-ink hover:bg-white/8')}>
                  <Icon name={it.icon} size={15} />
                  {it.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </nav>
  )
}

// Azienda/fatturazione (2026-09-28, richiesto dall'utente) — su Finance questo
// tab non serve (nessuna intestazione da stampare su documenti reali): rimosso
// per intero qui, resta invece su Coffee (ramo coffee-standalone), che ne ha
// davvero bisogno per le sue ricevute/fatture. Stesso principio "rami che
// divergono deliberatamente" già in uso per Store/Builder/Supporto.
// Raggruppate (2026-10-18) in 6 categorie invece di una lista piatta — stesse
// chiavi/icone/etichette di prima, cambia solo come sono organizzate.
const SETTINGS_GROUPS = [
  { label: 'Account', items: [
    { key: 'account', icon: 'user', label: 'Il mio account' },
  ] },
  { label: 'Workspace', items: [
    { key: 'utenti', icon: 'users', label: 'Utenti & Ruoli' },
    { key: 'moduli', icon: 'box', label: 'Moduli' },
    { key: 'liste', icon: 'list', label: 'Liste' },
    { key: 'funzioni', icon: 'grid', label: 'Funzioni' },
    { key: 'aspetto', icon: 'palette', label: 'Aspetto' },
  ] },
  { label: 'Integrazioni', items: [
    { key: 'connessioni', icon: 'link', label: 'Connessioni' },
    { key: 'notifiche', icon: 'bell', label: 'Report' },
  ] },
  { label: 'Sito Web', items: [
    { key: 'sito_web', icon: 'globe', label: 'Sito Web' },
  ] },
  { label: 'AI', items: [
    { key: 'assistente', icon: 'wand', label: 'AI' },
    { key: 'suggerimenti', icon: 'sparkles', label: 'Suggerimenti' },
  ] },
  { label: 'Dati & Sicurezza', items: [
    { key: 'export_dati', icon: 'download', label: 'Dati' },
    { key: 'sicurezza', icon: 'shield', label: 'Sicurezza' },
    // (TMP) — 30/10/2026, richiesto dall'utente: entrambe pagine di lavoro
    // temporanee (una revisione da chiudere, uno strumento di debug), non
    // funzioni stabili del prodotto — la targhetta lo dice a chi le apre.
    { key: 'collegamenti', icon: 'link', label: 'Rivedi collegamenti (TMP)' },
    { key: 'movimenti', icon: 'credit-card', label: 'Movimenti (TMP)' },
  ] },
]

function ImpostazioniPage({ token, user, initialTab, features = {}, modules = [], onFeaturesChanged, onOpenInBuilder, onCreateNewModule, onUserUpdate }) {
  const isAdmin = user && user.role === 'admin'
  const [tab, setTab] = useState(initialTab || (isAdmin ? 'utenti' : 'account'))
  // Navigazione ripetuta verso il tab "Il mio account" (click sul proprio nome in
  // Sidebar) mentre il componente è già montato — senza questo resterebbe fermo
  // sull'ultimo tab aperto invece di saltare di nuovo su Account.
  useEffect(() => { if (initialTab) setTab(initialTab) }, [initialTab])

  // Le schede si adattano al progetto: una capacità spenta (Sito Web, WhatsApp...) non ha la sua scheda; chi non è admin vede il proprio account
  // e, se non è un agente, l'export dei dati. Filtro per voce dentro ogni gruppo, poi tolgo i gruppi rimasti vuoti.
  const canExport = user && user.role !== 'agente'
  const itemAllowed = (key) => {
    if (isAdmin) return key === 'sito_web' ? features.sito_web : key === 'notifiche' ? features.riepilogo_mattino : key === 'suggerimenti' ? features.suggerimenti : key === 'movimenti' ? features.movimenti : true
    return key === 'account' || (key === 'export_dati' && canExport)
  }
  const visibleGroups = SETTINGS_GROUPS
    .map((g) => ({ ...g, items: g.items.filter((it) => itemAllowed(it.key)) }))
    .filter((g) => g.items.length > 0)
  const visibleCount = visibleGroups.reduce((n, g) => n + g.items.length, 0)

  return (
    <GlassPageBackground>
      {/* Un non-admin ha una sola voce possibile (Il mio account) — niente titolo/nav
         "Impostazioni" ridondante sopra, va dritto al contenuto (che ha già il suo h1). */}
      {(isAdmin || visibleCount > 1) && (
        <div className="mb-5">
          <h1 className="text-lg font-bold text-ink tracking-[-0.35px]">Impostazioni</h1>
        </div>
      )}

      <div className={(isAdmin || visibleCount > 1) ? 'flex flex-col md:flex-row gap-6 md:gap-8' : ''}>
        {(isAdmin || visibleCount > 1) && <SettingsNav groups={visibleGroups} active={tab} onChange={setTab} />}

        <div className="flex-1 min-w-0">
          {tab === 'utenti' && <UsersPage token={token} />}
          {tab === 'account' && <AccountPage token={token} user={user} onUserUpdate={onUserUpdate} />}

          {tab === 'moduli' && <ModuliTab token={token} />}
          {tab === 'liste' && <ListePage token={token} />}

          {tab === 'sito_web' && <SitoWebPage token={token} />}

          {tab === 'connessioni' && <ConnessioniTab token={token} user={user} features={features} />}

          {tab === 'funzioni' && <FeaturesTab token={token} onChanged={onFeaturesChanged} />}
          {tab === 'aspetto' && <AspettoTab token={token} />}
          {tab === 'suggerimenti' && features.suggerimenti && <SuggestionsTab token={token} onOpenInBuilder={onOpenInBuilder} onCreateNewModule={onCreateNewModule} />}
          {tab === 'notifiche' && <ReportsSettingsTab token={token} user={user} features={features} />}

          {tab === 'assistente' && <AiSettingsPage token={token} onChanged={onFeaturesChanged} />}

          {tab === 'sicurezza' && <SicurezzaTab token={token} />}
          {tab === 'collegamenti' && <ReviewMatchesTab token={token} />}
          {tab === 'movimenti' && <MovimentiPage token={token} />}

          {tab === 'export_dati' && canExport && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 max-w-5xl">
              <ExportDatiPage token={token} modules={modules} user={user} />
              {isAdmin && <BackupPage token={token} />}
              {isAdmin && <ExportServerCard token={token} />}
            </div>
          )}
        </div>
      </div>
    </GlassPageBackground>
  )
}

export default ImpostazioniPage
