'use strict';
// Sito Web pubblico (2026-09-04) — DUE router in questo file, montati diversamente
// in index.js: siteAdminRouter (CRUD, sotto /api/site-pages, auth+admin come ogni
// altra impostazione) e sitePublicRouter (rendering, montato a livello /negozio,
// SENZA /api davanti — deve restare raggiungibile da un browser/crawler che non ha
// mai fatto login, stesso principio già in uso per /api/tenant-info).
const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('./auth');
const { renderPageHtml, renderSitemapXml, renderRobotsTxt } = require('../site-renderer');
const { rateLimit } = require('../rate-limit');

const siteAdminRouter = express.Router();
const sitePublicRouter = express.Router();

// Sito Web è funzionalità CORE (2026-09-05) — nessun gate "modulo installato":
// ogni blocco è sempre disponibile per ogni tenant. Resta comunque una vera
// validazione strutturale, non un controllo lasciato vuoto per errore.
function validateBlocks(blocks) {
  if (!Array.isArray(blocks)) return 'blocks deve essere un array';
  for (const b of blocks) {
    if (!b || typeof b.type !== 'string') return 'ogni blocco deve avere un type';
  }
  return null;
}

// Popup (2026-09-05) — allowlist fissa sul trigger, stesso principio già in
// uso per icone/animazioni: un valore non riconosciuto viene rifiutato qui
// invece di finire alla cieca nello script pubblico generato dal renderer.
const POPUP_TRIGGERS = ['delay', 'exit_intent'];
function validatePopup(popup) {
  if (popup === null || popup === undefined) return null;
  if (typeof popup !== 'object' || Array.isArray(popup)) return 'popup deve essere un oggetto';
  if (popup.trigger !== undefined && !POPUP_TRIGGERS.includes(popup.trigger)) return 'popup.trigger non valido';
  if (popup.delay_seconds !== undefined && (typeof popup.delay_seconds !== 'number' || popup.delay_seconds < 0)) return 'popup.delay_seconds deve essere un numero >= 0';
  return null;
}
function parsePopup(json) {
  return json ? JSON.parse(json) : null;
}

// Impostazioni sito (site_enabled/site_og_image_url) — riga singola su
// tenant_settings, stesso pattern di /settings/azienda (settings.js): non
// riusato quel router perché quelle colonne sono un blocco a sé (intestazione
// documenti stampabili), un dominio diverso da questo.
siteAdminRouter.get('/settings', requireAuth, requireAdmin, (req, res) => {
  const row = db.prepare('SELECT site_enabled, site_og_image_url, lead_notification_email FROM tenant_settings WHERE id = 1').get();
  res.json(row || { site_enabled: 0, site_og_image_url: null, lead_notification_email: null });
});
siteAdminRouter.patch('/settings', requireAuth, requireAdmin, (req, res) => {
  const { site_enabled, site_og_image_url, lead_notification_email } = req.body || {};
  db.prepare('UPDATE tenant_settings SET site_enabled = COALESCE(?, site_enabled), site_og_image_url = COALESCE(?, site_og_image_url), lead_notification_email = COALESCE(?, lead_notification_email) WHERE id = 1')
    .run(site_enabled !== undefined ? (site_enabled ? 1 : 0) : null, site_og_image_url !== undefined ? site_og_image_url : null, lead_notification_email !== undefined ? lead_notification_email : null);
  res.json(db.prepare('SELECT site_enabled, site_og_image_url, lead_notification_email FROM tenant_settings WHERE id = 1').get());
});

