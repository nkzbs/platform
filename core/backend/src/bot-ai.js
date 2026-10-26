'use strict';
// Bot Telegram: capire le frasi libere. Una frase va a Super Admin (che la traduce in UNA azione di un elenco chiuso, con budget e dati personali oscurati) e torna un
// intento che qui si RIVALIDA con le stesse regole (shared/ai-bot-intent.js). Al modello non arriva nessun record, nessun id: solo la frase e i moduli di spesa.
// Le domande sui dati usano la stessa strada di «Chiedi ai dati» (query strutturata, mai SQL), con i permessi di chi chiede.
const db = require('./db');
const moduleRoles = require('./module-roles');
const moduleAi = require('./module-ai');
const askData = require('./ask-data');
const { validateIntent } = require('../../../shared/ai-bot-intent.js');
const { validateReceipt } = require('../../../shared/ai-receipt.js');
const { signTenantRequest } = require('./lib/tenant-request-token');
const { logAudit } = require('./audit-log');

const SUPER_ADMIN_URL = process.env.SUPER_ADMIN_URL || 'http://super-admin-backend:3000';
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET || 'changeme_internal';
const esc = (t) => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const eur = (n) => Number(n || 0).toLocaleString('it-IT', { useGrouping: 'always', minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';

function visibleSlugs(user) { return new Set(require('./routes/modules').visibleSlugsFor(user)); }

// Valori ammessi (options) del campo che ha questo ruolo in questo modulo, o [] se il ruolo non è
// dichiarato o il campo non è un select — stesso bisogno già ripetuto per categoria, ora anche per gruppo.
function opzioniCampo(moduleSlug, campo) {
  if (!campo) return [];
  try {
    const f = (require('./schema-v3').parseSchemaNormalized(db.prepare('SELECT schema_json FROM modules WHERE slug = ?').get(moduleSlug).schema_json).fields || []).find((x) => x.key === campo);
    return f && Array.isArray(f.options) ? f.options.map((o) => (typeof o === 'string' ? o : o.value)).filter(Boolean) : [];
  } catch (e) { return []; }
}

// I moduli di spesa che QUESTO utente vede e che hanno dichiarato gli avvisi (con le categorie ammesse).
function moduliPerUtente(user) {
  const vis = visibleSlugs(user);
  return moduleRoles.list({ use: 'avvisi' }).filter((m) => m.kind === 'spesa' && vis.has(m.module_slug)).map((m) => ({
    slug: m.module_slug, name: m.name || m.module_slug, etichetta: m.avvisi.label || String(m.name || m.module_slug).toLowerCase(),
    categorie: opzioniCampo(m.module_slug, m.roles.categoria), decl: m,
  }));
}

// I moduli di entrata che QUESTO utente vede (es. "mi è arrivato lo stipendio", "ho versato 500
// alla casa") — stesso principio di moduliPerUtente, con in più i "gruppi" se il modulo li ha
// dichiarati (campo ruolo "gruppo", es. Casa/Personale: v. Impostazioni → Moduli → Ruoli).
function entrataModuliPerUtente(user) {
  const vis = visibleSlugs(user);
  return moduleRoles.list({ kind: 'entrata' }).filter((m) => vis.has(m.module_slug)).map((m) => ({
    slug: m.module_slug, name: m.name || m.module_slug,
    categorie: opzioniCampo(m.module_slug, m.roles.categoria),
    gruppi: opzioniCampo(m.module_slug, m.roles.gruppo),
    decl: m,
  }));
}

async function viaSuperAdmin(path, data, timeoutMs = 30000) {
  try {
    const r = await fetch(SUPER_ADMIN_URL + '/api/tenant-ai/' + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_SECRET, 'Authorization': 'Bearer ' + signTenantRequest('tenant-ai') },
      body: JSON.stringify({ tenant_slug: process.env.TENANT_SLUG, data }), signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) return { error: body.error || 'L\'AI non è disponibile in questo momento.', code: body.code || (r.status === 429 ? 'ai_limit' : r.status === 422 ? 'ai_unanswerable' : 'ai_down') };
    return { body };
  } catch (e) { return { error: 'L\'AI non è raggiungibile.', code: 'ai_down' }; }
}

// Una frase libera → intento validato { azione, … } oppure { error, code }. `storico` (facoltativo,
// vedi bot-memory.js): l'ultimo scambio di questa chat, così una frase vaga ("e il mese scorso?")
// che da sola sarebbe "altro" si riconosce ancora come il seguito di una domanda.
async function interpret(frase, user, now = new Date(), storico = null) {
  if (!moduleAi.masterOn()) return { error: 'L\'AI non è accesa (Impostazioni → AI).', code: 'ai_off' };
  const moduli = moduliPerUtente(user).map((m) => ({ slug: m.slug, name: m.name, etichetta: m.etichetta, categorie: m.categorie }));
  const moduliEntrata = entrataModuliPerUtente(user).map((m) => ({ slug: m.slug, name: m.name, categorie: m.categorie, gruppi: m.gruppi }));
  const timbrature = require('./bot-timbrature').haPresenze(user);
  const bustaPaga = require('./bot-payslip').haBustaPaga(user);
  const debitoCasa = require('./debito-casa').attivo();
  if (!moduli.length && !moduliEntrata.length && !timbrature && !bustaPaga && !debitoCasa) return { error: 'Non hai moduli a cui il bot possa lavorare.', code: 'no_modules' };
  const oggi = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome' }).format(now);
  const report = require('./reports').settings().definizioni.filter((d) => d.enabled).map((d) => ({ id: d.id, nome: d.nome }));
  const r = await viaSuperAdmin('bot-intent', { frase, oggi, timbrature, busta_paga: bustaPaga, debito_casa: debitoCasa, report, moduli, moduli_entrata: moduliEntrata, storico });
  if (r.error) return r;
  const v = validateIntent(r.body && r.body.intent, moduli, oggi, report.map((x) => x.id), moduliEntrata); // rivalidato qui, con le stesse regole
  if (v.intent && (v.intent.azione === 'timbra' || v.intent.azione === 'ore') && !timbrature) return { error: 'Non hai timbrature.', code: 'ai_unanswerable' };
  if (v.intent && v.intent.azione === 'nuova_entrata' && !moduliEntrata.length) return { error: 'Non hai moduli di entrata.', code: 'ai_unanswerable' };
  if (v.intent && v.intent.azione === 'busta_paga' && !bustaPaga) return { error: 'Non hai buste paga.', code: 'ai_unanswerable' };
  if (v.intent && v.intent.azione === 'debito_casa' && !debitoCasa) return { error: 'Non c\'è ancora nessun contributo registrato.', code: 'ai_unanswerable' };
  if (v.error) return { error: v.error, code: 'ai_unanswerable' };
  return { intent: v.intent };
}

// «Chiedi ai dati» per il bot: ritorna { html, capito } oppure { error }. `capito` (la stessa frase
// leggibile già mostrata nella risposta) è quello che telegram.js salva in bot-memory.js per il
// prossimo giro — così "e il mese scorso?" sa a cosa si riferisce "e".
async function ask(domanda, user, now = new Date(), storico = null) {
  if (!moduleAi.masterOn()) return { error: 'L\'AI non è accesa (Impostazioni → AI).', code: 'ai_off' };
  const vis = visibleSlugs(user);
  const cat = askData.catalogo().filter((m) => vis.has(m.slug)); // solo i moduli che questo utente vede
  if (!cat.length) return { error: 'Non ci sono dati che tu possa interrogare.' };
  const r = await viaSuperAdmin('ask-data', { domanda, oggi: now.toISOString().slice(0, 10), catalogo: cat, storico });
  if (r.error) return r;
  const v = askData.validate(r.body && r.body.query, cat);
  if (v.error) return { error: v.error, code: 'ai_unanswerable' };
  const nome = (cat.find((m) => m.slug === v.query.modulo) || {}).name || v.query.modulo;
  const out = askData.run(v.query, user, now);
  logAudit(user.username, 'ai.ask', v.query.modulo, { calcolo: v.query.calcolo, via: 'bot' });
  const fmt = (x) => (v.query.calcolo === 'conteggio' ? String(x) : eur(x));
  const capito = askData.leggibile(v.query, nome).join(' · ');
  const pctTxt = (n) => (n == null ? 'non calcolabile (prima non c\'era niente)' : (n > 0 ? '+' : '') + n.toLocaleString('it-IT', { maximumFractionDigits: 1 }) + '%');

  let corpo;
  if (v.query.calcolo === 'confronto') {
    corpo = 'Ora: <b>' + eur(out.totale) + '</b>\nPrima: ' + eur(out.totale_precedente) + '\nVariazione: <b>' + pctTxt(out.variazione_pct) + '</b>';
  } else if (v.query.calcolo === 'proiezione') {
    corpo = 'Finora: <b>' + eur(out.totale) + '</b> (' + out.giorni_trascorsi + ' di ' + out.giorni_totali + ' giorni)'
      + '\nDi questo passo, a fine periodo: <b>' + (out.proiezione == null ? '—' : eur(out.proiezione)) + '</b>';
  } else {
    const righe = (out.righe || []).slice(0, 12).map((g) => '• ' + esc(g.etichetta) + ' — ' + fmt(g.valore) + (v.query.calcolo === 'somma' ? ' (' + g.n + ')' : ''));
    corpo = (out.n_righe ? 'Totale: <b>' + fmt(out.totale) + '</b> su ' + out.n_righe + (out.n_righe === 1 ? ' riga' : ' righe') : 'Nessuna riga corrisponde.')
      + (righe.length > 1 || (righe.length === 1 && v.query.raggruppa !== 'nessuno') ? '\n' + righe.join('\n') : '');
  }
  const html = '<b>' + esc(v.query.titolo || 'Risultato') + '</b>\n\n' + corpo
    + (out.esclusi_da_smistare ? '\n\n<i>Non contate: ' + out.esclusi_da_smistare + ' da smistare.</i>' : '')
    + '\n\n<i>Ho capito: ' + esc(capito) + '</i>';
  return { html, capito };
}

// Foto di uno scontrino → { ricevuta } validata (esercente, data, totale, categoria, confidenza) oppure { error, code }. L'immagine va a Super Admin e al modello solo in questo
// passaggio e non si salva lì; qui si rivalida con le stesse regole prima di proporre qualsiasi cosa.
async function leggiScontrino(base64, categorie, now = new Date()) {
  if (!moduleAi.masterOn()) return { error: 'L\'AI non è accesa (Impostazioni → AI).', code: 'ai_off' };
  const r = await viaSuperAdmin('receipt', { image_base64: base64, categorie }, 60000);
  if (r.error) return r;
  const oggi = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome' }).format(now);
  const v = validateReceipt(r.body && r.body.ricevuta ? { leggibile: true, ...r.body.ricevuta } : null, categorie, oggi);
  if (v.error) return { error: v.error, code: v.error === 'illeggibile' ? 'ai_unreadable' : 'ai_unanswerable' };
  return { ricevuta: v.ricevuta };
}

module.exports = { interpret, ask, leggiScontrino, moduliPerUtente, entrataModuliPerUtente, visibleSlugs, esc, eur };
