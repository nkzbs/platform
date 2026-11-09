'use strict';
// Adattatore «verifica_persona»: report sulla persona (Risk di OpenAPI.it: rischio, negatività, cariche, partecipazioni, immobili) dal codice fiscale.
// Non conosce nomi di moduli: il blocco dichiara i campi.
//   campi: { nome, cognome (facoltativo), codice_fiscale, tipo_soggetto, consenso }   `consenso` = campo data «informativa privacy firmata il»: senza, la verifica non parte.
//   esito: { esito, data }   i campi del record in cui scrive il riassunto e la data;  risultato_in: chiave non dichiarata con { id, stato, data } per riaprire il PDF.
// Il report è ASINCRONO (da minuti a ore): la richiesta si paga UNA volta, poi lo stesso pulsante ricontrolla (senza costo) finché il PDF non è pronto.
// Se il servizio non è abilitato sulla chiave, la funzione resta «da attivare» (nessuna richiesta, nessun costo).
const openapiIt = require('../openapi-it');
const DOM = 'risk';
// Solo gli scope che l'adattatore usa davvero: chiederne uno in più (es. la verifica del codice fiscale, un altro prodotto) fa fallire il token e la funzione resta «da attivare» anche con Risk attivo.
const SCOPI = [['POST', '/IT-report-persona'], ['GET', '/IT-report-persona']];
const CF = /^[A-Z]{6}\d{2}[A-Z]\d{2}[A-Z]\d{3}[A-Z]$/;

const stato = (r) => String((r && r.data && r.data.state) || '').toLowerCase();

async function disponibile() {
  const a = await openapiIt.servizioAttivo('risk_persona', DOM, SCOPI);
  return a.ok ? a : { ok: false, motivo: 'serve il servizio Risk di OpenAPI.it (report sulla persona). ' + a.motivo };
}
const err = (m, status = 400, code) => Object.assign(new Error(m), { status, code });

// Una richiesta già fatta e non ancora scaricata si ricontrolla senza pagare di nuovo.
const inCorso = ({ dati, config }) => { const r = config.risultato_in && dati[config.risultato_in]; return !!(r && r.id && r.stato !== 'completata' && r.stato !== 'fallita'); };

// Lo stato della richiesta presso OpenAPI.it (testo grezzo, es. «processing», «completed», «failed»): senza, una richiesta fallita sembra solo «non ancora pronta» per sempre.
async function statoRichiesta(id) {
  try { const r = await openapiIt.chiama({ dominio: DOM, percorso: '/IT-report-persona/' + id, scopi: SCOPI, timeout: 20000 }); const d = r && r.data; return { stato: stato(r), grezzo: d ? String(d.state || '') : '', messaggio: d && (d.message || d.error || d.reason) ? String(d.message || d.error || d.reason).slice(0, 200) : '' }; }
  catch (e) { return { stato: '', grezzo: '', messaggio: '' }; }
}
const FALLITA = /fail|error|errore|ko\b|reject|rifiut|annull|cancel|not.?found|nessun/i;

async function scarica(id) { return openapiIt.chiama({ dominio: DOM, percorso: '/IT-report-persona/' + id + '/download', scopi: SCOPI, binario: true, timeout: 60000 }); }
const èPdf = (r) => r && r.buffer && r.buffer.length > 200 && (/pdf/i.test(r.tipo) || r.buffer.slice(0, 4).toString() === '%PDF');

