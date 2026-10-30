const express = require('express');
const { callAI, isProviderConfigured } = require('../lib/ai-providers');
const aiKey = require('../lib/ai-key');
const db = require('../db');
const { logAudit } = require('../audit-log');
const { status: budgetStatus } = require('../lib/ai-budget');
const { redact } = require('../lib/ai-redact');
const reportAi = require('../lib/ai-report');
const askAi = require('../lib/ai-ask');
const { requireTenantOrSharedSecret } = require('../lib/tenant-auth');
const botAi = require('../lib/ai-bot');
const receiptAi = require('../lib/ai-receipt');
const payslipImageAi = require('../lib/ai-payslip-image');

const suggestionAi = require('../lib/ai-suggestion');
const moduleGapAi = require('../lib/ai-module-gap');
const router = express.Router();

// Sostituisce requireInternalSecret (26/10/2026, chiusura di un gap reale —
// vedi lib/tenant-auth.js): queste rotte decidono QUALE tenant leggere/
// addebitare in base a tenant_slug, quindi devono sapere con certezza chi sta
// chiamando, non solo "qualcuno con il segreto condiviso".
const slugParam = (req) => (req.body && req.body.tenant_slug) || req.query.tenant_slug;
const requireTenant = requireTenantOrSharedSecret(['tenant-ai'], slugParam);

// Stato del tetto di spesa del mese (lo mostra la pagina delle impostazioni del tenant).
router.get('/budget', requireTenant, (req, res) => {
  res.json(budgetStatus(new Date(), req.tenantSlug || null));
});

// ─── Chiave Mistral del tenant ────────────────────────────────────────────────
// Il tenant la inserisce dalle sue impostazioni; qui resta cifrata e non viene mai restituita.
const tenantExists = (slug) => !!slug && !!db.prepare('SELECT 1 FROM tenants WHERE slug = ?').get(slug);

router.get('/key', requireTenant, (req, res) => {
  res.json(aiKey.keyStatus(req.tenantSlug || null));
});

router.put('/key', requireTenant, async (req, res) => {
  const { key } = req.body || {};
  const tenant_slug = req.tenantSlug;
  if (!tenantExists(tenant_slug)) return res.status(404).json({ error: 'Tenant sconosciuto' });
  const k = String(key || '').trim();
  if (k.length < 16 || /\s/.test(k)) return res.status(400).json({ error: 'La chiave non sembra valida (troppo corta o con spazi).' });
  const v = await aiKey.validateMistralKey(k);
  if (!v.ok) return res.status(400).json({ error: v.reason });
  aiKey.setTenantKey(tenant_slug, k);
  logAudit('tenant:' + tenant_slug, 'ai.key.set', tenant_slug, null);
  res.json(aiKey.keyStatus(tenant_slug));
});

