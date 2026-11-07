'use strict';
// I DATI DIMOSTRATIVI: per mostrare cosa sa fare il portale si carica un po' di dati veri da OpenAPI.it (imprese dalle visure camerali, annunci vicino a un indirizzo) più qualche
// record inventato che li collega (clienti, una trattativa, una provvigione). Cosa caricare e in quali moduli lo dice il PACCHETTO del verticale (parte `dimostrativi`): qui non ci sono
// nomi di moduli né di campi. Ogni record caricato porta `_demo: true` (una chiave non dichiarata nello schema, come l'esito delle azioni esterne) e si toglie TUTTO con `rimuovi()`.
// Le richieste a pagamento chiedono prima il costo (piano) e si registrano nelle spese; la ricerca di imprese non ha costi.
//
// Forma di `dimostrativi` nel pacchetto:
//   fonti:   [{ id, tipo: 'imprese' | 'annunci', modulo, campi, ... }]
//              imprese: { provincia, limite }                        → un record per impresa trovata
//              annunci: { indirizzi: [...], per_indirizzo, tipologia_ricerca } → per ogni indirizzo: valutazione (per le coordinate) + annunci vicini
//   statici: [{ alias, modulo, campi, relazioni?: { campo: alias | 'fonte:<id>#<n>' }, stato? }]   record inventati, creati dopo le fonti
//   `campi`: valori o modelli: "{nome_del_dato}" (valore intero, anche numero), "testo {x} e {y}", "{oggi}" / "{oggi+14}" (date), o { da, mappa, predefinito }.
const db = require('../db');

const clone = (x) => JSON.parse(JSON.stringify(x));

// ── il pacchetto dimostrativo del tenant: il primo pacchetto attivo che ne ha uno ─────────────────────────────────────────────────────
function definizione() {
  const seeds = require('../seed-blocchi-verticale');
  for (const slug of seeds.pacchettiAttivi()) {
    const d = seeds.leggiPacchetto(slug).dimostrativi;
    if (d && ((Array.isArray(d.fonti) && d.fonti.length) || (Array.isArray(d.statici) && d.statici.length))) return { slug, fonti: d.fonti || [], statici: d.statici || [] };
  }
  return null;
}

const ISO = (d) => d.toISOString().slice(0, 10);
function valoreModello(modello, dati, adesso = new Date()) {
  if (modello && typeof modello === 'object' && !Array.isArray(modello)) {
    const grezzo = valoreModello('{' + modello.da + '}', dati, adesso);
    const mappa = modello.mappa || {};
    if (grezzo !== undefined && Object.prototype.hasOwnProperty.call(mappa, grezzo)) return mappa[grezzo];
    return modello.predefinito !== undefined ? modello.predefinito : undefined;
  }
  if (typeof modello !== 'string') return modello;
  const data = (nome) => { const m = /^oggi([+-]\d+)?$/.exec(nome); if (!m) return undefined; const d = new Date(adesso); d.setUTCDate(d.getUTCDate() + (m[1] ? parseInt(m[1], 10) : 0)); return ISO(d); };
  const risolvi = (nome) => (data(nome) !== undefined ? data(nome) : (dati || {})[nome]);
  const intero = /^\{([^{}]+)\}$/.exec(modello);
  if (intero) { const v = risolvi(intero[1]); return v === null || v === '' ? undefined : v; } // un solo segnaposto: il valore com'è (anche un numero)
  let manca = false;
  const out = modello.replace(/\{([^{}]+)\}/g, (_, n) => { const v = risolvi(n); if (v === undefined || v === null || v === '') { manca = true; return ''; } return String(v); });
  const pulito = out.trim().replace(/^[\s,·-]+|[\s,·-]+$/g, '');
  return manca && !pulito ? undefined : pulito;
}
const rendiCampi = (campi, dati, adesso) => { const o = {}; for (const [k, m] of Object.entries(campi || {})) { const v = valoreModello(m, dati, adesso); if (v !== undefined) o[k] = v; } return o; };

const campiDelModulo = (slug) => {
  const m = db.prepare('SELECT schema_json FROM modules WHERE slug = ? AND installed = 1').get(slug);
  if (!m) return null;
  try { return new Set((JSON.parse(m.schema_json).steps || []).filter((x) => ['field', 'relation'].includes(x.block_type) && x.key).map((x) => x.key)); } catch (e) { return null; }
};

