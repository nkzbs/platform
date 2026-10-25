'use strict';
// Gli strumenti MCP: CRUD generico sui moduli (stesse rotte reali dell'app, mai un
// bypass) più qualche lettura ad alto valore che non è semplice CRUD (chiedere ai
// dati, il report busta paga, il debito casa — già costruiti per il bot/l'app,
// qui solo un'altra presentazione). Niente "elimina" e niente azioni fuzzy tipo
// "segna pagata una bolletta che assomiglia a...": chi chiama un tool MCP può
// leggere l'elenco vero e scegliere l'id giusto da sé, non serve indovinare come
// deve fare un bot con solo una frase in mano.
const api = require('./client');

function list(obj) {
  return { content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] };
}

const tools = [
  {
    name: 'elenco_moduli',
    title: 'Elenco moduli',
    description: 'I moduli installati che l\'utente del token può vedere (slug, nome, icona) — primo passo per sapere cosa c\'è prima di leggere o scrivere.',
    inputSchema: {},
    handler: async () => list(await api.get('/modules/installed')),
  },
  {
    name: 'schema_modulo',
    title: 'Schema di un modulo',
    description: 'I campi dichiarati di un modulo (nome, tipo, opzioni se è una scelta) — serve a sapere cosa scrivere prima di crea_record/modifica_record.',
    inputSchema: { modulo: { type: 'string', description: 'Lo slug del modulo (da elenco_moduli)' } },
    handler: async ({ modulo }) => {
      const m = await api.get('/modules/' + encodeURIComponent(modulo));
      let schema = {};
      try { schema = JSON.parse(m.schema_json || '{}'); } catch (e) { /* vuoto */ }
      const steps = Array.isArray(schema.steps) ? schema.steps : [];
      const campi = steps.filter((s) => s.block_type === 'field').map((f) => ({ key: f.key, label: f.label, type: f.type, options: f.options }));
      return list({ slug: m.slug, name: m.name, campi });
    },
  },
  {
    name: 'lista_record',
    title: 'Lista record',
    description: 'Le righe di un modulo che l\'utente del token può vedere (rispetta "solo propri" se il suo ruolo ce l\'ha). Tagliata ai primi `limite` risultati (default 50) per non sommergere la conversazione.',
    inputSchema: {
      modulo: { type: 'string', description: 'Lo slug del modulo' },
      limite: { type: 'number', description: 'Quante righe al massimo (default 50)' },
    },
    handler: async ({ modulo, limite }) => {
      const righe = await api.get('/records/' + encodeURIComponent(modulo));
      const n = Number.isFinite(limite) && limite > 0 ? Math.min(limite, 500) : 50;
      const tagliate = Array.isArray(righe) ? righe.slice(0, n) : righe;
      return list({ totale: Array.isArray(righe) ? righe.length : null, mostrate: Array.isArray(tagliate) ? tagliate.length : null, righe: tagliate });
    },
  },
  {
    name: 'leggi_record',
    title: 'Leggi un record',
    description: 'Un record preciso di un modulo, con tutti i suoi campi.',
    inputSchema: {
      modulo: { type: 'string', description: 'Lo slug del modulo' },
      id: { type: 'number', description: 'L\'id del record (da lista_record)' },
    },
    handler: async ({ modulo, id }) => list(await api.get('/records/' + encodeURIComponent(modulo) + '/' + id)),
  },
  {
    name: 'crea_record',
    title: 'Crea un record',
    description: 'Crea una riga nuova in un modulo — scrittura vera, con gli stessi permessi/validazioni/automazioni dell\'app. Controlla prima schema_modulo per sapere quali campi scrivere.',
    inputSchema: {
      modulo: { type: 'string', description: 'Lo slug del modulo' },
      dati: { type: 'object', description: 'I campi da scrivere, chiave=key del campo (da schema_modulo)' },
    },
    handler: async ({ modulo, dati }) => list(await api.post('/records/' + encodeURIComponent(modulo), dati || {})),
  },
  {
    name: 'modifica_record',
    title: 'Modifica un record',
    description: 'Sovrascrive i campi di un record esistente — scrittura vera, stessi permessi/validazioni dell\'app. Manda SEMPRE l\'oggetto dati completo (leggi_record prima, poi cambia solo quello che serve): i campi omessi diventano vuoti.',
    inputSchema: {
      modulo: { type: 'string', description: 'Lo slug del modulo' },
      id: { type: 'number', description: 'L\'id del record da modificare' },
      dati: { type: 'object', description: 'I campi completi del record (non solo quelli cambiati)' },
    },
    handler: async ({ modulo, id, dati }) => list(await api.put('/records/' + encodeURIComponent(modulo) + '/' + id, dati || {})),
  },
  {
    name: 'chiedi_ai_dati',
    title: 'Chiedi ai dati',
    description: 'Una domanda in linguaggio naturale sui dati dell\'utente (es. "quanto ho speso di benzina a settembre?") — stessa funzione "Chiedi ai dati" dell\'app e del bot.',
    inputSchema: { domanda: { type: 'string', description: 'La domanda, in italiano' } },
    handler: async ({ domanda }) => list(await api.post('/ai/ask', { domanda })),
  },
  {
    name: 'report_busta_paga',
    title: 'Report busta paga',
    description: 'Ore pagate vs timbrate mese per mese, e i saldi di ferie/permessi/ROL residui — stessa cosa che il bot risponde a "le ore tornano con le timbrature?" e "quanti giorni di ferie ho?".',
    inputSchema: {},
    handler: async () => {
      const [ore, saldi] = await Promise.all([api.get('/busta-paga-report/ore'), api.get('/busta-paga-report/saldi')]);
      return list({ ore, saldi });
    },
  },
  {
    name: 'debito_casa',
    title: 'Debito casa',
    description: 'Chi deve soldi a chi sui contributi condivisi della casa — stessa cosa che il bot risponde a "quanto devo a [nome]?".',
    inputSchema: {},
    handler: async () => list(await api.get('/debito-casa')),
  },
];

module.exports = { tools };
