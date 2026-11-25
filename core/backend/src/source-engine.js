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
// Isolamento (25/11/2026, audit di sicurezza A2): lo script NON gira più nel processo di Platform. Il modulo vm di Node non è un confine di sicurezza
// (da dentro lo script si arrivava a `process` e quindi alle chiavi del tenant), quindi ora gira in un processo figlio (source-engine-child.js) senza
// variabili d'ambiente e, dove Node lo permette, senza accesso al disco né ai processi. Le richieste di rete le esegue questo processo per conto dello
// script. L'accesso di rete resta deliberatamente libero (nessun blocco su IP privati/interni) — scelta esplicita dell'utente del 16/10, rischio noto e
// accettato; non si apre invece più la strada ai segreti. Vedi DECISIONI.md.
//
// Due timeout distinti, per due minacce distinte: vm `timeout` interrompe un loop
// SINCRONO infinito (while(true){} prima di un await) — unico modo reale per fermarlo,
// dato che blocca l'intero thread Node; il Promise.race esterno copre invece un await
// che non si risolve mai (fetch appesa, loop dopo un await) — il timeout di vm NON lo
// vede, perché a quel punto runInContext è già tornato con una Promise pendente.
const { fork } = require('child_process');
const path = require('path');

const ASYNC_TIMEOUT_MS = 20000;
const FETCH_TIMEOUT_MS = 15000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const FIGLIO = path.join(__dirname, 'source-engine-child.js');

// Il flag dei permessi di Node si chiama `--permission` dalla 22.13 (prima `--experimental-permission`).
function flagPermessi() {
  const [maggiore, minore] = process.versions.node.split('.').map(Number);
  if (maggiore < 20) return null;
  return maggiore > 22 || (maggiore === 22 && minore >= 13) ? '--permission' : '--experimental-permission';
}

// La richiesta di rete di uno script, eseguita QUI (il figlio non ha segreti ma nemmeno bisogno di una rete sua).
async function eseguiRichiesta({ url, method, headers, body }) {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(String(url || ''), { method, headers, body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined, signal: controller.signal });
    } finally { clearTimeout(t); }
    let text = '';
    const reader = res.body ? res.body.getReader() : null;
    if (reader) {
      let ricevuti = 0;
      const decoder = new TextDecoder();
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        ricevuti += value.length;
        if (ricevuti > MAX_RESPONSE_BYTES) { try { await reader.cancel(); } catch (e) {} throw new Error('Risposta troppo grande (oltre 5MB)'); }
        text += decoder.decode(value, { stream: true });
      }
    } else { text = await res.text(); }
    return { success: res.ok, statusCode: res.status, text };
  } catch (e) {
    return { success: false, statusCode: 0, text: '' };
  }
}

// Esegue uno script Source (search_script o document_script) e ritorna { ok, result, logs, error } — non lancia mai per un errore DELLO SCRIPT
// (quelli finiscono in `error`), lancia solo per un bug nel motore stesso.
function runSourceScript(code, initial) {
  const { query, params } = initial || {};
  return new Promise((resolve) => {
    const flag = flagPermessi();
    const execArgv = ['--max-old-space-size=96', ...(flag ? [flag, '--allow-fs-read=' + FIGLIO] : [])];
    let figlio, finito = false;
    const chiudi = (esito) => { if (finito) return; finito = true; clearTimeout(timer); try { figlio.kill('SIGKILL'); } catch (e) {} resolve(esito); };
    try { figlio = fork(FIGLIO, [], { execArgv, env: {}, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], serialization: 'json' }); }
    catch (e) { return resolve({ ok: false, error: 'Non riesco ad avviare l\'esecuzione dello script: ' + e.message, logs: [] }); }
    const timer = setTimeout(() => chiudi({ ok: false, error: 'Lo script impiega troppo tempo (richiesta esterna mai risposta?)', logs: [] }), ASYNC_TIMEOUT_MS + 2000);
    figlio.on('message', async (m) => {
      if (!m) return;
      if (m.type === 'request') { const r = await eseguiRichiesta(m); if (!finito) { try { figlio.send({ type: 'response', id: m.id, ...r }); } catch (e) { /* il figlio è già finito */ } } }
      else if (m.type === 'done') { const { type, ...esito } = m; chiudi(esito); }
    });
    figlio.on('error', (e) => chiudi({ ok: false, error: 'Errore: ' + e.message, logs: [] }));
    figlio.on('exit', (codice) => setTimeout(() => chiudi({ ok: false, error: 'Lo script è terminato in modo imprevisto' + (codice ? ' (codice ' + codice + ')' : ''), logs: [] }), 150));
    figlio.send({ type: 'start', code: String(code || ''), query, params });
  });
}

module.exports = { runSourceScript };
