'use strict';
// Una tantum, 30/10/2026: dopo il lotto di prova (21 documenti, vedi
// one-off-2026-10-30-match-test.js — l'abbinamento automatico per importo si
// è rivelato troppo ambiguo per fidarsene alla cieca), questo legge con l'AI
// TUTTI i documenti Bolletta/Ricevuta di pagamento rimasti e scrive una riga
// di proposta in `match_proposals` (db.js) — non collega nulla da solo, la
// revisione è a mano (routes/receipt-match.js + pagina Rivedi collegamenti).
// Idempotente: salta un documento già presente in match_proposals.
const db = require('./db');

async function classifyPdf({ filename, bytes }) {
  const att = require('./attachment-text');
  const pdf = await att.textFromBuffers([{ bytes, filename, mimeType: 'application/pdf' }]);
  if (!pdf || pdf.trim().length < 20) return { error: 'testo illeggibile (forse una scansione)' };
  const { internalSecret } = require('../../../shared/internal-secret.js');
  const { signTenantRequest } = require('./lib/tenant-request-token');
  const SUPER_ADMIN_URL = process.env.SUPER_ADMIN_URL || 'http://super-admin-backend:3000';
  const res = await fetch(SUPER_ADMIN_URL + '/api/tenant-ai/classify-bill', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-secret': internalSecret(), 'Authorization': 'Bearer ' + signTenantRequest('tenant-ai') },
    body: JSON.stringify({
      tenant_slug: process.env.TENANT_SLUG,
      data: {
        mittente: '', oggetto: String(filename || '').replace(/\.pdf$/i, '').slice(0, 120), testo: '',
        rilevato: { importo: null, scadenza: null }, modulo_attuale: 'documenti',
        moduli: { documenti: { categorie: [] } },
        allegati: att.relevantExtract(pdf) || undefined, indizio_energia: att.energyHint(pdf),
      },
    }),
    signal: AbortSignal.timeout(30000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { error: body.error || ('HTTP ' + res.status) };
  return { proposta: body.suggestion };
}

async function run() {
  const { driveDownload, isDriveEnabled } = require('./routes/google-oauth');
  const mod = db.prepare("SELECT 1 FROM modules WHERE slug = 'documenti' AND installed = 1").get();
  if (!mod) return;
  const righe = db.prepare("SELECT id, data FROM records WHERE module_slug = 'documenti'").all()
    .filter((r) => { try { const d = JSON.parse(r.data); return d.tipo === 'Bolletta' || d.tipo === 'Ricevuta di pagamento'; } catch (e) { return false; } });
  const giaFatti = new Set(db.prepare("SELECT source_id FROM match_proposals WHERE source_slug = 'documenti'").all().map((r) => r.source_id));
  const daFare = righe.filter((r) => !giaFatti.has(r.id));
  if (!daFare.length) return;
  console.log('[one-off-fill-match] ' + daFare.length + ' documenti da processare');
  const ins = db.prepare('INSERT INTO match_proposals (source_slug, source_id, proposta_json) VALUES (?, ?, ?)');
  let fatti = 0, errori = 0;
  for (const r of daFare) {
    let d; try { d = JSON.parse(r.data); } catch (e) { continue; }
    const file = d.file;
    let proposta;
    if (!file || !file.id) { proposta = { error: 'nessun file' }; }
    else {
      const up = db.prepare('SELECT stored_name FROM uploads WHERE id = ?').get(file.id);
      if (!up || !up.stored_name) { proposta = { error: 'file non trovato' }; }
      else if (!/\.pdf$/i.test(file.name || '')) { proposta = { error: 'tipo file non supportato per la lettura automatica (solo PDF, per ora)' }; }
      else {
        try {
          const bytes = up.stored_name.startsWith('drive:')
            ? await driveDownload(up.stored_name.slice(6))
            : require('fs').readFileSync(require('path').join(require('./lib/upload-storage').UPLOAD_DIR, up.stored_name));
          const esito = await classifyPdf({ filename: file.name, bytes });
          proposta = esito.error ? { error: esito.error } : esito.proposta;
        } catch (e) { proposta = { error: e.message }; errori++; }
      }
    }
    try {
      ins.run('documenti', r.id, JSON.stringify(proposta));
      fatti++;
    } catch (e) { console.error('[one-off-fill-match] #' + r.id, 'non salvato:', e.message); }
  }
  console.log('[one-off-fill-match] fatti ' + fatti + ' (di cui ' + errori + ' con errore)');
}

module.exports = { run };
