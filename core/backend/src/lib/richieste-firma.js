'use strict';
// RICHIESTA DI FIRMA: dal record si manda al cliente UN link con i documenti da firmare. Il cliente apre la pagina (senza account), scarica i PDF, li firma e ricarica la foto o la
// scansione, spunta i consensi; Platform allega i firmati nel tipo giusto, scrive consensi/data/versione sul record, passa allo stato previsto, avvisa l'agente e conferma al cliente.
// Dopo 3 e 7 giorni, se il cliente non ha firmato, parte un sollecito gentile; dopo 14 giorni la richiesta scade. Il testo di ogni documento si «congela» al momento dell'invio:
// il cliente firma esattamente ciò che ha ricevuto, anche se la scheda cambia dopo. Nessun nome di modulo o di campo scritto qui: i documenti sono i `document_action` con `delivery: 'firma'`.
// Il token (32 byte casuali) si vede UNA volta, nell'email: nel database resta solo l'impronta SHA-256.
const crypto = require('crypto');
const db = require('../db');

db.exec(`CREATE TABLE IF NOT EXISTS richieste_firma (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  module_slug TEXT NOT NULL,
  record_id INTEGER NOT NULL,
  destinatario TEXT NOT NULL,
  documenti TEXT NOT NULL,
  stato TEXT NOT NULL DEFAULT 'inviata',
  creata_il TEXT DEFAULT CURRENT_TIMESTAMP,
  scade_il TEXT NOT NULL,
  creata_da TEXT,
  link_base TEXT,
  solleciti INTEGER DEFAULT 0,
  ultimo_sollecito TEXT,
  firmata_il TEXT,
  firmata_ip TEXT,
  consensi TEXT,
  token_cifrato TEXT
)`);
for (const col of ['token_cifrato TEXT', 'modalita TEXT', 'esign_id TEXT', 'esign_tentativi INTEGER DEFAULT 0', 'esign_autenticazione TEXT']) {
  try { db.exec('ALTER TABLE richieste_firma ADD COLUMN ' + col); } catch (e) { /* già presente */ }
}
db.exec('CREATE INDEX IF NOT EXISTS idx_richieste_firma_record ON richieste_firma(module_slug, record_id)');

const GIORNI_VALIDITA = 14;
const GIORNI_SOLLECITI = [3, 7];
const { sealText, unsealText } = require('../secrets-at-rest');
const hash = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
const err = (message, status = 400) => Object.assign(new Error(message), { status });
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const GIORNO = 24 * 3600 * 1000;
const FILE_OK = (mime) => mime === 'application/pdf' || /^image\/(jpeg|png|webp)$/.test(mime || '');
const MAX_BYTE = 12 * 1024 * 1024;

const nomeDi = (dati) => { for (const k of ['nome', 'name', 'titolo', 'denominazione', 'ragione_sociale']) if (dati && typeof dati[k] === 'string' && dati[k].trim()) return dati[k].trim(); return ''; };
const primoNome = (n) => String(n || '').trim().split(/\s+/)[0] || '';
const agenzia = () => { try { return (db.prepare('SELECT ragione_sociale FROM tenant_settings WHERE id = 1').get() || {}).ragione_sociale || ''; } catch (e) { return ''; } };
const dettaglioScadenza = (scade) => { const g = Math.max(0, Math.ceil((Date.parse(scade) - Date.now()) / GIORNO)); return g === 1 ? 'scade domani' : 'scade tra ' + g + ' giorni'; };

