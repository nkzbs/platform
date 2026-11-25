'use strict';
// Processo figlio che esegue UNO script di una Source (vedi source-engine.js). Parte senza variabili d'ambiente (nessun segreto) e, dove Node lo permette,
// con il modello dei permessi: niente disco, niente processi figli, niente worker. Le richieste di rete non le fa da sé: le chiede al processo principale
// (messaggio `request`) che risponde con `response`. Se lo script riesce a uscire dal «vm» (il modulo vm non è un confine di sicurezza), si trova comunque
// in un processo vuoto: niente chiavi, niente file di Platform.
const vm = require('vm');

const SYNC_TIMEOUT_MS = 5000;
const attese = new Map();
let prossimoId = 1;

process.on('message', (m) => {
  if (m && m.type === 'start') eseguiScript(m);
  else if (m && m.type === 'response') { const r = attese.get(m.id); if (r) { attese.delete(m.id); r(m); } }
});

const rispondiFine = (esito) => { process.send({ type: 'done', ...esito }, () => process.exit(0)); };

function costruisciApp({ query, params }) {
  const logs = [];
  const stato = { risultato: undefined, haRisultato: false, fallito: false, errore: null };
  const app = {
    query: query !== undefined ? query : undefined,
    params: params !== undefined ? params : undefined,
    log(x) { logs.push(typeof x === 'object' ? JSON.stringify(x, null, 2) : String(x)); },
    result(x) { stato.risultato = x; stato.haRisultato = true; },
    fail() { stato.fallito = true; },
  };
  app.classes = { searchQuery: class { constructor() { this.type = 'text'; this.value = ''; } isText() { return this.type === 'text'; } isBarcode() { return this.type === 'barcode'; } } };
  app.error = { type: { GENERIC: 0, API_KEY_REQUIRED: 1 } };
  app.error.new = (message, type) => ({ message, type: type === undefined ? app.error.type.GENERIC : type });
  app.setError = (err) => { stato.errore = err; };
  app.request = (url) => {
    const r = { url: String(url || ''), method: 'GET', headers: {}, body: undefined };
    return {
      get url() { return r.url; },
      get method() { return r.method; },
      set method(m) { r.method = String(m || 'GET').toUpperCase(); },
      get body() { return r.body; },
      set body(b) { r.body = b; },
      addHeaderValue(value, field) { r.headers[String(field)] = String(value); },
      send() {
        return new Promise((resolve) => {
          const id = prossimoId++;
          attese.set(id, resolve);
          process.send({ type: 'request', id, url: r.url, method: r.method, headers: r.headers, body: r.body });
        }).then((m) => {
          const testo = m.text || '';
          return { success: !!m.success, statusCode: m.statusCode || 0, json() { try { return JSON.parse(testo); } catch (e) { return null; } }, xml() { return testo; }, image() { return undefined; } };
        });
      },
    };
  };
  app.searchResult = { new: () => ({ title: undefined, subtitle: undefined, imageURL: undefined, params: {} }) };
  app.document = { builder: () => ({}) };
  return { app, logs, stato };
}

async function eseguiScript({ code, query, params }) {
  const { app, logs, stato } = costruisciApp({ query, params });
  const context = vm.createContext(Object.freeze({ app }), { codeGeneration: { strings: false, wasm: false } });
  let script;
  try { script = new vm.Script('(async () => {\n' + String(code || '') + '\n})()', { filename: 'source-script.js' }); }
  catch (e) { return rispondiFine({ ok: false, error: 'Errore di sintassi: ' + e.message, logs }); }
  let promessa;
  try { promessa = script.runInContext(context, { timeout: SYNC_TIMEOUT_MS }); }
  catch (e) { return rispondiFine({ ok: false, error: e.message && /Script execution timed out/.test(e.message) ? 'Lo script impiega troppo tempo (ciclo bloccato?)' : 'Errore: ' + e.message, logs }); }
  try { await promessa; }
  catch (e) { return rispondiFine({ ok: false, error: 'Errore: ' + e.message, logs }); }
  if (stato.fallito) return rispondiFine({ ok: false, error: (stato.errore && stato.errore.message) || 'Lo script ha segnalato un errore (app.fail())', logs });
  if (!stato.haRisultato) return rispondiFine({ ok: false, error: 'Lo script non ha chiamato app.result(...)', logs });
  let risultato;
  try { risultato = JSON.parse(JSON.stringify(stato.risultato)); } catch (e) { return rispondiFine({ ok: false, error: 'Il risultato dello script non è un oggetto semplice', logs }); }
  rispondiFine({ ok: true, result: risultato, logs });
}
