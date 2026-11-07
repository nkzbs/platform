'use strict';
// Adattatore «valutazione_immobiliare» delle azioni esterne (blocco di schema `external_action`): stima il valore di un immobile con le quotazioni di OpenAPI.it
// e lo arricchisce con comparabili, OMI, fotovoltaico (PVGIS) e zona sismica (ISPRA). Non conosce nomi di moduli né di campi: li dichiara il blocco.
//   campi:      { indirizzo, comune, provincia, tipologia, superficie }   i campi del record da cui legge
//   esito:      { valore, al_mq, data, fonte }                            i campi del record in cui scrive
//   tipologie:  { <etichetta della tipologia>: <codice OpenAPI.it> }, tipologia_predefinita: codice se la tipologia non è tra quelle mappate
//   risultato_in: la chiave (non dichiarata come campo) in cui il report completo resta sul record, per riaprirlo e farne il PDF senza richiamare il servizio.
const num = (v) => parseFloat(v);

async function esegui({ dati, config }) {
  const C = config.campi || {}, E = config.esito || {};
  const indirizzo = [dati[C.indirizzo], dati[C.comune], dati[C.provincia]].filter(Boolean).join(', ');
  if (!indirizzo.trim()) { const e = new Error('Serve almeno un indirizzo o un comune per valutare l\'immobile.'); e.status = 400; throw e; }
  const type = (config.tipologie || {})[dati[C.tipologia]] || config.tipologia_predefinita || 20; // un codice di riserva ragionevole: non blocca la valutazione

  const openapiIt = require('../openapi-it');
  const result = await openapiIt.valoreAlMqAvanzato({ address: indirizzo, forSale: true, type });
  const dettaglio = result.data || {};
  const q = dettaglio.quotazione || {};
  const eurMq = parseFloat(String(q.med || '').replace(/[^0-9.]/g, '')) || null;
  const superficie = num(dati[C.superficie]) || null;
  const stimaValore = eurMq && superficie ? Math.round(eurMq * superficie) : null;

  // Comparabili e OMI partono dalle coordinate trovate dalla valutazione avanzata; fotovoltaico e zona sismica sono fonti pubbliche gratuite (JRC PVGIS, ISPRA).
  // Nessuna blocca la valutazione principale se non risponde o non copre il punto: la stima resta valida.
  const rischiTerritorio = require('../rischi-territorio');
  let comparabili = null, omiZona = null, fotovoltaico = null, zonaSismicaUff = null;
  const coord = dettaglio.coordinate;
  if (coord && coord.lat && coord.lng) {
    try { comparabili = (await openapiIt.comparabili({ lat: coord.lat, lng: coord.lng, forSale: true })).data || []; } catch (e) { console.error('[azione esterna] comparabili non riuscito:', e.message); }
    try { omiZona = (await openapiIt.omi({ lat: coord.lat, lng: coord.lng })).data || null; } catch (e) { console.error('[azione esterna] OMI non riuscito:', e.message); }
    try { fotovoltaico = await rischiTerritorio.fotovoltaico({ lat: coord.lat, lng: coord.lng }); } catch (e) { console.error('[azione esterna] fotovoltaico (PVGIS) non riuscito:', e.message); }
    try { zonaSismicaUff = await rischiTerritorio.zonaSismica({ lat: coord.lat, lng: coord.lng }); } catch (e) { console.error('[azione esterna] zona sismica (ISPRA) non riuscita:', e.message); }
  }

  // Considerazioni del valutatore: paragrafo dell'AI già configurata, best-effort (senza, il report resta valido).
  const demo = dettaglio.demografico || {};
  const dinamicitaAnni = demo.capoluoghi_vendite_zona && typeof demo.capoluoghi_vendite_zona === 'object' ? Object.values(demo.capoluoghi_vendite_zona) : [];
  const ultimaDinamicita = dinamicitaAnni.length ? dinamicitaAnni[dinamicitaAnni.length - 1].dinamicita_mercato_residenziale : null;
  const tempiVendita = Array.isArray(dettaglio.tempistiche) && Array.isArray(dettaglio.tempistiche[0]) ? dettaglio.tempistiche[0] : [];
  const tempoVenditaMedio = tempiVendita.length ? Math.round(tempiVendita.reduce((s, t) => s + (t.media_giorni || 0), 0) / tempiVendita.length) : null;
  const considerazioni = await require('../ai-valutazione').considerazioni({
    tipologia: dati[C.tipologia], comune: dettaglio.citta || dati[C.comune], zona: dettaglio.nome, // la città del report: i numeri sono di quel luogo, non del comune scritto sul record
    superficie_mq: superficie, quotazione_min: q.min, quotazione_media: eurMq, quotazione_max: q.max, valore_stimato: stimaValore,
    rischio_sismico: demo.rischio_sismico, zona_sismica_ufficiale: zonaSismicaUff && zonaSismicaUff.zona,
    dinamicita_mercato: ultimaDinamicita, tempo_vendita_giorni: tempoVenditaMedio, comparabili_count: (comparabili || []).length,
  });

  // L'esito sta SUL record (non solo nella risposta): resta visibile da subito e, quando l'immobile sarà venduto, si potrà confrontare la stima col prezzo reale.
  const patch = {};
  if (E.valore) patch[E.valore] = stimaValore;
  if (E.al_mq) patch[E.al_mq] = eurMq;
  if (E.data) patch[E.data] = new Date().toISOString().slice(0, 10);
  if (E.fonte) patch[E.fonte] = 'OpenAPI.it — quotazioni di zona (avanzata)';
  if (config.risultato_in) patch[config.risultato_in] = { dettaglio, comparabili, omi: omiZona, fotovoltaico, zonaSismicaUfficiale: zonaSismicaUff, considerazioni };
  return {
    patch,
    risposta: { dettaglio, comparabili, omi: omiZona, fotovoltaico, zonaSismicaUfficiale: zonaSismicaUff, considerazioni },
    audit: { eur_mq: eurMq, stima_valore: stimaValore },
  };
}

// PDF del report salvato sul record: nessuna chiamata al servizio, nessun credito consumato.
async function pdf({ id, dati, config, identita }) {
  const report = config.risultato_in && dati[config.risultato_in];
  if (!report) { const e = new Error('Questo immobile non è ancora stato valutato: avvia prima la valutazione.'); e.status = 400; throw e; }
  return require('../report-valutazione-pdf').creaPdfReport({ record: { id, data: dati }, report, ...identita });
}

// `servizio`: la voce del listino di OpenAPI.it (lib/openapi-spese.js) che questa azione consuma: la rotta chiede la conferma del costo e registra la spesa.
module.exports = { nome: 'valutazione_immobiliare', servizio: 'valutazione_immobiliare', esegui, pdf };
