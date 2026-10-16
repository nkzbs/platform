// ─── ANTHROPIC — CHIAMATA CONDIVISA ─────────────────────────────────────────
// Prima duplicata inline in super-builder.js (unico punto AI della piattaforma
// finché non è arrivato il suggeritore di processi in client-analyses.js) —
// estratta qui perché ora ci sono DUE chiamanti con lo stesso identico
// pattern (auth, endpoint, parsing JSON con tolleranza ai fence markdown).
// Nessun SDK, fetch diretto — stessa scelta di prima, niente da cambiare.
// Ritorna { text, usage } dal 2026-09-07 (prima solo `text`) — l'UNICO
// chiamante rimasto è ai-providers.js (super-builder.js/client-analyses.js
// sono già passati per callAI in una sessione precedente), quindi cambiare
// il contratto qui è sicuro: nessun altro punto da aggiornare. `usage` serve
// per tracciare i consumi reali (vedi ai_usage_log, db.js) — mai letto e
// scartato come prima.
async function callClaude({ system, user, maxTokens = 2048 }) {
  const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5',
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  const data = await apiRes.json();
  if (!apiRes.ok) {
    const err = new Error('Chiamata al modello fallita: ' + (data?.error?.message || apiRes.statusText));
    err.status = 502;
    throw err;
  }
  const text = (data.content || []).map((b) => b.text || '').join('').trim();
  return { text, usage: data.usage ? { input_tokens: data.usage.input_tokens, output_tokens: data.usage.output_tokens } : null };
}

// Il modello a volte incornicia comunque la risposta in ```json — nonostante
// l'istruzione esplicita di non farlo — quindi si tollera anche quel caso.
function parseJsonResponse(text) {
  const cleaned = text.replace(/^```(json)?/i, '').replace(/```$/, '').trim();
  return JSON.parse(cleaned);
}

module.exports = { callClaude, parseJsonResponse };
