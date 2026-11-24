// Azioni esterne, abbinamenti, documenti da generare/inviare/firmare di un record. Montato da routes/records.js nello stesso punto in cui stavano.
const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin, requireModuleAccess } = require('./auth');
const { fireTrigger } = require('../automation-engine');
const { logAudit } = require('../audit-log');
const { decryptFields } = require('../crypto-fields');
const { ruleFor, ownedOrAllowed, filterViewable } = require('../permissions');
const { getModuleSchema, attachComputedFields, logHistory } = require('./records-helpers');

const { runTransition } = require('./records-transizioni');

const router = express.Router();

// ─── Azioni esterne (blocco di schema `external_action`) ──────────────────────────────────────────────────────────────
// Un pulsante sul record che chiama un servizio esterno tramite un adattatore (lib/azioni-esterne/) e scrive l'esito sul record. Il blocco dice quale adattatore
// e come i campi del modulo si collegano a lui: qui non ci sono nomi di moduli. Solo amministratori (usano il credito del servizio), con l'accesso al modulo.
function contestoAzione(req) {
  const schema = getModuleSchema(req.params.slug);
  if (!schema) return { errore: [404, 'Modulo non trovato'] };
  const config = (schema.external_actions || []).find((x) => x.key === req.params.key);
  if (!config) return { errore: [404, 'Azione non trovata in questo modulo'] };
  const adattatore = require('../lib/azioni-esterne').adattatore(config.adapter);
  if (!adattatore) return { errore: [400, 'Questa azione usa un adattatore che il core non conosce: «' + String(config.adapter).slice(0, 60) + '»'] };
  const record = db.prepare('SELECT * FROM records WHERE id = ? AND module_slug = ?').get(req.params.id, req.params.slug);
  if (!record) return { errore: [404, 'Record non trovato'] };
  let dati; try { dati = JSON.parse(record.data); } catch (e) { return { errore: [500, 'Record illeggibile'] }; }
  return { config, adattatore, record, dati };
}

