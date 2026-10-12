
// Bot Telegram: le regole che dicono cosa può essere una risposta dell'AI. Condivise tra Super Admin (che valida la risposta del modello) e il tenant (che la
// rivalida prima di agire): le stesse regole in entrambi i posti, mai due copie che si allontanano. Qualsiasi cosa fuori elenco diventa «altro» o un errore, mai
// un'azione. Vedi super-admin/backend/src/lib/ai-bot.js e core/backend/src/bot-ai.js.
const AZIONI = ['domanda', 'elenco', 'segna_pagata', 'riapri', 'smista', 'nuova_spesa', 'timbra', 'ore', 'altro'];
const PERIODI_ORE = ['oggi', 'settimana', 'mese', 'mese_scorso'];
const ORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const COSE = ['pagare', 'scadute', 'smistare'];
const MODI = ['uno', 'rate', 'pagata'];
const ISO = /^\d{4}-\d{2}-\d{2}$/;

const clean = (v, n) => String(v == null ? '' : v).replace(/[\r\n]+/g, ' ').trim().slice(0, n);

const validDate = (s) => { if (!ISO.test(String(s))) return false; const d = new Date(s + 'T00:00:00Z'); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s; };

// Valida la risposta del modello contro i moduli disponibili. Ritorna { intent } oppure { error }.
function validateIntent(raw, moduli, oggi) {
  if (!raw || typeof raw !== 'object') return { error: 'Risposta non valida' };
  const azione = AZIONI.includes(raw.azione) ? raw.azione : 'altro';
  if (azione === 'domanda' || azione === 'altro') return { intent: { azione } };
  if (azione === 'elenco') return COSE.includes(raw.cosa) ? { intent: { azione, cosa: raw.cosa } } : { error: 'Elenco non riconosciuto' };

  if (azione === 'segna_pagata' || azione === 'riapri' || azione === 'smista') {
    const cerca = clean(raw.cerca, 60);
    if (cerca.length < 2) return { error: 'Non ho capito di quale voce parli' };
    if (azione !== 'smista') return { intent: { azione, cerca } };
    const modo = MODI.includes(raw.modo) ? raw.modo : 'uno';
    let n_rate = null;
    if (modo === 'rate') { n_rate = Math.round(Number(raw.n_rate)); if (!(n_rate >= 2 && n_rate <= 60)) n_rate = null; }
    const importo = raw.importo == null || raw.importo === '' ? null : Number(raw.importo);
    if (importo != null && !(Number.isFinite(importo) && importo >= 0 && importo <= 100000)) return { error: 'Importo non valido' };
    const scadenza = raw.scadenza && validDate(raw.scadenza) ? raw.scadenza : null;
    return { intent: { azione, cerca, modo, n_rate, importo: importo == null ? null : Math.round(importo * 100) / 100, scadenza } };
  }

  if (azione === 'timbra') {
    if (raw.tipo !== 'entrata' && raw.tipo !== 'uscita') return { error: 'Non ho capito se è un\'entrata o un\'uscita' };
    const ora = ORA.test(String(raw.ora || '')) ? raw.ora : null;
    // la data di una timbratura: valida e vicina (non nel futuro, non più vecchia di due mesi) se si conosce «oggi»; altrimenti solo valida
    let data = raw.data && validDate(raw.data) ? raw.data : null;
    if (data && oggi) { const g = (iso) => Math.round((new Date(iso + 'T00:00:00Z') - new Date(oggi + 'T00:00:00Z')) / 86400000); if (g(data) > 0 || g(data) < -62) data = null; }
    return { intent: { azione, tipo: raw.tipo, ora, data } };
  }
  if (azione === 'ore') return { intent: { azione, periodo: PERIODI_ORE.includes(raw.periodo) ? raw.periodo : 'settimana' } };

  // nuova_spesa
  const importo = Number(raw.importo);
  if (!(Number.isFinite(importo) && importo > 0 && importo <= 100000)) return { error: 'Importo non valido' };
  const descrizione = clean(raw.descrizione, 80);
  if (descrizione.length < 2) return { error: 'Manca la descrizione' };
  const modulo = raw.modulo ? (moduli.find((m) => m.slug === raw.modulo) || null) : null;
  let categoria = null;
  if (raw.categoria && modulo) { const c = modulo.categorie.find((x) => x.toLowerCase() === String(raw.categoria).trim().toLowerCase()); categoria = c || null; }
  return { intent: { azione, descrizione, importo: Math.round(importo * 100) / 100, data: raw.data && validDate(raw.data) ? raw.data : null, modulo: modulo ? modulo.slug : null, pagata: raw.pagata === true, categoria } };
}


export { AZIONI, COSE, MODI, PERIODI_ORE, ISO, validateIntent, validDate };
