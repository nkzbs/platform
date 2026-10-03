'use strict';
// Commento e spiegazione dei report. Dal tenant arrivano SOLO totali per gruppo (le categorie
// scelte per raggruppare), mai le singole righe. Qui i dati si ripuliscono, si calcolano le
// variazioni percentuali (così l'AI non fa conti) e, dopo la risposta, si verifica che ogni
// numero scritto dal modello esista tra quelli forniti: se no, il testo viene scartato.
const { redact } = require('./ai-redact');

const MAX_GROUPS = 12;

function numOrNull(v) {
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}
const round2 = (n) => Math.round(n * 100) / 100;

// Ritorna { payload, numeri } oppure { error }.
function sanitizeReport(data) {
  if (!data || typeof data !== 'object') return { error: 'data obbligatorio' };
  if (!Array.isArray(data.gruppi) || data.gruppi.length === 0) return { error: 'Nessun gruppo da commentare' };
  const clean = (s, n) => redact(String(s == null ? '' : s)).replace(/[\r\n]+/g, ' ').trim().slice(0, n);
  const numeri = [];
  const gruppi = [];
  for (const g of data.gruppi.slice(0, MAX_GROUPS)) {
    const valore = numOrNull(g && g.valore);
    if (valore == null) continue;
    const confronto = g.confronto == null ? null : numOrNull(g.confronto);
    const row = { nome: clean(g.nome, 40) || 'Altro', valore: round2(valore) };
    numeri.push(row.valore);
    if (confronto != null) {
      row.confronto = round2(confronto);
      numeri.push(row.confronto);
      if (confronto !== 0) { row.variazione_pct = Math.round(((valore - confronto) / Math.abs(confronto)) * 1000) / 10; numeri.push(row.variazione_pct, Math.abs(row.variazione_pct)); }
    }
    gruppi.push(row);
  }
  if (!gruppi.length) return { error: 'Nessun gruppo valido' };
  const totale = numOrNull(data.totale);
  const totConf = data.totale_confronto == null ? null : numOrNull(data.totale_confronto);
  const payload = { titolo: clean(data.titolo, 80), periodo: clean(data.periodo, 60), metrica: clean(data.metrica, 40), funzione: clean(data.funzione, 20), gruppi };
  if (totale != null) { payload.totale = round2(totale); numeri.push(payload.totale); }
  if (totConf != null) {
    payload.totale_confronto = round2(totConf); numeri.push(payload.totale_confronto);
    if (totConf !== 0 && totale != null) { payload.variazione_totale_pct = Math.round(((totale - totConf) / Math.abs(totConf)) * 1000) / 10; numeri.push(payload.variazione_totale_pct, Math.abs(payload.variazione_totale_pct)); }
  }
  numeri.push(gruppi.length);
  return { payload, numeri };
}

// "1.234,50" -> 1234.5 ; "64,00" -> 64 ; "1.200" -> 1200 ; "12.5" -> 12.5
function parseNum(tok) {
  let t = tok.replace(/[.,]+$/, '');
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : null;
}

function matches(n, a) {
  return Math.abs(n - a) < 0.006 || Math.round(a) === n || Math.round(a * 10) / 10 === n;
}

// Ogni numero nel testo deve venire dai dati. Interi piccoli (<= 12: "3 categorie") e anni
// sono liberi, ma una percentuale deve essere una delle variazioni fornite.
function verifyNumbers(text, numeri) {
  const re = /(\d[\d.,]*)(\s*%)?/g;
  let m;
  while ((m = re.exec(text))) {
    const n = parseNum(m[1]);
    if (n == null) continue;
    const isPct = !!m[2];
    if (!isPct && Number.isInteger(n) && (n <= 12 || (n >= 2000 && n <= 2100))) continue;
    if (!numeri.some((a) => matches(n, a))) return { ok: false, numero: m[1] };
  }
  return { ok: true };
}

