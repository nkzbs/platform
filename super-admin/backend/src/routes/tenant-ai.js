const express = require('express');
const { callAI, isProviderConfigured } = require('../lib/ai-providers');

const router = express.Router();

// Protegge /analyze — chiamato da core/backend (rete Docker interna, mai
// esposto fuori), non da un utente Super Admin loggato. Stesso identico
// pattern già in uso in routes/support.js per /internal/*.
function requireInternalSecret(req, res, next) {
  const secret = req.headers['x-internal-secret'];
  if (!secret || secret !== (process.env.INTERNAL_API_SECRET || 'changeme_internal')) {
    return res.status(401).json({ error: 'Secret interno non valido' });
  }
  next();
}

// Un solo "kind" oggi: 'reportistica' (Finance — performance agenti a scaglioni
// di provvigione, marginalità prodotto). Il prompt di sistema resta di proprietà
// di QUESTO lato (stesso principio già in uso in ai-enabler.js per il "secondo
// revisore GDPR" — il chiamante manda solo i dati, mai il testo del prompt): un
// futuro kind si aggiunge qui, mai lasciando al tenant la scelta del prompt.
const SYSTEM_PROMPTS = {
  reportistica: `Sei un analista che commenta i dati di reportistica di un'azienda (performance commerciale degli agenti con le loro provvigioni, marginalità dei prodotti venduti). Ricevi due tabelle già calcolate nel messaggio (JSON). Scrivi un commento breve (massimo 200 parole), in italiano, concreto e utile a chi gestisce l'azienda: cosa emerge, cosa merita attenzione. USA SOLO i numeri e i nomi presenti nei dati ricevuti — non inventare MAI un valore, una percentuale o un nome non presente nel messaggio. Se i dati sono troppo pochi per un commento utile, dillo esplicitamente invece di forzare un'osservazione. Rispondi con testo semplice, nessun markdown, nessun JSON.`,
};

router.post('/analyze', requireInternalSecret, async (req, res) => {
  const { tenant_slug, kind, data } = req.body || {};
  if (!tenant_slug || !kind || !data) {
    return res.status(400).json({ error: 'tenant_slug, kind e data sono obbligatori' });
  }
  const systemPrompt = SYSTEM_PROMPTS[kind];
  if (!systemPrompt) {
    return res.status(400).json({ error: 'kind "' + kind + '" non supportato' });
  }
  if (!isProviderConfigured('mistral')) {
    return res.status(503).json({ error: 'Mistral non configurato su Super Admin' });
  }
  try {
    const text = await callAI('mistral', { system: systemPrompt, user: JSON.stringify(data), maxTokens: 500 });
    res.json({ result_text: text });
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message || 'Chiamata AI fallita' });
  }
});

module.exports = router;
