'use strict';
// Bot Telegram: domande sulla busta paga ("ferie residue", "quante ore ho fatto a ottobre", "la mia
// ultima busta paga", "che buste paga mancano", o una domanda libera sul dettaglio — risolta con
// l'AI sul testo del cedolino). Un modulo con kind:'bustapaga' (ruoli data/netto/ore_pagate) più un
// campo "proprietario" (non un ruolo: solo un campo select del modulo, es. Nima/Federica) per sapere
// di CHI sono i cedolini quando chi scrive dice "la mia" — più persone possono avere buste paga nello
// stesso modulo (datori di lavoro diversi), senza che l'una veda per sbaglio quelle dell'altra come sue.
const db = require('./db');
const moduleRoles = require('./module-roles');
const { esc, eur } = require('./bot-ai');
const { signTenantRequest } = require('./lib/tenant-request-token');

const SUPER_ADMIN_URL = process.env.SUPER_ADMIN_URL || 'http://super-admin-backend:3000';
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET || 'changeme_internal';
const MESI = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];

function modulo() {
  const m = moduleRoles.list({ kind: 'bustapaga' }).find((x) => x.roles.data && x.roles.netto && x.roles.ore_pagate);
  return m ? { slug: m.module_slug, nome: m.name || m.module_slug, R: m.roles } : null;
}
function haBustaPaga(user) {
  const m = modulo();
  if (!m) return false;
  const vis = new Set(require('./routes/modules').visibleSlugsFor(user));
  return vis.has(m.slug);
}

// Il valore del campo "proprietario" che corrisponde a chi scrive: il modulo lo dichiara come select
// (es. ["Nima","Federica"]) — qui si cerca solo una corrispondenza col nome di chi è collegato,
// senza assumere un valore fisso (progetti diversi avranno persone diverse).
function proprietarioDi(user, m) {
  const schema = require('./schema-v3').parseSchemaNormalized(db.prepare('SELECT schema_json FROM modules WHERE slug = ?').get(m.slug).schema_json);
  const campo = (schema.fields || []).find((f) => f.key === 'proprietario');
  const opzioni = campo && Array.isArray(campo.options) ? campo.options.map((o) => (typeof o === 'string' ? o : o.value)) : [];
  const nome = String(user.display_name || user.username || '').trim().toLowerCase();
  return opzioni.find((o) => String(o).trim().toLowerCase() === nome) || null;
}

// Le buste paga di questo utente (quelle col suo "proprietario", o tutte se il campo non è dichiarato
// o non riesce a riconoscersi — meglio mostrare troppo che un "non ho trovato niente" ingannevole).
function righeDi(user, m) {
  const { rows } = require('./reports');
  const scope = require('./telegram').scopeFor(user);
  const chi = proprietarioDi(user, m);
  const tutte = rows(m.slug, scope);
  const mie = chi ? tutte.filter((r) => r.data.proprietario === chi) : tutte;
  return (mie.length ? mie : tutte).sort((a, b) => String(b.data[m.R.data] || '').localeCompare(String(a.data[m.R.data] || '')));
}

function trovaRecord(user, m, periodo) {
  const righe = righeDi(user, m);
  if (!righe.length) return null;
  if (!periodo || periodo === 'ultima') return righe[0];
  return righe.find((r) => String(r.data[m.R.data] || '').slice(0, 7) === periodo) || null;
}

function meseLabel(periodoIso) {
  const [aaaa, mm] = String(periodoIso || '').split('-');
  const i = parseInt(mm, 10) - 1;
  return MESI[i] ? MESI[i] + ' ' + aaaa : periodoIso;
}

// Mesi senza una busta paga di questo utente, tra la prima e l'ultima che ha (non prima: non è detto
// lavorasse già; non dopo oggi).
function mancanti(user, m) {
  const righe = righeDi(user, m);
  if (righe.length < 2) return [];
  const periodi = new Set(righe.map((r) => String(r.data[m.R.data] || '').slice(0, 7)));
  const date = [...periodi].sort();
  const oggi = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome' }).format(new Date()).slice(0, 7);
  const fine = date[date.length - 1] < oggi ? date[date.length - 1] : oggi;
  const out = [];
  let [y, mo] = date[0].split('-').map(Number);
  const [ey, emo] = fine.split('-').map(Number);
  while (y < ey || (y === ey && mo <= emo)) {
    const key = y + '-' + String(mo).padStart(2, '0');
    if (!periodi.has(key)) out.push(key);
    mo++; if (mo > 12) { mo = 1; y++; }
  }
  return out;
}

