'use strict';
// Una tantum, 1/11/2026: terzo pezzo del workflow Clienti/Immobili/AML richiesto dal vivo —
// estende Immobili con i campi della "Scheda Valutazione - Acquisizione Immobile" reale
// dell'agenzia (3 pagine: anagrafica comproprietari, localizzazione/contesto, caratteristiche
// interne, serramenti/isolamento, impianti/certificazione energetica, dati catastali,
// spese condominiali/mutuo, valutazione economica/incarico, esigenze di riacquisto).
// Idempotente e scoped a questo tenant, stesso principio di one-off-2026-11-01-crm-cliente.js:
// lavora sugli step v3 grezzi (mai parseSchemaNormalized/toV2Lenient — vedi quel file per il
// perché, isV3() guard pitfall).
//
// Scelte di modellazione: i checkbox-group del modulo cartaceo (es. "Infissi: Legno/PVC/
// Alluminio", una sola scelta) diventano select; i gruppi dove più voci possono coesistere
// (es. "Accessori impianti: Condizionatori, Allarme, Videocitofono...") diventano un campo
// testo libero invece di una dozzina di booleani separati — più vicino a come si compila
// davvero un sopralluogo, niente esplosione di campi quasi mai usati singolarmente.
// Comproprietari: Platform ha già una relazione "Proprietario" (singola); qui si aggiungono
// comproprietario_2/3 come relazioni opzionali verso Clienti, con le rispettive quote.
const db = require('./db');

const rid = (prefix) => prefix + '_' + Math.random().toString(36).slice(2, 10);
const campo = (key, label, type, extra) => ({ id: rid('fld'), block_type: 'field', key, label, type, ...(extra || {}) });
const relazione = (key, label, extra) => ({ id: rid('rel'), block_type: 'relation', key, label, type: 'many_to_one', target_module: 'clienti', display_field: 'nome', ...(extra || {}) });

