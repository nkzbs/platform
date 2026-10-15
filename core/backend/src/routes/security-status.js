// Versione ridotta, per-tenant, del pannello "Sicurezza della piattaforma" di
// Super Admin (2026-10-15, stessa richiesta dell'utente — risposto "sì"
// anche per i singoli tenant). Legge SOLO i dati di QUESTO tenant (i suoi
// utenti, il suo audit_log) — nessun dato a livello di piattaforma (niente
// Cloudflare/TLS, quello è infrastruttura condivisa e si vede solo da Super
// Admin). requireAdmin perché qui, a differenza di Super Admin, i ruoli
// esistono davvero (admin/agente/user).
const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('./auth');

const router = express.Router();

const SUSPICIOUS_ACTIONS = ['auth.login_failed', 'auth.2fa_verify_failed', 'auth.webauthn_login_failed'];

router.get('/', requireAuth, requireAdmin, (req, res) => {
  const users = db.prepare('SELECT id, totp_enabled FROM users WHERE active = 1').all();
  const withWebauthn = db.prepare('SELECT DISTINCT user_id FROM webauthn_credentials').all().map((r) => r.user_id);

  const placeholders = SUSPICIOUS_ACTIONS.map(() => '?').join(',');
  const recentEvents = db.prepare(
    `SELECT actor, action, target, created_at FROM audit_log WHERE action IN (${placeholders}) ORDER BY created_at DESC LIMIT 30`
  ).all(...SUSPICIOUS_ACTIONS);

  res.json({
    users: {
      total: users.length,
      with_2fa: users.filter((u) => u.totp_enabled).length,
      with_passkey: users.filter((u) => withWebauthn.includes(u.id)).length,
    },
    rate_limits: [
      { name: 'Accesso (password)', window: '5 min', max: 10, fail_mode: 'closed' },
      { name: 'Passkey', window: '5 min', max: 10, fail_mode: 'closed' },
      { name: 'API generale', window: '1 min', max: 600, fail_mode: 'open' },
    ],
    recent_suspicious_events: recentEvents,
  });
});

module.exports = router;
