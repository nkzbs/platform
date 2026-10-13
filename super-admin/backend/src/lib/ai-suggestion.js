'use strict';
// «Spiega e proponi» per un suggerimento di miglioramento (core/backend/src/suggestions.js). Il modello riceve la struttura del modulo (campi con nome e tipo, stati) e i conteggi
// dell'osservazione: MAI i valori delle righe. Risponde con una spiegazione e al massimo quattro cose da fare, più un tipo di azione da un elenco chiuso. Si propone e basta: niente
// si applica da solo, chi guarda decide e modifica dal Builder.
const { redact } = require('./ai-redact');

const AZIONI = ['rendi_scelta', 'togli_campo', 'sblocca_righe', 'aggiungi_passaggio', 'togli_passaggio', 'altro'];
const clean = (v, n) => String(v == null ? '' : v).replace(/[\r\n]+/g, ' ').trim().slice(0, n);

const SUGGESTION_PROMPT = `Sei un consulente che aiuta a migliorare un modulo di un gestionale, guardando come viene usato. Ricevi un JSON con "regola" (il tipo di osservazione), "modulo", "titolo" (cosa è stato osservato), "numeri" (i conteggi), "target" (il campo o lo stato di cui si parla), "campi" (key, label, type) e "stati".
Non hai i dati delle righe, solo la struttura e i numeri: non inventare valori e non fingere di conoscere le abitudini delle persone.
Rispondi SOLO con un oggetto JSON, senza altro testo e senza blocchi markdown:
{"spiegazione":"2 frasi: perché potrebbe essere un problema o un'occasione, con prudenza ('potrebbe')","cosa_fare":["al massimo 4 passi concreti nel Builder o nell'uso quotidiano"],"azione":"una tra: ${AZIONI.join(', ')}"}
Regole: usa un tono semplice e prudente; un campo mai compilato potrebbe essere inutile ma anche dimenticato; righe ferme potrebbero essere un collo di bottiglia o lavoro finito e non chiuso; un passaggio mai raggiunto potrebbe essere inutile o saltato. Suggerisci prima di verificare, poi di cambiare.`;

function sanitizeSuggestion(data) {
  if (!data || typeof data !== 'object') return { error: 'data obbligatorio' };
  const regola = clean(data.regola, 40);
  if (!/^[a-z_]{3,40}$/.test(regola)) return { error: 'Osservazione non valida' };
  const numeri = {};
  for (const [k, v] of Object.entries(data.numeri && typeof data.numeri === 'object' ? data.numeri : {})) if (/^[a-z_]{1,30}$/.test(k) && (typeof v === 'number' || typeof v === 'boolean')) numeri[k] = v;
  return { payload: {
    regola, modulo: clean(redact(data.modulo), 80), titolo: clean(redact(data.titolo), 240), numeri, target: clean(data.target, 60),
    campi: (Array.isArray(data.campi) ? data.campi : []).slice(0, 40).map((f) => ({ key: clean(f && f.key, 60), label: clean(redact(f && f.label), 60), type: clean(f && f.type, 20) })).filter((f) => f.key),
    stati: (Array.isArray(data.stati) ? data.stati : []).slice(0, 20).map((s) => ({ key: clean(s && s.key, 60), label: clean(redact(s && s.label), 60) })).filter((s) => s.key),
  } };
}

function validateSuggestion(raw) {
  if (!raw || typeof raw !== 'object') return { error: 'Risposta non valida' };
  const spiegazione = clean(raw.spiegazione, 500);
  const cosa_fare = (Array.isArray(raw.cosa_fare) ? raw.cosa_fare : []).map((x) => clean(x, 240)).filter(Boolean).slice(0, 4);
  if (!spiegazione || !cosa_fare.length) return { error: 'Risposta incompleta' };
  return { proposta: { spiegazione, cosa_fare, azione: AZIONI.includes(raw.azione) ? raw.azione : 'altro' } };
}

module.exports = { SUGGESTION_PROMPT, sanitizeSuggestion, validateSuggestion, AZIONI };