router.post('/:slug/:id/azione/:key', requireAuth, requireAdmin, requireModuleAccess, async (req, res) => {
  const ctx = contestoAzione(req);
  if (ctx.errore) return res.status(ctx.errore[0]).json({ error: ctx.errore[1] });
  // Se l'azione consuma un servizio a pagamento (l'adattatore dichiara `servizio`): prima si conferma il costo (409 con importo, spesa del mese e tetto), poi si controlla il tetto
  // mensile, e a esecuzione riuscita la spesa si registra. La conferma è richiesta DAL SERVER: un client non può saltarla.
  // Un adattatore può dichiarare `disponibile`: se il servizio non è (ancora) abilitato la funzione resta «da attivare» PRIMA di chiedere conferma e senza costo; appena il servizio è attivo parte da sola.
  if (typeof ctx.adattatore.disponibile === 'function') {
    let d; try { d = await ctx.adattatore.disponibile({ config: ctx.config, dati: ctx.dati }); } catch (e) { d = { ok: false, motivo: e.message }; }
    if (!d.ok) return res.status(501).json({ error: '«' + (ctx.config.label || 'Questa funzione') + '» è da attivare: ' + (d.motivo || 'il servizio non è disponibile') + (ctx.config.come_attivare ? ' ' + ctx.config.come_attivare : ''), code: 'da_attivare' });
  }
  // `servizioPer` sceglie la voce di listino in base al blocco; `senzaCosto` dice che questa pressione non spende (per esempio il ricontrollo di una richiesta già pagata).
  const nomeServizio = typeof ctx.adattatore.servizioPer === 'function' ? ctx.adattatore.servizioPer({ config: ctx.config, dati: ctx.dati }) : ctx.adattatore.servizio;
  const gratis = typeof ctx.adattatore.senzaCosto === 'function' && ctx.adattatore.senzaCosto({ config: ctx.config, dati: ctx.dati });
  const spese = nomeServizio && !gratis ? require('../lib/openapi-spese') : null;
  const st = spese ? spese.stima(nomeServizio) : null;
  if (spese) {
    const mese = spese.riepilogo(), amb = spese.ambiente();
    if (!(req.body && req.body.conferma === true)) return res.status(409).json({ error: 'Conferma il costo prima di eseguire.', code: 'conferma_costo', gia_eseguita: !!(ctx.config.risultato_in && ctx.dati[ctx.config.risultato_in]), riepilogo: typeof ctx.adattatore.riepilogo === 'function' ? ctx.adattatore.riepilogo({ dati: ctx.dati, config: ctx.config, slug: req.params.slug, id: ctx.record.id }) : null, servizio: st.servizio, nome: st.nome, costo: st.costo, noto: st.noto, ambiente: amb, speso_mese: mese.produzione.speso, tetto: mese.tetto });
    if (amb === 'produzione' && mese.tetto !== null && st.costo !== null && mese.produzione.speso + st.costo > mese.tetto) return res.status(402).json({ error: 'Questa richiesta supera il tetto di spesa mensile (' + mese.tetto.toFixed(2) + ' €, già spesi ' + mese.produzione.speso.toFixed(2) + ' €). Si cambia in Impostazioni → Connessioni → OpenAPI.it.', code: 'tetto_superato', tetto: mese.tetto, speso_mese: mese.produzione.speso });
  }
  let out;
  try { out = await ctx.adattatore.esegui({ dati: ctx.dati, config: ctx.config, utente: req.user, id: ctx.record.id, slug: req.params.slug }); }
  catch (e) { return res.status(e.status || 500).json({ error: e.message, code: e.code }); }
  if (spese) spese.registra({ servizio: st.servizio, descrizione: ctx.config.label + ' · ' + req.params.slug + '#' + ctx.record.id, costo: st.costo || 0, utente: req.user.username, riferimento: req.params.slug + '#' + ctx.record.id });
  const next = { ...ctx.dati, ...out.patch };
  db.prepare('UPDATE records SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(JSON.stringify(next), ctx.record.id);
  const updated = db.prepare('SELECT * FROM records WHERE id = ?').get(ctx.record.id);
  logAudit(req.user.username, 'record.azione_esterna', req.params.slug + '#' + ctx.record.id, { azione: ctx.config.key, ...(out.audit || {}) });
  res.json({ ok: true, record: { ...updated, data: JSON.parse(updated.data) }, ...(out.risposta || {}) });
});

// PDF dell'esito di un'azione esterna (se l'adattatore lo prevede): parte da ciò che è già salvato sul record, senza richiamare il servizio.
router.post('/:slug/:id/azione/:key/pdf', requireAuth, requireAdmin, requireModuleAccess, async (req, res) => {
  const ctx = contestoAzione(req);
  if (ctx.errore) return res.status(ctx.errore[0]).json({ error: ctx.errore[1] });
  if (typeof ctx.adattatore.pdf !== 'function') return res.status(400).json({ error: 'Questa azione non produce un PDF' });
  try {
    const identita = await require('../lib/identita-pdf').caricaIdentita(db);
    const pdf = await ctx.adattatore.pdf({ id: ctx.record.id, dati: ctx.dati, config: ctx.config, identita });
    logAudit(req.user.username, 'record.scarica_azione_esterna', req.params.slug + '#' + ctx.record.id, { azione: ctx.config.key });
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="' + req.params.key + '-' + ctx.record.id + '.pdf"', 'Cache-Control': 'no-store' });
    res.send(pdf);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.status ? e.message : 'Creazione del PDF non riuscita' });
  }
});

