// Layer Analytics/BI — storico giornaliero di piattaforma (tenant, moduli
// installati). Le foto sono scritte solo dallo scheduler o da capture-now
// (vedi lib/analytics.js) — questo file è di sola lettura più l'azione
// manuale per non aspettare 24h durante un test.
const express = require('express');
const db = require('../db');
const { requireAuth } = require('./auth');
const { captureSnapshot } = require('../lib/analytics');

const router = express.Router();

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// GET /snapshots?days=90 — storico giornaliero della piattaforma.
router.get('/snapshots', requireAuth, (req, res) => {
  const days = Math.min(365, Math.max(1, parseInt(req.query.days) || 90));
  const rows = db.prepare('SELECT * FROM metrics_snapshots ORDER BY snapshot_date DESC LIMIT ?').all(days);
  rows.reverse();

  res.json(rows.map((r) => ({
    snapshot_date: r.snapshot_date,
    total_tenants: r.total_tenants,
    total_modules_installed: r.total_modules_installed,
  })));
});

// POST /capture-now — cattura/aggiorna la foto di OGGI subito, invece di
// aspettare il prossimo tick dello scheduler (24h) — utile appena dopo aver
// creato/modificato un tenant di prova.
router.post('/capture-now', requireAuth, async (req, res) => {
  res.json(await captureSnapshot(todayStr()));
});

// GET /platform-overview — aggregati per la Dashboard:
// distribuzione tenant per stato, distribuzione moduli per categoria,
// richieste di supporto in attesa, stato aggiornamenti. Ogni pezzo riusa dati/query già esistenti altrove (nessuna
// nuova tabella) — solo aggregato qui in una risposta sola invece di far fare
// N chiamate al frontend. Deliberatamente NON include un aggregato di
// CPU/RAM/storage live per-tenant: richiederebbe N round-trip al
// docker-provisioner ad ogni apertura della dashboard, un costo reale per un
// numero che nessuno controlla così di frequente — lo storage sì (dimensione
// file .db, letta da disco, gratis) resta incluso.
// Fase 12.5 (audit 2026-09-02) — C1: estratta in una funzione separata dall'handler
// HTTP (prima tutta la logica viveva inline nella route) — un candidato più pulito
// per un futuro tool-call AI, stesso principio già applicato in B1-B3 alle capability
// che scrivevano nel tenant. Comportamento invariato, solo separazione.
function computePlatformOverview() {
  // CORREZIONE 2026-09-27: prima escludeva anche qui i tenant di un partner
  // "contenitore interno" (no_core_billing — Staging), stesso filtro usato
  // per non gonfiare i NUMERI DI FATTURATO — ma questo donut è una KPI
  // OPERATIVA (stato dei tenant), non di fatturato. Coffee e Finance vivono
  // sotto "Staging" (no_core_billing=1): il donut era vuoto nonostante 2
  // tenant reali attivi. Ora conta tutti i tenant reali, senza filtro.
  const tenants = db.prepare("SELECT * FROM tenants WHERE status != 'deleted' AND (is_sandbox = 0 OR is_sandbox IS NULL)").all();

  const tenantStatus = {};
  tenants.forEach((t) => { tenantStatus[t.status] = (tenantStatus[t.status] || 0) + 1; });

  // Moduli della Libreria per gruppo (l'ultima versione di ogni modulo, un modulo conta
  // una volta sola): stessi numeri che si vedono nella pagina Libreria.
  const libraryRows = db.prepare(`
    SELECT COALESCE(NULLIF(rm.group_name, ''), 'Senza gruppo') AS category, COUNT(*) AS count
    FROM registry_modules rm
    JOIN (SELECT slug, source_tenant_slug, MAX(version) AS v FROM registry_modules GROUP BY slug, source_tenant_slug) l
      ON l.slug = rm.slug AND l.source_tenant_slug IS rm.source_tenant_slug AND l.v = rm.version
    WHERE rm.support_module = 0
    GROUP BY category ORDER BY count DESC LIMIT 8
  `).all();
  const moduleDistribution = libraryRows.map((r) => ({ category: r.category, count: r.count }));


  const totalStorageMb = tenants.reduce((sum, t) => {
    try { return sum + (require('fs').statSync(t.db_path).size / 1024 / 1024); } catch (e) { return sum; }
  }, 0);

  return {
    tenant_status: tenantStatus,
    module_distribution: moduleDistribution,
    tenants_total: tenants.length,
    total_storage_mb: Math.round(totalStorageMb * 10) / 10,
  };
}

router.get('/platform-overview', requireAuth, (req, res) => {
  res.json(computePlatformOverview());
});

module.exports = router;