async function esegui({ dati, config }) {
  const C = config.campi || {}, E = config.esito || {};
  const patch = {};
  const prec = config.risultato_in && dati[config.risultato_in];
  let id;
  if (prec && prec.id && prec.stato !== 'completata') id = prec.id; // ricontrollo senza spesa
  else {
    if (/societ|azienda|giurid/i.test(String(dati[C.tipo_soggetto] || ''))) throw err('Questa verifica è per le persone fisiche: per una società usa «Credit score società».');
    if (C.consenso && !dati[C.consenso]) throw err('Manca il consenso: fai firmare l\'informativa privacy al cliente prima di verificarlo (campo «' + C.consenso + '»).');
    const cf = String(dati[C.codice_fiscale] || '').trim().toUpperCase().replace(/\s+/g, '');
    if (!CF.test(cf)) throw err('Il codice fiscale del cliente non è completo o non è valido (16 caratteri): correggilo prima di verificare.');
    let nome = String(dati[C.nome] || '').trim(), cognome = C.cognome ? String(dati[C.cognome] || '').trim() : '';
    if (!cognome) { const p = nome.split(/\s+/); nome = p.shift() || ''; cognome = p.join(' '); } // «Mario Rossi»: il primo nome, il resto cognome (scrivi un campo cognome per i nomi composti)
    if (!nome || !cognome) throw err('Servono nome e cognome del cliente.');
    const r = await openapiIt.chiama({ dominio: DOM, metodo: 'POST', percorso: '/IT-report-persona/', corpo: { name: nome, surname: cognome, taxCode: cf }, scopi: SCOPI });
    id = r && r.data && r.data.id;
    if (!id) throw err('OpenAPI.it non ha restituito l\'identificativo della richiesta.', 502);
  }
  // Prova a ottenere il PDF: pronto = la richiesta è finita.
  let pronto = false;
  for (let i = 0; i < 4 && !pronto; i++) {
    try { pronto = èPdf(await scarica(id)); } catch (e) { pronto = false; }
    if (!pronto && i < 3) await new Promise((r) => setTimeout(r, 3000));
  }
  const oggi = new Date().toISOString().slice(0, 10);
  let sr = { stato: '', grezzo: '', messaggio: '' }; if (!pronto) sr = await statoRichiesta(id);
  const fallita = !pronto && FALLITA.test(sr.grezzo);
  const nuovo = { id, stato: pronto ? 'completata' : fallita ? 'fallita' : 'in_corso', data: oggi, ...(sr.grezzo ? { stato_servizio: sr.grezzo } : {}) };
  if (config.risultato_in) patch[config.risultato_in] = nuovo;
  if (E.data) patch[E.data] = oggi;
  if (E.esito) patch[E.esito] = pronto ? 'Report sulla persona pronto: scaricalo dal menu «Verifica del soggetto» (PDF).' : fallita ? 'La richiesta è fallita presso OpenAPI.it (' + sr.grezzo + (sr.messaggio ? ': ' + sr.messaggio : '') + '). Premendo di nuovo «Verifica del soggetto» se ne fa una nuova (con conferma del costo).' : 'Richiesta inviata a OpenAPI.it, il report è in preparazione' + (sr.grezzo ? ' (stato presso OpenAPI.it: ' + sr.grezzo + ')' : '') + ' (da minuti a ore): premi di nuovo «Verifica del soggetto» (senza costo) per ricontrollare.';
  return { patch, risposta: { id, pronto }, audit: { id, pronto } };
}

async function pdf({ dati, config }) {
  const r = config.risultato_in && dati[config.risultato_in];
  if (!r || !r.id) throw err('Nessuna verifica richiesta per questa persona: avvia prima «Verifica del soggetto».');
  const f = await scarica(r.id).catch(() => null);
  if (!èPdf(f)) {
    const sr = await statoRichiesta(r.id);
    if (FALLITA.test(sr.grezzo)) throw err('La richiesta è fallita presso OpenAPI.it (' + sr.grezzo + (sr.messaggio ? ': ' + sr.messaggio : '') + '): premi «Verifica del soggetto» per farne una nuova.', 409);
    throw err('Il report non è ancora pronto' + (sr.grezzo ? ' (stato presso OpenAPI.it: ' + sr.grezzo + ')' : '') + ': riprova tra qualche minuto (premendo «Verifica del soggetto», senza costo).', 409);
  }
  return f.buffer;
}

module.exports = { nome: 'verifica_persona', servizio: 'risk_report_persona', disponibile, senzaCosto: inCorso, esegui, pdf, _CF: CF };