router.delete('/key', requireTenant, (req, res) => {
  const slug = req.tenantSlug;
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

router.post('/classify-bill', requireTenant, async (req, res) => {
  const { data } = req.body || {};
  const tenant_slug = req.tenantSlug;
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

// ─── Lettura busta paga ───────────────────────────────────────────────────────
// Il tenant manda solo l'estratto testuale del PDF (dati identificativi già tolti da redact());
// l'AI PROPONE periodo, lordo, netto, ore pagate e trattenute. Chi l'ha caricata confronta le ore
// pagate con quelle timbrate nello stesso mese: qui non si scrive niente, solo si legge un documento.
const PAYSLIP_SYSTEM_PROMPT = `Sei un assistente che legge buste paga italiane. Ricevi un JSON con "testo" (l'estratto testuale del PDF della busta paga, con i dati più identificativi come IBAN, codice fiscale e numeri lunghi già tolti). Rispondi SOLO con un oggetto JSON, senza altro testo, con questi campi: "periodo" (il mese di competenza della busta, nel formato AAAA-MM-GG usando il primo giorno del mese, oppure null se non lo trovi), "datore_lavoro" (il nome del datore di lavoro/azienda in busta, oppure null), "lordo" (la retribuzione lorda del mese, numero con il punto decimale, oppure null), "netto" (il netto in busta, l'importo effettivamente pagato al lavoratore, numero con il punto decimale, oppure null), "ore_pagate" (il totale delle ore pagate nel periodo, ordinarie più straordinarie, come numero decimale, es. 168.5, oppure null se non lo trovi scritto chiaramente), "trattenute" (il totale di contributi e imposte trattenuti, numero con il punto decimale, oppure null), "ferie_saldo" (il saldo ferie residue a fine periodo, in ore o giorni come indicato in busta, numero oppure null), "permessi_saldo" (il saldo permessi/ex-festività residui, numero oppure null), "rol_saldo" (il saldo ROL/banca ore residui, numero oppure null), "voci" (una stringa con TUTTE le voci della busta — ogni riga del cedolino con codice, descrizione e importo, una per riga, es. "1.0001 Retribuzione ordinaria: 1.657,48" — leggi tutto il dettaglio, non solo i totali; stringa vuota se non riesci a leggere le righe), "confidenza" ("alta", "media" o "bassa"). Non inventare: se un dato non è scritto chiaramente nel testo scrivi null.`;

function sanitizePayslip(raw) {
  const num = (v, max) => { const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) && n >= 0 && n < max ? Math.round(n * 100) / 100 : null; };
  const str = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
  let periodo = validDate(raw.periodo);
  if (periodo) periodo = periodo.slice(0, 7) + '-01';
  return {
    periodo,
    datore_lavoro: str(raw.datore_lavoro, 200),
    lordo: num(raw.lordo, 100000),
    netto: num(raw.netto, 100000),
    ore_pagate: num(raw.ore_pagate, 800),
    trattenute: num(raw.trattenute, 100000),
    ferie_saldo: num(raw.ferie_saldo, 2000),
    permessi_saldo: num(raw.permessi_saldo, 2000),
    rol_saldo: num(raw.rol_saldo, 2000),
    voci: str(raw.voci, 4000),
    confidenza: ['alta', 'media', 'bassa'].includes(raw.confidenza) ? raw.confidenza : 'bassa',
  };
}

router.post('/payslip', requireTenant, async (req, res) => {
  const { data } = req.body || {};
  const tenant_slug = req.tenantSlug;
  if (!tenant_slug || !data || typeof data !== 'object') return res.status(400).json({ error: 'tenant_slug e data sono obbligatori' });
  const daFoto = typeof data.image_base64 === 'string' && data.image_base64;
  if (!daFoto && (typeof data.testo !== 'string' || !data.testo.trim())) {
    return res.status(400).json({ error: 'data.testo (dal PDF) o data.image_base64 (dalla foto) sono obbligatori' });
  }
  if (!isProviderConfigured('mistral', tenant_slug)) {
    return res.status(503).json({ error: 'Nessuna chiave Mistral: inseriscila in Impostazioni → Assistente AI.', code: 'ai_not_configured' });
  }
  try {
    let text;
    if (daFoto) {
      const s = payslipImageAi.sanitizePayslipImage(data);
      if (s.error) return res.status(400).json({ error: s.error });
      text = await callAI('mistral', { system: payslipImageAi.PAYSLIP_IMAGE_PROMPT, user: 'Leggi la busta paga nella foto.', images: [{ mime: s.payload.mime, base64: s.payload.base64 }], maxTokens: 800, timeoutMs: 40000, tenantSlug: tenant_slug });
    } else {
      const testo = redact(String(data.testo)).slice(0, 4000);
      text = await callAI('mistral', { system: PAYSLIP_SYSTEM_PROMPT, user: JSON.stringify({ testo }), maxTokens: 800, tenantSlug: tenant_slug });
    }
    const raw = parseJsonObject(text);
    if (!raw) return res.status(502).json({ error: 'Risposta dell\'AI non valida' });
    if (raw.leggibile === false) return res.status(422).json({ error: 'Non sembra una busta paga leggibile.', code: 'ai_unreadable' });
    res.json({ suggestion: sanitizePayslip(raw) });
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message || 'Chiamata AI fallita', code: e.code || undefined });
  }
});

// ─── Bot Telegram: domanda libera su UNA busta paga già registrata ("perché mi hanno trattenuto
// così tanto", "cos'è questa voce", "quanto ho preso di straordinari") ─────────────────────────
// Il tenant manda solo il dettaglio di quella riga (mai l'intero storico): le voci lette dal cedolino
// più i totali già salvati. Stessa garanzia delle altre spiegazioni: ogni numero nel testo deve
// comparire nei dati mandati, altrimenti scartato.
const PAYSLIP_EXPLAIN_PROMPT = `Sei un assistente che spiega una singola busta paga italiana a chi la sta guardando. Ricevi un JSON con "domanda" (cosa vuole sapere), "periodo" (mese), e i dati di quella busta: "netto","lordo","ore_pagate","trattenute","ferie_saldo","permessi_saldo","rol_saldo" (numeri, possono mancare) e "voci" (il testo con le righe del cedolino, puo' essere vuoto). Rispondi in italiano, massimo 80 parole, usando SOLO i numeri e le voci presenti nei dati: se la domanda chiede qualcosa che non si trova nei dati, dillo chiaramente invece di inventare. Niente markdown, niente elenchi puntati, testo semplice.`;
function sanitizePayslipExplain(data) {
  if (!data || typeof data !== 'object') return { error: 'data obbligatorio' };
  const domanda = String(data.domanda || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 200);
  if (domanda.length < 3) return { error: 'Domanda mancante' };
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return { payload: {
    domanda: redact(domanda),
    periodo: String(data.periodo_label || data.periodo || '').slice(0, 40),
    netto: num(data.netto), lordo: num(data.lordo), ore_pagate: num(data.ore_pagate), trattenute: num(data.trattenute),
    ferie_saldo: num(data.ferie_saldo), permessi_saldo: num(data.permessi_saldo), rol_saldo: num(data.rol_saldo),
    voci: redact(String(data.voci || '').slice(0, 4000)),
  } };
}
router.post('/payslip-explain', requireTenant, async (req, res) => {
  const { data } = req.body || {};
  const tenant_slug = req.tenantSlug;
  if (!tenant_slug) return res.status(400).json({ error: 'tenant_slug obbligatorio' });
  const s = sanitizePayslipExplain(data);
  if (s.error) return res.status(400).json({ error: s.error });
  if (!isProviderConfigured('mistral', tenant_slug)) return res.status(503).json({ error: 'Nessuna chiave Mistral: inseriscila in Impostazioni → Assistente AI.', code: 'ai_not_configured' });
  try {
    const raw = await callAI('mistral', { system: PAYSLIP_EXPLAIN_PROMPT, user: JSON.stringify(s.payload), maxTokens: 220, tenantSlug: tenant_slug });
    const text = String(raw || '').replace(/\*\*|__|^#+\s*|^[-•]\s+/gm, '').trim();
    if (!text || text.length > 500) return res.status(502).json({ error: 'Risposta dell\'AI non utilizzabile' });
    const numeri = [s.payload.netto, s.payload.lordo, s.payload.ore_pagate, s.payload.trattenute, s.payload.ferie_saldo, s.payload.permessi_saldo, s.payload.rol_saldo]
      .filter((n) => n != null)
      .concat((s.payload.voci.match(/\d[\d.,]*/g) || []).map((v) => reportAi.parseNum(v)).filter((n) => n != null));
    const check = reportAi.verifyNumbers(text, numeri);
    if (!check.ok) return res.status(502).json({ error: 'Il testo conteneva un numero non presente nei dati (' + check.numero + '): scartato', code: 'ai_unverified' });
    res.json({ text });
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message || 'Chiamata AI fallita', code: e.code || undefined });
  }
});

