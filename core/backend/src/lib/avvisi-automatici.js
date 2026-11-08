'use strict';
// Tre azioni di avviso delle automazioni, generiche (nessun nome di modulo o di campo qui: arrivano dalla configurazione):
//   notifica_requisiti_mancanti  { stato, messaggio }      cosa manca a un record per passare a `stato` (blocco state_requirements, allegati compresi)
//   notifica_abbinamenti         { abbinamento, messaggio } quanti record dell'altro modulo corrispondono (blocco match_view)
//   notifica_riepilogo           { giorni, titolo }         quante schede nuove e quante per stato in questo modulo
// Ognuna restituisce il testo da notificare, oppure null quando non c'è niente da dire (nessuna notifica: un avviso vuoto è rumore).
// Il motore (automation-engine.js) scrive la notifica e il log. Segnaposto nel messaggio: {{campo}} del record, più quelli indicati sotto.

const db = require('../db');
const { parseSchemaNormalized } = require('../schema-v3');
const requisiti = require('../requisiti-stato');
const { calcolaAbbinamenti } = require('./abbinamento');

const AZIONI = ['notifica_requisiti_mancanti', 'notifica_abbinamenti', 'notifica_riepilogo'];

function schemaDi(slug) {
  const mod = db.prepare('SELECT schema_json FROM modules WHERE slug = ?').get(slug);
  return mod ? parseSchemaNormalized(mod.schema_json) : null;
}

function interpola(modello, dati, extra) {
  return String(modello || '').replace(/\{\{(\w+)\}\}/g, (_, k) => {
    if (extra && k in extra) return extra[k];
    return dati && dati[k] !== undefined && dati[k] !== null ? String(dati[k]) : '';
  }).replace(/\s+/g, ' ').trim();
}

function requisitiMancanti(cfg, moduleSlug, recordId, dati) {
  const schema = schemaDi(moduleSlug);
  const blocco = schema && requisiti.bloccoPerStato(schema.state_requirements, cfg.stato);
  if (!blocco || recordId == null) return null;
  const allegati = db.prepare('SELECT tipo FROM record_attachments WHERE module_slug = ? AND record_id = ?').all(moduleSlug, recordId);
  const mancano = requisiti.valutaRequisiti(blocco, dati || {}, allegati).filter((v) => !v.ok).map((v) => v.label);
  if (!mancano.length) return null;
  return interpola(cfg.messaggio || 'Mancano: {{mancano}}.', dati, { mancano: mancano.join(', ') });
}

function abbinamentiTrovati(cfg, moduleSlug, recordId, dati) {
  const schema = schemaDi(moduleSlug);
  const def = schema && (schema.match_views || []).find((m) => m.key === cfg.abbinamento);
  if (!def) return null;
  const candidati = db.prepare('SELECT id, data FROM records WHERE module_slug = ? ORDER BY updated_at DESC LIMIT 2000').all(def.target_module)
    .map((r) => { try { return { id: r.id, data: JSON.parse(r.data) }; } catch (e) { return null; } }).filter(Boolean);
  const esito = calcolaAbbinamenti(def, dati || {}, candidati);
  if (!esito.applicabile || !esito.items.length) return null;
  const nomi = esito.items.slice(0, 3).map((it) => (def.display_field && it.data[def.display_field]) || '#' + it.id).join(', ')
    + (esito.items.length > 3 ? ' e altri ' + (esito.items.length - 3) : '');
  return interpola(cfg.messaggio || '{{n}} corrispondenze: {{nomi}}.', dati, { n: String(esito.items.length), nomi });
}

function riepilogoModulo(cfg, moduleSlug) {
  const giorni = Math.max(1, parseInt(cfg.giorni, 10) || 7);
  const schema = schemaDi(moduleSlug) || {};
  const righe = db.prepare('SELECT data, created_at FROM records WHERE module_slug = ?').all(moduleSlug);
  if (!righe.length) return null;
  const da = new Date(Date.now() - giorni * 86400 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  const nuove = righe.filter((r) => r.created_at >= da).length;
  const stati = (schema.workflow && schema.workflow.states) || [];
  const conteggio = {};
  righe.forEach((r) => { try { const s = JSON.parse(r.data)._stato; if (s) conteggio[s] = (conteggio[s] || 0) + 1; } catch (e) { /* record illeggibile: non conta */ } });
  const perStato = stati.filter((s) => conteggio[s.key]).map((s) => (s.label || s.key) + ' ' + conteggio[s.key]);
  const titolo = cfg.titolo || moduleSlug;
  return `${titolo}, ultimi ${giorni} giorni: ${nuove} ${nuove === 1 ? 'nuova' : 'nuove'}.` + (perStato.length ? ' Ora: ' + perStato.join(', ') + '.' : '');
}

// Calcola il testo (o null) dell'azione `nome`. Un errore non deve fermare le altre azioni: il chiamante lo registra.
function testoAvviso(nome, cfg, moduleSlug, recordId, dati) {
  const c = cfg && typeof cfg === 'object' ? cfg : {};
  if (nome === 'notifica_requisiti_mancanti') return requisitiMancanti(c, moduleSlug, recordId, dati);
  if (nome === 'notifica_abbinamenti') return abbinamentiTrovati(c, moduleSlug, recordId, dati);
  if (nome === 'notifica_riepilogo') return riepilogoModulo(c, moduleSlug);
  return null;
}

module.exports = { AZIONI, testoAvviso };
