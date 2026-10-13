const express = require('express');
const { callAI, isProviderConfigured } = require('../lib/ai-providers');
const aiKey = require('../lib/ai-key');
const db = require('../db');
const { logAudit } = require('../audit-log');
const { status: budgetStatus } = require('../lib/ai-budget');
const { redact } = require('../lib/ai-redact');
const reportAi = require('../lib/ai-report');
const askAi = require('../lib/ai-ask');
const botAi = require('../lib/ai-bot');
const receiptAi = require('../lib/ai-receipt');

const suggestionAi = require('../lib/ai-suggestion');
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

// Stato del tetto di spesa del mese (lo mostra la pagina delle impostazioni del tenant).
router.get('/budget', requireInternalSecret, (req, res) => {
  res.json(budgetStatus(new Date(), req.query.tenant_slug || null));
});

// ─── Chiave Mistral del tenant ────────────────────────────────────────────────
// Il tenant la inserisce dalle sue impostazioni; qui resta cifrata e non viene mai restituita.
const tenantExists = (slug) => !!slug && !!db.prepare('SELECT 1 FROM tenants WHERE slug = ?').get(slug);

router.get('/key', requireInternalSecret, (req, res) => {
  res.json(aiKey.keyStatus(req.query.tenant_slug || null));
});

router.put('/key', requireInternalSecret, async (req, res) => {
  const { tenant_slug, key } = req.body || {};
  if (!tenantExists(tenant_slug)) return res.status(404).json({ error: 'Tenant sconosciuto' });
  const k = String(key || '').trim();
  if (k.length < 16 || /\s/.test(k)) return res.status(400).json({ error: 'La chiave non sembra valida (troppo corta o con spazi).' });
  const v = await aiKey.validateMistralKey(k);
  if (!v.ok) return res.status(400).json({ error: v.reason });
  aiKey.setTenantKey(tenant_slug, k);
  logAudit('tenant:' + tenant_slug, 'ai.key.set', tenant_slug, null);
  res.json(aiKey.keyStatus(tenant_slug));
});

router.delete('/key', requireInternalSecret, (req, res) => {
  const slug = (req.body && req.body.tenant_slug) || req.query.tenant_slug;
  if (!tenantExists(slug)) return res.status(404).json({ error: 'Tenant sconosciuto' });
  aiKey.clearTenantKey(slug);
  logAudit('tenant:' + slug, 'ai.key.clear', slug, null);
  res.json(aiKey.keyStatus(slug));
});

// ─── Smistamento bollette ─────────────────────────────────────────────────────
// Il tenant manda mittente, oggetto, un estratto del testo e le categorie ammesse; l'AI
// PROPONE categoria, fornitore, importo e scadenza. Il risultato è controllato qui: una
// categoria che non è tra quelle ammesse viene scartata, un importo o una data non validi
// diventano "null". Il tenant non riceve mai testo libero dal modello, solo questi campi.
const BILL_SYSTEM_PROMPT = `Sei un assistente che smista le bollette e le fatture ricevute per email, per la gestione delle spese di famiglia. Ricevi un JSON con: mittente, oggetto, testo (estratto della mail, con i dati personali già tolti), rilevato (importo e scadenza trovati da un programma, possono mancare o essere sbagliati), modulo_attuale e moduli (per ogni modulo le categorie ammesse). Rispondi SOLO con un oggetto JSON, senza altro testo, con questi campi: "modulo" (una delle chiavi di "moduli"), "categoria" (UNA delle categorie ammesse di quel modulo, oppure null se nessuna è adatta), "fornitore" (nome breve dell'azienda che emette il documento, oppure null), "importo" (numero con il punto decimale, l'importo totale da pagare, oppure null se non lo trovi con certezza), "scadenza" (data di scadenza del pagamento nel formato AAAA-MM-GG, oppure null), "confidenza" ("alta", "media" o "bassa"). Non inventare: se un dato non c'è scrivi null. Per le bollette di energia il tipo conta: nel JSON può esserci "indizio_energia" ("luce", "gas" o "entrambi", calcolato da un programma leggendo il PDF della bolletta) e "allegati" (estratto delle righe utili del PDF). Se indizio_energia è "luce", o il testo parla di kWh, POD o energia elettrica, scegli la categoria dell'elettricità; se è "gas", o il testo parla di Smc, PDR o gas naturale, quella del gas. Un titolo come "Gas/Luce" non basta a decidere: guarda il contenuto. Se resta davvero ambiguo, categoria null. La "scadenza" è la data entro cui si deve PAGARE ("entro il", "rata unica entro il", "scadenza pagamento"): mai la scadenza del contratto, dell'offerta o del rinnovo; se la data in "rilevato" è lontana più di un anno o sembra del contratto, ignorala e usa quella del pagamento, oppure null.`;

