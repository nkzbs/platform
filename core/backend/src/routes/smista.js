'use strict';
// Smistare una riga "nuova" (es. una bolletta appena arrivata): un pagamento solo, diviso in rate, oppure già pagata.
// Cosa è "nuovo", "da fare" e "fatto", quali campi sono importo/scadenza/categoria e dove si crea il piano a rate lo dichiara il modulo
// (Builder → Ruoli del modulo → Avvisi): qui non ci sono nomi di moduli né di stati. Nessuna AI: è una scelta di chi preme il pulsante.
const express = require('express');
const db = require('../db');
const { requireAuth } = require('./auth');
const { parseSchemaNormalized } = require('../schema-v3');
const { fireTrigger } = require('../automation-engine');
const { logAudit } = require('../audit-log');
const { encryptFields, decryptFields } = require('../crypto-fields');
const { ruleFor, ownedOrAllowed } = require('../permissions');
const moduleRoles = require('../module-roles');
const moduleAi = require('../module-ai');
const aiSuggestions = require('../ai-suggestions');

const router = express.Router();
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const round2 = (n) => Math.round(n * 100) / 100;

function schemaOf(slug) {
  const m = db.prepare('SELECT schema_json FROM modules WHERE slug = ? AND installed = 1').get(slug);
  if (!m) return null;
  try { return parseSchemaNormalized(m.schema_json); } catch (e) { return null; }
}
function logHistory(slug, id, actor, before, after) {
  try { db.prepare('INSERT INTO record_history (record_id, module_slug, actor, action, before_data, after_data) VALUES (?, ?, ?, ?, ?, ?)').run(id, slug, actor || null, 'update', JSON.stringify(before), JSON.stringify(after)); } catch (e) { /* mai bloccare */ }
}
const hasTransition = (schema, from, to) => !!(schema.workflow && (schema.workflow.transitions || []).some((t) => t.from === from && t.to === to));
const fail = (res, status, error) => res.status(status).json({ error });

// La proposta dell'AI per una riga da smistare (categoria, importo, scadenza letti dalla bolletta). Se esiste già (preparata all'arrivo della mail) è
// immediata; altrimenti la si chiede ora. Solo se il modulo ha "Smistare" acceso. Non scrive niente: il pannello la usa per precompilare i campi.
router.post('/:slug/:id/proposta', requireAuth, async (req, res) => {
  const slug = req.params.slug, id = parseInt(req.params.id, 10);
  if (!moduleAi.can(slug, 'triage')) return fail(res, 403, 'L\'AI non è accesa su questo modulo.');
  const row = db.prepare('SELECT 1 FROM records WHERE id = ? AND module_slug = ?').get(id, slug);
  if (!row) return fail(res, 404, 'Riga non trovata');
  const esistente = aiSuggestions.listPending(slug).find((x) => x.record_id === id);
  if (esistente) return res.json({ suggestion_id: esistente.id, proposta: esistente.proposta, corrente: esistente.corrente });
  const out = await aiSuggestions.suggestForRecord({ moduleSlug: slug, recordId: id, force: true });
  if (out.id) return res.json({ suggestion_id: out.id, proposta: out.payload.proposta, corrente: out.payload.corrente });
  if (out.error) return res.status(out.status === 429 ? 429 : 502).json({ error: out.error, code: out.code });
  res.json({ proposta: null, motivo: out.skipped || 'nessuna proposta utile' });
});

