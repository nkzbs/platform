// Prova di compatibilità: lo schema che esce dal generatore (dopo la pulizia) si installa nel core e supera controllo e collaudo.
process.env.DB_PATH = '/tmp/e2e-sa-' + Date.now() + '.db'; process.env.JWT_SECRET = 'x'.repeat(20); process.env.ENCRYPTION_KEY = 'e2e_gen_encryption_key_00000000'; process.env.INTERNAL_API_SECRET = 'y'.repeat(20);
const gen = require('../../../super-admin/backend/src/lib/generatore-moduli.js');
const clienti = gen.sanitizzaSchema({ steps: [
  { block_type: 'field', key: 'nome', label: 'Nome', type: 'text', required: true, dato_chiave: true, sezione: 'Anagrafica' },
  { block_type: 'field', key: 'email', label: 'Email', type: 'email', sezione: 'Contatti' },
  { block_type: 'field', key: 'codice_fiscale', label: 'Codice fiscale', type: 'text', validazione: 'codice_fiscale_it' } ] }, 'clienti');
const ordini = gen.sanitizzaSchema({ steps: [
  { block_type: 'field', key: 'titolo', label: 'Titolo', type: 'text', required: true },
  { block_type: 'field', key: 'importo', label: 'Importo', type: 'currency' },
  { block_type: 'field', key: 'tipo', label: 'Tipo', type: 'select', options: ['Standard', 'Urgente'] },
  { block_type: 'field', key: 'consegna', label: 'Consegna', type: 'date' },
  { block_type: 'relation', key: 'cliente', label: 'Cliente', type: 'many_to_one', target_module: 'clienti', display_field: 'nome' },
  { block_type: 'allegati', label: 'Allegati', types: ['Contratto'] },
  { block_type: 'workflow_state', key: 'nuovo', label: 'Nuovo', initial: true }, { block_type: 'workflow_state', key: 'confermato', label: 'Confermato' }, { block_type: 'workflow_state', key: 'consegnato', label: 'Consegnato' },
  { block_type: 'workflow_transition', from: 'nuovo', to: 'confermato' }, { block_type: 'workflow_transition', from: 'confermato', to: 'consegnato' },
  { block_type: 'state_requirements', stato: 'confermato', bloccante: true, requisiti: [{ label: 'Importo', tipo: 'campo', campo: 'importo' }, { label: 'Contratto', tipo: 'allegato', valore: 'Contratto' }] },
  { block_type: 'automation', label: 'Avviso alla conferma', trigger: { evento: 'cambio_stato', stato: 'confermato' }, azioni: [{ target: '__interno__', azione: 'notifica_interna', config: { message: 'Ordine confermato' } }, { target: '__interno__', azione: 'crea_record', config: { modulo: 'consegne', dati: { descrizione: 'campo:titolo', ordine: '__origine_id__', _stato: 'da_consegnare' } } }] },
  { block_type: 'document_action', key: 'conferma', label: 'Conferma ordine', subject: 'Ordine {{titolo}}', body: 'Gentile {{cliente.nome}}, confermiamo l\'ordine {{titolo}} da {{importo}}.', recipient: 'cliente.email' },
  { block_type: 'calendar_view', key: 'cal', label: 'Consegne', date_field: 'consegna', title_field: 'titolo' } ] }, 'ordini');
const consegne = gen.sanitizzaSchema({ steps: [{ block_type: 'field', key: 'descrizione', label: 'Descrizione', type: 'text' }, { block_type: 'relation', key: 'ordine', label: 'Ordine', type: 'many_to_one', target_module: 'ordini', display_field: 'titolo' }, { block_type: 'workflow_state', key: 'da_consegnare', label: 'Da consegnare', initial: true }, { block_type: 'workflow_state', key: 'consegnata', label: 'Consegnata' }, { block_type: 'workflow_transition', from: 'da_consegnare', to: 'consegnata' }] }, 'consegne');
require('fs').writeFileSync('/tmp/moduli-generati.json', JSON.stringify([['clienti','Clienti',clienti],['ordini','Ordini',ordini],['consegne','Consegne',consegne]])); process.exit(0)