function parseJsonObject(text) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch (e) { return null; }
}

function validDate(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(v + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === v ? v : null;
}

function sanitizeBillSuggestion(raw, moduli, moduloAttuale, indizio, senzaProve) {
  const keys = Object.keys(moduli || {});
  const modulo = keys.includes(raw.modulo) ? raw.modulo : (keys.includes(moduloAttuale) ? moduloAttuale : null);
  const categorie = modulo && Array.isArray(moduli[modulo] && moduli[modulo].categorie) ? moduli[modulo].categorie : [];
  let categoria = categorie.includes(raw.categoria) ? raw.categoria : null;
  // L'indizio calcolato dal programma (kWh, POD / Smc, PDR nel PDF) vale più di un'incertezza del modello:
  // se dice chiaramente luce o gas, la categoria è quella, qualunque cosa abbia risposto.
  const energy = { luce: /elettric|luce/i, gas: /\bgas\b/i }[indizio];
  if (energy) { const match = categorie.find((c) => energy.test(c)); if (match) categoria = match; }
  // Un titolo che dice solo "Gas/Luce", senza nessuna prova (né PDF né kWh/Smc nel testo), non basta: il modello tirerebbe a indovinare.
  // In quel caso la categoria di energia resta vuota, e la proposta lo dice con una confidenza bassa.
  let forzaBassa = false;
  if (senzaProve && categoria && /elettric|luce|\bgas\b/i.test(categoria)) { categoria = null; forzaBassa = true; }
  const fornitore = typeof raw.fornitore === 'string' && raw.fornitore.trim() ? raw.fornitore.replace(/[\r\n]+/g, ' ').trim().slice(0, 60) : null;
  const imp = typeof raw.importo === 'number' ? raw.importo : parseFloat(String(raw.importo).replace(',', '.'));
  const importo = Number.isFinite(imp) && imp > 0 && imp < 100000 ? Math.round(imp * 100) / 100 : null;
  const confidenza = forzaBassa ? 'bassa' : (['alta', 'media', 'bassa'].includes(raw.confidenza) ? raw.confidenza : 'bassa');
  // Una scadenza di pagamento più lontana di ~13 mesi (o molto nel passato) è quasi sempre la fine di un contratto: non si propone.
  let scadenza = validDate(raw.scadenza);
  if (scadenza && Math.abs(new Date(scadenza + 'T00:00:00Z').getTime() - Date.now()) > 400 * 86400000) scadenza = null;
  return { modulo, categoria, fornitore, importo, scadenza, confidenza };
}

router.post('/classify-bill', requireInternalSecret, async (req, res) => {
  const { tenant_slug, data } = req.body || {};
  if (!tenant_slug || !data || typeof data !== 'object') {
    return res.status(400).json({ error: 'tenant_slug e data sono obbligatori' });
  }
  if (!data.moduli || typeof data.moduli !== 'object' || Object.keys(data.moduli).length === 0) {
    return res.status(400).json({ error: 'data.moduli (con le categorie ammesse) è obbligatorio' });
  }
  if (!isProviderConfigured('mistral', tenant_slug)) {
    return res.status(503).json({ error: 'Nessuna chiave Mistral: inseriscila in Impostazioni → Assistente AI.', code: 'ai_not_configured' });
  }
  // Solo ciò che serve, ripulito dai dati personali e accorciato.
  const payload = {
    mittente: redact(String(data.mittente || '')).slice(0, 120),
    oggetto: redact(String(data.oggetto || '')).slice(0, 200),
    testo: redact(String(data.testo || '')).slice(0, 1500),
    rilevato: { importo: data.rilevato && data.rilevato.importo != null ? data.rilevato.importo : null, scadenza: data.rilevato && data.rilevato.scadenza || null },
    modulo_attuale: data.modulo_attuale || null,
    moduli: data.moduli,
  };
  const indizio = ['luce', 'gas', 'entrambi'].includes(data.indizio_energia) ? data.indizio_energia : null;
  if (indizio) payload.indizio_energia = indizio;
  // titolo ambiguo (gas e luce insieme) e nessuna prova: vedi sanitizeBillSuggestion
  const titolo = (payload.oggetto || '') + ' ' + (payload.mittente || '');
  const prove = indizio || data.allegati || /\bkWh\b|\bSmc\b|\bPOD\b|\bPDR\b|energia elettrica|gas naturale/i.test(payload.testo || '');
  const senzaProve = /\bgas\b/i.test(titolo) && /\bluce\b|elettric/i.test(titolo) && !prove;
  if (data.allegati) payload.allegati = redact(String(data.allegati)).slice(0, 1500);
  try {
    const text = await callAI('mistral', { system: BILL_SYSTEM_PROMPT, user: JSON.stringify(payload), maxTokens: 250, tenantSlug: tenant_slug });
    const raw = parseJsonObject(text);
    if (!raw) return res.status(502).json({ error: 'Risposta dell\'AI non valida' });
    res.json({ suggestion: sanitizeBillSuggestion(raw, data.moduli, data.modulo_attuale, indizio, senzaProve) });
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message || 'Chiamata AI fallita', code: e.code || undefined });
  }
});