// documenti = [{ key, label, corpo, consensi: [{ field, label }] }]: il corpo è il testo GIÀ riempito con i dati del record.
function crea({ slug, id, documenti, destinatario, utente, linkBase }) {
  if (!Array.isArray(documenti) || !documenti.length) throw err('Scegli almeno un documento da far firmare.');
  if (!EMAIL_RE.test(String(destinatario || ''))) throw err('Manca un indirizzo email valido a cui mandare i documenti.');
  if (!/^https:\/\/[^\s/]+$/.test(String(linkBase || ''))) throw err('Indirizzo del progetto non valido per il link di firma.');
  const token = crypto.randomBytes(32).toString('base64url');
  const scade = new Date(Date.now() + GIORNI_VALIDITA * GIORNO).toISOString();
  const rid = db.prepare('INSERT INTO richieste_firma (token_hash, module_slug, record_id, destinatario, documenti, scade_il, creata_da, link_base, token_cifrato) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(hash(token), slug, id, destinatario, JSON.stringify(documenti), scade, utente || null, linkBase, sealText(token)).lastInsertRowid;
  return { id: Number(rid), token, scade };
}

const riga = (token) => db.prepare('SELECT * FROM richieste_firma WHERE token_hash = ?').get(hash(token));
function motivoNonValida(r) {
  if (!r) return 'Questo link non esiste.';
  if (r.stato === 'annullata') return 'Questa richiesta è stata annullata: chiedi all\'agenzia di mandartene una nuova.';
  if (r.stato === 'firmata') return 'Hai già firmato questi documenti. Grazie!';
  if (r.stato === 'in_registrazione') return 'Stiamo registrando la tua firma: ricarica la pagina tra un momento.';
  if (r.stato === 'scaduta' || Date.parse(r.scade_il) < Date.now()) return 'Questo link è scaduto: chiedi all\'agenzia di mandartene uno nuovo.';
  return null;
}

// Per la pagina pubblica: solo ciò che serve al cliente. Mai l'id del record né dati del cliente oltre al nome.
async function pubblica(token) {
  const r = riga(token), motivo = motivoNonValida(r);
  const a = require('./email-grafica').identita();
  const agz = { nome: a.nome, colore: a.colore, logo: a.logo || null };
  if (motivo) return { valido: false, motivo, firmata: !!(r && r.stato === 'firmata'), agenzia: agz };
  const docs = JSON.parse(r.documenti);
  const codice = r.stato === 'in_firma' ? null : { disponibile: await codiceDisponibile(), sms: !!telefonoDi(r), tentativi_residui: Math.max(0, MAX_TENTATIVI_CODICE - (r.esign_tentativi || 0)) };
  return { valido: true, agenzia: agz, scade: r.scade_il, codice, in_firma: r.stato === 'in_firma' ? { metodo: r.esign_autenticazione === 'sms' ? 'SMS' : 'email' } : null, documenti: docs.map((d) => ({ key: d.key, label: d.label, consensi: (d.consensi || []).map((c) => ({ field: c.field, label: c.label || c.field })) })) };
}

async function pdf(token, key) {
  const r = riga(token); if (motivoNonValida(r)) throw err(motivoNonValida(r), 410);
  const d = JSON.parse(r.documenti).find((x) => x.key === key); if (!d) throw err('Documento non trovato.', 404);
  const identita = await require('./identita-pdf').caricaIdentita(db);
  return { nome: d.key + '.pdf', buffer: await require('./documento-pdf').creaPdf({ titolo: d.label || 'Documento', corpo: d.corpo, ...identita, riquadroFirma: true, piePagina: d.label || '', numero: new Date(r.creata_il.replace(' ', 'T') + 'Z').getUTCFullYear() + '-' + String(r.id).padStart(4, '0') }) };
}

function mittente(utente) {
  const u = utente && db.prepare('SELECT display_name, username FROM users WHERE username = ?').get(utente);
  return u ? { nome: u.display_name || u.username, ruolo: agenzia() } : null;
}

// L'email con il pulsante. Mai bloccante per chi chiama: ritorna { ok, motivo }.
async function mandaEmail(r, token, { sollecito = 0 } = {}) {
  const email = require('./email');
  const docs = JSON.parse(r.documenti);
  const dati = (() => { try { return JSON.parse(db.prepare('SELECT data FROM records WHERE id = ? AND module_slug = ?').get(r.record_id, r.module_slug).data); } catch (e) { return {}; } })();
  const ciao = primoNome(nomeDi(dati));
  const url = r.link_base + '/firma/' + token;
  const n = docs.length;
  const elenco = docs.map((d) => ({ nome: d.label, dettaglio: '' }));
  let oggetto, titolo, testo, nota;
  if (!sollecito) {
    oggetto = (n === 1 ? 'Un documento da firmare' : n + ' documenti da firmare') + (agenzia() ? ' — ' + agenzia() : '');
    titolo = (ciao ? 'Buongiorno ' + ciao + ', ' : 'Buongiorno, ') + (n === 1 ? 'c\'è un documento da firmare' : 'ci sono ' + n + ' documenti da firmare');
    testo = 'Per procedere ti chiediamo di rivedere e firmare ' + (n === 1 ? 'questo documento' : 'questi documenti') + '. Apri il link, scaricali, firmali e ricarica la foto o la scansione: ci vogliono pochi minuti, anche dal telefono.';
    nota = 'Il link è personale e ' + dettaglioScadenza(r.scade_il) + '.';
  } else {
    oggetto = 'Ti manca solo ' + (n === 1 ? 'una firma' : 'qualche firma') + (agenzia() ? ' — ' + agenzia() : '');
    titolo = (ciao ? ciao + ', ' : '') + (n === 1 ? 'il documento ti aspetta' : 'i documenti ti aspettano');
    testo = 'Ti abbiamo mandato ' + (n === 1 ? 'un documento' : n + ' documenti') + ' da firmare e sono ancora pronti. Ti bastano pochi minuti. Se preferisci, puoi anche rispondere a questa mail.';
    nota = 'Il link ' + dettaglioScadenza(r.scade_il) + '.';
  }
  const html = email.htmlDaTesto(testo, { titolo, elenco, pulsante: { testo: sollecito ? 'Riprendi da dove eri' : 'Rivedi e firma', url }, nota, firmaDa: mittente(r.creata_da) });
  return email.invia({ to: r.destinatario, subject: oggetto, html });
}

async function invia({ slug, id, documenti, destinatario, utente, linkBase }) {
  const c = crea({ slug, id, documenti, destinatario, utente, linkBase });
  const r = db.prepare('SELECT * FROM richieste_firma WHERE id = ?').get(c.id);
  const mail = await mandaEmail(r, c.token);
  if (!mail.ok) { db.prepare("UPDATE richieste_firma SET stato = 'annullata' WHERE id = ?").run(c.id); throw err('La mail non è partita: ' + mail.motivo, 502); }
  return { id: c.id, scade: c.scade, destinatario };
}

// ── Chiusura comune: i firmati (caricati dal cliente o scaricati da eSignature) vanno sul record ─────────────────────────────────────────────────────────
// Prende la richiesta in blocco (due chiusure insieme non allegano due volte) e scrive tutto o niente.
async function chiudi(r, { file, consensi, ip }) {
  const docs = JSON.parse(r.documenti);
  const preso = db.prepare("UPDATE richieste_firma SET stato = 'in_registrazione' WHERE id = ? AND stato IN ('inviata', 'in_firma')").run(r.id);
  if (!preso.changes) throw err('Questa richiesta è già stata completata.', 409);
  const records = require('../routes/records');
  const { saveUploadBuffer } = require('./upload-storage');
  const utente = { id: null, username: 'firma-link', role: 'admin' };
  try {
    for (const d of docs) {
      const ctx = records.contestoDocumentoDa(r.module_slug, r.record_id, d.key, null);
      if (ctx.errore) throw err(ctx.errore[1], ctx.errore[0]);
      const f = file[d.key];
      const stored = await saveUploadBuffer(f.buffer, f.nome || d.key + '.pdf', f.mime);
      const up = db.prepare('INSERT INTO uploads (original_name, stored_name, mime_type, size, uploaded_by) VALUES (?, ?, ?, ?, ?)').run(f.nome || d.key + '.pdf', stored, f.mime, f.buffer.length, null).lastInsertRowid;
      records.registraFirmato({ user: utente, slug: r.module_slug, id: r.record_id, ctx, uploadId: Number(up), consensi: (consensi && consensi[d.key]) || {} });
    }
  } catch (e) {
    db.prepare('UPDATE richieste_firma SET stato = ? WHERE id = ?').run(r.stato, r.id); // niente a metà: si può riprovare
    throw e;
  }
  db.prepare("UPDATE richieste_firma SET stato = 'firmata', firmata_il = ?, firmata_ip = ?, consensi = ? WHERE id = ?").run(new Date().toISOString(), String(ip || '').slice(0, 64), JSON.stringify(consensi || {}), r.id);
  const dati = (() => { try { return JSON.parse(db.prepare('SELECT data FROM records WHERE id = ? AND module_slug = ?').get(r.record_id, r.module_slug).data); } catch (e) { return {}; } })();
  const chi = nomeDi(dati) || ('scheda #' + r.record_id);
  try { db.prepare('INSERT INTO notifications (message, module_slug, record_id, roles, category) VALUES (?, ?, ?, ?, ?)').run(chi + ' ha firmato ' + (docs.length === 1 ? 'il documento' : docs.length + ' documenti') + ': i firmati sono tra gli allegati.', r.module_slug, r.record_id, '["admin"]', 'firma'); } catch (e) { /* l'avviso non blocca */ }
  require('../audit-log').logAudit('firma-link', 'firma.completata', r.module_slug + '#' + r.record_id, { richiesta: r.id, documenti: docs.map((d) => d.key), modalita: r.modalita || 'carta' });
  // conferma al cliente: mai bloccante
  try {
    const ciao = primoNome(nomeDi(dati));
    const quando = new Date().toLocaleString('it-IT', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
    await require('./email').invia({ to: r.destinatario, subject: 'Abbiamo ricevuto la tua firma' + (agenzia() ? ' — ' + agenzia() : ''), html: require('./email').htmlDaTesto('Abbiamo ricevuto i documenti firmati il ' + quando + '. Conserva questa mail: la tua firma è registrata.', { titolo: (ciao ? 'Grazie ' + ciao + ', ' : 'Grazie, ') + 'è tutto in ordine', elenco: docs.map((d) => ({ nome: d.label, dettaglio: 'firmato' })), firmaDa: mittente(r.creata_da) }) });
  } catch (e) { /* la firma è registrata comunque */ }
  return { ok: true, documenti: docs.length };
}

// Firma «a mano»: il cliente ha stampato, firmato e ricaricato un file per ogni documento. `file`: { key: { buffer, nome, mime } }, `consensi`: { key: { campo: bool } }.
async function completa(token, { file, consensi, ip }) {
  const r = riga(token), motivo = motivoNonValida(r); if (motivo) throw err(motivo, 410);
  if (r.stato === 'in_firma') throw err('Hai già avviato la firma con codice: completala dal messaggio che ti è arrivato.', 409);
  for (const d of JSON.parse(r.documenti)) {
    const f = file && file[d.key];
    if (!f || !f.buffer || !f.buffer.length) throw err('Manca il file firmato di «' + d.label + '».');
    if (!FILE_OK(f.mime)) throw err('«' + d.label + '»: il file firmato deve essere un PDF o una foto (JPEG, PNG, WebP).');
    if (f.buffer.length > MAX_BYTE) throw err('«' + d.label + '»: il file è troppo grande (massimo 12 MB).', 413);
  }
  return chiudi(r, { file, consensi, ip });
}

// ── Firma con codice (eSignature di OpenAPI.it): UN PDF con tutti i documenti, UN codice, UN firmato ───────────────────────────────────────────────────────
const MAX_TENTATIVI_CODICE = 2; // chi ha il link non può far partire richieste a pagamento all'infinito
const firmaElettronica = () => require('./azioni-esterne/firma_elettronica');
const codiceDisponibile = async () => { try { return (await firmaElettronica().disponibile()).ok === true; } catch (e) { return false; } };
const datiRecord = (r) => { try { return JSON.parse(db.prepare('SELECT data FROM records WHERE id = ? AND module_slug = ?').get(r.record_id, r.module_slug).data); } catch (e) { return {}; } };
const telefonoDi = (r) => { const d = datiRecord(r); const t = String(d.telefono || d.cellulare || d.mobile || '').replace(/[\s().-]/g, ''); if (!t) return ''; const m = t.startsWith('+') ? t : '+39' + t.replace(/^(00)?39/, '').replace(/^0+/, ''); return /^\+\d{8,15}$/.test(m) ? m : ''; };

async function avviaCodice(token, { consensi, autenticazione, ip }) {
  const r = riga(token), motivo = motivoNonValida(r); if (motivo) throw err(motivo, 410);
  if (r.stato !== 'inviata') throw err('La firma con codice è già stata avviata.', 409);
  if ((r.esign_tentativi || 0) >= MAX_TENTATIVI_CODICE) throw err('Hai già provato la firma con codice: usa la stampa, oppure chiedi all\'agenzia di mandarti un nuovo link.', 409);
  const disp = await firmaElettronica().disponibile();
  if (!disp.ok) throw err('La firma con codice non è disponibile in questo momento: usa la stampa.', 503);
  const auth = autenticazione === 'sms' ? 'sms' : 'email';
  const dati = datiRecord(r); const completo = nomeDi(dati); const parti = completo.split(/\s+/); const name = parti.shift() || ''; const surname = parti.join(' ');
  if (!name || !surname) throw err('Per la firma con codice servono nome e cognome nella scheda: usa la stampa, oppure chiedi all\'agenzia.', 409);
  const mobile = auth === 'sms' ? telefonoDi(r) : '';
  if (auth === 'sms' && !mobile) throw err('Per il codice via SMS manca un numero di cellulare valido nella scheda: scegli la mail.', 409);
  const identita = await require('./identita-pdf').caricaIdentita(db);
  const numero = new Date(r.creata_il.replace(' ', 'T') + 'Z').getUTCFullYear() + '-' + String(r.id).padStart(4, '0');
  const docs = JSON.parse(r.documenti);
  const pk = await require('./documento-pdf').creaPdfPacchetto({ documenti: docs.map((d) => ({ titolo: d.label, corpo: d.corpo })), ...identita, numero });
  const corpo = {
    title: ('Documenti da firmare' + (agenzia() ? ' — ' + agenzia() : '')).slice(0, 120),
    signers: [{ name, surname, ...(auth === 'email' ? { email: r.destinatario } : { mobile }), authentication: [auth], signatures: [{ page: pk.pagine, x: 60, y: 60 }] }],
    inputDocuments: [{ sourceType: 'base64', payload: pk.buffer.toString('base64') }],
    options: { signatureMode: ['drawn', 'typed'] },
  };
  if (corpo.inputDocuments[0].payload.length > 11 * 1024 * 1024) throw err('I documenti sono troppo grandi per la firma con codice: usa la stampa.', 413);
  db.prepare('UPDATE richieste_firma SET esign_tentativi = esign_tentativi + 1 WHERE id = ?').run(r.id); // si conta PRIMA della chiamata a pagamento
  const res = await require('./openapi-it').chiama({ dominio: 'esignature', metodo: 'POST', percorso: '/EU-SES', corpo, scopi: [['POST', '/EU-SES'], ['GET', '/signatures']], timeout: 60000 });
  const sid = res && res.data && res.data.id; if (!sid) throw err('Il servizio di firma non ha risposto come previsto: usa la stampa.', 502);
  db.prepare("UPDATE richieste_firma SET stato = 'in_firma', modalita = 'codice', esign_id = ?, esign_autenticazione = ?, consensi = ? WHERE id = ?").run(String(sid), auth, JSON.stringify(consensi || {}), r.id);
  try { const spese = require('./openapi-spese'); spese.registra({ servizio: 'esignature_ses', descrizione: 'Firma con codice · richiesta ' + r.id, costo: spese.prezzo('esignature_ses') || 0, utente: 'firma-link', riferimento: String(sid) }); } catch (e) { /* il registro spese non blocca */ }
  require('../audit-log').logAudit('firma-link', 'firma.codice_avviato', r.module_slug + '#' + r.record_id, { richiesta: r.id, autenticazione: auth, esign_id: String(sid) });
  return { ok: true, metodo: auth === 'sms' ? 'SMS' : 'email' };
}

// Ricontrolla una firma con codice: se è completa scarica il firmato e chiude; se è fallita o annullata la richiesta torna disponibile (un altro tentativo, se ce n'è).
async function controllaCodice(r, { ip = 'esignature' } = {}) {
  const esito = (stato, extra) => ({ stato, ...extra });
  const det = await require('./openapi-it').chiama({ dominio: 'esignature', percorso: '/signatures/' + r.esign_id + '/detail', scopi: [['POST', '/EU-SES'], ['GET', '/signatures']] });
  const stato = String((det && det.data && det.data.state) || '');
  if (stato === 'DONE') {
    const f = await require('./openapi-it').chiama({ dominio: 'esignature', percorso: '/signatures/' + r.esign_id + '/signedDocument', scopi: [['POST', '/EU-SES'], ['GET', '/signatures']], binario: true, timeout: 60000 });
    if (!f || !f.buffer || f.buffer.length < 100) throw err('La firma risulta completa ma il documento firmato non si scarica ancora: riprova tra poco.', 502);
    const file = {}; for (const d of JSON.parse(r.documenti)) file[d.key] = { buffer: f.buffer, nome: 'firmato-' + d.key + '.pdf', mime: 'application/pdf' };
    let consensi = {}; try { consensi = JSON.parse(r.consensi || '{}'); } catch (e) { /* senza consensi */ }
    await chiudi(r, { file, consensi, ip });
    return esito('firmata');
  }
  if (stato === 'ERROR' || stato === 'CANCELLED') {
    db.prepare("UPDATE richieste_firma SET stato = 'inviata', esign_id = NULL WHERE id = ? AND stato = 'in_firma'").run(r.id);
    return esito('da_rifare');
  }
  return esito('in_attesa');
}
async function controllaDaPagina(token) {
  const r = riga(token); if (!r) throw err('Questo link non esiste.', 404);
  if (r.stato === 'firmata') return { stato: 'firmata' };
  if (r.stato !== 'in_firma') throw err('Nessuna firma con codice in corso.', 409);
  return controllaCodice(r);
}
async function controllaFirmeInCorso() {
  const fatte = [];
  for (const r of db.prepare("SELECT * FROM richieste_firma WHERE stato = 'in_firma'").all()) {
    try { const e = await controllaCodice(r); if (e.stato !== 'in_attesa') fatte.push(r.id); } catch (e) { /* ci riprova il giro dopo */ }
  }
  return fatte;
}

function elenco(slug, id) {
  return db.prepare('SELECT id, stato, destinatario, creata_il, scade_il, solleciti, firmata_il, documenti FROM richieste_firma WHERE module_slug = ? AND record_id = ? ORDER BY id DESC LIMIT 10').all(slug, id)
    .map((r) => ({ id: r.id, stato: !['firmata', 'annullata', 'in_firma'].includes(r.stato) && Date.parse(r.scade_il) < Date.now() ? 'scaduta' : r.stato, destinatario: r.destinatario, creata_il: r.creata_il, scade_il: r.scade_il, solleciti: r.solleciti, firmata_il: r.firmata_il, documenti: JSON.parse(r.documenti).map((d) => d.label) }));
}
function annulla(id) { return db.prepare("UPDATE richieste_firma SET stato = 'annullata' WHERE id = ? AND stato IN ('inviata', 'in_firma')").run(id).changes > 0; }

// Sollecito (a mano o dallo scheduler): rimanda lo STESSO link (il token si conserva cifrato), così anche la prima mail resta valida.
async function sollecita(id) {
  const r = db.prepare("SELECT * FROM richieste_firma WHERE id = ? AND stato = 'inviata'").get(id);
  if (!r || Date.parse(r.scade_il) < Date.now()) throw err('Questa richiesta non è più in attesa di firma.', 409);
  const token = unsealText(r.token_cifrato);
  if (!token) throw err('Il link di questa richiesta non si può più rimandare: annullala e mandane una nuova.', 409);
  const m = await mandaEmail(r, token, { sollecito: 1 });
  if (!m.ok) throw err('La mail non è partita: ' + m.motivo, 502);
  db.prepare('UPDATE richieste_firma SET solleciti = solleciti + 1, ultimo_sollecito = ? WHERE id = ?').run(new Date().toISOString(), r.id);
  return { ok: true };
}

// Ogni ora: i solleciti dopo 3 e 7 giorni dall'invio (uno per soglia), poi la scadenza a 14 giorni. Ritorna chi è stato sollecitato.
async function eseguiSolleciti(ora = Date.now()) {
  const fatti = [];
  db.prepare("UPDATE richieste_firma SET stato = 'scaduta' WHERE stato = 'inviata' AND scade_il < ?").run(new Date(ora).toISOString());
  for (const r of db.prepare("SELECT * FROM richieste_firma WHERE stato = 'inviata'").all()) {
    const eta = (ora - Date.parse(r.creata_il.replace(' ', 'T') + 'Z')) / GIORNO;
    const soglia = GIORNI_SOLLECITI[r.solleciti];
    if (soglia === undefined || eta < soglia) continue;
    try { await sollecita(r.id); fatti.push(r.id); } catch (e) { /* ci riprova il giro dopo */ }
  }
  return fatti;
}

function avviaSolleciti() {
  const guarded = () => eseguiSolleciti().catch((e) => console.error('[firma] solleciti:', e.message));
  setTimeout(guarded, 2 * 60 * 1000);
  setInterval(guarded, 3600 * 1000);
  const firme = () => controllaFirmeInCorso().catch((e) => console.error('[firma] controllo firme con codice:', e.message));
  setTimeout(firme, 3 * 60 * 1000);
  setInterval(firme, 5 * 60 * 1000);
  console.log('Solleciti delle richieste di firma: controllo ogni ora (dopo 3 e 7 giorni, scadenza a 14)');
}

module.exports = { avviaCodice, controllaDaPagina, controllaFirmeInCorso, controllaCodice, crea, invia, pubblica, pdf, completa, elenco, annulla, sollecita, eseguiSolleciti, avviaSolleciti, motivoNonValida, GIORNI_VALIDITA };
