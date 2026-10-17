import React, { useState, useEffect } from 'react'
import { API } from '../lib/api'
import Icon from '../components/Icon'
import Select from '../components/Select'
import VerticaliAdmin from '../components/VerticaliAdmin'
import { parseSchemaFrontend, getAutomationSteps, getRequiredConnectors } from '../lib/schema-v3-frontend'

// La Libreria: i miei moduli, salvati con una versione, da installare in qualunque
// tenant. Installare = copiare: il tenant ne riceve una copia sua e vede "disponibile
// la v2" quando ne salvo una nuova. Una riga dell'elenco = un modulo (l'ultima
// versione); lo storico è nella scheda "Versioni".

const inputCls = 'w-full bg-surface-page text-ink px-3.5 py-2.5 rounded-lg outline-none border border-gray-800 focus:border-cp-primary transition text-sm placeholder-gray-600'
const primaryBtn = 'bg-cp-primary hover:bg-cp-primary-hover disabled:opacity-50 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition'
const ghostBtn = 'px-4 py-2.5 rounded-lg text-sm bg-surface-page hover:bg-gray-800 text-gray-300 transition border border-gray-800'

function techSpec(m) {
  const schema = parseSchemaFrontend(m.schema_json)
  return {
    fields: schema.fields || [],
    relations: schema.relations || [],
    workflow: schema.workflow,
    permissionsRules: (schema.permissions && schema.permissions.rules) || [],
    automations: getAutomationSteps(m.schema_json),
    connectors: getRequiredConnectors(m.schema_json),
    views: schema.views || [],
    apiSources: schema.api_sources || [],
  }
}

function formatDate(s) {
  if (!s) return ''
  const d = new Date(s.replace(' ', 'T') + 'Z')
  return isNaN(d) ? s : d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' })
}

function Modal({ onClose, children, wide }) {
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className={'bg-surface-card rounded-xl w-full border border-gray-800 max-h-[88vh] overflow-y-auto ' + (wide ? 'max-w-2xl' : 'max-w-md')} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  )
}

