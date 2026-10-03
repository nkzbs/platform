'use strict';
// La chiave Mistral di questo tenant. Si inserisce da Impostazioni → Assistente AI e viene
// conservata da Super Admin (cifrata): il tenant non la tiene e non la rilegge mai, ne vede
// solo lo stato ("configurata", ultime 4 cifre).
const SUPER_ADMIN_URL = process.env.SUPER_ADMIN_URL || 'http://super-admin-backend:3000';
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET || 'changeme_internal';

async function call(method, pathAndQuery, body) {
  try {
    const res = await fetch(SUPER_ADMIN_URL + '/api/tenant-ai' + pathAndQuery, {
      method,
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_SECRET },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 502, data: { error: 'Super Admin non raggiungibile' } };
  }
}

const slug = () => encodeURIComponent(process.env.TENANT_SLUG || '');

// { configured, source: 'tenant' | 'generale' | null, hint } oppure null se Super Admin non risponde.
async function status() {
  const r = await call('GET', '/key?tenant_slug=' + slug());
  return r.ok ? r.data : null;
}
const setKey = (key) => call('PUT', '/key', { tenant_slug: process.env.TENANT_SLUG, key });
const clearKey = () => call('DELETE', '/key?tenant_slug=' + slug());

module.exports = { status, setKey, clearKey };
