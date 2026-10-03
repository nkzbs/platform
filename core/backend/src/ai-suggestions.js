'use strict';
// Assistente AI per lo smistamento delle bollette. L'AI PROPONE (categoria, importo, scadenza,
// fornitore), non scrive mai da sola: la proposta resta in `ai_suggestions` finché non la
// si accetta o la si ignora. Il tenant non parla mai con Mistral: chiede a Super Admin, che
// toglie i dati personali, ferma tutto al tetto di spesa mensile e controlla l'output.
const db = require('./db');
const { parseSchemaNormalized } = require('./schema-v3');
const { logAudit } = require('./audit-log');

const SUPER_ADMIN_URL = process.env.SUPER_ADMIN_URL || 'http://super-admin-backend:3000';
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET || 'changeme_internal';
const BILL_MODULES = ['spese_casa', 'spese_personali'];

function isEnabled() {
  const row = db.prepare('SELECT ai_bollette_enabled FROM tenant_settings WHERE id = 1').get();
  return !!(row && row.ai_bollette_enabled);
}

function setEnabled(on) {
  db.prepare('UPDATE tenant_settings SET ai_bollette_enabled = ? WHERE id = 1').run(on ? 1 : 0);
}

// Categorie ammesse = le opzioni del campo "categoria" del modulo (mai una lista a parte).
function allowedCategories(moduleSlug) {
  const row = db.prepare('SELECT schema_json FROM modules WHERE slug = ?').get(moduleSlug);
  if (!row) return [];
  try {
    const field = (parseSchemaNormalized(row.schema_json).fields || []).find((f) => f.key === 'categoria');
    return field && Array.isArray(field.options) ? field.options.map((o) => (typeof o === 'string' ? o : o.value)).filter(Boolean) : [];
  } catch (e) { return []; }
}

function moduliAmmessi() {
  const out = {};
  for (const slug of BILL_MODULES) {
    const row = db.prepare('SELECT installed FROM modules WHERE slug = ?').get(slug);
    if (!row || !row.installed) continue;
    const categorie = allowedCategories(slug);
    if (categorie.length) out[slug] = { categorie };
  }
  return out;
}

// Chiede a Super Admin la proposta. Ritorna { suggestion } oppure { error, status, code }.
async function classify({ mittente, oggetto, testo, rilevato, moduloAttuale, allegati, indizioEnergia }) {
  const moduli = moduliAmmessi();
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

function hasPending(moduleSlug, recordId) {
  return !!db.prepare("SELECT 1 FROM ai_suggestions WHERE module_slug = ? AND record_id = ? AND status = 'pending'").get(moduleSlug, recordId);
}

// Crea il suggerimento per un record, se serve. Mai un errore verso il chiamante: il record
// resta com'è e l'assistente al massimo non propone nulla.
async function suggestForRecord({ moduleSlug, recordId, mittente, subject, text, attachments, force = false }) {
  if (!require('./features').isEnabled('bollette_ai')) return { skipped: 'funzione non attiva' };
  if (!force && !isEnabled()) return { skipped: 'disattivato' };
  if (!BILL_MODULES.includes(moduleSlug)) return { skipped: 'modulo non supportato' };
  if (hasPending(moduleSlug, recordId)) return { skipped: 'già presente' };
  const rec = db.prepare('SELECT data FROM records WHERE id = ? AND module_slug = ?').get(recordId, moduleSlug);
  if (!rec) return { skipped: 'record inesistente' };
  const cur = JSON.parse(rec.data);
  // Il tipo di bolletta (luce o gas) sta di solito nel PDF allegato: se ci sono allegati appena scaricati si usano quelli,
  // altrimenti quelli già salvati per il record. Verso l'assistente esce solo un estratto e l'indizio calcolato qui.
  const att = require('./attachment-text');
  const pdf = attachments && attachments.length ? await att.textFromBuffers(attachments) : await att.textForRecord(moduleSlug, recordId);
  const indizio = att.energyHint((text || cur.note || '') + '\n' + pdf);
  const out = await classify({
    allegati: att.relevantExtract(pdf) || undefined, indizioEnergia: indizio,
    mittente: mittente || cur.descrizione || '',
    oggetto: subject || cur.descrizione || '',
    testo: text || cur.note || '',
    rilevato: { importo: cur.importo || null, scadenza: cur.scadenza || null },
    moduloAttuale: moduleSlug,
  });
  if (out.error) return { error: out.error, status: out.status, code: out.code };

  const p = out.suggestion;
  // Propongo solo ciò che cambia qualcosa: niente suggerimenti identici allo stato attuale.
  const cambia = (p.categoria && p.categoria !== cur.categoria)
    || (p.importo != null && Number(cur.importo || 0) !== p.importo)
    || (p.scadenza && p.scadenza !== cur.scadenza)
    || (p.modulo && p.modulo !== moduleSlug)
    || !!p.fornitore;
  if (!cambia) return { skipped: 'nessuna differenza' };

  const payload = { proposta: p, corrente: { categoria: cur.categoria || null, importo: cur.importo || null, scadenza: cur.scadenza || null } };
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
  const applied = [];
  if (p.categoria && allowedCategories(sug.module_slug).includes(p.categoria) && p.categoria !== before.categoria) { after.categoria = p.categoria; applied.push('categoria'); }
  if (p.importo != null && p.importo !== Number(before.importo || 0)) { after.importo = p.importo; applied.push('importo'); }
  if (p.scadenza && p.scadenza !== before.scadenza) { after.scadenza = p.scadenza; applied.push('scadenza'); }
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
    return { id: s.id, record_id: s.record_id, module_slug: s.module_slug, created_at: s.created_at, record: data ? { descrizione: data.descrizione, importo: data.importo, data: data.data } : null, ...JSON.parse(s.payload) };
  }).filter((x) => x.record);
}

// Fetch dello stato del tetto da Super Admin (solo per mostrarlo nelle impostazioni).
// Quadro per la dashboard: tutte le proposte in attesa (casa e personali) e le righe "da smistare" per cui
// non è ancora stata chiesta una proposta (al massimo 10, per non spendere troppo in un colpo solo).
function overview() {
  const items = BILL_MODULES.flatMap((slug) => listPending(slug));
  const have = new Set(items.map((i) => i.module_slug + ':' + i.record_id));
  const toAsk = [];
  for (const slug of BILL_MODULES) {
    if (!db.prepare('SELECT 1 FROM modules WHERE slug = ? AND installed = 1').get(slug)) continue;
    for (const r of db.prepare("SELECT id FROM records WHERE module_slug = ? AND json_extract(data, '$._stato') = 'da_smistare' ORDER BY id DESC").all(slug)) {
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

module.exports = { isEnabled, setEnabled, suggestForRecord, accept, dismiss, listPending, overview, budget, allowedCategories, BILL_MODULES };
