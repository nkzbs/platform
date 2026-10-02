'use strict';
// Importa in QUESTA istanza (fresca, appena creata da bootstrap-instance.sh)
// lo schema esportato da export-schema.js — sostituisce i moduli placeholder
// generici seminati al primo boot (db.js, "Moduli di default creati"), mai i
// dati reali (non arrivano in questo file). Stessa identica validazione/
// logica di scrittura già in uso in routes/modules.js POST
// /internal/install-batch (mai bypassare parseSchemaNormalized, mai scrivere
// uno schema non valido) — qui invocata offline via `docker exec` invece che
// via HTTP, perché un'istanza standalone non deve accettare chiamate in
// entrata per popolarsi.
//
// Uso: node src/scripts/import-schema.js <file.json>
const fs = require('fs');
const db = require('../db');
const { parseSchemaNormalized } = require('../schema-v3');

const file = process.argv[2];
if (!file) {
  console.error('Uso: node import-schema.js <file.json>');
  process.exit(1);
}

const { modules, widgets } = JSON.parse(fs.readFileSync(file, 'utf8'));
if (!Array.isArray(modules) || modules.length === 0) {
  console.error('Nessun modulo nel file — niente da importare.');
  process.exit(1);
}

for (const m of modules) {
  if (!m || !m.slug || !m.name) {
    console.error('Ogni modulo richiede almeno slug e name.');
    process.exit(1);
  }
  try {
    parseSchemaNormalized(m.schema_json);
  } catch (e) {
    console.error('Schema non valido per "' + m.slug + '": ' + e.message);
    process.exit(1);
  }
}

// Stessa regola di install-batch: sostituisce qualunque modulo placeholder
// (mai installato) O il cui slug ricompare nel bundle importato — mai
// 'dashboard', sempre presente.
const incomingSlugs = modules.map((m) => m.slug);
const placeholders = incomingSlugs.map(() => '?').join(',');
db.prepare("DELETE FROM modules WHERE slug != 'dashboard' AND (installed = 0 OR slug IN (" + placeholders + "))").run(...incomingSlugs);
db.prepare('DELETE FROM dashboard_widgets WHERE module_slug IN (' + placeholders + ')').run(...incomingSlugs);

const insertModule = db.prepare(`
  INSERT INTO modules (name, slug, icon, color, active, installed, sort_order, schema_json, schema_json_draft, schema_version, published_at, support_module, group_name, group_order, registry_slug, registry_source_tenant_slug)
  VALUES (@name, @slug, @icon, @color, @active, @installed, @sort_order, @schema_json, @schema_json_draft, @schema_version, @published_at, @support_module, @group_name, @group_order, @registry_slug, @registry_source_tenant_slug)
`);
const insertWidget = db.prepare(`
  INSERT INTO dashboard_widgets (type, module_slug, field, aggregation, label, color, sort_order, config, roles)
  VALUES (@type, @module_slug, @field, @aggregation, @label, @color, @sort_order, @config, @roles)
`);

const tx = db.transaction(() => {
  modules.forEach((m, i) => insertModule.run({
    name: m.name, slug: m.slug, icon: m.icon || 'box', color: m.color || '#2563EB',
    active: m.active != null ? (m.active ? 1 : 0) : 1, installed: m.installed != null ? (m.installed ? 1 : 0) : 1,
    sort_order: m.sort_order != null ? m.sort_order : 90 + i, schema_json: m.schema_json,
    schema_json_draft: m.schema_json_draft || null, schema_version: m.schema_version || 1,
    published_at: m.published_at || null, support_module: m.support_module ? 1 : 0,
    group_name: m.group_name || null, group_order: m.group_order || 0,
    registry_slug: m.registry_slug || null, registry_source_tenant_slug: m.registry_source_tenant_slug || null,
  }));
  (widgets || []).forEach((w) => insertWidget.run({
    type: w.type, module_slug: w.module_slug, field: w.field || null, aggregation: w.aggregation || null,
    label: w.label || null, color: w.color || null, sort_order: w.sort_order || 0,
    config: w.config || null, roles: w.roles || null,
  }));
});
tx();

console.log('Importati ' + modules.length + ' moduli, ' + (widgets || []).length + ' widget.');
