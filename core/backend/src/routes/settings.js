'use strict';
const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('./auth');

const router = express.Router();

// Riga singola (id fisso 1, vedi db.js) — intestazione azienda usata nei documenti
// stampabili. GET aperta a ogni utente autenticato (serve anche a chi compone/vede
// un'anteprima di stampa, non solo all'admin che la modifica).
const AZIENDA_COLUMNS = 'ragione_sociale, indirizzo, piva, logo_url, accent_color, hide_platform_name, login_headline, login_subheadline, login_body, login_hero_image_url, app_name, app_logo_url';

router.get('/azienda', requireAuth, (req, res) => {
  const row = db.prepare('SELECT ' + AZIENDA_COLUMNS + ' FROM tenant_settings WHERE id = 1').get();
  res.json(row || { ragione_sociale: null, indirizzo: null, piva: null, logo_url: null, accent_color: null, hide_platform_name: 0, login_headline: null, login_subheadline: null, login_body: null, login_hero_image_url: null, app_name: null, app_logo_url: null });
});

router.put('/azienda', requireAuth, requireAdmin, (req, res) => {
  const { ragione_sociale, indirizzo, piva, logo_url, accent_color, hide_platform_name, login_headline, login_subheadline, login_body, login_hero_image_url } = req.body;
  // Il logo è un indirizzo https oppure un'immagine incorporata (PNG/JPEG/WebP, fino a ~700 KB): niente altro,
  // perché finisce anche in un <img> e nei PDF.
  // Nome dell'app: una riga corta, senza a capo (compare nella barra laterale, nel login e nel titolo della scheda del browser).
  const appName = typeof req.body.app_name === 'string' ? req.body.app_name.replace(/[\r\n]+/g, ' ').trim().slice(0, 40) : '';
  const { app_logo_url } = req.body;
  if (app_logo_url && !require('../lib/azienda').logoValido(app_logo_url)) {
    return res.status(400).json({ error: 'Il logo dell\'app deve essere un\'immagine PNG, JPEG o WebP (fino a circa 700 KB) o un indirizzo https.' });
  }
  if (logo_url && !require('../lib/azienda').logoValido(logo_url)) {
    return res.status(400).json({ error: 'Il logo deve essere un\'immagine PNG, JPEG o WebP (fino a circa 700 KB) o un indirizzo https.' });
  }
  db.prepare('UPDATE tenant_settings SET ragione_sociale = ?, indirizzo = ?, piva = ?, logo_url = ?, accent_color = ?, hide_platform_name = ?, login_headline = ?, login_subheadline = ?, login_body = ?, login_hero_image_url = ? WHERE id = 1')
    .run(ragione_sociale || null, indirizzo || null, piva || null, logo_url || null, accent_color || null, hide_platform_name ? 1 : 0, login_headline || null, login_subheadline || null, login_body || null, login_hero_image_url || null);
  // Icona PWA/dock (icon-192/512, apple-touch-icon, theme_color del manifest):
  // ricolorata o riportata di fabbrica appena il colore cambia, non solo al
  // prossimo riavvio del container — vedi pwa-icon.js.
  require('../pwa-icon').apply();
  // L'identità dell'app si cambia solo se la richiesta la porta (un client vecchio che rimanda la riga senza questi campi non li azzera).
  if ('app_name' in req.body) db.prepare('UPDATE tenant_settings SET app_name = ? WHERE id = 1').run(appName || null);
  if ('app_logo_url' in req.body) db.prepare('UPDATE tenant_settings SET app_logo_url = ? WHERE id = 1').run(app_logo_url || null);
  const row = db.prepare('SELECT ' + AZIENDA_COLUMNS + ' FROM tenant_settings WHERE id = 1').get();
  res.json(row);
});

module.exports = router;
