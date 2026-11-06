#!/usr/bin/env node
'use strict';
// Genera i PDF «Relazione processi» e «Guida all'uso» di zucca dai testi in docs/zucca/, con l'identità grafica
// comune ai PDF di Platform (core/backend/src/lib/documento-pdf.js).
// Uso: node scripts/genera-documenti-zucca.js <cartella-di-uscita> [file-logo.png]
const fs = require('fs');
const path = require('path');
const { creaPdf } = require('../core/backend/src/lib/documento-pdf');

const [,, uscita, logoPath] = process.argv;
if (!uscita) { console.error('Uso: node scripts/genera-documenti-zucca.js <cartella-di-uscita> [file-logo.png]'); process.exit(1); }
const azienda = { nome: 'ZuccàPartners', colore: '#16355B' }; // dal manuale del marchio dell'agenzia
const logo = logoPath ? fs.readFileSync(logoPath) : null;
const docs = [
  ['relazione-processi.txt', 'Relazione processi (stato al 6 novembre 2026)', 'Relazione', 'relazione-processi-zucca.pdf'],
  ['guida-all-uso.txt', 'Guida all\'uso di zucca', 'Guida', 'guida-all-uso-zucca.pdf'],
];
(async () => {
  fs.mkdirSync(uscita, { recursive: true });
  for (const [file, titolo, etichetta, out] of docs) {
    const corpo = fs.readFileSync(path.join(__dirname, '..', 'docs', 'zucca', file), 'utf8');
    const pdf = await creaPdf({ titolo, corpo, azienda, logo, etichetta, riquadroFirma: false, piePagina: titolo });
    fs.writeFileSync(path.join(uscita, out), pdf);
    console.log('creato', path.join(uscita, out), pdf.length + ' byte');
  }
})();
