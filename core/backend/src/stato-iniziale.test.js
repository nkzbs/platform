'use strict';
// Stato di partenza di un record nuovo (routes/records-helpers.statoIniziale). Solo la logica. Eseguire con: node src/stato-iniziale.test.js
const path = require('path'), os = require('os'), crypto = require('crypto');
process.env.DB_PATH = path.join(os.tmpdir(), 'stato-iniz-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.JWT_SECRET = 'si_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'sii_' + crypto.randomBytes(8).toString('hex');
const { statoIniziale } = require('./routes/records-helpers');
let passed = 0, failed = 0;
const eq = (nome, a, e) => { if (JSON.stringify(a) !== JSON.stringify(e)) { console.error('  ✗ ' + nome + ': atteso ' + JSON.stringify(e) + ', ottenuto ' + JSON.stringify(a)); failed++; } else { console.log('  ✓ ' + nome); passed++; } };
eq('senza flusso: nessuno stato', statoIniziale({ fields: [] }), undefined);
eq('flusso vuoto: nessuno stato', statoIniziale({ workflow: { states: [] } }), undefined);
eq('senza «initial»: il primo', statoIniziale({ workflow: { states: [{ key: 'a' }, { key: 'b' }] } }), 'a');
eq('con «initial»: quello segnato, anche se non è il primo', statoIniziale({ workflow: { states: [{ key: 'a' }, { key: 'b', initial: true }] } }), 'b');
console.log(`\n${passed} passati, ${failed} falliti`); process.exit(failed ? 1 : 0);
