'use strict';
// Le SPESE di OpenAPI.it: ogni richiesta a pagamento fatta da Platform si registra qui con il suo costo, e il contatore del mese si legge da qui. OpenAPI.it addebita il suo
// conto prepagato: questo registro è una STIMA fatta da Platform con i prezzi di listino (quelli del catalogo, o quelli che l'utente scrive in Connessioni → OpenAPI.it); non sostituisce
// la fattura. In ambiente di prova non si paga niente: le richieste si registrano lo stesso (con il costo che avrebbero) ma si contano a parte.
// Un prezzo ignoto (`null`) non blocca: la richiesta chiede comunque conferma, dicendo che il prezzo non è noto, e si registra a 0 finché non lo si scrive.
const db = require('../db');

db.exec(`CREATE TABLE IF NOT EXISTS openapi_spese (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quando TEXT DEFAULT CURRENT_TIMESTAMP,
  servizio TEXT NOT NULL,
  descrizione TEXT,
  costo REAL NOT NULL DEFAULT 0,
  ambiente TEXT NOT NULL,
  utente TEXT,
  riferimento TEXT
)`);
db.exec('CREATE TABLE IF NOT EXISTS openapi_impostazioni (chiave TEXT PRIMARY KEY, valore TEXT NOT NULL)');

// Prezzi di listino in € a richiesta (IVA esclusa), dal catalogo di OpenAPI.it. `null` = non indicato nelle pagine viste: va scritto dall'utente.
const SERVIZI = {
  valutazione_immobiliare: { nome: 'Valutazione di mercato (Real Estate)', prezzo: null },
  real_estate_comparabili: { nome: 'Real Estate — annunci comparabili vicino a un punto', prezzo: null },
  visure_ricerca_imprese: { nome: 'Visure camerali — ricerca di imprese (senza costi di ricerca)', prezzo: 0 },
  catasto_indirizzo: { nome: 'Catasto — cerca un indirizzo', prezzo: 0.10 },
  catasto_foglio: { nome: 'Catasto — foglio catastale', prezzo: 0.30 },
  catasto_particella: { nome: 'Catasto — particella catastale', prezzo: 0.30 },
  catasto_estratto_mappa: { nome: 'Catasto — estratto di mappa', prezzo: 6.90 },
  catasto_elaborato_planimetrico: { nome: 'Catasto — elaborato planimetrico', prezzo: 6.90 },
  catasto_dettaglio_nota: { nome: 'Catasto — dettaglio di una nota', prezzo: 6.90 },
  catasto_elenco_note: { nome: 'Catasto — elenco delle note', prezzo: 10.90 },
  catasto_visura_immobile: { nome: 'Catasto — visura di un immobile (prezzo non indicato nelle pagine pubbliche: scrivilo tu da Prezzi)', prezzo: null },
  catasto_ispezione_nazionale: { nome: 'Catasto — immobili di una persona dal codice fiscale (ispezione nazionale)', prezzo: 23.70 },
  pec_massiva_invio: { nome: 'PEC Massiva — invio di un messaggio (POST /send, listino 0,05)', prezzo: 0.05 },
  sdi_fattura: { nome: 'Fatturazione elettronica (SDI): invio di una fattura — prezzo non indicato nelle pagine pubbliche: scrivilo tu da Prezzi', prezzo: null },
  esignature_ses: { nome: 'Firma elettronica semplice (eSignature, SES): prezzo non indicato nelle pagine pubbliche: scrivilo tu da Prezzi', prezzo: null },
  sms_italia: { nome: 'SMS Italia (SMS v2): costo per segmento da 160 caratteri; listino «da 0,036»', prezzo: 0.036 },
  risk_verifica_cf: { nome: 'Risk — verifica del codice fiscale', prezzo: 0.0081 },
  risk_report_persona: { nome: 'Risk — report sulla persona (cautelativo: le pagine di OpenAPI indicano 3,10 e 3,60)', prezzo: 3.60 },
  risk_patrimoniale_persona: { nome: 'Risk — report patrimoniale sulla persona', prezzo: null },
  risk_kyc: { nome: 'Risk — PEP, sanzioni e notizie negative', prezzo: null },
  risk_creditscore_start: { nome: 'Risk — credit score società: semaforo a 3 classi (start)', prezzo: 0.06 },
  risk_creditscore_advanced: { nome: 'Risk — credit score società: rating e fido (advanced)', prezzo: 0.15 },
  risk_creditscore_societa: { nome: 'Risk — semaforo di rischio di una società', prezzo: 0.19 },
  visure_camerali: { nome: 'Visura camerale', prezzo: null },
};