function LibreriaPage({ token }) {
  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }
  const [modules, setModules] = useState([])
  const [tenants, setTenants] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [gruppo, setGruppo] = useState('') // filtro per gruppo ('' = tutti)
  const [soloRuoli, setSoloRuoli] = useState(false) // solo i moduli che dichiarano i ruoli (lavorano con report, bot e riepiloghi)
  const [uso, setUso] = useState(null) // «Dove è usato» del modulo aperto
  const [notice, setNotice] = useState(null) // { ok, text }

  const [detail, setDetail] = useState(null)
  const [tab, setTab] = useState('panoramica')
  const [versions, setVersions] = useState(null)
  const [edit, setEdit] = useState(null) // { description, release_notes }
  const [installSlug, setInstallSlug] = useState('')
  const [busy, setBusy] = useState(false)

  const [publishOpen, setPublishOpen] = useState(false)
  const [pub, setPub] = useState({ tenant: '', module: '', description: '', release_notes: '' })
  const [pubModules, setPubModules] = useState([])

  const [proposteT, setProposteT] = useState([]) // proposte dei tenant (in coda e già decise)
  const [decisione, setDecisione] = useState(null) // { p, group_name, description } mentre si approva
  const caricaProposte = () => fetch(API + '/registry/proposals', { headers }).then((r) => r.json()).then((d) => Array.isArray(d) && setProposteT(d)).catch(() => {})
  useEffect(() => { caricaProposte() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const approva = async () => {
    setBusy(true)
    const res = await fetch(API + '/registry/proposals/' + decisione.p.id + '/approve', { method: 'POST', headers, body: JSON.stringify({ description: decisione.description, group_name: decisione.group_name }) })
    const d = await res.json().catch(() => ({})); setBusy(false)
    if (res.ok) { flash(true, '«' + decisione.p.name + '» è nella Libreria (v' + d.version + ').'); setDecisione(null); caricaProposte(); load() } else flash(false, d.error || 'Non riuscito.')
  }
  const rifiuta = async (p) => {
    const reason = window.prompt('Perché la rifiuti? Lo vede chi ha proposto «' + p.name + '».')
    if (reason == null) return
    const res = await fetch(API + '/registry/proposals/' + p.id + '/reject', { method: 'POST', headers, body: JSON.stringify({ reason }) })
    const d = await res.json().catch(() => ({}))
    if (res.ok) { flash(true, 'Proposta rifiutata.'); caricaProposte() } else flash(false, d.error || 'Non riuscito.')
  }
  const [generici, setGenerici] = useState(null) // { totale, presenti, mancanti }: i moduli generici di partenza
  const [defaultsOpen, setDefaultsOpen] = useState(false)
  const [defaultIds, setDefaultIds] = useState({})

  const loadGenerici = () => fetch(API + '/registry/generici', { headers }).then((r) => r.json()).then((d) => d && d.totale != null && setGenerici(d)).catch(() => {})
  useEffect(() => { loadGenerici() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const importaGenerici = async () => {
    if (!window.confirm((generici.mancanti.length ? 'Aggiungere alla Libreria i ' + generici.mancanti.length + ' moduli generici che mancano' : 'Completare con i ruoli i ' + generici.da_completare.length + ' moduli generici già importati') + '? Quello che c\'è già non si tocca.')) return
    setBusy(true)
    const res = await fetch(API + '/registry/import-generici', { method: 'POST', headers })
    const d = await res.json().catch(() => ({}))
    setBusy(false)
    if (res.ok) { setNotice({ ok: true, text: d.aggiunti + ' moduli generici aggiunti' + (d.completati ? ', ' + d.completati + ' completati con i ruoli' : '') + '.' }); loadGenerici(); load() } else setNotice({ ok: false, text: d.error || 'Non riuscito.' })
  }
  const load = async () => {
    const [m, t] = await Promise.all([
      fetch(API + '/registry/modules', { headers }).then((r) => (r.ok ? r.json() : [])),
      fetch(API + '/tenants', { headers }).then((r) => (r.ok ? r.json() : [])),
    ])
    setModules(m)
    setTenants(t.filter((x) => x.status !== 'deleted'))
    setLoading(false)
  }
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const openDetail = (m) => { setUso(null); setDetail(m); setTab('panoramica'); setVersions(null); setEdit(null); setInstallSlug(''); setNotice(null) }
  const closeDetail = () => setDetail(null)

  useEffect(() => {
    if (tab !== 'versioni' || !detail || versions !== null) return
    fetch(API + '/registry/modules/' + detail.id + '/versions', { headers }).then((r) => r.json()).then(setVersions)
  }, [tab, detail]) // eslint-disable-line react-hooks/exhaustive-deps

  const flash = (ok, text) => { setNotice({ ok, text }); setTimeout(() => setNotice(null), 6000) }

  const saveEdit = async () => {
    setBusy(true)
    const res = await fetch(API + '/registry/modules/' + detail.id, { method: 'PATCH', headers, body: JSON.stringify(edit) })
    setBusy(false)
    if (!res.ok) return flash(false, 'Salvataggio non riuscito')
    const updated = await res.json()
    setDetail({ ...detail, ...updated })
    setEdit(null)
    load()
  }

  const installIn = async () => {
    if (!installSlug) return
    setBusy(true)
    const res = await fetch(API + '/registry/modules/' + detail.id + '/install-to/' + installSlug, { method: 'POST', headers, body: '{}' })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) return flash(false, data.error || 'Installazione non riuscita')
    const target = tenants.find((t) => t.slug === installSlug)
    flash(true, '"' + detail.name + '" v' + detail.version + ' installato in ' + (target ? target.name : installSlug) + '.')
    setInstallSlug('')
    load()
  }

  const removeVersion = async (id, label) => {
    if (!window.confirm('Togliere ' + label + ' dalla Libreria? I tenant che l\'hanno già installata non cambiano.')) return
    await fetch(API + '/registry/modules/' + id, { method: 'DELETE', headers })
    closeDetail()
    load()
  }

  const openPublish = () => { setPub({ tenant: '', module: '', description: '', release_notes: '' }); setPubModules([]); setPublishOpen(true) }
  const pickPublishTenant = async (slug) => {
    setPub({ ...pub, tenant: slug, module: '' })
    setPubModules([])
    if (!slug) return
    const res = await fetch(API + '/registry/tenants/' + slug + '/modules', { headers })
    if (res.ok) setPubModules(await res.json())
  }
  const existing = pub.tenant && pub.module ? modules.find((m) => m.slug === pub.module && m.source_tenant_slug === pub.tenant) : null
  const publish = async () => {
    setBusy(true)
    const res = await fetch(API + '/registry/publish', { method: 'POST', headers, body: JSON.stringify({
      tenant_slug: pub.tenant, module_slug: pub.module, description: pub.description, release_notes: pub.release_notes,
    }) })
    const data = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) return flash(false, data.error || 'Salvataggio non riuscito')
    setPublishOpen(false)
    flash(true, '"' + data.name + '" salvato nella Libreria come v' + data.version + '.')
    load()
  }

  const openDefaults = async () => {
    const res = await fetch(API + '/registry/default-modules', { headers })
    const rows = res.ok ? await res.json() : []
    setDefaultIds(Object.fromEntries(rows.map((r) => [r.id, true])))
    setDefaultsOpen(true)
  }
  const saveDefaults = async () => {
    setBusy(true)
    const ids = Object.keys(defaultIds).filter((k) => defaultIds[k]).map(Number)
    await fetch(API + '/registry/default-modules', { method: 'PUT', headers, body: JSON.stringify({ module_ids: ids }) })
    setBusy(false)
    setDefaultsOpen(false)
    flash(true, ids.length ? ids.length + ' moduli saranno installati in ogni nuovo tenant.' : 'I nuovi tenant partiranno senza moduli preinstallati.')
  }

  const q = search.trim().toLowerCase()
  const gruppi = [...new Set(modules.map((m) => m.group_name).filter(Boolean))].sort()
  const shown = modules.filter((m) => (!gruppo || m.group_name === gruppo) && (!soloRuoli || m.ruoli) && (!q || m.name.toLowerCase().includes(q) || (m.description || '').toLowerCase().includes(q) || (m.group_name || '').toLowerCase().includes(q)))
  useEffect(() => {
    if (!detail || tab !== 'uso' || uso) return
    fetch(API + '/registry/modules/' + detail.id + '/usage', { headers }).then((r) => r.ok ? r.json() : { tenants: [], usato_da: [], errore: true }).then(setUso)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail && detail.id, tab])
  const spec = detail ? techSpec(detail) : null

  return (
    <div className="max-w-5xl">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <div>
          <h1 className="text-lg font-bold text-ink tracking-[-0.35px]">Libreria</h1>
          <p className="text-gray-500 text-sm mt-0.5">I tuoi moduli, con le loro versioni, pronti da installare in qualunque tenant.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {generici && (generici.mancanti.length + (generici.da_completare || []).length) > 0 && <button onClick={importaGenerici} disabled={busy} className={ghostBtn + ' text-xs !py-2'}>{generici.mancanti.length ? 'Aggiungi i moduli generici (' + generici.mancanti.length + ')' : 'Completa i moduli generici (' + generici.da_completare.length + ')'}</button>}
          <button onClick={openDefaults} className={ghostBtn + ' text-xs !py-2'}>Moduli di default</button>
          <button onClick={openPublish} className={primaryBtn + ' text-xs !py-2 flex items-center gap-1.5'}><Icon name="plus" size={13} />Salva un modulo</button>
        </div>
      </div>

      {notice && (
        <div className={'text-sm p-3 rounded-lg mb-4 border ' + (notice.ok ? 'bg-green-900/20 text-green-400 border-green-900/40' : 'bg-red-900/30 text-red-400 border-red-900/50')}>{notice.text}</div>
      )}

      <VerticaliAdmin token={token} modules={modules} />

      {proposteT.some((p) => p.status === 'pending') && (
        <section className="bg-surface-card border border-cp-primary/40 rounded-xl p-4 mb-5">
          <h2 className="text-sm font-semibold text-ink mb-1">Proposte dai tenant ({proposteT.filter((p) => p.status === 'pending').length})</h2>
          <p className="text-xs text-gray-500 mb-3">Un tenant propone un suo modulo (solo lo schema, mai i dati). Controlla campi e stati: se i nomi delle scelte contengono nomi di persone o aziende, rifiuta.</p>
          <div className="divide-y divide-gray-800">
            {proposteT.filter((p) => p.status === 'pending').map((p) => (
              <div key={p.id} className="py-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0"><div className="text-sm text-ink font-medium">{p.name} <span className="text-gray-500 font-normal">· da {p.tenant_slug} · sarà v{p.versione_prossima}</span></div>
                    {p.description && <div className="text-xs text-gray-400 mt-0.5">{p.description}</div>}
                    {p.note && <div className="text-xs text-gray-500 mt-0.5 italic">Nota: {p.note}</div>}</div>
                  <div className="flex gap-2 flex-shrink-0">
                    <button type="button" onClick={() => setDecisione({ p, description: p.description, group_name: p.group_name || '' })} className={primaryBtn + ' text-xs !py-1.5'}>Approva</button>
                    <button type="button" onClick={() => rifiuta(p)} className={ghostBtn + ' text-xs !py-1.5'}>Rifiuta</button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-2">{p.campi.map((f) => <span key={f.key} className="text-[11px] px-2 py-0.5 rounded bg-surface-page border border-gray-800 text-gray-400">{f.label}</span>)}</div>
                {p.stati.length > 0 && <div className="text-xs text-gray-500 mt-1.5">Stati: {p.stati.join(' → ')}</div>}
                {p.relazioni.length > 0 && <div className="text-xs text-gray-500 mt-0.5">Collegato a: {p.relazioni.join(', ')}</div>}
                {decisione && decisione.p.id === p.id && (
                  <div className="mt-3 bg-surface-page border border-gray-800 rounded-lg p-3 space-y-2">
                    <input className={inputCls} placeholder="Gruppo (es. Finanza, Vendite, Magazzino...)" value={decisione.group_name} onChange={(e) => setDecisione({ ...decisione, group_name: e.target.value })} />
                    <textarea className={inputCls + ' min-h-[60px]'} placeholder="Descrizione per la Libreria" value={decisione.description} onChange={(e) => setDecisione({ ...decisione, description: e.target.value })} />
                    <div className="flex gap-2"><button type="button" onClick={approva} disabled={busy} className={primaryBtn + ' text-xs !py-1.5'}>{busy ? 'Pubblico…' : 'Metti nella Libreria'}</button><button type="button" onClick={() => setDecisione(null)} className={ghostBtn + ' text-xs !py-1.5'}>Annulla</button></div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="relative mb-5 max-w-md">
        <Icon name="search" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cerca un modulo..." className={inputCls + ' pl-9'} />
      </div>
      {(gruppi.length > 1 || modules.some((m) => m.ruoli)) && (
        <div className="flex items-center gap-1.5 flex-wrap mb-4">
          {gruppi.length > 1 && ['', ...gruppi].map((g) => <button key={g || 'tutti'} type="button" onClick={() => setGruppo(g)} className={'text-xs px-2.5 py-1 rounded-full border transition ' + (gruppo === g ? 'border-cp-primary bg-cp-primary/15 text-ink' : 'border-gray-800 text-gray-500 hover:text-gray-300')}>{g || 'Tutti i gruppi'}</button>)}
          {modules.some((m) => m.ruoli) && <button type="button" onClick={() => setSoloRuoli(!soloRuoli)} className={'text-xs px-2.5 py-1 rounded-full border transition ' + (soloRuoli ? 'border-cp-primary bg-cp-primary/15 text-ink' : 'border-gray-800 text-gray-500 hover:text-gray-300')} title="Moduli che dichiarano a cosa servono: lavorano con report, bot e riepiloghi">Con ruoli dichiarati</button>}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-gray-600">Caricamento...</div>
      ) : shown.length === 0 ? (
        <div className="bg-surface-card border border-dashed border-gray-800 rounded-xl p-8 text-center text-sm text-gray-500">
          {modules.length === 0 ? 'La Libreria è vuota. Costruisci un modulo in un tenant e salvalo qui con "Salva un modulo".' : 'Nessun modulo corrisponde alla ricerca.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {shown.map((m) => (
            <button key={m.id} onClick={() => openDetail(m)} className="text-left bg-surface-card border border-gray-800 hover:border-gray-600 rounded-xl p-4 transition flex flex-col">
              <div className="flex items-center gap-2.5 mb-2">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: (m.color || '#2563EB') + '22', color: m.color || '#2563EB' }}>
                  <Icon name={m.icon || 'box'} size={16} />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-ink truncate">{m.name}</div>
                  <div className="text-[11px] text-gray-500 font-mono">v{m.version}{m.versions_count > 1 ? ' · ' + m.versions_count + ' versioni' : ''}</div>
                </div>
              </div>
              <div className="text-xs text-gray-500 line-clamp-2 flex-1 min-h-[2.2em]">{m.description || 'Nessuna descrizione.'}</div>
              <div className="flex items-center justify-between text-[11px] text-gray-600 mt-3 pt-3 border-t border-gray-800/70">
                <span className="truncate">{m.group_name ? m.group_name + ' · ' : ''}da {m.source_tenant_slug}</span>
                <span className="flex-shrink-0">{m.install_count} install.</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* DETTAGLIO */}
      {detail && (
        <Modal onClose={closeDetail} wide>
          <div className="p-5 border-b border-gray-800 flex items-start justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: (detail.color || '#2563EB') + '22', color: detail.color || '#2563EB' }}>
                <Icon name={detail.icon || 'box'} size={22} />
              </div>
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-ink truncate">{detail.name}</h2>
                <div className="text-xs text-gray-500 font-mono">{detail.slug} · v{detail.version} · da {detail.source_tenant_slug} · {formatDate(detail.created_at)}</div>
              </div>
            </div>
            <button onClick={closeDetail} className="text-gray-500 hover:text-ink transition flex-shrink-0"><Icon name="x" size={18} /></button>
          </div>

          <div className="flex gap-1 px-5 border-b border-gray-800">
            {[['panoramica', 'Panoramica'], ['struttura', 'Struttura'], ['versioni', 'Versioni'], ['uso', 'Dove è usato']].map(([id, label]) => (
              <button key={id} onClick={() => setTab(id)} className={'text-sm px-3 py-2.5 -mb-px border-b-2 transition ' + (tab === id ? 'border-cp-primary text-ink font-medium' : 'border-transparent text-gray-500 hover:text-gray-300')}>{label}</button>
            ))}
          </div>

          <div className="p-5">
            {notice && <div className={'text-sm p-3 rounded-lg mb-4 border ' + (notice.ok ? 'bg-green-900/20 text-green-400 border-green-900/40' : 'bg-red-900/30 text-red-400 border-red-900/50')}>{notice.text}</div>}

            {tab === 'panoramica' && (
              <div className="space-y-5">
                {edit ? (
                  <div className="space-y-2.5">
                    <textarea className={inputCls + ' min-h-[80px]'} placeholder="Descrizione" value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} />
                    <textarea className={inputCls + ' min-h-[60px]'} placeholder="Note di questa versione" value={edit.release_notes} onChange={(e) => setEdit({ ...edit, release_notes: e.target.value })} />
                    <div className="flex gap-2">
                      <button onClick={saveEdit} disabled={busy} className={primaryBtn}>Salva</button>
                      <button onClick={() => setEdit(null)} className={ghostBtn}>Annulla</button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <p className="text-sm text-gray-300 whitespace-pre-wrap">{detail.description || 'Nessuna descrizione.'}</p>
                    {detail.release_notes && <p className="text-xs text-gray-500 mt-2 whitespace-pre-wrap"><span className="text-gray-400">Note v{detail.version}:</span> {detail.release_notes}</p>}
                    <button onClick={() => setEdit({ description: detail.description || '', release_notes: detail.release_notes || '' })} className="text-xs text-cp-primary hover:opacity-80 transition mt-2">Modifica descrizione e note</button>
                  </div>
                )}

                <div className="grid grid-cols-3 gap-3 text-xs">
                  <div className="bg-surface-page border border-gray-800 rounded-lg p-3"><div className="text-gray-500 mb-0.5">Campi</div><div className="text-ink font-mono">{spec.fields.length}</div></div>
                  <div className="bg-surface-page border border-gray-800 rounded-lg p-3"><div className="text-gray-500 mb-0.5">Installazioni</div><div className="text-ink font-mono">{detail.install_count}</div></div>
                  <div className="bg-surface-page border border-gray-800 rounded-lg p-3"><div className="text-gray-500 mb-0.5">Collegamenti</div><div className="text-ink">{spec.connectors.length ? spec.connectors.join(', ') : 'Nessuno'}</div></div>
                </div>

                <div className="bg-surface-page border border-gray-800 rounded-lg p-4">
                  <div className="text-sm text-ink font-medium mb-1">Installa in un tenant</div>
                  <div className="text-xs text-gray-500 mb-3">Il tenant riceve una copia: può modificarla senza toccare gli altri, e vedrà gli aggiornamenti quando ne salvi una nuova versione.</div>
                  <div className="flex gap-2 flex-wrap items-center">
                    <Select value={installSlug} onChange={setInstallSlug} placeholder="Scegli il tenant..." className="w-56"
                      options={tenants.filter((t) => t.status === 'active').map((t) => ({ value: t.slug, label: t.name }))} />
                    <button onClick={installIn} disabled={!installSlug || busy} className={primaryBtn}>{busy ? 'Installo...' : 'Installa'}</button>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <a href={API + '/registry/modules/' + detail.id + '/export?token=' + encodeURIComponent(token)} className="text-xs text-gray-400 hover:text-ink transition flex items-center gap-1.5"><Icon name="download" size={12} />Esporta come file</a>
                  <button onClick={() => removeVersion(detail.id, 'la v' + detail.version + ' di "' + detail.name + '"')} className="text-xs text-gray-500 hover:text-red-400 transition">Togli questa versione</button>
                </div>
              </div>
            )}

            {tab === 'struttura' && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="bg-surface-page border border-gray-800 rounded-lg p-3">
                  <div className="text-[11px] text-gray-500 mb-1.5">Campi ({spec.fields.length})</div>
                  {spec.fields.length === 0 ? <div className="text-xs text-gray-600">Nessuno</div> : (
                    <ul className="text-xs text-gray-300 space-y-1">{spec.fields.map((f) => <li key={f.key}>{f.label} <span className="text-gray-600 font-mono">({f.type}{f.required ? ', obbligatorio' : ''})</span></li>)}</ul>
                  )}
                </div>
                <div className="space-y-3">
                  <div className="bg-surface-page border border-gray-800 rounded-lg p-3">
                    <div className="text-[11px] text-gray-500 mb-1.5">Relazioni ({spec.relations.length})</div>
                    {spec.relations.length === 0 ? <div className="text-xs text-gray-600">Nessuna</div> : (
                      <ul className="text-xs text-gray-300 space-y-1">{spec.relations.map((r) => <li key={r.key}>{r.label} <span className="text-gray-600 font-mono">→ {r.target_module}</span></li>)}</ul>
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
                      <ul className="text-xs text-gray-300 space-y-1">{spec.automations.map((a) => <li key={a.id}>{a.label || '(senza nome)'}</li>)}</ul>
                    )}
                  </div>
                  <div className="bg-surface-page border border-gray-800 rounded-lg p-3">
                    <div className="text-[11px] text-gray-500 mb-1.5">Viste ({spec.views.length})</div>
                    {spec.views.length === 0 ? <div className="text-xs text-gray-600">Nessuna</div> : (
                      <ul className="text-xs text-gray-300 space-y-1">{spec.views.map((v) => <li key={v.key}>{v.label || v.key} <span className="text-gray-600 font-mono">({v.mode}{v.placement === 'add' ? ', si aggiunge' : ''})</span></li>)}</ul>
                    )}
                  </div>
                  <div className="bg-surface-page border border-gray-800 rounded-lg p-3">
                    <div className="text-[11px] text-gray-500 mb-1.5">Fonti esterne ({spec.apiSources.length})</div>
                    {spec.apiSources.length === 0 ? <div className="text-xs text-gray-600">Nessuna</div> : (
                      <ul className="text-xs text-gray-300 space-y-1">{spec.apiSources.map((s) => <li key={s.key}>{s.label || s.key}{s.enabled === false ? <span className="text-gray-600"> (disattivata)</span> : null}</li>)}</ul>
                    )}
                  </div>
                  <div className="bg-surface-page border border-gray-800 rounded-lg p-3">
                    <div className="text-[11px] text-gray-500 mb-1.5">Permessi</div>
                    <div className="text-xs text-gray-300">{spec.permissionsRules.length > 0 ? spec.permissionsRules.length + ' regole configurate' : 'Nessuna regola'}</div>
                  </div>
                </div>
                <div className="sm:col-span-2 text-xs text-gray-600">Per modificare la struttura apri il modulo nel Builder del tenant, poi salvalo di nuovo qui: nasce la versione successiva.</div>
              </div>
            )}

            {tab === 'uso' && (
              <div className="space-y-4">
                {!uso ? <div className="text-sm text-gray-600">Controllo…</div> : (
                  <>
                    <div>
                      <div className="text-xs text-gray-500 mb-1.5">Tenant che lo hanno installato (ultima versione: v{uso.versione_ultima})</div>
                      {uso.tenants.length === 0 ? <div className="text-sm text-gray-600">Nessun tenant.</div> : (
                        <div className="divide-y divide-gray-800 border border-gray-800 rounded-lg">
                          {uso.tenants.map((t) => (
                            <div key={t.slug} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                              <span className="text-ink truncate">{t.name}</span>
                              <span className={'text-xs flex-shrink-0 ' + (t.aggiornabile ? 'text-amber-400' : 'text-gray-500')}>{t.aggiornabile ? 'v' + t.version + ' → v' + uso.versione_ultima + ' disponibile' : 'v' + t.version + ' aggiornato'}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      <p className="text-xs text-gray-600 mt-1.5">Da qui non si aggiorna niente: l'aggiornamento lo decide ogni tenant, dalla sua Libreria.</p>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500 mb-1.5">Moduli della Libreria che si collegano a questo</div>
                      {uso.usato_da.length === 0 ? <div className="text-sm text-gray-600">Nessuno.</div> : <div className="flex flex-wrap gap-1.5">{uso.usato_da.map((m) => <span key={m.id} className="text-xs bg-gray-800 text-gray-200 rounded-md px-2 py-1">{m.name}</span>)}</div>}
                    </div>
                  </>
                )}
              </div>
            )}

            {tab === 'versioni' && (
              <div>
                {versions === null ? <div className="text-sm text-gray-600">Caricamento...</div> : (
                  <ul className="space-y-2">
                    {versions.map((v) => (
                      <li key={v.id} className="bg-surface-page border border-gray-800 rounded-lg px-3.5 py-2.5 flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm text-ink">v{v.version} <span className="text-xs text-gray-500">· {formatDate(v.created_at)}</span>{v.id === detail.id && <span className="text-[10px] text-cp-primary ml-2">questa</span>}</div>
                          <div className="text-xs text-gray-500 whitespace-pre-wrap">{v.release_notes || 'Nessuna nota.'}</div>
                        </div>
                        {v.id !== detail.id && (
                          <button onClick={() => removeVersion(v.id, 'la v' + v.version)} className="text-xs text-gray-500 hover:text-red-400 transition flex-shrink-0">Togli</button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* SALVA UN MODULO */}
      {publishOpen && (
        <Modal onClose={() => setPublishOpen(false)}>
          <div className="p-5">
            <h2 className="text-base font-semibold text-ink mb-1">Salva un modulo nella Libreria</h2>
            <p className="text-xs text-gray-500 mb-4">Scegli un modulo che hai costruito in un tenant. Se è già nella Libreria nasce la versione successiva.</p>
            <div className="space-y-3">
              <Select value={pub.tenant} onChange={pickPublishTenant} placeholder="Da quale tenant?" className="w-full"
                options={tenants.map((t) => ({ value: t.slug, label: t.name }))} />
              {pub.tenant && (
                <Select value={pub.module} onChange={(v) => setPub({ ...pub, module: v })} placeholder="Quale modulo?" className="w-full"
                  options={pubModules.map((m) => ({ value: m.slug, label: m.name }))} />
              )}
              {pub.module && (
                <>
                  <div className="text-xs text-gray-400">{existing ? 'Nella Libreria c\'è già la v' + existing.version + ': questa sarà la v' + (existing.version + 1) + '.' : 'Nuovo modulo: sarà la v1.'}</div>
                  <textarea className={inputCls + ' min-h-[70px]'} placeholder="Descrizione (a cosa serve)" value={pub.description} onChange={(e) => setPub({ ...pub, description: e.target.value })} />
                  <textarea className={inputCls + ' min-h-[56px]'} placeholder="Cosa cambia in questa versione (facoltativo)" value={pub.release_notes} onChange={(e) => setPub({ ...pub, release_notes: e.target.value })} />
                </>
              )}
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setPublishOpen(false)} className={ghostBtn + ' flex-1'}>Annulla</button>
              <button onClick={publish} disabled={!pub.tenant || !pub.module || busy} className={primaryBtn + ' flex-1'}>{busy ? 'Salvo...' : 'Salva'}</button>
            </div>
          </div>
        </Modal>
      )}

      {/* MODULI DI DEFAULT */}
      {defaultsOpen && (
        <Modal onClose={() => setDefaultsOpen(false)}>
          <div className="p-5">
            <h2 className="text-base font-semibold text-ink mb-1">Moduli di default</h2>
            <p className="text-xs text-gray-500 mb-4">Questi moduli vengono installati in ogni tenant nuovo.</p>
            <div className="space-y-1.5 max-h-72 overflow-y-auto mb-5">
              {modules.length === 0 && <div className="text-xs text-gray-600">La Libreria è vuota.</div>}
              {modules.map((m) => (
                <label key={m.id} className="flex items-center gap-2.5 text-sm text-gray-300 cursor-pointer px-2 py-1.5 rounded-lg hover:bg-gray-800/50">
                  <input type="checkbox" checked={!!defaultIds[m.id]} onChange={(e) => setDefaultIds({ ...defaultIds, [m.id]: e.target.checked })} />
                  {m.name} <span className="text-[11px] text-gray-600 font-mono">v{m.version}</span>
                </label>
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={() => setDefaultsOpen(false)} className={ghostBtn + ' flex-1'}>Annulla</button>
              <button onClick={saveDefaults} disabled={busy} className={primaryBtn + ' flex-1'}>Salva</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

export default LibreriaPage
