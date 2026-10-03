'use strict';
// Commento e spiegazione dei report con l'assistente AI. Dal tenant escono SOLO totali per
// gruppo (le categorie del report), mai le singole righe; Super Admin ripulisce, ferma tutto
// al tetto di spesa e restituisce il testo solo se ogni numero scritto esiste nei dati.
const db = require('./db');

const SUPER_ADMIN_URL = process.env.SUPER_ADMIN_URL || 'http://super-admin-backend:3000';
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET || 'changeme_internal';

function isEnabled() {
  const row = db.prepare('SELECT ai_report_enabled FROM tenant_settings WHERE id = 1').get();
  return !!(row && row.ai_report_enabled);
}

function setEnabled(on) {
  db.prepare('UPDATE tenant_settings SET ai_report_enabled = ? WHERE id = 1').run(on ? 1 : 0);
}

// modo: 'commento' (una frase, per WhatsApp) | 'spiegazione' (qualche riga, per la pagina).
// Ritorna { text } oppure { error, status, code }. Non lancia mai.
async function explain(modo, data) {
  try {
    const res = await fetch(SUPER_ADMIN_URL + '/api/tenant-ai/explain-report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_SECRET },
      body: JSON.stringify({ tenant_slug: process.env.TENANT_SLUG, modo, data }),
      signal: AbortSignal.timeout(30000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.text) return { error: body.error || 'Assistente non disponibile', status: res.status || 502, code: body.code };
    return { text: body.text };
  } catch (e) {
    return { error: 'Assistente non raggiungibile', status: 502 };
  }
}

// Totali per gruppo (con confronto col periodo precedente) da righe già filtrate per data.
function gruppiDaRighe(righe, righePrec, campoGruppo, campoImporto) {
  const somma = (rows) => {
    const out = {};
    for (const d of rows) { const k = d[campoGruppo] || 'Altro'; out[k] = (out[k] || 0) + (parseFloat(d[campoImporto]) || 0); }
    return out;
  };
  const cur = somma(righe), prec = somma(righePrec || []);
  const hasPrec = (righePrec || []).length > 0;
  return Object.entries(cur).sort((a, b) => b[1] - a[1]).map(([nome, valore]) => {
    const g = { nome, valore: Math.round(valore * 100) / 100 };
    if (hasPrec) g.confronto = Math.round((prec[nome] || 0) * 100) / 100;
    return g;
  });
}

module.exports = { isEnabled, setEnabled, explain, gruppiDaRighe };
