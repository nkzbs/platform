'use strict';
const { internalSecret } = require('../../../../shared/internal-secret.js');
const express = require('express');
const { requireAuth, requireAdmin } = require('./auth');
const ai = require('../ai-suggestions');
const reportAi = require('../report-ai');
const aiKey = require('../ai-key');
const moduleAi = require('../module-ai');
const askData = require('../ask-data');
const db = require('../db');
const { fireTrigger } = require('../automation-engine');
const { saveUploadBuffer } = require('../lib/upload-storage');
const moduleRoles = require('../module-roles');
const { parseSchemaNormalized } = require('../schema-v3');
const { ruleFor } = require('../permissions');
const SUPER_ADMIN_URL = process.env.SUPER_ADMIN_URL || 'http://super-admin-backend:3000';
const INTERNAL_SECRET = internalSecret();
const { logAudit } = require('../audit-log');

const router = express.Router();

// Stato e interruttore dell'assistente + quanto si è speso nel mese (letto da Super Admin).
router.get('/settings', requireAuth, requireAdmin, async (req, res) => {
  const [budget, key] = await Promise.all([ai.budget(), aiKey.status()]);
  res.json({ enabled: moduleAi.masterOn(), report_enabled: reportAi.isEnabled(), budget, key, modules: moduleAi.overviewModules() });
});

// "Potenzia": accende l'AI e, su ogni modulo, i potenziamenti che i suoi ruoli permettono.
router.post('/power-up', requireAuth, requireAdmin, (req, res) => {
  moduleAi.setMaster(true);
  const attivati = moduleAi.powerUp();
  logAudit(req.user.username, 'ai.power_up', null, { moduli: attivati.map((m) => m.slug) });
  res.json({ ok: true, enabled: true, attivati });
});

// Cambia solo gli interruttori presenti nella richiesta.
router.put('/settings', requireAuth, requireAdmin, (req, res) => {
  const body = req.body || {};
  if ('enabled' in body) {
    moduleAi.setMaster(!!body.enabled);
    logAudit(req.user.username, body.enabled ? 'ai.on' : 'ai.off', null, null);
  }
  if ('report_enabled' in body) {
    reportAi.setEnabled(!!body.report_enabled);
    logAudit(req.user.username, body.report_enabled ? 'ai.report.on' : 'ai.report.off', null, null);
  }
  res.json({ enabled: moduleAi.masterOn(), report_enabled: reportAi.isEnabled() });
});

// "Spiega questo report": riceve i totali già calcolati e mostrati nella pagina (mai righe).
// Funziona solo sui moduli che hanno acceso "Spiegare" (Builder → Potenziamenti AI) e hanno i ruoli richiesti.
router.post('/explain-report', requireAuth, async (req, res) => {
  const b = req.body || {};
  if (!moduleAi.can(String(b.modulo || ''), 'explain')) return res.status(403).json({ error: 'La spiegazione con l\'AI non è accesa su questo modulo', code: 'ai_off' });
  const gruppi = Array.isArray(b.gruppi) ? b.gruppi.slice(0, 12).map((g) => ({
    nome: String((g && g.label) != null ? g.label : (g && g.nome) || '').slice(0, 40),
    valore: g && g.value != null ? g.value : g && g.valore,
    confronto: g && g.confronto != null ? g.confronto : undefined,
  })) : [];
  if (!gruppi.length) return res.status(400).json({ error: 'Nessun dato da spiegare' });
  const out = await reportAi.explain('spiegazione', {
    titolo: String(b.titolo || '').slice(0, 80), periodo: String(b.periodo || '').slice(0, 60),
    metrica: String(b.metrica || '').slice(0, 40), funzione: String(b.funzione || '').slice(0, 20),
    totale: b.totale, totale_confronto: b.totale_confronto, gruppi,
  });
  if (out.error) return res.status(out.status === 429 ? 429 : 502).json({ error: out.error, code: out.code });
  res.json({ text: out.text });
});

