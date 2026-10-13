'use strict';
// I verticali proposti ai tenant: punti di partenza (un nome, un'icona, un gruppo di moduli della Libreria che funzionano insieme), non codice.
// Sono dati in seeds/verticali.json; qui si risolvono sui moduli che la Libreria ha davvero (ultima versione di ogni slug): un modulo che non c'è
// si salta, un verticale con meno di due moduli non si propone. Il tenant li installa con l'installazione multipla, poi collega e modifica.
const db = require('../db');
const SEED = require('../seeds/verticali.json');

function elenco() {
  const ultimo = db.prepare('SELECT id, name, slug, description FROM registry_modules rm WHERE version = (SELECT MAX(version) FROM registry_modules x WHERE x.slug = rm.slug AND x.source_tenant_slug IS rm.source_tenant_slug) ORDER BY (source_tenant_slug = \'generici\') DESC, id');
  const perSlug = new Map();
  for (const m of ultimo.all()) if (!perSlug.has(m.slug)) perSlug.set(m.slug, m);
  return SEED.map((v, i) => ({
    id: i + 1, name: v.nome, icon: v.icona, description: v.descrizione,
    moduli: v.moduli.map((s) => perSlug.get(s)).filter(Boolean).map((m) => ({ id: m.id, slug: m.slug, name: m.name, description: m.description || '' })),
  })).filter((v) => v.moduli.length >= 2);
}

module.exports = { elenco, SEED };