// ─── Commento / spiegazione dei report ────────────────────────────────────────
// Il tenant manda solo totali per gruppo. 'commento' = una frase breve per il messaggio
// WhatsApp mensile; 'spiegazione' = qualche riga per chi guarda il report. Il testo torna al
// tenant solo se ogni numero scritto dal modello esiste nei dati forniti.
router.post('/explain-report', requireInternalSecret, async (req, res) => {
  const { tenant_slug, modo, data } = req.body || {};
  if (!tenant_slug || !reportAi.PROMPTS[modo]) return res.status(400).json({ error: 'tenant_slug e modo (commento | spiegazione) sono obbligatori' });
  const s = reportAi.sanitizeReport(data);
  if (s.error) return res.status(400).json({ error: s.error });
  if (!isProviderConfigured('mistral', tenant_slug)) return res.status(503).json({ error: 'Nessuna chiave Mistral: inseriscila in Impostazioni → Assistente AI.', code: 'ai_not_configured' });
  try {
    const raw = await callAI('mistral', { system: reportAi.PROMPTS[modo], user: JSON.stringify(s.payload), maxTokens: reportAi.LIMITS[modo].tokens, tenantSlug: tenant_slug });
    const text = String(raw || '').replace(/\*\*|__|^#+\s*/gm, '').trim();
    if (!text || text.length > reportAi.LIMITS[modo].chars) return res.status(502).json({ error: 'Risposta dell\'AI non utilizzabile' });
    const check = reportAi.verifyNumbers(text, s.numeri);
    if (!check.ok) return res.status(502).json({ error: 'Il commento conteneva un numero non presente nei dati (' + check.numero + '): scartato', code: 'ai_unverified' });
    res.json({ text });
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message || 'Chiamata AI fallita', code: e.code || undefined });
  }
});

