'use strict';
// Collaudo automatico: attraversa davvero i flussi dichiarati dai moduli, in una COPIA ISOLATA del tenant. Niente di ciò che succede qui tocca i dati veri:
//   1. copia il database (VACUUM INTO) in una cartella temporanea e vi toglie ogni credenziale (collegamenti, webhook, chat), così nulla può partire verso l'esterno;
//   2. avvia una seconda istanza dello stesso codice su quella copia (COLLAUDO=1 spegne i lavori programmati) con un utente amministratore usa-e-getta;
//   3. per ogni modulo crea record di prova (valori plausibili per tipo di campo, relazioni risolte creando prima i record collegati), percorre tutti gli stati raggiungibili
//      del flusso (prima verifica che un requisito bloccante blocchi, poi lo soddisfa), controlla le automazioni, le anteprime dei documenti e gli abbinamenti;
//   4. spegne la copia e la cancella. Restituisce un elenco di controlli come lib/verifica-tenant.js, più cosa hanno prodotto le automazioni.
// Nessun nome di settore o di modulo: tutto si ricava dagli schemi.
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const db = require('../db');

const OGGI = () => new Date().toISOString().slice(0, 10);
const CF_VALIDO = 'RSSMRA85T10A562S', PIVA_VALIDA = '12345678903';
const SEGRETI_DA_NON_PASSARE = /TOKEN|API_KEY|PASSWORD|MISTRAL|OPENAI|ANTHROPIC|SMTP|RESEND|GOOGLE|TELEGRAM|STRIPE/i;

function portaLibera() {
  return new Promise((res, rej) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); s.on('error', rej); });
}
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

// ── valori di prova per tipo di campo ──
function valoreProva(campo, n) {
  const f = campo || {};
  if (f.validazione === 'codice_fiscale_it' || f.validazione === 'codice_fiscale_o_piva_it') return CF_VALIDO;
  if (f.validazione === 'partita_iva_it') return PIVA_VALIDA;
  const opzioni = Array.isArray(f.options) ? f.options : null;
  const primo = opzioni && opzioni.length ? (typeof opzioni[0] === 'object' ? (opzioni[0].value !== undefined ? opzioni[0].value : opzioni[0].key) : opzioni[0]) : undefined;
  switch (f.type) {
    case 'number': case 'currency': return 1000;
    case 'date': return OGGI();
    case 'datetime': return OGGI() + 'T10:00';
    case 'time': return '10:00';
    case 'select': return primo;
    case 'multiselect': return primo === undefined ? undefined : [primo];
    case 'checkbox': return true;
    case 'email': return 'collaudo' + n + '@example.com';
    case 'phone': return '+39 333 1234567';
    case 'url': return 'https://example.com';
    case 'textarea': return 'Testo di prova ' + n;
    case 'encrypted': return 'prova';
    case 'computed': case 'file': case 'barcode': case 'mappa': case 'giacenza': case 'soglia': case 'soglia_data': case 'scaglioni': return undefined;
    default: return (f.label || f.key || 'Prova') + ' ' + n;
  }
}

