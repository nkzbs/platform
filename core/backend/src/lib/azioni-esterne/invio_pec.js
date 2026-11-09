'use strict';
// Adattatore «invio_pec»: manda per PEC (PEC Massiva di OpenAPI.it) il testo di un documento da modello del modulo (lo stesso del menu Documenti) all'indirizzo PEC del record.
//   campi: { pec }  il campo con l'indirizzo PEC del destinatario     documento: chiave di un documento da modello (`document_action`) dello stesso modulo, di cui si usano oggetto e testo
//   esito: { esito, data }  campi in cui scrive il riassunto      risultato_in: chiave non dichiarata con { message_id, data }
// Serve la casella PEC Massiva dell'utente (Impostazioni → Connessioni → OpenAPI.it: utente e password, facoltativi) oltre al servizio abilitato sulla chiave; senza, la funzione resta «da attivare».
// La PEC non si può ritirare: il costo si conferma prima (0,05 € a invio). Mai provato con il servizio vero: vedi docs/NOTE-DI-RILASCIO.md.
const db = require('../../db');
const openapiIt = require('../openapi-it');
const email = require('../email');
const DOM = 'pecmassiva';
const SCOPI = [['POST', '/send']];
const err = (m, status = 400, code) => Object.assign(new Error(m), { status, code });
const PEC = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function disponibile() {
  const c = openapiIt.credenziali();
  if (c && !c.pec) return { ok: false, motivo: 'serve la casella PEC Massiva: scrivi utente e password in Impostazioni → Connessioni → OpenAPI.it.' };
  const a = await openapiIt.servizioAttivo('pec_massiva', DOM, SCOPI);
  return a.ok ? a : { ok: false, motivo: 'serve il servizio PEC Massiva di OpenAPI.it. ' + a.motivo };
}

function testo({ slug, dati, config }) {
  const m = db.prepare('SELECT schema_json FROM modules WHERE slug = ?').get(slug); if (!m) throw err('Modulo non trovato.', 404);
  const schema = require('../../schema-v3').parseSchemaNormalized(m.schema_json);
  const az = (schema.document_actions || []).find((a) => a.key === config.documento);
  if (!az) throw err('La funzione cita il documento «' + config.documento + '», che questo modulo non ha.', 500);
  const tenant = db.prepare('SELECT ragione_sociale, indirizzo, piva FROM tenant_settings WHERE id = 1').get();
  const leggiRecord = (modulo, rid) => { const r = db.prepare('SELECT data FROM records WHERE module_slug = ? AND id = ?').get(modulo, rid); return r ? JSON.parse(r.data) : null; };
  const md = require('../modello-documento'); const get = md.costruisciGet({ record: dati, schema, tenant, leggiRecord });
  return { oggetto: md.renderModello(az.subject, get), corpo: md.renderModello(az.body, get) };
}

async function esegui({ dati, config, slug, id }) {
  const C = config.campi || {}, E = config.esito || {};
  const a = String(dati[C.pec || 'pec'] || '').trim();
  if (!PEC.test(a)) throw err('Manca l\'indirizzo PEC del destinatario (campo «' + (C.pec || 'pec') + '»): scrivilo prima di inviare.');
  const c = openapiIt.credenziali(); if (!c || !c.pec) throw err('Manca la casella PEC Massiva: scrivi utente e password in Impostazioni → Connessioni → OpenAPI.it.', 503, 'da_attivare');
  const t = testo({ slug, dati, config });
  if (!String(t.corpo).trim()) throw err('Il testo del documento è vuoto: non si invia una PEC senza testo.');
  const r = await openapiIt.chiama({ dominio: DOM, metodo: 'POST', percorso: '/send', corpo: { recipient: a, subject: String(t.oggetto).slice(0, 250), body: email.htmlDaTesto(t.corpo), username: c.pec.utente, password: c.pec.password }, scopi: SCOPI, timeout: 45000 });
  if (r && r.success === false) throw err('La PEC non è partita: ' + (r.message || 'risposta negativa del servizio') + '.', 502);
  const oggi = new Date().toISOString().slice(0, 10); const patch = {};
  const mid = r && r.message_id;
  if (config.risultato_in) patch[config.risultato_in] = { message_id: mid || null, data: oggi, destinatario: a };
  if (E.data) patch[E.data] = oggi;
  if (E.esito) patch[E.esito] = 'PEC inviata a ' + a + ' il ' + oggi.split('-').reverse().join('/') + (mid ? ' (codice ' + mid + ')' : '') + '.';
  return { patch, risposta: { inviata: true, message_id: mid }, audit: { destinatario: a, message_id: mid } };
}

module.exports = { nome: 'invio_pec', servizio: 'pec_massiva_invio', disponibile, esegui };
