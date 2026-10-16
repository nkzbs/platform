'use strict';
// Movimenti bancari: lettura degli estratti conto in PDF (testo estratto con pdftotext -layout), classificazione dei
// movimenti, abbinamento alle spese e alle entrate già registrate in Finance, elenco di ciò che manca. Il PDF
// non si conserva. Pensato per il formato "Estratto Conto Italia" (colonne: data contabile, valuta, dare/avere,
// descrizione), ma la lettura è separata dalla classificazione, così un altro formato = un altro lettore.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const db = require('./db');

// ─── Estrazione del testo da un PDF ──────────────────────────────────────────
// Sostituibile nei test. Richiede `pdftotext` (poppler-utils) nell'immagine.
async function extractText(buffer) {
  const tmp = path.join(os.tmpdir(), 'bank-' + crypto.randomBytes(8).toString('hex') + '.pdf');
  fs.writeFileSync(tmp, buffer, { mode: 0o600 });
  try {
    return await new Promise((resolve, reject) => {
      const p = spawn('pdftotext', ['-layout', tmp, '-']);
      let out = '', err = '';
      p.stdout.on('data', (d) => (out += d));
      p.stderr.on('data', (d) => (err += d));
      p.on('error', () => reject(new Error('Lettura PDF non disponibile su questo server (manca pdftotext)')));
      p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error('Il file non è un PDF leggibile' + (err ? ': ' + err.slice(0, 80) : '')))));
    });
  } finally { try { fs.unlinkSync(tmp); } catch (e) { /* già tolto */ } }
}

// ─── Lettura dell'estratto ───────────────────────────────────────────────────
const AMT = /^\s*(\d\d\/\d\d\/\d{4})\s+(\d\d\/\d\d\/\d{4})\s+(-?[\d.]+,\d\d)\s*(.*)$/;
// Le prime parole di un movimento nuovo: servono a capire dove finisce la descrizione di uno e comincia quella dopo.
const HEADER = /^(Pagamento|Pagamenti|PAGAMENTO|VS DISPOSIZIONE|DISPOSIZIONE|Prelievo|PRELIEVO|EMOLUMENTI|ADDEBITO|Addebito|BONIFICO|Bonifico|COMM\b|COMMISSIONI|Commissioni|COMPETENZE|IMPOSTA|Imposta|CANONE|Canone|ACCREDITO|Accredito|RICARICA|Versamento|VERSAMENTO|STORNO|Storno|INCASSO|Incasso|RIMBORSO|Rimborso|INTERESSI|Interessi|Giroconto|GIROCONTO|PAG\.TO|SDD|RID\b)/;
const isoDate = (d) => d.split('/').reverse().join('-');
const num = (s) => parseFloat(s.replace(/\./g, '').replace(',', '.'));

function parseStatement(text) {
  const pages = String(text || '').split('\f');
  // righe che si ripetono identiche su (quasi) ogni pagina: intestazioni e piè di pagina
  const count = {};
  for (const pg of pages) for (const l of new Set(pg.split('\n').map((x) => x.trim()).filter(Boolean))) count[l] = (count[l] || 0) + 1;
  const repeated = new Set(Object.keys(count).filter((l) => pages.length > 2 && count[l] >= Math.ceil(pages.length * 0.6) && !AMT.test(l)));
  const NOISE = /^(Data|contabile|Valuta\s+Dare\s+Avere\s+Descrizione|Estratto Conto Italia|Data e ora di stampa:.*|Saldo Contabile Finale.*|Rapporto:.*|Periodo:.*|\d{1,3})$/;
  const holderM = String(text).match(/Rapporto:\s+(IT[A-Z0-9]{20,30})\s+(.+)/);
  const periodM = String(text).match(/Periodo:\s+Da:\s+(\d\d\/\d\d\/\d{4})\s+A:\s+(\d\d\/\d\d\/\d{4})/);
  const header = { iban_last4: holderM ? holderM[1].slice(-4) : null, holder: holderM ? holderM[2].trim() : null, from: periodM ? isoDate(periodM[1]) : null, to: periodM ? isoDate(periodM[2]) : null };

  const items = []; // { m, text: [righe] } nell'ordine; le righe di testo non-amount tra due importi si distribuiscono dopo
  let between = [];
  const flush = () => { const t = between; between = []; return t; };
  const lines = pages.join('\n').split('\n');
  const slots = []; // tra un importo e il successivo: righe di testo
  let firstText = [];
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    const t = line.trim();
    if (!t) continue;
    const m = AMT.exec(line);
    if (m) {
      const prev = items.length ? slots : null;
      if (prev) slots.push(flush()); else firstText = flush();
      items.push({ m, inline: m[4].trim() });
      continue;
    }
    if (repeated.has(t) || NOISE.test(t) || /^Il contenuto informativo/.test(t)) continue;
    between.push(t);
  }
  const tail = flush();
  const movements = [];
  // distribuisce le righe: tra importo k e k+1, quelle da "ultima riga che comincia come un movimento" in poi sono la testa di k+1
  const before = items.map(() => []), after = items.map(() => []);
  const split = (arr) => { let idx = -1; arr.forEach((l, i) => { if (HEADER.test(l)) idx = i; }); return idx < 0 ? [arr, []] : [arr.slice(0, idx), arr.slice(idx)]; };
  if (items.length) {
    const [a0, b0] = split(firstText); before[0] = firstText.length ? (b0.length ? b0 : a0) : [];
    for (let k = 0; k < items.length - 1; k++) { const [a, b] = split(slots[k] || []); after[k] = a; before[k + 1] = b; }
    after[items.length - 1] = tail;
  }
  items.forEach((it, k) => {
    const description = [...before[k], it.inline, ...after[k]].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    movements.push({ booked: isoDate(it.m[1]), date: isoDate(it.m[2]), amount: num(it.m[3]), description });
  });
  return { header, movements };
}

