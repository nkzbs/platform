'use strict';
// Rivedere a mano le proposte di collegamento scritte in `match_proposals`
// (vedi db.js) — lettura AI già fatta altrove (es.
// one-off-2026-10-30-fill-match-proposals.js), qui solo liste/conferma/salta.
// Generico: non sa nulla di "documenti" o "spese", lavora sulla relazione
// many_to_one che il modulo bersaglio dichiara verso il modulo sorgente.
const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('./auth');
const { parseSchemaNormalized } = require('../schema-v3');
const { callAs } = require('../lib/internal-api');

const router = express.Router();

// Moduli installati che hanno una relazione many_to_one verso sourceSlug, con la chiave di quella relazione
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
  if (!(importo > 0)) return [];
  const out = [];
  for (const m of moduliCollegabili(sourceSlug)) {
    const righe = db.prepare('SELECT id, data FROM records WHERE module_slug = ?').all(m.slug);
    for (const r of righe) {
      let d; try { d = JSON.parse(r.data); } catch (e) { continue; }
      if (d[m.relationKey]) continue; // già collegata
      const imp = Number(d.importo);
      if (!Number.isFinite(imp) || Math.abs(imp - importo) >= 0.01) continue;
      out.push({ slug: m.slug, id: r.id, descrizione: d.descrizione, importo: imp, data: d.data, scadenza: d.scadenza });
    }
  }
  return out;
}

router.get('/pending', requireAuth, requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT * FROM match_proposals WHERE reviewed = 0 ORDER BY id').all();
  const out = rows.map((row) => {
    const proposta = JSON.parse(row.proposta_json || '{}');
    const src = db.prepare('SELECT data FROM records WHERE module_slug = ? AND id = ?').get(row.source_slug, row.source_id);
    let sourceData = {}; try { sourceData = src ? JSON.parse(src.data) : {}; } catch (e) {}
    return {
      id: row.id, source_slug: row.source_slug, source_id: row.source_id,
      titolo: sourceData.titolo || null, file: sourceData.file || null,
      proposta, candidati: candidati(row.source_slug, proposta.importo),
    };
  });
  res.json(out);
});

router.post('/:id/confirm', requireAuth, requireAdmin, async (req, res) => {
  const row = db.prepare('SELECT * FROM match_proposals WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Proposta non trovata' });
  const { target_slug, target_id } = req.body || {};
  if (!target_slug || !target_id) return res.status(400).json({ error: 'target_slug e target_id richiesti' });
  const rel = moduliCollegabili(row.source_slug).find((m) => m.slug === target_slug);
  if (!rel) return res.status(400).json({ error: 'Il modulo scelto non ha una relazione verso ' + row.source_slug });
  const target = db.prepare('SELECT data FROM records WHERE module_slug = ? AND id = ?').get(target_slug, target_id);
  if (!target) return res.status(404).json({ error: 'Record bersaglio non trovato' });
  const data = JSON.parse(target.data);
  const admin = db.prepare("SELECT * FROM users WHERE role = 'admin' LIMIT 1").get();
  const resu = await callAs(admin, 'PUT', '/records/' + target_slug + '/' + target_id, { ...data, [rel.relationKey]: row.source_id });
  if (!resu.ok) return res.status(502).json({ error: 'Salvataggio fallito', dettaglio: resu.data });
  db.prepare('UPDATE match_proposals SET reviewed = 1, target_slug = ?, target_id = ? WHERE id = ?').run(target_slug, target_id, row.id);
  res.json({ ok: true });
});

router.post('/:id/skip', requireAuth, requireAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM match_proposals WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Proposta non trovata' });
  db.prepare('UPDATE match_proposals SET reviewed = 1 WHERE id = ?').run(row.id);
  res.json({ ok: true });
});

module.exports = router;
