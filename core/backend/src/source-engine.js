'use strict';
// Motore di esecuzione delle Sources scriptabili (Builder, Fase 4 della semplificazione
// ispirata a Collections — "ApiSource": uno script JS, scritto dall'admin del tenant, che
// cerca su un'API esterna e propone un nuovo record). Adattato da Collections (JSContext
// su iOS, sincrono, builder tipizzato CoreData) al modello dati di Platform (record =
// JSON piatto {campo: valore}, Node, async): lo script scrive
// `let r = await app.request(url).send()` invece che bloccante, e ritorna un oggetto
// piatto via app.result({...}) invece di popolare un builder tipizzato — Platform non ha
// bisogno della tipizzazione forte di CoreData, un record è già solo dati.
//
// Isolamento: vm.createContext espone SOLO l'oggetto `app` qui sotto — niente
// process/require/fs/child_process, mai raggiungibili dallo script. Non è un confine di
// sicurezza assoluto (il modulo vm di Node non lo è, documentato upstream), ma impedisce
// l'accesso diretto più ovvio. L'accesso di rete (app.request) è deliberatamente libero
// (nessun blocco su IP privati/interni) — scelta esplicita dell'utente, con il rischio
// noto e accettato: un tenant compromesso (o un admin malevolo) ottiene così una via
// diretta alla rete Docker interna, non solo "in teoria" come oggi. Vedi DECISIONI.md,
// controllo di sicurezza del 16/10.
//
// Due timeout distinti, per due minacce distinte: vm `timeout` interrompe un loop
// SINCRONO infinito (while(true){} prima di un await) — unico modo reale per fermarlo,
// dato che blocca l'intero thread Node; il Promise.race esterno copre invece un await
// che non si risolve mai (fetch appesa, loop dopo un await) — il timeout di vm NON lo
// vede, perché a quel punto runInContext è già tornato con una Promise pendente.
const vm = require('vm');

const SYNC_TIMEOUT_MS = 5000;
const ASYNC_TIMEOUT_MS = 20000;
const FETCH_TIMEOUT_MS = 15000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

function buildApp({ query, params } = {}) {
  const logs = [];
  let resultValue;
  let hasResult = false;
  let failed = false;
  let errorValue = null;

  const app = {
    query: query !== undefined ? query : undefined,
    params: params !== undefined ? params : undefined,
    log(x) { logs.push(typeof x === 'object' ? JSON.stringify(x, null, 2) : String(x)); },
    result(x) { resultValue = x; hasResult = true; },
    fail() { failed = true; },
  };

  app.classes = {};
  app.classes.searchQuery = class { constructor() { this.type = 'text'; this.value = ''; } isText() { return this.type === 'text'; } isBarcode() { return this.type === 'barcode'; } };

  app.error = { type: { GENERIC: 0, API_KEY_REQUIRED: 1 } };
  app.error.new = (message, type) => ({ message, type: type === undefined ? app.error.type.GENERIC : type });
  app.setError = (err) => { errorValue = err; };

  app.request = (url) => {
    const state = { url: String(url || ''), method: 'GET', headers: {}, body: undefined };
    return {
      get url() { return state.url; },
      get method() { return state.method; },
      set method(m) { state.method = String(m || 'GET').toUpperCase(); },
      get body() { return state.body; },
      set body(b) { state.body = b; },
      addHeaderValue(value, field) { state.headers[String(field)] = String(value); },
      async send() {
        try {
          const controller = new AbortController();
          const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
          let res;
          try {
            res = await fetch(state.url, {
              method: state.method,
              headers: state.headers,
              body: state.body !== undefined ? (typeof state.body === 'string' ? state.body : JSON.stringify(state.body)) : undefined,
              signal: controller.signal,
            });
          } finally { clearTimeout(t); }
          const reader = res.body ? res.body.getReader() : null;
          let text = '';
          if (reader) {
            let received = 0;
            const decoder = new TextDecoder();
            // eslint-disable-next-line no-constant-condition
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              received += value.length;
              if (received > MAX_RESPONSE_BYTES) { try { await reader.cancel(); } catch (e) {} throw new Error('Risposta troppo grande (oltre 5MB)'); }
              text += decoder.decode(value, { stream: true });
            }
          } else {
            text = await res.text();
          }
          const statusCode = res.status;
          const success = res.ok;
          return {
            success, statusCode,
            json() { try { return JSON.parse(text); } catch (e) { return null; } },
            xml() { return text; }, // nessun parser XML lato server: il testo grezzo basta per un'estrazione via regex nello script
            image() { return undefined; }, // niente immagini dalle Sources per ora — fuori scope, i campi immagine restano manuali
          };
        } catch (e) {
          return { success: false, statusCode: 0, json: () => null, xml: () => '', image: () => undefined };
        }
      },
    };
  };

  app.searchResult = { new: () => ({ title: undefined, subtitle: undefined, imageURL: undefined, params: {} }) };
  app.document = { builder: () => ({}) }; // compatibilità col vocabolario di Collections — su Platform un documento è solo l'oggetto piatto passato ad app.result

  return { app, logs, getResult: () => (hasResult ? resultValue : undefined), hasResult: () => hasResult, isFailed: () => failed, getError: () => errorValue };
}

// Esegue uno script Source (search_script o document_script) e ritorna
// { ok, result, logs, error } — non lancia mai per un errore DELLO SCRIPT (quelli
// finiscono in `error`), lancia solo per un bug nel motore stesso.
async function runSourceScript(code, initial) {
  const { app, logs, getResult, hasResult, isFailed, getError } = buildApp(initial);
  const context = vm.createContext(Object.freeze({ app }), { codeGeneration: { strings: false, wasm: false } });
  let script;
  try {
    script = new vm.Script('(async () => {\n' + String(code || '') + '\n})()', { filename: 'source-script.js' });
  } catch (e) {
    return { ok: false, error: 'Errore di sintassi: ' + e.message, logs };
  }

  let scriptPromise;
  try {
    scriptPromise = script.runInContext(context, { timeout: SYNC_TIMEOUT_MS });
  } catch (e) {
    return { ok: false, error: e.message && /Script execution timed out/.test(e.message) ? 'Lo script impiega troppo tempo (ciclo bloccato?)' : 'Errore: ' + e.message, logs };
  }

  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ASYNC_TIMEOUT_MS));
  try {
    await Promise.race([scriptPromise, timeout]);
  } catch (e) {
    if (e.message === 'timeout') return { ok: false, error: 'Lo script impiega troppo tempo (richiesta esterna mai risposta?)', logs };
    return { ok: false, error: 'Errore: ' + e.message, logs };
  }

  if (isFailed()) return { ok: false, error: (getError() && getError().message) || 'Lo script ha segnalato un errore (app.fail())', logs };
  if (!hasResult()) return { ok: false, error: 'Lo script non ha chiamato app.result(...)', logs };
  return { ok: true, result: getResult(), logs };
}

module.exports = { runSourceScript };
