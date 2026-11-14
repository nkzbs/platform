'use strict';
// Archivio dei MODELLI PDF compilabili del tenant (il modulo originale dell'azienda, con i suoi campi) e la loro mappa dei campi.
// Un documento da modello con `pdf_modello: '<chiave>'` usa il modello PDF al posto del testo impaginato dal sistema (vedi lib/modulo-pdf.js).
// I modelli arrivano dai pacchetti di verticale (super-admin) tramite PUT /api/modelli-pdf/:chiave. Nessun nome di azienda o di modulo qui.
const db = require('../db');
const mp = require('./modulo-pdf');

db.exec(`CREATE TABLE IF NOT EXISTS modelli_pdf (
  chiave TEXT PRIMARY KEY,
  titolo TEXT NOT NULL,
  pdf BLOB NOT NULL,
  mappa TEXT NOT NULL,
  aggiornato_il TEXT NOT NULL DEFAULT (datetime('now'))
)`);

const CHIAVE = /^[a-z0-9][a-z0-9_-]{1,60}$/;
const MAX_BYTE = 6 * 1024 * 1024;

async function salva({ chiave, titolo, pdf, mappa }) {
  if (!CHIAVE.test(String(chiave || ''))) throw Object.assign(new Error('Chiave del modello non valida (minuscole, numeri, - e _).'), { status: 400 });
  if (!Buffer.isBuffer(pdf) || !pdf.length || pdf.length > MAX_BYTE) throw Object.assign(new Error('Il PDF manca o supera 6 MB.'), { status: 400 });
  if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') throw Object.assign(new Error('Il file non è un PDF.'), { status: 400 });
  if (!mappa || !Array.isArray(mappa.campi)) throw Object.assign(new Error('Manca la mappa dei campi.'), { status: 400 });
  const { PDFDocument } = require('pdf-lib');
  const nomi = new Set((await PDFDocument.load(pdf)).getForm().getFields().map((f) => f.getName()));
  const mancanti = mappa.campi.filter((c) => !nomi.has(c.campo)).map((c) => c.campo);
  if (mancanti.length) throw Object.assign(new Error('La mappa cita campi che il PDF non ha: ' + mancanti.slice(0, 5).join(', ') + '.'), { status: 400 });
  db.prepare("INSERT INTO modelli_pdf (chiave, titolo, pdf, mappa, aggiornato_il) VALUES (?, ?, ?, ?, datetime('now')) ON CONFLICT(chiave) DO UPDATE SET titolo = excluded.titolo, pdf = excluded.pdf, mappa = excluded.mappa, aggiornato_il = excluded.aggiornato_il")
    .run(chiave, String(titolo || chiave).slice(0, 120), pdf, JSON.stringify(mappa));
  return { chiave, campi: mappa.campi.length };
}

function carica(chiave) {
  const r = db.prepare('SELECT * FROM modelli_pdf WHERE chiave = ?').get(chiave);
  return r ? { chiave: r.chiave, titolo: r.titolo, buffer: r.pdf, mappa: JSON.parse(r.mappa) } : null;
}
const elenco = () => db.prepare('SELECT chiave, titolo, length(pdf) AS byte, aggiornato_il FROM modelli_pdf ORDER BY chiave').all();

// Il modello compilato con i dati di un record: { buffer, campi } (campi = foglio compilato da conservare con la richiesta di firma).
async function compilaPer(chiave, get, { appiattisci = false } = {}) {
  const m = carica(chiave);
  if (!m) throw Object.assign(new Error('Il modello PDF «' + chiave + '» non è installato.'), { status: 404 });
  const campi = mp.risolvi({ mappa: m.mappa, get });
  return { buffer: await mp.applica({ buffer: m.buffer, campi, appiattisci }), campi };
}
// Il modello con un foglio già compilato (quello conservato nella richiesta).
async function dalFoglio(chiave, campi, { appiattisci = false } = {}) {
  const m = carica(chiave);
  if (!m) throw Object.assign(new Error('Il modello PDF «' + chiave + '» non è installato.'), { status: 404 });
  return mp.applica({ buffer: m.buffer, campi, appiattisci });
}

module.exports = { salva, carica, elenco, compilaPer, dalFoglio };