router.post('/:slug/:id', requireAuth, (req, res) => {
  const slug = req.params.slug;
  const schema = schemaOf(slug);
  const decl = moduleRoles.get(slug);
  if (!schema || !decl) return fail(res, 404, 'Modulo non trovato');
  const A = decl.avvisi, R = { stato: '_stato', ...decl.roles };
  if (!A.states.nuovo || !A.states.da_fare) return fail(res, 400, 'Questo modulo non ha dichiarato gli stati "nuovo" e "da fare" (Builder → Avvisi).');

  const row = db.prepare('SELECT * FROM records WHERE id = ? AND module_slug = ?').get(req.params.id, slug);
  if (!row) return fail(res, 404, 'Riga non trovata');
  const rule = ruleFor(schema, req.user.role);
  if (rule && (!rule.edit || !ownedOrAllowed(rule, row, req.user))) return fail(res, 403, 'Non hai i permessi per modificare questa riga');

  const before = decryptFields(JSON.parse(row.data), schema.fields);
  if (before[R.stato] !== A.states.nuovo) return fail(res, 409, 'Questa riga non è più da smistare.');

  const b = req.body || {};
  const modo = ['uno', 'rate', 'pagata'].includes(b.modo) ? b.modo : null;
  if (!modo) return fail(res, 400, 'Scegli come smistare: un pagamento, in rate o già pagata.');

  // Modifiche fatte nel pannello prima di confermare
  const data = { ...before };
  if (b.importo != null && b.importo !== '') { const n = Number(b.importo); if (!(n >= 0)) return fail(res, 400, 'Importo non valido.'); if (R.importo) data[R.importo] = round2(n); }
  if (b.scadenza) { if (!ISO.test(b.scadenza)) return fail(res, 400, 'Scadenza non valida (AAAA-MM-GG).'); if (R.scadenza) data[R.scadenza] = b.scadenza; }
  if (b.categoria && R.categoria) {
    const f = (schema.fields || []).find((x) => x.key === R.categoria);
    const opts = f && Array.isArray(f.options) ? f.options.map((o) => (typeof o === 'string' ? o : o.value)) : null;
    if (opts && !opts.includes(b.categoria)) return fail(res, 400, 'Categoria non ammessa per questo modulo.');
    data[R.categoria] = b.categoria;
  }
  const importo = Number(data[R.importo]) || 0;

  const chiudiProposta = () => { if (b.suggestion_id) { try { db.prepare("UPDATE ai_suggestions SET status = 'accepted', decided_at = CURRENT_TIMESTAMP WHERE id = ? AND module_slug = ? AND record_id = ? AND status = 'pending'").run(parseInt(b.suggestion_id, 10), slug, row.id); } catch (e) { /* mai bloccare */ } } };
  const save = (patch, toState) => {
    const next = { ...data, ...patch, [R.stato]: toState };
    db.prepare('UPDATE records SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND module_slug = ?').run(JSON.stringify(encryptFields(next, schema.fields)), row.id, slug);
    logHistory(slug, row.id, req.user.username, data, next);
    try { fireTrigger(slug, 'cambio_stato', next, row.id, { stato: toState }); } catch (e) { console.error('[smista] trigger:', e.message); }
    Object.assign(data, next);
  };
  const fmtDate = (iso) => String(iso || '').split('-').reverse().join('/');

  // ── un pagamento solo
  if (modo === 'uno') {
    if (!hasTransition(schema, A.states.nuovo, A.states.da_fare)) return fail(res, 422, 'Il modulo non permette di passare da "nuovo" a "da fare".');
    save({}, A.states.da_fare); chiudiProposta();
    logAudit(req.user.username, 'smista.uno', slug + '#' + row.id, null);
    return res.json({ ok: true, modo, stato: A.states.da_fare, message: 'Smistata: ora è in «' + A.states.da_fare.replace(/_/g, ' ') + '»' + (data[R.scadenza] ? ', scade il ' + fmtDate(data[R.scadenza]) : '') + '.' });
  }

  // ── già pagata
  if (modo === 'pagata') {
    if (!A.states.fatto) return fail(res, 400, 'Questo modulo non ha dichiarato lo stato "fatto" (Builder → Avvisi).');
    if (!hasTransition(schema, A.states.nuovo, A.states.da_fare) || !hasTransition(schema, A.states.da_fare, A.states.fatto)) return fail(res, 422, 'Il modulo non permette di segnarla già pagata.');
    const quando = b.data_pagamento && ISO.test(b.data_pagamento) ? b.data_pagamento : new Date().toISOString().slice(0, 10);
    save({}, A.states.da_fare);
    save(R.data_pagamento ? { [R.data_pagamento]: quando } : {}, A.states.fatto); chiudiProposta();
    logAudit(req.user.username, 'smista.pagata', slug + '#' + row.id, null);
    return res.json({ ok: true, modo, stato: A.states.fatto, message: 'Smistata e segnata «' + A.states.fatto.replace(/_/g, ' ') + '» il ' + fmtDate(quando) + '.' });
  }

  // ── in rate: si crea il piano nel modulo dichiarato, e la sua automazione genera le righe delle rate
  const P = A.piano;
  const pianoSchema = P.modulo ? schemaOf(P.modulo) : null;
  const campiOk = P.modulo && Object.values(P.campi).every(Boolean);
  if (!pianoSchema || !campiOk) return fail(res, 400, 'Questo modulo non ha un piano a rate dichiarato (Builder → Avvisi → Piano a rate).');
  if (!(importo > 0)) return fail(res, 400, 'Per dividere in rate serve un importo maggiore di zero.');
  const n = parseInt(b.n_rate, 10);
  if (!(n >= 2 && n <= 60)) return fail(res, 400, 'Il numero di rate deve essere tra 2 e 60.');
  const prima = b.data_prima_rata || data[R.scadenza] || data[R.data];
  if (!prima || !ISO.test(prima)) return fail(res, 400, 'Indica la data della prima rata.');

  const piano = {
    [P.campi.nome]: String(data[R.descrizione] || 'Piano a rate').trim(), [P.campi.importo_totale]: importo,
    [P.campi.n_rate]: n, [P.campi.importo_rata]: round2(importo / n), [P.campi.data_prima_rata]: prima,
  };
  const init = ((pianoSchema.workflow && pianoSchema.workflow.states) || []).find((s) => s.initial);
  if (init) piano._stato = init.key;
  const maxBefore = (db.prepare('SELECT MAX(id) m FROM records WHERE module_slug = ?').get(slug).m) || 0;

  let pianoId, rate;
  try {
    pianoId = db.prepare('INSERT INTO records (module_slug, user_id, data) VALUES (?, ?, ?)').run(P.modulo, req.user.id, JSON.stringify(encryptFields(piano, pianoSchema.fields))).lastInsertRowid;
    fireTrigger(P.modulo, 'nuovo_record', piano, pianoId, {});
    rate = db.prepare('SELECT id, data FROM records WHERE module_slug = ? AND id > ? ORDER BY id').all(slug, maxBefore).map((r) => ({ id: r.id, data: JSON.parse(r.data) }));
  } catch (e) { rate = []; }
  if (!rate.length) {
    // l'automazione non ha generato le rate: si annulla tutto, la riga resta com'era
    if (pianoId) db.prepare('DELETE FROM records WHERE id = ?').run(pianoId);
    return fail(res, 500, 'Il piano non ha generato le rate: controlla l\'automazione del modulo dei piani. La riga è rimasta com\'era.');
  }
  rate.sort((x, y) => String(x.data[R.data]).localeCompare(String(y.data[R.data])));
  // gli allegati (es. il PDF della bolletta) passano alla prima rata, poi la riga originale si toglie: le rate la sostituiscono
  db.prepare('UPDATE record_attachments SET record_id = ? WHERE module_slug = ? AND record_id = ?').run(rate[0].id, slug, row.id);
  try { db.prepare("UPDATE ai_suggestions SET status = 'dismissed', decided_at = CURRENT_TIMESTAMP WHERE module_slug = ? AND record_id = ? AND status = 'pending'").run(slug, row.id); } catch (e) { /* tabella non pronta */ }
  logHistory(slug, row.id, req.user.username, before, { ...before, _sostituita_da_piano: pianoId });
  db.prepare('DELETE FROM records WHERE id = ? AND module_slug = ?').run(row.id, slug);
  logAudit(req.user.username, 'smista.rate', slug + '#' + row.id, { piano: P.modulo + '#' + pianoId, rate: rate.length });
  const rata = Number(rate[0].data[R.importo]) || piano[P.campi.importo_rata];
  const somma = round2(rata * rate.length), diff = round2(importo - somma);
  const arrotondamento = diff !== 0 ? ' Attenzione: le rate sommano ' + somma.toFixed(2).replace('.', ',') + ' €, ' + Math.abs(diff).toFixed(2).replace('.', ',') + ' € ' + (diff > 0 ? 'in meno' : 'in più') + ' della bolletta per l\'arrotondamento.' : '';
  res.json({
    ok: true, modo, piano: { modulo: P.modulo, id: pianoId }, rate: rate.map((r) => ({ id: r.id, data: r.data[R.data], importo: r.data[R.importo] })),
    message: 'Divisa in ' + rate.length + ' rate da ' + rata.toFixed(2).replace('.', ',') + ' €, dal ' + fmtDate(rate[0].data[R.data]) + ' al ' + fmtDate(rate[rate.length - 1].data[R.data]) + '. La bolletta originale è sostituita dalle rate; il piano è in ' + P.modulo.replace(/_/g, ' ') + '.' + arrotondamento,
  });
});

module.exports = router;