// Chiave Mistral di questo tenant. Va a Super Admin, che la controlla con Mistral e la conserva
// cifrata; qui non resta nulla e non viene mai restituita.
router.put('/key', requireAuth, requireAdmin, async (req, res) => {
  const key = String((req.body && req.body.key) || '').trim();
  if (!key) return res.status(400).json({ error: 'Incolla la chiave.' });
  const r = await aiKey.setKey(key);
  if (!r.ok) return res.status(r.status === 400 ? 400 : 502).json({ error: r.data.error || 'Non sono riuscito a salvare la chiave.' });
  logAudit(req.user.username, 'ai.key.set', null, null);
  res.json(r.data);
});

router.delete('/key', requireAuth, requireAdmin, async (req, res) => {
  const r = await aiKey.clearKey();
  if (!r.ok) return res.status(502).json({ error: r.data.error || 'Non sono riuscito a togliere la chiave.' });
  logAudit(req.user.username, 'ai.key.clear', null, null);
  res.json(r.data);
});

// Tutte le proposte in attesa (casa e personali) e le righe ancora da chiedere: per la dashboard.
router.get('/overview', requireAuth, requireAdmin, (req, res) => res.json(ai.overview()));

// Suggerimenti in attesa per un modulo (per il pannello sopra l'elenco).
router.get('/suggestions', requireAuth, (req, res) => {
  const slug = String(req.query.module || '');
  if (!ai.triageModules().includes(slug)) return res.json([]);
  res.json(ai.listPending(slug));
});

// "Chiedi un suggerimento" su un record già esistente (usa solo ciò che il record contiene,
// non il testo della mail originale). Funziona anche con l'assistente spento: è una richiesta
// esplicita di chi la fa.
router.post('/suggest/:module/:id', requireAuth, requireAdmin, async (req, res) => {
  const out = await ai.suggestForRecord({ moduleSlug: req.params.module, recordId: parseInt(req.params.id, 10), force: true });
  if (out.error) return res.status(out.status === 429 ? 429 : 502).json({ error: out.error, code: out.code });
  res.json(out);
});

router.post('/suggestions/:id/accept', requireAuth, requireAdmin, (req, res) => {
  const out = ai.accept(parseInt(req.params.id, 10), req.user.username);
  res.status(out.error ? out.status : 200).json(out);
});

router.post('/suggestions/:id/dismiss', requireAuth, requireAdmin, (req, res) => {
  const out = ai.dismiss(parseInt(req.params.id, 10), req.user.username);
  res.status(out.error ? out.status : 200).json(out);
});

// "Chiedi ai tuoi dati": la domanda (mai i record) va a Super Admin, che la traduce in una query strutturata e validata; qui si rivalida e si esegue con il
// codice del progetto, rispettando i permessi. Il risultato mostra anche cosa è stato capito, così si può controllare.
router.post('/ask', requireAuth, requireAdmin, async (req, res) => {
  if (!moduleAi.masterOn()) return res.status(403).json({ error: 'L\'AI non è accesa (Impostazioni → AI).', code: 'ai_off' });
  const domanda = String((req.body && req.body.domanda) || '').trim();
  if (domanda.length < 4) return res.status(400).json({ error: 'Scrivi una domanda.' });
  const cat = askData.catalogo();
  if (!cat.length) return res.status(400).json({ error: 'Nessun modulo ha dichiarato un importo: non c\'è niente da interrogare.' });
  let query;
  try {
    const r = await fetch(SUPER_ADMIN_URL + '/api/tenant-ai/ask-data', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_SECRET },
      body: JSON.stringify({ tenant_slug: process.env.TENANT_SLUG, data: { domanda, oggi: new Date().toISOString().slice(0, 10), catalogo: cat } }),
      signal: AbortSignal.timeout(30000),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(r.status === 429 ? 429 : r.status === 422 ? 422 : 502).json({ error: body.error || 'L\'AI non è disponibile in questo momento.', code: body.code });
    query = body.query;
  } catch (e) { return res.status(502).json({ error: 'L\'AI non è raggiungibile.' }); }
  const v = askData.validate(query, cat);
  if (v.error) return res.status(422).json({ error: v.error, code: 'ai_unanswerable' });
  const nome = (cat.find((m) => m.slug === v.query.modulo) || {}).name || v.query.modulo;
  const out = askData.run(v.query, req.user);
  logAudit(req.user.username, 'ai.ask', v.query.modulo, { calcolo: v.query.calcolo });
  res.json({ titolo: v.query.titolo, filtro: askData.leggibile(v.query, nome), ...out });
});

