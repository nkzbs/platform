'use strict';
// La mail di un invito, spedita da Super Admin per conto di un tenant (che non ha la posta). Il tenant prova chi è con un token firmato col SUO segreto (il segreto interno condiviso non basta).
// Tre difese contro l'uso come «spedisci mail a piacere»: il testo è fisso, il link deve puntare al dominio di QUEL tenant e avere la forma /invito/<token>, e ci sono al massimo 30 mail al giorno per tenant.
//   POST /api/tenant-invite/:slug/mail   { to, nome, link, ore } → { sent, reason? }
const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../db');
const notifier = require('../notifier');

const router = express.Router();
const MAX_AL_GIORNO = 30;
const contatori = new Map(); // slug|giorno → quante mail oggi

function requireTenantToken(req, res, next) {
  const tenant = db.prepare("SELECT * FROM tenants WHERE slug = ? AND status != 'deleted'").get(req.params.slug);
  const raw = (req.headers.authorization || '').replace(/^Bearer /, '');
  if (!tenant || !tenant.jwt_secret || !raw) return res.status(401).json({ error: 'Non autorizzato' });
  try { const p = jwt.verify(raw, tenant.jwt_secret, { algorithms: ['HS256'] }); if (p.purpose !== 'invite-mail' || p.slug !== tenant.slug) throw new Error('scopo'); } catch (e) { return res.status(401).json({ error: 'Non autorizzato' }); }
  req.tenant = tenant;
  next();
}
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

// Il link deve essere https://<dominio del tenant>/invito/<token> (o http solo se il tenant non ha un dominio e si prova in locale: non ammesso qui).
function linkValido(tenant, link) {
  let u; try { u = new URL(String(link)); } catch (e) { return false; }
  if (!tenant.domain || u.protocol !== 'https:' || u.hostname.toLowerCase() !== String(tenant.domain).toLowerCase() || u.username || u.password) return false;
  return /^\/invito\/[A-Za-z0-9_-]{20,100}$/.test(u.pathname) && !u.search && !u.hash;
}

router.post('/:slug/mail', requireTenantToken, async (req, res) => {
  const b = req.body || {};
  if (!EMAIL_RE.test(String(b.to || ''))) return res.status(400).json({ error: 'Indirizzo email non valido.' });
  if (!linkValido(req.tenant, b.link)) return res.status(400).json({ error: 'Il link dell\'invito non è valido per questo progetto (serve un dominio configurato).' });
  const chiave = req.tenant.slug + '|' + new Date().toISOString().slice(0, 10);
  if ((contatori.get(chiave) || 0) >= MAX_AL_GIORNO) return res.status(429).json({ error: 'Troppe mail oggi per questo progetto: usa il link.' });
  contatori.set(chiave, (contatori.get(chiave) || 0) + 1);
  const ore = Math.max(1, Math.min(168, Number(b.ore) || 72));
  const r = await notifier.sendInviteMail({ to: String(b.to), nome: String(b.nome || '').slice(0, 80), tenantName: req.tenant.name, link: String(b.link), ore });
  res.json(r);
});

module.exports = router;
module.exports.linkValido = linkValido;
