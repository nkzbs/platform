'use strict';
// I moduli «generici» della Libreria: mattoncini senza settore (anagrafiche, preventivi, ordini, fatture, scadenze, presenze, ticket…) da cui partire. Sono DATI
// (seeds/moduli-generici.json: nome, descrizione, icona, schema), non codice: si importano nella Libreria con un tocco, senza mai sovrascrivere un modulo che c'è già
// (stesso slug e stessa origine). Le descrizioni servono anche all'analisi dei processi, che abbina i processi ai moduli leggendo nome e descrizione.
const db = require('../db');
const SEED = require('../seeds/moduli-generici.json');
const ORIGINE = 'generici'; // source_tenant_slug dei moduli importati

const presenti = () => new Set(db.prepare('SELECT slug FROM registry_modules WHERE source_tenant_slug = ?').all(ORIGINE).map((r) => r.slug));

function stato() {
  const have = presenti();
  const mancanti = SEED.filter((m) => !have.has(m.slug));
  return { totale: SEED.length, presenti: SEED.length - mancanti.length, mancanti: mancanti.map((m) => m.name) };
}

// Inserisce nella Libreria i moduli che mancano. Ritorna quanti ne ha aggiunti.
function importa() {
  const have = presenti();
  const ins = db.prepare("INSERT INTO registry_modules (name, slug, description, icon, color, schema_json, version, source_tenant_slug, release_notes, group_name, support_module) VALUES (?, ?, ?, ?, ?, ?, 1, ?, 'Modulo generico di partenza', ?, 0)");
  let n = 0;
  db.transaction(() => { for (const m of SEED) if (!have.has(m.slug)) { ins.run(m.name, m.slug, m.description, m.icon, m.color, m.schema_json, ORIGINE, m.group_name); n++; } })();
  return n;
}

module.exports = { stato, importa, ORIGINE, SEED };
