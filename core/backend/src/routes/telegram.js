'use strict';
// Bot Telegram: collegamento del bot (admin), collegamento del proprio telefono (ogni utente), e il webhook che Telegram chiama.
//   POST   /api/telegram/webhook      chiamato da Telegram (senza login: lo protegge il segreto nell'header X-Telegram-Bot-Api-Secret-Token)
//   GET    /api/telegram/status       bot collegato? e i telefoni collegati (i propri; l'admin vede tutti)
//   PUT    /api/telegram/config       { bot_token } solo admin: valida il bot e registra il webhook
//   DELETE /api/telegram/config       solo admin: toglie il bot e scollega tutti
//   POST   /api/telegram/link-code    crea un codice monouso (10 minuti) per collegare il proprio telefono
//   DELETE /api/telegram/links/:id    scollega un telefono (il proprio; l'admin qualunque)
const express = require('express');
const { requireAuth, requireAdmin } = require('./auth');
const { logAudit } = require('../audit-log');
const tg = require('../telegram');

const router = express.Router();

router.post('/webhook', async (req, res) => {
  if (!tg.isConfigured()) return res.status(404).json({ error: 'Non attivo' });
  if (!tg.secretMatches(req.headers['x-telegram-bot-api-secret-token'])) return res.status(403).json({ error: 'Non autorizzato' });
  await tg.handleUpdate(req.body || {});
  res.json({ ok: true }); // sempre 200 a Telegram: un errore interno non deve diventare una pioggia di tentativi
});

// Indirizzo pubblico di questo tenant (da dove Telegram richiama): da FRONTEND_URL, altrimenti da come ci sta raggiungendo l'admin.
function appUrl(req) {
  if (process.env.FRONTEND_URL) return process.env.FRONTEND_URL;
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return proto + '://' + host;
}

router.get('/status', requireAuth, (req, res) => {
  const st = tg.status();
  const all = tg.listLinks();
  const mine = all.filter((l) => l.user_id === req.user.id);
  res.json({ ...st, mine, links: req.user.role === 'admin' ? all : undefined });
});

router.put('/config', requireAuth, requireAdmin, async (req, res) => {
  try {
    const out = await tg.connect(req.body && req.body.bot_token, appUrl(req));
    logAudit(req.user.username, 'telegram.connect', out.bot_username, null);
    res.json({ ok: true, bot_username: out.bot_username });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.delete('/config', requireAuth, requireAdmin, async (req, res) => {
  await tg.disconnect();
  logAudit(req.user.username, 'telegram.disconnect', null, null);
  res.json({ ok: true });
});

router.post('/link-code', requireAuth, (req, res) => {
  if (!tg.isConfigured()) return res.status(409).json({ error: 'Il bot Telegram non è ancora collegato (lo fa l\'admin).' });
  res.json(tg.createLinkCode(req.user.id));
});

router.delete('/links/:id', requireAuth, (req, res) => {
  const l = tg.listLinks().find((x) => x.id === parseInt(req.params.id, 10));
  if (!l) return res.status(404).json({ error: 'Non trovato' });
  if (req.user.role !== 'admin' && l.user_id !== req.user.id) return res.status(403).json({ error: 'Non puoi scollegare il telefono di un altro' });
  tg.revokeLink(l.id);
  logAudit(req.user.username, 'telegram.unlink', String(l.chat_id), null);
  res.json({ ok: true });
});

module.exports = router;
