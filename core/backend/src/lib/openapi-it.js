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

// Valutazione al mq da un indirizzo — POST /IT-sqm_value_start, risposta sincrona.
// for: 'sale' | 'rent'. type: uno dei codici tipologia OpenAPI.it (20 = Abitazioni civili).
async function valoreAlMq({ address, forSale = true, type = 20 }) {
  const d = credenziali() && domini(credenziali().sandbox);
  const scope = 'POST:' + (d ? d.realestate : 'realestate.openapi.com') + '/IT-sqm_value_start';
  return chiamata('realestate', '/IT-sqm_value_start', { address, for: forSale ? 'sale' : 'rent', type }, scope);
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

module.exports = { credenziali, valoreAlMq, ricercaPerCF, esitoRicerca };
