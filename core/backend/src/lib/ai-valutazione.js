'use strict';
// "Considerazioni del valutatore" in calce al report di valutazione Immobili — stesso
// meccanismo di report-ai.js (explain): Super Admin ripulisce, verifica ogni numero contro
// i dati forniti e scarta il testo se ne trova uno non presente. Best-effort: se l'AI non è
// configurata o la chiamata fallisce, la valutazione resta comunque valida senza il paragrafo.
const { internalSecret } = require('../../../shared/internal-secret.js');
const { signTenantRequest } = require('./tenant-request-token');

const SUPER_ADMIN_URL = process.env.SUPER_ADMIN_URL || 'http://super-admin-backend:3000';
const INTERNAL_SECRET = internalSecret();

async function considerazioni(data) {
  try {
    const res = await fetch(SUPER_ADMIN_URL + '/api/tenant-ai/explain-valuation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_SECRET, 'Authorization': 'Bearer ' + signTenantRequest('tenant-ai') },
      body: JSON.stringify({ tenant_slug: process.env.TENANT_SLUG, data }),
      signal: AbortSignal.timeout(20000),
    });
    const body = await res.json().catch(() => ({}));
    return (res.ok && body.text) ? body.text : null;
  } catch (e) {
    return null;
  }
}

module.exports = { considerazioni };