// ── Importare da un PDF ──────────────────────────────────────────────────────────
// 1) /proposta: legge il PDF e propone i campi (non scrive niente). 2) /crea: crea la riga nello stato "nuovo" del modulo con il PDF allegato; da lì
// passa dalla coda "Da smistare" come una bolletta arrivata per mail. Solo con "Importare" acceso sul modulo; serve il permesso di creare righe.
const MAX_PDF = 3 * 1024 * 1024;
function pdfFrom(body) {
  const b64 = String((body && body.base64) || '').replace(/^data:[^,]*,/, '');
  const bytes = Buffer.from(b64, 'base64');
  if (!bytes.length) return { error: 'Nessun file ricevuto.' };
  if (bytes.length > MAX_PDF) return { error: 'Il PDF è troppo grande (massimo 3 MB).' };
  if (bytes.slice(0, 4).toString() !== '%PDF') return { error: 'Il file non è un PDF.' };
  return { bytes, filename: String((body && body.filename) || 'documento.pdf').replace(/[^\w.\- ]/g, '_').slice(0, 100) };
}
function canCreate(slug, user) {
  const m = db.prepare('SELECT schema_json FROM modules WHERE slug = ? AND installed = 1').get(slug);
  if (!m) return false;
  let schema = {}; try { schema = parseSchemaNormalized(m.schema_json); } catch (e) { /* vuoto */ }
  const rule = ruleFor(schema, user && user.role);
  return !rule || !!rule.create;
}

router.post('/import/:slug/proposta', requireAuth, async (req, res) => {
  const slug = req.params.slug;
  if (!moduleAi.can(slug, 'import')) return res.status(403).json({ error: 'L\'importazione con l\'AI non è accesa su questo modulo.', code: 'ai_off' });
  if (!canCreate(slug, req.user)) return res.status(403).json({ error: 'Non hai il permesso di creare righe in questo modulo.' });
  const f = pdfFrom(req.body); if (f.error) return res.status(400).json({ error: f.error });
  const out = await ai.proposeFromDocument({ moduleSlug: slug, filename: f.filename, bytes: f.bytes });
  if (out.error) return res.status(out.status === 429 ? 429 : out.status === 422 ? 422 : out.status === 403 ? 403 : 502).json({ error: out.error, code: out.code });
  res.json({ proposta: out.proposta, categorie: ai.allowedCategories(slug) });
});

