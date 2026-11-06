'use strict';
// Motore del "documento da modello" (blocco di schema `document_action`): sostituisce il testo
// scritto nel codice (doc-cliente.js, doc-immobile.js) con un modello dichiarato dal modulo.
// Il testo e i campi li sceglie chi costruisce il modulo dal Builder; qui non compare il nome di
// nessun modulo né campo di nessun progetto. Niente eval, niente codice nei modelli: solo
// segnaposto e sezioni.
//
// Sintassi del modello
//   {{campo}}                    valore del campo del record. Sì/No per i booleani, elenco separato
//                                da virgole per le liste; se vuoto compare «—».
//   {{campo|linea}}              se vuoto: una riga da compilare a mano  ___________________________
//   {{campo|vuoto}}              se vuoto: niente
//   {{campo|minuscolo}}  {{campo|maiuscolo}}
//   {{campo|casella}}            [X] se il campo è spuntato, [ ] altrimenti (per i moduli da firmare)
//   {{relazione.campo}}          campo del record collegato tramite una relazione del modulo
//   {{@azienda}} {{@indirizzo}} {{@piva}}   dati del tenant (Impostazioni)
//   {{@oggi}}                    data di oggi, in italiano
//   {{#chiave}}…{{/chiave}}      il blocco compare solo se «chiave» ha un valore (vale anche per
//                                relazione.campo e @azienda)
//   {{^chiave}}…{{/chiave}}      il blocco compare solo se «chiave» è vuoto
// I filtri si possono concatenare: {{campo|vuoto|minuscolo}}. Lo stesso nome non si annida dentro
// sé stesso (sezioni con nomi diversi sì).

const LINEA = '___________________________';
const TENANT_CHIAVI = { '@azienda': 'ragione_sociale', '@indirizzo': 'indirizzo', '@piva': 'piva' };

// Legge solo proprietà proprie: «constructor», «__proto__», «toString» non sono campi del record e
// un modello non deve poterli stampare.
function proprio(oggetto, chiave) {
  return oggetto != null && Object.prototype.hasOwnProperty.call(oggetto, chiave) ? oggetto[chiave] : undefined;
}

function vuoto(v) {
  return v == null || v === '' || v === false || (Array.isArray(v) && v.length === 0);
}

function inTesto(v) {
  if (v === true) return 'Sì';
  if (v === false) return 'No';
  if (Array.isArray(v)) return v.join(', ');
  return String(v);
}

// «casella»: per i moduli da firmare su carta, una casella da spuntare a penna ([X] data, [ ] non data).
function eSpuntato(v) {
  return v === true || v === 1 || (typeof v === 'string' && ['true', '1', 'si', 'sì', 'yes'].includes(v.trim().toLowerCase()));
}

function applicaFiltri(valore, filtri) {
  if (filtri.includes('casella')) return eSpuntato(valore) ? '[X]' : '[ ]';
  let testo = vuoto(valore) && valore !== false ? '' : inTesto(valore);
  let eVuoto = testo === '';
  let fallback = '—';
  for (const f of filtri) {
    if (f === 'linea') fallback = LINEA;
    else if (f === 'vuoto') fallback = '';
    else if (f === 'minuscolo') testo = testo.toLowerCase();
    else if (f === 'maiuscolo') testo = testo.toUpperCase();
    // filtro sconosciuto: ignorato (un modello con un errore di battitura non deve rompere l'invio)
  }
  return eVuoto ? fallback : testo;
}

// `get(percorso)` restituisce il valore grezzo di un segnaposto (campo, relazione.campo, @azienda…).
// Funzione pura: nessuna lettura dal database qui dentro.
function renderModello(modello, get) {
  let testo = String(modello == null ? '' : modello);

  // Sezioni: dentro-fuori, finché ce ne sono (un livello per volta, così le annidate con nomi diversi funzionano).
  const sezione = /\{\{([#^])\s*([^}\s]+)\s*\}\}([\s\S]*?)\{\{\/\s*\2\s*\}\}/;
  for (let guardia = 0; guardia < 200; guardia++) {
    const m = testo.match(sezione);
    if (!m) break;
    const [intero, tipo, chiave, dentro] = m;
    const presente = !vuoto(get(chiave));
    testo = testo.replace(intero, (tipo === '#') === presente ? dentro : '');
  }

  return testo.replace(/\{\{\s*([^}|#^/]+?)\s*((?:\|\s*[a-z]+\s*)*)\}\}/g, (_, percorso, filtri) => {
    const lista = filtri ? filtri.split('|').map((f) => f.trim()).filter(Boolean) : [];
    return applicaFiltri(get(percorso.trim()), lista);
  });
}

const OGGI = () => new Date().toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });

// Costruisce `get` per un record: campi propri, campi di un record collegato (relazione.campo),
// dati del tenant e data. `leggiRecord(modulo, id)` torna i dati (oggetto) o null.
function costruisciGet({ record, schema, tenant, leggiRecord }) {
  const dati = record || {};
  const relazioni = (schema && schema.relations) || [];
  const cache = new Map();
  return (percorso) => {
    if (percorso === '@oggi') return OGGI();
    if (TENANT_CHIAVI[percorso]) return tenant ? tenant[TENANT_CHIAVI[percorso]] : '';
    if (!percorso.includes('.')) return proprio(dati, percorso);
    const [rel, campo] = percorso.split('.');
    const def = relazioni.find((r) => r.key === rel);
    const id = proprio(dati, rel);
    if (!def || !def.target_module || vuoto(id)) return '';
    const chiave = def.target_module + '#' + id;
    if (!cache.has(chiave)) cache.set(chiave, leggiRecord(def.target_module, id));
    const collegato = cache.get(chiave);
    return collegato ? proprio(collegato, campo) : '';
  };
}

// Il destinatario è un percorso (campo o relazione.campo) che contiene un indirizzo email.
function risolviDestinatario(percorso, get) {
  if (!percorso) return '';
  const v = get(percorso);
  return typeof v === 'string' ? v.trim() : '';
}

// Percorsi (campo, relazione.campo, @tenant) citati da un modello, comprese le sezioni: serve alla
// validazione del Builder per rifiutare in pubblicazione un campo scritto male, invece di scoprire
// «—» nel documento già inviato.
function percorsiUsati(modello) {
  const trovati = new Set();
  const testo = String(modello == null ? '' : modello);
  for (const m of testo.matchAll(/\{\{\s*[#^]?\s*([^}|\s/][^}|]*?)\s*(?:\|[^}]*)?\}\}/g)) trovati.add(m[1].trim());
  return Array.from(trovati);
}

const SEGNAPOSTI_FISSI = ['@oggi', ...Object.keys(TENANT_CHIAVI)];

module.exports = { renderModello, costruisciGet, risolviDestinatario, percorsiUsati, SEGNAPOSTI_FISSI, LINEA };
