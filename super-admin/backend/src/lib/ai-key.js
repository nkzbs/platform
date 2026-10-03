'use strict';
// Chiave Mistral per tenant. Ogni tenant (Finance, ...) può avere la sua, inserita dalle sue
// impostazioni e conservata QUI, cifrata: non esce mai più da Super Admin (le API restituiscono
// solo "configurata" e le ultime 4 cifre). Un tenant senza chiave sua usa quella generale
// (MISTRAL_API_KEY dell'ambiente), se c'è.
const db = require('../db');
const { encrypt, decrypt } = require('../crypto-secrets');

function getTenantKey(slug) {
  if (!slug) return null;
  const row = db.prepare('SELECT mistral_key FROM tenant_ai_keys WHERE tenant_slug = ?').get(slug);
  if (!row) return null;
  const k = decrypt(row.mistral_key);
  return k && !k.startsWith('[errore') ? k : null;
}

// La chiave da usare per le chiamate di questo tenant (o per Super Admin se slug è vuoto).
function keyFor(slug) {
  return getTenantKey(slug) || process.env.MISTRAL_API_KEY || null;
}

function setTenantKey(slug, key) {
  db.prepare("INSERT INTO tenant_ai_keys (tenant_slug, mistral_key, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(tenant_slug) DO UPDATE SET mistral_key = excluded.mistral_key, updated_at = CURRENT_TIMESTAMP").run(slug, encrypt(key));
}

function clearTenantKey(slug) {
  return db.prepare('DELETE FROM tenant_ai_keys WHERE tenant_slug = ?').run(slug).changes > 0;
}

// { configured, source: 'tenant' | 'generale' | null, hint: '…1234' | null }
function keyStatus(slug) {
  const own = getTenantKey(slug);
  if (own) return { configured: true, source: 'tenant', hint: '…' + own.slice(-4) };
  if (process.env.MISTRAL_API_KEY) return { configured: true, source: 'generale', hint: null };
  return { configured: false, source: null, hint: null };
}

// Controlla la chiave con l'elenco dei modelli: non costa nulla e non consuma token.
// Ritorna { ok: true } oppure { ok: false, reason }.
async function validateMistralKey(key) {
  try {
    const res = await fetch('https://api.mistral.ai/v1/models', { headers: { Authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(10000) });
    if (res.status === 401 || res.status === 403) return { ok: false, reason: 'Mistral non riconosce questa chiave.' };
    if (!res.ok) return { ok: false, reason: 'Mistral ha risposto con un errore (' + res.status + '): riprova tra poco.' };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: 'Non riesco a raggiungere Mistral per controllare la chiave.' };
  }
}

module.exports = { keyFor, getTenantKey, setTenantKey, clearTenantKey, keyStatus, validateMistralKey };
