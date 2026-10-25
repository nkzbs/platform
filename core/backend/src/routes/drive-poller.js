'use strict';
// Stato del collegamento Drive bidirezionale (quale modulo, se c'è) e un
// pulsante "Sincronizza adesso" per non aspettare il giro automatico di 15
// minuti — richiesto dall'utente il 25/10/2026 dopo aver visto il poller
// in azione: "un tasto aggiorna nei documenti per forzare il sync".
const express = require('express');
const { requireAuth } = require('./auth');
const { pollDrive, moduloArchivio } = require('../drive-poller');
const { isDriveEnabled } = require('./google-oauth');

const router = express.Router();

router.get('/status', requireAuth, (req, res) => {
  const m = moduloArchivio();
  res.json({ disponibile: isDriveEnabled() && !!m, modulo: m ? m.slug : null });
});

router.post('/sync', requireAuth, async (req, res) => {
  try {
    const esito = await pollDrive();
    res.json(esito);
  } catch (e) {
    res.status(500).json({ error: 'Sincronizzazione Drive fallita: ' + e.message });
  }
});

module.exports = router;
