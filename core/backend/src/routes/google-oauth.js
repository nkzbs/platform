// ─── GOOGLE OAUTH2 (Gmail) ──────────────────────────────────────────────────
// Sostituisce lo stub "incolla un service-account JSON" della connessione
// 'google' (mai funzionante: un service account non può leggere una Gmail
// personale senza domain-wide delegation su un dominio Workspace). Porta la
// stessa logica OAuth2 reale già in produzione su hearth (backend/src/routes/
// google.js): consenso utente + refresh token, non server-to-server.
//
// Le route di redirect (oauth/start, oauth/callback) sono raggiunte da una
// navigazione browser a tutta pagina (redirect di Google), non da una fetch
// del nostro frontend — non possono quindi portare un Bearer token, e restano
// deliberatamente FUORI da requireAuth, esattamente come in hearth. La
// sicurezza del flusso è garantita dal parametro state OAuth, non dal nostro
// JWT.
//
// Le credenziali/token vivono nella riga 'connections' con integration_id
// 'google' (stesso campo JSON 'credentials' già usato da tutte le altre
// integrazioni) — nessuna tabella nuova.
const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { requireAuth, requireAdmin } = require('./auth');

const router = express.Router();

function getCreds() {
  const row = db.prepare("SELECT credentials FROM connections WHERE integration_id = 'google'").get();
  if (!row || !row.credentials) return {};
  return require('../secrets-at-rest').unseal(row.credentials) || {};
}

function setCreds(next, connected) {
  const json = require('../secrets-at-rest').seal(next); // cifrato a riposo
  const row = db.prepare("SELECT integration_id FROM connections WHERE integration_id = 'google'").get();
  if (row) {
    db.prepare('UPDATE connections SET credentials = ?' + (connected !== undefined ? ', connected = ?, connected_at = CURRENT_TIMESTAMP' : '') + " WHERE integration_id = 'google'")
      .run(...(connected !== undefined ? [json, connected ? 1 : 0] : [json]));
  } else {
    db.prepare("INSERT INTO connections (integration_id, connected, credentials, connected_at) VALUES ('google', ?, ?, CURRENT_TIMESTAMP)").run(connected ? 1 : 0, json);
  }
}

function getRedirectUri(req) {
  if (process.env.GOOGLE_REDIRECT_URI) return process.env.GOOGLE_REDIRECT_URI;
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:4002';
  return `${proto}://${host}/api/integrazioni/google/oauth/callback`;
}

function getFrontendUrl(req) {
  if (process.env.FRONTEND_URL) return process.env.FRONTEND_URL;
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:4002';
  return `${proto}://${host}`;
}

// Vero solo se il toggle "Drive" è attivo E il token attuale ha davvero lo scope
// drive.file — chi si è connesso PRIMA che questo scope fosse aggiunto alla
// richiesta OAuth (vedi commento su oauth/start sotto) ha drive_enabled=1 ma un
// token che su ogni upload risponde 403 ACCESS_TOKEN_SCOPE_INSUFFICIENT: bug reale
// trovato su Finance (l'utente vedeva l'upload di un allegato fallire con una X
// rossa, causa niente affatto ovvia dal messaggio d'errore). driveScopeOk() è la
// fonte unica sia per /status (drive_scope_ok, il frontend avvisa "riconnetti")
// sia per isDriveEnabled() sotto (fallback silenzioso su storage locale — un
// upload non deve MAI fallire per una disattenzione di configurazione su Drive).
function driveScopeOk(cfg) {
  return (cfg.scopes || []).some((s) => s.includes('drive.file'));
}

// GET /status — pubblico, dice se connesso (letto dalla stessa pagina Connessioni)
router.get('/status', (req, res) => {
  const cfg = getCreds();
  res.json({ connected: !!cfg.access_token, email: cfg.email || null, scopes: cfg.scopes || [], drive_enabled: !!cfg.drive_enabled, drive_scope_ok: driveScopeOk(cfg) });
});

// PUT /config — salva client_id/client_secret (merge, non sovrascrive token già presenti)
router.put('/config', requireAuth, requireAdmin, (req, res) => {
  const { client_id, client_secret } = req.body;
  if (!client_id || !client_secret) return res.status(400).json({ error: 'client_id e client_secret richiesti' });
  setCreds({ ...getCreds(), client_id, client_secret });
  res.json({ ok: true });
});

