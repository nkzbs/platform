import React, { useState, useEffect } from 'react'
import { API } from '../lib/api'
import Icon from '../components/Icon'
import { Kpi, LineTrend, Donut, HBar } from '../components/DashboardCharts'

// ─── DASHBOARD (Core) ───────────────────────────────────────────────────────
// Redesign 2026-08-30 (PLATFORM-REDESIGN-CORE-PARTNER-TENANT, Fase 1) — dal
// mockup a 3 colonne condiviso dall'utente: più densa della versione
// precedente (4 KPI + una linea + una lista), ora con distribuzione tenant,
// top partner, distribuzione moduli, richieste in attesa, stato
// aggiornamenti. Dati da GET /analytics/snapshots (storico, invariato),
// GET /analytics/platform-overview (nuovo, aggregati one-shot — vedi quel
// file per cosa NON include e perché) e GET /monitoring/timeline (eventi,
// ora filtrato per severità invece della lista piatta). Nessuna libreria di
// grafici in questo repo — Donut/HBar qui sotto sono SVG scritti a mano,
// stessa convenzione di LineTrend.
// Costo AI (2026-09-07) — MAI 0 decimali come formatCurrency sopra (pensato
// per MRR, cifre grandi): un consumo reale di pochi centesimi arrotonderebbe
// sempre a "0 €", indistinguibile da "nessun consumo". 4 decimali, coerenti
// con la precisione già usata per calcolarlo (routes/ai-usage.js).
function formatAICost(n) {
  return (Number(n) || 0).toLocaleString('it-IT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 4 })
}

function pctDelta(now, before) {
  if (!before) return null
  const d = ((now - before) / before) * 100
  if (!isFinite(d)) return null
  return Math.round(d * 10) / 10
}

function timeAgo(iso) {
  const diffMs = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diffMs / 60000)
  if (min < 1) return 'adesso'
  if (min < 60) return min + ' min fa'
  const h = Math.floor(min / 60)
  if (h < 24) return h + (h === 1 ? ' ora fa' : ' ore fa')
  const d = Math.floor(h / 24)
  return d + (d === 1 ? ' giorno fa' : ' giorni fa')
}

const STATUS_LABEL = { active: 'Attivo', trial: 'Trial', suspended: 'Sospeso', stopped: 'Fermo', error: 'Errore' }
const STATUS_COLOR = { active: '#10B981', trial: '#3B82F6', suspended: '#F59E0B', stopped: '#6B7280', error: '#EF4444' }
const AI_PROVIDER_LABEL = { anthropic: 'Claude', mistral: 'Mistral' }
// Un provider senza NESSUNA chiamata ancora non compare nell'aggregato SQL
// (GROUP BY) — riga a zero qui invece di nascondere la colonna, così resta
// chiaro che il tracciamento esiste anche prima del primo utilizzo.
function aiUsageRow(rows, provider) {
  return (rows || []).find((r) => r.provider === provider) || { provider, calls: 0, input_tokens: 0, output_tokens: 0, estimated_cost_eur: null }
}

