'use strict';
// «Ti manca un modulo?» — una volta alla settimana (core/backend/src/module-gap.js), un tenant manda
// la struttura (mai i valori) dei suoi moduli installati più qualche indizio già calcolato in locale
// (es. un campo di testo che ripete sempre gli stessi valori — vedi suggestions.js, rule_key
// testo_da_strutturare). Qui si aggiunge il catalogo della Libreria (pubblico, non del tenant) e si
// chiede all'AI UNA sola proposta tra: installa un modulo che già esiste, costruiscine uno nuovo, o
// niente. Si propone e basta: l'installazione la fa il tenant con un tocco (rotta già esistente), la
// costruzione la fa un umano nel Builder — qui nessuna scrittura.
const { redact } = require('./ai-redact');

const TIPI = ['installa', 'crea', 'nessuna'];
const clean = (v, n) => String(v == null ? '' : v).replace(/[\r\n]+/g, ' ').trim().slice(0, n);

const MODULE_GAP_PROMPT = `Sei un consulente che guarda i moduli già installati in un gestionale e si chiede se manca qualcosa di strutturale. Ricevi un JSON con "installati" (per ogni modulo: nome, campi con type, stati del flusso), "indizi" (osservazioni già calcolate su un campo di testo che sembra ripetere sempre gli stessi valori — potrebbe mancare un collegamento a un'entità vera) e "libreria" (i moduli già pronti che NON sono ancora installati: id, nome, descrizione).
Rispondi SOLO con un oggetto JSON, senza altro testo e senza blocchi markdown:
{"tipo":"installa|crea|nessuna","registry_module_id":numero o null,"nome":"nome del modulo da costruire, solo se tipo=crea","descrizione":"una frase su cosa dovrebbe fare, solo se tipo=crea","motivo":"una frase sul perché, sempre"}
Regole: "installa" SOLO se un modulo della libreria copre davvero un bisogno concreto che vedi (non un'idea vaga) — usa il suo id esatto. "crea" solo se nessun modulo della libreria copre quel bisogno E hai un indizio concreto (non basta "potrebbe sempre servire qualcosa"). Se non sei abbastanza sicuro, rispondi "nessuna": è la risposta giusta più spesso che no, meglio di un suggerimento a sensazione.`;

function sanitizeModuleGap(data) {
  if (!data || typeof data !== 'object') return { error: 'data obbligatorio' };
  const installati = (Array.isArray(data.installati) ? data.installati : []).slice(0, 25).map((m) => ({
    nome: clean(redact(m && m.nome), 80),
    campi: (Array.isArray(m && m.campi) ? m.campi : []).slice(0, 15).map((f) => ({ key: clean(f && f.key, 60), type: clean(f && f.type, 20) })).filter((f) => f.key),
    stati: (Array.isArray(m && m.stati) ? m.stati : []).slice(0, 10).map((s) => clean(redact(s), 60)).filter(Boolean),
  })).filter((m) => m.nome);
  if (!installati.length) return { error: 'installati obbligatorio (almeno un modulo)' };
  const indizi = (Array.isArray(data.indizi) ? data.indizi : []).slice(0, 8).map((x) => clean(redact(x), 200)).filter(Boolean);
  return { payload: { installati, indizi } };
}

function validateModuleGap(raw, libreria) {
  if (!raw || typeof raw !== 'object') return { error: 'Risposta non valida' };
  const tipo = TIPI.includes(raw.tipo) ? raw.tipo : 'nessuna';
  const motivo = clean(raw.motivo, 300);
  if (tipo === 'nessuna') return { proposta: { tipo, motivo } };
  if (tipo === 'installa') {
    const id = Number.isInteger(Number(raw.registry_module_id)) ? Number(raw.registry_module_id) : null;
    const mod = id ? libreria.find((m) => m.id === id) : null;
    if (!mod) return { proposta: { tipo: 'nessuna', motivo: '' } }; // un id inventato: meglio niente che un modulo a caso
    return { proposta: { tipo, registry_module_id: mod.id, nome: mod.name, descrizione: clean(mod.description, 300), motivo } };
  }
  // tipo === 'crea'
  const nome = clean(raw.nome, 60), descrizione = clean(raw.descrizione, 300);
  if (!nome) return { proposta: { tipo: 'nessuna', motivo: '' } };
  return { proposta: { tipo, nome, descrizione, motivo } };
}

module.exports = { MODULE_GAP_PROMPT, sanitizeModuleGap, validateModuleGap, TIPI };
