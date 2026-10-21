'use strict';
// Icona PWA/dock ricolorata sul colore del tenant (pwa-icon.js, apply()):
// senza colore scelto le icone/manifest restano quelle di fabbrica, con un
// colore scelto diventano quel colore (glifo bianco invariato), e tornano di
// fabbrica se il colore viene tolto di nuovo.
// Eseguire con: node src/pwa-icon.test.js

const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const { PNG } = require('pngjs');

const dbPath = path.join(os.tmpdir(), 'pwa-icon-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.DB_PATH = dbPath;
process.env.JWT_SECRET = 'pwi_secret_' + crypto.randomBytes(8).toString('hex');
process.env.ENCRYPTION_KEY = 'pwi_enc_' + crypto.randomBytes(16).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'pwi_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pwi-uploads-'));
// Letto da pwa-icon.js al require (DIST_DIR), va impostato PRIMA — stesso
// bisogno già visto in gmail-poller-token-alert.test.js per getValidAccessToken.
const distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pwi-dist-'));
process.env.FRONTEND_DIST_DIR = distDir;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; }
}
function assertEq(a, e, msg) { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${msg || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); }
function assertTrue(c, msg) { if (!c) throw new Error(msg || 'atteso true'); }

const db = require('./db');
const { apply, recolor } = require('./pwa-icon');

fs.writeFileSync(path.join(distDir, 'manifest.json'), JSON.stringify({ name: 'Platform', theme_color: '#2563EB', background_color: '#031321' }));

const setAccentColor = (hex) => db.prepare('UPDATE tenant_settings SET accent_color = ? WHERE id = 1').run(hex);
const manifest = () => JSON.parse(fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf8'));
const pixelAt = (file, x, y) => {
  const png = PNG.sync.read(fs.readFileSync(path.join(distDir, file)));
  const i = (png.width * y + x) << 2;
  return [png.data[i], png.data[i + 1], png.data[i + 2]];
};

test('recolor(): un pixel bianco puro resta bianco qualunque sia il colore scelto', () => {
  const src = new PNG({ width: 1, height: 1 });
  src.data[0] = 255; src.data[1] = 255; src.data[2] = 255; src.data[3] = 255;
  const out = PNG.sync.read(recolor(PNG.sync.write(src), '#FF0000'));
  assertEq([out.data[0], out.data[1], out.data[2]], [255, 255, 255]);
});

test('recolor(): un pixel nero puro (bianchezza 0, canale minimo 0) diventa esattamente il colore scelto', () => {
  const src = new PNG({ width: 1, height: 1 });
  src.data[0] = 0; src.data[1] = 0; src.data[2] = 0; src.data[3] = 255;
  const out = PNG.sync.read(recolor(PNG.sync.write(src), '#16A34A'));
  assertEq([out.data[0], out.data[1], out.data[2]], [0x16, 0xA3, 0x4A]);
});

test('recolor(): esadecimale non valido restituisce null (nessun crash)', () => {
  const src = new PNG({ width: 1, height: 1 });
  assertEq(recolor(PNG.sync.write(src), 'non-un-colore'), null);
});

test('apply(): nessun colore scelto — niente scritto sopra le icone di fabbrica, manifest invariato', () => {
  setAccentColor(null);
  apply();
  assertTrue(fs.existsSync(path.join(distDir, 'icon-192.png')), 'icon-192.png deve esistere');
  assertTrue(fs.existsSync(path.join(distDir, 'apple-touch-icon.png')), 'apple-touch-icon.png deve esistere');
  assertEq(manifest().theme_color, '#2563EB');
});

test('apply(): colore scelto — le icone e il theme_color del manifest cambiano', () => {
  setAccentColor('#16A34A');
  apply();
  assertEq(manifest().theme_color, '#16A34A');
  // Un pixel al centro dell'icona 192 è sfondo (fuori dai due quadratini bianchi
  // del glifo, vedi App.jsx/icon-192.png): deve aver preso il tono del verde scelto.
  const [r, g, b] = pixelAt('icon-192.png', 150, 20);
  assertTrue(g > r && g > b, `atteso un pixel a dominante verde, ottenuto rgb(${r},${g},${b})`);
});

test('apply(): colore tolto di nuovo — le icone tornano quelle di fabbrica', () => {
  setAccentColor(null);
  apply();
  assertEq(manifest().theme_color, '#2563EB');
  const fabbrica = fs.readFileSync(path.join(__dirname, '..', 'assets', 'icon-192.png'));
  const attuale = fs.readFileSync(path.join(distDir, 'icon-192.png'));
  assertTrue(fabbrica.equals(attuale), 'icon-192.png deve tornare identica a quella di fabbrica');
});

console.log(`\n${'='.repeat(60)}`);
console.log(passed + ' passati, ' + failed + ' falliti su ' + (passed + failed) + ' test.');
try { fs.unlinkSync(dbPath); } catch (e) {}
try { fs.rmSync(distDir, { recursive: true, force: true }); } catch (e) {}
process.exit(failed > 0 ? 1 : 0);