// ─── "Come sta andando": riepilogo di un mese già calcolato dal tenant ─────────
// Passano solo i campi previsti (numeri e nomi di categoria), ripuliti; tutti i numeri finiti
// nel payload sono quelli che il modello può citare.
const NUM_KEYS = ['entrate', 'spese', 'saldo', 'risparmio_pct', 'accantonato', 'risparmio_vero_pct', 'spese_pagate', 'spese_da_pagare', 'spese_fisse', 'spese_variabili'];
function sanitizeInsights(data) {
  if (!data || typeof data !== 'object') return { error: 'data obbligatorio' };
  if (!/^\d{4}-\d{2}$/.test(String(data.month || ''))) return { error: 'month non valido' };
  const clean = (v, n) => redact(String(v == null ? '' : v)).replace(/[\r\n]+/g, ' ').trim().slice(0, n);
  const numeri = [];
  const n = (v) => { const x = numOrNull(v); if (x == null) return null; numeri.push(x, Math.abs(x)); return round2(x); };
  const out = { mese: data.month, mese_in_corso: !!data.in_corso, accantonato_stimato: !!data.accantonato_stimato };
  for (const k of NUM_KEYS) { const v = data[k] == null ? null : n(data[k]); if (v != null) out[k] = v; }
  if (out.entrate == null || out.spese == null) return { error: 'entrate e spese obbligatorie' };
  const c = data.confronti || {};
  out.confronti = {};
  for (const [k, row] of Object.entries({ mese_precedente: c.mese_precedente, anno_precedente: c.anno_precedente, media_12_mesi: c.media_12_mesi })) {
    if (!row || typeof row !== 'object') continue;
    const r = {};
    for (const f of ['entrate', 'spese', 'spese_variazione_pct']) { const v = row[f] == null ? null : n(row[f]); if (v != null) r[f] = v; }
    if (row.mese) r.mese = clean(row.mese, 7);
    out.confronti[k] = r;
  }
  const cat = (x) => { const r = { nome: clean(x.nome, 40) || 'Altro' }; for (const f of ['valore', 'media_6m', 'variazione_pct']) { const v = x[f] == null ? null : n(x[f]); if (v != null) r[f] = v; } return r; };
  out.categorie = (Array.isArray(data.categorie) ? data.categorie : []).slice(0, 8).map(cat);
  out.anomalie = (Array.isArray(data.anomalie) ? data.anomalie : []).slice(0, 6).map((x) => ({ tipo: ['sopra_la_media', 'categoria_nuova'].includes(x.tipo) ? x.tipo : 'sopra_la_media', ...cat(x) }));
  numeri.push(out.categorie.length, out.anomalie.length);
  return { payload: out, numeri };
}

// Da inizio anno: stessi principi, campi dell'anno.
function sanitizeInsightsYear(data) {
  if (!data || typeof data !== 'object') return { error: 'data obbligatorio' };
  if (!/^\d{4}$/.test(String(data.year || '')) || !/^\d{4}-\d{2}$/.test(String(data.fino_a || ''))) return { error: 'year e fino_a non validi' };
  const clean = (v, n) => redact(String(v == null ? '' : v)).replace(/[\r\n]+/g, ' ').trim().slice(0, n);
  const numeri = [];
  const n = (v) => { const x = numOrNull(v); if (x == null) return null; numeri.push(x, Math.abs(x)); return round2(x); };
  const out = { periodo: 'anno', anno: String(data.year), fino_a: data.fino_a, accantonato_stimato: !!data.accantonato_stimato };
  for (const k of ['entrate', 'spese', 'saldo', 'risparmio_pct', 'accantonato', 'risparmio_vero_pct', 'spese_rate', 'spese_fisse', 'spese_variabili']) { const v = data[k] == null ? null : n(data[k]); if (v != null) out[k] = v; }
  if (out.entrate == null || out.spese == null) return { error: 'entrate e spese obbligatorie' };
  const ap = (data.confronti && data.confronti.anno_precedente) || null;
  if (ap) { const r = { anno: clean(ap.anno, 4) }; for (const f of ['entrate', 'spese', 'saldo', 'entrate_variazione_pct', 'spese_variazione_pct']) { const v = ap[f] == null ? null : n(ap[f]); if (v != null) r[f] = v; } out.confronto_anno_precedente = r; }
  out.categorie = (Array.isArray(data.categorie) ? data.categorie : []).slice(0, 8).map((x) => { const r = { nome: clean(x.nome, 40) || 'Altro' }; for (const f of ['valore', 'anno_prec', 'variazione_pct']) { const v = x[f] == null ? null : n(x[f]); if (v != null) r[f] = v; } return r; });
  numeri.push(out.categorie.length, Number(out.fino_a.slice(5)));
  return { payload: out, numeri };
}

