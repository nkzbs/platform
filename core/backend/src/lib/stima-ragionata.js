'use strict';
// La «stima ragionata» del report di valutazione: invece del solo valore a media di zona (la fonte più prudente: la media di TUTTO il patrimonio della zona) mette insieme, con regole
// scritte e leggibili, i dati che il report ha già salvato (nessuna nuova richiesta a OpenAPI.it, nessun costo):
//   1. la fascia OMI «abitazioni civili» scelta in base allo STATO della scheda (Ottimo → OTTIMO, Buono → NORMALE, Da ristrutturare → SCADENTE; senza stato: NORMALE);
//   2. le PERTINENZE che hanno una superficie indicata (box/garage) a quotazione OMI delle autorimesse; cantina, solaio e portico non si quotano (restano nella nota);
//   3. un CONTROLLO con gli annunci vicini: mediana dei prezzi richiesti di immobili simili (di solito più alti dei prezzi di vendita).
// È una stima indicativa, non una perizia. Funzione pura: nessun nome di azienda o di zona qui, tutto viene dal report e dalla scheda.

const num = (n) => { const v = parseFloat(n); return isFinite(v) ? v : null; };
const tondo = (v) => Math.round(v / 1000) * 1000;
const mediana = (a) => { const s = a.slice().sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// Stato della scheda → condizione OMI.
function condizioneOmi(stato) {
  const s = String(stato || '').toLowerCase();
  if (/ottim|nuov|ristruttura(to|ta)\b(?! da)/.test(s) && !/da ristrutturare/.test(s)) return 'OTTIMO';
  if (/da ristrutturare|scadent|pessim|cattiv/.test(s)) return 'SCADENTE';
  return 'NORMALE';
}

function cercaOmi(values, tipoRegex, condizione) {
  const righe = (values || []).filter((v) => tipoRegex.test(String(v.property_type || '')) && v.sale && num(v.sale.min) !== null && num(v.sale.max) !== null);
  return righe.find((v) => String(v.condition || '').toUpperCase() === condizione) || null;
}

const ESCLUSI_ANNUNCI = /vill|terren|rustic|capannon|negozi|uffic|box|garage|autorimess|magazzin|laborator/i;

// → null se non si può calcolare (manca la superficie o le quotazioni OMI); altrimenti { appartamento, pertinenze, totale, annunci, zona, note }.
function stimaRagionata({ dati = {}, report = {} } = {}) {
  const mq = num(dati.superficie_mq);
  const omi = report.omi;
  if (!mq || mq <= 0 || !omi || !Array.isArray(omi.values)) return null;
  const note = [];
  const cond = condizioneOmi(dati.stato_edificio);
  if (!dati.stato_edificio) note.push('Stato dell\'edificio non indicato nella scheda: si usa la fascia OMI «normale».');
  let riga = cercaOmi(omi.values, /abitazioni civili/i, cond);
  let usata = cond;
  if (!riga && cond !== 'NORMALE') { riga = cercaOmi(omi.values, /abitazioni civili/i, 'NORMALE'); usata = 'NORMALE'; if (riga) note.push('Per lo stato «' + dati.stato_edificio + '» l\'OMI non ha una fascia propria: si usa la «normale».'); }
  if (!riga) return null;
  const min = num(riga.sale.min), max = num(riga.sale.max);
  const appartamento = { eur_mq_min: min, eur_mq_max: max, mq, condizione: usata, zona: omi.omi_zone || null, descrizione: (omi.zone && omi.zone.description) || null, min: mq * min, max: mq * max };

  // Pertinenze: solo quelle con una superficie scritta nella scheda.
  const pertinenze = [];
  const elenco = [].concat(dati.pertinenze_box || [], dati.posto_auto || []).map(String).join(' | ').toLowerCase();
  const haBox = /garage|box|autorimess/.test(elenco) || (Array.isArray(dati.posto_auto) && dati.posto_auto.some((x) => /coperto|propriet/i.test(String(x))));
  const mqBox = num(dati.superficie_box_mq);
  if (haBox && mqBox) {
    const q = cercaOmi(omi.values, /autorimess/i, 'NORMALE') || cercaOmi(omi.values, /^box/i, 'NORMALE') || cercaOmi(omi.values, /posti auto coperti/i, 'NORMALE');
    if (q) pertinenze.push({ nome: 'Box / garage', mq: mqBox, eur_mq_min: num(q.sale.min), eur_mq_max: num(q.sale.max), fonte: q.property_type, min: mqBox * num(q.sale.min), max: mqBox * num(q.sale.max) });
    else note.push('Box o garage presente, ma l\'OMI non ha una quotazione per le autorimesse in questa zona: non incluso.');
  } else if (haBox) note.push('Box o garage presente nella scheda ma senza superficie: scrivi i mq in «Superficie box/garage (mq)» per includerlo nella stima.');
  if (/cantina|solaio|soffitta/.test(elenco) || num(dati.portico_mq) || /portico/i.test([].concat(dati.sfogo_esterno || []).join(' '))) note.push('Cantina, solaio e portico non si quotano a parte: non sono inclusi nella stima.');

  const totale = { min: appartamento.min + pertinenze.reduce((t, p) => t + p.min, 0), max: appartamento.max + pertinenze.reduce((t, p) => t + p.max, 0) };
  totale.med = (totale.min + totale.max) / 2;

  // Controllo con gli annunci vicini: simili per tipo e per superficie.
  let annunci = null;
  const comp = (report.comparabili || []).filter((c) => num(c.price_per_sqm) !== null && num(c.total_sqm) !== null && !ESCLUSI_ANNUNCI.test(String(c.property_type || '')));
  const simili = comp.filter((c) => num(c.total_sqm) >= mq * 0.6 && num(c.total_sqm) <= mq * 1.6);
  const usati = simili.length >= 3 ? simili : comp;
  if (usati.length >= 3) { const m = mediana(usati.map((c) => num(c.price_per_sqm))); annunci = { n: usati.length, mediana_eur_mq: m, valore: m * mq }; }

  const q = (report.dettaglio && report.dettaglio.quotazione) || {};
  const zona = num(q.med) ? { eur_mq: num(q.med), valore: num(q.med) * mq } : null;
  return { appartamento, pertinenze, totale, annunci, zona, note, tondo };
}

module.exports = { stimaRagionata, condizioneOmi, tondo, mediana };
