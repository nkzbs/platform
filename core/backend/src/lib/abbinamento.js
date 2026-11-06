'use strict';
// Motore dell'«abbinamento» (blocco di schema `match_view`): dato un record, trova in un altro
// modulo i record che gli corrispondono secondo regole dichiarate dal Builder — es. su un
// Cliente «Immobili adatti» (tipologia cercata, budget, zona), su un Immobile «Richieste
// compatibili». Nessun nome di modulo o di campo qui: tutto arriva dalla definizione.
// Funzioni pure (niente database): la lettura dei record sta in routes/records.js.
//
// Regola: { mine, theirs, op, required?, label? }
//   mine    campo del record che sto guardando
//   theirs  campo del candidato (o una lista di campi: basta che uno vada bene — es. comune,
//           zona e località per una «zona» scritta a mano)
//   op      testo          i due testi si «toccano» (uno contiene l'altro, senza maiuscole né
//                          accenti; liste separate da , ; / valgono voce per voce)
//           uguale         stesso valore (testo senza maiuscole né accenti, o stesso numero)
//           theirs<=mine   numero del candidato ≤ il mio (es. prezzo dell'immobile ≤ mio budget)
//           theirs>=mine   numero del candidato ≥ il mio (es. budget del cliente ≥ mio prezzo)
//   required  vincolo: se fallisce il candidato è escluso, se passa non dà punti. Le regole non
//             obbligatorie sono affinità: fanno il punteggio (quante su quelle valutabili) e il
//             candidato deve soddisfarne almeno una
// Se il MIO campo è vuoto la regola viene saltata (un cliente senza budget non esclude nessuno),
// e non conta né a favore né contro. Se è il campo del candidato a mancare, la regola fallisce.

const OPERATORI = ['testo', 'uguale', 'theirs<=mine', 'theirs>=mine'];

function vuoto(v) {
  return v == null || v === '' || v === false || (Array.isArray(v) && v.length === 0);
}

function normalizza(v) {
  return String(v).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

function voci(v) {
  const lista = Array.isArray(v) ? v : String(v).split(/[,;/]+/);
  return lista.map(normalizza).filter(Boolean);
}

function numero(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  // Formato italiano scritto a mano: «1.500,50» (punto = migliaia, virgola = decimali). Senza virgola il punto resta decimale.
  const t = String(v).replace(/\s/g, '');
  const n = parseFloat(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
  return Number.isFinite(n) ? n : null;
}

function confronta(op, mio, loro) {
  switch (op) {
    case 'testo': {
      const a = voci(mio), b = voci(loro);
      return a.some((x) => b.some((y) => x.includes(y) || y.includes(x)));
    }
    case 'uguale': {
      const nm = numero(mio), nl = numero(loro);
      if (nm !== null && nl !== null && !/[a-z]/i.test(String(mio) + String(loro))) return nm === nl;
      return normalizza(mio) === normalizza(loro);
    }
    case 'theirs<=mine': { const m = numero(mio), l = numero(loro); return m !== null && l !== null && l <= m; }
    case 'theirs>=mine': { const m = numero(mio), l = numero(loro); return m !== null && l !== null && l >= m; }
    default: return false;
  }
}

// → 'saltata' | 'ok' | 'ko'
function valutaRegola(regola, mioDato, loroDato) {
  const mio = mioDato[regola.mine];
  if (vuoto(mio)) return 'saltata';
  const campi = Array.isArray(regola.theirs) ? regola.theirs : [regola.theirs];
  const valori = campi.map((c) => loroDato[c]).filter((v) => !vuoto(v));
  if (valori.length === 0) return 'ko';
  return valori.some((v) => confronta(regola.op, mio, v)) ? 'ok' : 'ko';
}

function etichettaRegola(r) {
  return r.label || (r.mine + ' ~ ' + (Array.isArray(r.theirs) ? r.theirs.join('/') : r.theirs));
}

// Il filtro sul candidato: { field, in: [...] } oppure { field, equals }. `_stato` è lo stato del workflow.
function passaFiltro(filtro, dato) {
  if (!filtro || !filtro.field) return true;
  const v = dato[filtro.field];
  if (Array.isArray(filtro.in)) return filtro.in.map(String).includes(String(v));
  if (filtro.equals !== undefined) return String(v) === String(filtro.equals);
  return true;
}

// definizione: { rules, target_filter?, when? }   mioDato: dati del record   candidati: [{ id, data, updated_at? }]
// → { applicabile, valutabili, items: [{ id, data, punteggio, soddisfatte[], mancanti[] }] }
//   applicabile  false se la condizione `when` sul mio record non è vera (la sezione non si mostra)
//   valutabili   quante regole hanno un mio valore (0 = niente da confrontare: «compila i criteri»)
function calcolaAbbinamenti(definizione, mioDato, candidati) {
  const regole = (definizione.rules || []).filter((r) => r && r.mine && r.theirs && OPERATORI.includes(r.op));
  const mio = mioDato || {};
  if (!passaFiltro(definizione.when, mio)) return { applicabile: false, valutabili: 0, items: [] };
  const valutabili = regole.filter((r) => !vuoto(mio[r.mine])).length;
  if (valutabili === 0) return { applicabile: true, valutabili: 0, items: [] };

  const items = [];
  for (const c of candidati || []) {
    const dato = c.data || {};
    if (!passaFiltro(definizione.target_filter, dato)) continue;
    // Le regole obbligatorie sono VINCOLI (se falliscono il candidato è escluso, se passano non
    // danno punti); le altre sono AFFINITÀ e fanno il punteggio. Un candidato che passa solo i
    // vincoli, senza nessuna affinità, non è un abbinamento (es. chi ha abbastanza budget ma cerca
    // tutt'altro). Se TUTTE le regole sono obbligatorie bastano i vincoli.
    let vincoliOk = true, affinitaValutate = 0, affinitaOk = 0;
    const soddisfatte = [], mancanti = [];
    for (const r of regole) {
      const esito = valutaRegola(r, mio, dato);
      if (esito === 'saltata') continue;
      if (r.required) {
        if (esito === 'ko') { vincoliOk = false; break; }
        soddisfatte.push(etichettaRegola(r));
        continue;
      }
      affinitaValutate++;
      if (esito === 'ok') { affinitaOk++; soddisfatte.push(etichettaRegola(r)); }
      else mancanti.push(etichettaRegola(r));
    }
    if (!vincoliOk) continue;
    if (affinitaValutate > 0 && affinitaOk === 0) continue;
    items.push({ id: c.id, data: dato, punteggio: affinitaValutate > 0 ? affinitaOk / affinitaValutate : 1, soddisfatte, mancanti, _t: c.updated_at || '' });
  }
  items.sort((a, b) => (b.punteggio - a.punteggio) || (a._t < b._t ? 1 : a._t > b._t ? -1 : 0) || (a.id < b.id ? 1 : -1));
  return { applicabile: true, valutabili, items: items.map(({ _t, ...resto }) => resto) };
}

module.exports = { calcolaAbbinamenti, valutaRegola, confronta, OPERATORI };
