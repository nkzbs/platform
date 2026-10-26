'use strict';
// Chiusura di un gap reale (26/10/2026, docs/DECISIONI.md): tenant-ai.js e
// registry.js (le uniche due rotte dove un tenant_slug dichiarato dal
// chiamante determina QUALE dato leggere/scrivere — chiave AI, budget,
// proposte modulo) erano protette solo dal segreto interno CONDIVISO: ogni
// tenant lo conosce, quindi ogni tenant poteva dichiarare lo slug di un
// altro e leggerne/consumarne i dati. roles.js/audit.js/module-stats.js
// restano fuori apposta: lì è Super Admin a scegliere il tenant per nome
// container, non il chiamante — niente identità da falsificare.
//
// Stesso principio già in produzione per l'export/"distacco" e gli inviti
// (tenant-export.js/tenant-invite.js, requireTenantToken): il tenant firma
// con il PROPRIO jwt_secret (mai il segreto condiviso), Super Admin verifica
// contro il jwt_secret di quello specifico tenant. Qui lo slug candidato
// arriva dal payload del token stesso (non da un :slug nell'URL, queste
// rotte non ne hanno uno) — innocuo: nessuna fiducia viene concessa finché
// jwt.verify non passa contro il segreto di QUEL tenant, mai prima.
//
// Finestra di transizione: accetta ANCHE il vecchio segreto condiviso
// (x-internal-secret) finché non tutti i tenant sono stati ridistribuiti col
// nuovo codice — ogni uso del ramo vecchio è loggato in audit_log
// (internal.auth.legacy_secret) per sapere quando è sicuro rimuoverlo (vedi
// piano in docs/DECISIONI.md, passo esplicitamente separato da stasera).
const jwt = require('jsonwebtoken');
const db = require('../db');
const { isInternalSecret } = require('../../../../shared/internal-secret.js');
const { logAudit } = require('../audit-log');

function verifyTenantJWT(raw, purposes) {
  const unsafe = jwt.decode(raw) || {};
  if (!unsafe.slug) return null;
  const tenant = db.prepare("SELECT * FROM tenants WHERE slug = ? AND status != 'deleted'").get(unsafe.slug);
  if (!tenant || !tenant.jwt_secret) return null;
  try {
    const p = jwt.verify(raw, tenant.jwt_secret, { algorithms: ['HS256'] });
    if (p.slug !== tenant.slug || !purposes.includes(p.purpose)) return null;
    return tenant;
  } catch (e) { return null; }
}

// purposes: array di 'purpose' JWT accettati per questa rotta (es. ['tenant-ai']).
// slugParam(req): legge lo slug DICHIARATO dal chiamante (per il confronto col
// token sul ramo nuovo, e come unica fonte sul ramo legacy) — tipicamente
// (req) => req.body.tenant_slug || req.query.tenant_slug.
function requireTenantOrSharedSecret(purposes, slugParam) {
  return (req, res, next) => {
    const raw = (req.headers.authorization || '').replace(/^Bearer /, '');
    if (raw) {
      const tenant = verifyTenantJWT(raw, purposes);
      if (!tenant) return res.status(401).json({ error: 'Token non valido' });
      const claimed = slugParam(req);
      if (claimed && claimed !== tenant.slug) return res.status(403).json({ error: 'tenant_slug non corrisponde al token' });
      req.tenant = tenant;
      req.tenantSlug = tenant.slug;
      req.tenantAuthMethod = 'jwt';
      return next();
    }
    if (isInternalSecret(req.headers['x-internal-secret'])) {
      req.tenantSlug = slugParam(req) || null;
      req.tenantAuthMethod = 'shared-secret';
      logAudit('tenant:' + (req.tenantSlug || '?'), 'internal.auth.legacy_secret', req.tenantSlug, { path: req.path });
      return next();
    }
    return res.status(401).json({ error: 'Secret interno non valido' });
  };
}

module.exports = { requireTenantOrSharedSecret };
