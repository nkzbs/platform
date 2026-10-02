'use strict';
// Esegue ogni src/*.test.js in un processo separato (stesso stile "un file, un
// process.exit(1) se fallisce" già usato da ognuno di essi) e aggrega l'esito.
// Processi separati invece di un require() in sequenza: ogni test file può
// impostare le proprie env var / iniettare i propri mock nella cache moduli
// (vedi print-templates.test.js) senza contaminare gli altri.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const srcDir = path.join(__dirname, 'src');
const testFiles = fs.readdirSync(srcDir).filter((f) => f.endsWith('.test.js')).sort();

if (testFiles.length === 0) {
  console.log('Nessun file *.test.js trovato in src/.');
  process.exit(0);
}

let anyFailed = false;
for (const file of testFiles) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`▶ ${file}`);
  console.log('═'.repeat(60));
  const result = spawnSync(process.execPath, [path.join(srcDir, file)], { stdio: 'inherit' });
  if (result.status !== 0) anyFailed = true;
}

console.log(`\n${'═'.repeat(60)}`);
console.log(anyFailed ? 'Almeno una suite ha test falliti.' : `Tutte le ${testFiles.length} suite sono passate.`);
process.exit(anyFailed ? 1 : 0);
