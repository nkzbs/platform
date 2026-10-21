'use strict';
// "Chiedi ai tuoi dati": una domanda in italiano diventa una QUERY STRUTTURATA, mai SQL. Il modello vede solo la domanda (ripulita dai dati personali) e il
// catalogo dei moduli (nomi, ruoli dei campi, categorie ammesse): nessun record. La sua risposta è un JSON che qui si valida rigidamente: modulo e ruoli
// devono esistere nel catalogo, le operazioni sono un elenco chiuso, le categorie devono essere tra quelle ammesse, le date valide. Il tenant la rivalida
// e la esegue con il proprio codice, rispettando i permessi.
const { redact } = require('./ai-redact');

const CALCOLI = ['somma', 'conteggio', 'media', 'massimo', 'minimo'];
const OPS = ['uguale', 'contiene', 'maggiore', 'minore'];
const RAGGRUPPA = ['mese', 'anno', 'categoria', 'nessuno'];
const RUOLI = ['importo', 'data', 'scadenza', 'categoria', 'descrizione', 'stato', 'gruppo'];
const ISO = /^\d{4}-\d{2}-\d{2}$/;

const ASK_PROMPT = `Traduci una domanda sui propri dati in una query strutturata. Ricevi un JSON con "domanda", "oggi" (data di oggi), "catalogo": i moduli disponibili, ciascuno con "slug", "name", "kind" (spesa o entrata), "ruoli" (i ruoli dei campi che puoi usare: importo, data, categoria, descrizione, stato, gruppo...) e "categorie" (i valori ammessi per il ruolo categoria), ed eventualmente "storico" ({"testo","capito"}: la domanda precedente in questa conversazione e cosa si era capito, se recente). Se "domanda" da sola è un seguito troppo corto per essere capito (es. "e il mese scorso?", "e a ottobre?", "anche per la luce") ma "storico" c'è ed è chiaramente la stessa domanda con un dettaglio cambiato, riusa il resto di "storico" e applica solo quel cambiamento; se "domanda" è già completa da sola, o cambia argomento, ignora "storico". Rispondi SOLO con un oggetto JSON, senza testo attorno, con questi campi: "modulo" (uno slug del catalogo), "calcolo" (somma, conteggio, media, massimo, minimo; di default somma dell'importo), "periodo" (oggetto {"da":"AAAA-MM-GG","a":"AAAA-MM-GG"} oppure null; "lo scorso anno" e simili si calcolano da "oggi"), "filtri" (elenco di {"ruolo","op","valore"} con op uguale, contiene, maggiore o minore; ruolo uno di quelli del modulo, diverso dalla data: la data si esprime con "periodo"), "raggruppa" (mese, anno, categoria o nessuno) e "titolo" (una breve frase che descrive cosa si calcola, massimo 80 caratteri). Per una categoria usa esattamente uno dei valori di "categorie". Se la domanda non si può tradurre con questi strumenti rispondi {"errore":"non posso rispondere a questa domanda"}. Non inventare moduli, ruoli o categorie.`;

function sanitizeAsk(data) {
  if (!data || typeof data !== 'object') return { error: 'data obbligatorio' };
  const domanda = redact(String(data.domanda || '')).replace(/[\r\n]+/g, ' ').trim().slice(0, 240);
  if (domanda.length < 4) return { error: 'Scrivi una domanda.' };
  if (!Array.isArray(data.catalogo) || !data.catalogo.length) return { error: 'catalogo obbligatorio' };
  const clean = (v, n) => String(v == null ? '' : v).replace(/[\r\n]+/g, ' ').trim().slice(0, n);
  const catalogo = data.catalogo.slice(0, 10).map((m) => ({
    slug: clean(m.slug, 60), name: clean(m.name, 60), kind: ['spesa', 'entrata'].includes(m.kind) ? m.kind : null,
    ruoli: (Array.isArray(m.ruoli) ? m.ruoli : []).filter((r) => RUOLI.includes(r)),
    categorie: (Array.isArray(m.categorie) ? m.categorie : []).slice(0, 60).map((c) => clean(c, 40)).filter(Boolean),
  })).filter((m) => m.slug && m.ruoli.includes('importo'));
  if (!catalogo.length) return { error: 'Nessun modulo con un importo dichiarato.' };
  const oggi = ISO.test(String(data.oggi || '')) ? data.oggi : new Date().toISOString().slice(0, 10);
  const storico = data.storico && typeof data.storico === 'object' && data.storico.testo
    ? { testo: redact(clean(data.storico.testo, 300)), capito: clean(data.storico.capito, 300) } : null;
  return { payload: { domanda, oggi, catalogo, storico } };
}

// Valida la risposta del modello contro il catalogo. Ritorna { query } oppure { error }.
function validateQuery(raw, catalogo) {
  if (!raw || typeof raw !== 'object') return { error: 'Risposta non valida' };
  if (raw.errore) return { error: String(raw.errore).slice(0, 120) };
  const mod = catalogo.find((m) => m.slug === raw.modulo);
  if (!mod) return { error: 'Modulo non riconosciuto' };
  const calcolo = CALCOLI.includes(raw.calcolo) ? raw.calcolo : 'somma';
  const raggruppa = RAGGRUPPA.includes(raw.raggruppa) ? raw.raggruppa : 'nessuno';
  if (raggruppa === 'categoria' && !mod.ruoli.includes('categoria')) return { error: 'Questo modulo non ha una categoria' };
  let periodo = null;
  if (raw.periodo && typeof raw.periodo === 'object') {
    const { da, a } = raw.periodo;
    if (!ISO.test(String(da)) || !ISO.test(String(a)) || da > a) return { error: 'Periodo non valido' };
    periodo = { da, a };
  }
  const filtri = [];
  for (const f of (Array.isArray(raw.filtri) ? raw.filtri : []).slice(0, 4)) {
    if (!f || !mod.ruoli.includes(f.ruolo) || f.ruolo === 'data' || !OPS.includes(f.op)) return { error: 'Filtro non valido' };
    let valore = f.valore;
    if (f.ruolo === 'importo') { valore = Number(valore); if (!Number.isFinite(valore)) return { error: 'Importo del filtro non valido' }; }
    else {
      valore = String(valore == null ? '' : valore).trim().slice(0, 60);
      if (!valore) return { error: 'Valore del filtro mancante' };
      if (f.ruolo === 'categoria' && f.op === 'uguale' && mod.categorie.length) {
        const c = mod.categorie.find((x) => x.toLowerCase() === valore.toLowerCase());
        if (!c) return { error: 'Categoria non ammessa: ' + valore };
        valore = c;
      }
    }
    filtri.push({ ruolo: f.ruolo, op: f.op, valore });
  }
  return { query: { modulo: mod.slug, calcolo, periodo, filtri, raggruppa, titolo: String(raw.titolo || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 80) } };
}

module.exports = { ASK_PROMPT, sanitizeAsk, validateQuery, CALCOLI, OPS, RAGGRUPPA };
