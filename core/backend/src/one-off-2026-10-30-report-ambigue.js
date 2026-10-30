'use strict';
// Report, 30/10/2026: per le proposte rimaste ambigue (importo letto, ma 2+
// spese candidate anche dopo la data) stampa un JSON compatto — titolo, dati
// letti, un estratto del testo del PDF, e le candidate — perché li legga
// Claude stesso (meglio del piccolo modello usato per la lettura di massa)
// e decida a mano quale spesa è quella giusta. Non scrive nulla.
const db = require('./db');
const { parseSchemaNormalized } = require('./schema-v3');

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
function candidati(sourceSlug, importo) {
  const out = [];
  for (const m of moduliCollegabili(sourceSlug)) {
    const righe = db.prepare('SELECT id, data FROM records WHERE module_slug = ?').all(m.slug);
    for (const r of righe) {
      let d; try { d = JSON.parse(r.data); } catch (e) { continue; }
      if (d[m.relationKey]) continue;
      const imp = Number(d.importo);
      if (!Number.isFinite(imp) || Math.abs(imp - importo) >= 0.01) continue;
      out.push({ slug: m.slug, id: r.id, descrizione: d.descrizione, importo: imp, data: d.data });
    }
  }
  return out;
}

async function run() {
  const { driveDownload } = require('./routes/google-oauth');
  const att = require('./attachment-text');
  const righe = db.prepare("SELECT id, source_slug, source_id, proposta_json FROM match_proposals WHERE reviewed = 0").all();
  const out = [];
  for (const row of righe) {
    const p = JSON.parse(row.proposta_json);
    if (p.error || p.importo == null) continue;
    const cand = candidati(row.source_slug, p.importo);
    if (cand.length < 2) continue; // non ambigua (0 o 1: già gestita altrove)
    const src = db.prepare('SELECT data FROM records WHERE module_slug = ? AND id = ?').get(row.source_slug, row.source_id);
    const d = JSON.parse(src.data);
    let estratto = '';
    try {
      const file = d.file;
      const up = file && db.prepare('SELECT stored_name FROM uploads WHERE id = ?').get(file.id);
      if (up && up.stored_name && up.stored_name.startsWith('drive:') && /\.pdf$/i.test(file.name || '')) {
        const bytes = await driveDownload(up.stored_name.slice(6));
        const testo = await att.textFromBuffers([{ bytes, filename: file.name, mimeType: 'application/pdf' }]);
        estratto = String(testo || '').replace(/\s+/g, ' ').trim().slice(0, 400);
      }
    } catch (e) { estratto = '(errore lettura: ' + e.message + ')'; }
    out.push({ proposal_id: row.id, titolo: d.titolo, importo: p.importo, data_documento: p.data_documento || null, fornitore: p.fornitore || null, estratto, candidati: cand });
  }
  console.log('[one-off-report-ambigue] ' + out.length + ' ambigue');
  console.log('===JSON_START===');
  console.log(JSON.stringify(out));
  console.log('===JSON_END===');
}

module.exports = { run };