// ─── Abbinamento (blocco di schema `match_view`) ──────────────────────────────────────────────
// «Immobili adatti» su un Cliente, «Richieste compatibili» su un Immobile: record di un altro
// modulo che corrispondono a questo secondo regole dichiarate dal Builder (lib/abbinamento.js).
// Solo lettura: non scrive nulla. Rispetta i permessi di vista del modulo bersaglio (compreso
// «solo propri»); un modulo che l'utente non può vedere dà un elenco vuoto, non un errore.
router.get('/:slug/:id/abbinamenti/:key', requireAuth, requireModuleAccess, (req, res) => {
  const { slug, id, key } = req.params;
  const schema = getModuleSchema(slug) || {};
  const def = (schema.match_views || []).find((m) => m.key === key);
  if (!def) return res.status(404).json({ error: 'Abbinamento non trovato in questo modulo' });
  const record = db.prepare('SELECT * FROM records WHERE id = ? AND module_slug = ?').get(id, slug);
  if (!record) return res.status(404).json({ error: 'Record non trovato' });
  const rule = ruleFor(schema, req.user.role);
  if (rule && (!rule.view || !ownedOrAllowed(rule, record, req.user))) return res.status(403).json({ error: 'Non hai i permessi per vedere questo record' });

  const vuoto = { applicabile: true, valutabili: 0, items: [], titolo: def.label };
  const targetSchema = getModuleSchema(def.target_module);
  if (!targetSchema) return res.json(vuoto);
  const targetRule = ruleFor(targetSchema, req.user.role);
  if (req.user.role !== 'admin') {
    const haRighe = db.prepare('SELECT 1 FROM user_modules WHERE user_id = ?').get(req.user.id);
    if (haRighe && !db.prepare('SELECT 1 FROM user_modules WHERE user_id = ? AND module_slug = ?').get(req.user.id, def.target_module)) return res.json(vuoto);
  }
  const candidati = filterViewable(
    db.prepare('SELECT id, user_id, data, updated_at FROM records WHERE module_slug = ? ORDER BY updated_at DESC LIMIT 2000').all(def.target_module)
      .map((r) => ({ ...r, data: JSON.parse(r.data) })),
    targetRule, req.user
  );
  const mioDato = decryptFields(JSON.parse(record.data), schema.fields);
  const esito = require('../lib/abbinamento').calcolaAbbinamenti(def, mioDato, candidati);
  const mostra = [def.display_field, ...(def.subtitle_fields || [])].filter(Boolean);
  res.json({
    applicabile: esito.applicabile, valutabili: esito.valutabili, titolo: def.label, target_module: def.target_module,
    items: esito.items.slice(0, 20).map((it) => ({
      id: it.id, punteggio: it.punteggio, soddisfatte: it.soddisfatte, mancanti: it.mancanti,
      titolo: def.display_field && it.data[def.display_field] != null && it.data[def.display_field] !== '' ? String(it.data[def.display_field]) : '#' + it.id,
      dettagli: mostra.filter((c) => c !== def.display_field).map((c) => ({ campo: c, valore: it.data[c] })).filter((d) => d.valore != null && d.valore !== ''),
    })),
    totale: esito.items.length,
  });
});

// ─── Documento da modello (blocco di schema `document_action`) ────────────────────────────────
// Un modulo dichiara dal Builder uno o più documenti (oggetto + testo con segnaposto + dove
// spedirli); qui non c'è nessun nome di modulo né di campo. Due rotte separate, apposta:
// `anteprima` NON spedisce nulla (solo testo di bozza da rivedere e modificare), `invia` manda
// esattamente il testo che l'admin ha approvato — mai il testo generato senza un giro per gli
// occhi di chi lo manda. Il DESTINATARIO lo ricava sempre il server dal modello e dal record:
// non arriva dalla richiesta, così nessuno può far spedire un documento a un indirizzo scelto da fuori.
// Sostituisce le rotte che stavano legate agli slug di un solo verticale (vedi docs/DECISIONI.md).
function contestoDocumentoDa(slug, id, key, user) {
  const schema = getModuleSchema(slug) || {};
  const azione = (schema.document_actions || []).find((a) => a.key === key);
  if (!azione) return { errore: [404, 'Documento non trovato in questo modulo'] };
  const record = db.prepare('SELECT * FROM records WHERE id = ? AND module_slug = ?').get(id, slug);
  if (!record) return { errore: [404, 'Record non trovato'] };
  const rule = user ? ruleFor(schema, user.role) : null;
  if (user && rule && (!rule.view || !ownedOrAllowed(rule, record, user))) return { errore: [403, 'Non hai i permessi per vedere questo record'] };
  const dati = attachComputedFields({ ...record, data: decryptFields(JSON.parse(record.data), schema.fields) }, schema, slug).data;
  const tenant = db.prepare('SELECT ragione_sociale, indirizzo, piva FROM tenant_settings WHERE id = 1').get();
  const leggiRecord = (modulo, rid) => {
    const r = db.prepare('SELECT data FROM records WHERE module_slug = ? AND id = ?').get(modulo, rid);
    return r ? JSON.parse(r.data) : null;
  };
  const get = require('../lib/modello-documento').costruisciGet({ record: dati, schema, tenant, leggiRecord });
  return { schema, azione, record, get };
}
const contestoDocumento = (req) => contestoDocumentoDa(req.params.slug, req.params.id, req.params.key, req.user);

