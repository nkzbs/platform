'use strict';
// Chiavi Mistral, tre livelli distinti:
//  • la chiave di ogni TENANT (Finance, ...): inserita dalle sue impostazioni e conservata QUI, cifrata (le API restituiscono solo «configurata» e le ultime 4 cifre);
//  • la chiave di SUPER ADMIN: sua e basta (costruire tenant, analisi dei processi...), inserita da Impostazioni → Chiavi AI, cifrata. Non la usa mai un tenant;
//  • la chiave GENERALE (MISTRAL_API_KEY dell'ambiente): ripiego dei tenant senza chiave propria, se l'interruttore «ripiego» è acceso (di partenza sì), e di
//    Super Admin se non ha una chiave sua. Spegnendo il ripiego, un tenant senza chiave sua non ha AI.
const db = require('../db');
const { encrypt, decrypt } = require('../crypto-secrets');

const ADMIN_SLUG = '__super_admin__'; // riga riservata di tenant_ai_keys per la chiave di Super Admin (non è un tenant)

db.exec('CREATE TABLE IF NOT EXISTS ai_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
function fallbackOn() { const r = db.prepare("SELECT value FROM ai_settings WHERE key = 'tenant_fallback'").get(); return !r || r.value !== '0'; }
function setFallback(on) { db.prepare("INSERT INTO ai_settings (key, value) VALUES ('tenant_fallback', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(on ? '1' : '0'); return fallbackOn(); }

function getTenantKey(slug) {
  if (!slug) return null;
  const row = db.prepare('SELECT mistral_key FROM tenant_ai_keys WHERE tenant_slug = ?').get(slug);
  if (!row) return null;
  const k = decrypt(row.mistral_key);
  return k && !k.startsWith('[errore') ? k : null;
}

// La chiave da usare per le chiamate di questo tenant (o per Super Admin se slug è vuoto).
function keyFor(slug) {
  if (!slug) return getTenantKey(ADMIN_SLUG) || process.env.MISTRAL_API_KEY || null; // Super Admin: la sua, poi la generale
  return getTenantKey(slug) || (fallbackOn() ? process.env.MISTRAL_API_KEY || null : null);
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
  if (process.env.MISTRAL_API_KEY && fallbackOn()) return { configured: true, source: 'generale', hint: null };
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

// La chiave di Super Admin: { configured, source: 'admin' | 'generale' | null, hint }.
function adminKeyStatus() {
  const own = getTenantKey(ADMIN_SLUG);
  if (own) return { configured: true, source: 'admin', hint: '…' + own.slice(-4) };
  if (process.env.MISTRAL_API_KEY) return { configured: true, source: 'generale', hint: null };
  return { configured: false, source: null, hint: null };
}
const setAdminKey = (key) => setTenantKey(ADMIN_SLUG, key);
const clearAdminKey = () => clearTenantKey(ADMIN_SLUG);
// Quadro delle chiavi, senza mai mostrarne una: quella di Super Admin, il ripiego e quanti tenant hanno la propria.
function overview() {
  return {
    admin: adminKeyStatus(),
    generale_presente: !!process.env.MISTRAL_API_KEY,
    ripiego_tenant: fallbackOn(),
    tenant_con_chiave_propria: db.prepare('SELECT tenant_slug FROM tenant_ai_keys WHERE tenant_slug != ?').all(ADMIN_SLUG).map((r) => r.tenant_slug),
  };
}

module.exports = { keyFor, getTenantKey, setTenantKey, clearTenantKey, keyStatus, validateMistralKey, adminKeyStatus, setAdminKey, clearAdminKey, fallbackOn, setFallback, overview, ADMIN_SLUG };
