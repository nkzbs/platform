// Prova di compatibilità: lo schema che esce dal generatore (dopo la pulizia) si installa nel core e supera controllo e collaudo.
process.env.DB_PATH = '/tmp/e2e-gen-' + Date.now() + '.db'; process.env.JWT_SECRET = 'x'.repeat(20); process.env.ENCRYPTION_KEY = 'e2e_gen_encryption_key_00000000'; process.env.INTERNAL_API_SECRET = 'y'.repeat(20);
const db = require('../../../core/backend/src/db');
db.prepare('DELETE FROM modules').run();
for (const [slug, name, s] of JSON.parse(require('fs').readFileSync('/tmp/moduli-generati.json','utf8'))) db.prepare('INSERT INTO modules (name, slug, installed, schema_json) VALUES (?, ?, 1, ?)').run(name, slug, JSON.stringify(s));
const v = require('../../../core/backend/src/lib/verifica-tenant').verifica();
console.log('VERIFICA', v.punteggio, v.superati + '/' + v.controlli); v.problemi.forEach((p) => console.log('  -', p.modulo, p.blocco, p.messaggio));
require('../../../core/backend/src/lib/collaudo-tenant').esegui({ stato: 'in_corso', avanzamento: [] }).then((r) => { console.log('COLLAUDO', r.punteggio, r.superati + '/' + r.controlli); r.problemi.forEach((p) => console.log('  -', p.modulo, p.blocco, p.messaggio)); console.log('AUTOM', JSON.stringify(r.effetti_automazioni)); process.exit(0); }).catch((e) => { console.error(e); process.exit(1); });