router.post('/:slug/:id/documento/:key/anteprima', requireAuth, requireAdmin, requireModuleAccess, (req, res) => {
  const ctx = contestoDocumento(req);
  if (ctx.errore) return res.status(ctx.errore[0]).json({ error: ctx.errore[1] });
  const { renderModello, risolviDestinatario } = require('../lib/modello-documento');
  res.json({
    oggetto: renderModello(ctx.azione.subject, ctx.get),
    corpo: renderModello(ctx.azione.body, ctx.get),
    destinatario: risolviDestinatario(ctx.azione.recipient, ctx.get),
  });
});

router.post('/:slug/:id/documento/:key/invia', requireAuth, requireAdmin, requireModuleAccess, async (req, res) => {
  const ctx = contestoDocumento(req);
  if (ctx.errore) return res.status(ctx.errore[0]).json({ error: ctx.errore[1] });
  const { oggetto, corpo } = req.body || {};
  if (typeof corpo !== 'string' || !corpo.trim()) return res.status(400).json({ error: 'Testo del documento mancante' });
  const { risolviDestinatario } = require('../lib/modello-documento');
  const destinatario = risolviDestinatario(ctx.azione.recipient, ctx.get);
  if (!destinatario) return res.status(400).json({ error: 'Nessun indirizzo email a cui spedire: il campo del destinatario è vuoto' });

  const email = require('../lib/email');
  const invio = await email.invia({ to: destinatario, subject: (typeof oggetto === 'string' && oggetto.trim()) || ctx.azione.label || 'Documento', html: email.htmlDaTesto(corpo) });
  if (!invio.ok) return res.status(502).json({ error: 'Invio non riuscito: ' + invio.motivo });

  logAudit(req.user.username, 'record.invia_documento', req.params.slug + '#' + ctx.record.id, { documento: ctx.azione.key, email: destinatario });
  // Cambio di stato opzionale dopo l'invio, solo se il workflow lo ammette da dove il record si
  // trova: se non è ammesso (es. già "documenti inviati" per un secondo invio) l'email parte
  // comunque e lo stato non si tocca.
  let statoAggiornato = false;
  if (ctx.azione.on_send_state) statoAggiornato = runTransition(req.user, req.params.slug, req.params.id, ctx.azione.on_send_state).status === 200;
  res.json({ ok: true, stato_aggiornato: statoAggiornato });
});

// Documento da scaricare: lo stesso testo approvato in anteprima diventa un PDF da stampare e firmare.
// Vale per qualunque documento del modulo (anche quelli che si spediscono per email).
router.post('/:slug/:id/documento/:key/pdf', requireAuth, requireAdmin, requireModuleAccess, async (req, res) => {
  const ctx = contestoDocumento(req);
  if (ctx.errore) return res.status(ctx.errore[0]).json({ error: ctx.errore[1] });
  const { corpo } = req.body || {};
  if (ctx.azione.pdf_modello) { // il modulo originale dell'azienda, compilato con i dati del record (resta compilabile a mano)
    try {
      const { buffer } = await require('../lib/modelli-pdf').compilaPer(ctx.azione.pdf_modello, ctx.get);
      logAudit(req.user.username, 'record.scarica_documento', req.params.slug + '#' + ctx.record.id, { documento: ctx.azione.key, modello_pdf: ctx.azione.pdf_modello });
      res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="' + ctx.azione.key + '-' + ctx.record.id + '.pdf"', 'Cache-Control': 'no-store' });
      return res.send(buffer);
    } catch (e) { return res.status(e.status || 500).json({ error: e.status ? e.message : 'Creazione del PDF non riuscita' }); }
  }
  if (typeof corpo !== 'string' || !corpo.trim()) return res.status(400).json({ error: 'Testo del documento mancante' });
  try {
    const identita = await require('../lib/identita-pdf').caricaIdentita(db);
    const pdf = await require('../lib/documento-pdf').creaPdf({ titolo: ctx.azione.label || 'Documento', corpo, ...identita, riquadroFirma: ctx.azione.delivery === 'firma', piePagina: ctx.azione.label || '' });
    logAudit(req.user.username, 'record.scarica_documento', req.params.slug + '#' + ctx.record.id, { documento: ctx.azione.key });
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="' + ctx.azione.key + '-' + ctx.record.id + '.pdf"', 'Cache-Control': 'no-store' });
    res.send(pdf);
  } catch (e) {
    res.status(500).json({ error: 'Creazione del PDF non riuscita' });
  }
});

