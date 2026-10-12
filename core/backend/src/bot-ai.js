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
const { logAudit } = require('./audit-log');

const SUPER_ADMIN_URL = process.env.SUPER_ADMIN_URL || 'http://super-admin-backend:3000';
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET || 'changeme_internal';
const esc = (t) => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const eur = (n) => Number(n || 0).toLocaleString('it-IT', { useGrouping: 'always', minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';

function visibleSlugs(user) { return new Set(require('./routes/modules').visibleSlugsFor(user)); }

// I moduli di spesa che QUESTO utente vede e che hanno dichiarato gli avvisi (con le categorie ammesse).
function moduliPerUtente(user) {
  const vis = visibleSlugs(user);
  return moduleRoles.list({ use: 'avvisi' }).filter((m) => m.kind === 'spesa' && vis.has(m.module_slug)).map((m) => {
    const campo = m.roles.categoria;
    let categorie = [];
    if (campo) {
      try {
        const f = (require('./schema-v3').parseSchemaNormalized(db.prepare('SELECT schema_json FROM modules WHERE slug = ?').get(m.module_slug).schema_json).fields || []).find((x) => x.key === campo);
        categorie = f && Array.isArray(f.options) ? f.options.map((o) => (typeof o === 'string' ? o : o.value)).filter(Boolean) : [];
      } catch (e) { categorie = []; }
    }
    return { slug: m.module_slug, name: m.name || m.module_slug, etichetta: m.avvisi.label || String(m.name || m.module_slug).toLowerCase(), categorie, decl: m };
  });
}

async function viaSuperAdmin(path, data, timeoutMs = 30000) {
  try {
    const r = await fetch(SUPER_ADMIN_URL + '/api/tenant-ai/' + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_SECRET },
      body: JSON.stringify({ tenant_slug: process.env.TENANT_SLUG, data }), signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) return { error: body.error || 'L\'AI non è disponibile in questo momento.', code: body.code || (r.status === 429 ? 'ai_limit' : r.status === 422 ? 'ai_unanswerable' : 'ai_down') };
    return { body };
  } catch (e) { return { error: 'L\'AI non è raggiungibile.', code: 'ai_down' }; }
}

// Una frase libera → intento validato { azione, … } oppure { error, code }.
async function interpret(frase, user, now = new Date()) {
  if (!moduleAi.masterOn()) return { error: 'L\'AI non è accesa (Impostazioni → AI).', code: 'ai_off' };
  const moduli = moduliPerUtente(user).map((m) => ({ slug: m.slug, name: m.name, etichetta: m.etichetta, categorie: m.categorie }));
  const timbrature = require('./bot-timbrature').haPresenze(user);
  if (!moduli.length && !timbrature) return { error: 'Non hai moduli a cui il bot possa lavorare.', code: 'no_modules' };
  const oggi = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome' }).format(now);
  const r = await viaSuperAdmin('bot-intent', { frase, oggi, timbrature, moduli });
  if (r.error) return r;
  const v = validateIntent(r.body && r.body.intent, moduli, oggi); // rivalidato qui, con le stesse regole
  if (v.intent && (v.intent.azione === 'timbra' || v.intent.azione === 'ore') && !timbrature) return { error: 'Non hai timbrature.', code: 'ai_unanswerable' };
  if (v.error) return { error: v.error, code: 'ai_unanswerable' };
  return { intent: v.intent };
}

// «Chiedi ai dati» per il bot: ritorna { html } oppure { error }.
async function ask(domanda, user, now = new Date()) {
  if (!moduleAi.masterOn()) return { error: 'L\'AI non è accesa (Impostazioni → AI).', code: 'ai_off' };
  const vis = visibleSlugs(user);
  const cat = askData.catalogo().filter((m) => vis.has(m.slug)); // solo i moduli che questo utente vede
  if (!cat.length) return { error: 'Non ci sono dati che tu possa interrogare.' };
  const r = await viaSuperAdmin('ask-data', { domanda, oggi: now.toISOString().slice(0, 10), catalogo: cat });
  if (r.error) return r;
  const v = askData.validate(r.body && r.body.query, cat);
  if (v.error) return { error: v.error, code: 'ai_unanswerable' };
  const nome = (cat.find((m) => m.slug === v.query.modulo) || {}).name || v.query.modulo;
  const out = askData.run(v.query, user);
  logAudit(user.username, 'ai.ask', v.query.modulo, { calcolo: v.query.calcolo, via: 'bot' });
  const fmt = (x) => (v.query.calcolo === 'conteggio' ? String(x) : eur(x));
  const righe = (out.righe || []).slice(0, 12).map((g) => '• ' + esc(g.etichetta) + ' — ' + fmt(g.valore) + (v.query.calcolo === 'somma' ? ' (' + g.n + ')' : ''));
  const html = '<b>' + esc(v.query.titolo || 'Risultato') + '</b>\n\n' + (out.n_righe ? 'Totale: <b>' + fmt(out.totale) + '</b> su ' + out.n_righe + (out.n_righe === 1 ? ' riga' : ' righe') : 'Nessuna riga corrisponde.')
    + (righe.length > 1 || (righe.length === 1 && v.query.raggruppa !== 'nessuno') ? '\n' + righe.join('\n') : '')
    + (out.esclusi_da_smistare ? '\n\n<i>Non contate: ' + out.esclusi_da_smistare + ' da smistare.</i>' : '')
    + '\n\n<i>Ho capito: ' + esc(askData.leggibile(v.query, nome).join(' · ')) + '</i>';
  return { html };
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

module.exports = { interpret, ask, leggiScontrino, moduliPerUtente, visibleSlugs, esc, eur };