class Collaudo {
  constructor(base, token, progresso, annullato) {
    this.annullato = annullato || (() => false); this.base = base; this.token = token; this.progresso = progresso || (() => {});
    this.righe = []; this.automazioni = []; this.n = 0; this.moduli = {}; this.campione = {};
  }
  ck(categoria, ok, modulo, blocco, messaggio) { this.righe.push({ categoria, ok: !!ok, modulo, blocco, messaggio: ok ? '' : messaggio }); }
  async http(metodo, p, corpo) {
    try {
      const r = await fetch(this.base + '/api' + p, { method: metodo, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + this.token }, body: corpo === undefined ? undefined : JSON.stringify(corpo), signal: AbortSignal.timeout(20000) });
      let j = null; try { j = await r.json(); } catch (e) { /* risposta senza corpo */ }
      return { s: r.status, j };
    } catch (e) { return { s: 0, j: { error: e.message } }; }
  }
  // PUT sostituisce tutti i dati del record (come fa la scheda): si rimanda il record intero con le modifiche sopra.
  async aggiorna(slug, id, modifiche) {
    const g = await this.http('GET', '/records/' + slug + '/' + id);
    if (g.s !== 200 || !g.j) return g;
    return this.http('PUT', '/records/' + slug + '/' + id, { ...(g.j.data || {}), ...modifiche });
  }
  errore(r) { return (r.j && r.j.error) ? String(r.j.error) : 'risposta ' + r.s; }

  leggiModuli() {
    for (const m of db.prepare('SELECT slug, name, schema_json FROM modules WHERE installed = 1').all()) {
      let s; try { s = JSON.parse(m.schema_json || '{}'); } catch (e) { s = {}; }
      const steps = Array.isArray(s.steps) ? s.steps : [];
      this.moduli[m.slug] = {
        slug: m.slug, nome: m.name, steps,
        campi: steps.filter((b) => b.block_type === 'field'), relazioni: steps.filter((b) => b.block_type === 'relation' && b.target_module),
        stati: steps.filter((b) => b.block_type === 'workflow_state'), passaggi: steps.filter((b) => b.block_type === 'workflow_transition'),
        requisiti: steps.filter((b) => b.block_type === 'state_requirements'), documenti: steps.filter((b) => b.block_type === 'document_action'),
        abbinamenti: steps.filter((b) => b.block_type === 'match_view'), automazioni: steps.filter((b) => b.block_type === 'automation'),
        riservati: new Set(), // campi che compila il sistema, non chi inserisce: se li riempissi tu le condizioni «una volta sola» delle automazioni non scatterebbero mai
      };
    }
    for (const m of Object.values(this.moduli)) {
      for (const b of m.steps) {
        if (b.block_type === 'external_action') { if (b.risultato_in) m.riservati.add(b.risultato_in); for (const v of Object.values(b.esito || {})) if (typeof v === 'string') m.riservati.add(v); }
        if (b.block_type === 'automation') {
          const visita = (az) => { for (const a of (az || [])) { if (a.kind === 'condition') { visita(a.then); visita(a.otherwise); } else if (a.azione === 'aggiorna_record' && a.config && a.config.campo) { const t = (a.config.modulo && this.moduli[a.config.modulo]) || m; t.riservati.add(a.config.campo); } } };
          visita(b.azioni);
        }
      }
    }
  }

  // I dati di un record di prova per il modulo; le relazioni puntano a record di prova creati al volo (una sola volta per modulo).
  async dati(slug, visti = new Set()) {
    const m = this.moduli[slug]; const n = ++this.n; const out = {};
    for (const f of m.campi) { if (m.riservati.has(f.key)) continue; const v = valoreProva(f, n); if (v !== undefined) out[f.key] = v; }
    for (const r of m.relazioni) {
      if (r.type && r.type !== 'many_to_one') continue;
      const id = await this.campioneDi(r.target_module, visti);
      if (id) out[r.key] = id;
    }
    return out;
  }
  async campioneDi(slug, visti = new Set()) {
    if (this.campione[slug]) return this.campione[slug];
    if (!this.moduli[slug] || visti.has(slug)) return null; // modulo assente o giro di relazioni: lo si lascia vuoto
    visti.add(slug);
    const id = await this.crea(slug, visti, true);
    visti.delete(slug);
    if (id) this.campione[slug] = id;
    return id;
  }
  async crea(slug, visti = new Set(), silenzioso = false) {
    const m = this.moduli[slug]; const dati = await this.dati(slug, visti);
    const iniziale = m.stati.find((s) => s.initial); if (iniziale) dati._stato = iniziale.key;
    const r = await this.http('POST', '/records/' + slug, dati);
    if (r.s !== 200 || !r.j || !r.j.id) { if (!silenzioso) this.ck('creazione', false, slug, 'nuovo record', 'Un record di prova non si crea: ' + this.errore(r)); else this.ck('creazione', false, slug, 'record collegato di prova', 'Serve a un altro modulo ma non si crea: ' + this.errore(r)); return null; }
    return r.j.id;
  }

  async conta() {
    const out = {};
    for (const slug of Object.keys(this.moduli)) { const r = await this.http('GET', '/records/' + slug); out[slug] = Array.isArray(r.j) ? r.j.length : 0; }
    return out;
  }

  // Toglie dal record i valori che un requisito chiede (se il campo non è obbligatorio): così si può verificare che il passaggio sia davvero bloccato.
  async svuota(slug, id, m, blocco) {
    const g = await this.http('GET', '/records/' + slug + '/' + id); if (g.s !== 200 || !g.j) return;
    const dati = { ...(g.j.data || {}) }; let cambiato = false;
    for (const q of (blocco.requisiti || [])) {
      for (const k of (q.tipo === 'campo' ? [q.campo] : q.tipo === 'uno_di' ? (q.campi || []) : [])) {
        const f = m.campi.find((x) => x.key === k); const r = m.relazioni.find((x) => x.key === k);
        if ((f && !f.required && dati[k] !== undefined) || (r && !r.required && dati[k] !== undefined)) { delete dati[k]; cambiato = true; }
      }
    }
    if (cambiato) await this.http('PUT', '/records/' + slug + '/' + id, dati);
  }

  // Soddisfa i requisiti di uno stato di arrivo su un record: campi, relazioni, allegati.
  async soddisfa(slug, id, blocco) {
    const m = this.moduli[slug]; const upd = {};
    for (const q of (blocco.requisiti || [])) {
      const chiavi = q.tipo === 'campo' ? [q.campo] : q.tipo === 'uno_di' ? [(q.campi || [])[0]] : [];
      for (const k of chiavi.filter(Boolean)) {
        if (k.includes('.')) continue;
        const rel = m.relazioni.find((r) => r.key === k);
        if (rel) { const t = await this.campioneDi(rel.target_module); if (t) upd[k] = t; continue; }
        const f = m.campi.find((x) => x.key === k); const v = valoreProva(f || {}, ++this.n); if (v !== undefined) upd[k] = v;
      }
      if (q.tipo === 'allegato') {
        const fd = new FormData(); fd.append('file', new Blob(['%PDF-1.4 collaudo'], { type: 'application/pdf' }), 'collaudo.pdf');
        try {
          const up = await (await fetch(this.base + '/api/uploads', { method: 'POST', headers: { Authorization: 'Bearer ' + this.token }, body: fd, signal: AbortSignal.timeout(20000) })).json();
          if (up && up.id) await this.http('POST', '/records/' + slug + '/' + id + '/attachments', { upload_id: up.id, tipo: q.valore });
        } catch (e) { /* l'esito si vede quando il passaggio fallisce */ }
      }
    }
    if (Object.keys(upd).length) await this.aggiorna(slug, id, upd);
  }

  async percorriFlusso(m) {
    const iniziale = m.stati.find((s) => s.initial); if (!iniziale) return;
    // percorso più corto dall'iniziale a ogni stato raggiungibile
    const padre = new Map([[iniziale.key, null]]); const coda = [iniziale.key];
    while (coda.length) { const s = coda.shift(); for (const p of m.passaggi) if (p.from === s && !padre.has(p.to)) { padre.set(p.to, p); coda.push(p.to); } }
    const percorso = (stato) => { const out = []; let c = stato; while (padre.get(c)) { out.unshift(padre.get(c)); c = padre.get(c).from; } return out; };
    for (const stato of m.stati) {
      if (stato.key === iniziale.key || !padre.has(stato.key)) continue;
      const id = await this.crea(m.slug); if (!id) return;
      let ok = true; const prima = await this.conta();
      for (const p of percorso(stato.key)) {
        const eti = 'passaggio «' + (p.label || p.from + ' → ' + p.to) + '»';
        const blocco = m.requisiti.find((b) => b.stato === p.to && b.bloccante && (b.requisiti || []).length);
        if (blocco) {
          await this.svuota(m.slug, id, m, blocco);
          const prova = await this.http('POST', '/records/' + m.slug + '/' + id + '/transition', { to: p.to });
          this.ck('flusso', prova.s === 400 && prova.j && Array.isArray(prova.j.mancano), m.slug, eti + ': blocco', 'Dovrebbe essere bloccato dai requisiti di «' + p.to + '» ma è passato (o ha dato un errore strano: ' + this.errore(prova) + ').');
          if (prova.s === 200) continue;
          await this.soddisfa(m.slug, id, blocco);
        }
        const r = await this.http('POST', '/records/' + m.slug + '/' + id + '/transition', { to: p.to });
        if (r.s !== 200) { this.ck('flusso', false, m.slug, eti, 'Il passaggio non riesce nemmeno con i dati di prova: ' + this.errore(r)); ok = false; break; }
      }
      if (ok) this.ck('flusso', true, m.slug, 'stato «' + (stato.label || stato.key) + '»', '');
      const dopo = await this.conta();
      for (const slug of Object.keys(dopo)) if (dopo[slug] > prima[slug]) this.automazioni.push({ modulo: m.slug, stato: stato.key, prodotti: dopo[slug] - prima[slug], in: slug });
    }
  }

  async provaModulo(m) {
    this.progresso('Modulo «' + m.nome + '»…');
    const id = await this.crea(m.slug);
    if (!id) return;
    this.ck('creazione', true, m.slug, 'nuovo record', '');
    const g = await this.http('GET', '/records/' + m.slug + '/' + id); this.ck('lettura', g.s === 200, m.slug, 'scheda del record', 'La scheda non si apre: ' + this.errore(g));
    const l = await this.http('GET', '/records/' + m.slug); this.ck('lettura', l.s === 200 && Array.isArray(l.j), m.slug, 'elenco', 'L\'elenco non si apre: ' + this.errore(l));
    const testo = m.campi.find((f) => (f.type === 'text' || !f.type) && !f.validazione && !f.unique);
    if (testo) { const u = await this.aggiorna(m.slug, id, { [testo.key]: 'Modificato dal collaudo' }); this.ck('modifica', u.s === 200, m.slug, 'modifica di «' + (testo.label || testo.key) + '»', 'La modifica non si salva: ' + this.errore(u)); }
    for (const d of m.documenti) {
      const r = await this.http('POST', '/records/' + m.slug + '/' + id + '/documento/' + d.key + '/anteprima', {});
      const ok = r.s === 200 && r.j && typeof r.j.corpo === 'string' && r.j.corpo.length > 0;
      this.ck('documenti', ok, m.slug, 'documento «' + (d.label || d.key) + '»', 'L\'anteprima non si genera: ' + this.errore(r));
      if (ok) this.ck('documenti', !/\{\{[^}]*\}\}/.test(r.j.corpo + (r.j.oggetto || '')), m.slug, 'documento «' + (d.label || d.key) + '»: segnaposto', 'Nell\'anteprima restano dei segnaposto non sostituiti.');
    }
    for (const a of m.abbinamenti) {
      const r = await this.http('GET', '/records/' + m.slug + '/' + id + '/abbinamenti/' + a.key);
      this.ck('viste', r.s === 200, m.slug, 'abbinamento «' + (a.label || a.key) + '»', 'L\'abbinamento non si calcola: ' + this.errore(r));
    }
    await this.percorriFlusso(m);
    // ogni automazione che crea record deve aver prodotto qualcosa da qualche parte
    for (const au of m.automazioni) {
      const crea = []; const visita = (az) => { for (const a of (az || [])) { if (a.kind === 'condition') { visita(a.then); visita(a.otherwise); } else if (a.azione === 'crea_record' && a.config) crea.push(a.config.modulo); } }; visita(au.azioni);
      if (!crea.length || (au.trigger || {}).evento !== 'cambio_stato') continue;
      const fatto = this.automazioni.some((x) => x.modulo === m.slug && x.stato === au.trigger.stato && crea.includes(x.in));
      this.ck('automazioni', fatto, m.slug, 'automazione «' + (au.label || 'senza nome') + '»', 'Quando un record arriva allo stato «' + au.trigger.stato + '» non è nato nessun record in «' + crea.join(', ') + '» (forse una condizione non è soddisfatta dai dati di prova).');
    }
  }

  async tutto() {
    this.leggiModuli();
    // prima i moduli senza relazioni verso altri, poi gli altri: i record collegati nascono quando servono
    for (const m of Object.values(this.moduli)) { if (this.annullato()) return; await this.provaModulo(m); }
  }
}

