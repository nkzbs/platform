// Tetto di spesa mensile per le chiamate AI. Tutte le chiamate passano da callAI()
// (lib/ai-providers.js), che registra i token in ai_usage_log: qui si sommano quelli del
// mese in corso, si convertono in euro con i prezzi per milione di token, e si blocca ogni
// nuova chiamata quando il tetto è raggiunto.
//
// Prezzi in euro per milione di token. Il default di Mistral è quello di mistral-small
// (0,13 in ingresso, 0,51 in uscita); si sovrascrive con AI_COST_PER_MTOK_INPUT_<PROVIDER> e
// AI_COST_PER_MTOK_OUTPUT_<PROVIDER>. Un provider senza prezzi noti conta come costo zero.
// Il tetto mensile (euro) è AI_MONTHLY_BUDGET_EUR, di default 10.
const db = require('../db');

const DEFAULT_RATES = { mistral: { input: 0.13, output: 0.51 } };
const DEFAULT_BUDGET_EUR = 10;
const ALERT_LEVELS = [80, 100];

db.exec(`
  CREATE TABLE IF NOT EXISTS ai_budget_alerts (
    month TEXT NOT NULL,
    level INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (month, level)
  );
`);

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function ratesFor(provider) {
  const P = String(provider).toUpperCase();
  const d = DEFAULT_RATES[String(provider).toLowerCase()] || {};
  const input = num(process.env['AI_COST_PER_MTOK_INPUT_' + P]);
  const output = num(process.env['AI_COST_PER_MTOK_OUTPUT_' + P]);
  return { input: input != null ? input : (d.input ?? null), output: output != null ? output : (d.output ?? null) };
}

function budgetEur() {
  const v = num(process.env.AI_MONTHLY_BUDGET_EUR);
  return v != null && v > 0 ? v : DEFAULT_BUDGET_EUR;
}

function monthKey(date = new Date()) {
  return date.toISOString().slice(0, 7); // YYYY-MM (UTC, come created_at di SQLite)
}

// Spesa del mese in corso, in euro.
// Con tenantSlug conta solo le chiamate di quel tenant; senza, quelle di Super Admin stesso.
function monthlySpendEur(date = new Date(), tenantSlug = null) {
  const from = monthKey(date) + '-01 00:00:00';
  const rows = db.prepare(`
    SELECT provider, SUM(COALESCE(input_tokens, 0)) AS i, SUM(COALESCE(output_tokens, 0)) AS o
    FROM ai_usage_log WHERE created_at >= ? AND tenant_slug IS ? GROUP BY provider
  `).all(from, tenantSlug || null);
  let total = 0;
  for (const r of rows) {
    const rate = ratesFor(r.provider);
    if (rate.input == null || rate.output == null) continue;
    total += (r.i / 1e6) * rate.input + (r.o / 1e6) * rate.output;
  }
  return Math.round(total * 10000) / 10000;
}

function status(date = new Date(), tenantSlug = null) {
  const spent = monthlySpendEur(date, tenantSlug);
  const budget = budgetEur();
  return { month: monthKey(date), spent_eur: spent, budget_eur: budget, percent: Math.min(999, Math.round((spent / budget) * 1000) / 10), blocked: spent >= budget };
}

// Da chiamare PRIMA di ogni chiamata AI: a tetto raggiunto non parte nulla.
function assertWithinBudget(tenantSlug = null) {
  const s = status(new Date(), tenantSlug);
  if (s.blocked) {
    const err = new Error('Tetto mensile AI raggiunto (' + s.spent_eur.toFixed(2) + ' € su ' + s.budget_eur.toFixed(2) + ' €): le chiamate riprendono il mese prossimo, o alza AI_MONTHLY_BUDGET_EUR.');
    err.status = 429;
    err.code = 'ai_budget_exceeded';
    throw err;
  }
}

// Da chiamare DOPO una chiamata riuscita: manda un'email una sola volta per mese e livello
// (80% e 100%). Mai bloccante: un avviso perso non deve far fallire la risposta.
async function maybeAlert(tenantSlug = null) {
  try {
    const s = status(new Date(), tenantSlug);
    // La colonna "month" tiene anche il tenant ("2026-10|finance"), così ogni tenant ha i suoi avvisi.
    const key = tenantSlug ? s.month + '|' + tenantSlug : s.month;
    for (const level of ALERT_LEVELS) {
      if (s.percent < level) continue;
      const done = db.prepare('SELECT 1 FROM ai_budget_alerts WHERE month = ? AND level = ?').get(key, level);
      if (done) continue;
      db.prepare('INSERT INTO ai_budget_alerts (month, level) VALUES (?, ?)').run(key, level);
      const { notifyAIBudget } = require('../notifier');
      await notifyAIBudget({ level, spentEur: s.spent_eur, budgetEur: s.budget_eur, tenantSlug });
    }
  } catch (e) { /* mai bloccare */ }
}

module.exports = { ratesFor, budgetEur, monthlySpendEur, status, assertWithinBudget, maybeAlert, DEFAULT_BUDGET_EUR };
