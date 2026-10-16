const express = require('express');
const db = require('../db');
const { requireAuth } = require('./auth');
const { describeAudit, describeError, describeBusinessEvent } = require('../lib/describe-event');
const { internalSecret } = require('../../../../shared/internal-secret.js');

const router = express.Router();
const INTERNAL_SECRET = internalSecret();

// G2b/G15 (PLATFORM-0.6-GAP-ANALYSIS.md) — sostituisce l'apertura diretta del .db di
// ogni tenant (com'era prima: new Database(t.db_path, {readonly:true})) con una
// chiamata di rete interna a GET /api/audit-log/internal/monitoring-feed, la stessa
// route già usata dal Builder integrato per l'internal-token — nessun pattern nuovo,
// solo riapplicato qui. audit_log/error_logs vengono calcolati DENTRO il processo del
// tenant, Super Admin non tocca più il file grezzo per questo caso d'uso. Fallimento
// (tenant fermo/in creazione/irraggiungibile) -> array vuoti, stesso comportamento di
// prima (fs.existsSync + try/catch), mai un errore che rompe la pagina.
async function fetchTenantMonitoringFeed(tenant, limit, before) {
  try {
    const qs = 'limit=' + limit + (before ? '&before=' + encodeURIComponent(before) : '');
    const res = await fetch('http://platform-' + tenant.slug + ':80/api/audit-log/internal/monitoring-feed?' + qs, {
      headers: { 'x-internal-secret': INTERNAL_SECRET },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { audit_log: [], error_logs: [], business_events: [] };
    const body = await res.json();
    return { audit_log: body.audit_log || [], error_logs: body.error_logs || [], business_events: body.business_events || [] };
  } catch (e) {
    return { audit_log: [], error_logs: [], business_events: [] }; // tenant irraggiungibile — non un errore da segnalare qui
  }
}

// Errori recenti — i propri (Super Admin) + quelli di ogni tenant, letti via rete
// interna (vedi fetchTenantMonitoringFeed sopra), non più aprendo il .db grezzo.
router.get('/errors', requireAuth, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);

  const own = db.prepare('SELECT * FROM error_logs ORDER BY created_at DESC LIMIT ?').all(limit)
    .map((r) => ({ ...r, tenant_slug: null, tenant_name: 'Super Admin' }));

  const tenants = db.prepare("SELECT slug, name FROM tenants WHERE status != 'deleted'").all();
  const feeds = await Promise.all(tenants.map((t) => fetchTenantMonitoringFeed(t, limit)));
  const tenantRows = tenants.flatMap((t, i) => feeds[i].error_logs.map((r) => ({ ...r, tenant_slug: t.slug, tenant_name: t.name })));

  const merged = [...own, ...tenantRows]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, limit);
  res.json(merged);
});

