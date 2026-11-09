'use strict';
// Adattatore «invio_pec» (PEC Massiva di OpenAPI.it): manda per PEC il testo di un documento da modello del modulo all'indirizzo PEC del record. Servizio finto (nessuna rete). Eseguire con: node src/invio-pec.test.js
const path = require('path'); const os = require('os'); const crypto = require('crypto');
process.env.DB_PATH = path.join(os.tmpdir(), 'pec-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.JWT_SECRET = 'jwt_' + crypto.randomBytes(8).toString('hex');
process.env.ENCRYPTION_KEY = 'pec_test_encryption_key_00000000';
process.env.INTERNAL_API_SECRET = 'int_' + crypto.randomBytes(8).toString('hex');
let passati = 0, falliti = 0;
async function test(nome, fn) { try { await fn(); console.log('  ✓ ' + nome); passati++; } catch (e) { console.error('  ✗ ' + nome + '\n    ' + e.message); falliti++; } }
const ok = (c, m) => { if (!c) throw new Error(m || 'atteso true'); };
const db = require('./db'); const sigillo = require('./secrets-at-rest');
db.prepare('DELETE FROM modules').run();
const F = (key, extra = {}) => ({ id: 'f_' + key, block_type: 'field', key, label: key, type: 'text', ...extra });
db.prepare('INSERT INTO modules (name, slug, installed, schema_json) VALUES (?, ?, 1, ?)').run('Clienti', 'clienti', JSON.stringify({ version: 3, steps: [F('nome'), F('pec'), { id: 'd', block_type: 'document_action', key: 'privacy', label: 'Privacy', subject: 'Privacy per {{nome}}', body: 'Gentile {{nome}},\nin allegato l\'informativa.\n{{@oggi}}' }] }));
const cred = (extra = {}) => db.prepare("INSERT INTO connections (integration_id, connected, credentials) VALUES ('openapi_it', 1, ?) ON CONFLICT(integration_id) DO UPDATE SET credentials = excluded.credentials, connected = 1").run(sigillo.seal({ email: 'a@b.it', api_key: 'CHIAVE', ambiente: 'sandbox', ...extra }));
const CONFIG = { key: 'invio_pec', label: 'Invia via PEC', adapter: 'invio_pec', campi: { pec: 'pec' }, documento: 'privacy', risultato_in: 'invio_pec', esito: { esito: 'pec_esito', data: 'pec_data' } };
const chiamate = []; const veroFetch = global.fetch; let rispostaSend = { success: true, message: 'ok', message_id: 'MID-123', sent: 1 };
global.fetch = async (url, opts = {}) => {
  const u = String(url); if (!/openapi\.(com|it)|pecmassiva\.com/.test(u)) return veroFetch(url, opts);
  chiamate.push({ metodo: opts.method || 'GET', url: u, corpo: opts.body });
  if (u.endsWith('/tokens')) return { ok: true, status: 200, json: async () => ({ data: { token: 'tok' } }) };
  if (u.endsWith('/send')) return { ok: true, status: 201, json: async () => rispostaSend };
  return { ok: false, status: 404, json: async () => ({ message: 'non trovato' }) };
};
(async () => {
  const A = require('./lib/azioni-esterne').adattatore('invio_pec'); const oa = require('./lib/openapi-it');
  const dati = { nome: 'Mario Rossi', pec: 'mario.rossi@pec.it' };
  await test('senza casella PEC Massiva la funzione resta «da attivare» e lo dice', async () => {
    cred(); const d = await A.disponibile(); ok(!d.ok && /casella PEC Massiva/.test(d.motivo), JSON.stringify(d));
  });
  await test('senza la casella nel collegamento l\'invio si ferma prima di chiamare il servizio', async () => {
    let e; try { await A.esegui({ dati, config: CONFIG, slug: 'clienti', id: 1 }); } catch (x) { e = x; }
    ok(e && e.code === 'da_attivare' && !chiamate.some((c) => /\/send$/.test(c.url)), e && e.message);
  });
  await test('senza indirizzo PEC valido nel record si ferma con un messaggio chiaro', async () => {
    cred({ pec_utente: 'studio@pecmassiva.com', pec_password: 'segreta' });
    let e; try { await A.esegui({ dati: { nome: 'X', pec: 'non-una-pec' }, config: CONFIG, slug: 'clienti', id: 1 }); } catch (x) { e = x; }
    ok(e && /indirizzo PEC/.test(e.message), e && e.message);
  });
  await test('con tutto a posto manda oggetto e testo del documento, già compilati, dal servizio di prova', async () => {
    const out = await A.esegui({ dati, config: CONFIG, slug: 'clienti', id: 1 });
    const p = chiamate.find((c) => /\/send$/.test(c.url)); const b = JSON.parse(p.corpo);
    ok(/test\.ws\.pecmassiva\.com/.test(p.url) && p.metodo === 'POST', p.url);
    ok(b.recipient === 'mario.rossi@pec.it' && b.subject === 'Privacy per Mario Rossi' && /Gentile Mario Rossi/.test(b.body) && b.username === 'studio@pecmassiva.com' && b.password === 'segreta', JSON.stringify(b));
    ok(!/\{\{/.test(b.body + b.subject), 'segnaposto non sostituiti');
    ok(out.patch.invio_pec.message_id === 'MID-123' && /mario\.rossi@pec\.it/.test(out.patch.pec_esito) && out.patch.pec_data, JSON.stringify(out.patch));
    ok(A.servizio === 'pec_massiva_invio' && require('./lib/openapi-spese').stima('pec_massiva_invio').costo === 0.05, 'costo di listino');
  });
  await test('se il servizio risponde «non inviata» l\'errore arriva a chi preme, e la password non compare mai', async () => {
    rispostaSend = { success: false, message: 'Credito insufficiente' }; let e;
    try { await A.esegui({ dati, config: CONFIG, slug: 'clienti', id: 1 }); } catch (x) { e = x; }
    ok(e && /Credito insufficiente/.test(e.message) && !/segreta/.test(e.message), e && e.message);
  });
  await test('la password della casella non esce da nessun elenco di Connessioni', () => {
    const m = JSON.stringify(Object.entries(require('./secrets-at-rest').unseal(db.prepare("SELECT credentials FROM connections WHERE integration_id='openapi_it'").get().credentials)).map(([k, v]) => [k, v ? '••••' : '']));
    ok(!/segreta/.test(m), m);
  });
  console.log(`\n${passati} passati, ${falliti} falliti`); process.exit(falliti ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
