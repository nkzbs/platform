import React, { useState, useEffect, useCallback } from 'react'
import { API } from '../lib/api'
import useApi from '../lib/useApi'
import Icon from '../components/Icon'
import Select from '../components/Select'
import BuilderPage from './BuilderPage'

// "Super Builder": il Builder vero (stesso editor di ogni tenant, vedi
// ./BuilderPage) integrato dentro Super Admin, con in più un assistente AI
// opzionale — "Super" perché vive qui, non un secondo editor separato.
//
// Sempre e solo sul PROPRIO sandbox (2026-08-16, richiesto dall'utente): prima
// si poteva scegliere QUALUNQUE tenant esistente da una tendina e scriverci lo
// schema live — bypassava il frontend reale del tenant (i suoi operatori non
// vedevano mai la sessione) e, per il deploy AI, bypassava anche il pipeline
// draft/publish/validazione del tenant stesso. Il Super Builder serve solo a
// costruire un modulo da pubblicare allo Store; per intervenire su un tenant
// reale resta solo "Apri →" su Tenant, che apre il Builder vero e sempre
// aggiornato di quel tenant (nessuna copia qui in mezzo).
//
// Autenticazione verso il sandbox: /tenants/:slug/builder-token (il tenant
// firma da sé un token admin, Super Admin non conosce mai il suo JWT_SECRET —
// vedi commento nella route lato backend). L'URL con cui il BROWSER raggiunge
// il sandbox è costruito qui, non dal backend: stessa logica già usata dal
// link "Apri →" in TenantsPage (host corrente + porta del tenant), perché il
// backend di Super Admin non sa con quale host il browser lo ha raggiunto.
// initialPrompt/initialModuleName (2026-09-08) — arrivo da "Crea questo
// modulo" su un processo senza copertura (ClientCard.jsx/ProcessoEditor.jsx),
// tramite il prefill in App.jsx (stesso pattern già in uso per supportPrefill/
// reportGuideIssue). Solo VALORI INIZIALI dello state: questa pagina è montata
// condizionalmente ({page === 'super-builder' && ...}), quindi si smonta e
// rimonta ad ogni navigazione — non serve un useEffect di sincronizzazione,
// il valore iniziale basta.
function TenantBuilderPage({ token, initialPrompt, initialModuleName }) {
  const api = useApi(token)
  const [sandboxTenant, setSandboxTenant] = useState(null)
  const [selectedSlug, setSelectedSlug] = useState(null)
  const [tenantToken, setTenantToken] = useState(null)
  const [installedModules, setInstalledModules] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // ─── assistente AI (opzionale) ───
  const [aiStatus, setAiStatus] = useState(null)
  const [showAi, setShowAi] = useState(!!initialPrompt)
  const [moduleName, setModuleName] = useState(initialModuleName || '')
  const [prompt, setPrompt] = useState(initialPrompt || '')
  const [generating, setGenerating] = useState(false)
  const [aiError, setAiError] = useState('')
  const [draft, setDraft] = useState(null)
  const [deploying, setDeploying] = useState(false)
  const [deployResult, setDeployResult] = useState(null)

  // ─── Salva nella Libreria, senza uscire da qui ───
  // Prima l'unico modo di attivare/togliere la licenza a un modulo era la
  // pagina Registro separata — richiedeva di lasciare il Builder aperto qui,
  // andare a cercare tenant+modulo di nuovo là, ripubblicare. Stesso endpoint
  // già usato da LibreriaPage.jsx (POST /registry/publish), riusato qui pre-
  // aggangiato al tenant/modulo che si sta già guardando.
  const [showPublish, setShowPublish] = useState(false)
  const [publishForm, setPublishForm] = useState({ module_slug: '', description: '', release_notes: '' })
  const [publishing, setPublishing] = useState(false)
  const [publishResult, setPublishResult] = useState(null)
  // Per sapere se questa pubblicazione è una RIpubblicazione (stesso slug già nel
  // Libreria da questo stesso sandbox) — stessa logica di LibreriaPage.jsx, qui
  // caricata pigra solo quando il pannello si apre, non ad ogni render.
  const [registryModules, setRegistryModules] = useState([])
  useEffect(() => {
    if (!showPublish) return
    api.get('/registry/modules').then((data) => data && setRegistryModules(data))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPublish])

  // ─── "Nuovo modulo da zero", senza AI ───
  // Apre direttamente l'editor sul proprio sandbox (già caricato al mount, vedi
  // sotto) in modalità "nuovo modulo" — se per qualche motivo il sandbox non è
  // ancora pronto (mount fallito/in corso), lo prepara e lo apre qui.
  const [startingNewModule, setStartingNewModule] = useState(false)
  const [openNewModuleFlag, setOpenNewModuleFlag] = useState(false)
  const startNewModuleFromScratch = async () => {
    if (sandboxTenant && tenantToken) { setOpenNewModuleFlag(true); return }
    setStartingNewModule(true)
    setError('')
    const res = await fetch(API + '/super-builder/ensure-sandbox', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    })
    const data = await res.json()
    setStartingNewModule(false)
    if (!res.ok) { setError(data.error || 'Impossibile preparare il sandbox'); return }
    const t = { slug: data.slug, name: data.slug, port: data.port, domain: data.domain }
    setSandboxTenant(t)
    await openTenant(data.slug, t)
    setOpenNewModuleFlag(true)
  }

  // Il sandbox (proprio, sempre — mai un tenant scelto) si apre da solo al
  // mount: prima serviva scegliere un tenant dalla tendina o premere "Nuovo
  // modulo da zero", ora non ha più senso mostrare una pagina vuota in attesa.
  useEffect(() => {
    fetch(API + '/super-builder/ensure-sandbox', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    }).then((r) => r.ok ? r.json() : null).then((data) => {
      if (!data) { setError('Impossibile preparare il sandbox'); return }
      const t = { slug: data.slug, name: data.slug, port: data.port, domain: data.domain }
      setSandboxTenant(t)
      openTenant(data.slug, t)
    })
    fetch(API + '/super-builder/status', { headers: { Authorization: 'Bearer ' + token } })
      .then((r) => r.ok ? r.json() : null).then((d) => d && setAiStatus(d))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Con dominio reale (produzione, dietro Cloudflare/platform-nginx) il routing è
  // per Host header su 443. Senza dominio: non più un fallback diretto host:porta
  // (26/10/2026, le porte dei tenant non sono più pubblicate sull'host) — passa
  // dal proxy interno di Super Admin (stesso usato dal link "Apri →" in
  // TenantsPage), che inoltra sulla rete Docker interna.
  const tenantBaseUrl = (t) => t.domain ? ('https://' + t.domain) : (API + '/tenants/' + t.slug + '/preview')

  function makeApiClient(t, base) {
    return {
      get: async (path) => {
        const r = await fetch(base + '/api' + path, { headers: { Authorization: 'Bearer ' + t } })
        return r.ok ? r.json() : null
      },
    }
  }

  // tenantOverride: usato subito dopo aver ottenuto il sandbox (appena creato o
  // già esistente) — non c'è più un elenco di tenant da cui cercarlo, il
  // chiamante lo passa sempre esplicitamente (mount, deploy AI, "nuovo modulo").
  const openTenant = useCallback(async (slug, tenantOverride) => {
    setError('')
    setSelectedSlug(slug)
    setTenantToken(null)
    setInstalledModules([])
    setShowPublish(false)
    setPublishResult(null)
    setPublishForm({ module_slug: '', description: '', release_notes: '' })
    const t = tenantOverride || sandboxTenant
    if (!t) return
    setLoading(true)
    const res = await api.post('/tenants/' + slug + '/builder-token', {})
    if (!res.ok) {
      setError(res.data?.error || 'Impossibile ottenere un token per il sandbox')
      setLoading(false)
      return
    }
    const base = tenantBaseUrl(t)
    const tApi = makeApiClient(res.data.token, base)
    const mods = await tApi.get('/modules/installed')
    setInstalledModules(mods || [])
    setTenantToken(res.data.token)
    setLoading(false)
  }, [sandboxTenant])

  const slugify = (s) => s.toLowerCase().trim().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')

  const generate = async () => {
    if (!prompt.trim()) return setAiError('Descrivi il modulo che vuoi generare')
    setGenerating(true)
    setAiError('')
    setDraft(null)
    setDeployResult(null)
    const res = await fetch(API + '/super-builder/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ prompt, module_name: moduleName }),
    })
    const data = await res.json()
    setGenerating(false)
    if (!res.ok) return setAiError(data.message || data.error || 'Errore nella generazione')
    setDraft(data.schema_json)
  }

  const deployDraft = async () => {
    if (!draft) return
    const name = moduleName.trim() || 'Modulo Generato'
    setDeploying(true)
    setAiError('')
    const res = await fetch(API + '/super-builder/deploy', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ module_slug: slugify(name), module_name: name, schema_json: draft }),
    })
    const data = await res.json()
    setDeploying(false)
    if (!res.ok) return setAiError(data.error || 'Errore nel deploy')
    setDeployResult(data)
    // Il modulo è ora nel proprio sandbox (sempre lo stesso, restituito da
    // deploy) — riapre/aggiorna l'editor sotto così la bozza è subito visibile
    // e rifinibile, stesso posto.
    const t = (sandboxTenant && sandboxTenant.slug === data.sandbox_slug) ? sandboxTenant : { slug: data.sandbox_slug, name: data.sandbox_slug, port: data.sandbox_port }
    setSandboxTenant(t)
    openTenant(data.sandbox_slug, t)
  }

  const publishToRegistry = async () => {
    if (!selectedSlug || !publishForm.module_slug) return
    setPublishing(true)
    setPublishResult(null)
    const res = await api.post('/registry/publish', { tenant_slug: selectedSlug, ...publishForm })
    setPublishing(false)
    if (!res.ok) return setPublishResult({ ok: false, text: res.data?.error || 'Errore nella pubblicazione' })
    setPublishResult({ ok: true, text: '"' + res.data.name + '" pubblicato — v' + res.data.version })
  }

  const stepCounts = draft ? draft.steps.reduce((acc, s) => { acc[s.block_type] = (acc[s.block_type] || 0) + 1; return acc }, {}) : null
  const selectedTenant = sandboxTenant

  const priorVersions = publishForm.module_slug && selectedSlug
    ? registryModules.filter((m) => m.slug === publishForm.module_slug && m.source_tenant_slug === selectedSlug)
    : []
  const latestPriorVersion = priorVersions.length ? Math.max(...priorVersions.map((m) => m.version)) : 0
  const isRepublish = latestPriorVersion > 0

  return (
    <div>
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink flex items-center gap-2"><Icon name="sparkles" size={18} />Super Builder</h1>
          <p className="text-xs text-gray-500 mt-1">Costruisci un modulo nel tuo sandbox e pubblicalo nello Store — con un assistente AI opzionale per partire da una bozza.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={startNewModuleFromScratch} disabled={startingNewModule}
            className="text-sm bg-gray-800 hover:bg-gray-700 disabled:opacity-40 text-gray-200 px-3 py-2 rounded-lg transition flex items-center gap-1.5 whitespace-nowrap">
            <Icon name="plus" size={13} />
            {startingNewModule ? 'Preparazione...' : 'Nuovo modulo da zero'}
          </button>
        </div>
      </div>

      <div className="mb-6">
        <button onClick={() => setShowAi((s) => !s)} className="text-xs text-gray-500 hover:text-ink transition flex items-center gap-1.5">
          <Icon name={showAi ? 'chevron-down' : 'chevron-right'} size={12} />
          Genera con AI {aiStatus && !aiStatus.configured && <span className="text-gray-600">(in pausa — nessuna API key configurata)</span>}
        </button>
        {showAi && (
          <div className="bg-surface-card rounded-md p-5 border border-gray-800 mt-2">
            {aiStatus && !aiStatus.configured && (
              <div className="bg-yellow-900/20 text-yellow-400 text-xs p-3 rounded-lg mb-4 border border-yellow-900/40">
                Nessuna API key AI configurata (<span className="font-mono">ANTHROPIC_API_KEY</span> mancante sul backend di Super Admin) — la generazione non è ancora attiva.
              </div>
            )}
            {aiError && <div className="bg-red-900/30 text-red-400 text-xs p-3 rounded-lg mb-4 border border-red-900/50 whitespace-pre-wrap">{aiError}</div>}
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Nome modulo <span className="text-gray-600 font-normal">(opzionale, l'AI può dedurlo)</span></label>
                <input
                  className="w-full bg-surface-input text-ink px-3 py-2 rounded-lg outline-none border border-gray-800 focus:border-cp-primary transition placeholder-gray-600 text-sm"
                  placeholder="es. Preventivi"
                  value={moduleName}
                  onChange={(e) => setModuleName(e.target.value)}
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Descrizione del modulo</label>
                <textarea
                  className="w-full bg-surface-input text-ink px-3 py-2 rounded-lg outline-none border border-gray-800 focus:border-cp-primary transition placeholder-gray-600 h-28 resize-y text-sm"
                  placeholder="es. Un modulo Preventivi con cliente, data, righe prodotto/quantità/prezzo, totale calcolato, e un workflow bozza → inviato → accettato/rifiutato"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                />
              </div>
            </div>
            <button onClick={generate} disabled={generating || (aiStatus && !aiStatus.configured)}
              className="mt-3 bg-cp-primary hover:bg-cp-primary-hover disabled:opacity-40 text-white px-3 py-2 rounded-lg text-xs font-medium transition flex items-center gap-2">
              <Icon name="sparkles" size={12} />
              {generating ? 'Generazione in corso...' : 'Genera bozza'}
            </button>

            {draft && (
              <div className="mt-4 pt-4 border-t border-gray-800">
                <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                  <div className="text-sm text-ink font-medium">Bozza generata</div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {Object.entries(stepCounts).map(([type, count]) => (
                      <span key={type} className="text-[10px] bg-gray-800 text-gray-300 px-1.5 py-0.5 rounded font-mono">{type} &times;{count}</span>
                    ))}
                  </div>
                </div>
                <pre className="bg-surface-input text-gray-400 text-xs p-3 rounded-lg overflow-x-auto max-h-64 border border-gray-800">{JSON.stringify(draft, null, 2)}</pre>
                <button onClick={deployDraft} disabled={deploying}
                  className="mt-3 bg-green-700 hover:bg-green-600 disabled:opacity-40 text-white px-3 py-2 rounded-lg text-xs font-medium transition">
                  {deploying ? 'Scrittura in corso...' : selectedSlug ? ('Scrivi in "' + (selectedTenant?.name || selectedSlug) + '" e apri sotto') : 'Scrivi nel sandbox e apri sotto'}
                </button>
                {deployResult && <div className="mt-2 text-xs text-green-400">Fatto — modulo "{deployResult.module_slug}" pronto qui sotto.</div>}
              </div>
            )}
          </div>
        )}
      </div>

      {loading && <div className="text-sm text-gray-500">Preparazione del sandbox...</div>}
      {error && <div className="text-sm text-red-400 bg-red-900/20 border border-red-900/40 rounded-lg px-3 py-2">{error}</div>}
      {!selectedSlug && !loading && !error && (
        <div className="text-sm text-gray-600 border border-dashed border-gray-800 rounded-xl p-8 text-center">
          Caricamento del tuo sandbox in corso...
        </div>
      )}

      {tenantToken && selectedTenant && !loading && (
        <div className="mb-4">
          <button onClick={() => setShowPublish((s) => !s)} className="text-xs text-gray-500 hover:text-ink transition flex items-center gap-1.5">
            <Icon name={showPublish ? 'chevron-down' : 'chevron-right'} size={12} />
            Pubblica nello Store moduli
          </button>
          {showPublish && (
            <div className="bg-surface-card rounded-md p-4 border border-gray-800 mt-2 space-y-2.5">
              {publishResult && (
                <div className={'text-xs p-2.5 rounded-lg ' + (publishResult.ok ? 'bg-green-900/20 text-green-400 border border-green-900/40' : 'bg-red-900/30 text-red-400 border border-red-900/50')}>
                  {publishResult.text}
                </div>
              )}
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Modulo da pubblicare (da "{selectedTenant.name}")</label>
                <Select className="w-full" value={publishForm.module_slug} onChange={(val) => setPublishForm({ ...publishForm, module_slug: val })} placeholder="Seleziona modulo..."
                  options={installedModules.filter((m) => m.slug !== 'dashboard').map((m) => ({ value: m.slug, label: m.name }))} />
              </div>
              {isRepublish && (
                <div className="bg-amber-900/20 text-amber-400 text-xs p-3 rounded-lg border border-amber-900/40">
                  Esiste già la versione {latestPriorVersion} nel Registro — questa pubblicazione diventerà la v{latestPriorVersion + 1}. Chi ha già installato la v{latestPriorVersion} <strong>non</strong> verrà aggiornato in automatico.
                </div>
              )}
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Descrizione <span className="text-gray-600 font-normal">(a cosa serve il modulo)</span></label>
                <textarea className="w-full bg-surface-page text-ink px-3 py-2 rounded-lg text-sm outline-none border border-gray-800 focus:border-cp-primary resize-none" rows={2}
                  value={publishForm.description} onChange={(e) => setPublishForm({ ...publishForm, description: e.target.value })} />
              </div>
              {isRepublish && (
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Cosa è cambiato in questa versione <span className="text-gray-600 font-normal">(mostrato a chi decide se aggiornare)</span></label>
                  <textarea className="w-full bg-surface-page text-ink px-3 py-2 rounded-lg text-sm outline-none border border-gray-800 focus:border-cp-primary resize-none" rows={2}
                    value={publishForm.release_notes} onChange={(e) => setPublishForm({ ...publishForm, release_notes: e.target.value })} placeholder="es. Aggiunto il campo scadenza garanzia, corretto il workflow di reso" />
                </div>
              )}
              <button onClick={publishToRegistry} disabled={publishing || !publishForm.module_slug}
                className="bg-cp-primary hover:bg-cp-primary-hover disabled:opacity-40 text-white px-3 py-2 rounded-lg text-xs font-medium transition">
                {publishing ? 'Pubblicazione...' : isRepublish ? 'Pubblica v' + (latestPriorVersion + 1) : 'Pubblica'}
              </button>
            </div>
          )}
        </div>
      )}

      {tenantToken && selectedTenant && !loading && (
        <BuilderPage
          token={tenantToken}
          baseUrl={tenantBaseUrl(selectedTenant) + '/api'}
          allModules={installedModules}
          moduleActions={(mod) => mod && (
            <button onClick={() => { setPublishForm((f) => ({ ...f, module_slug: mod.slug })); setShowPublish(true); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
              title="Apre il pannello «Salva nella Libreria» già puntato su questo modulo"
              className="text-xs text-gray-500 hover:text-ink transition flex items-center gap-1"><Icon name="upload" size={12} />Salva nella Libreria</button>
          )}
          onModulesChanged={() => openTenant(selectedSlug)}
          openNewModule={openNewModuleFlag}
          onNewModuleHandled={() => setOpenNewModuleFlag(false)}
        />
      )}
    </div>
  )
}

export default TenantBuilderPage
