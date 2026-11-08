'use strict';
// Applica ai moduli di un tenant i blocchi di un PACCHETTO di verticale. Un pacchetto è un insieme di dati (mai codice) con una parte per tipo di blocco:
// `documenti` (azioni «documento da modello»), `abbinamenti`, `estensioni` (campi nuovi, calcoli, automazioni, azioni esterne, requisiti per stato e `converti`),
// `moduli` (moduli nuovi), `ruoli`, `relazioni`, `proprieta`, `sezioni`. Il core non ne contiene: li custodisce Super Admin (accanto all'analisi) e li invia al
// tenant, che li tiene (`pacchetti_ricevuti`) e applica solo quelli ATTIVI (`pacchetti_attivi`, scelti dall'analisi alla creazione). Nel codice non c'è nessun nome
// di verticale: per un altro verticale basta un altro pacchetto in Super Admin.
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
// Estensione di un modulo: un gruppo di blocchi (campi, calcoli, relazioni, automazioni) che si
// aggiunge insieme. Si applica solo se i moduli e i campi di cui ha bisogno (`richiede`: modulo →
// campi) esistono, se le relazioni puntano a moduli che esistono e se nessuna chiave da aggiungere è
// già usata da un blocco di tipo diverso.
// Un campo si può trasformare in elenco a scelta multipla solo se oggi è testo o una scelta singola:
// da qualunque altro tipo si perderebbe il significato del dato.
const TIPI_CONVERTIBILI = ['text', 'textarea', 'select', 'multiselect'];

function estensioneApplicabile(est, steps, moduliPerSlug) {
  for (const [modulo, campi] of Object.entries(est.richiede || {})) {
    const presenti = chiaviDelModulo(modulo); // campi E relazioni: le relazioni non stanno in `moduliPerSlug`
    if (!presenti) return false;
    if (!campi.every((c) => presenti.has(c))) return false;
  }
  for (const b of est.aggiungi || []) {
    if (b.block_type === 'allegati' && steps.some((x) => x.block_type === 'allegati')) return false; // un modulo ha un solo riquadro Allegati
    if (b.block_type === 'relation' && !moduliPerSlug[b.target_module]) return false;
    if (b.key && steps.some((x) => x.key === b.key && (x.block_type !== b.block_type || (x.type || null) !== (b.type || null)))) return false;
  }
  for (const c of est.converti || []) {
    const attuale = steps.find((x) => x.block_type === 'field' && x.key === c.key);
    if (steps.some((x) => x.key === c.key && x.block_type !== 'field')) return false;
    if (attuale && !TIPI_CONVERTIBILI.includes(attuale.type || 'text')) return false;
  }
  return true;
}

const TIPI = {
  estensione: { prefisso: 'estensione', applicabile: estensioneApplicabile, parte: 'estensioni', nome: 'estensione', idPrefisso: 'ext_' },
  document_action: { prefisso: 'azione_documento', applicabile: modelloApplicabile, parte: 'documenti', nome: 'documento', idPrefisso: 'doc_' },
  match_view: { prefisso: 'abbinamento', applicabile: abbinamentoApplicabile, parte: 'abbinamenti', nome: 'abbinamento', idPrefisso: 'mtc_' },
};