// ─── "Come sta andando" ──────────────────────────────────────────────────────
// Il tenant manda il riepilogo di un mese già calcolato (solo totali). Stesse garanzie delle altre
// rotte: istruzioni sul server, tetto di spesa per tenant, ogni numero del testo verificato.
router.post('/explain-insights', requireInternalSecret, async (req, res) => {
  const { tenant_slug, data } = req.body || {};
  if (!tenant_slug) return res.status(400).json({ error: 'tenant_slug obbligatorio' });
  const isYear = data && data.period === 'anno';
  const s = isYear ? reportAi.sanitizeInsightsYear(data) : reportAi.sanitizeInsights(data);
  if (s.error) return res.status(400).json({ error: s.error });
  if (!isProviderConfigured('mistral', tenant_slug)) return res.status(503).json({ error: 'Nessuna chiave Mistral: inseriscila in Impostazioni → Assistente AI.', code: 'ai_not_configured' });
  try {
    const raw = await callAI('mistral', { system: reportAi.PROMPTS[isYear ? 'anno' : 'stato'], user: JSON.stringify(s.payload), maxTokens: reportAi.LIMITS[isYear ? 'anno' : 'stato'].tokens, tenantSlug: tenant_slug });
    const text = String(raw || '').replace(/\*\*|__|^#+\s*|^[-•]\s+/gm, '').trim();
    if (!text || text.length > reportAi.LIMITS[isYear ? 'anno' : 'stato'].chars) return res.status(502).json({ error: 'Risposta dell\'AI non utilizzabile' });
    const check = reportAi.verifyNumbers(text, s.numeri);
    if (!check.ok) return res.status(502).json({ error: 'Il testo conteneva un numero non presente nei dati (' + check.numero + '): scartato', code: 'ai_unverified' });
    res.json({ text });
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message || 'Chiamata AI fallita', code: e.code || undefined });
  }
});

// ─── "Chiedi ai tuoi dati" ───────────────────────────────────────────────────────
// Il tenant manda la domanda e il catalogo dei moduli (mai record). Torna una query strutturata, validata qui contro il catalogo;
// il tenant la rivalida e la esegue con il suo codice.
router.post('/ask-data', requireInternalSecret, async (req, res) => {
  const { tenant_slug, data } = req.body || {};
  if (!tenant_slug) return res.status(400).json({ error: 'tenant_slug obbligatorio' });
  const s = askAi.sanitizeAsk(data);
  if (s.error) return res.status(400).json({ error: s.error });
  if (!isProviderConfigured('mistral', tenant_slug)) return res.status(503).json({ error: 'Nessuna chiave Mistral: inseriscila in Impostazioni → AI.', code: 'ai_not_configured' });
  try {
    const text = await callAI('mistral', { system: askAi.ASK_PROMPT, user: JSON.stringify(s.payload), maxTokens: 300, tenantSlug: tenant_slug });
    const raw = parseJsonObject(text);
    if (!raw) return res.status(502).json({ error: 'Risposta dell\'AI non valida' });
    const v = askAi.validateQuery(raw, s.payload.catalogo);
    if (v.error) return res.status(422).json({ error: v.error, code: 'ai_unanswerable' });
    res.json({ query: v.query });
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message || 'Chiamata AI fallita', code: e.code || undefined });
  }
});