// ─── Classificazione ─────────────────────────────────────────────────────────
// Ritorna { kind, merchant }. `holder` = intestatario del conto (per riconoscere i giri verso conti propri o cointestati).
function holderTokens(holder) { return String(holder || '').toUpperCase().split(/[\s,]+/).filter((t) => t.length > 2); }

function maskIban(s) { return String(s).replace(/\bIT\d\d\s?[A-Z]\d{3}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\s?\d{3}\b|\bIT\d\d[A-Z0-9 ]{18,30}\b/g, (m) => 'IBAN…' + m.replace(/\s/g, '').slice(-4)); }

function merchantOf(desc) {
  const m = /C\/O\s+(.+?)(?:\s+Operazione\b|\s+CARTA N\.|\s+Valuta\b|\s+VIA\b|\s+SU CIRCUITO|$)/i.exec(desc);
  return m ? m[1].replace(/\s+/g, ' ').trim().slice(0, 60) : null;
}

function classify(desc, amount, holder, extraInternal = []) {
  const D = String(desc || '').toUpperCase();
  if (/EMOLUMENTI/.test(D)) return { kind: 'stipendio', merchant: null };
  if (/^(COMM\.|COMMISSIONI|COMPETENZE|CANONE|IMPOSTA DI BOLLO)/.test(D) && Math.abs(amount) < 20) return { kind: 'commissioni', merchant: null };
  const toks = holderTokens(holder);
  const own = toks.length >= 2 && toks.every((t) => D.includes(t));
  if (/BONIFICO/.test(D) && (own || /CONTO CASA/.test(D) || extraInternal.some((p) => D.includes(String(p).toUpperCase())))) return { kind: 'giro_interno', merchant: null };
  // ricarica di una carta prepagata (propria): è un giro tra conti, la spesa vera si vedrà sull'estratto della prepagata
  if (/^RICARICA CARTA/.test(D) && amount < 0) return { kind: 'giro_interno', merchant: null };
  if (/^PRELIEVO/.test(D)) return { kind: 'prelievo', merchant: null };
  if (/PAGAMENTO POS|PAGAMENTI PAESI|PAGAMENTO CARTA|ACQUISTO/.test(D)) return { kind: 'carta', merchant: merchantOf(desc) };
  if (/UTENZA|CBILL|BOLLETTINO|ADDEBITO DIRETTO|\bSDD\b/.test(D)) return { kind: 'utenza', merchant: null };
  if (/BONIFICO|ACCREDITO/.test(D)) return { kind: amount >= 0 ? 'bonifico_in' : 'bonifico_out', merchant: null };
  return { kind: amount >= 0 ? 'altro_in' : 'altro', merchant: merchantOf(desc) };
}

