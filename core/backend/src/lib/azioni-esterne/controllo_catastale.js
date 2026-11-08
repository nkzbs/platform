'use strict';
// Adattatore «controllo_catastale»: chiede al Catasto (OpenAPI.it) la visura di un immobile da provincia, comune, foglio, particella e subalterno, e confronta categoria e rendita con la scheda.
//   campi: { provincia, comune, foglio, particella, subalterno, categoria, rendita }   esito: { esito, data }   risultato_in: chiave non dichiarata con { id, stato, data, confronto }.
// La richiesta è ASINCRONA: si paga UNA volta, poi lo stesso pulsante ricontrolla senza costo. La forma della risposta si legge in modo tollerante (si cercano categoria e rendita in qualunque punto del
// risultato): se non si trovano, l'esito lo dice invece di inventare un confronto.
const openapiIt = require('../openapi-it');
const DOM = 'catasto';
const SCOPI = [['POST', '/visura_catastale'], ['GET', '/visura_catastale']];
const err = (m, status = 400, code) => Object.assign(new Error(m), { status, code });

async function disponibile() {
  const a = await openapiIt.servizioAttivo('catasto_visura', DOM, SCOPI);
  return a.ok ? a : { ok: false, motivo: 'serve il servizio Catasto di OpenAPI.it (visure). ' + a.motivo };
}
const inCorso = ({ dati, config }) => { const r = config.risultato_in && dati[config.risultato_in]; return !!(r && r.id && r.stato !== 'completata'); };

// Cerca in profondità la prima chiave che, senza maiuscole e simboli, vale una delle `nomi`; ritorna il valore (stringa o numero).
function trova(oggetto, nomi, profondita = 0) {
  if (!oggetto || typeof oggetto !== 'object' || profondita > 12) return null;
  const norma = (k) => String(k).toLowerCase().replace(/[^a-z]/g, '');
  for (const [k, v] of Object.entries(oggetto)) if (nomi.includes(norma(k)) && (typeof v === 'string' || typeof v === 'number') && String(v).trim() !== '') return v;
  for (const v of Object.values(oggetto)) { const r = trova(v, nomi, profondita + 1); if (r !== null) return r; }
  return null;
}
// «413,17» (virgola decimale, il punto separa le migliaia) oppure 413.17 / un numero: senza virgola il punto è decimale.
const numero = (v) => { if (typeof v === 'number') return v; const t = String(v).trim(); const n = parseFloat(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t); return n; };
const eq = (a, b) => String(a).trim().toUpperCase().replace(/[\s/]/g, '') === String(b).trim().toUpperCase().replace(/[\s/]/g, '');

function confronta(risultato, dati, C) {
  const catCat = trova(risultato, ['categoria']), catRen = trova(risultato, ['renditaeuro', 'rendita']);
  const righe = [];
  if (C.categoria && dati[C.categoria]) righe.push(catCat === null ? 'categoria: nella visura non c\'è' : (eq(catCat, dati[C.categoria]) ? 'categoria coincide (' + catCat + ')' : 'categoria DIVERSA: scheda ' + dati[C.categoria] + ', Catasto ' + catCat));
  if (C.rendita && dati[C.rendita] !== undefined && dati[C.rendita] !== '') {
    if (catRen === null) righe.push('rendita: nella visura non c\'è');
    else { const a = numero(dati[C.rendita]), b = numero(catRen); righe.push(Math.abs(a - b) < 0.02 ? 'rendita coincide (' + b + ' €)' : 'rendita DIVERSA: scheda ' + a + ' €, Catasto ' + b + ' €'); }
  }
  if (!righe.length) righe.push(catCat !== null || catRen !== null ? 'Catasto: categoria ' + (catCat || '—') + ', rendita ' + (catRen !== null ? catRen + ' €' : '—') + ' (la scheda non ha categoria e rendita da confrontare)' : 'la visura è arrivata ma non ho trovato categoria e rendita da confrontare');
  return righe;
}

async function esegui({ dati, config }) {
  const C = config.campi || {}, E = config.esito || {};
  const prec = config.risultato_in && dati[config.risultato_in];
  let id;
  if (prec && prec.id && prec.stato !== 'completata') id = prec.id;
  else {
    const provincia = String(dati[C.provincia] || '').trim().toUpperCase(), comune = String(dati[C.comune] || '').trim().toUpperCase();
    const foglio = String(dati[C.foglio] || '').trim(), particella = String(dati[C.particella] || '').trim(), sub = String(dati[C.subalterno] || '').trim();
    const mancanti = [['provincia', provincia], ['comune', comune], ['foglio', foglio], ['particella', particella]].filter(([, v]) => !v).map(([k]) => k);
    if (mancanti.length) throw err('Per il controllo catastale servono ' + mancanti.join(', ') + ': compilali nella scheda dell\'immobile.');
    const corpo = { entita: 'immobile', tipo_catasto: 'F', provincia, comune, foglio, particella, tipo_visura: 'ordinaria', tipo_dettaglio: 'sintetica', tipo_formato: 'json', richiedente: config.richiedente || 'Platform' };
    if (sub) corpo.subalterno = sub;
    const r = await openapiIt.chiama({ dominio: DOM, metodo: 'POST', percorso: '/visura_catastale', corpo, scopi: SCOPI });
    id = r && r.data && r.data.id;
    if (!id) throw err('OpenAPI.it non ha restituito l\'identificativo della visura.', 502);
  }
  let visura = null;
  for (let i = 0; i < 4; i++) {
    try { const r = await openapiIt.chiama({ dominio: DOM, percorso: '/visura_catastale/' + id, scopi: SCOPI }); visura = r && r.data; } catch (e) { visura = null; }
    if (visura && (visura.stato === 'evasa' || visura.risultato)) break;
    if (i < 3) await new Promise((r) => setTimeout(r, 3000));
  }
  const pronta = !!(visura && (visura.stato === 'evasa' || visura.risultato));
  const oggi = new Date().toISOString().slice(0, 10), patch = {};
  const confronto = pronta ? confronta(visura.risultato || visura, dati, C) : null;
  if (config.risultato_in) patch[config.risultato_in] = { id, stato: pronta ? 'completata' : 'in_corso', data: oggi, confronto };
  if (E.data) patch[E.data] = oggi;
  if (E.esito) patch[E.esito] = pronta ? confronto.join(' · ') : 'Richiesta inviata al Catasto: la visura è in preparazione. Premi di nuovo «Controllo dati catastali» per ricontrollare, senza altra spesa.';
  return { patch, risposta: { id, pronta, confronto }, audit: { id, pronta } };
}

module.exports = { nome: 'controllo_catastale', servizio: 'catasto_visura_immobile', disponibile, senzaCosto: inCorso, esegui, _confronta: confronta, _trova: trova };
