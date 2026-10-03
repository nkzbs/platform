import React, { useState, useEffect } from 'react'
import { API } from '../lib/api'
import useApi from '../lib/useApi'
import Icon from '../components/Icon'
import RichText from '../components/RichText'
import CapabilitiesSection from '../components/CapabilitiesSection'
import { parseSchemaFrontend, getAutomationSteps, getRequiredConnectors } from '../lib/schema-v3-frontend'

// La Libreria del tenant: i moduli che ho già (installati) e quelli salvati nella Libreria di
// Super Admin che posso installare. Installare = copiare: il modulo diventa mio, modificabile
// nel Builder senza toccare gli altri tenant; se nella Libreria esce una versione più nuova
// compare "Aggiorna" (che sovrascrive la copia locale: è avvisato prima).
//
// I collegamenti (Google, WhatsApp...) di un modulo si deducono da cosa fa davvero
// (getRequiredConnectors) e si configurano dentro il suo dettaglio. La credenziale è condivisa
// per tenant: un secondo modulo che usa lo stesso collegamento lo trova già connesso.
function LibreriaPage({ token, onRefresh, onOpenInBuilder, onCreateNewModule, onFeaturesChanged }) {
  const api = useApi(token)
  const [modules, setModules] = useState([])
  const [registry, setRegistry] = useState([])
  const [registryUnavailable, setRegistryUnavailable] = useState(false)
  const [installing, setInstalling] = useState(null)
  const [updatingSlug, setUpdatingSlug] = useState(null)
  const [installError, setInstallError] = useState('')
  const [detailModule, setDetailModule] = useState(null)
  const [uninstalled, setUninstalled] = useState(null) // { name } — conferma dopo una disinstallazione riuscita
  const [search, setSearch] = useState('')

  const [connections, setConnections] = useState([])
  const [googleStatus, setGoogleStatus] = useState(null)
  const [openConnFor, setOpenConnFor] = useState(null)
  const [credForm, setCredForm] = useState({})
  const [saving, setSaving] = useState(false)

  const load = async () => {
    const data = await api.get('/modules')
    if (data) setModules(data)
  }
  const loadRegistry = async () => {
    const res = await fetch(API + '/modules/registry', { headers: { Authorization: 'Bearer ' + token } })
    if (res.ok) { setRegistry(await res.json()); setRegistryUnavailable(false) }
    else setRegistryUnavailable(true)
  }
  const loadConnections = async () => {
    const data = await api.get('/connections')
    if (data) setConnections(data)
  }
  const loadGoogleStatus = async () => {
    const data = await api.get('/integrazioni/google/status')
    if (data) setGoogleStatus(data)
  }

  useEffect(() => { load(); loadRegistry(); loadConnections(); loadGoogleStatus() }, [])

  const toggle = async (m) => {
    const wasNotInstalled = !m.installed
    const action = m.installed ? 'uninstall' : 'install'
    const res = await api.post('/modules/' + m.slug + '/' + action, {})
    load()
    onRefresh()
    if (wasNotInstalled) await checkNeedsConnection(m)
    else if (res && res.ok) setUninstalled({ name: m.name })
  }

  const startInstall = (m) => { setInstalling(m); setInstallError('') }

  // Applica un aggiornamento pubblicato dal registro (2026-08-29) — punto che
  // mancava del tutto: prima l'unica reazione a "Nuova versione disponibile"
  // era la notifica, nessun modo di applicarla senza reinstallare da zero.
  // Sovrascrive lo schema locale: onestamente distruttivo per eventuali
  // personalizzazioni fatte nel Builder su questo modulo — avvisato prima,
  // non un merge (l'Overlay Engine a 3 vie è roadmap 0.1.8, non costruito).
  const applyUpdate = async (m) => {
    const match = m.registry_slug && m.registry_source_tenant_slug ? registryByKey.get(m.registry_slug + '@' + m.registry_source_tenant_slug) : null
    const notes = match && match.release_notes ? '\n\nCosa cambia (v' + match.version + '): ' + match.release_notes : ''
    if (!window.confirm('Aggiornare "' + m.name + '" alla versione più recente dal registro?' + notes + '\n\nSe hai personalizzato questo modulo nel Builder dopo averlo installato, quelle modifiche andranno perse — verranno sostituite dalla versione pubblicata.')) return
    setUpdatingSlug(m.slug)
    const res = await api.post('/modules/' + m.slug + '/update-from-registry', {})
    setUpdatingSlug(null)
    if (!res.ok) {
      window.dispatchEvent(new CustomEvent('platform:toast', { detail: { message: (res.data && res.data.error) || 'Aggiornamento non riuscito', type: 'error' } }))
      return
    }
    window.dispatchEvent(new CustomEvent('platform:toast', { detail: { message: '"' + m.name + '" aggiornato alla versione più recente.', type: 'success' } }))
    load()
    loadRegistry()
    onRefresh()
  }

  // "Aggiorna tutti" del banner Fase 9 — stesso avviso distruttivo di
  // applyUpdate ma una volta sola per il lotto invece che ripetuto per ogni
  // modulo, poi sequenziale (non Promise.all: ogni update-from-registry già
  // riscrive lo schema del modulo, farli in parallelo sullo stesso tenant non
  // aggiunge nulla e complica solo la gestione degli errori parziali).
  const [updatingAll, setUpdatingAll] = useState(false)
  const applyAllUpdates = async (list) => {
    const notesLines = list
      .map((m) => (m.registry_slug && m.registry_source_tenant_slug ? registryByKey.get(m.registry_slug + '@' + m.registry_source_tenant_slug) : null))
      .filter((match) => match && match.release_notes)
      .map((match) => '• ' + match.release_notes)
    const notes = notesLines.length ? '\n\nCosa cambia:\n' + notesLines.join('\n') : ''
    if (!window.confirm('Aggiornare ' + list.length + ' modul' + (list.length === 1 ? 'o' : 'i') + ' alla versione più recente dal registro?' + notes + '\n\nEventuali personalizzazioni fatte nel Builder dopo l\'installazione andranno perse su ciascuno di essi.')) return
    setUpdatingAll(true)
    let okCount = 0
    for (const m of list) {
      const res = await api.post('/modules/' + m.slug + '/update-from-registry', {})
      if (res.ok) okCount++
    }
    setUpdatingAll(false)
    window.dispatchEvent(new CustomEvent('platform:toast', { detail: { message: okCount + ' su ' + list.length + ' moduli aggiornati.', type: okCount === list.length ? 'success' : 'error' } }))
    load()
    loadRegistry()
    onRefresh()
  }

  const confirmInstall = async () => {
    setInstallError('')
    const res = await api.post('/modules/registry/' + installing.id + '/install', {})
    if (!res.ok) { setInstallError((res.data && res.data.error) || 'Installazione non riuscita'); return }
    setInstalling(null)
    setDetailModule(null)
    if (res.data && res.data.auto_installed && res.data.auto_installed.length > 0) {
      window.dispatchEvent(new CustomEvent('platform:toast', { detail: { message: 'Installati anche i moduli richiesti: ' + res.data.auto_installed.join(', '), type: 'success' } }))
    }
    load()
    loadRegistry()
    onRefresh()
    await checkNeedsConnection(res.data)
    // Ponte diretto: chi ha appena installato molto probabilmente vuole vederlo/
    // adattarlo, non restare sullo Store — stessa idea già scritta nel testo del
    // modal ("modificabile liberamente dal Builder dopo l'installazione"), qui
    // resa un'azione invece che solo una frase.
    if (onOpenInBuilder && res.data && res.data.slug) onOpenInBuilder(res.data.slug)
  }

  // Se il modulo appena installato ha bisogno di uno o più connettori non ancora
  // collegati (vedi getRequiredConnectors), apre subito il pannello del primo sulla
  // sua stessa card invece di lasciare scoprire dopo che qualcosa silenziosamente
  // non funziona (es. un poller senza token).
  const checkNeedsConnection = async (installedModule) => {
    const integrationIds = getRequiredConnectors(installedModule.schema_json)
    if (!integrationIds.length) return
    let missing = null
    for (const id of integrationIds) {
      if (!(await isConnected(id))) { missing = id; break }
    }
    if (!missing) return
    setOpenConnFor(installedModule.id + ':' + missing)
    setCredForm(initialCredForm(missing))
    setDetailModule(installedModule)
  }

  const isConnected = async (integrationId) => {
    if (integrationId === 'google') {
      const status = googleStatus || (await api.get('/integrazioni/google/status'))
      return !!(status && status.connected)
    }
    const conns = connections.length ? connections : (await api.get('/connections')) || []
    const found = conns.find((c) => c.id === integrationId)
    return !!(found && found.connected)
  }

  const credFieldsFor = (id) => {
    const intg = connections.find((c) => c.id === id)
    return (intg && intg.cred_fields) || []
  }

  const initialCredForm = (id) => {
    const f = {}
    credFieldsFor(id).forEach((x) => { f[x.key] = '' })
    return f
  }

  const saveCred = async (id) => {
    setSaving(true)
    // 'google' passa dalla route OAuth dedicata (merge, non sovrascrive access_token/
    // refresh_token già ottenuti) invece della PUT generica.
    const res = id === 'google'
      ? await api.put('/integrazioni/google/config', credForm)
      : await api.put('/connections/' + id + '/credentials', credForm)
    setSaving(false)
    if (res && res.ok) { setOpenConnFor(null); loadConnections() }
  }

  const connectGoogle = () => { window.location.href = API + '/integrazioni/google/oauth/start' }
  const disconnectGoogle = async () => {
    const res = await api.post('/integrazioni/google/disconnect', {})
    if (res && res.ok) { loadConnections(); loadGoogleStatus() }
  }
  const toggleConnGeneric = async (id) => {
    const res = await api.post('/connections/' + id + '/toggle', {})
    if (res && res.ok) loadConnections()
  }
  const toggleDrive = async () => {
    const res = await api.put('/integrazioni/google/drive', { enabled: !(googleStatus && googleStatus.drive_enabled) })
    if (res && res.ok) loadGoogleStatus()
  }

  // Stato dei connettori richiesti da un modulo (uno o più), per i pannelli inline
  // sulla sua card (nessuna sezione/pagina condivisa da consultare a parte).
  const connectorInfos = (m) => {
    return getRequiredConnectors(m.schema_json).map((integrationId) => {
      const intg = connections.find((c) => c.id === integrationId)
      const connected = integrationId === 'google' ? !!(googleStatus && googleStatus.connected) : !!(intg && intg.connected)
      return { integrationId, name: (intg && intg.name) || integrationId, connected, intg }
    })
  }

  const toggleConnPanel = (m, conn) => {
    const key = m.id + ':' + conn.integrationId
    if (openConnFor === key) { setOpenConnFor(null); return }
    setOpenConnFor(key)
    setCredForm(initialCredForm(conn.integrationId))
  }

  const openDetail = (m) => setDetailModule(m)

  // Scheda tecnica: SOLO per moduli già installati (schema reale del tenant, non
  // quello del registro — GET /modules/registry non include schema_json per design,
  // protegge i moduli a licenza dall'essere copiati leggendo la lista prima di
  // installare). Stessa logica già usata in Super Admin, qui applicata al modulo
  // locale corrispondente invece che alla riga del registro.
  const techSpec = (schemaJsonString) => {
    const schema = parseSchemaFrontend(schemaJsonString)
    return {
      fields: schema.fields || [],
      relations: schema.relations || [],
      workflow: schema.workflow,
      permissionsRules: (schema.permissions && schema.permissions.rules) || [],
      automations: getAutomationSteps(schemaJsonString),
      connectors: getRequiredConnectors(schemaJsonString),
    }
  }

  const businessModules = modules.filter((m) => !m.support_module)
  const alreadyInstalledSlugs = new Set(modules.map((m) => m.slug))
  const registryByKey = new Map(registry.map((r) => [r.slug + '@' + r.source_tenant_slug, r]))
  // Un modulo di supporto (es. le righe di un ordine) non si sfoglia: si installa da solo come
  // dipendenza del modulo principale.
  const registryNotInstalled = registry.filter((m) => !alreadyInstalledSlugs.has(m.slug) && !m.support_module)

  const updateFor = (m) => {
    if (!m.installed || !m.registry_slug || !m.registry_source_tenant_slug) return null
    const match = registryByKey.get(m.registry_slug + '@' + m.registry_source_tenant_slug)
    return match && (match.version || 0) > (m.registry_version || 0) ? match : null
  }
  const updatableModules = businessModules.filter((m) => updateFor(m))

  const q = search.trim().toLowerCase()
  const matchesSearch = (m) => !q || m.name.toLowerCase().includes(q) || (m.description || '').toLowerCase().includes(q)
  const installedList = businessModules.filter((m) => m.installed).filter(matchesSearch)
  // Disponibili: moduli già nel tenant ma disinstallati + quelli della Libreria non ancora presi.
  const availableList = [
    ...businessModules.filter((m) => !m.installed).map((m) => ({ ...m, _kind: 'own' })),
    ...registryNotInstalled.map((m) => ({ ...m, _kind: 'registry' })),
  ].filter(matchesSearch)

  const renderCard = (m, installed) => {
    const update = installed ? updateFor(m) : null
    return (
      <div key={(m._kind || 'own') + '-' + m.id} id={'module-card-' + m.slug}
        className="bg-surface-card rounded-xl border border-gray-800 hover:border-gray-700 transition p-4 flex flex-col cursor-pointer" onClick={() => openDetail(m)}>
        <div className="flex items-center gap-2.5 mb-2">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: (m.color || '#2563EB') + '22', color: m.color || '#2563EB' }}>
            <Icon name={m.icon || 'box'} size={16} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-ink font-medium text-sm truncate">{m.name}</div>
            <div className="text-[11px] text-gray-500 font-mono">
              {installed && m.registry_version ? 'v' + m.registry_version : m.version != null ? 'v' + m.version : m.slug}
            </div>
          </div>
          {update && (
            <span className="text-[10px] bg-accent/20 text-accent px-2 py-0.5 rounded-full flex-shrink-0 font-medium" title={'Nella Libreria c\'è la v' + update.version}>v{update.version} disponibile</span>
          )}
        </div>
        <div className="text-xs text-gray-500 line-clamp-2 flex-1 min-h-[2.2em]">{m.description || ''}</div>
        <div className="flex items-center justify-end gap-1.5 flex-wrap mt-3 pt-3 border-t border-gray-800/70">
          {installed ? (
            <>
              {update && (
                <button onClick={(e) => { e.stopPropagation(); applyUpdate(m) }} disabled={updatingSlug === m.slug}
                  className="text-xs px-3 py-1.5 rounded-lg transition bg-accent/20 hover:bg-accent/30 disabled:opacity-50 text-accent flex items-center gap-1.5">
                  <Icon name="refresh" size={11} />{updatingSlug === m.slug ? 'Aggiorno...' : 'Aggiorna'}
                </button>
              )}
              {onOpenInBuilder && (
                <button onClick={(e) => { e.stopPropagation(); onOpenInBuilder(m.slug) }}
                  className="text-xs px-3 py-1.5 rounded-lg transition bg-gray-800 hover:bg-gray-700 text-gray-300 flex items-center gap-1.5">
                  <Icon name="tool" size={11} />Personalizza
                </button>
              )}
              <button onClick={(e) => { e.stopPropagation(); toggle(m) }} className="text-xs px-2 py-1.5 rounded-lg transition text-gray-500 hover:text-red-400" title="Rimuovi modulo">Rimuovi</button>
            </>
          ) : (
            <button onClick={(e) => { e.stopPropagation(); m._kind === 'own' ? toggle(m) : startInstall(m) }}
              className="text-xs px-3 py-1.5 rounded-lg transition bg-accent hover:opacity-90 text-white">Installa</button>
          )}
        </div>
      </div>
    )
  }

  const section = (title, list, installed, emptyText) => (
    <div className="mb-8">
      <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">{title} <span className="text-gray-600 font-normal normal-case">({list.length})</span></div>
      {list.length === 0 ? (
        <div className="bg-surface-card rounded-xl p-5 text-center border border-gray-800 border-dashed text-sm text-gray-600">{emptyText}</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">{list.map((m) => renderCard(m, installed))}</div>
      )}
    </div>
  )

  return (
    <div>
      <h1 className="text-lg font-bold text-ink tracking-[-0.35px] mb-1">Libreria</h1>
      <p className="text-gray-500 text-sm mb-6">I tuoi moduli e quelli salvati nella Libreria, in un unico posto.</p>

      {onCreateNewModule && (
        <div className="flex items-center justify-between gap-4 flex-wrap bg-surface-card border border-gray-800 rounded-xl p-4 mb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-accent/15 text-accent flex items-center justify-center flex-shrink-0"><Icon name="tool" size={18} /></div>
            <div>
              <div className="text-ink font-medium text-sm">Ti serve qualcosa che non c'è?</div>
              <div className="text-gray-500 text-xs mt-0.5">Costruiscilo nel Builder: campi, relazioni, workflow, automazioni.</div>
            </div>
          </div>
          <button onClick={onCreateNewModule} className="bg-accent hover:opacity-90 text-white px-4 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2 flex-shrink-0">
            <Icon name="plus" size={14} />Crea modulo da zero
          </button>
        </div>
      )}

      {registryUnavailable && (
        <div className="bg-surface-card rounded-xl p-4 mb-5 text-center border border-gray-800 border-dashed">
          <div className="text-gray-500 text-sm">La Libreria non è raggiungibile al momento: vedi solo i moduli di questo tenant. Riprova più tardi.</div>
        </div>
      )}

      {updatableModules.length > 0 && (
        <div className="flex items-center justify-between gap-3 flex-wrap bg-accent/10 border border-accent/30 rounded-xl p-4 mb-5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-accent/20 text-accent flex items-center justify-center flex-shrink-0"><Icon name="refresh" size={16} /></div>
            <div>
              <div className="text-ink font-medium text-sm">{updatableModules.length} modul{updatableModules.length === 1 ? 'o ha' : 'i hanno'} un aggiornamento disponibile</div>
              <div className="text-gray-500 text-xs mt-0.5">{updatableModules.map((m) => m.name).join(', ')}</div>
            </div>
          </div>
          <button onClick={() => applyAllUpdates(updatableModules)} disabled={updatingAll}
            className="text-sm bg-accent hover:opacity-90 disabled:opacity-50 text-white px-4 py-2 rounded-lg transition font-medium flex items-center gap-2 flex-shrink-0">
            <Icon name="refresh" size={14} />{updatingAll ? 'Aggiorno...' : 'Aggiorna tutti (' + updatableModules.length + ')'}
          </button>
        </div>
      )}

      <CapabilitiesSection token={token} onChanged={onFeaturesChanged} />

      <h2 className="text-sm font-semibold text-ink mb-3">Moduli</h2>
      <div className="relative mb-6 max-w-md">
        <Icon name="search" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cerca moduli..."
          className="w-full bg-surface-card text-ink pl-9 pr-3 py-2.5 rounded-lg text-sm outline-none border border-gray-800 focus:border-accent transition placeholder-gray-600" />
      </div>

      {section('Installati', installedList, true, q ? 'Nessun modulo installato corrisponde alla ricerca.' : 'Nessun modulo installato ancora.')}
      {section('Disponibili', availableList, false, q ? 'Nessun modulo disponibile corrisponde alla ricerca.' : 'Hai già installato tutto quello che c\'è nella Libreria.')}

      {detailModule && (() => {
        const installedMatch = modules.find((m) => m.slug === detailModule.slug)
        const spec = installedMatch ? techSpec(installedMatch.schema_json) : null
        const isInstalled = alreadyInstalledSlugs.has(detailModule.slug) && !!(installedMatch && installedMatch.installed)
        return (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={() => setDetailModule(null)}>
          <div className="bg-surface-card rounded-xl w-full max-w-2xl border border-gray-800 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 border-b border-gray-800 flex items-start justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: (detailModule.color || '#2563EB') + '22', color: detailModule.color || '#2563EB' }}>
                  <Icon name={detailModule.icon || 'box'} size={22} />
                </div>
                <div className="min-w-0">
                  <div className="text-ink font-semibold text-base truncate">{detailModule.name}</div>
                  <div className="text-xs text-gray-500 font-mono">
                    {detailModule.slug}
                    {detailModule.version != null && <> · v{detailModule.version}</>}
                    {detailModule.source_tenant_slug && <> · da {detailModule.source_tenant_slug}</>}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {isInstalled ? (
                  <>
                    {onOpenInBuilder && (
                      <button onClick={() => onOpenInBuilder(detailModule.slug)} className="text-sm px-3.5 py-2 rounded-lg transition bg-gray-800 hover:bg-gray-700 text-gray-300 flex items-center gap-1.5">
                        <Icon name="tool" size={13} />Personalizza
                      </button>
                    )}
                    <button onClick={() => { toggle(detailModule); setDetailModule(null) }} className="text-sm px-3 py-2 rounded-lg transition text-gray-500 hover:text-red-400">Rimuovi</button>
                  </>
                ) : (
                  <button onClick={() => (detailModule._kind === 'own' ? (toggle(detailModule), setDetailModule(null)) : startInstall(detailModule))}
                    className="text-sm px-4 py-2 rounded-lg transition bg-accent hover:opacity-90 text-white">Installa</button>
                )}
                <button onClick={() => setDetailModule(null)} className="text-gray-500 hover:text-ink transition ml-1"><Icon name="x" size={18} /></button>
              </div>
            </div>
            <div className="p-5">
              <p className="text-sm text-gray-400"><RichText text={detailModule.description || 'Nessuna descrizione.'} /></p>
              {detailModule.release_notes && <p className="text-xs text-gray-500 mt-2 whitespace-pre-wrap"><span className="text-gray-400">Note v{detailModule.version}:</span> {detailModule.release_notes}</p>}

              {spec && (
                <div className="mt-5">
                  <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Scheda tecnica (già installato)</div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="bg-surface-page border border-gray-800 rounded-lg p-3">
                      <div className="text-[11px] text-gray-500 mb-1.5">Campi ({spec.fields.length})</div>
                      {spec.fields.length === 0 ? <div className="text-xs text-gray-600">Nessuno</div> : (
                        <ul className="text-xs text-gray-300 space-y-1">
                          {spec.fields.map((f) => <li key={f.key}>{f.label} <span className="text-gray-600 font-mono">({f.type}{f.required ? ', obbligatorio' : ''})</span></li>)}
                        </ul>
                      )}
                    </div>
                    <div className="bg-surface-page border border-gray-800 rounded-lg p-3">
                      <div className="text-[11px] text-gray-500 mb-1.5">Relazioni ({spec.relations.length})</div>
                      {spec.relations.length === 0 ? <div className="text-xs text-gray-600">Nessuna</div> : (
                        <ul className="text-xs text-gray-300 space-y-1">
                          {spec.relations.map((r) => <li key={r.key}>{r.label} <span className="text-gray-600 font-mono">→ {r.target_module}</span></li>)}
                        </ul>
                      )}
                    </div>
                    <div className="bg-surface-page border border-gray-800 rounded-lg p-3">
                      <div className="text-[11px] text-gray-500 mb-1.5">Workflow</div>
                      {!spec.workflow || !spec.workflow.states || spec.workflow.states.length === 0 ? <div className="text-xs text-gray-600">Nessuno</div> : (
                        <div className="text-xs text-gray-300">{spec.workflow.states.map((s) => s.label).join(' → ')}</div>
                      )}
                    </div>
                    <div className="bg-surface-page border border-gray-800 rounded-lg p-3">
                      <div className="text-[11px] text-gray-500 mb-1.5">Automazioni ({spec.automations.length})</div>
                      {spec.automations.length === 0 ? <div className="text-xs text-gray-600">Nessuna</div> : (
                        <ul className="text-xs text-gray-300 space-y-1">
                          {spec.automations.map((a) => <li key={a.id}>{a.label || '(senza nome)'}</li>)}
                        </ul>
                      )}
                    </div>
                    <div className="bg-surface-page border border-gray-800 rounded-lg p-3">
                      <div className="text-[11px] text-gray-500 mb-1.5">Permessi</div>
                      <div className="text-xs text-gray-300">{spec.permissionsRules.length > 0 ? spec.permissionsRules.length + ' regole configurate' : 'Nessuna restrizione esplicita'}</div>
                    </div>
                    <div className="bg-surface-page border border-gray-800 rounded-lg p-3">
                      <div className="text-[11px] text-gray-500 mb-1.5">Connettori richiesti</div>
                      <div className="text-xs text-gray-300">{spec.connectors.length > 0 ? spec.connectors.join(', ') : 'Nessuno'}</div>
                    </div>
                  </div>
                </div>
              )}

              {spec && spec.connectors.length > 0 && (
                <div className="mt-5">
                  <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Connessioni</div>
                  <div className="space-y-2">
                    {connectorInfos(installedMatch).map((conn) => {
                      const key = installedMatch.id + ':' + conn.integrationId
                      return (
                        <div key={key} className="bg-surface-page border border-gray-800 rounded-lg p-3">
                          <button onClick={() => toggleConnPanel(installedMatch, conn)} className="flex items-center gap-1.5 w-full text-left">
                            <Icon name="plug" size={11} className={conn.connected ? 'text-green-400' : 'text-amber-400'} />
                            <span className="text-xs text-gray-400">Connessione:</span>
                            <span className="text-xs text-ink font-medium">{conn.name}</span>
                            <span className={'ml-auto px-1.5 py-0.5 rounded text-[10px] ' + (conn.connected ? 'bg-green-900/30 text-green-400' : 'bg-amber-900/30 text-amber-400')}>
                              {conn.connected ? 'Connesso' : 'Da connettere'}
                            </span>
                            <Icon name={openConnFor === key ? 'chevron-down' : 'chevron-right'} size={11} className="text-gray-600" />
                          </button>

                          {openConnFor === key && (
                            <div className="mt-3 bg-surface-footer border border-gray-800 rounded-lg p-3">
                              {conn.integrationId === 'google' ? (
                                <div>
                                  <p className="text-xs text-gray-500 mb-2">Account Google collegato a tutta l'istanza (usato anche da altri moduli che leggono Gmail/Calendar/Drive).</p>
                                  {conn.connected ? (
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="text-xs bg-green-900/30 text-green-400 border border-green-900/50 px-3 py-1.5 rounded-lg">Connesso</span>
                                      <button onClick={disconnectGoogle} className="text-xs text-gray-500 hover:text-red-400 transition px-2 py-1.5">Disconnetti</button>
                                    </div>
                                  ) : (
                                    <button onClick={connectGoogle} className="text-xs bg-accent hover:opacity-90 text-white px-3 py-1.5 rounded-lg transition font-medium">Connetti con Google</button>
                                  )}
                                  {conn.connected && (
                                    <>
                                      <label className="flex items-center gap-2.5 mt-3 text-xs text-gray-400 cursor-pointer select-none">
                                        <button type="button" role="switch" aria-checked={!!(googleStatus && googleStatus.drive_enabled)} onClick={toggleDrive}
                                          className={'w-8 h-[18px] rounded-full transition-colors relative flex-shrink-0 ' + (googleStatus && googleStatus.drive_enabled ? 'bg-accent' : 'bg-gray-700')}>
                                          <span className={'absolute top-[2px] left-0 w-[14px] h-[14px] rounded-full bg-white transition-transform ' + (googleStatus && googleStatus.drive_enabled ? 'translate-x-[16px]' : 'translate-x-[2px]')} />
                                        </button>
                                        Salva gli allegati su Google Drive invece che sul server
                                      </label>
                                      {googleStatus && googleStatus.drive_enabled && !googleStatus.drive_scope_ok && (
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
                                    {credFieldsFor(conn.integrationId).map((f) => (
                                      <div key={f.key}>
                                        <label className="block text-xs text-gray-500 mb-1">{f.label}</label>
                                        <input
                                          type="text"
                                          value={credForm[f.key] || ''}
                                          onChange={(e) => setCredForm((p) => ({ ...p, [f.key]: e.target.value }))}
                                          placeholder={f.placeholder}
                                          className="w-full bg-surface-card border border-gray-700 rounded-lg px-3 py-2 text-sm text-ink placeholder-gray-600 focus:border-accent focus:outline-none font-mono"
                                        />
                                      </div>
                                    ))}
                                    {credFieldsFor(conn.integrationId).length === 0 && (
                                      <div className="text-xs text-gray-500">Nessun campo credenziale definito per questa integrazione.</div>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-2 mt-3 flex-wrap">
                                    <button onClick={() => saveCred(conn.integrationId)} disabled={saving}
                                      className="text-xs bg-accent hover:opacity-90 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg transition font-medium">
                                      {saving ? 'Salvataggio...' : 'Salva e connetti'}
                                    </button>
                                    {conn.connected && (
                                      <button onClick={() => toggleConnGeneric(conn.integrationId)} className="text-xs text-gray-500 hover:text-red-400 transition px-2 py-1.5">Disconnetti</button>
                                    )}
                                    {conn.intg && conn.intg.credentials_masked && (
                                      <span className="text-[10px] text-gray-600 ml-auto">attuali: {Object.keys(conn.intg.credentials_masked).join(', ')}</span>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        )
      })()}

      {installing && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-surface-card rounded-md p-6 w-full max-w-sm border border-gray-800">
            <h2 className="text-lg font-bold text-ink mb-1">Installa "{installing.name}"</h2>
            <p className="text-sm text-gray-500 mb-4">Verrà copiato come nuovo modulo in questa istanza — modificabile liberamente dal Builder dopo l'installazione.</p>
            {installError && <div className="bg-red-900/30 text-red-400 text-sm p-3 rounded-lg mb-4">{installError}</div>}
            <div className="flex gap-3">
              <button onClick={() => setInstalling(null)} className="flex-1 bg-gray-800 hover:bg-gray-700 text-white py-3 rounded-lg transition">Annulla</button>
              <button onClick={confirmInstall} className="flex-1 bg-accent hover:opacity-90 text-white py-3 rounded-lg transition font-medium">Installa</button>
            </div>
          </div>
        </div>
      )}

      {uninstalled && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={() => setUninstalled(null)}>
          <div className="bg-surface-card rounded-md p-6 w-full max-w-sm border border-gray-800" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-9 h-9 rounded-full bg-green-900/30 flex items-center justify-center flex-shrink-0">
                <Icon name="check" size={16} className="text-green-400" />
              </div>
              <h2 className="text-lg font-bold text-ink">Modulo disinstallato</h2>
            </div>
            <p className="text-sm text-gray-500 mb-4">"{uninstalled.name}" è stato disinstallato — non compare più nel menu, ma i suoi dati restano intatti e puoi reinstallarlo quando vuoi.</p>
            <button onClick={() => setUninstalled(null)} className="w-full bg-accent hover:opacity-90 text-white py-3 rounded-lg transition font-medium">Ok</button>
          </div>
        </div>
      )}
    </div>
  )
}

export default LibreriaPage
