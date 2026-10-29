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
  if (esistente) return res.json({ suggestion_id: esistente.id, proposta: esistente.proposta, corrente: esistente.corrente, fonte: esistente.fonte || null });
  const out = await aiSuggestions.suggestForRecord({ moduleSlug: slug, recordId: id, force: true });
  if (out.id) return res.json({ suggestion_id: out.id, proposta: out.payload.proposta, corrente: out.payload.corrente, fonte: out.payload.fonte || null });
  if (out.error) return res.status(out.status === 429 ? 429 : 502).json({ error: out.error, code: out.code });
  res.json({ proposta: null, motivo: out.skipped || 'nessuna proposta utile' });
});


// ── Spostare una riga in un altro modulo di spesa (es. da Casa a Personale) ──────────────────────────────────────────
// Le destinazioni possibili sono i moduli che dichiarano lo stesso tipo di righe (kind) e gli avvisi. I campi si abbinano per RUOLO
// (importo, data, scadenza, categoria, descrizione, stato…), non per nome; gli altri passano solo se nel modulo di destinazione c'è un campo
// con la stessa chiave e lo stesso tipo (e, per una relazione, lo stesso modulo collegato; per una scelta, un valore ammesso).
// Quello che non passa non si perde in silenzio: l'elenco viene mostrato prima di confermare e scritto nella cronologia della riga.
const fieldsOf = (schema) => (schema.fields || []);
const optionValues = (f) => (Array.isArray(f.options) ? f.options.map((o) => (typeof o === 'string' ? o : o.value)) : null);
const isEmpty = (v) => v === undefined || v === null || v === '';

function mappaRiga(srcSchema, srcDecl, tgtSchema, tgtDecl, data) {
  const sR = { stato: '_stato', ...srcDecl.roles }, tR = { stato: '_stato', ...tgtDecl.roles };
  const out = {}, persi = [], usati = new Set();
  const tgtFields = fieldsOf(tgtSchema);
  const label = (key) => (fieldsOf(srcSchema).find((f) => f.key === key) || {}).label || key;
  const mettiSeAmmesso = (srcKey, tgtKey) => {
    const v = data[srcKey];
    const tf = tgtFields.find((f) => f.key === tgtKey);
    const ammessi = tf ? optionValues(tf) : null;
    if (ammessi && !isEmpty(v) && !ammessi.includes(v)) { persi.push({ key: srcKey, label: label(srcKey), motivo: 'valore «' + v + '» non previsto nella destinazione' }); return; }
    if (!isEmpty(v)) out[tgtKey] = v;
  };
  // 1. per ruolo
  Object.keys(sR).forEach((k) => {
    if (k === 'stato' || !sR[k] || !tR[k]) return;
    usati.add(sR[k]);
    mettiSeAmmesso(sR[k], tR[k]);
  });
  // 2. gli altri campi, solo se stessa chiave e stesso tipo
  fieldsOf(srcSchema).forEach((f) => {
    if (usati.has(f.key)) return;
    const v = data[f.key];
    if (isEmpty(v)) return;
    const tf = tgtFields.find((x) => x.key === f.key);
    if (tf && tf.type === f.type) { mettiSeAmmesso(f.key, f.key); return; }
    persi.push({ key: f.key, label: f.label || f.key, motivo: tf ? 'tipo diverso nella destinazione' : 'non esiste nella destinazione' });
  });
  // 3. relazioni (sono fuori da fields): passano solo verso lo stesso modulo collegato
  (srcSchema.relations || []).forEach((r) => {
    const v = data[r.key];
    if (isEmpty(v)) return;
    const tr = (tgtSchema.relations || []).find((x) => x.key === r.key && x.target_module === r.target_module);
    if (tr) out[r.key] = v; else persi.push({ key: r.key, label: r.key.replace(/_/g, ' '), motivo: 'collegamento non previsto nella destinazione' });
  });
  // 4. stato: se è uno dei tre dichiarati si traduce, altrimenti resta se la destinazione lo conosce, sennò parte dall'iniziale
  const sA = srcDecl.avvisi.states, tA = tgtDecl.avvisi.states;
  const stato = data[sR.stato];
  const nome = ['nuovo', 'da_fare', 'fatto'].find((k) => sA[k] && sA[k] === stato);
  const tgtStates = ((tgtSchema.workflow && tgtSchema.workflow.states) || []);
  if (nome && tA[nome]) out[tR.stato] = tA[nome];
  else if (tgtStates.some((x) => x.key === stato)) out[tR.stato] = stato;
  else { const init = tgtStates.find((x) => x.initial); if (init) out[tR.stato] = init.key; }
  return { data: out, persi };
}

function destinazioniPer(slug) {
  const decl = moduleRoles.get(slug);
  if (!decl) return [];
  return moduleRoles.list({ use: 'avvisi' }).filter((m) => m.module_slug !== slug && m.kind === decl.kind).map((m) => {
    const mod = db.prepare('SELECT name FROM modules WHERE slug = ? AND installed = 1').get(m.module_slug);
    return mod ? { slug: m.module_slug, name: mod.name } : null;
  }).filter(Boolean);
}

