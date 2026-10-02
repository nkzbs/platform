// Consumi API AI (2026-09-07) — richiesto dall'utente: "in core puoi
// aggiungere uno specchietto con stato consumi api AI?", chiarito insieme:
// consumo REALE (token, non solo "quante raccomandazioni"), visibile SOLO a
// Core (requireCoreRole) — l'AI la paga Core con le proprie chiavi API
// (ANTHROPIC_API_KEY/MISTRAL_API_KEY, env di questo backend), non il
// singolo tenant/partner, quindi non ha senso scoparla per tenant.
//
// Legge SOLO ai_usage_log (db.js), popolata da logAIUsage in
// lib/ai-providers.js per OGNI chiamata reale, qualunque sia il chiamante
// (super-builder.js, client-analyses.js, ai-enabler.js) — un log
// trasversale, non i singoli "raccomandazione per raccomandazione" di
// ai_recommendations.
const express = require('express');
const db = require('../db');
const { requireAuth } = require('./auth');

const router = express.Router();

function numOrNull(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

// Tariffe in €/milione di token, per provider — SOLO da env, mai un numero
// scritto qui: i prezzi reali dei provider cambiano nel tempo e variano per
// piano/regione, meglio nessuna stima che una stima sbagliata scritta nel
// codice. Se non configurate, il costo resta `null` — il frontend lo dice
// onestamente ("imposta le tariffe per stimarlo") invece di mostrare 0€ o
// una cifra inventata.
function ratesFor(providerName) {
  const P = providerName.toUpperCase();
  return {
    input: numOrNull(process.env['AI_COST_PER_MTOK_INPUT_' + P]),
    output: numOrNull(process.env['AI_COST_PER_MTOK_OUTPUT_' + P]),
  };
}

function estimateCost(row, rate) {
  if (rate.input == null || rate.output == null) return null;
  const cost = (row.input_tokens / 1e6) * rate.input + (row.output_tokens / 1e6) * rate.output;
  return Math.round(cost * 10000) / 10000;
}

function withCost(rows) {
  return rows.map((r) => ({ ...r, estimated_cost_eur: estimateCost(r, ratesFor(r.provider)) }));
}

router.get('/', requireAuth, (req, res) => {
  const allTime = db.prepare(`
    SELECT provider,
           COUNT(*) AS calls,
           SUM(COALESCE(input_tokens, 0)) AS input_tokens,
           SUM(COALESCE(output_tokens, 0)) AS output_tokens
    FROM ai_usage_log GROUP BY provider ORDER BY provider
  `).all();
  const last30Days = db.prepare(`
    SELECT provider,
           COUNT(*) AS calls,
           SUM(COALESCE(input_tokens, 0)) AS input_tokens,
           SUM(COALESCE(output_tokens, 0)) AS output_tokens
    FROM ai_usage_log WHERE created_at >= datetime('now', '-30 days') GROUP BY provider ORDER BY provider
  `).all();

  res.json({
    all_time: withCost(allTime),
    last_30_days: withCost(last30Days),
    rates_configured: {
      anthropic: ratesFor('anthropic').input != null && ratesFor('anthropic').output != null,
      mistral: ratesFor('mistral').input != null && ratesFor('mistral').output != null,
    },
  });
});

module.exports = router;
