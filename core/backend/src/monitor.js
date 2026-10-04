'use strict';
// Monitoraggio: un messaggio WhatsApp al mese con "come sta andando", per ogni widget "Come sta andando" che lo ha acceso (casella «Invia ogni mese su
// WhatsApp» nel widget). Ogni widget ha la sua vista (es. personale e casa), quindi un messaggio per widget. Il giorno 2 alle 9 (ora italiana) parte quello
// dell'ultimo mese concluso: numeri, cose da guardare e, se l'AI è accesa e risponde, il commento. Senza AI il messaggio parte lo stesso, solo coi numeri.
const db = require('./db');
const insights = require('./insights');
const moduleAi = require('./module-ai');
const { romeParts } = require('./daily-digest');

const GIORNO = 2, ORA = 9;
const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
const sep = (n, d) => Number(n || 0).toFixed(d).replace(/\B(?=(\d{3})+(?!\d))/g, '.').replace(/\.(\d{2})$/, ',$1');
const eur = (n) => sep(Math.round(Number(n || 0)), 0) + ' €';
const eur2 = (n) => { const [i, d] = Number(n || 0).toFixed(2).split('.'); return i.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + d + ' €'; };
const pctTxt = (p) => (p == null ? '' : (p > 0 ? '+' : '') + String(p).replace('.', ',') + '%');
const meseLabel = (ym) => MESI[parseInt(ym.slice(5, 7), 10) - 1] + ' ' + ym.slice(0, 4);

let ready = false;
function ensure() {
  if (ready) return;
  db.exec('CREATE TABLE IF NOT EXISTS monitor_sent (widget_id INTEGER NOT NULL, month TEXT NOT NULL, sent_at DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (widget_id, month))');
  ready = true;
}

function monitored() {
  return db.prepare("SELECT id, label, config FROM dashboard_widgets WHERE type = 'come_sta_andando'").all()
    .map((w) => { let c = {}; try { c = JSON.parse(w.config || '{}'); } catch (e) { /* vuoto */ } return { ...w, cfg: c }; })
    .filter((w) => w.cfg.monitor);
}

// Il testo del mese per un widget (senza commento dell'AI). Ritorna { text, snap } o null se non c'è niente da dire.
function buildText(widget, month, now = new Date()) {
  const view = insights.viewFromWidget(widget);
  const snap = insights.buildSnapshot(month, now, view);
  if (!snap.available) return null;
  const c = snap.confronti || {}, prec = c.mese_precedente || {};
  const righe = ['*Come sta andando — ' + (widget.label || 'riepilogo').replace(/^Come sta andando\s*[—-]\s*/i, '') + '* (' + meseLabel(snap.month) + ')'];
  if (snap.solo_spese) {
    righe.push('Spese ' + eur2(snap.spese) + (prec.spese_variazione_pct != null ? ' (' + pctTxt(prec.spese_variazione_pct) + ' sul mese prima)' : '') + ' · pagate ' + eur2(snap.spese_pagate) + ' · da pagare ' + eur2(snap.spese_da_pagare));
  } else {
    righe.push('Entrate ' + eur(snap.entrate) + ' · Spese ' + eur(snap.spese) + ' · Saldo ' + eur(snap.saldo) + (snap.risparmio_vero_pct != null ? ' · Risparmio ' + String(snap.risparmio_vero_pct).replace('.', ',') + '%' : ''));
  }
  const an = (snap.anomalie || []).slice(0, 3).map((a) => '• ' + a.nome + ' ' + eur(a.valore) + (a.tipo === 'categoria_nuova' ? ' (voce nuova)' : ' (' + pctTxt(a.variazione_pct) + ' sulla media)'));
  if (an.length) righe.push('Da guardare:', ...an);
  return { text: righe.join('\n'), snap };
}

// Manda il messaggio di un widget per un mese. Il commento dell'AI si aggiunge solo se l'AI è accesa e risponde.
async function sendFor(widget, month, now = new Date()) {
  const built = buildText(widget, month, now);
  if (!built) return { skipped: 'niente da dire' };
  let text = built.text;
  if (moduleAi.widgetExplainable(widget)) {
    try { const e = await insights.explain(built.snap); if (e && e.text) text += '\n\n' + e.text; } catch (e) { /* senza commento */ }
  }
  return require('./avvisi').sendText('report', text, 'monitoraggio');
}

// Controllo ogni minuto: il giorno e l'ora scelti, per ogni widget con il monitoraggio acceso e il mese non ancora inviato.
async function tick(now = new Date()) {
  const { date, hour } = romeParts(now);
  if (Number(date.slice(8, 10)) !== GIORNO || hour !== ORA) return { skipped: 'non è il momento' };
  ensure();
  const month = insights.lastClosedMonth(now);
  const out = [];
  for (const w of monitored()) {
    if (db.prepare('SELECT 1 FROM monitor_sent WHERE widget_id = ? AND month = ?').get(w.id, month)) continue;
    db.prepare('INSERT OR IGNORE INTO monitor_sent (widget_id, month) VALUES (?, ?)').run(w.id, month); // prima di inviare: un errore non diventa un messaggio al minuto
    out.push({ widget: w.id, esito: await sendFor(w, month, now) });
  }
  return { month, inviati: out };
}

let running = false;
function startMonitor() {
  setInterval(async () => {
    if (running) return;
    running = true;
    try { await tick(); } catch (e) { console.error('[monitor]', e.message); } finally { running = false; }
  }, 60 * 1000);
}

module.exports = { tick, sendFor, buildText, monitored, startMonitor, GIORNO, ORA };
