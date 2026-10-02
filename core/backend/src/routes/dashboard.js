const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('./auth');

const router = express.Router();

// ?page=dashboard|report — stessa tabella, due collezioni separate di widget (vedi
// commento su ensureColumn('dashboard_widgets','page') in db.js). Default 'dashboard'
// per compatibilità con ogni chiamata esistente che non passa il parametro.
router.get('/widgets', requireAuth, (req, res) => {
  const page = req.query.page || 'dashboard';
  const widgets = db.prepare('SELECT * FROM dashboard_widgets WHERE page = ? ORDER BY sort_order, id').all(page)
    .map((w) => {
      let config = {};
      try { config = JSON.parse(w.config || '{}'); } catch (e) { config = {}; }
      let roles = [];
      try { roles = JSON.parse(w.roles || '[]'); } catch (e) { roles = []; }
      let userIds = [];
      try { userIds = JSON.parse(w.user_ids || '[]'); } catch (e) { userIds = []; }
      return { ...w, config, roles, user_ids: userIds };
    })
    // Ruoli e utenti individuali si sommano (OR), non uno restringe l'altro —
    // due persone con lo stesso ruolo (es. Finance: Nima e Federica, entrambi
    // "Utente") vanno distinguibili per singolo utente, non solo per ruolo.
    .filter((w) => req.user.role === 'admin' || (w.roles.length === 0 && w.user_ids.length === 0) || w.roles.includes(req.user.role) || w.user_ids.includes(req.user.id));
  res.json(widgets);
});

router.post('/widgets', requireAuth, requireAdmin, (req, res) => {
  const { type, module_slug, field, aggregation, label, color, config, roles, user_ids: userIds, page } = req.body;
  const pageVal = page || 'dashboard';
  const max = db.prepare('SELECT MAX(sort_order) as m FROM dashboard_widgets WHERE page = ?').get(pageVal);
  const sort_order = (max && max.m != null ? max.m : -1) + 1;
  const result = db.prepare(
    'INSERT INTO dashboard_widgets (type, module_slug, field, aggregation, label, color, sort_order, config, roles, user_ids, page) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(type || 'kpi', module_slug || null, field || null, aggregation || 'sum', label || module_slug || 'Widget', color || '#2563EB', sort_order, JSON.stringify(config || {}), JSON.stringify(roles || []), JSON.stringify(userIds || []), pageVal);
  const created = db.prepare('SELECT * FROM dashboard_widgets WHERE id = ?').get(result.lastInsertRowid);
  let parsedConfig = {};
  try { parsedConfig = JSON.parse(created.config || '{}'); } catch (e) { parsedConfig = {}; }
  let parsedRoles = [];
  try { parsedRoles = JSON.parse(created.roles || '[]'); } catch (e) { parsedRoles = []; }
  let parsedUserIds = [];
  try { parsedUserIds = JSON.parse(created.user_ids || '[]'); } catch (e) { parsedUserIds = []; }
  res.json({ ...created, config: parsedConfig, roles: parsedRoles, user_ids: parsedUserIds });
});

// Modifica un widget esistente — prima l'unico modo per cambiare qualcosa (es.
// restringerlo a certi ruoli) era eliminarlo e ricrearlo, perdendo la posizione.
router.patch('/widgets/:id', requireAuth, requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM dashboard_widgets WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Widget non trovato' });
  const { type, module_slug, field, aggregation, label, color, config, roles, user_ids: userIds } = req.body;
  db.prepare('UPDATE dashboard_widgets SET type = ?, module_slug = ?, field = ?, aggregation = ?, label = ?, color = ?, config = ?, roles = ?, user_ids = ? WHERE id = ?').run(
    type ?? existing.type,
    module_slug !== undefined ? module_slug : existing.module_slug,
    field !== undefined ? field : existing.field,
    aggregation ?? existing.aggregation,
    label ?? existing.label,
    color ?? existing.color,
    config !== undefined ? JSON.stringify(config) : existing.config,
    roles !== undefined ? JSON.stringify(roles) : existing.roles,
    userIds !== undefined ? JSON.stringify(userIds) : existing.user_ids,
    req.params.id
  );
  const updated = db.prepare('SELECT * FROM dashboard_widgets WHERE id = ?').get(req.params.id);
  let parsedConfig = {};
  try { parsedConfig = JSON.parse(updated.config || '{}'); } catch (e) { parsedConfig = {}; }
  let parsedRoles = [];
  try { parsedRoles = JSON.parse(updated.roles || '[]'); } catch (e) { parsedRoles = []; }
  let parsedUserIds = [];
  try { parsedUserIds = JSON.parse(updated.user_ids || '[]'); } catch (e) { parsedUserIds = []; }
  res.json({ ...updated, config: parsedConfig, roles: parsedRoles, user_ids: parsedUserIds });
});

router.delete('/widgets/:id', requireAuth, requireAdmin, (req, res) => {
  db.prepare('DELETE FROM dashboard_widgets WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Riordino — riceve l'array di id nell'ordine desiderato, riscrive sort_order per
// tutti in un colpo solo (stessa idea dei "batch related data" già usata altrove:
// niente N chiamate separate per N widget spostati). Gli id sono globalmente unici
// (autoincrement su tutta la tabella) quindi non serve sapere la page qui.
router.put('/widgets/reorder', requireAuth, requireAdmin, (req, res) => {
  const { order } = req.body;
  if (!Array.isArray(order)) return res.status(400).json({ error: 'order deve essere un array di id' });
  const update = db.prepare('UPDATE dashboard_widgets SET sort_order = ? WHERE id = ?');
  const tx = db.transaction((ids) => { ids.forEach((id, idx) => update.run(idx, id)); });
  tx(order);
  res.json({ ok: true });
});

module.exports = router;