// Tutte le chiavi di un modulo installato (campi, calcoli, relazioni), o null se non c'è.
function chiaviDelModulo(slug) {
  const m = db.prepare('SELECT schema_json FROM modules WHERE slug = ? AND installed = 1').get(slug);
  if (!m) return null;
  try {
    const sc = JSON.parse(m.schema_json);
    if (sc.version !== 3 || !Array.isArray(sc.steps)) return null;
    return new Set(sc.steps.filter((x) => ['field', 'computed', 'relation'].includes(x.block_type) && x.key).map((x) => x.key));
  } catch (e) { return null; }
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
      if (tipo !== 'estensione' && schema.steps.some((s) => s.block_type === tipo && s.key === az.key)) { segna(chiave); continue; }
      if (tipo === 'estensione') {
        const presenti = new Set(schema.steps.map((x) => x.block_type + ':' + (x.key || x.label)));
        const daAggiungere = (az.aggiungi || []).filter((b) => !presenti.has(b.block_type + ':' + (b.key || b.label)))
          .map((b) => ({ id: cfg.idPrefisso + Math.random().toString(36).slice(2, 10), ...b }));
        if (!cfg.applicabile(az, schema.steps, mappa)) { segna(chiave); esiti.push({ slug, key: az.key, esito: 'non applicabile' }); continue; }
        if (!admin) continue;
        // `converti`: campi già presenti che diventano un elenco a scelta multipla (id ed etichetta restano), o
        // si creano se mancano. I valori già scritti come testo si spezzano in elenco (vedi sotto).
        const daConvertire = (az.converti || []);
        const stepsConvertiti0 = schema.steps.map((x) => {
          const c = daConvertire.find((y) => y.key === x.key && x.block_type === 'field');
          return c ? { ...x, type: c.type || 'multiselect', options: c.options, label: c.label || x.label } : x;
        });
        // `ricalcola`: [{ key, da, a, in_fondo? }] cambia la formula di un campo calcolato già presente SOLO se è ancora quella di prima (`da`): una formula che l'utente ha
        // modificato dal Builder non si tocca mai. `in_fondo` sposta il campo dopo gli altri (un calcolo vede solo i campi che lo precedono): servono quando la nuova formula usa campi aggiunti più tardi.
        const ricalcolati = [];
        const stepsRicalcolati = stepsConvertiti0.map((x) => {
          const r = (az.ricalcola || []).find((y) => y.key === x.key);
          if (r && x.block_type === 'field' && x.type === 'computed' && x.expr === r.da) { ricalcolati.push(r); return { ...x, expr: r.a }; }
          return x;
        });
        // `rinomina`: [{ key, da, a }] cambia l'etichetta di un campo SOLO se è ancora quella di prima (`da`): un nome scelto dall'utente non si tocca.
        const rinominati = [];
        for (let i = 0; i < stepsRicalcolati.length; i++) {
          const x = stepsRicalcolati[i], r = (az.rinomina || []).find((y) => y.key === x.key);
          if (r && ['field', 'relation'].includes(x.block_type) && x.label === r.da) { stepsRicalcolati[i] = { ...x, label: r.a }; rinominati.push(r.key); }
        }
        // `imposta`: [{ block_type, key, proprieta: { nome: valore } }] dà a un blocco già presente le proprietà che NON ha ancora (mai sopra un valore scelto
        // dall'utente, nemmeno vuoto di proposito: si guarda solo se manca del tutto). Serve per un blocco creato in una versione precedente del pacchetto
        // (es. `on_signed_state` di un documento da firmare). `on_signed_state` si imposta solo se lo stato esiste nel workflow del modulo.
        const impostati = [];
        const statiModulo = new Set(schema.steps.filter((x) => x.block_type === 'workflow_state').map((x) => x.key));
        for (let i = 0; i < stepsRicalcolati.length; i++) {
          const x = stepsRicalcolati[i], r = (az.imposta || []).find((y) => y.block_type === x.block_type && y.key === x.key);
          if (!r) continue;
          const nuove = {};
          for (const [k, v] of Object.entries(r.proprieta || {})) if (x[k] === undefined && !(k === 'on_signed_state' && !statiModulo.has(v))) nuove[k] = v;
          if (Object.keys(nuove).length) { stepsRicalcolati[i] = { ...x, ...nuove }; impostati.push(r.key); }
        }
        const inFondo = ricalcolati.filter((r) => r.in_fondo).map((r) => r.key);
        const stepsConvertiti = inFondo.length ? [...stepsRicalcolati.filter((x) => !(x.block_type === 'field' && inFondo.includes(x.key))), ...inFondo.map((k) => stepsRicalcolati.find((x) => x.block_type === 'field' && x.key === k))] : stepsRicalcolati;
        const nuoviDaConvertire = daConvertire.filter((c) => !schema.steps.some((x) => x.key === c.key))
          .map((c) => ({ id: cfg.idPrefisso + Math.random().toString(36).slice(2, 10), block_type: 'field', key: c.key, label: c.label || c.key, type: c.type || 'multiselect', options: c.options }));
        if (!daAggiungere.length && !daConvertire.length && !ricalcolati.length && !rinominati.length && !impostati.length) { segna(chiave); esiti.push({ slug, key: az.key, esito: 'nulla da fare' }); continue; } // formule già cambiate dall'utente (o già giuste): niente da pubblicare
        const bozzaE = await callAs(admin, 'PUT', '/builder/' + slug + '/draft', { schema: { version: 3, steps: [...stepsConvertiti, ...nuoviDaConvertire, ...daAggiungere] } });
        if (!bozzaE.ok) { console.error('[seed-blocchi] bozza ' + slug + '/' + az.key + ' fallita:', JSON.stringify(bozzaE.data)); esiti.push({ slug, key: az.key, esito: 'errore bozza' }); continue; }
        const pubE = await callAs(admin, 'POST', '/builder/' + slug + '/publish', {});
        if (!pubE.ok) { console.error('[seed-blocchi] pubblicazione ' + slug + '/' + az.key + ' fallita:', JSON.stringify(pubE.data)); esiti.push({ slug, key: az.key, esito: 'errore pubblicazione' }); continue; }
        // Un valore scritto prima come testo («Balcone, Loggia») diventa l'elenco corrispondente; gli altri non si toccano.
        const convertiti = daConvertire.filter((c) => schema.steps.some((x) => x.key === c.key && x.block_type === 'field' && x.type !== (c.type || 'multiselect')));
        if (convertiti.length) {
          const righe = db.prepare('SELECT id, data FROM records WHERE module_slug = ?').all(slug);
          const agg = db.prepare('UPDATE records SET data = ? WHERE id = ?');
          for (const r of righe) {
            let dati; try { dati = JSON.parse(r.data); } catch (e) { continue; }
            let cambiato = false;
            for (const c of convertiti) {
              if (typeof dati[c.key] === 'string') {
                dati[c.key] = dati[c.key].split(/[,;\n]+/).map((t) => t.trim()).filter(Boolean);
                cambiato = true;
              }
            }
            if (cambiato) agg.run(JSON.stringify(dati), r.id);
          }
        }
        segna(chiave);
        delete moduliPerSlug[slug]; // i campi del modulo sono cambiati: le estensioni dopo questa devono rivederli
        esiti.push({ slug, key: az.key, esito: 'applicato' });
        continue;
      }
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

// I moduli NUOVI del verticale (parte «moduli» del pacchetto): quelli senza un omonimo generico, che non stanno quindi nella Libreria. Si creano dalle rotte vere del Builder
// (crea, bozza, pubblica), solo se mancano e solo se esistono i moduli che citano (`richiede`); mai si sovrascrive un modulo che c'è già. Un modulo rimasto vuoto per un errore a
// metà si completa al giro dopo. Una volta sola per modulo (marcatore `modulo:<slug>`).
async function creaModuli(seed = {}, { callAs = require('./lib/internal-api').callAs } = {}) {
  const esiti = [];
  const admin = db.prepare("SELECT * FROM users WHERE role = 'admin' LIMIT 1").get();
  for (const [slug, def] of Object.entries(seed)) {
    if (slug.startsWith('_') || !def || !Array.isArray(def.steps)) continue;
    const chiave = 'modulo:' + slug;
    if (gia(chiave) || !admin) continue;
    if ((def.richiede || []).some((r) => !db.prepare('SELECT 1 FROM modules WHERE slug = ? AND installed = 1').get(r))) continue; // manca un modulo che cita: ci riprova
    const esistente = db.prepare('SELECT schema_json FROM modules WHERE slug = ?').get(slug);
    if (esistente && esistente.schema_json && esistente.schema_json !== '{}') { segna(chiave); continue; } // c'è già, con un suo schema: non si tocca
    if (!esistente) {
      const c = await callAs(admin, 'POST', '/modules/create', { name: def.nome, slug, icon: def.icon, color: def.color });
      if (!c.ok) { console.error('[seed-blocchi] modulo ' + slug + ' non creato:', JSON.stringify(c.data)); esiti.push({ slug, esito: 'errore creazione' }); continue; }
    }
    const bozza = await callAs(admin, 'PUT', '/builder/' + slug + '/draft', { schema: { version: 3, steps: def.steps } });
    if (!bozza.ok) { console.error('[seed-blocchi] bozza del modulo ' + slug + ' fallita:', JSON.stringify(bozza.data)); esiti.push({ slug, esito: 'errore bozza' }); continue; }
    const pub = await callAs(admin, 'POST', '/builder/' + slug + '/publish', {});
    if (!pub.ok) { console.error('[seed-blocchi] pubblicazione del modulo ' + slug + ' fallita:', JSON.stringify(pub.data)); esiti.push({ slug, esito: 'errore pubblicazione' }); continue; }
    segna(chiave); esiti.push({ slug, esito: 'applicato' });
  }
  return esiti;
}

// Le relazioni da riallineare (parte «relazioni» del pacchetto): una relazione che cita un modulo che nel tenant non esiste (né come slug né come slug della Libreria) mentre il modulo giusto
// c'è con un altro slug. Passa da bozza e pubblicazione del Builder; una volta sola per relazione (marcatore `relazione:<modulo>:<chiave>`); se il modulo giusto non c'è ancora, ci riprova.
async function riallineaRelazioni(seed = {}, { callAs = require('./lib/internal-api').callAs } = {}) {
  const esiti = [];
  const admin = db.prepare("SELECT * FROM users WHERE role = 'admin' LIMIT 1").get();
  const esiste = (slug) => !!db.prepare('SELECT 1 FROM modules WHERE installed = 1 AND (slug = ? OR registry_slug = ?)').get(slug, slug);
  for (const [slug, lista] of Object.entries(seed)) {
    if (slug.startsWith('_') || !Array.isArray(lista)) continue;
    for (const r of lista) {
      const chiave = 'relazione:' + slug + ':' + r.chiave;
      if (gia(chiave) || !admin) continue;
      const m = db.prepare('SELECT schema_json FROM modules WHERE slug = ? AND installed = 1').get(slug);
      if (!m) continue;
      let schema; try { schema = JSON.parse(m.schema_json); } catch (e) { continue; }
      if (schema.version !== 3 || !Array.isArray(schema.steps)) continue;
      const rel = schema.steps.find((x) => x.block_type === 'relation' && x.key === r.chiave);
      if (!rel || rel.target_module !== r.da || esiste(r.da)) { segna(chiave); continue; } // niente da riallineare
      const bersaglio = db.prepare('SELECT slug FROM modules WHERE installed = 1 AND (slug = ? OR registry_slug = ?)').get(r.a, r.a);
      if (!bersaglio) continue; // il modulo giusto non c'è ancora: riproverà
      const campi = chiaviDelModulo(bersaglio.slug) || new Set();
      const steps = schema.steps.map((x) => (x === rel ? { ...x, target_module: bersaglio.slug, ...(r.display_field && campi.has(r.display_field) ? { display_field: r.display_field } : {}) } : x));
      const bozza = await callAs(admin, 'PUT', '/builder/' + slug + '/draft', { schema: { version: 3, steps } });
      if (!bozza.ok) { console.error('[seed-blocchi] bozza ' + slug + '/' + r.chiave + ' fallita:', JSON.stringify(bozza.data)); esiti.push({ slug, key: r.chiave, esito: 'errore bozza' }); continue; }
      const pub = await callAs(admin, 'POST', '/builder/' + slug + '/publish', {});
      if (!pub.ok) { console.error('[seed-blocchi] pubblicazione ' + slug + '/' + r.chiave + ' fallita:', JSON.stringify(pub.data)); esiti.push({ slug, key: r.chiave, esito: 'errore pubblicazione' }); continue; }
      segna(chiave); esiti.push({ slug, key: r.chiave, esito: 'applicato' });
    }
  }
  return esiti;
}

// Le proprietà di modulo del verticale (parte «proprieta» del pacchetto: oggi solo `quick_toggle`, il cerchio rapido in tabella). Una volta sola per modulo (marcatore `proprieta:<slug>`):
// se poi qualcuno le cambia dal Builder, al riavvio non tornano indietro. Il modulo che non c'è (ancora) si riprova.
async function impostaProprieta(seed = {}, { callAs = require('./lib/internal-api').callAs } = {}) {
  const esiti = [];
  const admin = db.prepare("SELECT * FROM users WHERE role = 'admin' LIMIT 1").get();
  for (const [slug, prop] of Object.entries(seed)) {
    if (slug.startsWith('_') || !prop || typeof prop !== 'object') continue;
    const chiave = 'proprieta:' + slug;
    if (gia(chiave) || !admin || !db.prepare('SELECT 1 FROM modules WHERE slug = ? AND installed = 1').get(slug)) continue;
    const corpo = {}; if (prop.quick_toggle !== undefined) corpo.quick_toggle = !!prop.quick_toggle;
    const r = await callAs(admin, 'PATCH', '/modules/' + slug, corpo);
    if (!r.ok) { console.error('[seed-blocchi] proprietà di ' + slug + ' non impostate:', JSON.stringify(r.data)); esiti.push({ slug, esito: 'errore' }); continue; }
    segna(chiave); esiti.push({ slug, esito: 'applicato' });
  }
  return esiti;
}

// Le sezioni e i dati chiave del dettaglio (parte «sezioni» del pacchetto): una proprietà `sezione` sui campi (per raggrupparli nella scheda) e `dato_chiave` (in evidenza in alto). Solo sui campi che
// esistono e che non hanno già un valore (si completa, non si sovrascrive), da bozza e pubblicazione del Builder, una volta sola per modulo (marcatore `sezioni:<slug>`).
async function assegnaSezioni(seed = {}, { callAs = require('./lib/internal-api').callAs } = {}) {
  const esiti = [];
  const admin = db.prepare("SELECT * FROM users WHERE role = 'admin' LIMIT 1").get();
  for (const [slug, def] of Object.entries(seed)) {
    if (slug.startsWith('_') || !def) continue;
    // Due cose si assegnano, ognuna una volta sola per modulo: sezioni/dati chiave (marcatore `sezioni:<slug>`) e `validazioni` (campo → regola, es. codice fiscale; marcatore `validazioni:<slug>`).
    const chiave = 'sezioni:' + slug, chiaveVal = 'validazioni:' + slug;
    const faSezioni = !gia(chiave), faValidazioni = !!def.validazioni && !gia(chiaveVal);
    if ((!faSezioni && !faValidazioni) || !admin) continue;
    const m = db.prepare('SELECT schema_json FROM modules WHERE slug = ? AND installed = 1').get(slug);
    if (!m) continue;
    let schema; try { schema = JSON.parse(m.schema_json); } catch (e) { continue; }
    if (schema.version !== 3 || !Array.isArray(schema.steps)) continue;
    const dellaSezione = new Map(); for (const [nome, chiavi] of Object.entries(def.sezioni || {})) for (const k of chiavi) dellaSezione.set(k, nome);
    const chiaveSet = new Set(def.dati_chiave || []);
    let cambiato = 0;
    const steps = schema.steps.map((x) => {
      if (!['field', 'computed'].includes(x.block_type) || !x.key) return x;
      const y = { ...x };
      if (faSezioni && dellaSezione.has(x.key) && !x.sezione) { y.sezione = dellaSezione.get(x.key); cambiato++; }
      if (faSezioni && chiaveSet.has(x.key) && !x.dato_chiave) { y.dato_chiave = true; cambiato++; }
      if (faValidazioni && def.validazioni[x.key] && !x.validazione) { y.validazione = def.validazioni[x.key]; cambiato++; }
      return y;
    });
    if (!cambiato) { if (faSezioni) segna(chiave); if (faValidazioni) segna(chiaveVal); continue; }
    const bozza = await callAs(admin, 'PUT', '/builder/' + slug + '/draft', { schema: { version: 3, steps } });
    if (!bozza.ok) { console.error('[seed-blocchi] bozza sezioni ' + slug + ' fallita:', JSON.stringify(bozza.data)); esiti.push({ slug, esito: 'errore bozza' }); continue; }
    const pub = await callAs(admin, 'POST', '/builder/' + slug + '/publish', {});
    if (!pub.ok) { console.error('[seed-blocchi] pubblicazione sezioni ' + slug + ' fallita:', JSON.stringify(pub.data)); esiti.push({ slug, esito: 'errore pubblicazione' }); continue; }
    if (faSezioni) segna(chiave); if (faValidazioni) segna(chiaveVal);
    esiti.push({ slug, esito: 'applicato', campi: cambiato });
  }
  return esiti;
}

// Le MIGRAZIONI del verticale (parte «migrazioni» del pacchetto): i record di un modulo che non serve più passano in un altro modulo, una volta sola (marcatore `migrazione:<da>><a>`).
//   { da: 'visite', a: 'attivita', campi: { campo_di_arrivo: 'campo_di_partenza' }, fissi: { campo: valore }, dividi_data_ora: { da, data, ora }, stati: { stato_di_partenza: stato_di_arrivo }, spegni: true }
// I record si creano dal server vero (permessi e storico come sempre); quelli di partenza restano com'erano, segnati `_migrato` col nuovo id, e il modulo di partenza si SPEGNE (non si cancella: si può riaccendere).
// Un modulo di partenza assente non è un errore (niente da spostare); uno di arrivo senza i campi citati si riprova dopo.
async function migraModuli(seed = {}, { callAs = require('./lib/internal-api').callAs } = {}) {
  const esiti = [];
  const admin = db.prepare("SELECT * FROM users WHERE role = 'admin' LIMIT 1").get();
  for (const [nome, m] of Object.entries(seed)) {
    if (nome.startsWith('_') || !m || !m.da || !m.a) continue;
    const chiave = 'migrazione:' + m.da + '>' + m.a;
    if (gia(chiave) || !admin) continue;
    const dest = chiaviDelModulo(m.a), src = chiaviDelModulo(m.da);
    if (!src || !dest) continue;
    const citati = [...Object.keys(m.campi || {}), ...Object.keys(m.fissi || {}), ...(m.dividi_data_ora ? [m.dividi_data_ora.data, m.dividi_data_ora.ora] : [])];
    if (citati.some((k) => !dest.has(k))) continue;
    const righe = db.prepare("SELECT id, data FROM records WHERE module_slug = ? ORDER BY id").all(m.da);
    let spostati = 0, errori = 0;
    for (const r of righe) {
      let d; try { d = JSON.parse(r.data); } catch (e) { continue; }
      if (d._migrato) continue;
      const nuovo = { ...(m.fissi || {}) };
      for (const [a, da] of Object.entries(m.campi || {})) if (d[da] !== undefined && d[da] !== null && d[da] !== '') nuovo[a] = d[da];
      if (m.dividi_data_ora && d[m.dividi_data_ora.da]) {
        const t = String(d[m.dividi_data_ora.da]).match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/);
        if (t) { nuovo[m.dividi_data_ora.data] = t[1]; if (t[2]) nuovo[m.dividi_data_ora.ora] = t[2]; }
      }
      if (m.stati) { const st = m.stati[d._stato]; if (st) nuovo._stato = st; }
      if (d._demo) nuovo._demo = d._demo;
      const out = await callAs(admin, 'POST', '/records/' + m.a, nuovo);
      if (!out.ok) { errori++; console.error('[seed-blocchi] migrazione ' + m.da + ' → ' + m.a + ': record ' + r.id + ' non spostato:', JSON.stringify(out.data)); continue; }
      if (nuovo._demo) db.prepare("UPDATE records SET data = json_set(data, '$._demo', 1) WHERE id = ?").run(out.data.id);
      db.prepare("UPDATE records SET data = json_set(data, '$._migrato', ?) WHERE id = ?").run(out.data.id, r.id);
      spostati++;
    }
    if (errori) { esiti.push({ slug: m.da, esito: 'errori', spostati, errori }); continue; } // niente marcatore: al prossimo avvio si completano quelli rimasti
    if (m.spegni) db.prepare('UPDATE modules SET active = 0 WHERE slug = ?').run(m.da);
    segna(chiave); esiti.push({ slug: m.da, esito: 'applicato', spostati, verso: m.a });
  }
  return esiti;
}

