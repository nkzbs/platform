'use strict';
// Icona PWA/dock colorata sul colore del tenant (tenant_settings.accent_color),
// invece del blu/viola fisso di fabbrica — richiesto per distinguere a colpo
// d'occhio due verticali diverse (due container/tenant separati, ciascuno con
// il proprio build identico) salvate come app sul dock (2026-10-21).
//
// Nessuna libreria di grafica pesante (canvas/sharp: compilano un binario
// nativo, già causa di problemi su questo Mac — vedi memoria): pngjs è puro
// JS, stesso comportamento in sviluppo e nell'immagine Docker (node:22-alpine).
//
// Ricolora per "bianchezza" del pixel (il canale minimo tra R/G/B: ~0 per il
// blu/viola di fondo dell'icona originale, ~1 per il bianco del glifo) con un
// lerp(accento, bianco, bianchezza) — non serve una maschera separata da
// mantenere allineata al disegno, e il bordo anti-aliasing tra glifo e sfondo
// resta morbido com'era.
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const db = require('./db');

const ASSETS_DIR = path.join(__dirname, '..', 'assets');
// Nginx serve lo static build da qui dentro lo stesso container (core/Dockerfile,
// supervisord avvia nginx e questo processo Node fianco a fianco) — non esiste
// in sviluppo locale (niente nginx), per cui ogni funzione qui sotto è un no-op
// silenzioso se la cartella manca.
const DIST_DIR = process.env.FRONTEND_DIST_DIR || '/usr/share/nginx/html';
const DEFAULT_THEME_COLOR = '#2563EB'; // stesso valore di fabbrica già in manifest.json
const SIZES = ['192', '512'];

function recolor(buffer, hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const ar = (n >> 16) & 255, ag = (n >> 8) & 255, ab = n & 255;
  const png = PNG.sync.read(buffer);
  const d = png.data;
  for (let i = 0; i < d.length; i += 4) {
    const whiteness = Math.min(d[i], d[i + 1], d[i + 2]) / 255;
    d[i] = Math.round(ar + (255 - ar) * whiteness);
    d[i + 1] = Math.round(ag + (255 - ag) * whiteness);
    d[i + 2] = Math.round(ab + (255 - ab) * whiteness);
  }
  return PNG.sync.write(png);
}

// Da chiamare all'avvio (ogni redeploy riparte dalle icone di fabbrica dentro
// l'immagine) e ogni volta che l'admin salva il colore in Impostazioni →
// Aspetto (routes/settings.js) — idempotente: nessun colore scelto = ripristina
// le icone di fabbrica, così togliere il colore funziona quanto impostarlo.
function apply() {
  if (!fs.existsSync(DIST_DIR)) return;
  let accentColor;
  try {
    const row = db.prepare("SELECT accent_color FROM tenant_settings WHERE id = 1").get();
    accentColor = row && row.accent_color;
  } catch (e) {
    return; // tabella non ancora pronta (avvio prima delle migrazioni)
  }

  for (const size of SIZES) {
    const src = path.join(ASSETS_DIR, `icon-${size}.png`);
    if (!fs.existsSync(src)) continue;
    const original = fs.readFileSync(src);
    const out = accentColor ? (recolor(original, accentColor) || original) : original;
    fs.writeFileSync(path.join(DIST_DIR, `icon-${size}.png`), out);
    if (size === '192') fs.writeFileSync(path.join(DIST_DIR, 'apple-touch-icon.png'), out);
  }

  const manifestPath = path.join(DIST_DIR, 'manifest.json');
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.theme_color = accentColor || DEFAULT_THEME_COLOR;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  } catch (e) {
    // manifest.json mancante/illeggibile: le icone sono comunque aggiornate, non blocchiamo per questo
  }
}

module.exports = { apply, recolor };