// Log + Monitoring unificati in un solo feed cronologico — prima erano due pagine
// separate (Log: solo azioni di Super Admin su se stesso; Monitoring: solo errori,
// cross-tenant) con descrizioni deboli (azione grezza tipo "tenant.redeploy_all",
// dettagli come "chiave: valore" senza frase). Qui: azioni amministrative (audit_log,
// Super Admin + ogni tenant — "per tutti" richiesto dall'utente, non solo Super
// Admin) ed errori (error_logs, stesso giro già esistente) in un'unica timeline,
// ciascuna riga con una descrizione leggibile pre-calcolata lato server
// (describeAudit/describeError — vedi lib/describe-event.js).
router.get('/timeline', requireAuth, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 150, 500);
  // P2 (collaudo operativo 2026-09-03) — prima il tetto di 500 era anche l'orizzonte
  // massimo raggiungibile: oltre quello, azioni più vecchie diventavano irraggiungibili
  // per sempre, non solo "non ancora caricate" (il fix di paginazione del 2026-09-03
  // aveva coperto solo il log per-tenant, non questa vista aggregata cross-tenant).
  // `before` è un cursore (timestamp ISO), non un vero OFFSET — coerente con come
  // ogni fonte sottostante è già interrogata (DESC LIMIT), "carica altri" ripete la
  // stessa chiamata passando l'evento più vecchio già mostrato.
  const before = req.query.before || null;

  const ownAudit = (before
    ? db.prepare('SELECT * FROM audit_log WHERE created_at < ? ORDER BY created_at DESC LIMIT ?').all(before, limit)
    : db.prepare('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ?').all(limit))
    .map((r) => ({ ...r, details: r.details ? JSON.parse(r.details) : null, tenant_slug: null, tenant_name: 'Super Admin' }));
  const ownErrors = (before
    ? db.prepare('SELECT * FROM error_logs WHERE created_at < ? ORDER BY created_at DESC LIMIT ?').all(before, limit)
    : db.prepare('SELECT * FROM error_logs ORDER BY created_at DESC LIMIT ?').all(limit))
    .map((r) => ({ ...r, tenant_slug: null, tenant_name: 'Super Admin' }));

  const tenants = db.prepare("SELECT slug, name FROM tenants WHERE status != 'deleted'").all();
  const feeds = await Promise.all(tenants.map((t) => fetchTenantMonitoringFeed(t, limit, before)));
  const tenantAudit = tenants.flatMap((t, i) => feeds[i].audit_log.map((r) => ({ ...r, tenant_slug: t.slug, tenant_name: t.name })));
  const tenantErrors = tenants.flatMap((t, i) => feeds[i].error_logs.map((r) => ({ ...r, tenant_slug: t.slug, tenant_name: t.name })));
  // F9 — solo per-tenant: Super Admin non ha "record" di modulo propri (i suoi
  // oggetti — partner/clienti/tenant — sono già coperti da audit_log sopra).
  const tenantBusiness = tenants.flatMap((t, i) => feeds[i].business_events.map((r) => ({ ...r, tenant_slug: t.slug, tenant_name: t.name })));

  const auditEvents = [...ownAudit, ...tenantAudit].map((r) => ({
    kind: 'audit',
    id: 'audit-' + (r.tenant_slug || 'sa') + '-' + r.id,
    tenant_slug: r.tenant_slug,
    tenant_name: r.tenant_name,
    actor: r.actor,
    action: r.action,
    target: r.target,
    details: r.details,
    created_at: r.created_at,
    description: describeAudit(r),
  }));
  const errorEvents = [...ownErrors, ...tenantErrors].map((r) => ({
    kind: 'error',
    id: 'error-' + (r.tenant_slug || 'sa') + '-' + r.id,
    tenant_slug: r.tenant_slug,
    tenant_name: r.tenant_name,
    route: r.route,
    method: r.method,
    message: r.message,
    stack: r.stack,
    created_at: r.created_at,
    description: describeError(r),
  }));

  const businessEvents = tenantBusiness.map((r) => ({
    kind: 'business',
    id: 'business-' + r.tenant_slug + '-' + r.id,
    tenant_slug: r.tenant_slug,
    tenant_name: r.tenant_name,
    actor: r.actor,
    action: r.action,
    module_slug: r.module_slug,
    record_id: r.record_id,
    created_at: r.created_at,
    description: describeBusinessEvent(r),
  }));

  const merged = [...auditEvents, ...errorEvents, ...businessEvents]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, limit);
  // Risposta ora {rows, has_more} invece di un array nudo — l'UNICO chiamante è
  // ActivityPage.jsx, aggiornato nello stesso commit. has_more è un'euristica
  // (pagina piena = probabilmente ce n'è altra), non un conteggio totale reale:
  // in un merge cross-tenant via HTTP un totale vero richiederebbe interrogare
  // ogni tenant due volte, non ne vale il costo per un "carica altri".
  res.json({ rows: merged, has_more: merged.length >= limit });
});

module.exports = router;
