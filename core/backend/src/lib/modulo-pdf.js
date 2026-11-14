'use strict';
// Modulo PDF compilabile: prende un PDF con campi (AcroForm) disegnato dall'azienda e lo compila con i dati del record, così il documento
// da firmare è IL modulo originale, non una copia ridisegnata. Nessun nome di modulo o di campo qui: la `mappa` dice quale campo del PDF
// riceve cosa, con la stessa sintassi dei documenti da modello (lib/modello-documento.js).
//
// mappa = { campi: [ { campo, testo }, { campo, chiave, valore } ] }
//   { campo, testo }           campo di testo: `testo` è un modello ({{campo}}, {{relazione.campo}}, {{@azienda}}, {{@oggi}}, filtri come |vuoto)
//   { campo, chiave, valore }  casella: spuntata se il campo `chiave` vale `valore` (o, se è un elenco, lo contiene).
//                              `valore` speciale: '@pieno' (il campo ha un valore) / '@vuoto' (non ce l'ha)
// I campi del PDF che la mappa non cita restano vuoti e compilabili a mano.

const { PDFDocument, StandardFonts } = require('pdf-lib');
const { renderModello } = require('./modello-documento');

const norma = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const pieno = (v) => !(v == null || v === '' || v === false || (Array.isArray(v) && v.length === 0));

// Vero se il valore `v` del record corrisponde al `valore` atteso della casella.
function corrisponde(v, atteso) {
  if (atteso === '@pieno') return pieno(v);
  if (atteso === '@vuoto') return !pieno(v);
  if (v === true) return norma(atteso) === 'si';
  if (v === false) return norma(atteso) === 'no';
  const voci = Array.isArray(v) ? v : String(v == null ? '' : v).split(/\s*,\s*/);
  return voci.some((x) => norma(x) === norma(atteso));
}

// Risolve la mappa sui dati del record: elenco di { campo, testo } e { campo, spunta }. È il «foglio compilato» che si conserva con la richiesta di firma:
// chi firma vede esattamente ciò che gli è stato mandato, anche se la scheda cambia dopo.
function risolvi({ mappa, get }) {
  const out = [];
  for (const c of (mappa && mappa.campi) || []) {
    if (c.testo !== undefined) {
      const t = renderModello(c.testo, get).replace(/\s+/g, ' ').trim().replace(/[^\x20-\xFF]/g, '-'); // Helvetica standard: solo Latin-1
      if (t) out.push({ campo: c.campo, testo: t });
    } else if (c.chiave) out.push({ campo: c.campo, spunta: corrisponde(get(c.chiave), c.valore) });
  }
  return out;
}

// Scrive i valori risolti nel PDF e ritorna un Buffer. `appiattisci`: toglie i campi e lascia solo il testo stampato (serve prima di unire più
// moduli in un PDF da firmare); senza, il PDF resta compilabile a mano.
async function applica({ buffer, campi, appiattisci = false }) {
  const pdf = await PDFDocument.load(buffer);
  const form = pdf.getForm();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const c of campi || []) {
    let campo;
    try { campo = form.getField(c.campo); } catch (e) { continue; } // un campo tolto dal PDF non rompe l'invio
    if (c.testo !== undefined && typeof campo.setText === 'function') campo.setText(c.testo);
    else if (c.spunta !== undefined && typeof campo.check === 'function') { if (c.spunta) campo.check(); else campo.uncheck(); }
  }
  form.updateFieldAppearances(font);
  if (appiattisci) form.flatten();
  return Buffer.from(await pdf.save());
}

const compila = ({ buffer, mappa, get, appiattisci = false }) => applica({ buffer, campi: risolvi({ mappa, get }), appiattisci });

// Legge un modulo compilato al computer e riporta i valori delle voci che la mappa sa collegare a un campo del record:
// { campo_del_record: valore }. Solo i modelli semplici ({{campo}}) e le caselle spuntate si possono rileggere.
async function leggi({ buffer, mappa }) {
  const pdf = await PDFDocument.load(buffer);
  const form = pdf.getForm();
  const out = {};
  for (const c of (mappa && mappa.campi) || []) {
    let campo;
    try { campo = form.getField(c.campo); } catch (e) { continue; }
    if (c.testo !== undefined && typeof campo.getText === 'function') {
      const m = /^\{\{\s*([^}|\s]+)\s*(?:\|\s*vuoto\s*)?\}\}$/.exec(c.testo.trim());
      const v = (campo.getText() || '').trim();
      if (m && v) out[m[1]] = v;
    } else if (c.chiave && typeof campo.isChecked === 'function' && campo.isChecked() && !String(c.valore).startsWith('@')) {
      out[c.chiave] = Array.isArray(out[c.chiave]) ? [...out[c.chiave], c.valore] : out[c.chiave] !== undefined ? [out[c.chiave], c.valore] : c.valore;
    }
  }
  return out;
}

// Unisce più PDF (già appiattiti) in uno solo, nell'ordine dato. → Buffer
async function unisci(buffers) {
  const out = await PDFDocument.create();
  for (const b of buffers) {
    const src = await PDFDocument.load(b);
    for (const p of await out.copyPages(src, src.getPageIndices())) out.addPage(p);
  }
  return Buffer.from(await out.save());
}

const contaPagine = async (buffer) => (await PDFDocument.load(buffer)).getPageCount();

module.exports = { risolvi, applica, compila, leggi, unisci, contaPagine, corrisponde };
