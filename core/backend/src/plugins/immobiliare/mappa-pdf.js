'use strict';
// La mappa di OpenStreetMap dentro un PDF (report di valutazione): le tessere si scaricano dal nostro server (con User-Agent che dice cos'è, poche richieste, in cache 14 giorni), si
// disegnano ritagliate in un riquadro e sopra si segnano l'immobile e i luoghi utili vicini (numerati, con la legenda sotto). Solo coordinate di un punto: mai nome o dati del proprietario.
// Best-effort: se le tessere non arrivano il riquadro dice che la mappa non è disponibile e la legenda dei luoghi resta. Fonte da citare: «© OpenStreetMap contributors».
const db = require('../../db');
const UA = 'Platform-mappa-immobili/1.0';
const ZOOM = 14;                 // una tessera ≈ 1,7 km a queste latitudini: con TS = 240 pt una tessera è ~7 m per punto, il cerchio di 1 km sta nel riquadro
const TS = 240;                  // lato di una tessera sul foglio, in punti
const GIORNI14 = 14 * 86400000;
const MAX_TESSERE = 16;

db.exec('CREATE TABLE IF NOT EXISTS tile_cache (z INTEGER NOT NULL, x INTEGER NOT NULL, y INTEGER NOT NULL, img BLOB NOT NULL, ts INTEGER NOT NULL, PRIMARY KEY (z, x, y))');

// Colori dei luoghi per categoria (stessi di lib/servizi-vicini.js: spesa, farmacia, scuola, sanità, trasporti, verde).
const COLORI = { spesa: '#16a34a', farmacia: '#db2777', scuola: '#d97706', sanita: '#7c3aed', trasporti: '#0891b2', verde: '#65a30d' };

