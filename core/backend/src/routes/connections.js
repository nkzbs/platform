const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('./auth');
const { logAudit } = require('../audit-log');
const { getRequiredConnectors } = require('../schema-v3');
const whatsapp = require('../whatsapp');

const router = express.Router();

// Catalogo statico dei servizi collegabili — stesso elenco già mostrato nella vecchia
// pagina Integrazioni, spostato qui perché ora è puro dato di configurazione, non più
// accoppiato alla UI. Il frontend continua a mostrare nome/icona/colore/azioni, ma lo
// stato "connesso" ora vive nel DB, non in uno useState che si perde al reload.
// cred_fields: campi del form credenziali mostrato dal frontend (StorePage) quando
// si collega questa integrazione — prima erano ridefiniti a mano anche lì
// (CRED_FIELDS), una seconda copia scollegata da questo elenco. Ora il frontend li
// legge da qui (vedi sotto, incluso nella risposta di GET /) — un solo posto da cui
// aggiungere un'integrazione nuova, non due. 'google' non ha cred_fields: passa da
// un vero OAuth2 (routes/google-oauth.js), non da un form di credenziali generico.
const CATALOG = [
  { id: 'fatture_in_cloud', name: 'Fatture in Cloud', desc: 'Fatturazione elettronica e SDI', color: '#F59E0B', icon: 'file',
    actions: ['Crea fattura', 'Invia a SDI', 'Registra pagamento', 'Crea nota credito'],
    cred_fields: [
      { key: 'access_token', label: 'Access Token', placeholder: 'Bearer token OAuth2' },
      { key: 'company_id', label: 'Company ID', placeholder: 'ID azienda FiC' },
    ] },
  { id: 'whatsapp', name: 'WhatsApp Business', desc: 'Messaggistica diretta ai clienti', color: '#25D366', icon: 'cpu',
    actions: ['Invia messaggio', 'Invia template', 'Invia documento'],
    cred_fields: [
      { key: 'token', label: 'Bearer Token', placeholder: 'EAABx...' },
      { key: 'phone_id', label: 'Phone Number ID', placeholder: '1234567890' },
      { key: 'to', label: 'Destinatario (numero)', placeholder: '+39...' },
    ] },
  { id: 'whatsapp_callmebot', name: 'WhatsApp (CallMeBot)', desc: 'Notifiche dirette via CallMeBot — multi-destinatario per tag', color: '#25D366', icon: 'message-circle',
    actions: ['Invia notifica'],
    cred_fields: [{ key: 'api_key', label: 'CallMeBot API Key', placeholder: 'ottenuta scrivendo al bot da telefono' }] },
  { id: 'slack', name: 'Slack', desc: 'Notifiche e alert sul canale', color: '#4A154B', icon: 'zap',
    actions: ['Invia notifica', 'Invia alert', 'Post su canale'],
    cred_fields: [{ key: 'webhook_url', label: 'Webhook URL', placeholder: 'https://hooks.slack.com/services/...' }] },
  { id: 'google', name: 'Google Workspace', desc: 'Drive, Calendar, Gmail', color: '#4285F4', icon: 'link',
    actions: ['Allega documento', 'Crea evento', 'Invia email'],
    cred_fields: [] },
  { id: 'stripe', name: 'Stripe', desc: 'Pagamenti online', color: '#635BFF', icon: 'credit-card',
    actions: ['Crea payment link', 'Verifica pagamento'],
    cred_fields: [{ key: 'secret_key', label: 'Secret Key', placeholder: 'sk_live_...' }] },
  { id: 'mailchimp', name: 'Mailchimp', desc: 'Email marketing', color: '#FFE01B', icon: 'users',
    actions: ['Aggiungi a lista', 'Invia campagna'],
    cred_fields: [
      { key: 'api_key', label: 'API Key', placeholder: 'abc123...-us6' },
      { key: 'list_id', label: 'List ID', placeholder: 'ID lista' },
    ] },
  // Email transazionale (2026-09-05, richiesto dall'utente: "il form di
  // contatto deve mandare una mail") — usata da routes/site.js quando arriva
  // un lead dal blocco 'form' del Sito Web. Stesso meccanismo di
  // WhatsApp/Slack/Mailchimp sopra (credenziali reali in questa tabella, mai
  // finte): senza questa connessione configurata il lead viene comunque
  // salvato, solo l'email non parte (mai un falso "inviata").
  { id: 'email_resend', name: 'Email (Resend)', desc: 'Invio email dal modulo di contatto del Sito Web', color: '#000000', icon: 'mail',
    actions: ['Invia email da modulo di contatto'],
    cred_fields: [
      { key: 'api_key', label: 'API Key', placeholder: 're_...' },
      { key: 'from_email', label: 'Indirizzo mittente (verificato su Resend)', placeholder: 'notifiche@tuodominio.it' },
    ] },
  // 2026-11-01, verticale Mediazione immobiliare (zucca): ricerca immobili per codice
  // fiscale, quotazioni di mercato e visure catastali — marketplace italiano di API,
  // nessuna autenticazione OAuth, solo una chiave. Ambiente sandbox e produzione hanno
  // basi URL diverse (vedi lib/openapi-it.js): il campo "ambiente" sceglie quale usare,
  // così si può provare senza rischiare una chiamata vera a pagamento per sbaglio.
  { id: 'openapi_it', name: 'OpenAPI.it — Immobili', desc: 'Ricerca immobili per CF, quotazioni di mercato, visure catastali', color: '#0EA5E9', icon: 'home',
    actions: ['Ricerca immobili per codice fiscale', 'Quotazioni di mercato', 'Visura catastale'],
    cred_fields: [
      { key: 'email', label: 'Email dell\'account openapi.com', placeholder: 'tua@email.it' },
      { key: 'api_key', label: 'API Key', placeholder: 'ottenuta dalla console openapi.com' },
      { key: 'ambiente', label: 'Ambiente ("sandbox" o "produzione")', placeholder: 'sandbox' },
    ] },
];