// I «ruoli del modulo» del verticale (parte «ruoli» del pacchetto): si dichiarano solo se il modulo esiste, è installato, NON ne ha già una (si completa,
// non si sovrascrive) e ha tutti i campi che la dichiarazione cita. Una volta sola per modulo (marcatore `ruoli:<slug>`); se il modulo non c'è ancora, ci riprova al giro dopo.
function dichiaraRuoli(seed = {}) {
  const moduleRoles = require('./module-roles');
  const esiti = [];
  for (const [slug, dich] of Object.entries(seed)) {
    if (slug.startsWith('_')) continue;
    const chiave = 'ruoli:' + slug;
    if (gia(chiave)) continue;
    const mod = db.prepare('SELECT slug FROM modules WHERE slug = ? AND installed = 1').get(slug);
    if (!mod) continue;
    const campi = chiaviDelModulo(slug);
    if (!campi) continue;
    const citati = Object.values(dich.roles || {});
    if (moduleRoles.get(slug) || citati.some((c) => !campi.has(c))) { if (moduleRoles.get(slug)) segna(chiave); continue; } // già dichiarato: non si tocca e non si riprova; campi mancanti: può ancora arrivare l'estensione
    moduleRoles.set(slug, dich); segna(chiave); esiti.push({ slug, esito: 'applicato' });
  }
  return esiti;
}