// Theme Builder (2026-09-05) — header/footer condivisi tra TUTTE le pagine
// del tenant, non più duplicati blocco-per-blocco in ogni pagina. Il
// valore salvato è un oggetto blocco COMPLETO ({type:'header', config}),
// non solo il config — riusa identico BlockEditor/renderBlockInner già
// esistenti per header/footer, zero editor/rendering nuovo da scrivere.
// NULL = tenant che non adotta la funzionalità, comportamento invariato
// (renderPageHtml continua a rendere un header/footer inline se presente
// in blocks_json di una pagina).
// Design-token globali (2026-09-05, "abbiamo Divi?" — fase 1) — oggetto
// piatto {primary,secondary,background,text}, ruoli fissi (non un elenco
// libero di token arbitrari, sproporzionato per il valore che aggiunge
// oggi). Validazione minima: solo le chiavi note, mai un valore che non
// sia una stringa (finirebbe direttamente in un <style>, vedi
// site-renderer.js — stesso livello di fiducia già dato a page.accent_color).
const DESIGN_TOKEN_KEYS = ['primary', 'secondary', 'background', 'text'];
function validateDesignTokens(tokens) {
  if (tokens === null || tokens === undefined) return null;
  if (typeof tokens !== 'object' || Array.isArray(tokens)) return 'design_tokens deve essere un oggetto';
  for (const k of Object.keys(tokens)) {
    if (!DESIGN_TOKEN_KEYS.includes(k)) return `chiave non valida: "${k}"`;
    if (tokens[k] !== null && typeof tokens[k] !== 'string') return `il valore di "${k}" deve essere una stringa`;
  }
  return null;
}
function readTheme() {
  const row = db.prepare('SELECT site_header_json, site_footer_json, design_tokens_json, scroll_progress, hover_effects, eyebrow_swoosh FROM tenant_settings WHERE id = 1').get() || {};
  return {
    header: row.site_header_json ? JSON.parse(row.site_header_json) : null,
    footer: row.site_footer_json ? JSON.parse(row.site_footer_json) : null,
    design_tokens: row.design_tokens_json ? JSON.parse(row.design_tokens_json) : null,
    scroll_progress: !!row.scroll_progress,
    hover_effects: !!row.hover_effects,
    eyebrow_swoosh: !!row.eyebrow_swoosh,
  };
}
siteAdminRouter.get('/theme', requireAuth, requireAdmin, (req, res) => {
  res.json(readTheme());
});
siteAdminRouter.patch('/theme', requireAuth, requireAdmin, (req, res) => {
  const { header, footer, design_tokens, scroll_progress, hover_effects, eyebrow_swoosh } = req.body || {};
  if (header !== undefined && header !== null && header.type !== 'header') return res.status(400).json({ error: 'header deve avere type:"header"' });
  if (footer !== undefined && footer !== null && footer.type !== 'footer') return res.status(400).json({ error: 'footer deve avere type:"footer"' });
  if (design_tokens !== undefined) {
    const err = validateDesignTokens(design_tokens);
    if (err) return res.status(400).json({ error: err });
  }
  db.prepare(`
    UPDATE tenant_settings SET
      site_header_json = CASE WHEN ? THEN ? ELSE site_header_json END,
      site_footer_json = CASE WHEN ? THEN ? ELSE site_footer_json END,
      design_tokens_json = CASE WHEN ? THEN ? ELSE design_tokens_json END,
      scroll_progress = CASE WHEN ? THEN ? ELSE scroll_progress END,
      hover_effects = CASE WHEN ? THEN ? ELSE hover_effects END,
      eyebrow_swoosh = CASE WHEN ? THEN ? ELSE eyebrow_swoosh END
    WHERE id = 1
  `).run(
    header !== undefined ? 1 : 0, header != null ? JSON.stringify(header) : null,
    footer !== undefined ? 1 : 0, footer != null ? JSON.stringify(footer) : null,
    design_tokens !== undefined ? 1 : 0, design_tokens != null ? JSON.stringify(design_tokens) : null,
    scroll_progress !== undefined ? 1 : 0, scroll_progress ? 1 : 0,
    hover_effects !== undefined ? 1 : 0, hover_effects ? 1 : 0,
    eyebrow_swoosh !== undefined ? 1 : 0, eyebrow_swoosh ? 1 : 0,
  );
  res.json(readTheme());
});
// Migrazione volontaria (2026-09-05) — MAI automatica: un admin che ha già
// un header/footer scritto a mano in una pagina lo "promuove" a Tema
// condiviso con un'azione esplicita, che fa DUE cose insieme (mai solo
// una, lascerebbe uno stato a metà): copia il blocco in tenant_settings E
// lo rimuove da OGNI pagina (non solo da quella di partenza — da qui in
// avanti tutte le pagine useranno il condiviso, un residuo inline in
// un'altra pagina sarebbe solo confusione silenziosa).
siteAdminRouter.post('/theme/adopt-from/:pageId', requireAuth, requireAdmin, (req, res) => {
  const { kind } = req.body || {}; // 'header' | 'footer'
  if (kind !== 'header' && kind !== 'footer') return res.status(400).json({ error: 'kind deve essere "header" o "footer"' });
  const page = db.prepare('SELECT * FROM site_pages WHERE id = ?').get(req.params.pageId);
  if (!page) return res.status(404).json({ error: 'Pagina non trovata' });
  const blocks = JSON.parse(page.blocks_json || '[]');
  const found = blocks.find((b) => b && b.type === kind);
  if (!found) return res.status(404).json({ error: `Questa pagina non ha un blocco "${kind}"` });
  const column = kind === 'header' ? 'site_header_json' : 'site_footer_json';
  db.prepare(`UPDATE tenant_settings SET ${column} = ? WHERE id = 1`).run(JSON.stringify(found));
  const allPages = db.prepare('SELECT id, blocks_json FROM site_pages').all();
  const stripStmt = db.prepare('UPDATE site_pages SET blocks_json = ? WHERE id = ?');
  for (const p of allPages) {
    const pBlocks = JSON.parse(p.blocks_json || '[]');
    const stripped = pBlocks.filter((b) => !(b && b.type === kind));
    if (stripped.length !== pBlocks.length) stripStmt.run(JSON.stringify(stripped), p.id);
  }
  res.json({ status: 'adopted', kind });
});