// Categoria suggerita per una spesa (parole chiave semplici; l'assistente potrà proporre di meglio).
const HINTS = [
  [/DISTRIBUTORE|BENZINA|CARBURANT|\bENI\b|\bQ8\b|\bIP\b|TAMOIL|ESSO|STATION|AUTOSTRAD|TELEPASS|PARCHEGGIO/i, 'Auto & Benzina'],
  [/SUPERMERCAT|CONAD|COOP|CARREFOUR|ESSELUNGA|LIDL|EUROSPIN|MD\b|IPER|MERCATONE|ALIMENT|PANETT|MACELLER|FRUTTA/i, 'Alimentari'],
  [/RISTORANT|PIZZER|BAR\b|CAFFE|PASTICCER|MCDONALD|KEBAB|TRATTORIA|GELATER|SUSHI|PUB\b|OSTERIA/i, 'Intrattenimento'],
  [/NETFLIX|SPOTIFY|DISNEY|AMAZON PRIME|APPLE\.COM|ICLOUD|GOOGLE|DAZN|ABBONAMENT/i, 'Abbonamenti'],
  [/ASSICURAZ|GENERALI|UNIPOL|ALLIANZ|REALE MUTUA/i, 'Assicurazioni'],
  [/TASSE|IMPOSTA|AGENZIA ENTRATE|F24|BOLLO|TARI\b|IMU\b/i, 'Tasse'],
];
function categoryHint(desc, merchant) {
  const s = (merchant || '') + ' ' + desc;
  for (const [re, cat] of HINTS) if (re.test(s)) return cat;
  return null;
}

// ─── Importazione ────────────────────────────────────────────────────────────
const keyOf = (m) => crypto.createHash('sha1').update([m.booked, m.date, m.amount.toFixed(2), m.description.slice(0, 160)].join('|')).digest('hex');

function importParsed(parsed, { fileName } = {}) {
  const h = parsed.header;
  if (!h.iban_last4) throw new Error('Non riconosco questo estratto: manca l\'intestazione del conto.');
  if (!parsed.movements.length) throw new Error('Nessun movimento trovato in questo estratto.');
  let acc = db.prepare('SELECT * FROM bank_accounts WHERE iban_last4 = ?').get(h.iban_last4);
  if (!acc) { const id = db.prepare('INSERT INTO bank_accounts (iban_last4, holder, nome) VALUES (?, ?, ?)').run(h.iban_last4, h.holder, 'Conto …' + h.iban_last4).lastInsertRowid; acc = db.prepare('SELECT * FROM bank_accounts WHERE id = ?').get(id); }
  const extra = settings().internal_patterns;
  // più movimenti identici nello stesso giorno (due caffè uguali) sono legittimi: si confronta quanti ce ne sono già
  const inFile = {};
  for (const m of parsed.movements) { m.key = keyOf(m); inFile[m.key] = (inFile[m.key] || 0) + 1; }
  const existing = {};
  for (const r of db.prepare('SELECT dedupe_key k, COUNT(*) c FROM bank_movements WHERE account_id = ? GROUP BY dedupe_key').all(acc.id)) existing[r.k] = r.c;
  const seen = {};
  let nuovi = 0, duplicati = 0;
  const ins = db.prepare('INSERT INTO bank_movements (account_id, date, booked, amount, description, merchant, kind, category_hint, dedupe_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  db.transaction(() => {
    for (const m of parsed.movements) {
      seen[m.key] = (seen[m.key] || 0) + 1;
      if (seen[m.key] <= (existing[m.key] || 0)) { duplicati++; continue; }
      const c = classify(m.description, m.amount, acc.holder, extra);
      ins.run(acc.id, m.date, m.booked, m.amount, maskIban(m.description).slice(0, 400), c.merchant, c.kind, c.kind === 'carta' || c.kind === 'altro' || c.kind === 'utenza' ? categoryHint(m.description, c.merchant) : null, m.key);
      nuovi++;
    }
  })();
  return { file: fileName || null, account: acc.nome, iban_last4: acc.iban_last4, periodo: { da: h.from, a: h.to }, letti: parsed.movements.length, nuovi, duplicati };
}

async function importPdf(buffer, fileName) {
  const text = await module.exports.extractText(buffer);
  return importParsed(parseStatement(text), { fileName });
}

// ─── Impostazioni ────────────────────────────────────────────────────────────
function settings() {
  // Per ora fisse: `internal_patterns` = altre parole che indicano un giro verso un conto proprio o cointestato
  // (oltre al nome dell'intestatario e a "Conto Casa"), `match_days` = quanti giorni di scarto tollerare nell'abbinamento.
  return { internal_patterns: [], match_days: 75 };
}

