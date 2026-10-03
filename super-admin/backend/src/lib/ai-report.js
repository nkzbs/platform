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

const PROMPTS = {
  commento: `Sei un assistente che commenta un report di spese personali o familiari. Ricevi un JSON con i totali per categoria (valore, confronto col periodo precedente e variazione_pct già calcolata). Scrivi UN commento di una o due frasi, massimo 220 caratteri, in italiano, che dica cosa emerge di più importante (la voce più grande o la variazione più netta). USA SOLO numeri e nomi presenti nel JSON: non fare calcoli, non inventare, non dare consigli finanziari. Testo semplice: niente markdown, niente elenchi, niente emoji.`,
  spiegazione: `Sei un assistente che spiega un report di spese personali o familiari a chi lo sta guardando. Ricevi un JSON con i totali per categoria (valore, confronto col periodo precedente e variazione_pct già calcolata). Scrivi in italiano una spiegazione chiara di massimo 120 parole: le voci principali, cosa è cambiato rispetto al periodo precedente se c'è il confronto, cosa merita attenzione. USA SOLO numeri e nomi presenti nel JSON: non fare calcoli, non inventare, non dare consigli di investimento. Se i dati sono troppo pochi, dillo. Testo semplice: niente markdown, niente elenchi puntati.`,
};
const LIMITS = { commento: { chars: 260, tokens: 160 }, spiegazione: { chars: 1100, tokens: 450 } };

module.exports = { sanitizeReport, verifyNumbers, parseNum, PROMPTS, LIMITS };
