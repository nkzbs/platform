import React, { useState, useEffect } from 'react'
import { API } from '../lib/api'
import { Kpi, LineTrend } from '../components/DashboardCharts'

// ─── ANALYTICS / BI ─────────────────────────────────────────────────────────
// Storico di business vero (serie temporale, non solo un numero live).
// Backend: GET /analytics/snapshots (una riga al giorno, scritta dallo
// scheduler — vedi super-admin/backend/src/analytics-scheduler.js).
//
// Semplificazione 2026-09-27: rimossa la doppia vista Core/Partner (la
// modalità 'partner' non esiste più, App.jsx non passa nemmeno più `mode` —
// era 100% codice morto) e le KPI di fatturato (Platform torna a essere un
// side project a uso personale, l'utente non vuole vederle in dashboard —
// il dato resta comunque calcolato/salvato lato server in metrics_snapshots,
// solo non più mostrato qui).
function AnalyticsPage({ token }) {
  const [points, setPoints] = useState(null)
  const [days, setDays] = useState(30)
  const [capturing, setCapturing] = useState(false)
  const headers = { Authorization: 'Bearer ' + token }

  const load = () => {
    fetch(API + '/analytics/snapshots?days=' + days, { headers })
      .then((r) => (r.ok ? r.json() : []))
      .then(setPoints)
  }

  useEffect(load, [days]) // eslint-disable-line react-hooks/exhaustive-deps

  const captureNow = async () => {
    setCapturing(true)
    await fetch(API + '/analytics/capture-now', { method: 'POST', headers })
    load()
    setCapturing(false)
  }

  if (points === null) return <div className="text-sm text-gray-600 py-10 text-center">Caricamento…</div>

  const latest = points[points.length - 1]

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-lg font-bold text-ink tracking-[-0.35px]">Analytics</h1>
        <button onClick={captureNow} disabled={capturing}
          className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-1.5 rounded-lg disabled:opacity-50">
          {capturing ? 'Cattura…' : 'Cattura foto adesso'}
        </button>
      </div>
      <p className="text-gray-500 text-sm mb-6">Andamento della piattaforma nel tempo — una foto al giorno, non un numero live.</p>

      {!latest && (
        <div className="bg-surface-card rounded-md border border-gray-800 p-6 text-sm text-gray-500 text-center">
          Nessuna foto ancora registrata. Lo storico si costruisce da oggi in poi — premi "Cattura foto adesso" per iniziare subito.
        </div>
      )}

      {latest && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
            <Kpi label="Tenant attivi" value={latest.total_tenants} icon="grid" tone="blue"
              hint="Istanze cliente (tenant) in esecuzione." />
            <Kpi label="Moduli installati" value={latest.total_modules_installed} icon="box" tone="purple"
              hint="Totale moduli installati su tutti i tenant, sommati insieme." />
          </div>

          <div className="flex items-center gap-2 mb-4">
            {[30, 90, 180, 365].map((d) => (
              <button key={d} onClick={() => setDays(d)}
                className={'text-xs px-2.5 py-1 rounded-lg ' + (days === d ? 'bg-cp-primary text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700')}>
                {d}g
              </button>
            ))}
          </div>

          <div className="grid md:grid-cols-2 gap-4 mb-6">
            <div className="bg-surface-card rounded-md border border-gray-800 p-5">
              <div className="text-xs font-semibold text-ink mb-3">Tenant nel tempo</div>
              <LineTrend points={points} series={[{ key: 'total_tenants', label: 'Tenant', color: 'rgb(8 123 255)' }]} />
            </div>
            <div className="bg-surface-card rounded-md border border-gray-800 p-5">
              <div className="text-xs font-semibold text-ink mb-3">Moduli installati nel tempo</div>
              <LineTrend points={points} series={[{ key: 'total_modules_installed', label: 'Moduli', color: 'rgb(8 123 255)' }]} />
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default AnalyticsPage
