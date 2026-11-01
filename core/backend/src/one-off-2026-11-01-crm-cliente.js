'use strict';
// Una tantum, 1/11/2026: prima parte del workflow Clienti/Immobili/AML richiesto dal vivo
// per il verticale Mediazione Immobiliare di zucca ("i moduli impostati sono corretti con lo
// scope di zucca MA..."). Idempotente (si disattiva da solo dopo il primo giro riuscito) e
// scoped a questo tenant (nomi di modulo reali, non primitive generiche) — un tenant senza
// questi moduli esce subito, nessun effetto. Due pezzi:
//
// 1) Clienti: aggiunge tipo_soggetto (persona/società), codice_fiscale_piva, tipo_cliente
//    (venditore/acquirente) e i campi di ricerca per chi compra; sostituisce il workflow
//    generico (4 stati astratti, mai usati nello scopo reale — verificato dal vivo: i 2
//    record esistenti sono entrambi nello stato iniziale, nessuno negli altri 3, quindi
//    rimuoverli non orfana nessun record) con quello descritto dal vivo:
//    verifica_identita_cliente -> documenti_inviati -> cliente_verificato.
// 2) Crea il modulo "Interazioni" (CRM): telefonate/email/visite per cliente, con un campo
//    "prossimo contatto" per il planner — richiesto esplicitamente ("va introdotto il modulo
//    CRM"), non esisteva un modulo equivalente (il modulo "Attività" è una todo-list generica,
//    senza relazione a un cliente).
//
// Lavora SEMPRE sugli step v3 grezzi (mai via parseSchemaNormalized/toV2Lenient): i moduli di
// zucca sono già in vero formato v3 ("version":3,"steps":[...], verificato dal vivo sul DB) —
// passarli per la via v2-lenient li convertirebbe di formato al momento della ripubblicazione
// (publish salva il draft così com'è, non lo riconverte), rischio reale già visto altrove in
// questa sessione (isV3() guard pitfall). Qui si manipola l'array steps direttamente,
// restando in v3 per l'intero giro.
const db = require('./db');

const rid = (prefix) => prefix + '_' + Math.random().toString(36).slice(2, 10);

async function estendiClienti() {
  const mod = db.prepare("SELECT * FROM modules WHERE slug = 'clienti' AND installed = 1").get();
  if (!mod) return false;
  let schema;
  try { schema = JSON.parse(mod.schema_json); } catch (e) { return false; }
  if (schema.version !== 3 || !Array.isArray(schema.steps)) return false; // non v3: fuori scope di questo script
  if (schema.steps.some((s) => s.block_type === 'field' && s.key === 'tipo_soggetto')) return false; // già fatto

  const nuoviCampi = [
    { id: rid('fld'), block_type: 'field', key: 'tipo_soggetto', label: 'Tipo soggetto', type: 'select', options: ['Persona fisica', 'Società'] },
    { id: rid('fld'), block_type: 'field', key: 'codice_fiscale_piva', label: 'Codice Fiscale / P.IVA', type: 'text' },
    { id: rid('fld'), block_type: 'field', key: 'tipo_cliente', label: 'Tipo cliente', type: 'select', options: ['Venditore', 'Acquirente'] },
    { id: rid('fld'), block_type: 'field', key: 'esigenza_acquisto', label: 'Esigenza (per Acquirente)', type: 'select', options: ["Ha già individuato l'immobile", 'Cerca immobile'] },
    { id: rid('fld'), block_type: 'field', key: 'ricerca_tipologia', label: 'Tipologia immobile ricercata', type: 'text' },
    { id: rid('fld'), block_type: 'field', key: 'ricerca_budget_max', label: 'Budget massimo ricerca', type: 'currency' },
    { id: rid('fld'), block_type: 'field', key: 'ricerca_zona', label: 'Zona/città ricercata', type: 'text' },
  ];

  // Stati rimossi: aggiorna_dati_anagrafici, registra_note_aggiuntive, verifica_completezza_profilo
  // (nessun record esistente li usa, verificato dal vivo). verifica_identita_cliente resta
  // IDENTICO (stesso step, non ricreato) perché è lo stato iniziale di record già esistenti.
  const statoIniziale = schema.steps.find((s) => s.block_type === 'workflow_state' && s.key === 'verifica_identita_cliente');
  const permessi = schema.steps.filter((s) => s.block_type === 'permissions');
  const campiEsistenti = schema.steps.filter((s) => s.block_type === 'field' || s.block_type === 'relation');

  const nuoviStati = [
    statoIniziale,
    { id: rid('wst'), block_type: 'workflow_state', key: 'documenti_inviati', label: 'Documenti inviati', color: '#F59E0B', initial: false },
    { id: rid('wst'), block_type: 'workflow_state', key: 'cliente_verificato', label: 'Cliente verificato', color: '#10B981', initial: false },
  ];
  const nuoveTransizioni = [
    { id: rid('wtr'), block_type: 'workflow_transition', from: 'verifica_identita_cliente', to: 'documenti_inviati', label: 'Documenti inviati', roles: ['operatore_front_office'] },
    { id: rid('wtr'), block_type: 'workflow_transition', from: 'documenti_inviati', to: 'cliente_verificato', label: 'Documenti ricevuti e verificati', roles: ['operatore_front_office'] },
    { id: rid('wtr'), block_type: 'workflow_transition', from: 'documenti_inviati', to: 'verifica_identita_cliente', label: 'Documenti da rifare', roles: ['operatore_front_office'] },
  ];

  const nuoviSteps = [...campiEsistenti, ...nuoviCampi, ...nuoviStati, ...nuoveTransizioni, ...permessi];
  const nuovoSchema = { version: 3, steps: nuoviSteps };

  const { callAs } = require('./lib/internal-api');
  const admin = db.prepare("SELECT * FROM users WHERE role = 'admin' LIMIT 1").get();
  if (!admin) return false;
  const draft = await callAs(admin, 'PUT', '/builder/clienti/draft', { schema: nuovoSchema });
  if (!draft.ok) { console.error('[one-off-crm-cliente] draft clienti fallito:', JSON.stringify(draft.data)); return false; }
  const pub = await callAs(admin, 'POST', '/builder/clienti/publish', {});
  if (!pub.ok) { console.error('[one-off-crm-cliente] publish clienti fallito:', JSON.stringify(pub.data)); return false; }
  return true;
}