let lavoro = null; // un collaudo alla volta
function stato() { return lavoro ? { id: lavoro.id, stato: lavoro.stato, avanzamento: lavoro.avanzamento.slice(-12), risultato: lavoro.risultato, errore: lavoro.errore, inizio: lavoro.inizio } : null; }

async function esegui(lavoroCorrente) {
  const cartella = fs.mkdtempSync(path.join(os.tmpdir(), 'collaudo-'));
  const copia = path.join(cartella, 'copia.db');
  let figlio = null;
  const avanza = (m) => { lavoroCorrente.avanzamento.push(m); };
  try {
    avanza('Preparo una copia isolata del tenant…');
    db.prepare('VACUUM INTO ?').run(copia);
    const Database = require('better-sqlite3'); const c = new Database(copia);
    for (const t of ['connections', 'webhooks', 'gmail_rules', 'telegram_links', 'telegram_link_codes', 'telegram_pending', 'telegram_memory']) { try { c.prepare('DELETE FROM ' + t).run(); } catch (e) { /* tabella assente */ } }
    const password = crypto.randomBytes(12).toString('hex');
    try { c.prepare('DELETE FROM users WHERE username = ?').run('collaudo'); } catch (e) { /* niente */ }
    c.prepare('INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)').run('collaudo', require('bcryptjs').hashSync(password, 4), 'Collaudo', 'admin');
    c.close();
    const porta = await portaLibera();
    const env = {}; for (const [k, v] of Object.entries(process.env)) if (!SEGRETI_DA_NON_PASSARE.test(k) || /^(JWT_SECRET|ENCRYPTION_KEY|INTERNAL_API_SECRET)$/.test(k)) env[k] = v;
    Object.assign(env, { DB_PATH: copia, PORT: String(porta), COLLAUDO: '1', UPLOAD_DIR: path.join(cartella, 'file'), SUPER_ADMIN_URL: 'http://127.0.0.1:1', REDIS_URL: '' });
    delete env.REDIS_URL;
    avanza('Avvio la copia…');
    figlio = spawn(process.execPath, [path.join(__dirname, '..', 'index.js')], { env, stdio: 'ignore' });
    let su = false; for (let i = 0; i < 60 && !su; i++) { await pausa(500); try { su = (await fetch('http://127.0.0.1:' + porta + '/health', { signal: AbortSignal.timeout(1500) })).ok; } catch (e) { /* non ancora in ascolto */ } }
    if (!su) throw new Error('La copia non si è avviata in 30 secondi.');
    const login = await (await fetch('http://127.0.0.1:' + porta + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'collaudo', password }) })).json();
    if (!login.token) throw new Error('Accesso alla copia non riuscito.');
    const col = new Collaudo('http://127.0.0.1:' + porta, login.token, avanza, () => lavoroCorrente.stato !== 'in_corso');
    await col.tutto();
    const totale = col.righe.length, ok = col.righe.filter((r) => r.ok).length;
    const categorie = {}; for (const r of col.righe) { const x = categorie[r.categoria] || (categorie[r.categoria] = { controlli: 0, superati: 0 }); x.controlli++; if (r.ok) x.superati++; }
    return {
      moduli: Object.keys(col.moduli).length, controlli: totale, superati: ok, punteggio: totale ? Math.round((ok / totale) * 100) : 100, categorie,
      problemi: col.righe.filter((r) => !r.ok).map(({ categoria, modulo, blocco, messaggio }) => ({ categoria, modulo, blocco, messaggio })),
      effetti_automazioni: col.automazioni,
    };
  } finally {
    if (figlio) { try { figlio.kill('SIGKILL'); } catch (e) { /* già chiuso */ } }
    try { fs.rmSync(cartella, { recursive: true, force: true }); } catch (e) { /* cartella temporanea */ }
  }
}

function avvia() {
  if (lavoro && lavoro.stato === 'in_corso') return { gia_in_corso: true, id: lavoro.id };
  lavoro = { id: crypto.randomBytes(4).toString('hex'), stato: 'in_corso', avanzamento: [], risultato: null, errore: null, inizio: new Date().toISOString() };
  const corrente = lavoro;
  const limite = setTimeout(() => { if (corrente.stato === 'in_corso') { corrente.stato = 'errore'; corrente.errore = 'Il collaudo ha superato i 4 minuti ed è stato interrotto.'; } }, 240000);
  esegui(corrente).then((r) => { if (corrente.stato === 'in_corso') { corrente.risultato = r; corrente.stato = 'finito'; } }).catch((e) => { corrente.stato = 'errore'; corrente.errore = e.message; }).finally(() => clearTimeout(limite));
  return { id: corrente.id };
}

module.exports = { avvia, stato, esegui, valoreProva };
