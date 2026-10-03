// AI Enabler (2026-09-06) — astrazione minima multi-provider, non un framework:
// due funzioni, non una gerarchia di classi. Anthropic riusa callClaude() già
// esistente in ./ai.js (nessuna duplicazione, nessun comportamento nuovo per i
// chiamanti esistenti di quel file). Mistral è nuovo qui, stesso stile di
// ai.js: fetch diretto, niente SDK.
//
// Timeout via AbortController (2026-09-06) — gap reale mai corretto in ai.js
// per non toccare i chiamanti esistenti (super-builder.js, client-analyses.js
// già vivono senza, cambiare adesso rischierebbe una regressione non richiesta
// lì): qui invece è un requisito per i NUOVI chiamanti (ai-enabler.js), che
// non devono restare appesi all'infinito se il provider non risponde.
const { callClaude } = require('./ai');
const db = require('../db');
const { assertWithinBudget, maybeAlert } = require('./ai-budget');

function isProviderConfigured(providerName) {
  if (providerName === 'mistral') return !!process.env.MISTRAL_API_KEY;
  if (providerName === 'anthropic') return !!process.env.ANTHROPIC_API_KEY;
  return false;
}

async function callMistral({ system, user, maxTokens = 2048, timeoutMs = 20000 }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const apiRes = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + process.env.MISTRAL_API_KEY,
      },
      body: JSON.stringify({
        // mistral-small-latest, non -large (2026-09-06, verificato dal vivo
        // con la chiave reale dell'utente): "mistral-large-latest" risponde
        // 403 "not available in your subscription tier" sul piano free —
        // small è il modello confermato raggiungibile. Resta sovrascrivibile
        // via MISTRAL_MODEL per chi ha un piano superiore.
        model: process.env.MISTRAL_MODEL || 'mistral-small-latest',
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
      signal: controller.signal,
    });
    const data = await apiRes.json();
    if (!apiRes.ok) {
      const err = new Error('Chiamata a Mistral fallita: ' + (data?.error?.message || data?.message || apiRes.statusText));
      err.status = 502;
      throw err;
    }
    const text = (data.choices || []).map((c) => c.message?.content || '').join('').trim();
    // Forma OpenAI-compatibile (Mistral la segue) — prompt_tokens/completion_tokens,
    // non input_tokens/output_tokens come Anthropic: normalizzato qui allo stesso
    // nome di callClaude, un solo formato da leggere in logAIUsage sotto.
    const usage = data.usage ? { input_tokens: data.usage.prompt_tokens, output_tokens: data.usage.completion_tokens } : null;
    return { text, usage };
  } catch (e) {
    if (e.name === 'AbortError') {
      const err = new Error('Mistral non ha risposto entro ' + timeoutMs + 'ms');
      err.status = 504;
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function modelFor(providerName) {
  if (providerName === 'mistral') return process.env.MISTRAL_MODEL || 'mistral-small-latest';
  if (providerName === 'anthropic') return process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
  return null;
}

// Consumi reali (2026-09-07, richiesto dall'utente: "specchietto con stato
// consumi API AI" in Super Admin) — un INSERT best-effort per OGNI chiamata
// riuscita, qualunque sia il chiamante di callAI (super-builder.js,
// client-analyses.js, ai-enabler.js — nessuno di questi tocca ai_usage_log
// direttamente, tutti passano da qui). Non deve MAI far fallire la chiamata
// AI vera: un log perso è accettabile, un suggerimento perso per un errore
// di logging no.
function logAIUsage(providerName, usage) {
  if (!usage) return;
  try {
    db.prepare('INSERT INTO ai_usage_log (provider, model, input_tokens, output_tokens) VALUES (?, ?, ?, ?)')
      .run(providerName, modelFor(providerName), usage.input_tokens ?? null, usage.output_tokens ?? null);
  } catch (e) { /* mai bloccare la risposta AI per un log fallito */ }
}

// callClaude (ai.js) non ha timeout proprio — qui lo aggiungiamo SOLO per la
// chiamata fatta da questo modulo, senza toccare la funzione condivisa: un
// AbortController esterno passato via fetch non è un'opzione (callClaude non
// lo accetta), quindi la protezione è una race contro un timer — l'unica
// forma di timeout ottenibile senza modificare ai.js.
//
// Contratto INVARIATO per i chiamanti di callAI (2026-09-07): callClaude/
// callMistral ora ritornano { text, usage } internamente, ma callAI
// continua a ritornare solo `text` come sempre — logAIUsage qui sotto è un
// effetto collaterale trasparente, nessuno dei chiamanti esistenti
// (super-builder.js, client-analyses.js, ai-enabler.js) deve cambiare.
async function callAI(providerName, { system, user, maxTokens = 2048, timeoutMs = 20000 } = {}) {
  assertWithinBudget(); // a tetto mensile raggiunto non parte nessuna chiamata
  if (!isProviderConfigured(providerName)) {
    const err = new Error('Provider AI "' + providerName + '" non configurato');
    err.status = 503;
    throw err;
  }
  if (providerName === 'mistral') {
    const { text, usage } = await callMistral({ system, user, maxTokens, timeoutMs });
    logAIUsage(providerName, usage);
    maybeAlert();
    return text;
  }
  if (providerName === 'anthropic') {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => { const err = new Error('Claude non ha risposto entro ' + timeoutMs + 'ms'); err.status = 504; reject(err); }, timeoutMs);
    });
    try {
      const { text, usage } = await Promise.race([callClaude({ system, user, maxTokens }), timeout]);
      logAIUsage(providerName, usage);
      maybeAlert();
      return text;
    } finally {
      clearTimeout(timer);
    }
  }
  const err = new Error('Provider AI "' + providerName + '" sconosciuto');
  err.status = 400;
  throw err;
}

module.exports = { callAI, isProviderConfigured };
