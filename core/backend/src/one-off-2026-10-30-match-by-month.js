'use strict';
// Seguito, 30/10/2026: leggendo di persona le proposte ancora ambigue (vedi
// one-off-2026-10-30-report-ambigue.js), due cose:
// 1) bug reale di tolleranza: `Math.abs(imp - importo) < 0.01` su float fa
//    passare 9.99 come "uguale" a 10 (differenza reale ~0.00999999999999979,
//    sotto soglia per un pelo) — corretto qui confrontando i centesimi come
//    interi.
// 2) per una spesa ricorrente mensile (Affitto 550€, Spese condivise 11€) la
//    finestra di ±20 giorni sulla data del documento spesso include DUE mesi
//    consecutivi (il bonifico di agosto è vicino sia al 27 luglio sia al 27
//    agosto) — resta ambigua anche con la data. Il nome del file però dice
//    spesso il mese per esteso ("08-affitto-agosto-2026",
//    "spese-casa-agosto-2026"): se nel titolo c'è un mese riconoscibile e
//    UNA SOLA candidata cade in quello stesso mese/anno, si collega.
const db = require('./db');
const { parseSchemaNormalized } = require('./schema-v3');
const { callAs } = require('./lib/internal-api');

const MESI = { gennaio: 1, febbraio: 2, marzo: 3, aprile: 4, maggio: 5, giugno: 6, luglio: 7, agosto: 8, settembre: 9, ottobre: 10, novembre: 11, dicembre: 12 };

function meseDalTitolo(titolo) {
  const t = String(titolo || '').toLowerCase();
  for (const nome of Object.keys(MESI)) if (t.includes(nome)) {
    const annoMatch = t.match(/20\d{2}/);
    if (annoMatch) return { mese: MESI[nome], anno: +annoMatch[0] };
  }
  return null;
}

function moduliCollegabili(sourceSlug) {
  const installati = db.prepare('SELECT slug, schema_json FROM modules WHERE installed = 1').all();
  const out = [];
  for (const m of installati) {
    if (m.slug === sourceSlug) continue;
    let schema; try { schema = parseSchemaNormalized(m.schema_json); } catch (e) { continue; }
    const rel = (schema.relations || []).find((r) => r.type === 'many_to_one' && r.target_module === sourceSlug);
    if (rel) out.push({ slug: m.slug, relationKey: rel.key });
  }
  return out;
}

function stessiCentesimi(a, b) { return Math.round(a * 100) === Math.round(b * 100); }

function candidati(sourceSlug, importo) {
  const out = [];
  for (const m of moduliCollegabili(sourceSlug)) {
    const righe = db.prepare('SELECT id, data FROM records WHERE module_slug = ?').all(m.slug);
    for (const r of righe) {
      let d; try { d = JSON.parse(r.data); } catch (e) { continue; }
      if (d[m.relationKey]) continue;
      const imp = Number(d.importo);
      if (!Number.isFinite(imp) || !stessiCentesimi(imp, importo)) continue;
      out.push({ slug: m.slug, id: r.id, data: d.data, relationKey: m.relationKey });
    }
  }
  return out;
}

async function run() {
  const righe = db.prepare("SELECT id, source_slug, source_id, proposta_json FROM match_proposals WHERE reviewed = 0").all();
  const admin = db.prepare("SELECT * FROM users WHERE role = 'admin' LIMIT 1").get();
  let collegati = 0;
  for (const row of righe) {
    const p = JSON.parse(row.proposta_json);
    if (p.error || p.importo == null) continue;
    const cand = candidati(row.source_slug, p.importo);
    if (cand.length < 2) continue; // non ambigua per importo corretto: la gestisce il giro normale
    const src = db.prepare('SELECT data FROM records WHERE module_slug = ? AND id = ?').get(row.source_slug, row.source_id);
    const d = JSON.parse(src.data);
    const mt = meseDalTitolo(d.titolo);
    if (!mt) continue;
    const delMese = cand.filter((c) => c.data && c.data.startsWith(mt.anno + '-' + String(mt.mese).padStart(2, '0')));
    if (delMese.length !== 1) continue;
    const scelta = delMese[0];
    const target = db.prepare('SELECT data FROM records WHERE module_slug = ? AND id = ?').get(scelta.slug, scelta.id);
    const resu = await callAs(admin, 'PUT', '/records/' + scelta.slug + '/' + scelta.id, { ...JSON.parse(target.data), [scelta.relationKey]: row.source_id });
    if (resu.ok) {
      db.prepare('UPDATE match_proposals SET reviewed = 1, target_slug = ?, target_id = ? WHERE id = ?').run(scelta.slug, scelta.id, row.id);
      collegati++;
    }
  }
  console.log('[one-off-match-by-month] collegati per mese dal nome file: ' + collegati);
}

module.exports = { run };
