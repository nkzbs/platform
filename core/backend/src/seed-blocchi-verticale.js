'use strict';
// Applica ai moduli di un tenant i blocchi dichiarati nei seed di un verticale (i valori di
// partenza di un progetto stanno nei seed, mai nel codice): le azioni «documento da modello»
// (seeds/documenti-immobiliare.json) e gli «abbinamenti» (seeds/abbinamenti-immobiliare.json).
// Sostituisce i testi che stavano in lib/doc-cliente.js e lib/doc-immobile.js e le rotte legate
// agli slug di un solo verticale.
//
// Regole, tutte pensate per non fare danni:
//  - UNA volta sola per blocco: dopo l'applicazione resta un marcatore (tabella `seed_applicati`).
//    Se poi qualcuno toglie o cambia il blocco dal Builder, al riavvio NON ricompare.
//  - Solo dove ha senso: il modulo deve esistere ed essere installato e avere TUTTI i campi (e le
//    relazioni) che il blocco cita (esclusi i campi che il seed dichiara in «aggiungi_campi» e crea
//    lui). Un tenant con un modulo omonimo ma diverso non viene toccato.
//  - Passa dalle rotte vere del Builder (bozza + pubblicazione, con la sua validazione), mai con una
//    scrittura diretta su schema_json.
//  - Idempotente e senza effetti dove non c'è niente da fare: ogni avvio costa qualche lettura.
const path = require('path');
const db = require('./db');
const { percorsiUsati, SEGNAPOSTI_FISSI } = require('./lib/modello-documento');

db.exec('CREATE TABLE IF NOT EXISTS seed_applicati (chiave TEXT PRIMARY KEY, applicato_il TEXT DEFAULT CURRENT_TIMESTAMP)');

const gia = (chiave) => !!db.prepare('SELECT 1 FROM seed_applicati WHERE chiave = ?').get(chiave);
const segna = (chiave) => db.prepare('INSERT OR IGNORE INTO seed_applicati (chiave) VALUES (?)').run(chiave);

// Il modulo ha tutto ciò che il modello cita? (campi propri, relazione.campo con il campo che esiste
// davvero nel modulo collegato, destinatario compreso.)
function modelloApplicabile(az, steps, moduliPerSlug) {
  const campi = new Set(steps.filter((s) => s.block_type === 'field' || s.block_type === 'computed').map((s) => s.key));
  const relazioni = new Map(steps.filter((s) => s.block_type === 'relation').map((s) => [s.key, s]));
  const percorsi = new Set([...percorsiUsati(az.subject), ...percorsiUsati(az.body), az.recipient].filter(Boolean));
  for (const p of percorsi) {
    if (SEGNAPOSTI_FISSI.includes(p)) continue;
    if (!p.includes('.')) { if (!campi.has(p)) return false; continue; }
    const [rel, campo] = p.split('.');
    const def = relazioni.get(rel);
    const bersaglio = def && moduliPerSlug[def.target_module];
    if (!bersaglio || !bersaglio.has(campo)) return false;
  }
  if (az.on_send_state && !steps.some((s) => s.block_type === 'workflow_state' && s.key === az.on_send_state)) return false;
  if (az.on_signed_state && !steps.some((s) => s.block_type === 'workflow_state' && s.key === az.on_signed_state)) return false;
  return true;
}

// L'abbinamento è applicabile se i campi «miei» (e la condizione) esistono in questo modulo e quelli
// «loro» (regole, filtro, campi mostrati) esistono nel modulo bersaglio, che deve esistere.
function abbinamentoApplicabile(mv, steps, moduliPerSlug) {
  const miei = new Set(steps.filter((s) => s.block_type === 'field' || s.block_type === 'computed').map((s) => s.key).concat(['_stato']));
  const loro = moduliPerSlug[mv.target_module];
  if (!loro) return false;
  const loroOk = (k) => k === '_stato' || loro.has(k);
  for (const r of mv.rules || []) {
    if (!miei.has(r.mine)) return false;
    if (![].concat(r.theirs).every(loroOk)) return false;
  }
  if (mv.when && mv.when.field && !miei.has(mv.when.field)) return false;
  if (mv.target_filter && mv.target_filter.field && !loroOk(mv.target_filter.field)) return false;
  return [mv.display_field, ...(mv.subtitle_fields || [])].filter(Boolean).every(loroOk);
}

// Cosa si può applicare: tipo di blocco, prefisso del marcatore (invariato per i documenti, così in
// produzione quelli già applicati non si ripetono), controllo di applicabilità, file del seed.
const TIPI = {
  document_action: { prefisso: 'azione_documento', applicabile: modelloApplicabile, file: 'documenti-immobiliare.json', nome: 'documento', idPrefisso: 'doc_' },
  match_view: { prefisso: 'abbinamento', applicabile: abbinamentoApplicabile, file: 'abbinamenti-immobiliare.json', nome: 'abbinamento', idPrefisso: 'mtc_' },
};

