'use strict';
// Testo dei PDF allegati a una bolletta, per aiutare l'assistente a capire di che bolletta si tratta (luce o gas?):
// il titolo dell'email dice spesso solo "Gas/Luce", il tipo vero sta nel PDF. Il testo si legge in locale (pdftotext) e verso
// Super Admin esce SOLO un estratto delle righe utili (importi, scadenze, consumi, tipo di fornitura) senza codici lunghi,
// insieme a un indizio calcolato qui. Non esce mai l'intero PDF.
const fs = require('fs');
const path = require('path');
const db = require('./db');
const { UPLOAD_DIR } = require('./lib/upload-storage');

const isPdf = (name, mime) => /pdf/i.test(mime || '') || /\.pdf$/i.test(name || '');

async function pdfText(buffer) {
  try { return String(await require('./bank-import').extractText(buffer) || ''); } catch (e) { return ''; }
}

// list: [{ bytes, filename, mimeType }] (allegati appena scaricati, ancora in memoria)
async function textFromBuffers(list, max = 2) {
  const out = [];
  for (const a of (list || []).filter((x) => isPdf(x.filename, x.mimeType)).slice(0, max)) out.push(await pdfText(a.bytes));
  return out.join('\n');
}

// Allegati PDF già salvati per un record (file locale o su Google Drive).
async function textForRecord(moduleSlug, recordId, max = 2) {
  const rows = db.prepare('SELECT u.original_name, u.stored_name, u.mime_type FROM record_attachments ra JOIN uploads u ON u.id = ra.upload_id WHERE ra.module_slug = ? AND ra.record_id = ?').all(moduleSlug, recordId)
    .filter((u) => isPdf(u.original_name, u.mime_type)).slice(0, max);
  const out = [];
  for (const u of rows) {
    try {
      const buf = u.stored_name.startsWith('drive:') ? await require('./routes/google-oauth').driveDownload(u.stored_name.slice(6)) : fs.readFileSync(path.join(UPLOAD_DIR, u.stored_name));
      out.push(await pdfText(buf));
    } catch (e) { /* allegato non leggibile: si va avanti senza */ }
  }
  return out.join('\n');
}

// 'luce' | 'gas' | 'entrambi' | null, contando segni inequivocabili nel testo (NON nel titolo, che dice "Gas/Luce").
function energyHint(text) {
  const t = String(text || '');
  const count = (re) => (t.match(re) || []).length;
  const luce = count(/\bkWh\b/gi) + count(/\bPOD\b/g) + count(/energia elettrica/gi) + count(/\bpotenza impegnata\b/gi) + count(/\bfascia F[123]\b/gi);
  const gas = count(/\bSmc\b/gi) + count(/\bPDR\b/g) + count(/gas naturale/gi) + count(/\bmetano\b/gi) + count(/\bcoefficiente C\b/gi);
  if (luce >= 2 && luce >= gas * 4) return 'luce';
  if (gas >= 2 && gas >= luce * 4) return 'gas';
  if (luce >= 2 && gas >= 2) return 'entrambi';
  return null;
}

// Righe utili, senza codici lunghi (POD, PDR, numeri di cliente, IBAN...), al massimo ~1500 caratteri.
function relevantExtract(text) {
  const KEEP = /(totale|importo|scadenza|da pagare|entro il|rata unica|kwh|smc|\bmc\b|fornitura|energia|gas|luce|consumo|periodo|bolletta)/i;
  const lines = String(text || '').split('\n').map((l) => l.replace(/\b[A-Z0-9]{12,}\b/g, ' ').replace(/\s+/g, ' ').trim()).filter((l) => l.length > 3 && KEEP.test(l));
  return [...new Set(lines)].join(' | ').slice(0, 1500);
}

module.exports = { textFromBuffers, textForRecord, energyHint, relevantExtract };