// PUT /drive — attiva/disattiva il salvataggio allegati su Drive (modulo extra:
// senza, gli allegati restano sul server locale come sempre — vedi routes/uploads.js
// e google-drive-storage.js). Richiede lo scope drive.file già concesso (va
// ri-autorizzata la connessione se non c'era ancora quando è stato aggiunto).
router.put('/drive', requireAuth, requireAdmin, (req, res) => {
  const { enabled } = req.body;
  setCreds({ ...getCreds(), drive_enabled: !!enabled });
  res.json({ ok: true, enabled: !!enabled });
});

// GET /oauth/start — redirect a Google (niente requireAuth: è una navigazione browser)
router.get('/oauth/start', (req, res) => {
  const cfg = getCreds();
  if (!cfg.client_id || !cfg.client_secret) {
    return res.status(400).json({ error: 'Configura prima Client ID e Client Secret' });
  }
  const state = Math.random().toString(36).slice(2) + Date.now().toString(36);
  setCreds({ ...cfg, oauth_state: state });
  const redirectUri = getRedirectUri(req);
  const params = new URLSearchParams({
    client_id: cfg.client_id,
    redirect_uri: redirectUri,
    response_type: 'code',
    // gmail.readonly per il poller (gmail-poller.js), calendar.events per creare le
    // scadenze estratte dalle email, drive.file per il salvataggio NUOVI allegati su
    // Drive (modulo extra — l'app vede solo i file che crea lei), drive.readonly per
    // recuperare i vecchi allegati di hearth (creati da un'altra identità OAuth,
    // drive.file da solo non basta a leggerli — verificato con una vera chiamata,
    // 403 ACCESS_TOKEN_SCOPE_INSUFFICIENT, non solo per documentazione) — usato solo
    // dallo script una tantum di migrazione, mai per operazioni correnti. Chi si era
    // già connesso PRIMA che uno di questi scope fosse aggiunto deve rifare la
    // connessione una volta per autorizzarlo (il refresh token esistente non li
    // include retroattivamente).
    scope: 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.readonly',
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

// GET /oauth/callback
router.get('/oauth/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const frontendUrl = getFrontendUrl(req);
  if (error) return res.redirect(`${frontendUrl}/?google_error=${encodeURIComponent(error)}`);

  const cfg = getCreds();
  if (state !== cfg.oauth_state) {
    console.warn('[Google OAuth] state mismatch — ricevuto:', state, '| atteso:', cfg.oauth_state);
  }

  try {
    const redirectUri = getRedirectUri(req);
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code, client_id: cfg.client_id, client_secret: cfg.client_secret,
        redirect_uri: redirectUri, grant_type: 'authorization_code',
      }),
    });
    const tokens = await tokenRes.json();
    if (tokens.error) throw new Error(tokens.error_description || tokens.error);

    const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: 'Bearer ' + tokens.access_token },
    });
    const profile = await profileRes.json();

    setCreds({
      ...cfg,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || cfg.refresh_token,
      token_expiry: Date.now() + (tokens.expires_in * 1000),
      email: profile.email,
      scopes: (tokens.scope || '').split(' ').filter(Boolean),
      oauth_state: undefined,
    }, true);

    console.log('[Google OAuth] Connesso come:', profile.email);
    res.redirect(`${frontendUrl}/?google_connected=1`);
  } catch (e) {
    console.error('[Google OAuth]', e.message);
    res.redirect(`${frontendUrl}/?google_error=${encodeURIComponent(e.message)}`);
  }
});

// POST /disconnect
router.post('/disconnect', requireAuth, requireAdmin, (req, res) => {
  const cfg = getCreds();
  // Si perdono i token, non le scelte: "salva su Drive" e la cartella restano, così ricollegare non spegne in silenzio il salvataggio dei nuovi file su Drive.
  setCreds({ client_id: cfg.client_id, client_secret: cfg.client_secret, drive_enabled: cfg.drive_enabled, drive_folder_id: cfg.drive_folder_id }, false);
  res.json({ ok: true });
});