const PROMPTS = {
  anno: `Sei un assistente che dice a una persona come sta andando la sua situazione finanziaria da inizio anno. Ricevi un JSON già calcolato: entrate (accreditate sul conto), spese, saldo (entrate meno spese), risparmio_pct, accantonato (la quota dello stipendio trattenuta in busta e messa in un fondo: non arriva sul conto ma è risparmio), risparmio_vero_pct (il risparmio contando anche l'accantonato), spese_rate, spese_fisse, spese_variabili (come si dividono le spese), confronto_anno_precedente (stesso periodo dell'anno prima) e categorie con valore, anno_prec e variazione_pct. Scrivi in italiano, massimo 130 parole, in tre parti: 1) come sei messo da inizio anno (in positivo o in negativo e di quanto, contando l'accantonato); 2) come si dividono le spese: quanta parte è già impegnata tra rate e spese fisse; 3) il confronto con l'anno scorso e al massimo due voci che spiccano. Se accantonato_stimato è true, di' che l'accantonato è in parte una stima. Scrivi come parleresti a una persona che conosci: dai del tu, frasi brevi e complete, soggetto sempre esplicito (non «Lo spiega la voce…», ma «Pesano soprattutto…»). Niente gergo («sopra la media del 26.9%» non dice nulla da solo): di' sempre di cosa parli e cosa significa. Le cifre sono quelle del JSON, scritte come sono, con € per i soldi e % per le percentuali; non arrotondare e non calcolare. USA SOLO numeri e nomi presenti nel JSON: non fare calcoli, non inventare, non dare consigli di investimento o fiscali, non fare supposizioni su cosa manca. Testo semplice: niente markdown, niente elenchi puntati, niente emoji.`,
  stato: `Sei un assistente che dice a una persona come sta andando il suo mese di finanze personali. Ricevi un JSON già calcolato: entrate (accreditate sul conto), spese, saldo (entrate meno spese), risparmio_pct, accantonato (la quota dello stipendio trattenuta in busta e messa in un fondo: non arriva sul conto ma è risparmio), risparmio_vero_pct (il risparmio contando anche l'accantonato), confronti (mese precedente, anno precedente, media degli ultimi 12 mesi), categorie con valore, media_6m e variazione_pct (rispetto alla media dei 6 mesi precedenti), anomalie. Scrivi in italiano, massimo 110 parole, in tre brevi frasi o gruppi di frasi: 1) com'è andato il mese (in positivo o in negativo e di quanto, con saldo e risparmio); 2) cosa ha pesato di più, nominando la categoria e di quanto è cambiata; 3) al massimo due cose da tenere d'occhio, prese solo da «anomalie» e dai confronti. Se mese_in_corso è true, avvisa che i dati sono parziali. Se accantonato_stimato è true, di' che l'accantonato è una stima. Parla di risparmio con risparmio_vero_pct quando accantonato è maggiore di zero. Scrivi come parleresti a una persona che conosci: dai del tu, frasi brevi e complete, soggetto sempre esplicito (non «Lo spiega la voce…», ma «Pesano soprattutto…»). Niente gergo («sopra la media del 26.9%» non dice nulla da solo): di' sempre di cosa parli e cosa significa. Le cifre sono quelle del JSON, scritte come sono, con € per i soldi e % per le percentuali; non arrotondare e non calcolare. USA SOLO numeri e nomi presenti nel JSON: non fare calcoli, non inventare, non dare consigli di investimento o fiscali, non fare supposizioni su cosa manca. Testo semplice: niente markdown, niente elenchi puntati, niente emoji.`,
  commento: `Sei un assistente che commenta un report di spese personali o familiari. Ricevi un JSON con i totali per categoria (valore, confronto col periodo precedente e variazione_pct già calcolata). Scrivi UN commento di una o due frasi, massimo 220 caratteri, in italiano, che dica cosa emerge di più importante (la voce più grande o la variazione più netta). USA SOLO numeri e nomi presenti nel JSON: non fare calcoli, non inventare, non dare consigli finanziari. Testo semplice: niente markdown, niente elenchi, niente emoji.`,
  spiegazione: `Sei un assistente che spiega un report di spese personali o familiari a chi lo sta guardando. Ricevi un JSON con i totali per categoria (valore, confronto col periodo precedente e variazione_pct già calcolata). Scrivi in italiano una spiegazione chiara di massimo 120 parole: le voci principali, cosa è cambiato rispetto al periodo precedente se c'è il confronto, cosa merita attenzione. USA SOLO numeri e nomi presenti nel JSON: non fare calcoli, non inventare, non dare consigli di investimento. Se i dati sono troppo pochi, dillo. Testo semplice: niente markdown, niente elenchi puntati.`,
};
const LIMITS = { anno: { chars: 1100, tokens: 460 }, stato: { chars: 1000, tokens: 420 }, commento: { chars: 260, tokens: 160 }, spiegazione: { chars: 1100, tokens: 450 } };

module.exports = { sanitizeInsightsYear, sanitizeInsights, sanitizeReport, verifyNumbers, parseNum, PROMPTS, LIMITS };
