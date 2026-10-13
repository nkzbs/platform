require('../../../shared/require-strong-secrets').requireStrongSecrets([
  { name: 'JWT_SECRET', value: process.env.JWT_SECRET, badDefault: 'changeme' },
  { name: 'INTERNAL_API_SECRET', value: process.env.INTERNAL_API_SECRET, badDefault: 'changeme_internal' },
  // G18 — cifra le credenziali di destinazione backup off-site (crypto-secrets.js);
  // stesso principio degli altri due, un default noto in produzione vanificherebbe
  // la cifratura stessa.
  { name: 'ENCRYPTION_KEY', value: process.env.ENCRYPTION_KEY, badDefault: 'changeme_super_admin_encryption_key' },
]);

const express = require('express');
const cors = require('cors');
const db = require('./db');
const authRoutes = require('./routes/auth');
const tenantsRoutes = require('./routes/tenants');
const tenantImportRoutes = require('./routes/tenant-import');
const usersRoutes = require('./routes/users');
const registryRoutes = require('./routes/registry');
const superBuilderRoutes = require('./routes/super-builder');
const monitoringRoutes = require('./routes/monitoring');
const analyticsRoutes = require('./routes/analytics');
const guidaRoutes = require('./routes/guida');
const aiUsageRoutes = require('./routes/ai-usage');
const tenantAiRoutes = require('./routes/tenant-ai');
const { startBackupScheduler } = require('./backup-scheduler');
const { startWeeklyBackupMail } = require('./weekly-backup-mail');
const { startBackupVerifyScheduler } = require('./backup-verify');
const { startAnalyticsScheduler } = require('./analytics-scheduler');
const { startTenantStatusReconciler } = require('./tenant-status-reconciler');
const { startAuditRetentionScheduler } = require('./audit-retention-scheduler');
const { logError } = require('./error-log');
const { rateLimit } = require('./rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors(require('../../../shared/cors-origin').buildCorsOptions(process.env.CLOUDFLARE_ZONE_NAME)));
app.use(require('../../../shared/security-headers').applySecurityHeaders);
// le foto per il bot arrivano come base64 (fino a 3 MB): solo questo percorso ha un limite più alto, il resto resta quello di sempre
app.use('/api/tenant-ai/receipt', express.json({ limit: '6mb' }));
app.use(express.json());

// Stesso limite generico del gemello in core/backend/src/index.js — rete di
// sicurezza contro abuso grossolano, non pensato per interferire con l'uso
// normale (include anche le chiamate interne dei tenant via x-internal-secret,
// es. checkForUpdates ad ogni apertura dello Store — a 6 tenant reali oggi c'è
// ampio margine sotto la soglia).
app.use('/api', rateLimit({ windowMs: 60 * 1000, max: 600, message: 'Troppe richieste da questo indirizzo, rallenta', name: 'api-global' }));

app.use('/api/auth', authRoutes);
app.use('/api/tenants', tenantImportRoutes);
app.use('/api/tenants', tenantsRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/registry', registryRoutes);
app.use('/api/super-builder', superBuilderRoutes);
app.use('/api/monitoring', monitoringRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/guida', guidaRoutes);
app.use('/api/ai-usage', aiUsageRoutes);
app.use('/api/tenant-ai', tenantAiRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok', version: '0.1.1' }));

// G19 (PLATFORM-0.6-GAP-ANALYSIS.md) — pubblica di proposito, nessuna autenticazione: serve al
// workflow GitHub Actions di uptime-check (.github/workflows/uptime-check.yml) per sapere quali
// domini controllare senza dover gestire un altro secret/token solo per questo. Espone SOLO il
// dominio (una stringa già pubblicamente raggiungibile via HTTPS, non un segreto) dei tenant
// realmente attivi — niente nomi, id, partner o altro. is_sandbox esclude ai-sandbox e simili:
// non sono tenant reali, non serve monitorarne l'uptime.
// Sotto /api, non top-level come /health: infra/nginx/nginx.conf instrada SOLO /api verso
// super-admin-backend, ogni altro path (compreso un ipotetico /public/domains top-level,
// primo tentativo di questa stessa modifica) va al frontend statico e riceve sempre
// index.html — scoperto dal vivo interrogando il dominio reale dopo il primo deploy, non
// assunto. /health non ne risente perché non è mai raggiunto dall'esterno via nginx, solo
// dall'HEALTHCHECK Docker del container stesso.
app.get('/api/public/domains', (req, res) => {
  const rows = db.prepare(
    "SELECT domain FROM tenants WHERE status = 'active' AND domain IS NOT NULL AND domain != '' AND is_sandbox != 1"
  ).all();
  res.json(rows.map((r) => r.domain));
});

// Rete di sicurezza per eccezioni non gestite in una route — stesso principio e stessi
// limiti del gemello in core/backend/src/index.js (cattura throw sincroni e next(err)
// espliciti, non ogni rejection asincrona non gestita). DEVE stare per ultimo.
app.use((err, req, res, next) => {
  logError(req.originalUrl, req.method, err);
  console.error('Errore non gestito:', err.message);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Errore interno' });
});

{ const m = require('./secrets-at-rest').migrate(); if (m.totp || m.falliti) console.log('Segreti 2FA cifrati a riposo: ' + m.totp + (m.falliti ? ' (' + m.falliti + ' NON riusciti)' : '')); }

app.listen(PORT, () => {
  console.log('Super Admin backend running on port ' + PORT);
  startBackupScheduler();
  startWeeklyBackupMail();
  startBackupVerifyScheduler();
  startAnalyticsScheduler();
  startTenantStatusReconciler();
  startAuditRetentionScheduler();
});