// Il modulo di presenze (timbrature): stessa ricerca generica di bot-timbrature.js, per il confronto
// ore busta paga / ore timbrate — nessun nome di modulo scritto qui.
function moduloTimbrature() {
  return moduleRoles.list({ kind: 'presenze' }).find((x) => x.roles.data && x.roles.inizio && x.roles.fine) || null;
}

// Il vero utente dietro un nome scritto nel campo "proprietario" di una busta paga
// (es. "Federica") — serve a righeOre sotto per confrontare OGNI riga con le
// timbrature di CHI QUELLA riga riguarda davvero, non con quelle di chi sta
// guardando. Bug reale trovato il 25/10/2026: chi guarda più persone insieme
// (righeDi senza corrispondenza, es. l'admin) vedeva lo stesso numero di ore
// timbrate ripetuto identico su righe di persone diverse, perché il confronto
// usava sempre le timbrature di chi guardava, mai quelle della riga.
function utentePerNome(nome) {
  if (!nome) return null;
  return db.prepare('SELECT * FROM users WHERE LOWER(display_name) = LOWER(?) OR LOWER(username) = LOWER(?)').get(nome, nome) || null;
}
// Ore timbrate da questo utente nel mese `periodoIso` (AAAA-MM), in ore decimali — null se non ha
// un modulo di presenze o non ha mai timbrato quel mese (per non confondere "zero ore" con "non timbra").
// Filtra per user_id DIRETTAMENTE (non la visibilità del modulo, che è un'altra cosa): qui serve
// sempre e solo "quello che questa persona ha timbrato", anche se il modulo non ha "solo propri"
// configurato — altrimenti le ore di tutti finirebbero mescolate nel confronto di ciascuno.
function oreTimbrateMese(user, periodoIso) {
  const mt = moduloTimbrature(); if (!mt) return null;
  const righe = db.prepare('SELECT data FROM records WHERE module_slug = ? AND user_id = ?').all(mt.module_slug, user.id).map((r) => ({ d: JSON.parse(r.data) }));
  if (!righe.length) return null;
  const [anno, mese] = periodoIso.split('-').map(Number);
  const out = require('./ore-calc').mensile(righe, mt.roles, anno, mese, Infinity);
  return out.giorni ? Math.round((out.totale / 60) * 100) / 100 : null;
}

// Riga per riga, busta paga contro timbrature: ore pagate sul cedolino, ore davvero timbrate quel
// mese, e la differenza — per vedere a colpo d'occhio se i conteggi tornano. Dati nudi (nessun
// testo/HTML): usati sia dal bot (reportOre, sotto) sia dalla rotta REST per la vista nell'app
// (routes/busta-paga-report.js), stessa logica, due presentazioni.
function righeOre(user, m, n = 12) {
  const righe = righeDi(user, m).slice(0, n); // già ordinate dal più recente
  const mt = moduloTimbrature();
  const righeTabella = righe.map((r) => {
    const periodo = String(r.data[m.R.data] || '').slice(0, 7);
    const pagate = r.data[m.R.ore_pagate];
    // Le timbrature sono SEMPRE di chi dice "proprietario" sulla riga, non di chi
    // guarda: quando righeDi mostra più persone insieme (nessuna corrispondenza per
    // chi guarda), ogni riga va confrontata con le ore di quella persona, mai con
    // quelle di chi sta chiedendo.
    const utenteRiga = utentePerNome(r.data.proprietario) || user;
    const timbrate = mt ? oreTimbrateMese(utenteRiga, periodo) : null;
    const diff = pagate != null && timbrate != null ? Math.round((timbrate - pagate) * 100) / 100 : null;
    return { periodo, label: r.data.periodo_label || meseLabel(periodo), proprietario: r.data.proprietario || null, pagate, timbrate, diff };
  });
  return { ha_timbrature: !!mt, righe: righeTabella };
}