router.post('/import/:slug/crea', requireAuth, async (req, res) => {
  const slug = req.params.slug;
  if (!moduleAi.can(slug, 'import')) return res.status(403).json({ error: 'L\'importazione con l\'AI non è accesa su questo modulo.', code: 'ai_off' });
  if (!canCreate(slug, req.user)) return res.status(403).json({ error: 'Non hai il permesso di creare righe in questo modulo.' });
  const f = pdfFrom(req.body); if (f.error) return res.status(400).json({ error: f.error });
  const decl = moduleRoles.get(slug), R = { stato: '_stato', ...decl.roles }, c = (req.body && req.body.campi) || {};
  const importo = Number(c.importo); const ISO = /^\d{4}-\d{2}-\d{2}$/;
  if (!(importo >= 0)) return res.status(400).json({ error: 'Importo non valido.' });
  if (c.scadenza && !ISO.test(c.scadenza)) return res.status(400).json({ error: 'Scadenza non valida.' });
  if (c.categoria) { const ammesse = ai.allowedCategories(slug); if (ammesse.length && !ammesse.includes(c.categoria)) return res.status(400).json({ error: 'Categoria non ammessa per questo modulo.' }); }
  const data = { note: 'Importato da PDF: ' + f.filename };
  if (R.descrizione) data[R.descrizione] = String(c.descrizione || f.filename.replace(/\.pdf$/i, '')).trim().slice(0, 120);
  if (R.importo) data[R.importo] = Math.round(importo * 100) / 100;
  if (R.data) data[R.data] = new Date().toISOString().slice(0, 10);
  if (R.categoria && c.categoria) data[R.categoria] = c.categoria;
  if (R.scadenza && c.scadenza) data[R.scadenza] = c.scadenza;
  data[R.stato] = decl.avvisi.states.nuovo || data[R.stato];
  const id = db.prepare('INSERT INTO records (module_slug, user_id, data) VALUES (?, ?, ?)').run(slug, req.user.id, JSON.stringify(data)).lastInsertRowid;
  try {
    const stored = await saveUploadBuffer(f.bytes, f.filename, 'application/pdf');
    const up = db.prepare('INSERT INTO uploads (original_name, stored_name, mime_type, size, uploaded_by) VALUES (?, ?, ?, ?, ?)').run(f.filename, stored, 'application/pdf', f.bytes.length, req.user.id).lastInsertRowid;
    db.prepare('INSERT INTO record_attachments (module_slug, record_id, upload_id, tipo) VALUES (?, ?, ?, ?)').run(slug, id, up, 'import_ai');
  } catch (e) { console.error('[ai/import] allegato non salvato:', e.message); }
  try { fireTrigger(slug, 'nuovo_record', data, id, {}); } catch (e) { console.error('[ai/import] trigger:', e.message); }
  logAudit(req.user.username, 'ai.import', slug + '#' + id, { file: f.filename });
  res.json({ ok: true, id, stato: data[R.stato], message: 'Riga creata' + (decl.avvisi.states.nuovo ? ' in «' + decl.avvisi.states.nuovo.replace(/_/g, ' ') + '»' : '') + ', con il PDF allegato.' });
});

// ── Leggere una busta paga ───────────────────────────────────────────────────────
// 1) /proposta: legge il PDF (testo) o una foto dal rullino (visione) e propone periodo, lordo, netto, ore pagate e trattenute (non scrive niente).
// 2) /crea: registra la riga col file allegato. Solo con "Leggi busta paga" acceso sul modulo (Builder → Potenziamenti AI); serve il permesso di creare righe.
const payslipAi = require('../payslip-ai');
const { imageKind, MAX_IMMAGINE } = require('../../../../shared/ai-receipt.js');

function payslipFileFrom(body) {
  const b64 = String((body && body.base64) || '').replace(/^data:[^,]*,/, '');
  const bytes = Buffer.from(b64, 'base64');
  if (!bytes.length) return { error: 'Nessun file ricevuto.' };
  if (bytes.slice(0, 4).toString() === '%PDF') {
    if (bytes.length > MAX_PDF) return { error: 'Il PDF è troppo grande (massimo 3 MB).' };
    return { bytes, mime: 'application/pdf', filename: String((body && body.filename) || 'busta-paga.pdf').replace(/[^\w.\- ]/g, '_').slice(0, 100) };
  }
  const mime = imageKind(bytes);
  if (mime) {
    if (bytes.length > MAX_IMMAGINE) return { error: 'L\'immagine è troppo grande (massimo 3 MB).' };
    const ext = mime === 'image/png' ? '.png' : mime === 'image/webp' ? '.webp' : '.jpg';
    return { bytes, mime, filename: String((body && body.filename) || ('busta-paga' + ext)).replace(/[^\w.\- ]/g, '_').slice(0, 100) };
  }
  return { error: 'Il file deve essere un PDF o una foto (JPEG, PNG, WebP).' };
}

