import React, { useState, useEffect } from 'react'
import Icon from './Icon'

// ─── UI DI PROGRESSO CREAZIONE TENANT (2026-08-16) ──────────────────────────
// Segnalato dall'utente: "anche la creazione del tenant è lenta" — verificato
// che il tempo (container Docker + attesa boot del backend dentro + DNS
// Cloudflare, vedi createTenant() in tenants.js) era già così prima di oggi,
// non una regressione — ma la UI si limitava a disabilitare il bottone con
// "Creazione..." per tutta la durata, nessuna rassicurazione che stesse
// davvero facendo qualcosa. Non esiste un canale di progresso reale dal
// server (l'intera creazione è UNA chiamata sincrona) — quindi qui NON si
// finge una percentuale, solo messaggi onesti che avanzano col tempo
// trascorso, per far leggere qualcosa mentre si aspetta invece di un
// bottone grigio fermo. Riusabile ovunque si crei un tenant (wizard normale
// in TenantsPage.jsx, "Crea tenant da analisi" in ClientsPage.jsx).
//
// Percentuale stimata (2026-08-16, richiesta esplicitamente dall'utente:
// "anche qua meglio vedere una %") — resta comunque onesta: curva asintotica
// sul tempo trascorso, MAI arriva a 100 da sola (tetto al 96%), perché non
// sappiamo davvero quando finirà. Il 100% vero si vede solo sparendo (il
// componente si smonta quando la vera chiamata risponde) — mai una barra
// piena mentre si è ancora fermi ad aspettare.
const STAGES = [
  { after: 0, label: 'Avvio una nuova istanza…' },
  { after: 3000, label: 'Il sistema si sta inizializzando…' },
  { after: 7000, label: 'Configuro moduli e dominio…' },
  { after: 13000, label: 'Ultimi dettagli, quasi pronto…' },
  { after: 20000, label: 'Ci sta mettendo più del solito, ma sta ancora lavorando…' },
]
// Tempo caratteristico della curva (9s) scelto sulle stesse soglie di STAGES
// sopra — a 9s ~50%, a 18s ~75%, a 27s ~87%, mai oltre il tetto.
function estimatedPercent(elapsedMs) {
  return Math.min(96, Math.round(100 * (1 - Math.exp(-elapsedMs / 9000))))
}

function TenantCreatingOverlay({ label }) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const start = Date.now()
    const id = setInterval(() => setElapsed(Date.now() - start), 500)
    return () => clearInterval(id)
  }, [])
  const stage = [...STAGES].reverse().find((s) => elapsed >= s.after) || STAGES[0]
  const pct = estimatedPercent(elapsed)

  return (
    <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4">
      <div className="bg-surface-card border border-gray-800 rounded-2xl p-8 max-w-sm w-full text-center">
        <div className="text-ink font-medium mb-1">{label || 'Creazione tenant in corso'}</div>
        <div className="text-sm text-gray-500 mb-4">{stage.label}</div>
        <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
          <div className="h-full bg-cp-primary rounded-full transition-[width] duration-500 ease-out" style={{ width: pct + '%' }} />
        </div>
        <div className="flex items-center justify-between mt-2">
          <span className="text-xs text-gray-500">{pct}%</span>
          <span className="text-xs text-gray-600">{Math.floor(elapsed / 1000)}s</span>
        </div>
        <div className="text-[11px] text-gray-600 mt-3 flex items-center justify-center gap-1.5">
          <Icon name="info" size={11} />non chiudere questa pagina
        </div>
      </div>
    </div>
  )
}

export default TenantCreatingOverlay
