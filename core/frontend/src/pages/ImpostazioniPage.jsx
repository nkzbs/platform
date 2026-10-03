import React, { useState, useEffect } from 'react'
import AiSettingsTab from '../components/AiSettingsTab'
import DigestSettingsTab from '../components/DigestSettingsTab'
import { API } from '../lib/api'
import useApi from '../lib/useApi'
import Icon from '../components/Icon'
import Tile from '../components/Tile'
import UsersPage from './UsersPage'
import AccountPage from './AccountPage'
import SitoWebPage from './SitoWebPage'

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
function ConnessioniTab({ token }) {
  const api = useApi(token)
  const [connections, setConnections] = useState([])
  const [googleStatus, setGoogleStatus] = useState(null)
  const [openFor, setOpenFor] = useState(null)
  const [credForm, setCredForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [waTest, setWaTest] = useState(null) // { busy } oppure { esito, dettaglio, error }

  const loadConnections = async () => { const data = await api.get('/connections'); if (data) setConnections(data) }
  const loadGoogleStatus = async () => { const data = await api.get('/integrazioni/google/status'); if (data) setGoogleStatus(data) }
  useEffect(() => { loadConnections(); loadGoogleStatus() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const credFieldsFor = (id) => { const intg = connections.find((c) => c.id === id); return (intg && intg.cred_fields) || [] }
  const initialCredForm = (id) => { const f = {}; credFieldsFor(id).forEach((x) => { f[x.key] = '' }); return f }
  // Messaggio di prova WhatsApp: dice, per ogni destinatario, se è davvero partito.
  const testWhatsApp = async () => {
    setWaTest({ busy: true })
    const res = await api.post('/connections/whatsapp_callmebot/test', {})
    if (!res.ok) { setWaTest({ error: (res.data && res.data.error) || 'Prova non riuscita' }); return }
    setWaTest({ esito: res.data.esito, risultati: res.data.risultati })
  }
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
    ...connections.filter((c) => c.id !== 'google').map((c) => ({ id: c.id, name: c.name || c.id, connected: !!c.connected, intg: c })),
  ]

  return (
    <div className="max-w-2xl">
      <p className="text-sm text-gray-500 mb-4">Account e servizi esterni collegati a questa istanza — usati dai moduli che ne hanno bisogno (es. Regole Gmail).</p>
      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.id} className="bg-surface-card border border-gray-800 rounded-lg p-3">
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
                {row.id === 'google' ? (
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
                      {row.connected && (
                        <button onClick={() => toggleConnGeneric(row.id)} className="text-xs text-gray-500 hover:text-red-400 transition px-2 py-1.5">Disconnetti</button>
                      )}
                      {row.intg && row.intg.credentials_masked && (
                        <span className="text-[10px] text-gray-600 ml-auto">attuali: {Object.keys(row.intg.credentials_masked).join(', ')}</span>
                      )}
                    </div>
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
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
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
    // Solo moduli DAVVERO installati e NON di supporto — un modulo mai installato,
    // o un modulo di supporto (righe di un modulo padre: ordini_righe, fatture_righe...),
    // non compare mai in sidebar (stesso filtro di Sidebar.jsx: !support_module), quindi
    // non ha senso poterlo riordinare o nasconderlo da qui. 'dashboard' invece è incluso
    // di proposito: è un modulo reale come gli altri (is_system=1 lo protegge solo da
    // disinstallazione/eliminazione altrove), quindi può e deve essere riordinato come
    // qualunque voce — è il modo con cui un tenant sposta Dashboard sotto altre voci
    // che gli interessano di più in cima (es. Nico: Zone prima di Dashboard).
    if (data) setModules(data.filter((m) => m.installed && !m.support_module).sort((a, b) => a.sort_order - b.sort_order))
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
          <div key={m.slug} className="flex items-center gap-3 bg-surface-card border border-gray-800 rounded-lg px-3 py-2.5">
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

// Barra di tab compatta (2026-09-28, richiesto dall'utente: "le impostazioni
// vanno snellite e rese più belle graficamente" — su mobile la vecchia griglia
// di card a due livelli (8 tile in alto + altre 3 solo per aprire "Azienda")
// costringeva a uno scroll lungo prima di raggiungere qualunque contenuto
// reale). Una riga sola, sottolineatura sul tab attivo, scroll orizzontale se
// non entra tutta — stesso pattern già familiare (tab bar), non un widget nuovo
// da imparare.
function TabBar({ items, active, onChange }) {
  return (
    <div className="flex items-center gap-0.5 border-b border-gray-800 mb-6 overflow-x-auto">
      {items.map((it) => (
        <button key={it.key} onClick={() => onChange(it.key)}
          className={'flex items-center gap-1.5 px-3 py-2.5 text-sm whitespace-nowrap border-b-2 transition flex-shrink-0 -mb-px ' +
            (active === it.key ? 'border-accent text-ink font-medium' : 'border-transparent text-gray-500 hover:text-gray-300')}>
          <Icon name={it.icon} size={14} />
          {it.label}
        </button>
      ))}
    </div>
  )
}

// Azienda/fatturazione (2026-09-28, richiesto dall'utente) — su Finance questo
// tab non serve (nessuna intestazione da stampare su documenti reali): rimosso
// per intero qui, resta invece su Coffee (ramo coffee-standalone), che ne ha
// davvero bisogno per le sue ricevute/fatture. Stesso principio "rami che
// divergono deliberatamente" già in uso per Store/Builder/Supporto.
const SETTINGS_TABS = [
  { key: 'utenti', icon: 'users', label: 'Utenti & Ruoli' },
  { key: 'moduli', icon: 'box', label: 'Moduli' },
  { key: 'sito_web', icon: 'globe', label: 'Sito Web' },
  { key: 'connessioni', icon: 'link', label: 'Connessioni' },
  { key: 'notifiche', icon: 'bell', label: 'Notifiche' },
  { key: 'assistente', icon: 'wand', label: 'Assistente AI' },
  { key: 'account', icon: 'user', label: 'Il mio account' },
]

function ImpostazioniPage({ token, user, initialTab }) {
  const isAdmin = user && user.role === 'admin'
  const [tab, setTab] = useState(initialTab || (isAdmin ? 'utenti' : 'account'))
  // Navigazione ripetuta verso il tab "Il mio account" (click sul proprio nome in
  // Sidebar) mentre il componente è già montato — senza questo resterebbe fermo
  // sull'ultimo tab aperto invece di saltare di nuovo su Account.
  useEffect(() => { if (initialTab) setTab(initialTab) }, [initialTab])

  return (
    <div>
      {/* Un non-admin ha un solo tab possibile (Il mio account) — niente titolo/tab-bar
         "Impostazioni" ridondante sopra, va dritto al contenuto (che ha già il suo h1). */}
      {isAdmin && (
        <>
          <div className="mb-4">
            <h1 className="text-lg font-bold text-ink tracking-[-0.35px]">Impostazioni</h1>
          </div>
          <TabBar items={SETTINGS_TABS} active={tab} onChange={setTab} />
        </>
      )}

      {tab === 'utenti' && <UsersPage token={token} />}
      {tab === 'account' && <AccountPage token={token} user={user} />}

      {tab === 'moduli' && <ModuliTab token={token} />}

      {tab === 'sito_web' && <SitoWebPage token={token} />}

      {tab === 'connessioni' && <ConnessioniTab token={token} />}

      {tab === 'notifiche' && <DigestSettingsTab token={token} />}

      {tab === 'assistente' && <AiSettingsTab token={token} />}
    </div>
  )
}

export default ImpostazioniPage
