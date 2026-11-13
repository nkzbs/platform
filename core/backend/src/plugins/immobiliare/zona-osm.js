'use strict';
// Dati di contesto di un punto da OpenStreetMap — gratuiti e senza chiave, come lib/rischi-territorio.js.
// Servizi vicini (Overpass), tempi verso la stazione più vicina (OSRM) e tessere per la mappa del
// report. Tutto best-effort: se un servizio non risponde, la valutazione resta valida senza.
// Regole d'uso pubbliche rispettate: un'intestazione User-Agent che dice cos'è (nessun dato personale),
// poche richieste per valutazione, tessere in cache. Fonte da citare: «© OpenStreetMap contributors».

const UA = 'Platform-valutazione-immobili/1.0';
// Più server pubblici: se il primo è occupato o non risponde, si prova il successivo.
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

function distanzaM(a, b) {
  const R = 6371000, rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function overpass(query) {
  let ultimo;
  for (const url of OVERPASS) {
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(query), signal: AbortSignal.timeout(20000) });
      if (!res.ok) { ultimo = Object.assign(new Error('Overpass non ha risposto (' + res.status + ')'), { status: res.status }); continue; }
      const data = await res.json();
      return Array.isArray(data.elements) ? data.elements : [];
    } catch (e) { ultimo = e; }
  }
  throw ultimo || new Error('Overpass non raggiungibile');
}

const puntoDi = (el) => (el.lat != null ? { lat: el.lat, lng: el.lon } : el.center ? { lat: el.center.lat, lng: el.center.lon } : null);

// Categorie mostrate nel report: chiave, nome, come riconoscerle nei tag OSM.
const CATEGORIE = [
  { chiave: 'scuole', nome: 'Scuole e asili', // scuole di danza, guida, musica ecc. in OSM sono spesso marcate «school»: non sono scuole per i bambini
    ok: (t) => ['school', 'kindergarten'].includes(t.amenity) && !/tango|danza|ballo|guida|musica|lingue|nuoto|calcio|sport|yoga|fitness|inglese|arte\b/i.test(t.name || '') },
  { chiave: 'spesa', nome: 'Supermercati e alimentari', ok: (t) => ['supermarket', 'convenience'].includes(t.shop) },
  { chiave: 'farmacie', nome: 'Farmacie', ok: (t) => t.amenity === 'pharmacy' },
  { chiave: 'sanita', nome: 'Ospedali e studi medici', ok: (t) => ['hospital', 'clinic', 'doctors'].includes(t.amenity) },
  { chiave: 'trasporti', nome: 'Fermate dei mezzi pubblici', ok: (t) => t.highway === 'bus_stop' || ['tram_stop', 'subway_entrance', 'station'].includes(t.railway) || t.public_transport === 'station' },
  { chiave: 'parchi', nome: 'Parchi e giardini', ok: (t) => t.leisure === 'park' || t.leisure === 'garden' },
];

// → [{ chiave, nome, entro500, entro1000, piuVicino:{ nome, metri }|null }]
async function servizi({ lat, lng }) {
  const c = lat + ',' + lng;
  const els = await overpass('[out:json][timeout:20];(' +
    'nwr(around:1000,' + c + ')[amenity~"^(school|kindergarten|pharmacy|hospital|clinic|doctors)$"];' +
    'nwr(around:1000,' + c + ')[shop~"^(supermarket|convenience)$"];' +
    'nwr(around:1000,' + c + ')[highway=bus_stop];' +
    'nwr(around:1000,' + c + ')[railway~"^(station|tram_stop|subway_entrance)$"];' +
    'nwr(around:1000,' + c + ')[leisure~"^(park|garden)$"];' +
    ');out center tags 400;');
  const qui = { lat, lng };
  return CATEGORIE.map((cat) => {
    const trovati = els.filter((e) => cat.ok(e.tags || {})).map((e) => ({ e, p: puntoDi(e) })).filter((x) => x.p)
      .map((x) => ({ nome: (x.e.tags && (x.e.tags.name || x.e.tags.operator)) || null, metri: Math.round(distanzaM(qui, x.p)) }))
      .sort((a, b) => a.metri - b.metri);
    return { chiave: cat.chiave, nome: cat.nome, entro500: trovati.filter((x) => x.metri <= 500).length, entro1000: trovati.length, piuVicino: trovati[0] || null };
  });
}

