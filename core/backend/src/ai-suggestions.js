'use strict';
const { internalSecret } = require('../../../shared/internal-secret.js');
// Assistente AI per lo smistamento delle bollette. L'AI PROPONE (categoria, importo, scadenza,
// fornitore), non scrive mai da sola: la proposta resta in `ai_suggestions` finché non la
// si accetta o la si ignora. Il tenant non parla mai con Mistral: chiede a Super Admin, che
// toglie i dati personali, ferma tutto al tetto di spesa mensile e controlla l'output.
const db = require('./db');
const { parseSchemaNormalized } = require('./schema-v3');
const { logAudit } = require('./audit-log');

const SUPER_ADMIN_URL = process.env.SUPER_ADMIN_URL || 'http://super-admin-backend:3000';
const INTERNAL_SECRET = internalSecret();
const moduleAi = require('./module-ai');
const moduleRoles = require('./module-roles');

// Dove l'AI lavora lo decide ogni modulo (Builder → Potenziamenti AI → "Smistare"); i campi li dichiara il modulo (Ruoli del modulo).
// Qui non ci sono nomi di moduli né di campi scritti nel codice, se non i valori di partenza di un modulo senza ruoli.
function fieldMap(slug) {
  const r = moduleRoles.get(slug);
  return { importo: 'importo', data: 'data', scadenza: 'scadenza', categoria: 'categoria', descrizione: 'descrizione', stato: '_stato', ...((r && r.roles) || {}) };
}
function triageModules() {
  return moduleRoles.list({}).map((m) => m.module_slug).filter((slug) => moduleAi.can(slug, 'triage'));
}

// Categorie ammesse = le opzioni del campo "categoria" del modulo (mai una lista a parte).
function allowedCategories(moduleSlug) {
  const row = db.prepare('SELECT schema_json FROM modules WHERE slug = ?').get(moduleSlug);
  if (!row) return [];
  try {
    const field = (parseSchemaNormalized(row.schema_json).fields || []).find((f) => f.key === fieldMap(moduleSlug).categoria);
    return field && Array.isArray(field.options) ? field.options.map((o) => (typeof o === 'string' ? o : o.value)).filter(Boolean) : [];
  } catch (e) { return []; }
}

function moduliAmmessi() {
  const out = {};
  for (const slug of triageModules()) {
    const categorie = allowedCategories(slug);
    if (categorie.length) out[slug] = { categorie };
  }
  return out;
}

