// Elenco unico id→label/icona delle pagine di Super Admin — prima viveva solo
// dentro Sidebar.jsx; estratto qui perché ora serve anche a Topbar.jsx per il
// breadcrumb (mai due liste della stessa cosa che possono disallinearsi).
//
// Semplificazione 2026-09-27: Platform torna a essere un side project a uso
// personale (un solo operatore, due tenant reali — Coffee e Finance). Il
// layer Partner/CRM/fatturazione/licenze esisteva solo in vista di una scala
// commerciale con rivenditori terzi, mai perseguita — rimosso qui insieme
// alle pagine relative (partner-home, clienti, core-customers, partners,
// fatture, licenze, aggiornamenti). Non c'è più una modalità 'partner': un
// solo pannello, un solo utente, vede tutto — niente più Set di filtro.
// 'guida' (2026-08-30): non più una voce a sé — unificata dentro 'supporto'
// come tab interna (SupportSectionPage.jsx), richiesto dall'utente.
export const MENU_HIDDEN = new Set(['guida'])

// Icone allineate a CLAUDE_CODE_UI_BRIEF.md, tabella ruolo→icona (Fase 2 del
// reskin, 2026-08-23) per le voci che il brief nomina esplicitamente
// (dashboard/tenant/libreria/super-builder/audit/analytics/
// impostazioni). Le voci non presenti nel brief (clienti, licenze, fatture,
// partner, utenti, supporto, guida) mantengono l'icona già scelta in
// precedenza — nessun cambio senza un riferimento reale nel brief.
//
// `color` (2026-08-29, richiesta esplicita dell'utente dopo il confronto col
// sidebar dei tenant) — PURAMENTE estetico: a differenza dei moduli di un
// tenant (dove il colore viene dal DB, scelto da chi ha creato il modulo),
// queste sono pagine di sistema fisse senza un colore "vero" — nessun
// significato dietro, solo varietà visiva. Applicato SOLO quando la voce non
// è quella attiva (Sidebar.jsx) — attiva resta text-ink, tema-consapevole,
// per non reintrodurre lo stesso bug di contrasto tema-chiaro già risolto
// altrove in questa sessione con un hex fisso.
export const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard', color: '#3B82F6' },
  { id: 'tenants', label: 'Tenant', icon: 'building', color: '#F59E0B' },
  { id: 'libreria', label: 'Libreria', icon: 'store', color: '#EC4899' },
  { id: 'analisi', label: 'Analisi', icon: 'git-branch', color: '#22C55E' },
  { id: 'super-builder', label: 'Super Builder', icon: 'wand', color: '#A855F7' },
  { id: 'attivita', label: 'Attività', icon: 'clipboard', color: '#64748B' },
  { id: 'analytics', label: 'Analytics', icon: 'bar-chart', color: '#0EA5E9' },
  { id: 'users', label: 'Utenti', icon: 'users', color: '#EC4899' },
  { id: 'impostazioni', label: 'Impostazioni', icon: 'settings', color: '#94A3B8' },
  { id: 'guida', label: 'Guida', icon: 'info', color: '#64748B' },
]