// ── il piano: cosa verrebbe chiesto a OpenAPI.it e quanto costerebbe ────────────────────────────────────────────────────────────────
function piano(def) {
  const spese = require('./openapi-spese');
  const voci = [];
  for (const f of def.fonti) {
    if (f.tipo === 'imprese') voci.push({ fonte: f.id, descrizione: 'Ricerca di ' + (f.limite || 10) + ' imprese in provincia di ' + f.provincia, servizio: 'visure_ricerca_imprese', richieste: 1 });
    if (f.tipo === 'annunci') {
      const n = (f.indirizzi || []).length;
      voci.push({ fonte: f.id, descrizione: 'Valutazione di ' + n + ' indirizzi (per le coordinate)', servizio: 'valutazione_immobiliare', richieste: n });
      voci.push({ fonte: f.id, descrizione: 'Annunci vicini a ' + n + ' indirizzi', servizio: 'real_estate_comparabili', richieste: n });
    }
  }
  let totale = 0, ignoti = 0;
  for (const v of voci) { const st = spese.stima(v.servizio); v.nome = st.nome; v.costo_unitario = st.costo; v.noto = st.noto; if (st.noto) totale += st.costo * v.richieste; else if (v.richieste) ignoti++; }
  return { voci, totale: Math.round(totale * 1000) / 1000, ignoti };
}

// ── creazione e rimozione ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
function conta() {
  const out = {};
  for (const r of db.prepare("SELECT module_slug m, COUNT(*) n FROM records WHERE json_extract(data, '$._demo') = 1 GROUP BY module_slug").all()) out[r.m] = r.n;
  return out;
}
const totaleDemo = () => Object.values(conta()).reduce((a, b) => a + b, 0);

function statoIniziale(slug) {
  const m = db.prepare('SELECT schema_json FROM modules WHERE slug = ?').get(slug);
  if (!m) return null;
  try { const st = (require('../schema-v3').parseSchemaNormalized(m.schema_json).workflow || {}).states || []; return (st.find((x) => x.initial) || st[0] || {}).key || null; } catch (e) { return null; }
}

async function creaRecord(admin, callAs, modulo, dati, avvisi) {
  const ammessi = campiDelModulo(modulo);
  if (!ammessi) { avvisi.push('Il modulo «' + modulo + '» non è installato: salto.'); return null; }
  const puliti = {}, scartati = [];
  for (const [k, v] of Object.entries(dati)) { if (ammessi.has(k) || k === '_stato') puliti[k] = v; else scartati.push(k); }
  if (scartati.length) avvisi.push('«' + modulo + '»: campi che il modulo non ha, saltati (' + scartati.join(', ') + ').');
  // Come fa il form del modulo: senza uno stato scelto, il record parte dal primo stato del flusso (altrimenti la scheda mostra «—» e nessun passaggio possibile).
  if (puliti._stato === undefined) { const iniziale = statoIniziale(modulo); if (iniziale) puliti._stato = iniziale; }
  const r = await callAs(admin, 'POST', '/records/' + modulo, puliti);
  if (!r.ok) { avvisi.push('«' + modulo + '»: record non creato (' + String((r.data && r.data.error) || r.status).slice(0, 120) + ').'); return null; }
  db.prepare("UPDATE records SET data = json_set(data, '$._demo', 1) WHERE id = ?").run(r.data.id);
  return r.data.id;
}