const leggi = (chiave, predefinito) => { const r = db.prepare('SELECT valore FROM openapi_impostazioni WHERE chiave = ?').get(chiave); if (!r) return predefinito; try { return JSON.parse(r.valore); } catch (e) { return predefinito; } };
const scrivi = (chiave, valore) => db.prepare('INSERT INTO openapi_impostazioni (chiave, valore) VALUES (?, ?) ON CONFLICT(chiave) DO UPDATE SET valore = excluded.valore').run(chiave, JSON.stringify(valore));

const personalizzati = () => { const p = leggi('prezzi', {}); return p && typeof p === 'object' ? p : {}; };
// Il prezzo in vigore di un servizio: quello scritto dall'utente, altrimenti quello di listino; null se non lo conosce nessuno.
function prezzo(servizio) {
  if (!SERVIZI[servizio]) return null;
  const mio = personalizzati()[servizio];
  if (typeof mio === 'number' && mio >= 0) return mio;
  return SERVIZI[servizio].prezzo;
}
const stima = (servizio) => ({ servizio, nome: SERVIZI[servizio] ? SERVIZI[servizio].nome : servizio, costo: prezzo(servizio), noto: prezzo(servizio) !== null });

const ambiente = () => { try { const c = require('./openapi-it').credenziali(); return c && c.sandbox ? 'prova' : 'produzione'; } catch (e) { return 'produzione'; } };

function elencoPrezzi() {
  const mio = personalizzati();
  return Object.entries(SERVIZI).map(([servizio, s]) => ({ servizio, nome: s.nome, prezzo: prezzo(servizio), listino: s.prezzo, personalizzato: typeof mio[servizio] === 'number' }));
}

function tetto() { const t = leggi('tetto_mensile', null); return typeof t === 'number' && t > 0 ? t : null; }
// Salva tetto mensile (numero > 0 oppure null = nessun tetto) e prezzi personalizzati ({ servizio: numero >= 0 | null per tornare al listino }). Ritorna { errore } se qualcosa non va.
function impostazioni({ tetto_mensile, prezzi } = {}) {
  if (tetto_mensile !== undefined) {
    if (tetto_mensile !== null && !(typeof tetto_mensile === 'number' && tetto_mensile > 0 && tetto_mensile <= 100000)) return { errore: 'Il tetto mensile è un importo in euro maggiore di zero (o vuoto: nessun tetto).' };
  }
  const nuovi = { ...personalizzati() };
  if (prezzi !== undefined) {
    if (!prezzi || typeof prezzi !== 'object' || Array.isArray(prezzi)) return { errore: 'I prezzi non sono validi.' };
    for (const [k, v] of Object.entries(prezzi)) {
      if (!SERVIZI[k]) return { errore: 'Servizio sconosciuto: «' + String(k).slice(0, 40) + '».' };
      if (v === null) delete nuovi[k];
      else if (typeof v === 'number' && v >= 0 && v <= 10000) nuovi[k] = Math.round(v * 1000) / 1000;
      else return { errore: 'Il prezzo di «' + SERVIZI[k].nome + '» deve essere un importo in euro (anche zero).' };
    }
  }
  if (tetto_mensile !== undefined) scrivi('tetto_mensile', tetto_mensile);
  if (prezzi !== undefined) scrivi('prezzi', nuovi);
  return { ok: true };
}

function registra({ servizio, descrizione, costo, utente, riferimento }) {
  return db.prepare('INSERT INTO openapi_spese (servizio, descrizione, costo, ambiente, utente, riferimento) VALUES (?, ?, ?, ?, ?, ?)')
    .run(servizio, String(descrizione || '').slice(0, 200), Number(costo) || 0, ambiente(), utente || null, riferimento || null).lastInsertRowid;
}

// Il riepilogo del mese di `adesso`: speso in produzione, quanto «sarebbe costato» in prova, il tetto e le ultime richieste. `quando` è in UTC (stesso formato di CURRENT_TIMESTAMP).
function riepilogo(adesso = new Date()) {
  const mese = adesso.toISOString().slice(0, 7);
  const somma = (amb) => db.prepare("SELECT COALESCE(SUM(costo), 0) c, COUNT(*) n FROM openapi_spese WHERE ambiente = ? AND substr(quando, 1, 7) = ?").get(amb, mese);
  const p = somma('produzione'), t = somma('prova');
  const ultime = db.prepare('SELECT quando, servizio, descrizione, costo, ambiente, utente FROM openapi_spese ORDER BY id DESC LIMIT 20').all();
  return { mese, produzione: { speso: Math.round(p.c * 1000) / 1000, richieste: p.n }, prova: { stimato: Math.round(t.c * 1000) / 1000, richieste: t.n }, tetto: tetto(), ultime };
}

module.exports = { SERVIZI, prezzo, stima, ambiente, elencoPrezzi, tetto, impostazioni, registra, riepilogo };
