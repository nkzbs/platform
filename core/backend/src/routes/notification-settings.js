'use strict';
const express = require('express');
const { requireAuth, requireAdmin } = require('./auth');
const ns = require('../notification-settings');
const { logAudit } = require('../audit-log');

const { requireFeature } = require('../features');

const router = express.Router();
router.use('/whatsapp-recipients', requireAuth, requireFeature('whatsapp'));
router.use('/gmail-rules', requireAuth, requireFeature('gmail'));
const guard = [requireAuth, requireAdmin];
const respond = (res, out, key) => {
  if (out.notFound) return res.status(404).json({ error: 'Non trovato' });
  if (out.error) return res.status(400).json({ error: out.error });
  return res.json(out[key]);
};
const idOf = (req) => parseInt(req.params.id, 10);

// Destinatari WhatsApp
router.get('/whatsapp-recipients', ...guard, (req, res) => res.json(ns.listRecipients()));
router.post('/whatsapp-recipients', ...guard, (req, res) => {
  const out = ns.createRecipient(req.body || {});
  if (out.recipient) logAudit(req.user.username, 'whatsapp.recipient.create', String(out.recipient.id), { nome: out.recipient.nome });
  respond(res, out, 'recipient');
});
router.put('/whatsapp-recipients/:id', ...guard, (req, res) => {
  const out = ns.updateRecipient(idOf(req), req.body || {});
  if (out.recipient) logAudit(req.user.username, 'whatsapp.recipient.update', String(out.recipient.id), { nome: out.recipient.nome });
  respond(res, out, 'recipient');
});
router.delete('/whatsapp-recipients/:id', ...guard, (req, res) => {
  const ok = ns.deleteRecipient(idOf(req));
  if (ok) logAudit(req.user.username, 'whatsapp.recipient.delete', String(idOf(req)), null);
  res.status(ok ? 200 : 404).json({ ok });
});

// Regole Gmail
router.get('/gmail-rules', ...guard, (req, res) => res.json(ns.listRules()));
router.post('/gmail-rules', ...guard, (req, res) => {
  const out = ns.createRule(req.body || {});
  if (out.rule) logAudit(req.user.username, 'gmail.rule.create', String(out.rule.id), { mittente: out.rule.mittente });
  respond(res, out, 'rule');
});
router.put('/gmail-rules/:id', ...guard, (req, res) => {
  const out = ns.updateRule(idOf(req), req.body || {});
  if (out.rule) logAudit(req.user.username, 'gmail.rule.update', String(out.rule.id), { mittente: out.rule.mittente });
  respond(res, out, 'rule');
});
router.delete('/gmail-rules/:id', ...guard, (req, res) => {
  const ok = ns.deleteRule(idOf(req));
  if (ok) logAudit(req.user.username, 'gmail.rule.delete', String(idOf(req)), null);
  res.status(ok ? 200 : 404).json({ ok });
});

module.exports = router;