// Chiede a Super Admin la proposta. Ritorna { suggestion } oppure { error, status, code }.
async function classify({ mittente, oggetto, testo, rilevato, moduloAttuale, allegati, indizioEnergia, moduli: moduliDati }) {
  const moduli = moduliDati || moduliAmmessi();
  if (!Object.keys(moduli).length) return { error: 'Nessun modulo di spese con categorie installato', status: 400 };
  try {
    const res = await fetch(SUPER_ADMIN_URL + '/api/tenant-ai/classify-bill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_SECRET },
      body: JSON.stringify({ tenant_slug: process.env.TENANT_SLUG, data: { mittente, oggetto, testo, rilevato, modulo_attuale: moduloAttuale, moduli, allegati: allegati || undefined, indizio_energia: indizioEnergia || undefined } }),
      signal: AbortSignal.timeout(30000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { error: body.error || 'Assistente non disponibile', status: res.status, code: body.code };
    return { suggestion: body.suggestion };
  } catch (e) {
    return { error: 'Assistente non raggiungibile', status: 502 };
  }
}

// "Importare": da un PDF caricato a mano (non da una mail) propone i campi di una riga nuova. Solo se il modulo ha "Importare" acceso. Non scrive niente.
async function proposeFromDocument({ moduleSlug, filename, bytes }) {
  if (!moduleAi.can(moduleSlug, 'import')) return { error: 'L\'importazione con l\'AI non è accesa su questo modulo.', status: 403 };
  const att = require('./attachment-text');
  const pdf = await att.textFromBuffers([{ bytes, filename, mimeType: 'application/pdf' }]);
  if (!pdf || pdf.trim().length < 20) return { error: 'Non riesco a leggere il testo di questo PDF (forse è una scansione).', status: 422 };
  const out = await classify({
    moduli: { [moduleSlug]: { categorie: allowedCategories(moduleSlug) } }, allegati: att.relevantExtract(pdf) || undefined, indizioEnergia: att.energyHint(pdf),
    mittente: '', oggetto: String(filename || '').replace(/\.pdf$/i, '').slice(0, 120), testo: '', rilevato: { importo: null, scadenza: null }, moduloAttuale: moduleSlug,
  });
  if (out.error) return { error: out.error, status: out.status, code: out.code };
  return { proposta: out.suggestion };
}

function hasPending(moduleSlug, recordId) {
  return !!db.prepare("SELECT 1 FROM ai_suggestions WHERE module_slug = ? AND record_id = ? AND status = 'pending'").get(moduleSlug, recordId);
}

// Dove l'AI ha letto ogni valore: per importo, scadenza e categoria la riga del PDF in cui compare. Serve a chi non conosce i dati per controllarli
// (la proposta non è un atto di fede). Calcolato qui, non dal modello: se la riga non si trova, il campo non ha una fonte e il pannello lo dice.
const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
function lineWith(pdf, re) {
  const l = String(pdf || '').split('\n').map((x) => x.replace(/\s+/g, ' ').trim()).find((x) => x.length > 3 && re.test(x));
  return l ? l.slice(0, 140) : null;
}
function evidenza(pdf, p) {
  const out = {};
  if (p.importo != null) {
    const [i, d] = Number(p.importo).toFixed(2).split('.');
    const conPunto = i.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + d;
    const l = lineWith(pdf, new RegExp('(^|[^\\d,.])' + escRe(conPunto) + '(?!\\d)')) || lineWith(pdf, new RegExp('(^|[^\\d,.])' + escRe(i + ',' + d) + '(?!\\d)'));
    if (l) out.importo = l;
  }
  if (p.scadenza && /^\d{4}-\d{2}-\d{2}$/.test(p.scadenza)) {
    const [y, m, g] = p.scadenza.split('-'); const gg = String(parseInt(g, 10));
    const l = lineWith(pdf, new RegExp('\\b0?' + gg + '[/.\\- ]0?' + parseInt(m, 10) + '[/.\\- ]' + y + '\\b')) || lineWith(pdf, new RegExp('\\b0?' + gg + ' ' + MESI[parseInt(m, 10) - 1] + ' ' + y, 'i'));
    if (l) out.scadenza = l;
  }
  if (p.categoria) {
    const c = String(p.categoria).toLowerCase();
    const l = (/elettric|luce/.test(c) && (lineWith(pdf, /kwh|\bpod\b/i) || lineWith(pdf, /energia elettrica/i))) || (/\bgas\b/.test(c) && (lineWith(pdf, /\bsmc\b|\bpdr\b/i) || lineWith(pdf, /gas naturale/i))) || lineWith(pdf, new RegExp(escRe(p.categoria), 'i'));
    if (l) out.categoria = l;
  }
  return out;
}

// Crea il suggerimento per un record, se serve. Mai un errore verso il chiamante: il record
// resta com'è e l'assistente al massimo non propone nulla.
async function suggestForRecord({ moduleSlug, recordId, mittente, subject, text, attachments, force = false }) {
  // `force` (richiesta esplicita di chi guarda) non salta l'interruttore: se il modulo non ha "Smistare" acceso, l'AI non lavora.
  if (!moduleAi.can(moduleSlug, 'triage')) return { skipped: 'non attivo su questo modulo' };
  const F = fieldMap(moduleSlug);
  if (hasPending(moduleSlug, recordId)) return { skipped: 'già presente' };
  const rec = db.prepare('SELECT data FROM records WHERE id = ? AND module_slug = ?').get(recordId, moduleSlug);
  if (!rec) return { skipped: 'record inesistente' };
  const cur = JSON.parse(rec.data);
  // Il tipo di bolletta (luce o gas) sta di solito nel PDF allegato: se ci sono allegati appena scaricati si usano quelli,
  // altrimenti quelli già salvati per il record. Verso l'assistente esce solo un estratto e l'indizio calcolato qui.
  const att = require('./attachment-text');
  const pdf = attachments && attachments.length ? await att.textFromBuffers(attachments) : await att.textForRecord(moduleSlug, recordId);
  const indizio = att.energyHint((text || cur.note || '') + '\n' + pdf);
  // Niente da leggere (nessun PDF e nessun testo di mail sostanzioso) = niente da proporre: con il solo titolo l'AI indovinerebbe, e non si potrebbe verificare.
  const haPdf = String(pdf || '').trim().length >= 20;
  if (!haPdf && String(text || cur.note || '').trim().length < 80) return { skipped: 'niente da leggere: nessun PDF e nessun testo' };
  const out = await classify({
    allegati: att.relevantExtract(pdf) || undefined, indizioEnergia: indizio,
    mittente: mittente || cur[F.descrizione] || '',
    oggetto: subject || cur[F.descrizione] || '',
    testo: text || cur.note || '',
    rilevato: { importo: cur[F.importo] || null, scadenza: cur[F.scadenza] || null },
    moduloAttuale: moduleSlug,
  });
  if (out.error) return { error: out.error, status: out.status, code: out.code };

  const p = out.suggestion;
  // Propongo solo ciò che cambia qualcosa: niente suggerimenti identici allo stato attuale.
  const cambia = (p.categoria && p.categoria !== cur[F.categoria])
    || (p.importo != null && Number(cur[F.importo] || 0) !== p.importo)
    || (p.scadenza && p.scadenza !== cur[F.scadenza])
    || (p.modulo && p.modulo !== moduleSlug)
    || (!!p.fornitore && haPdf); // il solo fornitore, senza un documento da cui leggerlo, non basta per proporre
  if (!cambia) return { skipped: 'nessuna differenza' };

  const allegati = db.prepare('SELECT u.id AS upload_id, u.original_name AS name FROM record_attachments ra JOIN uploads u ON u.id = ra.upload_id WHERE ra.module_slug = ? AND ra.record_id = ?').all(moduleSlug, recordId);
  const payload = {
    proposta: p, corrente: { categoria: cur[F.categoria] || null, importo: cur[F.importo] || null, scadenza: cur[F.scadenza] || null },
    fonte: { letto_pdf: haPdf, allegati: allegati.length ? allegati : (attachments || []).map((a) => ({ upload_id: null, name: a.filename })), righe: haPdf ? evidenza(pdf, p) : {} },
  };
  const id = db.prepare('INSERT INTO ai_suggestions (module_slug, record_id, payload) VALUES (?, ?, ?)').run(moduleSlug, recordId, JSON.stringify(payload)).lastInsertRowid;
  return { id, payload };
}

function logHistory(moduleSlug, recordId, actor, before, after) {
  try {
    db.prepare('INSERT INTO record_history (record_id, module_slug, actor, action, before_data, after_data) VALUES (?, ?, ?, ?, ?, ?)')
      .run(recordId, moduleSlug, actor || null, 'update', JSON.stringify(before), JSON.stringify(after));
  } catch (e) { /* mai bloccare */ }
}

// Applica una proposta al record. Ricontrolla qui la categoria sulle opzioni del modulo
// (difesa in profondità: non ci si fida della sola validazione a monte). Non cambia lo stato
// di pagamento e non sposta il record da un modulo all'altro: quello resta una scelta tua.
function accept(id, actor) {
  const sug = db.prepare("SELECT * FROM ai_suggestions WHERE id = ? AND status = 'pending'").get(id);
  if (!sug) return { error: 'Suggerimento non trovato o già gestito', status: 404 };
  const rec = db.prepare('SELECT data FROM records WHERE id = ? AND module_slug = ?').get(sug.record_id, sug.module_slug);
  if (!rec) {
    db.prepare("UPDATE ai_suggestions SET status = 'dismissed', decided_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
    return { error: 'Il record non esiste più', status: 404 };
  }
  const before = JSON.parse(rec.data);
  const after = { ...before };
  const p = JSON.parse(sug.payload).proposta;
  const F = fieldMap(sug.module_slug);
  const applied = [];
  if (p.categoria && allowedCategories(sug.module_slug).includes(p.categoria) && p.categoria !== before[F.categoria]) { after[F.categoria] = p.categoria; applied.push('categoria'); }
  if (p.importo != null && p.importo !== Number(before[F.importo] || 0)) { after[F.importo] = p.importo; applied.push('importo'); }
  if (p.scadenza && p.scadenza !== before[F.scadenza]) { after[F.scadenza] = p.scadenza; applied.push('scadenza'); }
  if (p.fornitore && !String(before.note || '').includes('Fornitore: ' + p.fornitore)) {
    after.note = (before.note ? before.note + '\n' : '') + 'Fornitore: ' + p.fornitore;
    applied.push('fornitore');
  }
  if (applied.length) {
    db.prepare('UPDATE records SET data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(JSON.stringify(after), sug.record_id);
    logHistory(sug.module_slug, sug.record_id, actor, before, after);
  }
  db.prepare("UPDATE ai_suggestions SET status = 'accepted', decided_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
  logAudit(actor, 'ai.suggestion.accept', sug.module_slug + '#' + sug.record_id, { applied });
  return { ok: true, applied };
}

function dismiss(id, actor) {
  const r = db.prepare("UPDATE ai_suggestions SET status = 'dismissed', decided_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'").run(id);
  if (!r.changes) return { error: 'Suggerimento non trovato o già gestito', status: 404 };
  logAudit(actor, 'ai.suggestion.dismiss', String(id), null);
  return { ok: true };
}

function listPending(moduleSlug) {
  const rows = db.prepare("SELECT * FROM ai_suggestions WHERE module_slug = ? AND status = 'pending' ORDER BY id DESC").all(moduleSlug);
  return rows.map((s) => {
    const rec = db.prepare('SELECT data FROM records WHERE id = ? AND module_slug = ?').get(s.record_id, s.module_slug);
    const data = rec ? JSON.parse(rec.data) : null;
    return { id: s.id, record_id: s.record_id, module_slug: s.module_slug, created_at: s.created_at, record: data ? { descrizione: data[fieldMap(s.module_slug).descrizione], importo: data[fieldMap(s.module_slug).importo], data: data[fieldMap(s.module_slug).data] } : null, ...JSON.parse(s.payload) };
  }).filter((x) => x.record);
}

// Fetch dello stato del tetto da Super Admin (solo per mostrarlo nelle impostazioni).
// Quadro per la dashboard: tutte le proposte in attesa (casa e personali) e le righe "da smistare" per cui
// non è ancora stata chiesta una proposta (al massimo 10, per non spendere troppo in un colpo solo).
function overview() {
  const items = triageModules().flatMap((slug) => listPending(slug));
  const have = new Set(items.map((i) => i.module_slug + ':' + i.record_id));
  const toAsk = [];
  for (const slug of triageModules()) {
    for (const r of db.prepare("SELECT id FROM records WHERE module_slug = ? AND json_extract(data, ?) = 'da_smistare' ORDER BY id DESC").all(slug, '$.' + fieldMap(slug).stato)) {
      if (!have.has(slug + ':' + r.id) && !hasPending(slug, r.id)) toAsk.push({ module_slug: slug, record_id: r.id });
    }
  }
  return { items, to_ask: toAsk.slice(0, 10), to_ask_total: toAsk.length };
}

async function budget() {
  try {
    const res = await fetch(SUPER_ADMIN_URL + '/api/tenant-ai/budget?tenant_slug=' + encodeURIComponent(process.env.TENANT_SLUG || ''), { headers: { 'x-internal-secret': INTERNAL_SECRET }, signal: AbortSignal.timeout(4000) });
    return res.ok ? await res.json() : null;
  } catch (e) { return null; }
}

module.exports = { evidenza, proposeFromDocument, suggestForRecord, accept, dismiss, listPending, overview, budget, allowedCategories, triageModules };
