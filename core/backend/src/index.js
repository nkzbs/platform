require('../../../shared/require-strong-secrets').requireStrongSecrets([
  { name: 'JWT_SECRET', value: process.env.JWT_SECRET, badDefault: 'changeme' },
  { name: 'INTERNAL_API_SECRET', value: process.env.INTERNAL_API_SECRET, badDefault: 'changeme_internal' },
  // Trovato mancante qui il 2026-10-14 (segnalato dall'utente): JWT_SECRET e
  // INTERNAL_API_SECRET erano già protetti da questo gate, ma non la chiave
  // che crypto-fields.js usa per cifrare i campi 'encrypted' e, tramite
  // secrets-at-rest.js, le credenziali dei collegamenti e i segreti del 2FA —
  // un avvio in produzione senza ENCRYPTION_KEY cifrava tutto con un valore
  // di default noto (chiunque legga il sorgente lo conosce), apparendo
  // comunque "avviato correttamente". Il default resta in crypto-fields.js
  // (stesso pattern di JWT_SECRET/INTERNAL_API_SECRET sopra: comodo in
  // sviluppo, qui diventa fatale in produzione).
  { name: 'ENCRYPTION_KEY', value: process.env.ENCRYPTION_KEY, badDefault: 'platform-default-key-change-in-prod' },
]);

const express = require('express');
const cors = require('cors');
const db = require('./db');