// Riga per riga, busta paga contro timbrature: ore pagate sul cedolino, ore davvero timbrate quel
// mese, e la differenza — per vedere a colpo d'occhio se i conteggi tornano. Solo gli ultimi `n` mesi
// (un messaggio Telegram ha un limite di lunghezza; per il resto si chiede un mese alla volta).
function reportOre(user, m, n = 12) {
  const { ha_timbrature, righe } = righeOre(user, m, n);
  if (!righe.length) return { html: 'Non ho nessuna busta paga archiviata.' };
  // Più di una persona tra le righe (chi guarda non corrisponde a nessun
  // "proprietario": vede tutti insieme, vedi righeDi) -> ogni riga dice anche di
  // chi è, altrimenti due mesi uguali di persone diverse sembrano un doppione.
  const piuPersone = new Set(righe.map((r) => r.proprietario).filter(Boolean)).size > 1;
  const riga = (r) => esc(r.label) + (piuPersone && r.proprietario ? ' (' + esc(r.proprietario) + ')' : '') + ': ' + (r.pagate != null ? r.pagate + 'h pagate' : '— pagate')
    + (r.timbrate != null ? ', ' + r.timbrate + 'h timbrate' : ha_timbrature ? ', nessuna timbratura' : '')
    + (r.diff != null && Math.abs(r.diff) >= 0.5 ? ' <b>(Δ ' + (r.diff > 0 ? '+' : '') + r.diff + 'h)</b>' : r.diff != null ? ' (torna)' : '');
  const html = '📄 <b>Ore pagate vs timbrate</b> (' + 'ultimi ' + righe.length + ' mesi' + ')\n' + righe.map(riga).join('\n')
    + (ha_timbrature ? '' : '\n\n<i>Non hai un modulo di timbrature: mostro solo le ore pagate.</i>');
  return { html };
}

// Gli ultimi saldi (ferie, permessi, ROL) insieme, dall'ultima busta paga che li ha letti — una busta
// paga recente potrebbe non averli (es. il datore non li scrive più in busta): si prende l'ultimo valore
// NON nullo di ciascuno, non necessariamente dalla stessa riga. Dati nudi, stesso riuso di righeOre sopra.
function datiSaldi(user, m) {
  const righe = righeDi(user, m);
  const trova = (campo) => { for (const r of righe) { if (r.data[campo] != null) return { valore: r.data[campo], label: r.data.periodo_label || meseLabel(String(r.data[m.R.data] || '').slice(0, 7)) }; } return null; };
  return { ferie: trova('ferie_saldo'), permessi: trova('permessi_saldo'), rol: trova('rol_saldo') };
}

function ultimiSaldi(user, m) {
  const { ferie, permessi, rol } = datiSaldi(user, m);
  if (!ferie && !permessi && !rol) return { html: 'Non ho nessun saldo ferie/permessi/ROL letto dalle tue buste paga.' };
  const riga = (nome, v) => v ? '• ' + nome + ': <b>' + v.valore + '</b> (da ' + esc(v.label) + ')' : null;
  const html = '📄 <b>Ferie, permessi e ROL residui</b>\n' + [riga('Ferie', ferie), riga('Permessi/ex-festività', permessi), riga('ROL/banca ore', rol)].filter(Boolean).join('\n');
  return { html };
}

