'use strict';
// Lettura busta paga via AI: da un PDF propone periodo, lordo, netto, ore pagate e trattenute
// (potenziamento "payslip" del modulo, module-ai.js). L'AI PROPONE, non scrive: la riga nasce solo
// dopo la conferma di chi l'ha caricata (route /ai/payslip/:slug/crea). Il tenant non parla mai
// con Mistral: chiede a Super Admin, che toglie i dati personali e controlla l'output.
const SUPER_ADMIN_URL = process.env.SUPER_ADMIN_URL || 'http://super-admin-backend:3000';
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET || 'changeme_internal';
const moduleAi = require('./module-ai');

async function proposeFromPayslip({ moduleSlug, filename, bytes }) {
  if (!moduleAi.can(moduleSlug, 'payslip')) return { error: 'La lettura della busta paga non è accesa su questo modulo.', status: 403 };
  const att = require('./attachment-text');
  const pdf = await att.textFromBuffers([{ bytes, filename, mimeType: 'application/pdf' }]);
  if (!pdf || pdf.trim().length < 20) return { error: 'Non riesco a leggere il testo di questo PDF (forse è una scansione).', status: 422 };
  try {
    const res = await fetch(SUPER_ADMIN_URL + '/api/tenant-ai/payslip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_SECRET },
      body: JSON.stringify({ tenant_slug: process.env.TENANT_SLUG, data: { testo: pdf.slice(0, 4000) } }),
      signal: AbortSignal.timeout(30000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { error: body.error || 'Assistente non disponibile', status: res.status, code: body.code };
    return { proposta: body.suggestion };
  } catch (e) {
    return { error: 'Assistente non raggiungibile', status: 502 };
  }
}

module.exports = { proposeFromPayslip };
