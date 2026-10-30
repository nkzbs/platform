'use strict';
// Seguito, 30/10/2026: le proposte lette con classify-bill tornano quasi
// sempre "scadenza" vuota — ovvio a ripensarci, quello è un campo per
// bollette DA pagare, e questi sono per lo più RICEVUTE di un pagamento già
// fatto (nessuna scadenza, serve la data del documento). Qui si legge una
// data direttamente dal testo del PDF (già scaricato in precedenza, nessuna
// nuova chiamata AI: solo un'espressione regolare, zero costo) e si
// restringe l'abbinamento per importo+data — quando dopo questo resta
// un'unica spesa candidata, anche tra quelle prima ambigue, si collega da
// sola (stessa API reale di una conferma manuale, mai SQL diretto); quando
// restano più candidate anche con la data resta in sospeso per la revisione
// a mano. Idempotente: salta una proposta già arricchita con data_documento.
const db = require('./db');
const { parseSchemaNormalized } = require('./schema-v3');
const { callAs } = require('./lib/internal-api');

const MESI = { gennaio: 1, febbraio: 2, marzo: 3, aprile: 4, maggio: 5, giugno: 6, luglio: 7, agosto: 8, settembre: 9, ottobre: 10, novembre: 11, dicembre: 12 };

function estraiData(testo) {
  const oggi = new Date('2026-10-30T00:00:00Z').getTime();
  const DUE_ANNI = 2 * 365 * 86400000;
  const candidate = [];
  const reNum = /\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})\b/g;
  let m;
  while ((m = reNum.exec(testo))) {
    const gg = +m[1], mm = +m[2], aa = +m[3];
    if (mm < 1 || mm > 12 || gg < 1 || gg > 31) continue;
    const iso = aa + '-' + String(mm).padStart(2, '0') + '-' + String(gg).padStart(2, '0');
    const t = new Date(iso + 'T00:00:00Z').getTime();
    if (Number.isFinite(t) && Math.abs(oggi - t) < DUE_ANNI) candidate.push({ iso, pos: m.index });
  }
  const reTesto = new RegExp('\\b(\\d{1,2})\\s+(' + Object.keys(MESI).join('|') + ')\\s+(\\d{4})\\b', 'gi');
  while ((m = reTesto.exec(testo))) {
    const gg = +m[1], mm = MESI[m[2].toLowerCase()], aa = +m[3];
    const iso = aa + '-' + String(mm).padStart(2, '0') + '-' + String(gg).padStart(2, '0');
    const t = new Date(iso + 'T00:00:00Z').getTime();
    if (Number.isFinite(t) && Math.abs(oggi - t) < DUE_ANNI) candidate.push({ iso, pos: m.index });
  }
  if (!candidate.length) return null;
  candidate.sort((a, b) => a.pos - b.pos);
  return candidate[0].iso;
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

function candidati(sourceSlug, importo, dataDocumento) {
  if (!(importo > 0)) return [];
  const out = [];
  for (const m of moduliCollegabili(sourceSlug)) {
    const righe = db.prepare('SELECT id, data FROM records WHERE module_slug = ?').all(m.slug);
    for (const r of righe) {
      let d; try { d = JSON.parse(r.data); } catch (e) { continue; }
      if (d[m.relationKey]) continue;
      const imp = Number(d.importo);
      if (!Number.isFinite(imp) || Math.abs(imp - importo) >= 0.01) continue;
      out.push({ slug: m.slug, id: r.id, data: d.data });
    }
  }
  if (out.length > 1 && dataDocumento) {
    const t0 = new Date(dataDocumento + 'T00:00:00Z').getTime();
    const vicine = out.filter((c) => c.data && Math.abs(new Date(c.data + 'T00:00:00Z').getTime() - t0) <= 20 * 86400000);
    if (vicine.length) return vicine;
  }
  return out;
}

async function run() {
  const { driveDownload } = require('./routes/google-oauth');
  const att = require('./attachment-text');
  const righe = db.prepare("SELECT id, source_slug, source_id, proposta_json FROM match_proposals WHERE reviewed = 0").all();
  const admin = db.prepare("SELECT * FROM users WHERE role = 'admin' LIMIT 1").get();
  let arricchiti = 0, collegatiSoli = 0;
  for (const row of righe) {
    const p = JSON.parse(row.proposta_json);
    if (p.error || p.importo == null || 'data_documento' in p) continue; // niente da provare, o già fatto
    const src = db.prepare('SELECT data FROM records WHERE module_slug = ? AND id = ?').get(row.source_slug, row.source_id);
    if (!src) continue;
    const d = JSON.parse(src.data);
    const file = d.file;
    if (!file || !file.id) continue;
    const up = db.prepare('SELECT stored_name FROM uploads WHERE id = ?').get(file.id);
    if (!up || !up.stored_name || !up.stored_name.startsWith('drive:') || !/\.pdf$/i.test(file.name || '')) continue;
    try {
      const bytes = await driveDownload(up.stored_name.slice(6));
      const testo = await att.textFromBuffers([{ bytes, filename: file.name, mimeType: 'application/pdf' }]);
      const dataDocumento = estraiData(testo || '');
      p.data_documento = dataDocumento;
      db.prepare('UPDATE match_proposals SET proposta_json = ? WHERE id = ?').run(JSON.stringify(p), row.id);
      arricchiti++;

      const cand = candidati(row.source_slug, p.importo, dataDocumento);
      if (cand.length === 1) {
        const target = db.prepare('SELECT data FROM records WHERE module_slug = ? AND id = ?').get(cand[0].slug, cand[0].id);
        const rel = moduliCollegabili(row.source_slug).find((m) => m.slug === cand[0].slug);
        const resu = await callAs(admin, 'PUT', '/records/' + cand[0].slug + '/' + cand[0].id, { ...JSON.parse(target.data), [rel.relationKey]: row.source_id });
        if (resu.ok) {
          db.prepare('UPDATE match_proposals SET reviewed = 1, target_slug = ?, target_id = ? WHERE id = ?').run(cand[0].slug, cand[0].id, row.id);
          collegatiSoli++;
        }
      }
    } catch (e) { console.error('[one-off-enrich-dates] #' + row.id, 'fallito:', e.message); }
  }
  console.log('[one-off-enrich-dates] arricchiti ' + arricchiti + ', collegati in automatico (candidata unica) ' + collegatiSoli);
}

module.exports = { run };
