'use strict';
process.env.PLATFORM_PLUGINS = '*'; // il plugin immobiliare è attivo in questa prova
// «Verifica del soggetto» (Risk): per capire se il servizio è attivo l'adattatore chiede il token solo con gli scope che usa davvero.
// Un scope in più (che l'account può non avere) faceva restare la funzione «da attivare» anche con Risk attivo.
const path = require('path'), os = require('os'), crypto = require('crypto');
process.env.DB_PATH = path.join(os.tmpdir(), 'vp-scopi-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.JWT_SECRET = 'x_' + crypto.randomBytes(8).toString('hex');
const assert = require('assert');
const openapiIt = require('./lib/openapi-it');
let chiesti = null;
openapiIt.servizioAttivo = async (chiave, dominio, scopi) => { chiesti = { chiave, dominio, scopi }; return { ok: true }; };
(async () => {
  const a = require('./lib/azioni-esterne/verifica_persona');
  const d = await a.disponibile();
  assert.strictEqual(d.ok, true);
  assert.strictEqual(chiesti.dominio, 'risk');
  assert.deepStrictEqual(chiesti.scopi, [['POST', '/IT-report-persona'], ['GET', '/IT-report-persona']]);
  console.log('  ✓ gli scope chiesti sono solo quelli del report sulla persona\n\n1 passati, 0 falliti'); process.exit(0);
})().catch((e) => { console.error('  ✗ ' + e.message); process.exit(1); });