siteAdminRouter.get('/', requireAuth, requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT id, slug, title, published, updated_at FROM site_pages ORDER BY updated_at DESC').all());
});

// Lead del blocco "form" (2026-09-05, piano Sito Web punto 4) — lista/lettura
// per l'admin, sempre ordinati dal più recente. Nessun filtro per pagina qui:
// un tenant tipico ha pochi lead totali, non serve paginazione sofisticata
// per un elenco che l'admin controlla a mano di tanto in tanto.
// Registrata PRIMA di '/:id' sotto (trovato 2026-10-01, dormiente da sempre:
// Express fa match in ordine di registrazione, '/:id' intercettava ogni
// richiesta a '/leads' trattandola come id="leads", mai raggiunta la route
// vera — 404 "Pagina non trovata" invece della lista lead reale).
siteAdminRouter.get('/leads', requireAuth, requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT * FROM site_leads ORDER BY created_at DESC LIMIT 200').all();
  res.json(rows.map((l) => ({ ...l, data: JSON.parse(l.data_json || '{}') })));
});

siteAdminRouter.get('/:id', requireAuth, requireAdmin, (req, res) => {
  const page = db.prepare('SELECT * FROM site_pages WHERE id = ?').get(req.params.id);
  if (!page) return res.status(404).json({ error: 'Pagina non trovata' });
  res.json({ ...page, blocks_json: JSON.parse(page.blocks_json || '[]'), popup_json: parsePopup(page.popup_json) });
});

siteAdminRouter.post('/', requireAuth, requireAdmin, (req, res) => {
  const { slug, title } = req.body || {};
  if (!slug || !title) return res.status(400).json({ error: 'slug e title sono richiesti' });
  if (!/^[a-z0-9-]+$/.test(slug)) return res.status(400).json({ error: 'slug: solo lettere minuscole, numeri, trattini' });
  try {
    const result = db.prepare('INSERT INTO site_pages (slug, title, blocks_json) VALUES (?, ?, ?)').run(slug, title, '[]');
    res.status(201).json(db.prepare('SELECT * FROM site_pages WHERE id = ?').get(result.lastInsertRowid));
  } catch (e) {
    res.status(409).json({ error: 'Uno slug identico esiste già' });
  }
});

