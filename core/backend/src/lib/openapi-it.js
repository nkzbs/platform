'use strict';
// Connettore OpenAPI.it (marketplace italiano di API) per il verticale Mediazione
// immobiliare — valutazioni di mercato (Real Estate) e ricerca immobili per codice
// fiscale (Catasto, "ispezione ipotecaria nazionale"). Autenticazione a due passi,
// confermata dalla documentazione reale (console.openapi.com), non indovinata:
//  1) POST .../tokens su oauth.openapi.com (o test.oauth.openapi.com in sandbox),
//     Basic Auth = email:API_KEY, corpo {name, scopes, ttl} → ritorna un token Bearer
//     con scadenza (max 1 anno; qui ne chiediamo uno da 30 giorni, rigenerato quando
//     serve, mai copiato a mano).
//  2) Il token Bearer così ottenuto autentica le chiamate vere sui domini per-prodotto
//     (realestate.openapi.com / catasto.openapi.com, o i loro equivalenti test.*).
// Le credenziali (email, api_key, ambiente) vivono SOLO in connections.credentials
// (sigillate, stesso meccanismo di Stripe/Mailchimp/Resend) — mai lette qui in chiaro
// se non dentro il processo del server.
const db = require('../db');

function credenziali() {
  const row = db.prepare("SELECT credentials FROM connections WHERE integration_id = 'openapi_it' AND connected = 1").get();
  if (!row || !row.credentials) return null;
  const c = require('../secrets-at-rest').unseal(row.credentials);
  if (!c || !c.email || !c.api_key) return null;
  const sandbox = String(c.ambiente || 'sandbox').trim().toLowerCase() !== 'produzione';
  return { email: c.email, apiKey: c.api_key, sandbox };
}

const domini = (sandbox) => ({
  oauth: (sandbox ? 'test.' : '') + 'oauth.openapi.com',
  realestate: (sandbox ? 'test.' : '') + 'realestate.openapi.com',
  catasto: (sandbox ? 'test.' : '') + 'catasto.openapi.com',
});

// Token in cache per processo, per ambiente — mai nel DB: si rigenera da solo a ogni
// riavvio del server o quando scade, l'email/API key restano l'unica cosa persistita.
const cache = {};