// Registra un documento firmato sul record: allega il file con il tipo giusto, scrive i consensi dati, la data della firma, la versione e la scadenza di conservazione,
// e passa allo stato previsto (`on_signed_state`). Lo usano la rotta «firmato» (caricato dall'agente) e la richiesta di firma (caricato dal cliente dal suo link).
// `ctx` è quello di contestoDocumentoDa; `user` ({ username, role }) è chi risulta nella cronologia e per i permessi del cambio di stato.
function registraFirmato({ user, slug, id, ctx, uploadId, consensi, senzaStato = false }) {
  const schema = ctx.schema;
  const { calcolaAggiornamento, TIPO_FIRMATO } = require('../lib/documento-firmato');
  const oggi = new Date().toISOString().slice(0, 10);
  const patch = calcolaAggiornamento(ctx.azione, consensi, oggi);
  const tipo = TIPO_FIRMATO(ctx.azione);

  db.prepare('INSERT INTO record_attachments (module_slug, record_id, upload_id, tipo) VALUES (?, ?, ?, ?)').run(slug, ctx.record.id, uploadId, tipo);
  const beforeData = JSON.parse(ctx.record.data);
  if (Object.keys(patch).length) {
    db.prepare('UPDATE records SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND module_slug = ?').run(JSON.stringify({ ...beforeData, ...patch }), ctx.record.id, slug);
    const dopo = db.prepare('SELECT * FROM records WHERE id = ?').get(ctx.record.id);
    const attached = attachComputedFields({ ...dopo, data: decryptFields(JSON.parse(dopo.data), schema.fields) }, schema, slug);
    logHistory(slug, ctx.record.id, user.username, 'update', beforeData, attached.data);
    Object.keys(patch).forEach((k) => { if (JSON.stringify(beforeData[k]) !== JSON.stringify(patch[k])) fireTrigger(slug, 'modifica_campo', attached.data, attached.id, { campo: k }); });
  }
  logAudit(user.username, 'record.documento_firmato', slug + '#' + ctx.record.id, { documento: ctx.azione.key, consensi: patch });
  let statoAggiornato = false;
  if (ctx.azione.on_signed_state && !senzaStato) statoAggiornato = runTransition(user, slug, id, ctx.azione.on_signed_state).status === 200;
  return { tipo, patch, statoAggiornato };
}

// Documento firmato: il file caricato (scansione o foto del foglio firmato) si allega al record e,
// se il documento lo prevede, si registrano i consensi dati, la data della firma, la versione del
// testo e fino a quando si conservano i dati. Richiamare la rotta con un nuovo firmato (anche per
// revocare un consenso) aggiunge una nuova copia e aggiorna i campi: lo storico resta nella cronologia.
router.post('/:slug/:id/documento/:key/firmato', requireAuth, requireAdmin, requireModuleAccess, (req, res) => {
  const ctx = contestoDocumento(req);
  if (ctx.errore) return res.status(ctx.errore[0]).json({ error: ctx.errore[1] });
  if (ctx.azione.delivery !== 'firma') return res.status(400).json({ error: 'Questo documento non prevede la firma' });
  const schema = ctx.schema;
  const rule = ruleFor(schema, req.user.role);
  if (rule && (!rule.edit || !ownedOrAllowed(rule, ctx.record, req.user))) return res.status(403).json({ error: 'Non hai i permessi per modificare questo record' });

  const { upload_id, consensi } = req.body || {};
  const up = upload_id ? db.prepare('SELECT id, uploaded_by, mime_type FROM uploads WHERE id = ?').get(upload_id) : null;
  if (!up) return res.status(400).json({ error: 'Carica prima il documento firmato' });
  if (up.uploaded_by !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ error: 'Puoi allegare solo file che hai caricato tu' });
  if (!(up.mime_type === 'application/pdf' || /^image\/(jpeg|png|webp)$/.test(up.mime_type))) return res.status(400).json({ error: 'Il documento firmato deve essere un PDF o una foto (JPEG, PNG, WebP)' });

  const esito = registraFirmato({ user: req.user, slug: req.params.slug, id: req.params.id, ctx, uploadId: up.id, consensi });
  const { tipo, patch, statoAggiornato } = esito;
  res.json({ ok: true, tipo, campi_aggiornati: Object.keys(patch), stato_aggiornato: statoAggiornato });
});

module.exports = router;
module.exports.contestoDocumentoDa = contestoDocumentoDa;
module.exports.registraFirmato = registraFirmato;
