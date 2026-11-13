'use strict';
// REGISTRO DEI PLUGIN. Un plugin è una cartella `plugins/<id>/index.js` con { id, nome, pacchetti, adattatori, librerie }: codice che serve solo a un settore e che il core
// non deve portarsi dietro per tutti. Elenco chiuso (un pacchetto non può caricare codice a piacere): per aggiungerne uno si scrive la cartella e si elenca qui.
// Un plugin è ATTIVO per un tenant se ha ricevuto uno dei suoi `pacchetti` (tabella pacchetti_ricevuti), oppure se è nominato in PLATFORM_PLUGINS (elenco separato da virgole:
// per sviluppo e prove). Un tenant senza il pacchetto non vede né esegue le sue funzioni.
const ELENCO = [() => require('./immobiliare')];
const tutti = () => ELENCO.map((c) => c());

function pacchettiRicevuti() {
  try { return new Set(require('../db').prepare('SELECT slug FROM pacchetti_ricevuti').all().map((r) => r.slug)); } catch (e) { return new Set(); }
}
function attivo(plugin) {
  const forzati = String(process.env.PLATFORM_PLUGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (forzati.includes(plugin.id)) return true;
  const ricevuti = pacchettiRicevuti();
  return (plugin.pacchetti || []).some((p) => ricevuti.has(p));
}
const attivi = () => tutti().filter(attivo);
// Gli adattatori delle azioni esterne messi a disposizione dai plugin attivi: { nome: () => modulo }.
function adattatori() {
  const out = {};
  for (const p of attivi()) Object.assign(out, p.adattatori || {});
  return out;
}
// Una libreria di un plugin, o null se il plugin non c'è o non è attivo per questo tenant.
function libreria(idPlugin, nome) {
  const p = tutti().find((x) => x.id === idPlugin);
  if (!p || !attivo(p) || !p.librerie || !p.librerie[nome]) return null;
  return p.librerie[nome]();
}
module.exports = { tutti, attivi, attivo, adattatori, libreria };
