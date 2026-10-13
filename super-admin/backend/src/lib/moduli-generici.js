'use strict';
// I moduli «generici» della Libreria: mattoncini senza settore (anagrafiche, preventivi, ordini, fatture, scadenze, spese, entrate, timbrature, ticket…) da cui partire. Sono DATI
// (seeds/moduli-generici.json: nome, descrizione, icona, schema e, dove serve, la dichiarazione dei RUOLI del modulo), non codice: si importano nella Libreria con un tocco,
// senza mai sovrascrivere un modulo che c'è già (stesso slug e stessa origine). Le descrizioni servono anche all'analisi dei processi, che abbina i processi ai moduli leggendo nome
// e descrizione; la dichiarazione dei ruoli permette ai report, al bot e ai riepiloghi di lavorare sui moduli di un tenant nato dall'analisi, senza passare dal Builder.
const db = require('../db');
const SEED = require('../seeds/moduli-generici.json');
const ORIGINE = 'generici'; // source_tenant_slug dei moduli importati

const righe = () => db.prepare('SELECT slug, ruoli FROM registry_modules WHERE source_tenant_slug = ?').all(ORIGINE);

function stato() {
  const have = new Map(righe().map((r) => [r.slug, r.ruoli]));
  const mancanti = SEED.filter((m) => !have.has(m.slug));
  const daCompletare = SEED.filter((m) => have.has(m.slug) && m.ruoli && !have.get(m.slug)); // già importato prima che avesse i ruoli
  return { totale: SEED.length, presenti: SEED.length - mancanti.length, mancanti: mancanti.map((m) => m.name), da_completare: daCompletare.map((m) => m.name) };
}

// Inserisce i moduli che mancano e completa i ruoli di quelli importati prima che li avessero (mai sovrascrive una dichiarazione già presente). Ritorna { aggiunti, completati }.
function importa() {
  const have = new Map(righe().map((r) => [r.slug, r.ruoli]));
  const ins = db.prepare("INSERT INTO registry_modules (name, slug, description, icon, color, schema_json, version, source_tenant_slug, release_notes, group_name, support_module, ruoli) VALUES (?, ?, ?, ?, ?, ?, 1, ?, 'Modulo generico di partenza', ?, 0, ?)");
  const upd = db.prepare('UPDATE registry_modules SET ruoli = ? WHERE slug = ? AND source_tenant_slug = ? AND ruoli IS NULL');
  let aggiunti = 0, completati = 0;
  db.transaction(() => {
    for (const m of SEED) {
      const ruoli = m.ruoli ? JSON.stringify(m.ruoli) : null;
      if (!have.has(m.slug)) { ins.run(m.name, m.slug, m.description, m.icon, m.color, m.schema_json, ORIGINE, m.group_name, ruoli); aggiunti++; }
      else if (ruoli && !have.get(m.slug)) { upd.run(ruoli, m.slug, ORIGINE); completati++; }
    }
  })();
  return { aggiunti, completati };
}

module.exports = { stato, importa, ORIGINE, SEED };
