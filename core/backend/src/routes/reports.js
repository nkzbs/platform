'use strict';
// Report su WhatsApp: impostazioni, anteprima, invio manuale, e pulizia dei vecchi report dentro i moduli. Solo admin; la funzione deve essere attiva.
//   GET  /api/reports/settings                  impostazioni dei tre report + ultimo invio
//   PUT  /api/reports/settings                  { kind, ...patch }
//   GET  /api/reports/preview/:kind             il messaggio che partirebbe adesso, senza inviare nulla
//   POST /api/reports/send-now/:kind            invia adesso (anche se spento): richiesta esplicita
//   GET  /api/reports/legacy                    le automazioni vecchie (report periodico, avviso «scadenza» giornaliero) ancora nei moduli
//   POST /api/reports/legacy/remove             le toglie dagli schemi pubblicati (con cronologia, come una pubblicazione dal Builder)
const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('./auth');
const { requireFeature } = require('../features');
const { logAudit } = require('../audit-log');
const reports = require('../reports');

const router = express.Router();
router.use(requireAuth, requireFeature('riepilogo_mattino')); // prima l'accesso (401), poi la funzione (403)
const guard = [requireAdmin];

router.get('/settings', ...guard, (req, res) => res.json({ settings: reports.settings(), last_sent: reports.lastSent() }));

router.put('/settings', ...guard, (req, res) => {
  const { kind, ...patch } = req.body || {};
  const out = reports.saveSettings(kind, patch);
  if (out.error) return res.status(400).json({ error: out.error });
  logAudit(req.user.username, 'report.settings', kind, patch);
  res.json({ settings: out.settings, last_sent: reports.lastSent() });
});

router.get('/preview/:kind', ...guard, (req, res) => {
  if (!reports.KINDS.includes(req.params.kind)) return res.status(404).json({ error: 'Report sconosciuto' });
  const r = reports.build(req.params.kind, new Date());
  res.json(r ? { text: r.text, counts: r.counts } : { text: null, counts: null });
});

router.post('/send-now/:kind', ...guard, async (req, res) => {
  if (!reports.KINDS.includes(req.params.kind)) return res.status(404).json({ error: 'Report sconosciuto' });
  res.json(await reports.sendReport(req.params.kind, { actor: req.user.username }));
});

// ── vecchi report nei moduli ──────────────────────────────────────────────────────────────────────────────────────────────
// Una automazione è «vecchia» se manda il report periodico, o se è un avviso WhatsApp con tag «scadenza» pianificato (il «scadenza oggi» delle 08:00).
const azioni = (b) => (Array.isArray(b.azioni) ? b.azioni : []);
const isLegacy = (b) => b.block_type === 'automation' && azioni(b).some((a) => a.azione === 'invia_report_periodico'
  || (a.azione === 'invia_notifica' && a.config && a.config.trigger_tag === reports.TAG && b.trigger && b.trigger.evento === 'schedulato'));

function scan() {
  const out = [];
  for (const m of db.prepare('SELECT slug, name, schema_json FROM modules WHERE installed = 1').all()) {
    let s; try { s = JSON.parse(m.schema_json); } catch (e) { continue; }
    for (const b of (s.steps || [])) if (isLegacy(b)) out.push({ modulo: m.slug, nome_modulo: m.name, id: b.id, nome: b.label || b.id });
  }
  return out;
}

router.get('/legacy', ...guard, (req, res) => res.json({ automazioni: scan() }));

router.post('/legacy/remove', ...guard, (req, res) => {
  const trovate = scan();
  if (!trovate.length) return res.json({ ok: true, rimosse: 0 });
  const perModulo = {};
  trovate.forEach((t) => { (perModulo[t.modulo] = perModulo[t.modulo] || new Set()).add(t.id); });
  const toglie = (raw) => { const s = JSON.parse(raw); s.steps = (s.steps || []).filter((b) => !isLegacy(b)); return JSON.stringify(s); };
  db.transaction(() => {
    for (const slug of Object.keys(perModulo)) {
      const m = db.prepare('SELECT * FROM modules WHERE slug = ?').get(slug);
      db.prepare('INSERT INTO modules_schema_history (module_id, schema_json, version, published_by) VALUES (?, ?, ?, ?)').run(m.id, m.schema_json, m.schema_version, req.user.id);
      db.prepare('UPDATE modules SET schema_json = ?, schema_json_draft = ?, schema_version = schema_version + 1, published_at = CURRENT_TIMESTAMP WHERE slug = ?')
        .run(toglie(m.schema_json), m.schema_json_draft ? toglie(m.schema_json_draft) : null, slug);
    }
  })();
  logAudit(req.user.username, 'report.legacy_removed', null, { automazioni: trovate.map((t) => t.modulo + ':' + t.nome) });
  res.json({ ok: true, rimosse: trovate.length, automazioni: trovate });
});

module.exports = router;