function campiDelModulo(slug) {
  const m = db.prepare('SELECT schema_json FROM modules WHERE slug = ? AND installed = 1').get(slug);
  if (!m) return null;
  try {
    const s = JSON.parse(m.schema_json);
    // Solo la forma v3 (steps): è quella che il Builder pubblica e che leggono questi controlli.
    if (s.version !== 3 || !Array.isArray(s.steps)) return null;
    return new Set(s.steps.filter((x) => x.block_type === 'field' || x.block_type === 'computed').map((x) => x.key));
  } catch (e) { return null; }
}

async function applicaSeed(seed, { callAs = require('./lib/internal-api').callAs, tipo = 'document_action' } = {}) {
  const cfg = TIPI[tipo];
  const esiti = [];
  const admin = db.prepare("SELECT * FROM users WHERE role = 'admin' LIMIT 1").get();
  const moduliPerSlug = {};
  for (const slug of Object.keys(seed).filter((k) => !k.startsWith('_'))) moduliPerSlug[slug] = campiDelModulo(slug);
  // I moduli collegati (es. il proprietario di un immobile è un cliente) servono anche se non sono nel seed.
  const campiDi = (slug) => (slug in moduliPerSlug ? moduliPerSlug[slug] : (moduliPerSlug[slug] = campiDelModulo(slug)));
  const mappa = new Proxy({}, { get: (_, slug) => campiDi(slug) });

  for (const [slug, azioni] of Object.entries(seed)) {
    if (slug.startsWith('_') || !Array.isArray(azioni)) continue;
    for (const az of azioni) {
      const chiave = cfg.prefisso + ':' + slug + ':' + az.key;
      if (gia(chiave)) continue;
      const m = db.prepare('SELECT schema_json FROM modules WHERE slug = ? AND installed = 1').get(slug);
      if (!m) continue; // il modulo non c'è (ancora): riproverà al prossimo avvio
      let schema; try { schema = JSON.parse(m.schema_json); } catch (e) { continue; }
      if (schema.version !== 3 || !Array.isArray(schema.steps)) continue;
      if (schema.steps.some((s) => s.block_type === tipo && s.key === az.key)) { segna(chiave); continue; }
      // `aggiungi_campi`: campi che il blocco usa (es. i consensi di un documento da firmare) e che il
      // seed crea nel modulo se mancano. Non fanno parte del blocco: si tolgono prima di salvarlo.
      const { aggiungi_campi: daAggiungere = [], ...blocco } = az;
      const esistenti = new Set(schema.steps.filter((s) => s.block_type === 'field' || s.block_type === 'computed').map((s) => s.key));
      const nuoviCampi = daAggiungere.filter((f) => f && f.key && !esistenti.has(f.key)).map((f) => ({ id: 'f_' + f.key, block_type: 'field', ...f }));
      const stepsConCampi = [...schema.steps, ...nuoviCampi];
      // Un campo con la stessa chiave ma di un altro tipo (es. «consenso_marketing» testo libero) non si
      // tocca: il documento non sarebbe coerente. Si segna come non applicabile, senza riprovare a ogni avvio.
      if (daAggiungere.some((f) => f && schema.steps.some((s) => (s.block_type === 'field') && s.key === f.key && s.type !== f.type))) {
        segna(chiave); esiti.push({ slug, key: az.key, esito: 'non applicabile' }); continue;
      }
      if (!cfg.applicabile(blocco, stepsConCampi, mappa)) { segna(chiave); esiti.push({ slug, key: az.key, esito: 'non applicabile' }); continue; }
      if (!admin) continue;

      const nuovo = { version: 3, steps: [...stepsConCampi, { id: cfg.idPrefisso + Math.random().toString(36).slice(2, 10), block_type: tipo, ...blocco }] };
      const bozza = await callAs(admin, 'PUT', '/builder/' + slug + '/draft', { schema: nuovo });
      if (!bozza.ok) { console.error('[seed-blocchi] bozza ' + slug + '/' + az.key + ' fallita:', JSON.stringify(bozza.data)); esiti.push({ slug, key: az.key, esito: 'errore bozza' }); continue; }
      const pub = await callAs(admin, 'POST', '/builder/' + slug + '/publish', {});
      if (!pub.ok) { console.error('[seed-blocchi] pubblicazione ' + slug + '/' + az.key + ' fallita:', JSON.stringify(pub.data)); esiti.push({ slug, key: az.key, esito: 'errore pubblicazione' }); continue; }
      segna(chiave);
      esiti.push({ slug, key: az.key, esito: 'applicato' });
    }
  }
  return esiti;
}

async function run() {
  for (const [tipo, cfg] of Object.entries(TIPI)) {
    try {
      const seed = require(path.join(__dirname, 'seeds', cfg.file));
      const esiti = await applicaSeed(seed, { tipo });
      esiti.filter((e) => e.esito === 'applicato').forEach((e) => console.log('[seed-blocchi] ' + cfg.nome + ' «' + e.key + '» aggiunto al modulo ' + e.slug));
    } catch (e) { console.error('[seed-blocchi] ' + cfg.nome + ': non riuscito:', e.message); }
  }
}

module.exports = { applicaSeed, modelloApplicabile, abbinamentoApplicabile, TIPI, run };