// Carica i dati. `adesso` e `callAs` si possono sostituire (prove). Ritorna { creati: {modulo: n}, avvisi: [...] }.
async function carica({ utente, adesso = new Date(), callAs = require('./internal-api').callAs } = {}) {
  const def = definizione();
  if (!def) throw Object.assign(new Error('Nessun pacchetto attivo ha dati dimostrativi.'), { status: 404 });
  if (totaleDemo() > 0) throw Object.assign(new Error('Ci sono già dati dimostrativi: toglili prima di caricarne altri.'), { status: 409, code: 'gia_presenti' });
  const admin = db.prepare("SELECT * FROM users WHERE role = 'admin' LIMIT 1").get();
  if (!admin) throw Object.assign(new Error('Manca un utente amministratore.'), { status: 500 });
  const openapi = require('./openapi-it'), spese = require('./openapi-spese');
  const avvisi = [], creati = {}, perFonte = {}, alias = {};
  const conteggio = (m) => { creati[m] = (creati[m] || 0) + 1; };
  const registra = (servizio, descrizione) => spese.registra({ servizio, descrizione, costo: spese.stima(servizio).costo || 0, utente, riferimento: 'dati dimostrativi' });

  for (const f of def.fonti) {
    perFonte[f.id] = [];
    try {
      if (f.tipo === 'imprese') {
        const r = await openapi.cercaImprese({ provincia: f.provincia, limite: f.limite || 10 });
        registra('visure_ricerca_imprese', 'Dati dimostrativi: imprese in provincia di ' + f.provincia);
        for (const impresa of ((r && r.data) || []).slice(0, f.limite || 10)) {
          const id = await creaRecord(admin, callAs, f.modulo, rendiCampi(f.campi, impresa, adesso), avvisi);
          if (id) { perFonte[f.id].push(id); conteggio(f.modulo); }
        }
      } else if (f.tipo === 'annunci') {
        for (const indirizzo of (f.indirizzi || [])) {
          const v = await openapi.valoreAlMqAvanzato({ address: indirizzo, forSale: true, type: f.tipologia_ricerca || 20 });
          registra('valutazione_immobiliare', 'Dati dimostrativi: coordinate di ' + indirizzo);
          const co = v && v.data && v.data.coordinate;
          if (!co || !co.lat || !co.lng) { avvisi.push('Nessuna coordinata per «' + indirizzo + '»: nessun annuncio caricato per quell\'indirizzo.'); continue; }
          const a = await openapi.comparabili({ lat: co.lat, lng: co.lng, raggioMetri: f.raggio_metri || 3000, limite: f.per_indirizzo || 4, forSale: true });
          registra('real_estate_comparabili', 'Dati dimostrativi: annunci vicino a ' + indirizzo);
          for (const annuncio of ((a && a.data) || []).slice(0, f.per_indirizzo || 4)) {
            const id = await creaRecord(admin, callAs, f.modulo, rendiCampi(f.campi, annuncio, adesso), avvisi);
            if (id) { perFonte[f.id].push(id); conteggio(f.modulo); }
          }
        }
      }
      if (!perFonte[f.id].length) avvisi.push('La fonte «' + f.id + '» non ha dato nessun dato.');
    } catch (e) {
      avvisi.push('La fonte «' + f.id + '» non è riuscita: ' + String(e.message).slice(0, 160) + (e.status === 403 || e.status === 401 ? ' (probabilmente il servizio non è abilitato: «Controlla i servizi»)' : ''));
    }
  }

  const risolvi = (rif) => { const m = /^fonte:([^#]+)#(\d+)$/.exec(String(rif)); return m ? (perFonte[m[1]] || [])[parseInt(m[2], 10)] : alias[rif]; };
  for (const st of def.statici) {
    const dati = rendiCampi(st.campi, {}, adesso);
    for (const [campo, rif] of Object.entries(st.relazioni || {})) { const id = risolvi(rif); if (id) dati[campo] = id; }
    if (st.stato) dati._stato = st.stato;
    const id = await creaRecord(admin, callAs, st.modulo, dati, avvisi);
    if (id) { if (st.alias) alias[st.alias] = id; conteggio(st.modulo); }
  }
  return { creati, avvisi };
}

// Toglie TUTTI i record segnati come dimostrativi (e la loro cronologia). Ritorna { rimossi: {modulo: n} }.
function rimuovi() {
  const righe = db.prepare("SELECT id, module_slug FROM records WHERE json_extract(data, '$._demo') = 1").all();
  const rimossi = {};
  const tx = db.transaction(() => {
    for (const r of righe) {
      try { db.prepare('DELETE FROM record_history WHERE module_slug = ? AND record_id = ?').run(r.module_slug, r.id); } catch (e) { /* tabella assente: niente cronologia */ }
      db.prepare('DELETE FROM records WHERE id = ?').run(r.id);
      rimossi[r.module_slug] = (rimossi[r.module_slug] || 0) + 1;
    }
  });
  tx();
  return { rimossi };
}

module.exports = { statoIniziale, definizione, piano, conta, totaleDemo, carica, rimuovi, valoreModello, rendiCampi };
