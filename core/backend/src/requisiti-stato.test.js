'use strict';
// I requisiti per stato (shared/requisiti-stato.js, blocco `state_requirements`): il calcolo puro e il blocco del passaggio sul server.
// Server vero, DB temporaneo. Eseguire con: node src/requisiti-stato.test.js (porta 34865 libera).
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const TEST_PORT = 34865, BASE = 'http://localhost:' + TEST_PORT;
process.env.DB_PATH = path.join(os.tmpdir(), 'req-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.PORT = String(TEST_PORT);
process.env.JWT_SECRET = 'rq_secret_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'rq_internal_' + crypto.randomBytes(8).toString('hex');
process.env.INITIAL_ADMIN_PASSWORD = 'rq_admin_pw';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rq-uploads-'));

let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); console.log('  ✓ ' + name); passed++; } catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); failed++; } }
const eq = (a, e, m) => { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${m || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m || 'atteso true'); };

async function main() {
  const R = require('./requisiti-stato');
  const BLOCCO = { block_type: 'state_requirements', stato: 'pronto', bloccante: true, requisiti: [
    { label: 'Prezzo', tipo: 'campo', campo: 'prezzo' }, { label: 'Un recapito', tipo: 'uno_di', campi: ['email', 'telefono'] }, { label: 'Scheda firmata', tipo: 'allegato', valore: 'firmata' }, { label: 'Strano', tipo: 'sconosciuto' }] };

  await test('ogni tipo di requisito: campo pieno, uno tra più campi, allegato del tipo giusto; un tipo ignoto non si dà per soddisfatto', () => {
    const v = (dati, all) => R.valutaRequisiti(BLOCCO, dati, all).map((x) => x.ok);
    eq(v({}, []), [false, false, false, false]);
    eq(v({ prezzo: 0, telefono: '333' }, [{ tipo: 'altro' }]), [true, true, false, false], 'lo zero è un valore; il tipo di allegato deve coincidere');
    eq(v({ prezzo: '', email: [] }, [{ tipo: 'firmata' }]), [false, false, true, false], 'vuoto e lista vuota non contano');
  });
  await test('requisitiDallo: solo i passaggi possibili dallo stato attuale che hanno requisiti, con «pronto» e il nome dello stato', () => {
    const wf = { states: [{ key: 'bozza', label: 'Bozza' }, { key: 'pronto', label: 'Pronto' }, { key: 'chiuso', label: 'Chiuso' }], transitions: [{ from: 'bozza', to: 'pronto' }, { from: 'bozza', to: 'chiuso' }, { from: 'pronto', to: 'chiuso' }] };
    const r = R.requisitiDallo('bozza', wf, [BLOCCO], { prezzo: 5 }, []);
    eq(r.length, 1); eq([r[0].stato, r[0].label, r[0].bloccante, r[0].pronto, r[0].voci.length], ['pronto', 'Pronto', true, false, 4]);
    eq(R.requisitiDallo('pronto', wf, [BLOCCO], {}, []), [], 'dallo stato pronto non c\'è un passaggio con requisiti');
    eq(R.bloccoPerStato([{ stato: 'x', requisiti: [] }], 'x'), null, 'un blocco senza requisiti non conta');
  });

  require('./index.js');
  for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch (e) { await new Promise((r) => setTimeout(r, 100)); } }
  const db = require('./db');
  const F = (key, type = 'text') => ({ id: 'f_' + key, block_type: 'field', key, label: key, type });
  const steps = (bloccante) => [F('prezzo', 'number'), { id: 'ws1', block_type: 'workflow_state', key: 'bozza', label: 'Bozza', initial: true }, { id: 'ws2', block_type: 'workflow_state', key: 'pronto', label: 'Pronto' },
    { id: 'wt1', block_type: 'workflow_transition', from: 'bozza', to: 'pronto', label: 'Pronto' }, { ...BLOCCO, id: 'sr1', bloccante, requisiti: BLOCCO.requisiti.slice(0, 3) }];
  db.prepare("INSERT INTO modules (name, slug, icon, color, installed, active, sort_order, schema_json) VALUES ('Pratiche', 'pratiche', 'box', '#000', 1, 1, 70, ?)").run(JSON.stringify({ version: 3, steps: steps(true) }));
  const rec = (d) => db.prepare("INSERT INTO records (module_slug, data) VALUES ('pratiche', ?)").run(JSON.stringify({ _stato: 'bozza', ...d })).lastInsertRowid;
  const login = await (await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: process.env.INITIAL_ADMIN_PASSWORD }) })).json();
  const H = { Authorization: 'Bearer ' + login.token, 'Content-Type': 'application/json' };
  const vai = (id) => fetch(BASE + '/api/records/pratiche/' + id + '/transition', { method: 'POST', headers: H, body: JSON.stringify({ to: 'pronto' }) });
  const stato = (id) => JSON.parse(db.prepare('SELECT data FROM records WHERE id = ?').get(id).data)._stato;

  await test('requisiti bloccanti: il passaggio non avviene e dice cosa manca; con tutto a posto avviene', async () => {
    const id = rec({ prezzo: 100 });
    const r = await vai(id); eq(r.status, 400); const j = await r.json();
    eq(j.mancano, ['Un recapito', 'Scheda firmata']); ok(/Per passare a «Pronto» manca: Un recapito, Scheda firmata\./.test(j.error), j.error); eq(stato(id), 'bozza');
    db.prepare("UPDATE records SET data = ? WHERE id = ?").run(JSON.stringify({ _stato: 'bozza', prezzo: 100, email: 'a@b.it' }), id);
    eq((await vai(id)).status, 400, 'manca ancora l\'allegato');
    const up = db.prepare("INSERT INTO uploads (original_name, stored_name, mime_type, size) VALUES ('f.pdf', 'f.pdf', 'application/pdf', 1)").run().lastInsertRowid;
    db.prepare("INSERT INTO record_attachments (module_slug, record_id, upload_id, tipo) VALUES ('pratiche', ?, ?, 'firmata')").run(id, up);
    eq((await vai(id)).status, 200); eq(stato(id), 'pronto');
  });
  await test('requisiti non bloccanti: sono solo un promemoria, il passaggio avviene lo stesso', async () => {
    db.prepare("UPDATE modules SET schema_json = ? WHERE slug = 'pratiche'").run(JSON.stringify({ version: 3, steps: steps(false) }));
    const id = rec({}); eq((await vai(id)).status, 200); eq(stato(id), 'pronto');
  });

  await test('il blocco del pacchetto di Mediazione immobiliare: stati e tipi validi, campi citati tra quelli richiesti, solo promemoria', () => {
    const e = require('./pacchetti/mediazione-immobiliare/estensioni.json').immobili.find((x) => x.key === 'requisiti_stato');
    const dichiarati = new Set(e.richiede.immobili); const nascosti = new Set(['report_valutazione']); // l'esito della valutazione sta sul record, non è un campo dichiarato
    eq(e.aggiungi.map((b) => b.stato), ['in_mandato', 'in_vendita']);
    for (const b of e.aggiungi) {
      eq(b.bloccante, false, 'promemoria, non blocco');
      for (const r of b.requisiti) {
        ok(['campo', 'uno_di', 'allegato'].includes(r.tipo), 'tipo ' + r.tipo);
        for (const k of (r.tipo === 'campo' ? [r.campo] : r.tipo === 'uno_di' ? r.campi : [])) ok(dichiarati.has(k) || nascosti.has(k), 'il campo «' + k + '» non è tra i richiesti');
      }
    }
  });

  console.log(`\n${passed} passati, ${failed} falliti`);
  try { fs.unlinkSync(process.env.DB_PATH); } catch (e) {}
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
