'use strict';
// I primi passi di un tenant nuovo (solo admin):
//   GET  /api/setup-wizard/stato   { mostra, passi: { moduli, collegamenti, utenti, connessioni } }
//   POST /api/setup-wizard/chiudi  chiude il percorso (fatto o saltato): non si riapre da solo
// Si mostra solo se il percorso non è mai stato chiuso E il tenant è vuoto (nessuna riga): un tenant già in uso non lo vede mai. I numeri dei
// passi sono letti dai dati veri (cosa è già stato fatto), non da una lista di spunte salvate.
const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('./auth');
const { parseSchemaNormalized } = require('../schema-v3');

const router = express.Router();
const chiuso = () => (db.prepare('SELECT setup_wizard FROM tenant_settings WHERE id = 1').get() || {}).setup_wizard === 'done';
function chiudi() { db.prepare("UPDATE tenant_settings SET setup_wizard = 'done' WHERE id = 1").run(); }

router.get('/stato', requireAuth, requireAdmin, (req, res) => {
  const righe = db.prepare('SELECT COUNT(*) c FROM records').get().c;
  const moduli = db.prepare('SELECT schema_json FROM modules WHERE installed = 1 AND COALESCE(is_system, 0) = 0').all();
  let collegamenti = 0;
  for (const m of moduli) { try { collegamenti += (parseSchemaNormalized(m.schema_json).relations || []).length; } catch (e) { /* schema illeggibile: nessun collegamento */ } }
  res.json({
    mostra: !chiuso() && righe === 0,
    passi: {
      moduli: moduli.length, collegamenti,
      utenti: db.prepare('SELECT COUNT(*) c FROM users').get().c,
      connessioni: db.prepare('SELECT COUNT(*) c FROM connections WHERE connected = 1').get().c,
    },
  });
});
router.post('/chiudi', requireAuth, requireAdmin, (req, res) => { chiudi(); res.json({ ok: true }); });

module.exports = router;
module.exports.chiudi = chiudi;