// ─── Abbinamento con le righe registrate ─────────────────────────────────────
// Quali moduli contano e come si chiamano i loro campi lo dichiara il modulo (Builder → Ruoli del modulo → «Estratto conto», module-roles.js):
// qui non ci sono nomi di moduli, di campi, di categorie né di stati.
const moduleRoles = require('./module-roles');
const days = (a, b) => Math.abs((new Date(a) - new Date(b)) / 86400000);

// I moduli che partecipano (uso «estratto»), con le loro righe: { module, id, d, R: ruoli, decl }.
function estrattoModules() { return moduleRoles.list({ use: 'estratto' }).filter((m) => m.roles.importo); }
function recordsOf(decls) {
  const out = [];
  for (const m of decls) {
    for (const r of db.prepare('SELECT id, data FROM records WHERE module_slug = ?').all(m.module_slug)) { try { out.push({ module: m.module_slug, id: r.id, d: JSON.parse(r.data), R: m.roles, decl: m }); } catch (e) { /* riga illeggibile */ } }
  }
  return out;
}

// Abbina i movimenti non ancora abbinati a una riga registrata con lo stesso importo e una data vicina. Una riga si abbina a un solo movimento.
// Ritorna quanti nuovi abbinamenti.
function rematch() {
  const win = settings().match_days;
  const taken = new Set(db.prepare('SELECT match_module m, match_id i FROM bank_movements WHERE match_id IS NOT NULL').all().map((r) => r.m + ':' + r.i));
  const decls = estrattoModules();
  const spese = recordsOf(decls.filter((m) => m.kind === 'spesa')), entrate = recordsOf(decls.filter((m) => m.kind === 'entrata'));
  const giro = new Set(decls.flatMap((m) => m.estratto.giro_categories)); // categorie che sono un giro tra conti propri
  const catOf = (r) => r.d[r.R.categoria];
  const upd = db.prepare('UPDATE bank_movements SET match_module = ?, match_id = ? WHERE id = ?');
  let n = 0;
  // `dateRole`: quale data della riga confrontare (la data di pagamento per le spese, se il modulo la dichiara; altrimenti la data della riga)
  const pick = (pool, filterFn, mov, dateRole) => {
    let best = null;
    for (const r of pool) {
      if (taken.has(r.module + ':' + r.id) || !filterFn(r)) continue;
      const a = parseFloat(r.d[r.R.importo]); if (!Number.isFinite(a) || Math.abs(Math.abs(mov.amount) - a) > 0.005) continue;
      const dd = days(mov.date, r.d[r.R[dateRole]] || r.d[r.R.data]); if (dd > win) continue;
      if (!best || dd < best.dd) best = { r, dd };
    }
    return best && best.r;
  };
  const stipendio = (r) => (r.decl.riepiloghi.salary_categories || []).includes(catOf(r)); // le entrate che il modulo dichiara «stipendio»
  const daSmistare = (r) => !!r.decl.avvisi.states.nuovo && r.d[r.R.stato || '_stato'] === r.decl.avvisi.states.nuovo;
  for (const mov of db.prepare('SELECT * FROM bank_movements WHERE match_id IS NULL AND ignored = 0 ORDER BY date').all()) {
    let r = null;
    if (mov.kind === 'stipendio' || (mov.amount > 0 && mov.kind !== 'giro_interno')) r = mov.kind === 'stipendio' ? pick(entrate, stipendio, mov, 'data') : null;
    else if (mov.kind === 'giro_interno' && mov.amount < 0) r = pick(spese, (x) => giro.has(catOf(x)), mov, 'data');
    else if (['carta', 'utenza', 'bonifico_out', 'altro'].includes(mov.kind)) r = pick(spese, (x) => !giro.has(catOf(x)) && !daSmistare(x), mov, 'data_pagamento');
    if (r) { upd.run(r.module, r.id, mov.id); taken.add(r.module + ':' + r.id); n++; }
  }
  return n;
}

// ─── Letture ─────────────────────────────────────────────────────────────────
const SPENDING_KINDS = ['carta', 'utenza', 'bonifico_out', 'altro'];

