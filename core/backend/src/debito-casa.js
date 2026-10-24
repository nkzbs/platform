'use strict';
// Saldo dei contributi tra due persone che condividono le spese di un modulo (una "casa"): ognuno ha
// una quota mensile attesa (una cifra fissa concordata, non calcolata in proporzione al reddito —
// scelta esplicita di chi usa il progetto). Il versato di ognuno è la somma delle sue entrate
// "Contributo <nome>" più le spese che ha dichiarato di aver pagato direttamente, senza passare dal
// conto comune (ruolo `pagato_da` sul modulo di spesa condivisa — module-roles.js, un modulo lo è se
// dichiara quel ruolo: solo lì ha senso "pagato di tasca propria, bypassando il conto comune"). I
// nomi delle due persone e le quote sono dati (debito_casa_quote), mai scritti qui.
const db = require('./db');
const moduleRoles = require('./module-roles');

db.exec("CREATE TABLE IF NOT EXISTS debito_casa_quote (id INTEGER PRIMARY KEY CHECK (id = 1), nome_a TEXT NOT NULL DEFAULT 'Persona A', nome_b TEXT NOT NULL DEFAULT 'Persona B', quota_a REAL NOT NULL DEFAULT 0, quota_b REAL NOT NULL DEFAULT 0)");
db.prepare('INSERT OR IGNORE INTO debito_casa_quote (id) VALUES (1)').run();

const round2 = (n) => Math.round(n * 100) / 100;

function getQuote() { return db.prepare('SELECT nome_a, nome_b, quota_a, quota_b FROM debito_casa_quote WHERE id = 1').get(); }
function setQuote({ nome_a, nome_b, quota_a, quota_b } = {}) {
  const cur = getQuote();
  db.prepare('UPDATE debito_casa_quote SET nome_a = ?, nome_b = ?, quota_a = ?, quota_b = ? WHERE id = 1')
    .run(nome_a || cur.nome_a, nome_b || cur.nome_b, quota_a != null ? Number(quota_a) : cur.quota_a, quota_b != null ? Number(quota_b) : cur.quota_b);
  return getQuote();
}

function addMonths(ym, n) { const [y, m] = ym.split('-').map(Number); const t = y * 12 + (m - 1) + n; return Math.floor(t / 12) + '-' + String((t % 12) + 1).padStart(2, '0'); }

// Il modulo di entrata dove cercare "Contributo <nome>" (il primo con categoria, importo e data dichiarati).
function moduloEntrate() { return moduleRoles.list({ kind: 'entrata' }).find((m) => m.roles.categoria && m.roles.importo && m.roles.data) || null; }
// Il modulo di spesa condivisa: quello con un ruolo "pagato_da" dichiarato.
function moduloSpesaComune() { return moduleRoles.list({ kind: 'spesa' }).find((m) => m.roles.pagato_da) || null; }

function righe(slug) { return db.prepare('SELECT data FROM records WHERE module_slug = ?').all(slug).map((r) => { try { return JSON.parse(r.data); } catch (e) { return null; } }).filter(Boolean); }

function primoMese() {
  const me = moduloEntrate(); if (!me) return null;
  const { nome_a, nome_b } = getQuote();
  const R = me.roles;
  const mesi = righe(me.module_slug)
    .filter((d) => d[R.categoria] === 'Contributo ' + nome_a || d[R.categoria] === 'Contributo ' + nome_b)
    .map((d) => String(d[R.data] || '').slice(0, 7)).filter(Boolean);
  return mesi.length ? mesi.sort()[0] : null;
}

function attivo() { return !!(moduloEntrate() && moduloSpesaComune() && primoMese()); }

// Il saldo cumulato dal primo mese tracciato fino a `finoA` (AAAA-MM, incluso; default il mese corrente).
function saldo(finoA = null, now = new Date()) {
  const me = moduloEntrate(), ms = moduloSpesaComune();
  const inizio = primoMese();
  if (!me || !ms || !inizio) return { available: false, reason: 'Nessun contributo registrato ancora.' };
  const fine = finoA || now.toISOString().slice(0, 7);
  const { nome_a, nome_b, quota_a, quota_b } = getQuote();
  const RE = me.roles, RS = ms.roles;

  const entrate = righe(me.module_slug).map((d) => ({ data: String(d[RE.data] || ''), categoria: d[RE.categoria], importo: Number(d[RE.importo]) || 0 }));
  const dirette = righe(ms.module_slug).filter((d) => d[RS.pagato_da] === nome_a || d[RS.pagato_da] === nome_b).map((d) => ({ data: String(d[RS.data] || ''), pagato_da: d[RS.pagato_da], importo: Number(d[RS.importo]) || 0 }));

  let mesi = 0, versatoA = 0, versatoB = 0;
  for (let ym = inizio; ym <= fine; ym = addMonths(ym, 1)) {
    mesi++;
    for (const e of entrate) { if (e.data.slice(0, 7) !== ym) continue; if (e.categoria === 'Contributo ' + nome_a) versatoA += e.importo; else if (e.categoria === 'Contributo ' + nome_b) versatoB += e.importo; }
    for (const s of dirette) { if (s.data.slice(0, 7) !== ym) continue; if (s.pagato_da === nome_a) versatoA += s.importo; else versatoB += s.importo; }
  }
  const dovutoA = mesi * quota_a, dovutoB = mesi * quota_b;
  return {
    available: true, da: inizio, a: fine, mesi, nome_a, nome_b,
    quota_a, quota_b,
    versato_a: round2(versatoA), versato_b: round2(versatoB),
    dovuto_a: round2(dovutoA), dovuto_b: round2(dovutoB),
    saldo_a: round2(versatoA - dovutoA), // positivo = "a" ha versato di più -> "b" gli deve questa cifra
  };
}

const eur = (n) => Number(n || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
const esc = (t) => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Risposta per il bot: il saldo raccontato dal punto di vista di chi chiede (gli/le devono, o deve lui/lei).
function rispondi(user, now = new Date()) {
  const s = saldo(null, now);
  if (!s.available) return { html: s.reason };
  const chi = String(user.display_name || user.username || '').trim().toLowerCase();
  const ioSonoA = chi === s.nome_a.toLowerCase(), ioSonoB = chi === s.nome_b.toLowerCase();
  const saldoMio = ioSonoB ? -s.saldo_a : s.saldo_a; // dal punto di vista di chi chiede: positivo = gli/le devono, negativo = deve lui/lei
  const altro = ioSonoB ? s.nome_a : s.nome_b;
  const riga = Math.abs(saldoMio) < 0.01
    ? '✅ Sei in pari con ' + esc(altro) + '.'
    : saldoMio > 0
      ? '📄 <b>' + esc(altro) + '</b> ti deve <b>' + eur(saldoMio) + '</b>.'
      : '📄 Devi <b>' + eur(-saldoMio) + '</b> a <b>' + esc(altro) + '</b>.';
  const dettaglio = (ioSonoA || ioSonoB) ? '' : ('\n\n' + esc(s.nome_a) + ': versato ' + eur(s.versato_a) + ' su ' + eur(s.dovuto_a) + ' dovuti\n' + esc(s.nome_b) + ': versato ' + eur(s.versato_b) + ' su ' + eur(s.dovuto_b) + ' dovuti');
  return { html: riga + dettaglio + '\n\n<i>Dal ' + s.da + ' (' + s.mesi + ' mesi, quota ' + eur(s.quota_a) + '/' + eur(s.quota_b) + ' al mese).</i>' };
}

module.exports = { getQuote, setQuote, saldo, primoMese, attivo, rispondi };
