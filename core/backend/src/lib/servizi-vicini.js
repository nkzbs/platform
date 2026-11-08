'use strict';
// Servizi vicini a un punto (supermercati, farmacie, scuole, sanità, trasporti, verde) con Overpass di OpenStreetMap: gratuito e senza chiave.
// Regole d'uso rispettate come per la geocodifica: User-Agent che dice cos'è, UNA richiesta alla volta con una pausa, risultati in cache (7 giorni, per una cella di
// circa 100 metri) e solo le coordinate del punto vanno al servizio. Il tempo a piedi è una STIMA dalla distanza in linea d'aria (percorso reale ≈ 1,25 volte, 80 m al minuto),
// non un percorso calcolato: la mappa dà il percorso vero con «Percorso». Best-effort: il servizio pubblico può metterci anche 30-40 secondi (provato l'8/11/2026): la scheda non aspetta,
// l'elenco compare quando arriva; se il servizio non risponde non c'è l'elenco e la scheda resta valida.
const db = require('../db');
const UA = 'Platform-servizi-immobili/1.0';
const URL_OVERPASS = 'https://overpass-api.de/api/interpreter';
const GIORNI = 86400000;
const RAGGIO = 1000; // metri

db.exec('CREATE TABLE IF NOT EXISTS servizi_cache (chiave TEXT PRIMARY KEY, json TEXT NOT NULL, ts INTEGER NOT NULL)');

// chiave, etichetta, filtri OSM (tag=valore, o tag~"a|b")
const CATEGORIE = [
  { chiave: 'spesa', label: 'Supermercati e alimentari', filtri: ['shop~"^(supermarket|convenience|greengrocer)$"'] },
  { chiave: 'farmacia', label: 'Farmacie', filtri: ['amenity=pharmacy'] },
  { chiave: 'scuola', label: 'Scuole e asili', filtri: ['amenity~"^(school|kindergarten)$"'] },
  { chiave: 'sanita', label: 'Ospedali e medici', filtri: ['amenity~"^(hospital|clinic|doctors)$"'] },
  { chiave: 'trasporti', label: 'Fermate e stazioni', filtri: ['highway=bus_stop', 'railway~"^(station|tram_stop|subway_entrance)$"'] },
  { chiave: 'verde', label: 'Parchi e giardini', filtri: ['leisure~"^(park|playground)$"'] },
];

let coda = Promise.resolve();
function inFila(fn) {
  const esito = coda.then(fn, fn);
  coda = esito.then(() => new Promise((r) => setTimeout(r, module.exports._pausa)), () => new Promise((r) => setTimeout(r, module.exports._pausa)));
  return esito;
}