// Un solo giro non basta su un tenant appena nato: un blocco può citare i campi di un altro modulo che il suo
// stesso giro aggiunge solo più avanti (la scheda di Immobili cita campi di Clienti, che si estende dopo). Si
// ripete finché c'è qualcosa da applicare, al massimo MAX_GIRI volte; ogni giro è comunque idempotente.
const MAX_GIRI = 4;

// ── Pacchetti di verticale ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// Un pacchetto è un insieme di dati con una parte per tipo di blocco; ogni parte ha la stessa forma di sempre (`{ <modulo>: [...] }`). Il core NON ne contiene: li
// custodisce Super Admin (accanto all'analisi) e li INVIA al tenant, che li tiene qui (`pacchetti_ricevuti`) per riapplicarli ai riavvii anche senza Super Admin.
const PARTI = ['estensioni', 'documenti', 'abbinamenti', 'moduli', 'ruoli', 'relazioni', 'proprieta', 'sezioni', 'dimostrativi', 'guida', 'migrazioni']; // `dimostrativi` e `guida` non sono blocchi applicati all'avvio: li leggono lib/dati-dimostrativi.js e routes/guida.js su richiesta
const SLUG_PACCHETTO = /^[a-z0-9][a-z0-9-]{0,59}$/;
const LIMITE_PACCHETTO = 2000000; // byte di JSON: un pacchetto vero è di poche decine di KB
db.exec('CREATE TABLE IF NOT EXISTS pacchetti_attivi (slug TEXT PRIMARY KEY, attivato_il TEXT DEFAULT CURRENT_TIMESTAMP)');
db.exec('CREATE TABLE IF NOT EXISTS pacchetti_ricevuti (slug TEXT PRIMARY KEY, versione INTEGER NOT NULL DEFAULT 1, parti TEXT NOT NULL, ricevuto_il TEXT DEFAULT CURRENT_TIMESTAMP)');