const authRoutes = require('./routes/auth');
const webauthnRoutes = require('./routes/webauthn');
const usersRoutes = require('./routes/users');
const modulesRoutes = require('./routes/modules');
const recordsRoutes = require('./routes/records');
const builderRoutes = require('./routes/builder');
const uploadsRoutes = require('./routes/uploads');
const connectionsRoutes = require('./routes/connections');
const automationsRoutes = require('./routes/automations');
const dashboardRoutes = require('./routes/dashboard');
const auditRoutes = require('./routes/audit');
const securityStatusRoutes = require('./routes/security-status');
const rolesRoutes = require('./routes/roles');
const { startScheduler } = require('./scheduler');
const { startGmailPoller } = require('./gmail-poller');
const { startDrivePoller } = require('./drive-poller');
const aiRoutes = require('./routes/ai');
const notificationSettingsRoutes = require('./routes/notification-settings');
const recordOwnerRoutes = require('./routes/record-owner');
const fieldOptionsRoutes = require('./routes/field-options');
const optionListsRoutes = require('./routes/option-lists');
const telegramRoutes = require('./routes/telegram');
const insightsRoutes = require('./routes/insights');
const bankRoutes = require('./routes/bank');
const featuresRoutes = require('./routes/features');
const features = require('./features');
const moduleRolesRoutes = require('./routes/module-roles');
const bustaPagaReportRoutes = require('./routes/busta-paga-report');
const drivePollerRoutes = require('./routes/drive-poller');
const apiTokensRoutes = require('./routes/api-tokens');
const debitoCasaRoutes = require('./routes/debito-casa');
const moduleAiRoutes = require('./routes/module-ai');
const smistaRoutes = require('./routes/smista');
const moduleRoles = require('./module-roles');
const reportsRoutes = require('./routes/reports');
const internalSetupRoutes = require('./routes/internal-setup');
const suggestionsRoutes = require('./routes/suggestions');
const setupWizardRoutes = require('./routes/setup-wizard');
const exportServerRoutes = require('./routes/export-server');
const inviteRoutes = require('./routes/invites');
const { startSuggestions } = require('./suggestions');
const { startModuleGap } = require('./module-gap');
const { startReports } = require('./reports');
const { startAvvisi } = require('./avvisi');
const { startMonitor } = require('./monitor');
const { startAuditRetentionScheduler } = require('./audit-retention-scheduler');
const m2mRoutes = require('./routes/m2m');
const notificationsRoutes = require('./routes/notifications');
const searchRoutes = require('./routes/search');
const backupRoutes = require('./routes/backup');
const settingsRoutes = require('./routes/settings');
const googleOAuthRoutes = require('./routes/google-oauth');
const { siteAdminRouter, sitePublicRouter, rootPublicRouter } = require('./routes/site');
const { logError } = require('./error-log');
const { rateLimit } = require('./rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors(require('../../../shared/cors-origin').buildCorsOptions(process.env.CLOUDFLARE_ZONE_NAME)));
app.use(require('../../../shared/security-headers').applySecurityHeaders);
// limit:'5mb' (2026-09-06) — il default di express.json (100kb) faceva
// fallire con 500 il salvataggio di una pagina Sito Web appena una foto
// veniva incollata come data:URI base64 (bug reale, trovato salvando la
// foto vera dell'hero di Nico Caffè: ~68KB di file, ~92KB di base64, oltre
// il limite). 5mb basta per qualche foto per pagina senza aprire la porta
// a upload multi-MB arbitrari.
app.use(express.json({ limit: '5mb' }));

// Limite generico su tutta l'API — non pensato per interferire con l'uso
// normale (poll notifiche ogni 30s, log attività ogni 10s, refresh dashboard),
// solo per contenere uno script impazzito o un abuso grossolano. Il login ha
// il proprio limite più stretto a parte (vedi routes/auth.js) — questo qui
// serve solo da rete di sicurezza generale, non da prima linea per il brute-force.
const apiGlobalLimiter = rateLimit({ windowMs: 60 * 1000, max: 600, message: 'Troppe richieste da questo indirizzo, rallenta', name: 'api-global' });

const routeMounts = [
  ['/auth', authRoutes],
  ['/webauthn', webauthnRoutes],
  ['/users', usersRoutes],
  ['/modules', modulesRoutes],
  ['/records', recordsRoutes],
  ['/builder', builderRoutes],
  ['/receipt-match', require('./routes/receipt-match')],
  ['/uploads', uploadsRoutes],
  ['/connections', connectionsRoutes],
  ['/automations', automationsRoutes],
  ['/dashboard', dashboardRoutes],
  ['/audit-log', auditRoutes],
  ['/security-status', securityStatusRoutes],
  ['/roles', rolesRoutes],
  ['/m2m', m2mRoutes],
  ['/notifications', notificationsRoutes],
  ['/search', searchRoutes],
  ['/backup', backupRoutes],
  ['/settings', settingsRoutes],
  ['/integrazioni/google', googleOAuthRoutes],
  ['/ai', aiRoutes],
  ['/insights', insightsRoutes],
  ['/bank', bankRoutes],
  ['/features', featuresRoutes],
  ['/module-roles', moduleRolesRoutes],
  ['/busta-paga-report', bustaPagaReportRoutes],
  ['/drive-poller', drivePollerRoutes],
  ['/api-tokens', apiTokensRoutes],
  ['/debito-casa', debitoCasaRoutes],
  ['/module-ai', moduleAiRoutes],
  ['/smista', smistaRoutes],
  ['/record-owner', recordOwnerRoutes],
  ['/field-options', fieldOptionsRoutes],
  ['/option-lists', optionListsRoutes],
  ['/telegram', telegramRoutes],
  ['/', notificationSettingsRoutes],
  ['/reports', reportsRoutes],
  ['/internal-setup', internalSetupRoutes],
  ['/suggestions', suggestionsRoutes],
  ['/setup-wizard', setupWizardRoutes],
  ['/export-server', exportServerRoutes],
  ['/invites', inviteRoutes.admin],
  ['/internal-invite', inviteRoutes.interno],
  ['/public-invite', inviteRoutes.pubblico],
  ['/site-pages', siteAdminRouter],
];
app.use('/api', apiGlobalLimiter);
for (const [path, routerModule] of routeMounts) {
  app.use('/api' + path, routerModule);
}
// Foto profilo (2026-10-31) — serviti come file statici pubblici, non da una route
// autenticata: un <img src> non manda mai l'header Authorization, e il nome file è
// un UUID casuale (mai l'id utente), quindi niente di enumerable da proteggere qui.
app.use('/api/avatars', require('express').static(require('./lib/avatar-storage').AVATAR_DIR));

// Sito Web pubblico (2026-09-04) — deliberatamente FUORI dal prefisso /api: un
// visitatore/crawler non deve mai vedere /api nell'URL di una pagina pensata per
// essere condivisa/indicizzata. nginx.conf ha un location dedicato che instrada
// /negozio qui esattamente come fa già per /api (stesso pattern, prefisso diverso).
app.use('/negozio', sitePublicRouter);
// Path interno, mai chiamato direttamente da un browser (vedi commento su
// rootPublicRouter in routes/site.js) — solo nginx.conf ci fa da proxy sulla
// root esatta del dominio, con fallback all'app SPA se risponde 404.
app.use('/__root_public', rootPublicRouter);

app.get('/health', (req, res) => res.json({
  status: 'ok',
  version: '0.4.0',
  tenant: process.env.TENANT_SLUG || 'unknown',
  name: process.env.TENANT_NAME || 'Platform Core'
}));

// Nome del tenant per il branding in sidebar/login ("Platform <Nome>") — pubblico,
// non richiede autenticazione: serve anche prima del login (schermata di accesso),
// e non è un dato sensibile. A differenza di /health, questo passa dal proxy interno
// del container (solo /api è instradato al backend, vedi core/nginx.conf) quindi è
// l'unico dei due raggiungibile davvero dal frontend.
// logo_url/accent_color (white-label minimo, 2026-08-14): stessa riga di
// tenant_settings già usata per i documenti stampabili (routes/settings.js),
// letta qui SENZA autenticazione perché deve comparire già sulla schermata di
// login, prima che esista un token — né l'uno né l'altro sono dati sensibili
// (sono già visibili a chiunque apra l'app).
app.get('/api/tenant-info', (req, res) => {
  let branding = { logo_url: null, accent_color: null, hide_platform_name: 0, login_headline: null, login_subheadline: null, login_body: null, login_hero_image_url: null };
  try {
    const row = db.prepare('SELECT logo_url, accent_color, hide_platform_name, login_headline, login_subheadline, login_body, login_hero_image_url FROM tenant_settings WHERE id = 1').get();
    if (row) branding = row;
  } catch (e) { /* tabella non ancora pronta: fallback ai default, mai bloccare il login */ }
  let enabledFeatures = {};
  try { enabledFeatures = features.all(); } catch (e) { /* tabella non pronta */ }
  let aiOn = false;
  try { aiOn = require('./module-ai').masterOn(); } catch (e) { /* tabella non pronta */ }
  res.json({
    features: enabledFeatures,
    ai: aiOn, // interruttore generale dell'AI (Impostazioni → AI): mostra o nasconde «Chiedi ai dati»
    name: process.env.TENANT_NAME || null,
    logo_url: branding.logo_url,
    accent_color: branding.accent_color,
    hide_platform_name: !!branding.hide_platform_name,
    login_headline: branding.login_headline,
    login_subheadline: branding.login_subheadline,
    login_body: branding.login_body,
    login_hero_image_url: branding.login_hero_image_url,
  });
});

// Rete di sicurezza per eccezioni non gestite in una route — non sostituisce i try/catch
// già presenti ovunque nel codice (quelli rispondono già un errore chiaro e specifico),
// cattura solo ciò che altrimenti sfuggirebbe del tutto (finiva solo nei log Docker,
// invisibile finché qualcuno non li guardava apposta). DEVE stare per ultimo, dopo
// tutte le route — è così che Express riconosce un error handler (4 argomenti).
// Nota: cattura i throw sincroni e i next(err) espliciti, non ogni possibile rejection
// asincrona non gestita — un backstop a livello processo (unhandledRejection) cambierebbe
// il comportamento di crash/recovery dei container reali, fuori scope per un logging
// leggero.
app.use((err, req, res, next) => {
  logError(req.originalUrl, req.method, err);
  console.error('Errore non gestito:', err.message);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Errore interno' });
});

// Il database montato è davvero lo stesso di sempre? (25/10/2026, dopo l'incidente reale
// dello stesso giorno: un database sbagliato montato è passato inosservato per ore). PRIMA
// di qualunque migrazione qui sotto, che potrebbe già cambiare moduli/record.
require('./integrity-check').checkIntegrity();

// Destinatari WhatsApp e regole Gmail non sono più moduli: porta nelle tabelle nuove le righe rimaste.
require('./notification-settings').migrateLegacy();
require('./record-owner').adoptOrphans();
{ const m = require('./secrets-at-rest').migrate(); if (m.connessioni || m.totp || m.falliti) console.log('Segreti cifrati a riposo: ' + m.connessioni + ' collegamenti, ' + m.totp + ' segreti 2FA' + (m.falliti ? ' (' + m.falliti + ' NON riusciti)' : '')); }
require('./legacy-cleanup').removeStubModules();
if (moduleRoles.seedIfEmpty()) console.log('Ruoli dei moduli: dichiarati per i moduli di finanza già presenti');
if (features.seedIfEmpty()) console.log('Funzioni: tenant con moduli di finanza, funzioni accese; le altre restano spente');
require('./pwa-icon').apply(); // icona del dock/PWA sul colore del tenant, se scelto (vedi Impostazioni → Aspetto)

app.listen(PORT, () => {
  console.log('Platform Core [' + (process.env.TENANT_SLUG || 'default') + '] running on port ' + PORT);
  startScheduler();
  startReports(); // il controllo ogni minuto parte sempre; se la funzione è spenta non fa niente
  startMonitor(); // il giorno 2 alle 9: "come sta andando" su WhatsApp, per i widget che lo hanno acceso
  startAvvisi(); // ogni minuto: righe nuove in "da smistare" (da qualunque via) -> un messaggio WhatsApp
  startGmailPoller();
  startDrivePoller();
  startAuditRetentionScheduler();
  startSuggestions(); // una volta al giorno, solo se la funzione «suggerimenti» è accesa
  startModuleGap(); // una volta alla settimana, stessa funzione, solo se l'AI è accesa e configurata
});