async function ottieniToken(c, scopes) {
  const d = domini(c.sandbox);
  const chiave = (c.sandbox ? 'sandbox' : 'produzione') + ':' + scopes.slice().sort().join(',');
  const cached = cache[chiave];
  if (cached && cached.scadenza > Date.now() + 60000) return cached.token;
  const basic = Buffer.from(c.email + ':' + c.apiKey).toString('base64');
  const res = await fetch('https://' + d.oauth + '/tokens', {
    method: 'POST',
    headers: { Authorization: 'Basic ' + basic, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Platform — Mediazione immobiliare', scopes, ttl: 2592000 }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || !data.data || !data.data.token) {
    throw Object.assign(new Error((data && data.message) || 'Token OpenAPI.it non ottenuto (' + res.status + ')'), { status: res.status, data });
  }
  cache[chiave] = { token: data.data.token, scadenza: Date.now() + 25 * 24 * 3600 * 1000 };
  return data.data.token;
}

async function chiamata(dominio, path, body, scope) {
  const c = credenziali();
  if (!c) throw Object.assign(new Error('OpenAPI.it non collegato: imposta email e API key in Impostazioni → Connessioni.'), { status: 503, code: 'not_connected' });
  const d = domini(c.sandbox);
  const token = await ottieniToken(c, [scope]);
  const res = await fetch('https://' + d[dominio] + path, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error((data && data.message) || 'Richiesta OpenAPI.it non riuscita (' + res.status + ')'), { status: res.status, data });
  return data;
}

// Variante GET con query string — /IT-comparable e /IT-omi non prendono un indirizzo ma
// lat/lng (nessun corpo POST, parametri nell'URL).
async function chiamataGet(dominio, path, params, scope) {
  const c = credenziali();
  if (!c) throw Object.assign(new Error('OpenAPI.it non collegato: imposta email e API key in Impostazioni → Connessioni.'), { status: 503, code: 'not_connected' });
  const d = domini(c.sandbox);
  const token = await ottieniToken(c, [scope]);
  const qs = Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
  const res = await fetch('https://' + d[dominio] + path + (qs ? '?' + qs : ''), {
    headers: { Authorization: 'Bearer ' + token },
    signal: AbortSignal.timeout(20000),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error((data && data.message) || 'Richiesta OpenAPI.it non riuscita (' + res.status + ')'), { status: res.status, data });
  return data;
}

// Valutazione al mq da un indirizzo — POST /IT-sqm_value_start, risposta sincrona.
// for: 'sale' | 'rent'. type: uno dei codici tipologia OpenAPI.it (20 = Abitazioni civili).
async function valoreAlMq({ address, forSale = true, type = 20 }) {
  const d = credenziali() && domini(credenziali().sandbox);
  const scope = 'POST:' + (d ? d.realestate : 'realestate.openapi.com') + '/IT-sqm_value_start';
  return chiamata('realestate', '/IT-sqm_value_start', { address, for: forSale ? 'sale' : 'rent', type }, scope);
}

// Valutazione "avanzata" — stesso input di valoreAlMq, in più demografia della zona,
// rischio sismico, dinamicità del mercato e tempi medi di permanenza sul mercato per
// taglio. Secondo la documentazione può rispondere in modo asincrono (stato
// "in_erogazione"): qui si riprova un paio di volte con una breve pausa prima di
// arrendersi, invece di far fallire la valutazione per una risposta arrivata un attimo
// dopo la prima richiesta — in sandbox risponde comunque subito nei test fatti.
async function valoreAlMqAvanzato({ address, forSale = true, type = 20 }) {
  const d = credenziali() && domini(credenziali().sandbox);
  const scope = 'POST:' + (d ? d.realestate : 'realestate.openapi.com') + '/IT-sqm_value_advanced';
  let out = await chiamata('realestate', '/IT-sqm_value_advanced', { address, for: forSale ? 'sale' : 'rent', type }, scope);
  let tentativi = 0;
  while (out && out.data && out.data.stato === 'in_erogazione' && tentativi < 3) {
    await new Promise((r) => setTimeout(r, 2000));
    out = await leggiAvanzata(out.data.id);
    tentativi++;
  }
  return out;
}

async function leggiAvanzata(id) {
  const c = credenziali();
  const d = domini(c.sandbox);
  const token = await ottieniToken(c, ['GET:' + d.realestate + '/IT-sqm_value_advanced']);
  const res = await fetch('https://' + d.realestate + '/IT-sqm_value_advanced/' + id, { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(15000) });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error((data && data.message) || 'Lettura esito non riuscita (' + res.status + ')'), { status: res.status, data });
  return data;
}

// Annunci comparabili vicino a un punto — GET /IT-comparable (lat/lng, non un indirizzo).
async function comparabili({ lat, lng, raggioMetri = 2000, limite = 6, forSale = true }) {
  const d = credenziali() && domini(credenziali().sandbox);
  const scope = 'GET:' + (d ? d.realestate : 'realestate.openapi.com') + '/IT-comparable';
  return chiamataGet('realestate', '/IT-comparable', { latitude: lat, longitude: lng, search_radius: raggioMetri, limit: limite, type: forSale ? 'sale' : 'rent' }, scope);
}

// Quotazioni ufficiali dell'Osservatorio del Mercato Immobiliare (Agenzia delle Entrate) per la zona — GET /IT-omi (lat/lng).
async function omi({ lat, lng }) {
  const d = credenziali() && domini(credenziali().sandbox);
  const scope = 'GET:' + (d ? d.realestate : 'realestate.openapi.com') + '/IT-omi';
  return chiamataGet('realestate', '/IT-omi', { latitude: lat, longitude: lng }, scope);
}

// Ricerca immobili per codice fiscale/partita IVA — POST /ipotecarie-ispezione_nazionale.
// Asincrona: ritorna subito un id con stato "in corso", l'esito va letto dopo con GET /ipotecarie/{id}.
async function ricercaPerCF({ cfOPiva, richiedente, motivo }) {
  const d = credenziali() && domini(credenziali().sandbox);
  const scopePost = 'POST:' + (d ? d.catasto : 'catasto.openapi.com') + '/ipotecarie-ispezione_nazionale';
  return chiamata('catasto', '/ipotecarie-ispezione_nazionale', { cf_piva: cfOPiva, richiedente, motivo: motivo || 'verifica preliminare per compravendita' }, scopePost);
}

async function esitoRicerca(id) {
  const c = credenziali();
  if (!c) throw Object.assign(new Error('OpenAPI.it non collegato.'), { status: 503, code: 'not_connected' });
  const d = domini(c.sandbox);
  const token = await ottieniToken(c, ['GET:' + d.catasto + '/ipotecarie']);
  const res = await fetch('https://' + d.catasto + '/ipotecarie/' + id, { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(15000) });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error((data && data.message) || 'Lettura esito non riuscita (' + res.status + ')'), { status: res.status, data });
  return data;
}


// ── Controllo dei servizi attivi ─────────────────────────────────────────────────────────────────────────────────────────────────
// Quali prodotti di OpenAPI.it la chiave collegata può usare davvero. Per ognuno si chiede il token con lo scope di UNA lettura gratuita (l'elenco delle proprie richieste,
// o un elenco di servizio) e la si prova: nessun controllo a pagamento parte. L'elenco dei servizi è un dato (nome, dominio, rotta): per un prodotto in più si aggiunge una riga.
// `dominio` è senza il prefisso `test.` dell'ambiente di prova, che si aggiunge da solo. `lettura: null` = nessuna lettura gratuita nota: si controlla solo che il token si ottenga.
const SERVIZI = [
  { id: 'real_estate', nome: 'Real Estate (valutazione immobiliare)', dominio: 'realestate.openapi.com', rotta: '/IT-omi', lettura: null },
  { id: 'catasto', nome: 'Catasto (visure e immobili)', dominio: 'catasto.openapi.com', rotta: '/territorio', lettura: true },
  { id: 'risk_patrimoniale', nome: 'Risk — report patrimoniale sulla persona', dominio: 'risk.openapi.com', rotta: '/IT-patrimoniale-persona/', scope: '/IT-patrimoniale-persona', lettura: true },
  { id: 'risk_report', nome: 'Risk — report sulla persona', dominio: 'risk.openapi.com', rotta: '/IT-report-persona/', scope: '/IT-report-persona', lettura: true },
  { id: 'visure_camerali', nome: 'Visure camerali (società, soci)', dominio: 'visurecamerali.openapi.it', rotta: '/ordinaria-impresa-individuale', lettura: true },
];

async function verificaServizi() {
  const c = credenziali();
  if (!c) throw Object.assign(new Error('OpenAPI.it non collegato: imposta email e API key in Impostazioni → Connessioni.'), { status: 503, code: 'not_connected' });
  const out = [];
  for (const sv of SERVIZI) {
    const host = (c.sandbox ? 'test.' : '') + sv.dominio;
    const base = { id: sv.id, nome: sv.nome };
    let token;
    try { token = await ottieniToken(c, ['GET:' + host + (sv.scope || sv.rotta)]); }
    catch (e) { out.push({ ...base, stato: 'non_abilitato', dettaglio: String((e && e.message) || 'Token non ottenuto').slice(0, 200) }); continue; }
    if (!sv.lettura) { out.push({ ...base, stato: 'token_ok', dettaglio: 'Il token si ottiene; nessuna lettura gratuita da provare (è il servizio usato dalla valutazione).' }); continue; }
    try {
      const res = await fetch('https://' + host + sv.rotta, { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(15000) });
      const dati = await res.json().catch(() => null);
      const msg = String((dati && (dati.message || dati.error)) || '').slice(0, 160);
      if (res.ok) out.push({ ...base, stato: 'attivo', dettaglio: 'La lettura di prova è riuscita.' });
      else if (res.status === 401 || res.status === 403) out.push({ ...base, stato: 'non_abilitato', dettaglio: msg || 'Non autorizzato (' + res.status + ').' });
      else out.push({ ...base, stato: 'incerto', dettaglio: 'Il servizio ha risposto ' + res.status + (msg ? ': ' + msg : '') + '. Il token c\'è: si capisce provando un controllo vero.' });
    } catch (e) { out.push({ ...base, stato: 'incerto', dettaglio: 'Nessuna risposta dal servizio (' + String((e && e.message) || e).slice(0, 80) + ').' }); }
  }
  return { ambiente: c.sandbox ? 'prova' : 'produzione', servizi: out };
}

module.exports = { SERVIZI, verificaServizi, credenziali, valoreAlMq, valoreAlMqAvanzato, comparabili, omi, ricercaPerCF, esitoRicerca };
