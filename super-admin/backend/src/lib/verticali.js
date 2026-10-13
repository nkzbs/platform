'use strict';
// I verticali proposti ai tenant: punti di partenza (un nome, un'icona, un gruppo di moduli della Libreria che funzionano insieme), non codice.
// Sono dati in seeds/verticali.json; qui si risolvono sui moduli che la Libreria ha davvero (ultima versione di ogni slug): un modulo che non c'è
// si salta, un verticale con meno di due moduli non si propone. Il tenant li installa con l'installazione multipla, poi collega e modifica.
const db = require('../db');
const SEED = require('../seeds/verticali.json');
const { scheda } = require('./guida');

function elenco() {
  const ultimo = db.prepare('SELECT id, name, slug, description, group_name, schema_json FROM registry_modules rm WHERE version = (SELECT MAX(version) FROM registry_modules x WHERE x.slug = rm.slug AND x.source_tenant_slug IS rm.source_tenant_slug) ORDER BY (source_tenant_slug = \'generici\') DESC, id');
  const perSlug = new Map();
  for (const m of ultimo.all()) if (!perSlug.has(m.slug)) perSlug.set(m.slug, m);
  const nomi = new Map([...perSlug.values()].map((m) => [m.slug, m]));
  return SEED.map((v, i) => {
    const righe = v.moduli.map((s) => perSlug.get(s)).filter(Boolean);
    const schede = righe.map((m) => scheda(m, nomi));
    return {
      id: i + 1, name: v.nome, icon: v.icona, description: v.descrizione,
      moduli: righe.map((m) => ({ id: m.id, slug: m.slug, name: m.name, description: m.description || '' })),
      guida: guida(righe, schede),
    };
  }).filter((v) => v.moduli.length >= 2);
}

// Come si usa un verticale, dai suoi moduli: da dove cominciare (prima ciò a cui gli altri si collegano), cosa fa e cosa si compila in ognuno.
// Nessun testo da settore: ordine e collegamenti vengono dalle relazioni degli schemi, i nomi e le descrizioni dai moduli.
function guida(righe, schede) {
  const slugs = new Set(righe.map((m) => m.slug));
  const dipende = new Map(righe.map((m, i) => [m.slug, schede[i].collegamentiSlug.filter((t) => slugs.has(t) && t !== m.slug)]));
  const fatti = new Set(), ordine = [];
  for (let giro = 0; giro < righe.length && ordine.length < righe.length; giro++) {
    for (const m of righe) if (!fatti.has(m.slug) && dipende.get(m.slug).every((t) => fatti.has(t))) { fatti.add(m.slug); ordine.push(m.slug); }
  }
  for (const m of righe) if (!fatti.has(m.slug)) ordine.push(m.slug); // collegamenti circolari: in coda, nell'ordine di partenza
  const per = new Map(righe.map((m, i) => [m.slug, { m, s: schede[i] }]));
  return {
    ordine: ordine.map((slug) => per.get(slug).m.name),
    moduli: ordine.map((slug) => { const { s } = per.get(slug); return { nome: s.nome, descrizione: s.descrizione, campi: s.campi, stati: s.stati, collegamenti: s.collegamenti }; }),
  };
}

module.exports = { elenco, SEED };