// ─── Suggerimenti di miglioramento del tenant: «spiega e proponi» su una singola osservazione ──────────────────────────────
router.post('/suggestion', requireInternalSecret, async (req, res) => {
  const { tenant_slug, data } = req.body || {};
  if (!tenant_slug) return res.status(400).json({ error: 'tenant_slug obbligatorio' });
  const s = suggestionAi.sanitizeSuggestion(data);
  if (s.error) return res.status(400).json({ error: s.error });
  if (!isProviderConfigured('mistral', tenant_slug)) return res.status(503).json({ error: 'Nessuna chiave Mistral: inseriscila in Impostazioni → AI.', code: 'ai_not_configured' });
  try {
    const text = await callAI('mistral', { system: suggestionAi.SUGGESTION_PROMPT, user: JSON.stringify(s.payload), maxTokens: 500, tenantSlug: tenant_slug });
    const raw = parseJsonObject(text);
    const v = suggestionAi.validateSuggestion(raw);
    if (v.error) return res.status(502).json({ error: v.error });
    res.json({ proposta: v.proposta });
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message || 'Chiamata AI fallita', code: e.code || undefined });
  }
});

// ─── Bot Telegram: da una frase a UNA azione scelta da un elenco chiuso ────────────────────────────────────────────────
// Il tenant manda la frase e i moduli di spesa (mai record). Torna l'intento validato; il tenant lo rivalida, risolve la riga e chiede conferma per ogni scrittura.
router.post('/bot-intent', requireInternalSecret, async (req, res) => {
  const { tenant_slug, data } = req.body || {};
  if (!tenant_slug) return res.status(400).json({ error: 'tenant_slug obbligatorio' });
  const s = botAi.sanitizeBot(data);
  if (s.error) return res.status(400).json({ error: s.error });
  if (!isProviderConfigured('mistral', tenant_slug)) return res.status(503).json({ error: 'Nessuna chiave Mistral: inseriscila in Impostazioni → AI.', code: 'ai_not_configured' });
  try {
    const text = await callAI('mistral', { system: botAi.BOT_PROMPT, user: JSON.stringify(s.payload), maxTokens: 250, tenantSlug: tenant_slug });
    const raw = parseJsonObject(text);
    if (!raw) return res.status(502).json({ error: 'Risposta dell\'AI non valida' });
    const v = botAi.validateIntent(raw, s.payload.moduli, s.payload.oggi, s.payload.report.map((r) => r.id));
    if (v.error) return res.status(422).json({ error: v.error, code: 'ai_unanswerable' });
    res.json({ intent: v.intent });
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message || 'Chiamata AI fallita', code: e.code || undefined });
  }
});

// ─── Bot Telegram: foto di uno scontrino → pochi campi validati ──────────────────────────────────────────────────────────
// Il tenant manda l'immagine (max 3 MB) e le categorie ammesse. Torna la ricevuta validata; il tenant la rivalida e chiede conferma. L'immagine non si salva qui.
router.post('/receipt', requireInternalSecret, async (req, res) => {
  const { tenant_slug, data } = req.body || {};
  if (!tenant_slug) return res.status(400).json({ error: 'tenant_slug obbligatorio' });
  const s = receiptAi.sanitizeReceipt(data);
  if (s.error) return res.status(400).json({ error: s.error });
  if (!isProviderConfigured('mistral', tenant_slug)) return res.status(503).json({ error: 'Nessuna chiave Mistral: inseriscila in Impostazioni → AI.', code: 'ai_not_configured' });
  try {
    const text = await callAI('mistral', { system: receiptAi.RECEIPT_PROMPT, user: receiptAi.promptFor(s.payload.categorie), images: [{ mime: s.payload.mime, base64: s.payload.base64 }], maxTokens: 300, timeoutMs: 40000, tenantSlug: tenant_slug });
    const raw = parseJsonObject(text);
    if (!raw) return res.status(502).json({ error: 'Risposta dell\'AI non valida' });
    const v = receiptAi.validateReceipt(raw, s.payload.categorie);
    if (v.error) return res.status(422).json({ error: v.error, code: v.error === 'illeggibile' ? 'ai_unreadable' : 'ai_unanswerable' });
    res.json({ ricevuta: v.ricevuta });
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message || 'Chiamata AI fallita', code: e.code || undefined });
  }
});

module.exports = router;