// ─── Commento / spiegazione dei report ────────────────────────────────────────
// Il tenant manda solo totali per gruppo. 'commento' = una frase breve per il messaggio
// WhatsApp mensile; 'spiegazione' = qualche riga per chi guarda il report. Il testo torna al
// tenant solo se ogni numero scritto dal modello esiste nei dati forniti.
router.post('/explain-report', requireTenant, async (req, res) => {
  const { modo, data } = req.body || {};
  const tenant_slug = req.tenantSlug;
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
router.post('/explain-insights', requireTenant, async (req, res) => {
  const { data } = req.body || {};
  const tenant_slug = req.tenantSlug;
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
router.post('/ask-data', requireTenant, async (req, res) => {
  const { data } = req.body || {};
  const tenant_slug = req.tenantSlug;
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
router.post('/suggestion', requireTenant, async (req, res) => {
  const { data } = req.body || {};
  const tenant_slug = req.tenantSlug;
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

// ─── «Ti manca un modulo?»: una volta alla settimana, guarda l'insieme dei moduli installati ────────────────────────────
// (mai i valori delle righe) e propone UNA cosa tra: installa un modulo già pronto in Libreria, costruiscine uno nuovo,
// o niente. Il catalogo della Libreria lo legge il server (mai il tenant), così non si può proporre un id inventato né
// un modulo che il tenant ha già — installedRegistryIds, mandato dal tenant, lo esclude dal catalogo mandato all'AI.
router.post('/module-gap', requireTenant, async (req, res) => {
  const { data } = req.body || {};
  const tenant_slug = req.tenantSlug;
  if (!tenant_slug) return res.status(400).json({ error: 'tenant_slug obbligatorio' });
  const s = moduleGapAi.sanitizeModuleGap(data);
  if (s.error) return res.status(400).json({ error: s.error });
  if (!isProviderConfigured('mistral', tenant_slug)) return res.status(503).json({ error: 'Nessuna chiave Mistral: inseriscila in Impostazioni → AI.', code: 'ai_not_configured' });
  const gia = new Set((Array.isArray(data.installed_registry_ids) ? data.installed_registry_ids : []).map(Number).filter(Number.isInteger));
  const libreria = require('../lib/analysis').libraryModules().filter((m) => !gia.has(m.id));
  if (!libreria.length) return res.json({ proposta: { tipo: 'nessuna', motivo: '' } }); // niente da proporre: tutta la libreria è già installata
  const payload = { ...s.payload, libreria: libreria.map((m) => ({ id: m.id, nome: m.name, descrizione: m.description })) };
  try {
    const text = await callAI('mistral', { system: moduleGapAi.MODULE_GAP_PROMPT, user: JSON.stringify(payload), maxTokens: 350, tenantSlug: tenant_slug });
    const raw = parseJsonObject(text);
    const v = moduleGapAi.validateModuleGap(raw, libreria);
    if (v.error) return res.status(502).json({ error: v.error });
    res.json({ proposta: v.proposta });
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message || 'Chiamata AI fallita', code: e.code || undefined });
  }
});

// ─── Bot Telegram: da una frase a UNA azione scelta da un elenco chiuso ────────────────────────────────────────────────
// Il tenant manda la frase e i moduli di spesa (mai record). Torna l'intento validato; il tenant lo rivalida, risolve la riga e chiede conferma per ogni scrittura.
router.post('/bot-intent', requireTenant, async (req, res) => {
  const { data } = req.body || {};
  const tenant_slug = req.tenantSlug;
  if (!tenant_slug) return res.status(400).json({ error: 'tenant_slug obbligatorio' });
  const s = botAi.sanitizeBot(data);
  if (s.error) return res.status(400).json({ error: s.error });
  if (!isProviderConfigured('mistral', tenant_slug)) return res.status(503).json({ error: 'Nessuna chiave Mistral: inseriscila in Impostazioni → AI.', code: 'ai_not_configured' });
  try {
    const text = await callAI('mistral', { system: botAi.BOT_PROMPT, user: JSON.stringify(s.payload), maxTokens: 250, tenantSlug: tenant_slug });
    const raw = parseJsonObject(text);
    if (!raw) return res.status(502).json({ error: 'Risposta dell\'AI non valida' });
    const v = botAi.validateIntent(raw, s.payload.moduli, s.payload.oggi, s.payload.report.map((r) => r.id), s.payload.moduli_entrata);
    if (v.error) return res.status(422).json({ error: v.error, code: 'ai_unanswerable' });
    res.json({ intent: v.intent });
  } catch (e) {
    res.status(e.status || 502).json({ error: e.message || 'Chiamata AI fallita', code: e.code || undefined });
  }
});

// ─── Bot Telegram: foto di uno scontrino → pochi campi validati ──────────────────────────────────────────────────────────
// Il tenant manda l'immagine (max 3 MB) e le categorie ammesse. Torna la ricevuta validata; il tenant la rivalida e chiede conferma. L'immagine non si salva qui.
router.post('/receipt', requireTenant, async (req, res) => {
  const { data } = req.body || {};
  const tenant_slug = req.tenantSlug;
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
