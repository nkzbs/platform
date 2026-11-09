'use strict';
// Generatore di moduli: pulizia di ciò che arriva dal modello, ciclo di correzione (la prima bozza ha difetti, la seconda no), piano senza duplicati, gruppo coerente.
// Il modello è finto: nessuna chiamata di rete. Eseguire con: node src/generatore-moduli.test.js
const path = require('path'); const os = require('os'); const crypto = require('crypto');
process.env.DB_PATH = path.join(os.tmpdir(), 'gen-moduli-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.JWT_SECRET = 'jwt_' + crypto.randomBytes(8).toString('hex');
process.env.ENCRYPTION_KEY = 'gen_moduli_test_encryption_key_00';
process.env.INTERNAL_API_SECRET = 'int_' + crypto.randomBytes(8).toString('hex');
let passati = 0, falliti = 0;
async function test(nome, fn) { try { await fn(); console.log('  ✓ ' + nome); passati++; } catch (e) { console.error('  ✗ ' + nome + '\n    ' + e.message); falliti++; } }
const ok = (c, m) => { if (!c) throw new Error(m || 'atteso true'); };
const gen = require('./lib/generatore-moduli');

const buono = (target) => ({ nome: 'Ordini', icona: 'box', steps: [
  { block_type: 'field', key: 'titolo', label: 'Titolo', type: 'text', required: true, sezione: 'Dati' },
  { block_type: 'field', key: 'importo', label: 'Importo', type: 'currency', sezione: 'Dati' },
  { block_type: 'relation', key: 'cliente', label: 'Cliente', type: 'many_to_one', target_module: target, display_field: 'nome' },
  { block_type: 'allegati', label: 'Allegati', types: ['Contratto'] },
  { block_type: 'workflow_state', key: 'aperto', label: 'Aperto', initial: true }, { block_type: 'workflow_state', key: 'chiuso', label: 'Chiuso' },
  { block_type: 'workflow_transition', from: 'aperto', to: 'chiuso', label: 'Chiudi' },
  { block_type: 'state_requirements', stato: 'chiuso', bloccante: true, requisiti: [{ label: 'Importo', tipo: 'campo', campo: 'importo' }, { label: 'Contratto', tipo: 'allegato', valore: 'Contratto' }] },
] });
const rotto = { nome: 'Ordini', steps: [
  { block_type: 'field', key: 'titolo', label: 'Titolo', type: 'text' },
  { block_type: 'relation', key: 'cliente', label: 'Cliente', type: 'many_to_one', target_module: 'modulo_inventato', display_field: 'nome' },
  { block_type: 'workflow_state', key: 'aperto', label: 'Aperto', initial: true }, { block_type: 'workflow_state', key: 'chiuso', label: 'Chiuso' },
  { block_type: 'workflow_transition', from: 'aperto', to: 'chiuso', label: 'Chiudi' },
  { block_type: 'state_requirements', stato: 'chiuso', bloccante: true, requisiti: [{ label: 'Campo che non c\'è', tipo: 'campo', campo: 'assente' }, { label: 'Contratto', tipo: 'allegato', valore: 'Mai previsto' }] },
] };
const clienti = [{ slug: 'clienti', nome: 'Clienti', steps: [{ block_type: 'field', key: 'nome', label: 'Nome', type: 'text' }] }];
const risposte = (lista) => { const chiamate = []; gen.deps.isConfigured = () => true; gen.deps.callAI = async (prov, args) => { chiamate.push(args); const r = lista[Math.min(chiamate.length - 1, lista.length - 1)]; return JSON.stringify(typeof r === 'function' ? r(args) : r); }; return chiamate; };

(async () => {
  await test('la pulizia scarta blocchi e proprietà ignoti, sistema chiavi e stati', () => {
    const s = gen.sanitizzaSchema({ steps: [
      { block_type: 'field', key: 'Data Nascita!', label: 'Data', type: 'tipo_inventato', evil: 'x' }, { block_type: 'field', key: 'data_nascita', label: 'doppione' },
      { block_type: 'script', code: 'rm -rf' }, { block_type: 'field', key: 'sceglie', label: 'S', type: 'select', options: [] },
      { block_type: 'workflow_state', key: 'a', label: 'A', initial: true }, { block_type: 'workflow_state', key: 'b', label: 'B', initial: true },
      { block_type: 'workflow_transition', from: 'a', to: 'b' }, { block_type: 'workflow_transition', from: 'a', to: 'fantasma' },
      { block_type: 'automation', label: 'x', trigger: { evento: 'cambio_stato', stato: 'b' }, azioni: [{ azione: 'esegui_comando', config: {} }, { azione: 'notifica_interna', config: { message: 'ok' } }] },
    ] }, 'm');
    const tipi = s.steps.map((b) => b.block_type);
    ok(!tipi.includes('script'), 'blocco ignoto'); ok(s.steps.filter((b) => b.block_type === 'field').length === 2, 'campi: ' + JSON.stringify(s.steps.filter((b) => b.block_type === 'field')));
    ok(s.steps[0].key === 'data_nascita' && s.steps[0].type === 'text' && s.steps[0].evil === undefined, JSON.stringify(s.steps[0]));
    ok(s.steps.filter((b) => b.block_type === 'workflow_state' && b.initial).length === 1, 'un solo iniziale');
    ok(s.steps.filter((b) => b.block_type === 'workflow_transition').length === 1, 'passaggi');
    ok(s.steps.find((b) => b.block_type === 'automation').azioni.length === 1, 'azioni ammesse');
    ok(s.steps.every((b) => /^blk_/.test(b.id)), 'id');
  });
  await test('una bozza buona passa al primo tentativo', async () => {
    const c = risposte([buono('clienti')]);
    const m = await gen.generaModulo({ voce: { slug: 'ordini', nome: 'Ordini', scopo: 'ordini', collegato_a: ['clienti'], processi: [] }, nomeAttivita: 'Bottega', processi: [], altri: clienti });
    ok(m.problemi.length === 0 && m.tentativi === 1 && c.length === 1, JSON.stringify(m.problemi) + ' tentativi ' + m.tentativi);
    ok(m.schema.steps.some((b) => b.block_type === 'workflow_transition') && m.name === 'Ordini' && /^#/.test(m.color), 'schema');
  });
  await test('una bozza con difetti viene rimandata al modello con l\'elenco, e la seconda passa', async () => {
    const c = risposte([rotto, buono('clienti')]);
    const m = await gen.generaModulo({ voce: { slug: 'ordini', nome: 'Ordini', scopo: 'ordini', collegato_a: [], processi: [] }, nomeAttivita: 'Bottega', processi: [], altri: clienti });
    ok(c.length === 2 && m.tentativi === 2 && m.problemi.length === 0, 'tentativi ' + m.tentativi + ' problemi ' + JSON.stringify(m.problemi));
    ok(/modulo_inventato/.test(c[1].user) && /assente/.test(c[1].user) && /Mai previsto/.test(c[1].user), 'la seconda richiesta deve elencare i problemi: ' + c[1].user.slice(-900));
  });
  await test('se il modello non corregge, si ferma a 3 tentativi e restituisce i problemi rimasti', async () => {
    const c = risposte([rotto]);
    const m = await gen.generaModulo({ voce: { slug: 'ordini', nome: 'Ordini', scopo: 'o', collegato_a: [], processi: [] }, nomeAttivita: 'B', processi: [], altri: clienti });
    ok(c.length === 3 && m.tentativi === 3 && m.problemi.length > 0, 'chiamate ' + c.length);
  });
  await test('il piano non propone doppioni né moduli già disponibili, e pulisce gli slug', async () => {
    risposte([{ moduli: [{ slug: 'Ordini Cliente', nome: 'Ordini', scopo: 's', collegato_a: ['clienti', 'ordini cliente'], processi: [1, 'x'] }, { slug: 'clienti', nome: 'Clienti' }, { slug: 'ordini_cliente', nome: 'Doppione' }, { slug: '', nome: '' }] }]);
    const p = await gen.pianifica({ nomeAttivita: 'B', processi: [{ nome: 'Vendita' }], disponibili: [{ slug: 'clienti', nome: 'Clienti' }] });
    ok(p.length === 1 && p[0].slug === 'ordini_cliente' && p[0].collegato_a.join() === 'clienti' && p[0].processi.join() === '1', JSON.stringify(p));
  });
  await test('senza chiave AI si ferma con un messaggio chiaro', async () => {
    gen.deps.isConfigured = () => false; let e = null; try { await gen.pianifica({ processi: [], disponibili: [] }); } catch (x) { e = x; }
    ok(e && e.status === 503 && /chiave AI/.test(e.message), e && e.message);
  });
  await test('costruisci: piano, bozze in ordine di dipendenza e gruppo finale coerente', async () => {
    gen.deps.isConfigured = () => true; const viste = [];
    gen.deps.callAI = async (prov, { user }) => {
      viste.push(user);
      if (/Indica quali MODULI NUOVI|MODULI NUOVI/.test(user) || viste.length === 1) return JSON.stringify({ moduli: [{ slug: 'ordini', nome: 'Ordini', scopo: 'o', collegato_a: ['clienti'] }, { slug: 'righe', nome: 'Righe', scopo: 'r', collegato_a: ['ordini'] }] });
      return JSON.stringify(/slug «righe»/.test(user) ? { nome: 'Righe', steps: [{ block_type: 'field', key: 'titolo', label: 'T', type: 'text' }, { block_type: 'relation', key: 'ordine', label: 'Ordine', type: 'many_to_one', target_module: 'ordini', display_field: 'titolo' }] } : buono('clienti'));
    };
    const r = await gen.costruisci({ nomeAttivita: 'Bottega', processi: [{ nome: 'Vendita' }], disponibili: [{ slug: 'clienti', nome: 'Clienti' }], esistenti: clienti });
    ok(r.moduli.length === 2 && r.moduli[0].slug === 'ordini' && r.moduli[1].slug === 'righe', r.moduli.map((m) => m.slug).join());
    ok(r.moduli.every((m) => m.problemi.length === 0), JSON.stringify(r.moduli.map((m) => m.problemi)));
  });
  await test('permessi per ruolo: solo ruoli dell\'analisi, i non citati restano in sola lettura, owner_field solo se la relazione esiste', () => {
    const base = [{ block_type: 'field', key: 'titolo', label: 'T', type: 'text' }, { block_type: 'relation', key: 'agente', label: 'Agente', type: 'many_to_one', target_module: 'clienti', display_field: 'nome' }];
    const s = gen.sanitizzaSchema({ steps: [...base, { block_type: 'permissions', rules: [
      { role: 'agente_vendite', view: true, view_own_only: true, owner_field: 'agente', create: true, edit: true, delete: true },
      { role: 'ruolo_inventato', view: true, create: true },
      { role: 'contabile', view: true, owner_field: 'relazione_che_non_c_e', create: true, edit: false },
    ] }] }, 'm', { ruoli: ['agente_vendite', 'contabile', 'magazziniere'] });
    const p = s.steps.find((b) => b.block_type === 'permissions'); ok(p, 'blocco permessi');
    const per = Object.fromEntries(p.rules.map((r) => [r.role, r]));
    ok(!per.ruolo_inventato, 'ruolo non dell\'analisi');
    ok(per.agente_vendite.owner_field === 'agente' && per.agente_vendite.view_own_only === true && per.agente_vendite.delete === true, JSON.stringify(per.agente_vendite));
    ok(per.contabile.owner_field === undefined && per.contabile.create === true, JSON.stringify(per.contabile));
    ok(per.magazziniere && per.magazziniere.view === true && per.magazziniere.create === false && per.magazziniere.edit === false, 'ruolo non citato: sola lettura ' + JSON.stringify(per.magazziniere));
    ok(per.user && per.user.view === true && per.user.create === false, 'anche «user» ha una riga, altrimenti resta chiuso fuori');
    ok(!gen.sanitizzaSchema({ steps: [...base, { block_type: 'permissions', rules: [{ role: 'contabile', view: true }] }] }, 'm').steps.some((b) => b.block_type === 'permissions'), 'senza ruoli noti nessun blocco permessi');
    ok(gen.controllaBozza('m', 'M', s, clienti, ['agente_vendite', 'contabile', 'magazziniere']).filter((x) => /permess|ruolo/i.test(x)).length === 0, 'il controllo accetta i ruoli dell\'analisi');
  });
  await test('aggiorna_record con operazione: increment e decrement vogliono un numero', () => {
    const az = (c) => gen.sanitizzaSchema({ steps: [{ block_type: 'field', key: 'a', label: 'A', type: 'text' }, { block_type: 'workflow_state', key: 'x', label: 'X', initial: true }, { block_type: 'automation', label: 'u', trigger: { evento: 'cambio_stato', stato: 'x' }, azioni: [{ azione: 'aggiorna_record', config: c }] }] }, 'm').steps.find((b) => b.block_type === 'automation');
    ok(az({ modulo: 'magazzino', campo: 'giacenza', operazione: 'decrement', valore: '2' }).azioni[0].config.operazione === 'decrement', 'decrement');
    ok(az({ modulo: 'magazzino', campo: 'giacenza', operazione: 'increment', valore: 'tanto' }) === undefined, 'incremento non numerico scartato');
    ok(az({ modulo: 'magazzino', campo: 'stato_x', valore: 'ok' }).azioni[0].config.operazione === undefined, 'set predefinito');
  });
  await test('la richiesta al modello elenca i ruoli e accetta il blocco permessi', async () => {
    const c = risposte([buono('clienti')]);
    await gen.generaModulo({ voce: { slug: 'ordini', nome: 'Ordini', scopo: 'o', collegato_a: [], processi: [] }, nomeAttivita: 'B', processi: [], altri: clienti, ruoli: ['agente_vendite'] });
    ok(/Ruoli \(usa solo questi in permissions\): agente_vendite/.test(c[0].user), c[0].user.slice(-200));
  });
  console.log(`\n${passati} passati, ${falliti} falliti`); process.exit(falliti ? 1 : 0);
})();