const pacchettiDisponibili = () => db.prepare('SELECT slug FROM pacchetti_ricevuti ORDER BY slug').all().map((r) => r.slug);
function leggiPacchetto(slug) {
  const out = {};
  for (const parte of PARTI) out[parte] = {};
  const r = SLUG_PACCHETTO.test(String(slug)) ? db.prepare('SELECT parti FROM pacchetti_ricevuti WHERE slug = ?').get(slug) : null;
  if (!r) return out;
  let dati = {}; try { dati = JSON.parse(r.parti); } catch (e) { /* illeggibile: pacchetto vuoto */ }
  for (const parte of PARTI) if (dati[parte] && typeof dati[parte] === 'object' && !Array.isArray(dati[parte])) out[parte] = dati[parte];
  return out;
}
// Riceve (o aggiorna) un pacchetto. Controlla nome, forma e dimensione; tiene solo le parti che conosce. Ritorna { ok } oppure { errore }.
function riceviPacchetto(slug, versione, parti) {
  if (!SLUG_PACCHETTO.test(String(slug))) return { errore: 'Nome del pacchetto non valido' };
  if (!parti || typeof parti !== 'object' || Array.isArray(parti)) return { errore: 'Il pacchetto non ha le sue parti' };
  const pulito = {};
  for (const parte of PARTI) {
    const v = parti[parte];
    if (v === undefined) continue;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return { errore: 'La parte «' + parte + '» non è un oggetto' };
    pulito[parte] = v;
  }
  const json = JSON.stringify(pulito);
  if (json.length > LIMITE_PACCHETTO) return { errore: 'Pacchetto troppo grande' };
  const n = Math.max(1, Math.min(100000, parseInt(versione, 10) || 1));
  db.prepare('INSERT INTO pacchetti_ricevuti (slug, versione, parti) VALUES (?, ?, ?) ON CONFLICT(slug) DO UPDATE SET versione = excluded.versione, parti = excluded.parti, ricevuto_il = CURRENT_TIMESTAMP').run(slug, n, json);
  return { ok: true, versione: n };
}
const pacchettiAttivi = () => { const d = new Set(pacchettiDisponibili()); return db.prepare('SELECT slug FROM pacchetti_attivi ORDER BY slug').all().map((r) => r.slug).filter((x) => d.has(x)); };
// Attiva un pacchetto già ricevuto. Ritorna true/false; ripetere non fa danni.
function attivaPacchetto(slug) {
  if (!pacchettiDisponibili().includes(slug)) return false;
  db.prepare('INSERT OR IGNORE INTO pacchetti_attivi (slug) VALUES (?)').run(slug);
  return true;
}
// Stato per Super Admin: quali pacchetti ha il tenant (con la versione) e cosa è già stato applicato (i marcatori), per decidere cosa inviare.
function statoPacchetti() {
  const attivi = new Set(pacchettiAttivi());
  return {
    pacchetti: db.prepare('SELECT slug, versione FROM pacchetti_ricevuti ORDER BY slug').all().map((r) => ({ slug: r.slug, versione: r.versione, attivo: attivi.has(r.slug) })),
    seed_applicati: db.prepare('SELECT chiave FROM seed_applicati').all().map((r) => r.chiave),
  };
}
// I marcatori che l'applicazione di un pacchetto lascia in `seed_applicati` (la definizione è condivisa con Super Admin).
const marcatoriDelPacchetto = (slug) => require('./pacchetto-marcatori').marcatoriDelPacchetto(leggiPacchetto(slug));
// Un tenant che ha già i marcatori di un pacchetto ricevuto lo ha attivo da solo, senza che nessuno lo debba dire.
function migraDaMarcatori() {
  const attivi = new Set(pacchettiAttivi()), fatti = new Set(db.prepare('SELECT chiave FROM seed_applicati').all().map((r) => r.chiave)), migrati = [];
  for (const slug of pacchettiDisponibili()) {
    if (attivi.has(slug)) continue;
    if (marcatoriDelPacchetto(slug).some((c) => fatti.has(c)) && attivaPacchetto(slug)) migrati.push(slug);
  }
  return migrati;
}