function distanzaMetri(lat1, lon1, lat2, lon2) {
  const R = 6371000, rad = Math.PI / 180, dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
const minutiAPiedi = (metri) => Math.max(1, Math.round(metri * 1.25 / 80));

function interrogazione(lat, lon) {
  // nodi e aree (le relazioni costano molto e qui servono poco); il servizio pubblico può essere lento: tempo massimo largo, risposta in cache dopo la prima volta
  const parti = CATEGORIE.flatMap((c) => c.filtri.flatMap((f) => ['node', 'way'].map((t) => `${t}(around:${RAGGIO},${lat},${lon})[${f}];`)));
  return `[out:json][timeout:55];(${parti.join('')});out center tags 1000;`;
}

// Associa ogni elemento alla sua categoria rileggendo i tag (stesse regole dei filtri sopra).
function categoriaDi(tags) {
  if (/^(supermarket|convenience|greengrocer)$/.test(tags.shop || '')) return 'spesa';
  if (tags.amenity === 'pharmacy') return 'farmacia';
  if (/^(school|kindergarten)$/.test(tags.amenity || '')) return 'scuola';
  if (/^(hospital|clinic|doctors)$/.test(tags.amenity || '')) return 'sanita';
  if (tags.highway === 'bus_stop' || /^(station|tram_stop|subway_entrance)$/.test(tags.railway || '')) return 'trasporti';
  if (/^(park|playground)$/.test(tags.leisure || '')) return 'verde';
  return null;
}

function riassumi(elementi, lat, lon) {
  const per = Object.fromEntries(CATEGORIE.map((c) => [c.chiave, []]));
  for (const el of elementi || []) {
    const p = el.lat !== undefined ? { lat: el.lat, lon: el.lon } : el.center;
    const chiave = categoriaDi(el.tags || {});
    if (!p || !chiave || !isFinite(p.lat) || !isFinite(p.lon)) continue;
    per[chiave].push({ nome: String((el.tags && (el.tags.name || el.tags.operator)) || '').slice(0, 80), metri: Math.round(distanzaMetri(lat, lon, p.lat, p.lon)), lat: p.lat, lon: p.lon });
  }
  return CATEGORIE.map((c) => {
    const v = per[c.chiave].sort((a, b) => a.metri - b.metri);
    return { chiave: c.chiave, label: c.label, quanti: v.length, piu_vicino: v[0] ? { ...v[0], minuti: minutiAPiedi(v[0].metri) } : null };
  });
}

async function chiedi(lat, lon) {
  const res = await module.exports._fetch(URL_OVERPASS + '?data=' + encodeURIComponent(interrogazione(lat, lon)), { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw Object.assign(new Error('Overpass non ha risposto (' + res.status + ')'), { status: res.status });
  const j = await res.json();
  return riassumi(j && j.elements, lat, lon);
}

// Ritorna { raggio, categorie } oppure null (coordinate non valide o servizio non raggiungibile: non si mette in cache).
async function cerca(lat, lon, { adesso = Date.now() } = {}) {
  lat = Number(lat); lon = Number(lon);
  if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const chiave = 'v2|' + lat.toFixed(3) + '|' + lon.toFixed(3); // v2: ogni luogo porta le sue coordinate (per segnarli sulla mappa del report)
  const c = db.prepare('SELECT json, ts FROM servizi_cache WHERE chiave = ?').get(chiave);
  if (c && adesso - c.ts < 7 * GIORNI) return { raggio: RAGGIO, categorie: JSON.parse(c.json) };
  try {
    const categorie = await inFila(() => chiedi(lat, lon));
    db.prepare('INSERT INTO servizi_cache (chiave, json, ts) VALUES (?, ?, ?) ON CONFLICT(chiave) DO UPDATE SET json = excluded.json, ts = excluded.ts').run(chiave, JSON.stringify(categorie), adesso);
    return { raggio: RAGGIO, categorie };
  } catch (e) {
    return null;
  }
}

// Per la pagina: non si aspetta il servizio (può metterci 30-40 secondi, più di quanto un proxy aspetta). Se c'è in cache risponde subito; altrimenti avvia la ricerca in
// secondo plano e risponde «in corso»: la pagina richiede ogni pochi secondi. Una ricerca fallita non si ripete per 2 minuti (non si martella il servizio).
const inCorso = new Map(); const fallite = new Map();
function stato(lat, lon, { adesso = Date.now() } = {}) {
  lat = Number(lat); lon = Number(lon);
  if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return { valido: false };
  const chiave = 'v2|' + lat.toFixed(3) + '|' + lon.toFixed(3);
  const c = db.prepare('SELECT json, ts FROM servizi_cache WHERE chiave = ?').get(chiave);
  if (c && adesso - c.ts < 7 * GIORNI) return { valido: true, pronto: true, raggio: RAGGIO, categorie: JSON.parse(c.json) };
  if (inCorso.has(chiave)) return { valido: true, in_corso: true };
  if (fallite.has(chiave) && adesso - fallite.get(chiave) < 120000) return { valido: true, in_corso: false, errore: true };
  fallite.delete(chiave);
  inCorso.set(chiave, cerca(lat, lon, { adesso }).then((r) => { if (!r) fallite.set(chiave, Date.now()); }, () => fallite.set(chiave, Date.now())).finally(() => inCorso.delete(chiave)));
  return { valido: true, in_corso: true };
}
const _attese = () => Promise.all([...inCorso.values()]); // per i test

module.exports = { cerca, stato, _attese, riassumi, minutiAPiedi, distanzaMetri, CATEGORIE, RAGGIO, _fetch: (...a) => fetch(...a), _pausa: 1100 };