async function getValidAccessToken() {
  const cfg = getCreds();
  if (!cfg.access_token) throw new Error('Google non connesso');
  const needsRefresh = Date.now() > (cfg.token_expiry || 0) - 60000;
  if (!needsRefresh) return cfg.access_token;
  if (!cfg.refresh_token) throw new Error('Refresh token mancante — ri-autorizza Google');
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cfg.client_id, client_secret: cfg.client_secret,
      refresh_token: cfg.refresh_token, grant_type: 'refresh_token',
    }),
  });
  const tokens = await tokenRes.json();
  if (tokens.error) throw new Error('Refresh fallito: ' + tokens.error);
  setCreds({ ...cfg, access_token: tokens.access_token, token_expiry: Date.now() + (tokens.expires_in * 1000) });
  return tokens.access_token;
}

// Crea un evento "tutto il giorno" sul Google Calendar primario dell'utente
// connesso — usato da gmail-poller.js per le scadenze estimate dal testo di
// un'email. Fallisce silenziosamente (ritorna null, non lancia) se lo scope
// calendar.events non è stato ancora concesso — capita per chi si era connesso
// PRIMA che questo scope fosse aggiunto: il poller continua comunque a creare
// la spesa "da smistare", solo senza l'evento calendario finché non si
// riconnette.
async function createCalendarEvent({ summary, description, date }) {
  const accessToken = await getValidAccessToken();
  const nextDay = new Date(date + 'T00:00:00Z');
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      summary,
      description,
      start: { date },
      end: { date: nextDay.toISOString().slice(0, 10) },
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    console.warn('[Google Calendar] creazione evento fallita:', data.error?.message || res.statusText);
    return null;
  }
  return data.id;
}

// Trova (o crea, la prima volta) la cartella Drive dedicata a questo tenant — id
// tenuto nelle stesse credenziali google (drive_folder_id), così non la
// ricrea ad ogni upload. Nome fisso "Platform - <tenant>" per riconoscerla
// facilmente a occhio dentro Drive.
async function ensureDriveFolder() {
  const cfg = getCreds();
  if (cfg.drive_folder_id) return cfg.drive_folder_id;
  const accessToken = await getValidAccessToken();
  const folderName = 'Platform - ' + (process.env.TENANT_NAME || process.env.TENANT_SLUG || 'core');
  const res = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: folderName, mimeType: 'application/vnd.google-apps.folder' }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error('Creazione cartella Drive fallita: ' + (data.error?.message || res.statusText));
  setCreds({ ...getCreds(), drive_folder_id: data.id });
  return data.id;
}

// Carica un allegato su Drive (upload multipart semplice, niente libreria Google
// API — stesso stile "fetch diretto" già usato per Gmail/Calendar in questo
// file). Usata da routes/uploads.js e gmail-poller.js SOLO quando il modulo
// extra "Drive" è attivo (isDriveEnabled) — altrimenti gli allegati restano
// sul server locale come sempre, comportamento invariato.
async function driveUpload(buffer, filename, mimeType) {
  const accessToken = await getValidAccessToken();
  const folderId = await ensureDriveFolder();
  const boundary = 'platformcore' + crypto.randomUUID().replace(/-/g, '');
  const metadata = JSON.stringify({ name: filename, parents: [folderId] });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${mimeType || 'application/octet-stream'}\r\n\r\n`),
    buffer,
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  const data = await res.json();
  if (!res.ok) throw new Error('Upload Drive fallito: ' + (data.error?.message || res.statusText));
  return data.id;
}

async function driveDownload(fileId) {
  const accessToken = await getValidAccessToken();
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: 'Bearer ' + accessToken },
  });
  if (!res.ok) throw new Error('Download da Drive fallito: ' + res.statusText);
  return Buffer.from(await res.arrayBuffer());
}

async function driveDelete(fileId) {
  const accessToken = await getValidAccessToken();
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: 'DELETE',
    headers: { Authorization: 'Bearer ' + accessToken },
  });
  // 404 = già assente, va bene così (stesso principio "file già assente" di uploads.js)
  if (!res.ok && res.status !== 404) throw new Error('Cancellazione Drive fallita: ' + res.statusText);
}

module.exports = router;
module.exports.getValidAccessToken = getValidAccessToken;
module.exports.createCalendarEvent = createCalendarEvent;
module.exports.isDriveEnabled = () => {
  const cfg = getCreds();
  return !!cfg.drive_enabled && driveScopeOk(cfg);
};
module.exports.driveUpload = driveUpload;
module.exports.driveDownload = driveDownload;
module.exports.driveDelete = driveDelete;
