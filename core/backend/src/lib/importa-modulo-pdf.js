'use strict';
// «Importa da modulo PDF»: l'agente carica il modulo originale dell'agenzia (compilato al computer o a mano e scansionato in digitale con campi)
// e il sistema propone i dati da inserire nella scheda. È l'inverso di lib/modelli-pdf.compilaPer: usa la STESSA mappa, quindi un campo
// che si stampa nel modulo è anche un campo che si rilegge. Non scrive mai niente: ritorna la proposta, la conferma e il salvataggio
// passano dalla creazione normale del record (stesse validazioni, stessi permessi).
//
// Nessun nome di modulo o di campo qui: i modelli candidati sono quelli dei documenti (`document_actions` con `pdf_modello`) del modulo.

const { PDFDocument } = require('pdf-lib');
const modulo = require('./modulo-pdf');
const modelli = require('./modelli-pdf');

const norma = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// I modelli PDF collegati ai documenti del modulo, senza doppioni: [{ chiave, titolo }]
function modelliDelModulo(schema) {
  const visti = new Set(), out = [];
  for (const a of (schema && schema.document_actions) || []) {
    if (!a.pdf_modello || visti.has(a.pdf_modello)) continue;
    visti.add(a.pdf_modello);
    const m = modelli.carica(a.pdf_modello);
    if (m) out.push({ chiave: a.pdf_modello, titolo: a.label || a.pdf_modello, mappa: m.mappa });
  }
  return out;
}

// Quale modello è il PDF caricato: quello i cui campi (secondo la mappa) esistono di più nel PDF. Sotto la metà: nessuno.
async function riconosci(buffer, candidati) {
  const pdf = await PDFDocument.load(buffer);
  const presenti = new Set(pdf.getForm().getFields().map((f) => f.getName()));
  let migliore = null;
  for (const c of candidati) {
    const campi = (c.mappa && c.mappa.campi) || [];
    if (!campi.length) continue;
    const quota = campi.filter((x) => presenti.has(x.campo)).length / campi.length;
    if (quota >= 0.5 && (!migliore || quota > migliore.quota)) migliore = { ...c, quota };
  }
  return migliore;
}

const numero = (v) => {
  const t = String(v).replace(/[^\d,.\-]/g, '');
  const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
  return Number.isFinite(n) ? n : undefined;
};

// Un valore letto dal PDF → il valore del campo del sistema, o undefined se non ci sta (tipo, opzioni).
function conforma(campo, grezzo) {
  const voci = Array.isArray(grezzo) ? grezzo : [grezzo];
  const opzioni = Array.isArray(campo.options) ? campo.options : null;
  const trova = (v) => (opzioni ? opzioni.find((o) => norma(o) === norma(v)) : v);
  switch (campo.type) {
    case 'checkbox': return voci.some((v) => ['si', 'true', '1', 'yes'].includes(norma(v))) ? true : undefined;
    case 'number': case 'currency': case 'percent': return numero(voci[0]);
    case 'date': return /^\d{4}-\d{2}-\d{2}$/.test(String(voci[0])) ? String(voci[0]) : undefined;
    case 'select': { if (voci.length !== 1) return undefined; return trova(voci[0]); } // più caselle spuntate dove ne serve una: ambiguo, non si indovina
    case 'multiselect': { const ok = voci.map(trova).filter((x) => x !== undefined); return ok.length ? ok : undefined; }
    default: return String(voci[0]).trim() || undefined;
  }
}

// La proposta: { modello: {chiave,titolo}, campi: [{key,label,valore}], non_collegati: [{voce,valore,motivo}] }.
// Non collegati = voci del modulo che il sistema non può mettere nella scheda (di un'altra scheda collegata, con un valore che non è tra le opzioni…): si vedono, non si scrivono.
async function proponi({ schema, buffer, chiave }) {
  const candidati = modelliDelModulo(schema);
  if (!candidati.length) throw Object.assign(new Error('Questo modulo non ha moduli PDF originali da importare.'), { status: 400 });
  if (buffer.subarray(0, 5).toString('latin1') !== '%PDF-') throw Object.assign(new Error('Il file non è un PDF.'), { status: 400 });
  let scelto;
  try { scelto = chiave ? candidati.find((c) => c.chiave === chiave) && await riconosci(buffer, candidati.filter((c) => c.chiave === chiave)) : await riconosci(buffer, candidati); }
  catch (e) { throw Object.assign(new Error('Non riesco a leggere questo PDF.'), { status: 400 }); }
  if (!scelto) throw Object.assign(new Error('Questo PDF non è nessuno dei moduli dell\'agenzia (' + candidati.map((c) => c.titolo).join(', ') + '), oppure non ha i campi compilabili.'), { status: 422 });
  const ambigue = {}; // chiave → elenchi di valori che una casella spuntata copre tutti insieme (es. «Coniugato/a o Unito/a civilmente»)
  const letti = await modulo.leggi({ buffer, mappa: scelto.mappa }, { ambigue });
  const campiDef = new Map((schema.fields || []).filter((f) => !f.sola_lettura && f.type !== 'computed').map((f) => [f.key, f]));
  const campi = [], nonCollegati = [];
  for (const [voce, grezzo] of Object.entries(letti)) {
    const def = campiDef.get(voce);
    if (!def) { nonCollegati.push({ voce, valore: Array.isArray(grezzo) ? grezzo.join(', ') : String(grezzo), motivo: voce.includes('.') ? 'è di un\'altra scheda collegata' : 'non è un campo di questa scheda' }); continue; }
    const valore = conforma(def, grezzo);
    if (valore === undefined) { nonCollegati.push({ voce: def.label || voce, valore: Array.isArray(grezzo) ? grezzo.join(', ') : String(grezzo), motivo: 'non corrisponde alle scelte del campo' }); continue; }
    campi.push({ key: voce, label: def.label || voce, valore });
  }
  for (const [chiave2, gruppi] of Object.entries(ambigue)) {
    const def = campiDef.get(chiave2); if (!def) continue;
    nonCollegati.push({ voce: def.label || chiave2, valore: gruppi.map((g) => g.join(' / ')).join('; '), motivo: 'la casella spuntata copre più scelte: sceglila a mano' });
  }
  return { modello: { chiave: scelto.chiave, titolo: scelto.titolo }, campi, non_collegati: nonCollegati };
}

module.exports = { proponi, modelliDelModulo, conforma, riconosci };