router.post('/payslip/:slug/proposta', requireAuth, async (req, res) => {
  const slug = req.params.slug;
  if (!moduleAi.can(slug, 'payslip')) return res.status(403).json({ error: 'La lettura della busta paga non è accesa su questo modulo.', code: 'ai_off' });
  if (!canCreate(slug, req.user)) return res.status(403).json({ error: 'Non hai il permesso di creare righe in questo modulo.' });
  const f = payslipFileFrom(req.body); if (f.error) return res.status(400).json({ error: f.error });
  const out = f.mime === 'application/pdf'
    ? await payslipAi.proposeFromPayslip({ moduleSlug: slug, filename: f.filename, bytes: f.bytes })
    : await payslipAi.proposeFromPayslipPhoto({ moduleSlug: slug, bytes: f.bytes, mime: f.mime });
  if (out.error) return res.status(out.status === 429 ? 429 : out.status === 422 ? 422 : out.status === 403 ? 403 : 502).json({ error: out.error, code: out.code });
  res.json({ proposta: out.proposta });
});

router.post('/payslip/:slug/crea', requireAuth, async (req, res) => {
  const slug = req.params.slug;
  if (!moduleAi.can(slug, 'payslip')) return res.status(403).json({ error: 'La lettura della busta paga non è accesa su questo modulo.', code: 'ai_off' });
  if (!canCreate(slug, req.user)) return res.status(403).json({ error: 'Non hai il permesso di creare righe in questo modulo.' });
  const f = payslipFileFrom(req.body); if (f.error) return res.status(400).json({ error: f.error });
  const decl = moduleRoles.get(slug), R = decl.roles, c = (req.body && req.body.campi) || {};
  const ISO = /^\d{4}-\d{2}-\d{2}$/;
  if (!R.data || !R.netto || !R.ore_pagate) return res.status(400).json({ error: 'Il modulo non ha dichiarato periodo, netto e ore pagate (Builder → Ruoli del modulo).' });
  if (!c.data || !ISO.test(c.data)) return res.status(400).json({ error: 'Periodo non valido.' });
  const netto = Number(c.netto), ore = Number(c.ore_pagate);
  if (!(netto >= 0)) return res.status(400).json({ error: 'Netto non valido.' });
  if (!(ore >= 0)) return res.status(400).json({ error: 'Ore pagate non valide.' });
  const data = { note: 'Importato: ' + f.filename, [R.data]: c.data, [R.netto]: Math.round(netto * 100) / 100, [R.ore_pagate]: Math.round(ore * 100) / 100 };
  if (R.lordo && c.lordo != null && c.lordo !== '') { const l = Number(c.lordo); if (l >= 0) data[R.lordo] = Math.round(l * 100) / 100; }
  if (R.trattenute && c.trattenute != null && c.trattenute !== '') { const t = Number(c.trattenute); if (t >= 0) data[R.trattenute] = Math.round(t * 100) / 100; }
  const id = db.prepare('INSERT INTO records (module_slug, user_id, data) VALUES (?, ?, ?)').run(slug, req.user.id, JSON.stringify(data)).lastInsertRowid;
  try {
    const stored = await saveUploadBuffer(f.bytes, f.filename, f.mime);
    const up = db.prepare('INSERT INTO uploads (original_name, stored_name, mime_type, size, uploaded_by) VALUES (?, ?, ?, ?, ?)').run(f.filename, stored, f.mime, f.bytes.length, req.user.id).lastInsertRowid;
    db.prepare('INSERT INTO record_attachments (module_slug, record_id, upload_id, tipo) VALUES (?, ?, ?, ?)').run(slug, id, up, 'import_ai');
  } catch (e) { console.error('[ai/payslip] allegato non salvato:', e.message); }
  try { fireTrigger(slug, 'nuovo_record', data, id, {}); } catch (e) { console.error('[ai/payslip] trigger:', e.message); }
  logAudit(req.user.username, 'ai.payslip', slug + '#' + id, { file: f.filename });
  res.json({ ok: true, id, message: 'Busta paga registrata, con il documento allegato.' });
});

module.exports = router;