// Un giro di tutti i tipi di blocco di UN pacchetto; ritorna quanti ne ha applicati.
async function giroPacchetto(slug) {
  const P = leggiPacchetto(slug); let applicati = 0;
  const conta = (esiti, testo) => esiti.filter((e) => e.esito === 'applicato').forEach((e) => { applicati++; console.log('[seed-blocchi] ' + slug + ': ' + testo(e)); });
  try { conta(await creaModuli(P.moduli), (e) => 'modulo «' + e.slug + '» creato'); } catch (e) { console.error('[seed-blocchi] moduli nuovi: non riuscito:', e.message); }
  for (const [tipo, cfg] of Object.entries(TIPI)) {
    try { conta(await applicaSeed(P[cfg.parte], { tipo }), (e) => cfg.nome + ' «' + e.key + '» aggiunto al modulo ' + e.slug); }
    catch (e) { console.error('[seed-blocchi] ' + cfg.nome + ': non riuscito:', e.message); }
  }
  try { conta(await riallineaRelazioni(P.relazioni), (e) => 'relazione «' + e.key + '» di ' + e.slug + ' riallineata'); } catch (e) { console.error('[seed-blocchi] relazioni: non riuscito:', e.message); }
  try { conta(await assegnaSezioni(P.sezioni), (e) => 'sezioni del modulo ' + e.slug + ' assegnate (' + e.campi + ' impostazioni)'); } catch (e) { console.error('[seed-blocchi] sezioni: non riuscito:', e.message); }
  try { conta(await impostaProprieta(P.proprieta), (e) => 'proprietà del modulo ' + e.slug + ' impostate'); } catch (e) { console.error('[seed-blocchi] proprietà dei moduli: non riuscito:', e.message); }
  try { conta(dichiaraRuoli(P.ruoli), (e) => 'ruoli del modulo ' + e.slug + ' dichiarati'); } catch (e) { console.error('[seed-blocchi] ruoli dei moduli: non riuscito:', e.message); }
  try { conta(await migraModuli(P.migrazioni), (e) => e.spostati + ' record di «' + e.slug + '» spostati in «' + e.verso + '»'); } catch (e) { console.error('[seed-blocchi] migrazioni: non riuscito:', e.message); }
  return applicati;
}

