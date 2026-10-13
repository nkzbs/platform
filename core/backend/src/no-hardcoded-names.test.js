'use strict';
// Guardia dello spirito di Platform: nel codice del nucleo NON ci sono nomi di moduli, campi o categorie di un progetto (Finance o altri).
// Quei nomi stanno solo nei DATI (seeds/) e nelle dichiarazioni che si fanno dal Builder. Se questo test fallisce, hai scritto un nome di
// progetto nel codice: dichiaralo invece come ruolo del modulo (module-roles.js). Eseguire con: node src/no-hardcoded-names.test.js
const fs = require('fs');
const path = require('path');

const VIETATI = ['spese_personali', 'spese_casa', 'debiti_personali', 'debiti_casa', 'giacenza_furgone', 'Contributo Casa', "'Stipendio'", "'da_smistare'", "'pagato'", "'da_pagare'"];
const ROOT = __dirname;
const trovati = [];
function scan(dir) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) { if (f.name === 'node_modules' || f.name === 'seeds') continue; scan(p); continue; }
    if (!f.name.endsWith('.js') || f.name.endsWith('.test.js')) continue;
    const righe = fs.readFileSync(p, 'utf8').split('\n');
    righe.forEach((riga, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(riga)) return; // i commenti possono fare esempi
      if (/\bSTOP\b/.test(riga)) return; // elenco di parole italiane da ignorare nelle frasi, non uno stato
      for (const v of VIETATI) if (riga.includes(v)) trovati.push(path.relative(ROOT, p) + ':' + (i + 1) + ' → ' + v);
    });
  }
}
scan(ROOT);
if (trovati.length) { console.error('✗ nomi di progetto nel codice:\n  ' + trovati.join('\n  ')); console.log('0 passati, 1 falliti su 1 test.'); process.exit(1); }
console.log('  ✓ nessun nome di modulo, campo o categoria di un progetto nel codice del nucleo');
console.log('1 passati, 0 falliti su 1 test.');