// Coordinate di una latitudine/longitudine nella griglia delle tessere (numeri con la virgola: la parte intera è la tessera).
function inTessera(lat, lon, z = ZOOM) {
  const n = 2 ** z, rad = (lat * Math.PI) / 180;
  return { x: ((lon + 180) / 360) * n, y: ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n };
}
const metriPerPunto = (lat, z = ZOOM) => (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z * (256 / TS);

// Le tessere che coprono un riquadro w×h centrato sul punto → { centro, elenco: [{ x, y }] } oppure null se troppe.
function tessereDi(lat, lon, w, h, z = ZOOM) {
  const c = inTessera(lat, lon, z), n = 2 ** z;
  const x0 = Math.floor(c.x - w / 2 / TS), x1 = Math.floor(c.x + w / 2 / TS), y0 = Math.floor(c.y - h / 2 / TS), y1 = Math.floor(c.y + h / 2 / TS);
  const elenco = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (y >= 0 && y < n) elenco.push({ x: ((x % n) + n) % n, xGriglia: x, y });
  return elenco.length > MAX_TESSERE ? null : { centro: c, elenco };
}

async function scarica(z, x, y) {
  const r = db.prepare('SELECT img, ts FROM tile_cache WHERE z = ? AND x = ? AND y = ?').get(z, x, y);
  if (r && Date.now() - r.ts < GIORNI14) return r.img;
  const res = await module.exports._fetch('https://tile.openstreetmap.org/' + z + '/' + x + '/' + y + '.png', { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error('tessera ' + res.status);
  const img = Buffer.from(await res.arrayBuffer());
  if (img.length < 60 || img.subarray(1, 4).toString('latin1') !== 'PNG') throw new Error('tessera non valida');
  db.prepare('INSERT INTO tile_cache (z, x, y, img, ts) VALUES (?, ?, ?, ?, ?) ON CONFLICT(z, x, y) DO UPDATE SET img = excluded.img, ts = excluded.ts').run(z, x, y, img, Date.now());
  return img;
}

// Scarica (o legge dalla cache) le tessere del riquadro, due alla volta. Ritorna { centro, tessere: [{ xGriglia, y, img }] } oppure null se anche una sola manca (una mappa a pezzi è peggio di nessuna mappa).
async function preparaMappa(lat, lon, { w = 507, h = 290 } = {}) {
  lat = Number(lat); lon = Number(lon);
  if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 85 || Math.abs(lon) > 180) return null;
  const t = tessereDi(lat, lon, w, h);
  if (!t) return null;
  const fuori = [];
  try {
    for (let i = 0; i < t.elenco.length; i += 2) {
      const parte = await Promise.all(t.elenco.slice(i, i + 2).map(async (e) => ({ ...e, img: await scarica(ZOOM, e.x, e.y) })));
      fuori.push(...parte);
    }
  } catch (e) { return null; }
  return { centro: t.centro, tessere: fuori, lat, lon };
}

// Disegna la mappa nel riquadro (x, y, w, h) e ritorna i luoghi numerati effettivamente segnati: [{ n, chiave, label, nome, metri, minuti }].
// `luoghi`: categorie di lib/servizi-vicini (con `piu_vicino` { nome, metri, minuti, lat, lon }).
function disegnaMappa(doc, mappa, { x, y, w, h, colore = '#1f4e79', luoghi = [] }) {
  doc.save();
  doc.roundedRect(x, y, w, h, 6).clip();
  doc.rect(x, y, w, h).fill('#e7e5e4');
  if (!mappa) {
    doc.fillColor('#78716c').font('Helvetica-Oblique').fontSize(10).text('Mappa non disponibile in questo momento (il servizio di OpenStreetMap non ha risposto).', x + 20, y + h / 2 - 12, { width: w - 40, align: 'center' });
    doc.restore();
    return numera(luoghi);
  }
  const cx = x + w / 2, cy = y + h / 2, c = mappa.centro;
  for (const t of mappa.tessere) doc.image(t.img, cx + (t.xGriglia - c.x) * TS, cy + (t.y - c.y) * TS, { width: TS, height: TS });
  // cerchio di 1 km attorno all'immobile
  const raggio = 1000 / metriPerPunto(mappa.lat);
  doc.circle(cx, cy, raggio).lineWidth(1.4).dash(5, { space: 4 }).strokeColor(colore).stroke().undash();
  const segnati = numera(luoghi);
  for (const l of segnati) {
    const p = l.pos && inTessera(l.pos.lat, l.pos.lon);
    if (!p) continue;
    const px = cx + (p.x - c.x) * TS, py = cy + (p.y - c.y) * TS;
    if (px < x + 6 || px > x + w - 6 || py < y + 6 || py > y + h - 6) continue;
    doc.circle(px, py, 7.5).lineWidth(1.2).fillAndStroke(COLORI[l.chiave] || '#475569', '#ffffff');
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#ffffff').text(String(l.n), px - 7.5, py - 3.6, { width: 15, align: 'center', lineBreak: false });
  }
  // l'immobile: spillo con il colore dell'azienda
  doc.save().translate(cx, cy);
  doc.path('M0 0 C-3 -9 -9 -13 -9 -20 A9 9 0 1 1 9 -20 C9 -13 3 -9 0 0 Z').lineWidth(1.4).fillAndStroke(colore, '#ffffff');
  doc.circle(0, -20, 3.2).fill('#ffffff');
  doc.restore();
  // fonte, obbligatoria
  doc.save().fillOpacity(0.85).rect(x + w - 150, y + h - 14, 150, 14).fill('#ffffff').restore();
  doc.font('Helvetica').fontSize(7).fillColor('#44403c').text('© OpenStreetMap contributors', x + w - 148, y + h - 11, { width: 146, align: 'right', lineBreak: false });
  doc.restore();
  return segnati;
}

// I luoghi che hanno un più vicino, numerati nell'ordine delle categorie.
function numera(luoghi) {
  let n = 0;
  return (luoghi || []).filter((c) => c && c.piu_vicino).map((c) => ({ n: ++n, chiave: c.chiave, label: c.label, nome: c.piu_vicino.nome, metri: c.piu_vicino.metri, minuti: c.piu_vicino.minuti, quanti: c.quanti, pos: isFinite(c.piu_vicino.lat) && isFinite(c.piu_vicino.lon) ? { lat: c.piu_vicino.lat, lon: c.piu_vicino.lon } : null }));
}

module.exports = { preparaMappa, disegnaMappa, inTessera, tessereDi, metriPerPunto, numera, COLORI, ZOOM, TS, _fetch: (...a) => fetch(...a) };
