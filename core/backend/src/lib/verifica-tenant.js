'use strict';
// «Quanto è operativo questo tenant?»: legge gli schemi dei moduli installati e controlla che tutto ciò che dichiarano stia in piedi da solo — nessuna scrittura, nessun record creato.
// I controlli veri sono in shared/verifica-moduli.js (puri, usati anche da Super Admin sulle bozze generate); qui si leggono i moduli dal database e si aggiungono i controlli che
// richiedono il database (le formule). Ogni controllo è una riga con esito; il punteggio è la quota di controlli superati. Ciò che solo una persona può mettere (chiavi dei servizi)
// si elenca a parte come «da completare a mano» e non toglie punti. Nessun nome di settore o di modulo: vale per qualunque tenant.
const db = require('../db');
const { controllaModuli } = require('../verifica-moduli');

function verifica() {
  const mods = {};
  for (const m of db.prepare('SELECT slug, name, schema_json FROM modules WHERE installed = 1').all()) {
    let s; try { s = JSON.parse(m.schema_json || '{}'); } catch (e) { s = {}; }
    mods[m.slug] = { slug: m.slug, nome: m.name, schema_json: m.schema_json, steps: Array.isArray(s.steps) ? s.steps : [] };
  }
  const ruoli = new Set(['admin', ...db.prepare('SELECT name FROM roles').all().map((r) => r.name)]);
  const connessi = new Set(db.prepare('SELECT integration_id FROM connections WHERE connected = 1').all().map((r) => r.integration_id));
  const { righe, manuali } = controllaModuli(mods, { ruoli, connessi, validaFormula: (expr, slug) => require('../formula').validateFormula(expr, db, { currentModule: slug }) });
  const totale = righe.length; const ok = righe.filter((r) => r.ok).length;
  const categorie = {};
  for (const r of righe) { const c = categorie[r.categoria] || (categorie[r.categoria] = { controlli: 0, superati: 0 }); c.controlli++; if (r.ok) c.superati++; }
  return {
    moduli: Object.keys(mods).length,
    controlli: totale, superati: ok, punteggio: totale ? Math.round((ok / totale) * 100) : 100,
    categorie, problemi: righe.filter((r) => !r.ok).map(({ categoria, modulo, blocco, messaggio }) => ({ categoria, modulo, blocco, messaggio })),
    da_completare_a_mano: manuali,
  };
}

module.exports = { verifica };
