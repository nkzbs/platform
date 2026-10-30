'use strict';
// TEST, 30/10/2026: lotto di prova (21 PDF) per capire costo e qualità reali
// prima di lanciare la lettura AI su tutti i ~440 documenti Bolletta/Ricevuta.
// Legge ogni PDF da Drive, chiede a Mistral importo/scadenza/fornitore (stessa
// strada di "Importa PDF"/ai-suggestions.js, chiamata diretta qui per non
// dover accendere la funzione "Importare" su Spese Casa/Personali solo per
// questo giro), propone l'abbinamento con una spesa candidata per importo+data
// — NON scrive nulla, solo log. Il campo relazione da riempire per davvero
// resta una scelta separata, dopo aver visto questi risultati.
const db = require('./db');

const DOC_IDS_TEST = [8337, 8338, 8339, 8340, 8341, 8343, 8344, 8347, 8348, 8349, 8350, 8351, 8352, 8353, 8354, 8355, 8356, 8357, 8358, 8359, 8360];

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

function candidati(importo) {
  if (!(importo > 0)) return [];
  const out = [];
  for (const slug of ['spese_casa', 'spese_personali']) {
    const righe = db.prepare('SELECT id, data FROM records WHERE module_slug = ?').all(slug);
    for (const r of righe) {
      let d; try { d = JSON.parse(r.data); } catch (e) { continue; }
      if (d.documento_collegato) continue; // già collegata
      const imp = Number(d.importo);
      if (!Number.isFinite(imp)) continue;
      if (Math.abs(imp - importo) < 0.01) out.push({ slug, id: r.id, descrizione: d.descrizione, importo: imp, data: d.data, scadenza: d.scadenza });
    }
  }
  return out;
}

async function run() {
  const { driveDownload, isDriveEnabled } = require('./routes/google-oauth');
  if (!isDriveEnabled()) { console.log('[one-off-match-test] Drive non collegato, salto'); return; }
  const righe = db.prepare('SELECT id, data FROM records WHERE module_slug = ? AND id IN (' + DOC_IDS_TEST.map(() => '?').join(',') + ')').all('documenti', ...DOC_IDS_TEST);
  console.log('[one-off-match-test] lotto di prova: ' + righe.length + ' documenti');
  for (const r of righe) {
    let d; try { d = JSON.parse(r.data); } catch (e) { continue; }
    const file = d.file;
    if (!file || !file.id) { console.log('[one-off-match-test] #' + r.id, d.titolo, '-> nessun file'); continue; }
    const up = db.prepare('SELECT stored_name FROM uploads WHERE id = ?').get(file.id);
    if (!up || !up.stored_name || !up.stored_name.startsWith('drive:')) { console.log('[one-off-match-test] #' + r.id, d.titolo, '-> non su Drive'); continue; }
    const driveId = up.stored_name.slice(6);
    try {
      const bytes = await driveDownload(driveId);
      const esito = await classifyPdf({ filename: file.name, bytes });
      if (esito.error) { console.log('[one-off-match-test] #' + r.id, d.titolo, '-> ERRORE:', esito.error); continue; }
      const p = esito.proposta || {};
      const cands = candidati(p.importo);
      console.log('[one-off-match-test] #' + r.id, '"' + d.titolo + '"',
        '-> importo=' + p.importo, 'scadenza=' + p.scadenza, 'fornitore=' + p.fornitore, 'confidenza=' + p.confidenza,
        '| candidate spesa: ' + (cands.length === 0 ? 'NESSUNA' : cands.length === 1 ? JSON.stringify(cands[0]) : cands.length + ' AMBIGUE: ' + JSON.stringify(cands)));
    } catch (e) {
      console.log('[one-off-match-test] #' + r.id, d.titolo, '-> ERRORE:', e.message);
    }
  }
  console.log('[one-off-match-test] FINE LOTTO DI PROVA');
}

module.exports = { run };