// Le destinazioni possibili per spostare una riga e, per ciascuna, cosa non passerebbe.
router.get('/:slug/:id/destinazioni', requireAuth, (req, res) => {
  const slug = req.params.slug;
  const schema = schemaOf(slug), decl = moduleRoles.get(slug);
  if (!schema || !decl) return fail(res, 404, 'Modulo non trovato');
  const row = db.prepare('SELECT * FROM records WHERE id = ? AND module_slug = ?').get(req.params.id, slug);
  if (!row) return fail(res, 404, 'Riga non trovata');
  const before = decryptFields(JSON.parse(row.data), schema.fields);
  res.json(destinazioniPer(slug).map((d) => {
    const ts = schemaOf(d.slug), td = moduleRoles.get(d.slug);
    if (!ts || !td) return null;
    return { ...d, persi: mappaRiga(schema, decl, ts, td, before).persi };
  }).filter(Boolean));
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
  const modo = ['uno', 'rate', 'pagata', 'sposta'].includes(b.modo) ? b.modo : null;
  if (!modo) return fail(res, 400, 'Scegli come smistare: un pagamento, in rate, già pagata o spostala in un altro modulo.');

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


  // ── sposta in un altro modulo di spesa: la riga cambia modulo (stesso id, stessi allegati; il proprietario resta lo stesso, e se non ne aveva diventa chi la sposta) e resta da smistare lì
  if (modo === 'sposta') {
    const verso = String(b.verso || '');
    if (!destinazioniPer(slug).some((d) => d.slug === verso)) return fail(res, 400, 'Non puoi spostare questa riga in quel modulo.');
    const ts = schemaOf(verso), td = moduleRoles.get(verso);
    if (!ts || !td) return fail(res, 404, 'Modulo di destinazione non trovato');
    const ruleT = ruleFor(ts, req.user.role);
    if (ruleT && !ruleT.create) return fail(res, 403, 'Non hai i permessi per inserire righe nel modulo di destinazione.');
    const m = mappaRiga(schema, decl, ts, td, data);
    const nuovoNome = (db.prepare('SELECT name FROM modules WHERE slug = ?').get(verso) || {}).name || verso;
    const tx = db.transaction(() => {
      db.prepare('UPDATE records SET module_slug = ?, data = ?, user_id = COALESCE(user_id, ?), updated_at = CURRENT_TIMESTAMP WHERE id = ? AND module_slug = ?').run(verso, JSON.stringify(encryptFields(m.data, ts.fields)), req.user.id, row.id, slug);
      db.prepare('UPDATE record_attachments SET module_slug = ? WHERE module_slug = ? AND record_id = ?').run(verso, slug, row.id);
      // Gli allegati che hanno messo radici in Documenti (module-roles.js → documenti) puntano alla riga tramite
      // una relazione col nome del modulo DI PARTENZA (es. "spesa_personale"): spostando la riga restava lì,
      // orfana rispetto al nuovo modulo — il file c'era ma il record non lo vedeva più tra i suoi "Documenti
      // collegati" (bug reale, trovato dal vivo il 29/10 su una bolletta A2A smistata da Personale a Casa).
      // Si ripunta solo se entrambi i moduli archiviano nello STESSO modulo Documenti.
      const docSrc = decl.documenti, docDst = td.documenti;
      if (docSrc.modulo && docSrc.relazione && docDst.modulo && docDst.relazione && docSrc.modulo === docDst.modulo) {
        for (const r of db.prepare('SELECT id, data FROM records WHERE module_slug = ?').all(docSrc.modulo)) {
          let dd; try { dd = JSON.parse(r.data || '{}'); } catch (e) { continue; }
          if (dd[docSrc.relazione] !== row.id) continue;
          delete dd[docSrc.relazione];
          dd[docDst.relazione] = row.id;
          db.prepare('UPDATE records SET data = ? WHERE id = ?').run(JSON.stringify(dd), r.id);
        }
      }
      try { db.prepare("UPDATE ai_suggestions SET status = 'dismissed', decided_at = CURRENT_TIMESTAMP WHERE module_slug = ? AND record_id = ? AND status = 'pending'").run(slug, row.id); } catch (e) { /* tabella non pronta */ }
    });
    tx();
    logHistory(verso, row.id, req.user.username, { ...before, _modulo: slug }, { ...m.data, _modulo: verso, _campi_non_passati: m.persi.map((p) => p.label) });
    logAudit(req.user.username, 'smista.sposta', slug + '#' + row.id, { verso, persi: m.persi.length });
    return res.json({ ok: true, modo, verso, persi: m.persi, message: 'Spostata in «' + nuovoNome + '»: è nella sua coda da smistare.' + (m.persi.length ? ' Non sono passati: ' + m.persi.map((p) => p.label).join(', ') + '.' : '') });
  }

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