// Applica i pacchetti attivi del tenant (all'avvio e a fine creazione). Senza pacchetti attivi non fa niente.
// Il widget «Da fare» della Dashboard (agenda delle scadenze): se un modulo ha dichiarato la scadenza negli Avvisi e la Dashboard ha già dei widget (altrimenti ci pensa
// l'impostazione dal profilo, che riempie solo una Dashboard vuota) e non c'è già un widget «agenda», lo si aggiunge in fondo, una volta sola (marcatore `widget:agenda`).
function aggiungiWidgetAgenda() {
  const chiave = 'widget:agenda';
  if (gia(chiave)) return false;
  const conScadenze = require('./module-roles').list({ use: 'avvisi' }).some((m) => m.avvisi.scadenze && m.roles.scadenza);
  if (!conScadenze) return false;
  const ci = db.prepare("SELECT COUNT(*) c, COALESCE(MAX(sort_order), 0) m, SUM(type = 'agenda') a FROM dashboard_widgets WHERE page = 'dashboard'").get();
  if (!ci.c) return false; // Dashboard vuota: non si marca, ci riprova al prossimo giro
  if (!ci.a) db.prepare("INSERT INTO dashboard_widgets (type, module_slug, field, aggregation, label, color, sort_order, config, roles, user_ids, page) VALUES ('agenda', NULL, NULL, 'count', 'Da fare', '#2563EB', ?, '{}', '[]', '[]', 'dashboard')").run(ci.m + 1);
  segna(chiave); return !ci.a;
}

async function run() {
  migraDaMarcatori().forEach((slug) => console.log('[seed-blocchi] pacchetto «' + slug + '» riconosciuto come già applicato: attivo'));
  const pacchetti = pacchettiAttivi();
  if (!pacchetti.length) return;
  for (let giro = 1; giro <= MAX_GIRI; giro++) {
    let applicati = 0;
    for (const slug of pacchetti) applicati += await giroPacchetto(slug);
    if (!applicati) break;
  }
  try { if (aggiungiWidgetAgenda()) console.log('[seed-blocchi] widget «Da fare» aggiunto alla Dashboard'); } catch (e) { console.error('[seed-blocchi] widget Da fare non aggiunto:', e.message); }
}

module.exports = { migraModuli, aggiungiWidgetAgenda, pacchettiDisponibili, leggiPacchetto, riceviPacchetto, statoPacchetti, pacchettiAttivi, attivaPacchetto, marcatoriDelPacchetto, migraDaMarcatori, applicaSeed, modelloApplicabile, abbinamentoApplicabile, TIPI, dichiaraRuoli, creaModuli, riallineaRelazioni, impostaProprieta, assegnaSezioni, run };
