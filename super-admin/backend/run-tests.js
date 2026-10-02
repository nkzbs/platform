'use strict';
// Stesso identico script di core/backend/run-tests.js — un file, un processo,
// process.exit(1) aggregato se una suite fallisce. G3 (PLATFORM-0.6-GAP-ANALYSIS.md,
// 2026-08-22) introduce qui il primo *.test.js di questo backend (isolation.test.js).
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
