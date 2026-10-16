// Pannello "Sicurezza della piattaforma" in Impostazioni (2026-10-15, richiesto
// dall'utente: "lato sicurezza la struttura regge? ... un pannello nelle
// impostazioni di super admin dove controllo lo stato della piattaforma",
// scelto via domanda esplicita: stato attuale + log di eventi sospetti).
//
// Legge SOLO dati di Super Admin su se stesso (i suoi utenti, il suo
// audit_log) — nessuna query verso un tenant: stesso principio di
// separazione già applicato a /audit-log (13 ottobre 2026, vedi commento in
// core/backend/src/routes/audit.js) per cui Super Admin non entra nei dati
// di un tenant. Le soglie dei rate limiter sotto sono valori statici (le
// stesse costanti già impostate in auth.js/webauthn.js/index.js), non una
// nuova lettura: mostrarle qui serve solo a renderle visibili senza aprire
// il codice.
const express = require('express');
const db = require('../db');
const { requireAuth } = require('./auth');
const cloudflare = require('../cloudflare');

const router = express.Router();

const SUSPICIOUS_ACTIONS = ['auth.login_failed', 'auth.2fa_verify_failed', 'auth.login_blocked_disabled', 'auth.webauthn_login_failed'];

router.get('/', requireAuth, async (req, res) => {
  const users = db.prepare('SELECT id, totp_enabled FROM users WHERE active = 1').all();
  const withWebauthn = db.prepare('SELECT DISTINCT user_id FROM webauthn_credentials').all().map((r) => r.user_id);

  const placeholders = SUSPICIOUS_ACTIONS.map(() => '?').join(',');
  const recentEvents = db.prepare(
    `SELECT actor, action, target, created_at FROM audit_log WHERE action IN (${placeholders}) ORDER BY created_at DESC LIMIT 30`
  ).all(...SUSPICIOUS_ACTIONS);

  let cloudflareTls = null;
  if (cloudflare.isConfigured()) {
    try { cloudflareTls = await cloudflare.sslMode(); } catch (e) { cloudflareTls = null; }
  }

  res.json({
    secrets: { node_env: process.env.NODE_ENV || 'development' },
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
    cloudflare: {
      configured: cloudflare.isConfigured(),
      ssl_mode: cloudflareTls,
    },
    known_gaps: [
      'Password admin viste in chiaro nella cronologia Git prima della pulizia del 21 agosto 2026 non sono state ruotate (restano valide).',
      'Nessuna verifica di sicurezza esterna è mai stata condotta su questa piattaforma.',
    ],
    recent_suspicious_events: recentEvents,
  });
});

module.exports = router;
