'use strict';
// Da un indirizzo scritto a parole a un punto sulla mappa (latitudine, longitudine), con Nominatim di OpenStreetMap: gratuito e senza chiave.
// Regole d'uso pubbliche rispettate: un User-Agent che dice cos'è, UNA richiesta al secondo al massimo e risultati tenuti in cache (un indirizzo già cercato non
// riparte). Parte solo l'indirizzo scritto dall'utente nella scheda, mai altri dati. Best-effort: se il servizio non risponde, la mappa non c'è e la scheda resta valida.
const db = require('../db');
const UA = 'Platform-mappa-immobili/1.0';
const URL_NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const GIORNO = 86400000;

db.exec('CREATE TABLE IF NOT EXISTS geocode_cache (q TEXT PRIMARY KEY, lat REAL, lon REAL, nome TEXT, ts INTEGER NOT NULL)');

// Come si scrive un civico negli atti: «n.ro 3», «n° 3», «nr. 3», «civ. 3», «numero 3». Il servizio non li capisce e non trova l'indirizzo. Si toglie SOLO la sigla e solo quando
// è seguita da una cifra (mai un «n» da solo, mai una parola che ci somiglia: «Via N. Sauro 5», «Via Civitavecchia 3», «Piazza 4 Novembre 2» restano come sono).
const PREFISSO_CIVICO = /(?<![\p{L}\d])(?:n\s*\.?\s*ro|nr|n\s*[°º]|num(?:ero)?|civ(?:ico)?)\.?\s*(?=\d)|(?<![\p{L}\d])n\.\s*(?=\d)/giu;
const ripulisciCivico = (q) => String(q || '').replace(PREFISSO_CIVICO, '').replace(/\s+,/g, ',').replace(/\s+/g, ' ').trim();

const normalizza = (q) => String(q || '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 200);

// Una sola richiesta di rete alla volta, a un secondo l'una dall'altra.
let coda = Promise.resolve();
const PAUSA_MS = 1100;
function inFila(fn) {
  const esito = coda.then(fn, fn);
  coda = esito.then(() => new Promise((r) => setTimeout(r, module.exports._pausa)), () => new Promise((r) => setTimeout(r, module.exports._pausa)));
  return esito;
}

async function chiedi(q, paese) {
  const url = URL_NOMINATIM + '?format=jsonv2&limit=1&addressdetails=0&q=' + encodeURIComponent(q) + (paese ? '&countrycodes=' + encodeURIComponent(paese) : '');
  const res = await module.exports._fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'it' }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw Object.assign(new Error('Nominatim non ha risposto (' + res.status + ')'), { status: res.status });
  const lista = await res.json();
  const r = Array.isArray(lista) ? lista[0] : null;
  if (!r || !isFinite(parseFloat(r.lat)) || !isFinite(parseFloat(r.lon))) return null;
  return { lat: parseFloat(r.lat), lon: parseFloat(r.lon), nome: String(r.display_name || '').slice(0, 200) };
}

// Cerca UN testo (una sola chiave di cache); ritorna { lat, lon, nome } oppure null (non trovato o servizio non raggiungibile).
async function cercaUno(testo, { paese = '', adesso = Date.now() } = {}) {
  const q = normalizza(testo);
  if (q.length < 3) return null;
  const chiave = q + (paese ? '|' + paese : '');
  const c = db.prepare('SELECT lat, lon, nome, ts FROM geocode_cache WHERE q = ?').get(chiave);
  if (c && adesso - c.ts < (c.lat === null ? GIORNO : 30 * GIORNO)) return c.lat === null ? null : { lat: c.lat, lon: c.lon, nome: c.nome };
  try {
    const r = await inFila(() => chiedi(q, paese));
    db.prepare('INSERT INTO geocode_cache (q, lat, lon, nome, ts) VALUES (?, ?, ?, ?, ?) ON CONFLICT(q) DO UPDATE SET lat = excluded.lat, lon = excluded.lon, nome = excluded.nome, ts = excluded.ts').run(chiave, r ? r.lat : null, r ? r.lon : null, r ? r.nome : null, adesso);
    return r;
  } catch (e) {
    return null; // servizio occupato o irraggiungibile: non si mette in cache, si riprova alla prossima apertura
  }
}

// Prima l'indirizzo senza «n.ro», «n°», «civ.»…; se così non si trova (e il testo era diverso) anche come è stato scritto: ripulire non deve mai far perdere un indirizzo che prima si trovava.
async function cerca(testo, opzioni = {}) {
  const ripulito = ripulisciCivico(testo);
  const r = await cercaUno(ripulito, opzioni);
  if (r || normalizza(ripulito) === normalizza(testo)) return r;
  return cercaUno(testo, opzioni);
}

module.exports = { cerca, normalizza, ripulisciCivico, _fetch: (...a) => fetch(...a), _pausa: PAUSA_MS };