// Tempo di viaggio da OSRM: a piedi (server della comunità OSM) e in auto (demo OSRM). → minuti | null
async function tempoOsrm(base, profilo, da, a) {
  try {
    const res = await fetch(base + '/route/v1/' + profilo + '/' + da.lng + ',' + da.lat + ';' + a.lng + ',' + a.lat + '?overview=false', { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) });
    if (!res.ok) return null;
    const j = await res.json();
    const r = j.routes && j.routes[0];
    return r ? { minuti: Math.max(1, Math.round(r.duration / 60)), km: Math.round(r.distance / 100) / 10 } : null;
  } catch (e) { return null; }
}

// Stazione ferroviaria più vicina (entro 6 km) e quanto ci vuole ad arrivarci. → { nome, metri, piedi, auto } | null
async function stazione({ lat, lng }) {
  const els = await overpass('[out:json][timeout:20];nwr(around:6000,' + lat + ',' + lng + ')[railway=station];out center tags 60;');
  const qui = { lat, lng };
  const ordinate = els.map((e) => ({ e, p: puntoDi(e) })).filter((x) => x.p).filter((x) => !['subway', 'light_rail'].includes(x.e.tags && x.e.tags.station)).map((x) => ({ nome: (x.e.tags && x.e.tags.name) || 'Stazione', p: x.p, metri: Math.round(distanzaM(qui, x.p)) })).sort((a, b) => a.metri - b.metri);
  const s = ordinate[0];
  if (!s) return null;
  const [piedi, auto] = await Promise.all([
    tempoOsrm('https://routing.openstreetmap.de/routed-foot', 'driving', qui, s.p), // su questo server il profilo «driving» è quello a piedi
    tempoOsrm('https://router.project-osrm.org', 'driving', qui, s.p),
  ]);
  return { nome: s.nome, metri: s.metri, piedi, auto };
}

// ── Mappa: tessere OSM affiancate dal report ──
const cacheTessere = new Map(); // chiave z/x/y → Buffer (poche, solo per non richiedere due volte la stessa)
const ZOOM = 16;

function tessera(lat, lng, z) {
  const n = 2 ** z, x = ((lng + 180) / 360) * n;
  const lr = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(lr) + 1 / Math.cos(lr)) / Math.PI) / 2) * n;
  return { x, y };
}

// → { tessere:[{ buf, dx, dy }], centroPx:{x,y}, lato } con una griglia 3×3 centrata sul punto; null se non scaricabile.
async function tessereMappa({ lat, lng }) {
  try {
    const t = tessera(lat, lng, ZOOM);
    const x0 = Math.floor(t.x) - 1, y0 = Math.floor(t.y) - 1;
    const pezzi = [];
    for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) {
      const k = ZOOM + '/' + (x0 + i) + '/' + (y0 + j);
      let buf = cacheTessere.get(k);
      if (!buf) {
        const res = await fetch('https://tile.openstreetmap.org/' + k + '.png', { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
        if (!res.ok) return null;
        buf = Buffer.from(await res.arrayBuffer());
        if (cacheTessere.size > 90) cacheTessere.delete(cacheTessere.keys().next().value);
        cacheTessere.set(k, buf);
      }
      pezzi.push({ buf, dx: i * 256, dy: j * 256 });
    }
    return { tessere: pezzi, centro: { x: (t.x - x0) * 256, y: (t.y - y0) * 256 }, lato: 768 };
  } catch (e) { return null; }
}

module.exports = { servizi, stazione, tessereMappa, distanzaM };
