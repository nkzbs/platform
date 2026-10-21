'use strict';
const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('./auth');

const router = express.Router();

// Riga singola (id fisso 1, vedi db.js) — intestazione azienda usata nei documenti
// stampabili. GET aperta a ogni utente autenticato (serve anche a chi compone/vede
// un'anteprima di stampa, non solo all'admin che la modifica).
const AZIENDA_COLUMNS = 'ragione_sociale, indirizzo, piva, logo_url, accent_color, hide_platform_name, login_headline, login_subheadline, login_body, login_hero_image_url';

router.get('/azienda', requireAuth, (req, res) => {
  const row = db.prepare('SELECT ' + AZIENDA_COLUMNS + ' FROM tenant_settings WHERE id = 1').get();
  res.json(row || { ragione_sociale: null, indirizzo: null, piva: null, logo_url: null, accent_color: null, hide_platform_name: 0, login_headline: null, login_subheadline: null, login_body: null, login_hero_image_url: null });
});

router.put('/azienda', requireAuth, requireAdmin, (req, res) => {
  const { ragione_sociale, indirizzo, piva, logo_url, accent_color, hide_platform_name, login_headline, login_subheadline, login_body, login_hero_image_url } = req.body;
  db.prepare('UPDATE tenant_settings SET ragione_sociale = ?, indirizzo = ?, piva = ?, logo_url = ?, accent_color = ?, hide_platform_name = ?, login_headline = ?, login_subheadline = ?, login_body = ?, login_hero_image_url = ? WHERE id = 1')
    .run(ragione_sociale || null, indirizzo || null, piva || null, logo_url || null, accent_color || null, hide_platform_name ? 1 : 0, login_headline || null, login_subheadline || null, login_body || null, login_hero_image_url || null);
  // Icona PWA/dock (icon-192/512, apple-touch-icon, theme_color del manifest):
  // ricolorata o riportata di fabbrica appena il colore cambia, non solo al
  // prossimo riavvio del container — vedi pwa-icon.js.
  require('../pwa-icon').apply();
  const row = db.prepare('SELECT ' + AZIENDA_COLUMNS + ' FROM tenant_settings WHERE id = 1').get();
  res.json(row);
});

module.exports = router;