async function spiega(domanda, record, m) {
  const d = record.data;
  try {
    const res = await fetch(SUPER_ADMIN_URL + '/api/tenant-ai/payslip-explain', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-secret': INTERNAL_SECRET, 'Authorization': 'Bearer ' + signTenantRequest('tenant-ai') },
      body: JSON.stringify({ tenant_slug: process.env.TENANT_SLUG, data: {
        domanda, periodo_label: d.periodo_label || meseLabel(d[m.R.data]),
        netto: d[m.R.netto], lordo: d[m.R.lordo], ore_pagate: d[m.R.ore_pagate], trattenute: d[m.R.trattenute],
        ferie_saldo: d.ferie_saldo, permessi_saldo: d.permessi_saldo, rol_saldo: d.rol_saldo, voci: d.voci,
      } }),
      signal: AbortSignal.timeout(30000),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { error: body.error || 'Non riesco a rispondere.' };
    return { text: body.text };
  } catch (e) { return { error: 'L\'AI non è raggiungibile.' }; }
}

// Scarica il file allegato a un record tramite le rotte dell'app (come quell'utente: stessi permessi),
// mai leggendo lo storage direttamente — unico punto che sa come un upload è salvato (disco o Drive).
async function allegato(user, slug, recordId) {
  const { callAs } = require('./lib/internal-api');
  const att = await callAs(user, 'GET', '/records/' + slug + '/' + recordId + '/attachments');
  if (!att.ok || !Array.isArray(att.data) || !att.data.length) return null;
  const up = att.data[0];
  const jwt = require('jsonwebtoken');
  const token = jwt.sign({ id: user.id, username: user.username, role: user.role, display_name: user.display_name }, process.env.JWT_SECRET || 'changeme', { expiresIn: '2m' });
  const res = await fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/uploads/' + up.upload_id, { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) return null;
  const bytes = Buffer.from(await res.arrayBuffer());
  return { bytes, filename: up.original_name, mime: up.mime_type };
}

async function rispondi(user, intent, chatId) {
  const m = modulo();
  if (!m) return { html: 'Non hai un modulo di buste paga a cui il bot possa lavorare.' };
  if (intent.campo === 'mancanti') {
    const miss = mancanti(user, m);
    if (!miss.length) return { html: '✅ Nessun buco: hai tutte le buste paga tra la prima e l\'ultima archiviata.' };
    return { html: '📄 Mancano queste buste paga:\n' + miss.map((p) => '• ' + esc(meseLabel(p))).join('\n') };
  }
  if (intent.campo === 'report_ore') return reportOre(user, m);
  if (intent.campo === 'saldi') return ultimiSaldi(user, m);
  const record = trovaRecord(user, m, intent.periodo);
  if (!record) return { html: intent.periodo && intent.periodo !== 'ultima' ? 'Non ho trovato la busta paga di quel mese.' : 'Non ho nessuna busta paga archiviata.' };
  const d = record.data, label = d.periodo_label || meseLabel(d[m.R.data]);

  const campo = intent.campo;
  if (campo === 'ferie_saldo' || campo === 'permessi_saldo' || campo === 'rol_saldo') {
    const nomi = { ferie_saldo: 'Ferie residue', permessi_saldo: 'Permessi/ex-festività residui', rol_saldo: 'ROL/banca ore residui' };
    if (d[campo] == null) return { html: nomi[campo] + ': non le ho lette da questa busta (' + esc(label) + ').' };
    return { html: '📄 ' + nomi[campo] + ' (' + esc(label) + '): <b>' + d[campo] + '</b>' };
  }
  if (campo === 'ore_pagate' || campo === 'netto' || campo === 'lordo' || campo === 'trattenute') {
    const v = d[m.R[campo]];
    if (v == null) return { html: 'Non ho questo dato per ' + esc(label) + '.' };
    const nomi = { ore_pagate: 'Ore pagate', netto: 'Netto', lordo: 'Lordo', trattenute: 'Trattenute' };
    return { html: '📄 ' + nomi[campo] + ' (' + esc(label) + '): <b>' + (campo === 'ore_pagate' ? v : eur(v)) + '</b>' };
  }
  if (campo === 'spiega') {
    const r = await spiega(intent.domanda, record, m);
    if (r.error) return { html: '⚠ ' + esc(r.error) };
    return { html: '📄 <b>' + esc(label) + '</b>\n\n' + esc(r.text) };
  }

  // 'tutto': riepilogo + il file allegato, se c'è
  const righe = [
    d[m.R.netto] != null ? '• netto ' + eur(d[m.R.netto]) : null,
    d[m.R.lordo] != null ? '• lordo ' + eur(d[m.R.lordo]) : null,
    d[m.R.ore_pagate] != null ? '• ore pagate ' + d[m.R.ore_pagate] : null,
    d.ferie_saldo != null ? '• ferie residue ' + d.ferie_saldo : null,
    d.permessi_saldo != null ? '• permessi residui ' + d.permessi_saldo : null,
    d.rol_saldo != null ? '• ROL residui ' + d.rol_saldo : null,
  ].filter(Boolean);
  const html = '📄 <b>' + esc(label) + '</b>' + (d.datore_lavoro ? ' (' + esc(d.datore_lavoro) + ')' : '') + '\n' + righe.join('\n');
  try {
    const f = await allegato(user, m.slug, record.id);
    if (f) { await require('./telegram').sendDocument(chatId, f.bytes, f.filename, f.mime, html); return { html: '', giaInviato: true }; }
  } catch (e) { /* manda comunque il testo */ }
  return { html: html + '\n\n<i>(nessun file allegato)</i>' };
}

module.exports = { haBustaPaga, rispondi, modulo, righeOre, datiSaldi };
