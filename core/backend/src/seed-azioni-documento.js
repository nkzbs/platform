'use strict';
// Applica ai moduli di un tenant le azioni «documento da modello» dichiarate in
// seeds/documenti-immobiliare.json (i valori di partenza di un progetto stanno nei seed, mai nel
// codice). Sostituisce i testi che stavano in lib/doc-cliente.js e lib/doc-immobile.js e le
// rotte legate agli slug di un solo verticale.
//
// Regole, tutte pensate per non fare danni:
//  - UNA volta sola per documento: dopo l'applicazione resta un marcatore (tabella
//    `seed_applicati`). Se poi qualcuno toglie o cambia il documento dal Builder, al riavvio NON
//    ricompare.
//  - Solo dove ha senso: il modulo deve esistere ed essere installato e avere TUTTI i campi (e le
//    relazioni) che il modello cita. Un tenant con un modulo omonimo ma diverso non viene toccato.
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
  return true;
}

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

async function applicaSeed(seed, { callAs = require('./lib/internal-api').callAs } = {}) {
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
      const chiave = 'azione_documento:' + slug + ':' + az.key;
      if (gia(chiave)) continue;
      const m = db.prepare('SELECT schema_json FROM modules WHERE slug = ? AND installed = 1').get(slug);
      if (!m) continue; // il modulo non c'è (ancora): riproverà al prossimo avvio
      let schema; try { schema = JSON.parse(m.schema_json); } catch (e) { continue; }
      if (schema.version !== 3 || !Array.isArray(schema.steps)) continue;
      if (schema.steps.some((s) => s.block_type === 'document_action' && s.key === az.key)) { segna(chiave); continue; }
      if (!modelloApplicabile(az, schema.steps, mappa)) { segna(chiave); esiti.push({ slug, key: az.key, esito: 'non applicabile' }); continue; }
      if (!admin) continue;

      const nuovo = { version: 3, steps: [...schema.steps, { id: 'doc_' + Math.random().toString(36).slice(2, 10), block_type: 'document_action', ...az }] };
      const bozza = await callAs(admin, 'PUT', '/builder/' + slug + '/draft', { schema: nuovo });
      if (!bozza.ok) { console.error('[seed-azioni-documento] bozza ' + slug + '/' + az.key + ' fallita:', JSON.stringify(bozza.data)); esiti.push({ slug, key: az.key, esito: 'errore bozza' }); continue; }
      const pub = await callAs(admin, 'POST', '/builder/' + slug + '/publish', {});
      if (!pub.ok) { console.error('[seed-azioni-documento] pubblicazione ' + slug + '/' + az.key + ' fallita:', JSON.stringify(pub.data)); esiti.push({ slug, key: az.key, esito: 'errore pubblicazione' }); continue; }
      segna(chiave);
      esiti.push({ slug, key: az.key, esito: 'applicato' });
    }
  }
  return esiti;
}

async function run() {
  try {
    const seed = require(path.join(__dirname, 'seeds', 'documenti-immobiliare.json'));
    const esiti = await applicaSeed(seed);
    esiti.filter((e) => e.esito === 'applicato').forEach((e) => console.log('[seed-azioni-documento] documento «' + e.key + '» aggiunto al modulo ' + e.slug));
  } catch (e) { console.error('[seed-azioni-documento] non riuscito:', e.message); }
}

module.exports = { applicaSeed, modelloApplicabile, run };
