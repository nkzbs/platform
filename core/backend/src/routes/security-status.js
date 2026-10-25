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
const integrityCheck = require('../integrity-check');
const { logAudit } = require('../audit-log');

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
    integrity: integrityStatus(),
  });
});

// Controllo di integrità (integrity-check.js): confronta QUELLO SALVATO ora, non
// rifà il controllo dell'avvio (che scrive avvisi/audit_log solo una volta,
// all'avvio del processo) — qui solo lettura, per mostrarlo nel pannello.
function integrityStatus() {
  const base = integrityCheck.baselinePath();
  const fs = require('fs');
  let precedente = null;
  try { precedente = JSON.parse(fs.readFileSync(base, 'utf8')); } catch (e) { return { disponibile: false }; }
  const attuale = integrityCheck.fingerprint();
  const persi = precedente.modules.filter((m) => !attuale.modules.includes(m));
  const caloDrastico = precedente.totale_record > 20 && attuale.totale_record < precedente.totale_record * 0.5;
  return { disponibile: true, ok: persi.length === 0 && !caloDrastico, persi, calo_drastico: caloDrastico, riferimento_del: precedente.controllato_il };
}

// "Sì, questo è lo stato giusto": aggiorna il riferimento allo stato attuale — dopo un
// ripristino voluto, o per confermare che un avviso era un falso allarme. Mai automatico.
router.post('/accetta-integrita', requireAuth, requireAdmin, (req, res) => {
  integrityCheck.accettaStatoAttuale();
  logAudit(req.user.username, 'integrity.accept', null, integrityCheck.fingerprint());
  res.json({ ok: true });
});

module.exports = router;