// Cronologia/autosave (2026-09-05, "andiamo avanti con Divi") — un blocco
// annidato messo storto per errore era irrecuperabile prima, si doveva
// ricostruire a mano. Snapshot dello stato NUOVO (non quello sostituito):
// la lista di revisioni è quindi "cosa è stato salvato e quando", stesso
// modello mentale di uno storico versioni, non un log di "cosa è cambiato".
// Salvato SOLO se blocks_json è davvero cambiato (mai una revisione per un
// PATCH che tocca solo published/title/ecc, altrimenti la cronologia si
// riempirebbe di rumore senza contenuto diverso da ripristinare).
function saveRevisionIfChanged(pageId, oldBlocksJson, newBlocksJson, title, username) {
  // !newBlocksJson (non solo === undefined): un PATCH che non tocca blocks_json
  // lo passa come null (vedi sopra), mai come stringa vuota/falsy per altri
  // motivi — bug reale trovato scrivendo i test del popup: un PATCH che
  // cambia SOLO popup_json (blocks_json assente) faceva comunque tentare
  // un INSERT con blocks_json NULL, violando il vincolo NOT NULL della
  // tabella (mascherato prima d'ora: i test esistenti non controllavano lo
  // status di QUEL PATCH specifico).
  if (!newBlocksJson || newBlocksJson === oldBlocksJson) return;
  db.prepare('INSERT INTO site_page_revisions (page_id, blocks_json, title, created_by) VALUES (?, ?, ?, ?)')
    .run(pageId, newBlocksJson, title || null, username || null);
  // Tetto di 20 per pagina (2026-09-05) — nessuna rotazione automatica altrove
  // in questo codebase per tabelle di log (audit_log/error_logs restano per
  // sempre), ma qui il volume è ben più alto (ogni salvataggio nell'editor,
  // non un evento raro) e il valore di una revisione vecchissima è marginale.
  const ids = db.prepare('SELECT id FROM site_page_revisions WHERE page_id = ? ORDER BY created_at DESC, id DESC').all(pageId);
  if (ids.length > 20) {
    const toDelete = ids.slice(20).map((r) => r.id);
    db.prepare(`DELETE FROM site_page_revisions WHERE id IN (${toDelete.map(() => '?').join(',')})`).run(...toDelete);
  }
}