async function creaModuloInterazioni() {
  const esiste = db.prepare("SELECT 1 FROM modules WHERE slug = 'interazioni'").get();
  if (esiste) return false; // già fatto (o nome in conflitto: esce senza toccare nulla)
  const clientiMod = db.prepare("SELECT 1 FROM modules WHERE slug = 'clienti' AND installed = 1").get();
  if (!clientiMod) return false;

  const { callAs } = require('./lib/internal-api');
  const admin = db.prepare("SELECT * FROM users WHERE role = 'admin' LIMIT 1").get();
  if (!admin) return false;

  const create = await callAs(admin, 'POST', '/modules/create', { name: 'Interazioni', slug: 'interazioni', icon: 'activity', color: '#06B6D4' });
  if (!create.ok) { console.error('[one-off-crm-cliente] creazione modulo interazioni fallita:', JSON.stringify(create.data)); return false; }

  const schema = {
    version: 3,
    steps: [
      { id: rid('rel'), block_type: 'relation', key: 'cliente', label: 'Cliente', type: 'many_to_one', target_module: 'clienti', display_field: 'nome', required: true },
      { id: rid('fld'), block_type: 'field', key: 'tipo', label: 'Tipo', type: 'select', options: ['Telefonata', 'Email', 'Visita', 'Altro'], required: true },
      { id: rid('fld'), block_type: 'field', key: 'data_ora', label: 'Data e ora', type: 'datetime', required: true },
      { id: rid('fld'), block_type: 'field', key: 'esito', label: 'Esito / note', type: 'textarea' },
      { id: rid('fld'), block_type: 'field', key: 'prossimo_contatto', label: 'Prossimo contatto pianificato', type: 'date' },
      { id: rid('wst'), block_type: 'workflow_state', key: 'pianificata', label: 'Pianificata', color: '#6B7280', initial: true },
      { id: rid('wst'), block_type: 'workflow_state', key: 'svolta', label: 'Svolta', color: '#10B981', initial: false },
      { id: rid('wtr'), block_type: 'workflow_transition', from: 'pianificata', to: 'svolta', label: 'Segna svolta' },
    ],
  };
  const draft = await callAs(admin, 'PUT', '/builder/interazioni/draft', { schema });
  if (!draft.ok) { console.error('[one-off-crm-cliente] draft interazioni fallito:', JSON.stringify(draft.data)); return false; }
  const pub = await callAs(admin, 'POST', '/builder/interazioni/publish', {});
  if (!pub.ok) { console.error('[one-off-crm-cliente] publish interazioni fallito:', JSON.stringify(pub.data)); return false; }
  return true;
}

async function run() {
  try {
    const fatto = await estendiClienti();
    if (fatto) console.log('[one-off-crm-cliente] Clienti esteso: tipo_soggetto, codice_fiscale_piva, tipo_cliente, campi ricerca, workflow reale');
  } catch (e) { console.error('[one-off-crm-cliente] estensione Clienti fallita:', e.message); }
  try {
    const fatto = await creaModuloInterazioni();
    if (fatto) console.log('[one-off-crm-cliente] Modulo Interazioni (CRM) creato');
  } catch (e) { console.error('[one-off-crm-cliente] creazione Interazioni fallita:', e.message); }
}

module.exports = { run };
