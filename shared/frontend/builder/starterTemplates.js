// Template di partenza curati (2026-09-07) — richiesto dall'utente: "semplificare e
// migliorare la creazione di moduli". L'unica base di partenza non vuota, prima di
// questo file, era "Parti da un modulo esistente" (clona uno che hai già) — nessun
// preset pronto per un caso comune quando NON hai ancora nessun modulo simile nel
// tenant (es. il primissimo modulo di un tenant appena creato). Volutamente
// autonomi (nessuna `relation` verso un target_module che potrebbe non esistere
// ancora in questo tenant) — una relazione la si aggiunge dopo, dal pannello a
// destra del Builder, esattamente come già oggi per un modulo nato vuoto.
// Stessa forma esatta dei block_type (field/workflow_state/workflow_transition)
// generati dal Super Builder AI (vedi super-admin/backend/src/routes/super-builder.js,
// SCHEMA_SPEC) — nessuna sintassi nuova da mantenere allineata.
export const STARTER_TEMPLATES = [
  {
    slug: 'anagrafica-clienti',
    name: 'Anagrafica Clienti',
    icon: 'users',
    color: '#2563EB',
    description: 'Ragione sociale, contatti, stato del rapporto (Prospect → Attivo → Ex cliente).',
    schema: {
      version: 3,
      steps: [
        { id: 'fld_ragione_sociale', block_type: 'field', key: 'ragione_sociale', label: 'Ragione sociale', type: 'text', required: true },
        { id: 'fld_referente', block_type: 'field', key: 'referente', label: 'Referente', type: 'text' },
        { id: 'fld_email', block_type: 'field', key: 'email', label: 'Email', type: 'email' },
        { id: 'fld_telefono', block_type: 'field', key: 'telefono', label: 'Telefono', type: 'phone' },
        { id: 'fld_indirizzo', block_type: 'field', key: 'indirizzo', label: 'Indirizzo', type: 'textarea' },
        { id: 'wst_prospect', block_type: 'workflow_state', key: 'prospect', label: 'Prospect', color: '#F59E0B', initial: true },
        { id: 'wst_attivo', block_type: 'workflow_state', key: 'attivo', label: 'Attivo', color: '#10B981' },
        { id: 'wst_ex_cliente', block_type: 'workflow_state', key: 'ex_cliente', label: 'Ex cliente', color: '#6B7280' },
        { id: 'wtr_diventa_cliente', block_type: 'workflow_transition', from: 'prospect', to: 'attivo', label: 'Diventa cliente' },
        { id: 'wtr_segna_ex', block_type: 'workflow_transition', from: 'attivo', to: 'ex_cliente', label: 'Segna ex cliente' },
      ],
    },
  },
  {
    slug: 'prodotti-magazzino',
    name: 'Prodotti / Magazzino',
    icon: 'box',
    color: '#7C3AED',
    description: 'Anagrafica prodotto con prezzo, quantità disponibile e unità di misura.',
    schema: {
      version: 3,
      steps: [
        { id: 'fld_nome', block_type: 'field', key: 'nome', label: 'Nome prodotto', type: 'text', required: true },
        { id: 'fld_codice', block_type: 'field', key: 'codice', label: 'Codice / SKU', type: 'text' },
        { id: 'fld_categoria', block_type: 'field', key: 'categoria', label: 'Categoria', type: 'select', options: ['Materia prima', 'Semilavorato', 'Finito'] },
        { id: 'fld_prezzo', block_type: 'field', key: 'prezzo_vendita', label: 'Prezzo di vendita', type: 'currency' },
        { id: 'fld_quantita', block_type: 'field', key: 'quantita_disponibile', label: 'Quantità disponibile', type: 'number' },
        { id: 'fld_unita', block_type: 'field', key: 'unita_misura', label: 'Unità di misura', type: 'select', options: ['pz', 'kg', 'lt', 'mt'] },
        { id: 'fld_attivo', block_type: 'field', key: 'attivo', label: 'Attivo', type: 'checkbox' },
      ],
    },
  },
  {
    slug: 'ordini-semplice',
    name: 'Ordini (semplice)',
    icon: 'file',
    color: '#DC2626',
    description: 'Numero, data, totale e ciclo di stato Bozza → Confermato → Evaso.',
    schema: {
      version: 3,
      steps: [
        { id: 'fld_numero', block_type: 'field', key: 'numero', label: 'Numero ordine', type: 'text' },
        { id: 'fld_data', block_type: 'field', key: 'data', label: 'Data', type: 'date', required: true },
        { id: 'fld_descrizione', block_type: 'field', key: 'descrizione', label: 'Descrizione', type: 'textarea' },
        { id: 'fld_totale', block_type: 'field', key: 'totale', label: 'Totale ordine (€)', type: 'currency' },
        { id: 'wst_bozza', block_type: 'workflow_state', key: 'bozza', label: 'Bozza', color: '#F59E0B', initial: true },
        { id: 'wst_confermato', block_type: 'workflow_state', key: 'confermato', label: 'Confermato', color: '#3B82F6' },
        { id: 'wst_evaso', block_type: 'workflow_state', key: 'evaso', label: 'Evaso', color: '#10B981' },
        { id: 'wtr_conferma', block_type: 'workflow_transition', from: 'bozza', to: 'confermato', label: 'Conferma' },
        { id: 'wtr_evadi', block_type: 'workflow_transition', from: 'confermato', to: 'evaso', label: 'Segna evaso' },
      ],
    },
  },
  {
    slug: 'ticket-assistenza',
    name: 'Ticket / Assistenza',
    icon: 'life-buoy',
    color: '#0891B2',
    description: 'Oggetto, priorità e ciclo di stato Aperto → In lavorazione → Chiuso.',
    schema: {
      version: 3,
      steps: [
        { id: 'fld_oggetto', block_type: 'field', key: 'oggetto', label: 'Oggetto', type: 'text', required: true },
        { id: 'fld_descrizione', block_type: 'field', key: 'descrizione', label: 'Descrizione', type: 'textarea' },
        { id: 'fld_priorita', block_type: 'field', key: 'priorita', label: 'Priorità', type: 'select', options: ['Bassa', 'Media', 'Alta', 'Urgente'] },
        { id: 'fld_richiedente', block_type: 'field', key: 'richiedente', label: 'Richiedente', type: 'text' },
        { id: 'wst_aperto', block_type: 'workflow_state', key: 'aperto', label: 'Aperto', color: '#DC2626', initial: true },
        { id: 'wst_in_lavorazione', block_type: 'workflow_state', key: 'in_lavorazione', label: 'In lavorazione', color: '#F59E0B' },
        { id: 'wst_chiuso', block_type: 'workflow_state', key: 'chiuso', label: 'Chiuso', color: '#10B981' },
        { id: 'wtr_prendi_in_carico', block_type: 'workflow_transition', from: 'aperto', to: 'in_lavorazione', label: 'Prendi in carico' },
        { id: 'wtr_chiudi', block_type: 'workflow_transition', from: 'in_lavorazione', to: 'chiuso', label: 'Chiudi' },
      ],
    },
  },
]
