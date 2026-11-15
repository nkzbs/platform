'use strict';
// «Importa da modulo PDF»: il modulo originale compilato dal sistema, riletto, restituisce gli stessi dati (andata e ritorno), con le date all'italiana
// riportate nel formato del sistema; un PDF che non è un modulo dell'agenzia è rifiutato; i valori che non stanno nelle scelte del campo non si scrivono.
// Eseguire con: node src/importa-modulo-pdf.test.js
const path = require('path'), os = require('os'), fs = require('fs'), crypto = require('crypto');
process.env.DB_PATH = path.join(os.tmpdir(), 'imp-mpdf-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.JWT_SECRET = 'impm_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'impm_i_' + crypto.randomBytes(8).toString('hex');
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'imp-mpdf-up-'));
let passed = 0, failed = 0;
async function test(n, fn) { try { await fn(); console.log('  ✓ ' + n); passed++; } catch (e) { console.error('  ✗ ' + n + '\n    ' + e.message); failed++; } }
const ok = (c, m) => { if (!c) throw new Error(m || 'atteso true'); };
const eq = (a, e, m) => { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${m || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); };
const D = path.join(__dirname, '../../../super-admin/backend/src/pacchetti/mediazione-immobiliare/moduli-pdf/');

(async () => {
  const modelli = require('./lib/modelli-pdf'), imp = require('./lib/importa-modulo-pdf');
  const { costruisciGet } = require('./lib/modello-documento');
  const mappa = JSON.parse(fs.readFileSync(D + 'adeguata-verifica-it.json', 'utf8'));
  for (const f of ['adeguata-verifica-it', 'contratto-incarico']) { const m = JSON.parse(fs.readFileSync(D + f + '.json', 'utf8')); await modelli.salva({ chiave: f, titolo: m.titolo, pdf: fs.readFileSync(D + (m.file || f + '.pdf')), mappa: { campi: m.campi } }); }
  const statiCivili = [...new Set(mappa.campi.filter((c) => c.chiave === 'stato_civile').map((c) => c.valore).flat())];
  const condizioni = mappa.campi.filter((c) => c.chiave === 'condizione_professionale').map((c) => c.valore); // scelta secca: una casella per voce
  const schema = {
    document_actions: [{ key: 'adeguata_verifica', label: 'Adeguata verifica', pdf_modello: 'adeguata-verifica-it' }],
    fields: [
      { key: 'nome', label: 'Nome', type: 'text' }, { key: 'luogo_nascita', label: 'Luogo di nascita', type: 'text' }, { key: 'data_nascita', label: 'Data di nascita', type: 'date' },
      { key: 'reddito_annuo', label: 'Reddito annuo', type: 'number' }, { key: 'stato_civile', label: 'Stato civile', type: 'select', options: statiCivili }, { key: 'condizione_professionale', label: 'Condizione professionale', type: 'select', options: condizioni },
      { key: 'privacy_firmata_il', label: 'Privacy firmata il', type: 'date', sola_lettura: true },
    ],
  };
  const record = { nome: 'Rossi Mario', luogo_nascita: 'Brescia', data_nascita: '1985-12-10', reddito_annuo: 45000, condizione_professionale: condizioni[3], stato_civile: statiCivili[0], privacy_firmata_il: '2026-10-02' };
  const compilato = async (rec) => (await modelli.compilaPer('adeguata-verifica-it', costruisciGet({ record: rec, schema: { relations: [] }, tenant: {} }))).buffer;
  const per = (p) => Object.fromEntries(p.campi.map((c) => [c.key, c.valore]));

  await test('andata e ritorno: il modulo compilato dal sistema, riletto, dà gli stessi dati (data in formato del sistema, numero come numero)', async () => {
    const p = await imp.proponi({ schema, buffer: await compilato(record) });
    eq(p.modello.chiave, 'adeguata-verifica-it');
    const v = per(p);
    eq([v.nome, v.luogo_nascita, v.data_nascita, v.reddito_annuo, v.condizione_professionale], ['Rossi Mario', 'Brescia', '1985-12-10', 45000, condizioni[3]]);
  });
  await test('lo stato civile ha le scelte del modulo: ogni casella torna al suo valore, anche «Preferisco non rispondere»', async () => {
    eq(statiCivili.length, 4);
    for (const st of statiCivili) eq(per(await imp.proponi({ schema, buffer: await compilato({ ...record, stato_civile: st, condizione_professionale: undefined }) })).stato_civile, st, st);
  });
  await test('i campi di sola lettura e quelli che la scheda non ha non si propongono come dati: finiscono tra i «non collegati» o restano fuori', async () => {
    const p = await imp.proponi({ schema, buffer: await compilato(record) });
    ok(!('privacy_firmata_il' in per(p)));
    ok(p.non_collegati.every((x) => x.motivo && x.voce));
  });
  await test('un valore che non è tra le scelte del campo non si scrive: si segnala', async () => {
    const stretto = { ...schema, fields: schema.fields.map((f) => f.key === 'condizione_professionale' ? { ...f, options: ['Altro'] } : f) };
    const p = await imp.proponi({ schema: stretto, buffer: await compilato(record) });
    ok(!('condizione_professionale' in per(p))); ok(p.non_collegati.some((x) => x.voce === 'Condizione professionale' && /scelte/.test(x.motivo)));
  });
  await test('un PDF che non è un modulo dell\'agenzia è rifiutato; un file che non è un PDF pure; un modulo senza moduli PDF pure', async () => {
    const altro = fs.readFileSync(D + 'contratto-incarico.pdf'); // è un modulo installato ma non collegato ai documenti di questo schema
    let e1 = '', e2 = '', e3 = '';
    try { await imp.proponi({ schema, buffer: altro }); } catch (e) { e1 = e.message; }
    try { await imp.proponi({ schema, buffer: Buffer.from('ciao') }); } catch (e) { e2 = e.message; }
    try { await imp.proponi({ schema: { fields: [] }, buffer: altro }); } catch (e) { e3 = e.message; }
    ok(/non è nessuno dei moduli/.test(e1), e1); ok(/non è un PDF/.test(e2), e2); ok(/non ha moduli PDF/.test(e3), e3);
  });
  await test('conforma: caselle, numeri all\'italiana, scelte multiple, scelta ambigua', () => {
    eq(imp.conforma({ type: 'checkbox' }, 'Sì'), true); eq(imp.conforma({ type: 'number' }, '1.234,50'), 1234.5);
    eq(imp.conforma({ type: 'multiselect', options: ['A', 'B'] }, ['a', 'x', 'B']), ['A', 'B']);
    eq(imp.conforma({ type: 'select', options: ['A', 'B'] }, ['A', 'B']), undefined);
  });
  console.log(`\n${passed} passati, ${failed} falliti`); if (failed) process.exit(1);
})();