// Mostra solo ciò che serve: le integrazioni già collegate e quelle richieste dai
// moduli installati (altrimenti un modulo che chiede un collegamento non avrebbe
// dove configurarlo). Le altre del catalogo restano disponibili alle rotte
// /:id/credentials e /:id/toggle, ma non riempiono più l'elenco.
function requiredByInstalledModules() {
  const ids = new Set();
  for (const m of db.prepare('SELECT schema_json FROM modules WHERE installed = 1').all()) {
    try { getRequiredConnectors(m.schema_json).forEach((id) => ids.add(id)); } catch (e) { /* schema non leggibile: nessun requisito */ }
  }
  return ids;
}

router.get('/', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT integration_id, connected, connected_at, credentials FROM connections').all();
  const byId = Object.fromEntries(rows.map((r) => [r.integration_id, r]));
  const required = requiredByInstalledModules();
  const visible = CATALOG.filter((c) => (byId[c.id] && byId[c.id].connected) || required.has(c.id));
  res.json(visible.map((c) => {
    const row = byId[c.id] || {};
    let creds = null;
    if (row.credentials) creds = require('../secrets-at-rest').unseal(row.credentials)
    // Maschera i valori delle credenziali — il frontend sa solo SE sono impostate, non il valore reale
    const credsMasked = creds ? Object.fromEntries(Object.entries(creds).map(([k, v]) => [k, v ? '••••' : ''])) : null;
    return { ...c, connected: !!(row.connected), connected_at: row.connected_at, credentials_set: !!creds, credentials_masked: credsMasked };
  }));
});

// Per queste integrazioni "simulate" (nessun vero handshake OAuth) salvare le
// credenziali dalla card del modulo È l'atto di connettersi — un secondo click
// separato su "Connetti" sarebbe solo attrito senza uno scopo reale.
router.put('/:id/credentials', requireAuth, requireAdmin, (req, res) => {
  if (!CATALOG.some((c) => c.id === req.params.id)) return res.status(404).json({ error: 'Connessione non trovata' });
  db.prepare(`
    INSERT INTO connections (integration_id, connected, credentials, connected_at) VALUES (?, 1, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(integration_id) DO UPDATE SET credentials = excluded.credentials, connected = 1, connected_at = excluded.connected_at
  `).run(req.params.id, require('../secrets-at-rest').seal(req.body || {}));
  logAudit(req.user.username, 'connection.credentials_saved', req.params.id, null);
  res.json({ ok: true });
});

