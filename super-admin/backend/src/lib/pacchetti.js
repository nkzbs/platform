'use strict';
// I PACCHETTI di verticale: i dati dei moduli di un settore (documenti da firmare, abbinamenti, estensioni, moduli nuovi, ruoli, relazioni, proprietà, sezioni), custoditi qui
// accanto all'analisi e INVIATI ai tenant. Il core non ne contiene: li riceve, li tiene e li applica. Ogni pacchetto è una cartella `pacchetti/<nome>/` con una parte per
// tipo di blocco e un `pacchetto.json` (nome, descrizione, `versione`). Per cambiare un pacchetto si cambiano i dati e si aumenta la versione: i tenant che lo usano lo
// ricevono al prossimo aggiornamento.
const fs = require('fs');
const path = require('path');
const { marcatoriDelPacchetto } = require('../../../../shared/pacchetto-marcatori.js');

const CARTELLA = path.join(__dirname, '..', 'pacchetti');
const PARTI = ['estensioni', 'documenti', 'abbinamenti', 'moduli', 'ruoli', 'relazioni', 'proprieta', 'sezioni', 'dimostrativi'];
const SLUG = /^[a-z0-9][a-z0-9-]{0,59}$/;

const disponibili = () => { try { return fs.readdirSync(CARTELLA, { withFileTypes: true }).filter((d) => d.isDirectory() && SLUG.test(d.name)).map((d) => d.name).sort(); } catch (e) { return []; } };
const leggiJson = (slug, nome) => { try { return JSON.parse(fs.readFileSync(path.join(CARTELLA, slug, nome + '.json'), 'utf8')); } catch (e) { return null; } };

// { slug, nome, descrizione, versione, parti } oppure null se il pacchetto non esiste
function leggi(slug) {
  if (!SLUG.test(String(slug)) || !disponibili().includes(slug)) return null;
  const man = leggiJson(slug, 'pacchetto') || {};
  const parti = {}; for (const p of PARTI) parti[p] = leggiJson(slug, p) || {};
  return { slug, nome: String(man.nome || slug), descrizione: String(man.descrizione || ''), versione: Math.max(1, parseInt(man.versione, 10) || 1), parti };
}
const elenco = () => disponibili().map((s) => { const p = leggi(s); return { slug: p.slug, nome: p.nome, descrizione: p.descrizione, versione: p.versione }; });

// Invia un pacchetto a un tenant (che lo riceve, lo attiva e lo applica). Errore chiaro se il pacchetto non esiste qui.
async function invia(tenantSlug, slug) {
  const p = leggi(slug);
  if (!p) throw new Error('Pacchetto «' + String(slug).slice(0, 60) + '» sconosciuto a Super Admin (disponibili: ' + (disponibili().join(', ') || 'nessuno') + ')');
  return require('./tenant-api-client').callTenantAPI(tenantSlug, 'POST', '/api/internal-setup/pacchetto', { slug: p.slug, versione: p.versione, parti: p.parti });
}

// Riallinea un tenant esistente: invia i pacchetti che ha in una versione più vecchia e quelli che aveva già applicato prima che esistessero i pacchetti (lo si riconosce dai
// blocchi già applicati). Un tenant che non usa nessun pacchetto non riceve niente. Ritorna { inviati: [slug...] }.
async function sincronizza(tenantSlug) {
  const callTenantAPI = require('./tenant-api-client').callTenantAPI;
  const stato = await callTenantAPI(tenantSlug, 'GET', '/api/internal-setup/pacchetti');
  const fatti = new Set(stato.seed_applicati || []);
  const inviati = [];
  for (const slug of disponibili()) {
    const p = leggi(slug), suo = (stato.pacchetti || []).find((x) => x.slug === slug);
    const dapprima = !suo && marcatoriDelPacchetto(p.parti).some((m) => fatti.has(m));
    if ((suo && (suo.versione || 0) < p.versione) || dapprima) { await invia(tenantSlug, slug); inviati.push(slug); }
  }
  return { inviati };
}

module.exports = { disponibili, leggi, elenco, invia, sincronizza, PARTI };