function monthSummary(month) {
  const rows = db.prepare("SELECT * FROM bank_movements WHERE substr(date, 1, 7) = ?").all(month);
  if (!rows.length) return null;
  const sum = (f) => Math.round(rows.filter(f).reduce((s, r) => s + r.amount, 0) * 100) / 100;
  const missing = rows.filter((r) => r.amount < 0 && SPENDING_KINDS.includes(r.kind) && !r.match_id && !r.ignored);
  return {
    month, movimenti: rows.length,
    entrate_reali: sum((r) => r.amount > 0 && r.kind !== 'giro_interno'),
    uscite_reali: -sum((r) => r.amount < 0 && r.kind !== 'giro_interno'),
    giri_interni: -sum((r) => r.amount < 0 && r.kind === 'giro_interno'),
    non_registrate: Math.round(-missing.reduce((s, r) => s + r.amount, 0) * 100) / 100,
    non_registrate_n: missing.length,
  };
}

function listMovements({ month, filter = 'tutti', limit = 400 } = {}) {
  let sql = 'SELECT m.*, a.nome AS conto FROM bank_movements m JOIN bank_accounts a ON a.id = m.account_id WHERE 1=1';
  const p = [];
  if (month) { sql += " AND substr(m.date, 1, 7) = ?"; p.push(month); }
  if (filter === 'da_registrare') sql += " AND m.amount < 0 AND m.kind IN ('carta','utenza','bonifico_out','altro') AND m.match_id IS NULL AND m.ignored = 0";
  else if (filter === 'giri') sql += " AND m.kind = 'giro_interno'";
  else if (filter === 'entrate') sql += ' AND m.amount > 0';
  sql += ' ORDER BY m.date DESC, m.id DESC LIMIT ' + (parseInt(limit, 10) || 400);
  return db.prepare(sql).all(...p).map((r) => ({ ...r, ignored: !!r.ignored }));
}

// Il modulo dove si registrano le uscite dell'estratto: quello che lo ha dichiarato («registra»), con le categorie ammesse.
function registraIn() { return estrattoModules().find((m) => m.kind === 'spesa' && m.estratto.registra) || null; }
function registraInfo() {
  const m = registraIn(); if (!m) return null;
  let categorie = [];
  try {
    const f = (require('./schema-v3').parseSchemaNormalized(db.prepare('SELECT schema_json FROM modules WHERE slug = ?').get(m.module_slug).schema_json).fields || []).find((x) => x.key === m.roles.categoria);
    categorie = f && Array.isArray(f.options) ? f.options.map((o) => (typeof o === 'string' ? o : o.value)).filter(Boolean) : [];
  } catch (e) { categorie = []; }
  return { modulo: m.module_slug, nome: m.name || m.module_slug, categorie };
}

// Registra un movimento come spesa già pagata (nel modulo dichiarato per questo) e lo abbina.
function registerAsExpense(id, { categoria, descrizione } = {}) {
  const m = db.prepare('SELECT * FROM bank_movements WHERE id = ?').get(id);
  if (!m) return { notFound: true };
  if (m.match_id) return { error: 'Questo movimento è già abbinato a una spesa.' };
  if (m.amount >= 0) return { error: 'Solo le uscite si registrano come spese.' };
  const decl = registraIn();
  if (!decl) return { error: 'Nessun modulo è dichiarato per registrare le spese dall\'estratto conto (Builder → Ruoli del modulo → Estratto conto).' };
  const R = decl.roles, slug = decl.module_slug;
  const data = {};
  const put = (role, value) => { if (R[role] && value !== undefined) data[R[role]] = value; }; // un campo senza ruolo non si scrive
  put('descrizione', String(descrizione || m.merchant || m.description.slice(0, 60)).slice(0, 80));
  put('importo', Math.abs(m.amount)); put('data', m.date); put('data_pagamento', m.date);
  put('categoria', categoria || m.category_hint || decl.estratto.categoria_default || undefined);
  put('fisso', false);
  put('note', 'Da estratto conto (' + m.date + ')');
  if (decl.avvisi.states.fatto) data[R.stato || '_stato'] = decl.avvisi.states.fatto;
  const rid = db.prepare('INSERT INTO records (module_slug, user_id, data) VALUES (?, ?, ?)').run(slug, require('./record-owner').ownerFor(null, slug), JSON.stringify(data)).lastInsertRowid;
  db.prepare('UPDATE bank_movements SET match_module = ?, match_id = ? WHERE id = ?').run(slug, rid, id);
  return { record_id: rid, data };
}

const setIgnored = (id, v) => db.prepare('UPDATE bank_movements SET ignored = ? WHERE id = ?').run(v ? 1 : 0, id).changes > 0;

module.exports = { registraInfo, extractText, parseStatement, classify, categoryHint, maskIban, importParsed, importPdf, rematch, monthSummary, listMovements, registerAsExpense, setIgnored, settings };