// Connetti/disconnetti — resta SIMULATO (nessun vero OAuth: richiederebbe le
// credenziali app reali di ogni servizio, che questo prototipo non ha). Onesto e
// dichiarato: quello che cambia davvero è solo la persistenza dello stato, prima
// perso ad ogni reload perché era React state locale.
// Messaggio di prova WhatsApp: manda un testo ai destinatari attivi e dice, per ciascuno, se è
// partito davvero (CallMeBot risponde 200 anche quando rifiuta, vedi whatsapp.js).
router.post('/whatsapp_callmebot/test', requireAuth, requireAdmin, async (req, res) => {
  const row = db.prepare("SELECT credentials FROM connections WHERE integration_id = 'whatsapp_callmebot'").get();
  const creds = row ? require('../secrets-at-rest').unseal(row.credentials) : null;
  if (!creds || !creds.api_key) return res.status(400).json({ error: 'Collega prima WhatsApp (CallMeBot) con la sua chiave' });
  const destinatari = require('../notification-settings').recipientsForTag(null);
  if (!destinatari.length) return res.status(400).json({ error: 'Nessun destinatario attivo: aggiungine uno in "Destinatari WhatsApp"' });
  const out = await whatsapp.sendAll({ destinatari, testo: 'Prova di Platform: se leggi questo messaggio, le notifiche WhatsApp funzionano.', apiKey: creds.api_key, kind: 'prova' });
  logAudit(req.user.username, 'connection.whatsapp_test', 'whatsapp_callmebot', { esito: out.esito });
  res.json(out);
});

// Ultimi invii WhatsApp, con l'esito vero per destinatario (per capire se un messaggio è davvero partito).
router.get('/whatsapp_callmebot/log', requireAuth, requireAdmin, (req, res) => {
  res.json(whatsapp.recentLog(req.query.limit));
});

// Prova di collegamento OpenAPI.it — una vera chiamata (non un controllo finto), così
// si vede subito se email/API key/ambiente sono giusti prima di usarli in un modulo.
// Ricerca per CF separata (async: non si aspetta qui l'esito, solo che la richiesta parta).
router.post('/openapi_it/test', requireAuth, requireAdmin, async (req, res) => {
  const openapiIt = require('../lib/openapi-it');
  try {
    const out = await openapiIt.valoreAlMq({ address: (req.body && req.body.address) || 'Piazza del Duomo, Milano', forSale: true, type: 20 });
    res.json({ ok: true, esempio: out.data });
  } catch (e) { res.status(e.status || 500).json({ ok: false, error: e.message, code: e.code }); }
});

// Quali servizi di OpenAPI.it la chiave collegata può usare: una lettura gratuita per servizio, mai un controllo a pagamento (vedi lib/openapi-it.js).
router.post('/openapi_it/servizi', requireAuth, requireAdmin, async (req, res) => {
  try { res.json({ ok: true, ...(await require('../lib/openapi-it').verificaServizi()) }); }
  catch (e) { res.status(e.status || 500).json({ ok: false, error: e.message, code: e.code }); }
});

// Le spese di OpenAPI.it (stima di Platform sui prezzi di listino): contatore del mese, tetto, prezzi e ultime richieste; e le impostazioni (tetto mensile, prezzi personalizzati).
router.get('/openapi_it/spese', requireAuth, requireAdmin, (req, res) => {
  const spese = require('../lib/openapi-spese');
  res.json({ ...spese.riepilogo(), ambiente: spese.ambiente(), prezzi: spese.elencoPrezzi() });
});
router.put('/openapi_it/impostazioni', requireAuth, requireAdmin, (req, res) => {
  const spese = require('../lib/openapi-spese');
  const out = spese.impostazioni(req.body || {});
  if (out.errore) return res.status(400).json({ error: out.errore });
  res.json({ ok: true, ...spese.riepilogo(), ambiente: spese.ambiente(), prezzi: spese.elencoPrezzi() });
});

router.post('/:id/toggle', requireAuth, requireAdmin, (req, res) => {
  if (!CATALOG.some((c) => c.id === req.params.id)) return res.status(404).json({ error: 'Connessione non trovata' });
  const existing = db.prepare('SELECT connected FROM connections WHERE integration_id = ?').get(req.params.id);
  const next = existing ? (existing.connected ? 0 : 1) : 1;
  db.prepare(`
    INSERT INTO connections (integration_id, connected, connected_at) VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(integration_id) DO UPDATE SET connected = excluded.connected, connected_at = excluded.connected_at
  `).run(req.params.id, next);
  logAudit(req.user.username, next ? 'connection.connect' : 'connection.disconnect', req.params.id, null);
  res.json({ ok: true, connected: !!next });
});

module.exports = router;