siteAdminRouter.patch('/:id', requireAuth, requireAdmin, (req, res) => {
  const page = db.prepare('SELECT * FROM site_pages WHERE id = ?').get(req.params.id);
  if (!page) return res.status(404).json({ error: 'Pagina non trovata' });
  const { title, meta_description, blocks_json, published, accent_color, font_style, popup_json } = req.body || {};
  if (blocks_json !== undefined) {
    const err = validateBlocks(blocks_json);
    if (err) return res.status(400).json({ error: err });
  }
  if (popup_json !== undefined) {
    const err = validatePopup(popup_json);
    if (err) return res.status(400).json({ error: err });
  }
  const newBlocksJson = blocks_json !== undefined ? JSON.stringify(blocks_json) : null;
  db.prepare(`
    UPDATE site_pages SET
      title = COALESCE(?, title),
      meta_description = COALESCE(?, meta_description),
      blocks_json = COALESCE(?, blocks_json),
      published = COALESCE(?, published),
      accent_color = COALESCE(?, accent_color),
      font_style = COALESCE(?, font_style),
      popup_json = CASE WHEN ? THEN ? ELSE popup_json END,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(title ?? null, meta_description ?? null, newBlocksJson, published !== undefined ? (published ? 1 : 0) : null, accent_color ?? null, font_style ?? null, popup_json !== undefined ? 1 : 0, popup_json !== undefined ? JSON.stringify(popup_json) : null, req.params.id);
  saveRevisionIfChanged(page.id, page.blocks_json, newBlocksJson, title || page.title, req.user && req.user.username);
  const updated = db.prepare('SELECT * FROM site_pages WHERE id = ?').get(req.params.id);
  res.json({ ...updated, blocks_json: JSON.parse(updated.blocks_json || '[]'), popup_json: parsePopup(updated.popup_json) });
});

siteAdminRouter.delete('/:id', requireAuth, requireAdmin, (req, res) => {
  db.prepare('DELETE FROM site_pages WHERE id = ?').run(req.params.id);
  res.json({ status: 'deleted' });
});

siteAdminRouter.get('/:id/revisions', requireAuth, requireAdmin, (req, res) => {
  const page = db.prepare('SELECT id FROM site_pages WHERE id = ?').get(req.params.id);
  if (!page) return res.status(404).json({ error: 'Pagina non trovata' });
  const rows = db.prepare('SELECT id, title, created_by, created_at FROM site_page_revisions WHERE page_id = ? ORDER BY created_at DESC, id DESC').all(req.params.id);
  res.json(rows);
});

siteAdminRouter.post('/:id/revisions/:revId/restore', requireAuth, requireAdmin, (req, res) => {
  const page = db.prepare('SELECT * FROM site_pages WHERE id = ?').get(req.params.id);
  if (!page) return res.status(404).json({ error: 'Pagina non trovata' });
  const revision = db.prepare('SELECT * FROM site_page_revisions WHERE id = ? AND page_id = ?').get(req.params.revId, req.params.id);
  if (!revision) return res.status(404).json({ error: 'Revisione non trovata' });
  db.prepare('UPDATE site_pages SET blocks_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(revision.blocks_json, page.id);
  // Il ripristino stesso diventa una nuova revisione (2026-09-05) — così è
  // a sua volta annullabile, mai un salto nel vuoto senza possibilità di
  // tornare allo stato immediatamente precedente al ripristino.
  saveRevisionIfChanged(page.id, page.blocks_json, revision.blocks_json, page.title, req.user && req.user.username);
  const updated = db.prepare('SELECT * FROM site_pages WHERE id = ?').get(page.id);
  res.json({ ...updated, blocks_json: JSON.parse(updated.blocks_json || '[]'), popup_json: parsePopup(updated.popup_json) });
});

siteAdminRouter.patch('/leads/:id', requireAuth, requireAdmin, (req, res) => {
  const { status } = req.body || {};
  if (!['nuovo', 'letto', 'archiviato'].includes(status)) return res.status(400).json({ error: 'status non valido' });
  db.prepare('UPDATE site_leads SET status = ? WHERE id = ?').run(status, req.params.id);
  res.json({ status: 'updated' });
});

// Anteprima live (2026-09-04, primo passo verso "stile Divi/Elementor" — vedi
// memoria platform_sito_web_divi_vision) — renderizza la bozza corrente
// dell'editor (MAI salvata, letta dal body della richiesta) con lo STESSO
// motore server-side della pagina pubblica vera, invece di dover salvare e
// aprire "Anteprima" in un'altra scheda per vedere il risultato reale.
// Nessuna riga in site_pages coinvolta: un oggetto "page" fittizio costruito
// al volo. Stessa validazione PRO dei blocchi del salvataggio vero, per non
// mostrare in anteprima un blocco che poi il salvataggio rifiuterebbe.
siteAdminRouter.post('/preview', requireAuth, requireAdmin, (req, res) => {
  const { title, blocks_json, accent_color, font_style } = req.body || {};
  const err = validateBlocks(blocks_json || []);
  if (err) return res.status(400).json({ error: err });
  const fakePage = { slug: 'anteprima', title: title || '', meta_description: '', blocks_json: JSON.stringify(blocks_json || []), accent_color, font_style }
  const settings = db.prepare('SELECT site_og_image_url, site_header_json, site_footer_json, design_tokens_json, scroll_progress, hover_effects, eyebrow_swoosh FROM tenant_settings WHERE id = 1').get() || {};
  const html = renderPageHtml(fakePage, settings, process.env.TENANT_NAME, { editable: true })
  res.json({ html });
});

// Pubblico: nessun requireAuth, deve rispondere anche senza alcun login (visitatori
// reali, crawler dei motori di ricerca). site_enabled=0 -> 404 sempre, anche se
// esistono pagine published: un tenant che non ha mai attivato il Sito Web non deve
// esporre nulla per errore.
function siteEnabled() {
  const row = db.prepare('SELECT site_enabled FROM tenant_settings WHERE id = 1').get();
  return !!(row && row.site_enabled);
}
function baseUrl(req) {
  return 'https://' + req.get('host');
}

// Bug reale trovato il 2026-09-04 (verifica dal vivo su Nico Caffè 1:1: "non
// cambia nulla" nonostante il <link> al font fosse già nel <head> corretto) —
// non era un problema di posizione del tag, ma la CSP globale (shared/security-
// headers.js, applicata a OGNI risposta): style-src/font-src non includono i
// domini di Google Fonts, quindi il browser scaricava la pagina ma bloccava sia
// il foglio di stile del font (fonts.googleapis.com) sia i file .woff2 veri
// (fonts.gstatic.com) — font-family dichiarato correttamente, ma zero
// @font-face mai realmente caricato (verificato: document.fonts era vuoto).
// Qui, non sull'header globale: un blocco html_custom è l'unica eccezione
// dichiarata a "niente codice custom" — le pagine pubbliche (mai autenticate,
// mai la SPA di gestione) sono l'unico posto dove ha senso allentarla, e solo
// per Google Fonts specificamente, non un dominio arbitrario.
function setPublicSiteCsp(res) {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'self'"
  );
}

sitePublicRouter.get('/sitemap.xml', (req, res) => {
  if (!siteEnabled()) return res.status(404).send('Non disponibile');
  res.type('application/xml').send(renderSitemapXml(baseUrl(req)));
});
sitePublicRouter.get('/robots.txt', (req, res) => {
  if (!siteEnabled()) return res.status(404).send('Non disponibile');
  res.type('text/plain').send(renderRobotsTxt(baseUrl(req)));
});
// Invio form (2026-09-05, piano Sito Web punto 4 — l'utente: form vero su
// "prova" di Nico Caffè, non solo testo) — pubblico, mai autenticato (chi
// visita il sito non ha un account), quindi con un rate-limit DEDICATO: /negozio
// non passa dal limiter globale /api (vedi index.js, montato solo sui path
// sotto `base`), un endpoint POST pubblico senza limite proprio sarebbe uno
// spam vector reale, non teorico.
const leadLimiter = rateLimit({ windowMs: 60 * 1000, max: 10, message: 'Troppe richieste, riprova tra poco', name: 'site-leads' });

// Whitelist dei campi (2026-09-05) — le chiavi accettate sono SOLO quelle che
// l'admin ha dichiarato nel blocco 'form' di QUESTA pagina, mai quelle
// arbitrarie mandate da chi compila (un client malevolo può mandare qualunque
// JSON). Cerca anche dentro le colonne di un blocco 'riga' — un form può
// benissimo stare affiancato ad altro contenuto, non solo a piena larghezza.
function findFormBlocks(blocks) {
  let found = [];
  for (const b of blocks || []) {
    if (b.type === 'form') found.push(b);
    if (b.type === 'riga') for (const col of (b.config?.columns || [])) found = found.concat(findFormBlocks(col.blocks));
  }
  return found;
}

// Email reale al form di contatto (2026-09-05, richiesto dall'utente: "il
// form di contatto deve mandare una mail") — stesso principio già seguito
// per WhatsApp in automation-engine.js: credenziali VERE lette dalla tabella
// 'connections' (connettore 'email_resend', mai un secondo posto per le
// stesse credenziali), nessun invio finto se non configurato. Resend invece
// di nodemailer/SMTP: una singola richiesta HTTP con fetch nativo (Node 22),
// coerente con "niente librerie nuove" già seguito ovunque nel motore.
function getConnectionCredentials(integrationId) {
  const row = db.prepare('SELECT credentials FROM connections WHERE integration_id = ?').get(integrationId);
  if (!row || !row.credentials) return null;
  try { return JSON.parse(row.credentials); } catch { return null; }
}
function escapeHtmlLite(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
async function sendLeadEmail(page, formBlock, clean) {
  const creds = getConnectionCredentials('email_resend');
  const settings = db.prepare('SELECT lead_notification_email FROM tenant_settings WHERE id = 1').get();
  const to = settings && settings.lead_notification_email;
  if (!creds || !creds.api_key || !creds.from_email || !to) return { esito: 'simulato', note: 'email non configurata (connessione email_resend o indirizzo di notifica mancanti)' };
  const rows = Object.entries(clean).map(([k, v]) => {
    const field = (formBlock.config?.fields || []).find((f) => f.key === k);
    return `<tr><td style="padding:4px 16px 4px 0;color:#78716c;white-space:nowrap;vertical-align:top">${escapeHtmlLite(field?.label || k)}</td><td style="padding:4px 0">${escapeHtmlLite(v)}</td></tr>`;
  }).join('');
  const html = `<div style="font-family:sans-serif;color:#1c1917"><h2 style="margin:0 0 12px">Nuova richiesta dal sito</h2><p style="color:#78716c;margin:0 0 16px">Pagina: ${escapeHtmlLite(page.title)}</p><table>${rows}</table></div>`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + creds.api_key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: creds.from_email, to: [to], subject: 'Nuova richiesta dal sito — ' + page.title, html }),
      signal: controller.signal,
    });
    return { esito: resp.ok ? 'inviata' : 'errore', note: resp.ok ? null : 'Resend ha risposto ' + resp.status };
  } catch (err) {
    return { esito: 'errore', note: err.message };
  } finally {
    clearTimeout(timeout);
  }
}

sitePublicRouter.post('/:slug/leads', leadLimiter, async (req, res) => {
  if (!siteEnabled()) return res.status(404).json({ error: 'Sito non disponibile' });
  const page = db.prepare('SELECT * FROM site_pages WHERE slug = ? AND published = 1').get(req.params.slug);
  if (!page) return res.status(404).json({ error: 'Pagina non trovata' });
  const { block_anchor, data } = req.body || {};
  if (!data || typeof data !== 'object' || Array.isArray(data)) return res.status(400).json({ error: 'Dati mancanti' });
  const formBlocks = findFormBlocks(JSON.parse(page.blocks_json || '[]'));
  const formBlock = block_anchor ? formBlocks.find((b) => b.anchor_id === block_anchor) : formBlocks[0];
  if (!formBlock) return res.status(404).json({ error: 'Modulo non trovato in questa pagina' });
  const allowedKeys = new Set((formBlock.config?.fields || []).map((f) => f.key));
  const clean = {};
  for (const [k, v] of Object.entries(data)) {
    if (allowedKeys.has(k)) clean[k] = String(v ?? '').trim().slice(0, 2000);
  }
  if (!Object.keys(clean).length) return res.status(400).json({ error: 'Nessun campo valido' });
  const insertResult = db.prepare('INSERT INTO site_leads (page_slug, block_anchor, data_json) VALUES (?, ?, ?)').run(page.slug, block_anchor || null, JSON.stringify(clean));
  // Notifica interna reale (2026-09-05) — stesso meccanismo generico già in
  // uso per l'automazione "notifica_interna" (automation-engine.js), non un
  // canale nuovo. roles:['admin'] esclude chi non deve occuparsi di lead
  // commerciali (un admin vede comunque OGNI notifica, bypass già esistente
  // in routes/notifications.js — vedi commento lì).
  const fields = formBlock.config?.fields || [];
  const summary = fields.slice(0, 2).map((f) => clean[f.key]).filter(Boolean).join(' — ');
  db.prepare('INSERT INTO notifications (message, module_slug, record_id, roles, category) VALUES (?, ?, ?, ?, ?)')
    .run('Nuova richiesta dal sito' + (summary ? ': ' + summary : '') + ' — pagina "' + page.title + '"', null, null, JSON.stringify(['admin']), 'sito_web_lead');
  // Email reale (2026-09-05) — il lead è GIÀ salvato sopra: un errore o una
  // mancata configurazione qui non deve mai far fallire la risposta al
  // visitatore, che ha comunque lasciato i suoi dati con successo.
  const emailResult = await sendLeadEmail(page, formBlock, clean);
  db.prepare('UPDATE site_leads SET email_status = ? WHERE id = ?').run(emailResult.esito, insertResult.lastInsertRowid);
  res.status(201).json({ status: 'ok' });
});

sitePublicRouter.get('/:slug?', (req, res) => {
  if (!siteEnabled()) return res.status(404).send('Sito non disponibile');
  const slug = req.params.slug || 'home';
  const page = db.prepare('SELECT * FROM site_pages WHERE slug = ? AND published = 1').get(slug);
  if (!page) return res.status(404).send('Pagina non trovata');
  const settings = db.prepare('SELECT site_og_image_url, site_header_json, site_footer_json, design_tokens_json, scroll_progress, hover_effects, eyebrow_swoosh FROM tenant_settings WHERE id = 1').get() || {};
  setPublicSiteCsp(res);
  res.send(renderPageHtml(page, settings, process.env.TENANT_NAME));
});

// Root del dominio (2026-09-04, richiesto dall'utente: "frontend è il sito") —
// route DEDICATA, mai raggiunta da un browser direttamente (solo via il proxy
// interno nginx su "location = /" con proxy_intercept_errors, vedi nginx.conf):
// se il tenant ha il Sito Web attivo con una 'home' pubblicata, la root del
// dominio mostra QUELLA invece della SPA di gestione, con un tasto Login che
// riporta all'app vera su /app. Un tenant senza Sito Web attivo risponde 404 qui
// — nginx intercetta e serve comunque l'index.html della SPA, zero cambiamento
// per chi non ha mai attivato questa funzionalità.
const rootPublicRouter = express.Router();
rootPublicRouter.get('/', (req, res) => {
  if (!siteEnabled()) return res.status(404).send('Nessun sito pubblico attivo su questa root');
  const page = db.prepare("SELECT * FROM site_pages WHERE slug = 'home' AND published = 1").get();
  if (!page) return res.status(404).send('Nessuna home page pubblicata');
  const settings = db.prepare('SELECT site_og_image_url, site_header_json, site_footer_json, design_tokens_json, scroll_progress, hover_effects, eyebrow_swoosh FROM tenant_settings WHERE id = 1').get() || {};
  setPublicSiteCsp(res);
  res.send(renderPageHtml(page, settings, process.env.TENANT_NAME, { includeLoginModal: true }));
});

module.exports = { siteAdminRouter, sitePublicRouter, rootPublicRouter };