function DashboardPage({ token, onNavigate }) {
  const headers = { Authorization: 'Bearer ' + token }
  const [points, setPoints] = useState(null)
  const [events, setEvents] = useState([])
  const [overview, setOverview] = useState(null)
  // Consumi API AI (2026-09-07, richiesto dall'utente: "specchietto con stato
  // consumi api AI") — SOLO Core la vede (l'AI la paga Core, non il singolo
  // tenant/partner), quindi vive qui nella Dashboard già Core-only, non in
  // una pagina per-tenant. GET /ai-usage stesso, nessuna rotta nuova per la UI.
  const [aiUsage, setAiUsage] = useState(null)

  useEffect(() => {
    fetch(API + '/analytics/snapshots?days=60', { headers })
      .then((r) => (r.ok ? r.json() : []))
      .then(setPoints)
    // Bug reale, produzione (2026-09-03): /monitoring/timeline è passata da un array
    // nudo a {rows, has_more} nello stesso giro (paginazione con cursore) — qui non
    // era stato aggiornato, "j.map is not a function" al primo render, schermata
    // bianca per chiunque atterrasse sulla Dashboard.
    fetch(API + '/monitoring/timeline?limit=40', { headers })
      .then((r) => (r.ok ? r.json() : { rows: [] }))
      .then((d) => setEvents(d.rows || []))
    fetch(API + '/analytics/platform-overview', { headers })
      .then((r) => (r.ok ? r.json() : null))
      .then(setOverview)
    fetch(API + '/ai-usage', { headers })
      .then((r) => (r.ok ? r.json() : null))
      .then(setAiUsage)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (points === null) return <div className="text-sm text-gray-600 py-10 text-center">Caricamento…</div>

  const last30 = points.slice(-30)
  const latest = last30[last30.length - 1]
  const before = points[points.length - 1 - 30] || points[0]
  const criticalEvents = events.filter((e) => e.kind === 'error').slice(0, 6)
  const healthPct = overview && overview.tenants_total ? Math.round((overview.tenant_status.active || 0) / overview.tenants_total * 100) : null

  return (
    <div>
      <h1 className="text-lg font-bold text-ink tracking-[-0.35px] mb-1">Panoramica Ecosistema</h1>
      <p className="text-gray-500 text-sm mb-6">Vista globale della piattaforma — tenant, moduli, salute.</p>

      {!latest && (
        <div className="bg-surface-card rounded-md border border-gray-800 p-6 text-sm text-gray-500 text-center">
          Nessuna foto ancora registrata — vai in Analytics per catturarne una.
        </div>
      )}

      {latest && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
            <Kpi label="Tenant attivi" value={latest.total_tenants} icon="grid" tone="blue"
              delta={before ? pctDelta(latest.total_tenants, before.total_tenants) : null}
              hint="Istanze cliente (tenant) attualmente in esecuzione." />
            <Kpi label="Salute piattaforma" value={healthPct != null ? healthPct + '%' : '—'} icon="activity" tone="purple"
              hint="Percentuale di tenant in stato Attivo sul totale — più è alta, meno tenant sono fermi o in errore." />
          </div>

          <div className="grid md:grid-cols-3 gap-4 mb-4">
            <div className="md:col-span-2 bg-surface-card rounded-md border border-gray-800 p-5">
              <div className="text-xs font-semibold text-ink mb-3">Tenant attivi nel tempo (ultimi 30 giorni)</div>
              <LineTrend points={last30} series={[
                { key: 'total_tenants', label: 'Tenant attivi', color: 'rgb(134 87 236)' },
              ]} />
            </div>
            <div className="bg-surface-card rounded-md border border-gray-800 p-5 flex flex-col">
              <div className="text-xs font-semibold text-ink mb-3">Distribuzione tenant per stato</div>
              {overview && (
                <div className="flex-1 flex items-center justify-center">
                  <Donut total={overview.tenants_total} segments={
                    Object.entries(overview.tenant_status).map(([key, value]) => ({ key, value, label: STATUS_LABEL[key] || key, color: STATUS_COLOR[key] || '#6B7280' }))
                  } />
                </div>
              )}
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-4 mb-4">
            <div className="bg-surface-card rounded-md border border-gray-800 p-5">
              <div className="text-xs font-semibold text-ink mb-3">Eventi critici</div>
              <div className="space-y-3">
                {criticalEvents.length === 0 && <div className="text-xs text-gray-600">Nessun evento critico recente.</div>}
                {criticalEvents.map((e) => (
                  <div key={e.id} className="text-xs">
                    <div className="text-red-400/90 flex items-center gap-1.5"><Icon name="alert-triangle" size={11} className="flex-shrink-0" />{e.tenant_name}</div>
                    <div className="text-gray-500 mt-0.5">{e.description}</div>
                    <div className="text-gray-600 mt-0.5">{timeAgo(e.created_at)}</div>
                  </div>
                ))}
              </div>
              {onNavigate && (
                <button onClick={() => onNavigate('attivita')} className="text-xs text-cp-primary hover:opacity-80 mt-3">Tutti gli eventi →</button>
              )}
            </div>

            <div className="bg-surface-card rounded-md border border-gray-800 p-5">
              <div className="text-xs font-semibold text-ink mb-3">Distribuzione moduli</div>
              {overview && <HBar rows={overview.module_distribution.map((m) => ({ label: m.category, value: m.count }))} />}
            </div>
          </div>

          {/* Consumi API AI (2026-09-07) — token reali da ai_usage_log, mai un
              costo fabbricato: senza tariffe configurate (AI_COST_PER_MTOK_*)
              dice onestamente che il costo non è stimabile, invece di un 0€
              o una cifra inventata. */}
          {aiUsage && (
            <div className="bg-surface-card rounded-md border border-gray-800 p-5 mt-4">
              <div className="text-xs font-semibold text-ink mb-3 flex items-center gap-1.5">
                <Icon name="sparkles" size={12} />Consumi API AI — tutti i tempi / ultimi 30 giorni
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                {['anthropic', 'mistral'].map((p) => {
                  const allTime = aiUsageRow(aiUsage.all_time, p)
                  const last30 = aiUsageRow(aiUsage.last_30_days, p)
                  const configured = aiUsage.rates_configured[p]
                  const totalTokens = allTime.input_tokens + allTime.output_tokens
                  return (
                    <div key={p}>
                      <div className="text-[10px] uppercase tracking-wide text-gray-600 mb-1">{AI_PROVIDER_LABEL[p]}</div>
                      <div className="text-lg font-bold text-ink">{totalTokens.toLocaleString('it-IT')} token</div>
                      <div className="text-xs text-gray-500">{allTime.calls} chiamat{allTime.calls === 1 ? 'a' : 'e'} totali · {last30.calls} negli ultimi 30gg</div>
                      <div className="text-xs text-gray-500 mt-1">
                        {configured && allTime.estimated_cost_eur != null
                          ? 'Costo stimato: ' + formatAICost(allTime.estimated_cost_eur)
                          : <span className="text-gray-600">Costo non stimabile — imposta AI_COST_PER_MTOK_INPUT/OUTPUT_{p.toUpperCase()}</span>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default DashboardPage
