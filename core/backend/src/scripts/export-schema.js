'use strict';
// Esporta SOLO la struttura di questo tenant — moduli (schema, campi,
// relazioni, workflow) e widget dashboard — MAI dati/record reali, MAI
// utenti/connessioni/credenziali. Stessa identica query già in uso da
// GET /modules/internal/export (chiamata da Super Admin per clonare un
// tenant verticale), qui invocata offline: un'installazione davvero
// standalone (2026-09-28, "elimina il concetto di licenza/pairing") non
// deve rispondere a nessuna chiamata di rete per farsi copiare, né deve
// essere raggiungibile da fuori per farlo. Girata con `docker exec` contro
// l'istanza sorgente, produce un file JSON portabile.
//
// Uso: node src/scripts/export-schema.js > schema.json
const db = require('../db');

const modules = db.prepare(
  "SELECT name, slug, icon, color, active, installed, sort_order, schema_json, schema_json_draft, schema_version, published_at, support_module, group_name, group_order, registry_slug, registry_source_tenant_slug FROM modules WHERE slug != 'dashboard'"
).all();
const widgets = db.prepare('SELECT type, module_slug, field, aggregation, label, color, sort_order, config, roles FROM dashboard_widgets').all();

process.stdout.write(JSON.stringify({ modules, widgets }, null, 2) + '\n');
console.error('Esportati ' + modules.length + ' moduli, ' + widgets.length + ' widget.');