async function estendiImmobili() {
  const mod = db.prepare("SELECT * FROM modules WHERE slug = 'immobili' AND installed = 1").get();
  if (!mod) return false;
  let schema;
  try { schema = JSON.parse(mod.schema_json); } catch (e) { return false; }
  if (schema.version !== 3 || !Array.isArray(schema.steps)) return false; // non v3: fuori scope
  if (schema.steps.some((s) => s.block_type === 'field' && s.key === 'quota_proprietario')) return false; // già fatto

  const nuoviStep = [
    // Anagrafica — quota del proprietario già collegato, più fino a 2 comproprietari
    campo('quota_proprietario', 'Quota proprietà (proprietario principale)', 'text'),
    relazione('comproprietario_2', 'Comproprietario 2'),
    campo('quota_comproprietario_2', 'Quota proprietà (comproprietario 2)', 'text'),
    relazione('comproprietario_3', 'Comproprietario 3'),
    campo('quota_comproprietario_3', 'Quota proprietà (comproprietario 3)', 'text'),

    // Localizzazione e contesto (indirizzo/comune/provincia/piano già esistenti)
    campo('numero_civico', 'Numero civico', 'text'),
    campo('interno', 'Interno', 'text'),
    campo('cap', 'CAP', 'text'),
    campo('zona_quartiere', 'Zona/quartiere', 'text'),
    campo('localita', 'Località', 'text'),
    campo('piani_totali', 'Piani totali edificio', 'number'),
    campo('contesto_stabile', 'Contesto stabile', 'select', { options: ['Signorile', 'Medio', 'Popolare'] }),
    campo('stato_edificio', 'Stato edificio', 'select', { options: ['Ottimo', 'Buono', 'Da ristrutturare'] }),
    campo('anno_costruzione', 'Anno costruzione', 'number'),
    campo('anno_ristrutturazione', 'Anno ristrutturazione', 'number'),
    campo('numero_unita_condominio', 'Numero unità condominio', 'number'),
    campo('ascensore', 'Ascensore', 'boolean'),
    campo('portineria', 'Portineria', 'boolean'),
    campo('assenza_barriere_architettoniche', 'Assenza barriere architettoniche', 'boolean'),

    // Caratteristiche interne e consistenza (superficie_mq/locali già esistenti)
    campo('totale_vani', 'Totale vani', 'number'),
    campo('composizione_vani', 'Composizione vani', 'text'),
    campo('numero_camere', 'Numero camere', 'number'),
    campo('numero_bagni', 'Numero bagni', 'number'),
    campo('sfogo_esterno', 'Sfogo esterno (balcone/terrazzo/loggia/portico)', 'text'),
    campo('giardino', 'Giardino', 'select', { options: ['Nessuno', 'Esclusivo', 'Condominiale'] }),
    campo('superficie_giardino_mq', 'Superficie giardino (mq)', 'number'),
    campo('pertinenze_box', 'Pertinenze e box (cantina, solaio, garage...)', 'text'),
    campo('posto_auto', 'Posto auto', 'select', { options: ['Nessuno', 'Di proprietà', 'Condominiale', 'Coperto', 'Scoperto'] }),
    campo('numero_posti_auto', 'Numero posti auto', 'number'),

    // Serramenti, finiture, isolamento
    campo('infissi_materiale', 'Infissi — materiale', 'select', { options: ['Legno', 'PVC', 'Alluminio'] }),
    campo('tipo_vetri', 'Tipo vetri', 'select', { options: ['Singolo', 'Doppio vetro', 'Triplo vetro'] }),
    campo('oscuranti_protezioni', 'Oscuranti e protezioni (tapparelle, inferriate...)', 'text'),
    campo('pavimenti', 'Pavimenti', 'select', { options: ['Parquet', 'Ceramica', 'Gres', 'Laminato', 'Altro'] }),
    campo('cappotto_termico', 'Cappotto termico', 'boolean'),
    campo('isolamento_acustico', 'Isolamento acustico', 'boolean'),
    campo('vmc', 'VMC (ventilazione meccanica)', 'boolean'),

    // Impianti e certificazione energetica
    campo('riscaldamento', 'Riscaldamento', 'select', { options: ['Autonomo', 'Centralizzato', 'Teleriscaldamento'] }),
    campo('tipologia_diffusione_riscaldamento', 'Tipologia diffusione riscaldamento', 'select', { options: ['A pavimento', 'Radiatori'] }),
    campo('alimentazione_riscaldamento', 'Alimentazione riscaldamento', 'select', { options: ['Metano', 'Pompa di calore', 'Stufa a pellet', 'Stufa a legna', 'Altro'] }),
    campo('accessori_impianti', 'Accessori impianti (condizionatori, allarme, videocitofono, domotica...)', 'text'),
    campo('fotovoltaico_presente', 'Fotovoltaico presente', 'boolean'),
    campo('fotovoltaico_kw', 'Fotovoltaico — kW installati', 'number'),
    campo('batteria_accumulo', 'Batteria di accumulo', 'boolean'),
    campo('solare_termico', 'Solare termico', 'boolean'),
    campo('stato_impianto_elettrico', 'Stato impianto elettrico', 'select', { options: ['A norma', 'Da rifare'] }),
    campo('stato_impianto_idraulico', 'Stato impianto idraulico', 'select', { options: ['A norma', 'Da rifare'] }),
    campo('fognatura', 'Fognatura', 'select', { options: ['Rete pubblica', 'Fossa biologica'] }),
    campo('classe_energetica', 'Classe energetica', 'select', { options: ['A4', 'A3', 'A2', 'A1', 'B', 'C', 'D', 'E', 'F', 'G'] }),
    campo('agibilita', 'Agibilità', 'select', { options: ['Sì', 'No', 'In corso di rilascio'] }),

    // Dati catastali e documenti (foglio/particella/subalterno/categoria già esistenti)
    campo('planimetria_conforme', 'Planimetria conforme', 'boolean'),
    campo('rendita_catastale', 'Rendita catastale', 'currency'),
    campo('documenti_disponibili', 'Documenti disponibili (checklist)', 'textarea'),

    // Spese condominiali e mutuo/gravami
    campo('spese_condominiali_importo', 'Spese condominiali', 'currency'),
    campo('spese_condominiali_periodicita', 'Periodicità spese condominiali', 'select', { options: ['Annuali', 'Mensili'] }),
    campo('spese_condominiali_comprende', 'Spese condominiali comprendono', 'text'),
    campo('spese_deliberate', 'Spese deliberate', 'textarea'),
    campo('residuo_mutuo', 'Residuo mutuo presente', 'boolean'),
    campo('residuo_mutuo_importo', 'Importo residuo mutuo', 'currency'),
    campo('ipoteche_vincoli', 'Ipoteche / vincoli', 'text'),

    // Valutazione economica e strategia commerciale (prezzo_richiesto già esistente)
    campo('valutazione_agente', 'Valutazione agente/agenzia', 'currency'),
    campo('tipologia_incarico', 'Tipologia incarico', 'select', { options: ['Esclusiva', 'Non esclusiva'] }),
    campo('durata_incarico', 'Durata incarico', 'text'),
    campo('provvigione_accordata', 'Provvigione accordata', 'text'),

    // Esigenze di riacquisto (per chi vende e cerca un altro immobile)
    campo('riacquisto_tipologia', 'Riacquisto — tipologia cercata', 'text'),
    campo('riacquisto_budget_max', 'Riacquisto — budget massimo', 'currency'),
    campo('riacquisto_zona', 'Riacquisto — zona/città', 'text'),
    campo('riacquisto_caratteristiche', 'Riacquisto — caratteristiche richieste', 'textarea'),
  ];

  const nuovoSchema = { version: 3, steps: [...schema.steps, ...nuoviStep] };

  const { callAs } = require('./lib/internal-api');
  const admin = db.prepare("SELECT * FROM users WHERE role = 'admin' LIMIT 1").get();
  if (!admin) return false;
  const draft = await callAs(admin, 'PUT', '/builder/immobili/draft', { schema: nuovoSchema });
  if (!draft.ok) { console.error('[one-off-scheda-immobile] draft immobili fallito:', JSON.stringify(draft.data)); return false; }
  const pub = await callAs(admin, 'POST', '/builder/immobili/publish', {});
  if (!pub.ok) { console.error('[one-off-scheda-immobile] publish immobili fallito:', JSON.stringify(pub.data)); return false; }
  return true;
}

async function run() {
  try {
    const fatto = await estendiImmobili();
    if (fatto) console.log('[one-off-scheda-immobile] Immobili esteso con la scheda completa (' + 58 + ' nuovi campi circa)');
  } catch (e) { console.error('[one-off-scheda-immobile] estensione Immobili fallita:', e.message); }
}

module.exports = { run };
