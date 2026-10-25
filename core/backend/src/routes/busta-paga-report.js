'use strict';
// Report ore (busta paga vs timbrature) e saldi ferie/permessi/ROL — stessa logica già usata dal
// bot Telegram (bot-payslip.js), qui esposta anche come vista permanente dentro l'app: il bot è un
// front-end comodo in più, non l'unico modo di avere questa informazione ("Platform è la base,
// il bot è opzionale"). Nessun dato nuovo: righeOre/datiSaldi filtrano già per utente che chiede.
//   GET /api/busta-paga-report/ore    -> { disponibile, ha_timbrature, righe: [{periodo,label,pagate,timbrate,diff}] }
//   GET /api/busta-paga-report/saldi  -> { disponibile, ferie, permessi, rol }
const express = require('express');
const { requireAuth } = require('./auth');
const bp = require('../bot-payslip');

const router = express.Router();

router.get('/ore', requireAuth, (req, res) => {
  const m = bp.modulo();
  if (!m) return res.json({ disponibile: false });
  const n = Math.min(parseInt(req.query.n, 10) || 24, 60);
  res.json({ disponibile: true, ...bp.righeOre(req.user, m, n) });
});

router.get('/saldi', requireAuth, (req, res) => {
  const m = bp.modulo();
  if (!m) return res.json({ disponibile: false });
  res.json({ disponibile: true, ...bp.datiSaldi(req.user, m) });
});

module.exports = router;
