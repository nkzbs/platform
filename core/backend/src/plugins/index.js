'use strict';
// REGISTRO DELLE FUNZIONI (plugin). Una funzione è codice che serve solo ad alcuni tenant (firma, fattura elettronica, valutazione immobiliare…): non è accesa per tutti ma
// si sceglie da Impostazioni → Funzioni, come in uno store. Elenco chiuso (nessun pacchetto può caricare codice a piacere): per aggiungerne una si scrive il manifesto
// { id, nome, descrizione, icona, colore, categoria, pacchetti, marcatori, adattatori, rotte, librerie } e si elenca qui.
// Una funzione è ATTIVA per un tenant se: ha ricevuto uno dei suoi `pacchetti` (Libreria), oppure un modulo installato la usa già (i `marcatori` nello schema),
// oppure l'amministratore l'ha accesa a mano (tabella funzioni_attive), oppure è nominata in PLATFORM_PLUGINS (prove; «*» = tutte).
const ELENCO = [() => require('./immobiliare'), ...require('./funzioni').map((m) => () => m)];
const tutti = () => ELENCO.map((c) => c());
const dbc = () => require('../db');
let creata = false;
function tabella() { if (!creata) { dbc().exec('CREATE TABLE IF NOT EXISTS funzioni_attive (id TEXT PRIMARY KEY, attivata_il TEXT DEFAULT CURRENT_TIMESTAMP)'); creata = true; } return dbc(); }

function pacchettiRicevuti() {
  try { return new Set(dbc().prepare('SELECT slug FROM pacchetti_ricevuti').all().map((r) => r.slug)); } catch (e) { return new Set(); }
}
let cacheUso = { t: 0, testo: '' };
function schemiTesto() { // gli schemi dei moduli, in un solo testo, per cercare i marcatori (qualche secondo di memoria: la ricerca è su ogni azione)
  if (Date.now() - cacheUso.t > 3000) {
    let testo = '';
    try { testo = dbc().prepare('SELECT schema_json FROM modules').all().map((r) => r.schema_json || '').join('\n'); } catch (e) { /* tenant senza moduli */ }
    cacheUso = { t: Date.now(), testo };
  }
  return cacheUso.testo;
}
const dimentica = () => { cacheUso = { t: 0, testo: '' }; };
const scelte = () => { try { return new Set(tabella().prepare('SELECT id FROM funzioni_attive').all().map((r) => r.id)); } catch (e) { return new Set(); } };

// Perché è accesa (null = spenta): 'prova' | 'pacchetto' | 'usata' | 'scelta'.
function perche(plugin) {
  const forzati = String(process.env.PLATFORM_PLUGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (forzati.includes('*') || forzati.includes(plugin.id)) return 'prova';
  const ricevuti = pacchettiRicevuti();
  if ((plugin.pacchetti || []).some((p) => ricevuti.has(p))) return 'pacchetto';
  const t = schemiTesto();
  if ((plugin.marcatori || []).some((m) => t.includes(m))) return 'usata';
  if (scelte().has(plugin.id)) return 'scelta';
  return null;
}
const attivo = (plugin) => perche(plugin) !== null;
const attivi = () => tutti().filter(attivo);
function adattatori() { const out = {}; for (const p of attivi()) Object.assign(out, p.adattatori || {}); return out; }
function libreria(idPlugin, nome) {
  const p = tutti().find((x) => x.id === idPlugin);
  if (!p || !attivo(p) || !p.librerie || !p.librerie[nome]) return null;
  return p.librerie[nome]();
}
// L'elenco per lo «store»: tutte le funzioni, accese o no, con il motivo.
function catalogo() {
  dimentica();
  return tutti().map((p) => { const m = perche(p); return { id: p.id, nome: p.nome, descrizione: p.descrizione || '', icona: p.icona || 'puzzle', colore: p.colore || '#584aec', categoria: p.categoria || 'Altro', costo: p.costo || '', attiva: m !== null, motivo: m, puo_spegnere: m === 'scelta' }; });
}
function attiva(id) { if (!tutti().some((p) => p.id === id)) return false; tabella().prepare('INSERT OR IGNORE INTO funzioni_attive (id) VALUES (?)').run(id); dimentica(); return true; }
function spegni(id) { const p = tutti().find((x) => x.id === id); if (!p) return { errore: 'Funzione sconosciuta' }; const m = perche(p); if (m && m !== 'scelta') return { errore: m === 'usata' ? 'Un modulo la usa: toglila prima dal modulo.' : 'È inclusa nel pacchetto del tenant.' }; tabella().prepare('DELETE FROM funzioni_attive WHERE id = ?').run(id); dimentica(); return { ok: true }; }
// Middleware: lascia passare solo se la funzione è accesa (altrimenti 404, come se la rotta non esistesse).
const soloSe = (id) => (req, res, next) => { const p = tutti().find((x) => x.id === id); return p && attivo(p) ? next() : res.status(404).json({ error: 'Funzione non attiva' }); };
module.exports = { tutti, attivi, attivo, adattatori, libreria, catalogo, attiva, spegni, soloSe, perche, dimentica };
