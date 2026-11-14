'use strict';
// Modelli PDF compilabili: il modulo originale dell'azienda, compilato con i dati del record. Prova con i moduli veri del pacchetto Mediazione immobiliare:
// archivio (rifiuta mappe che citano campi inesistenti), compilazione, rilettura di un modulo compilato, pacchetto da firmare (moduli appiattiti + pagina Firma).
// Eseguire con: node src/modelli-pdf.test.js
const path = require('path'), os = require('os'), fs = require('fs'), crypto = require('crypto');
process.env.DB_PATH = path.join(os.tmpdir(), 'mpdf-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.JWT_SECRET = 'mpdf_' + crypto.randomBytes(8).toString('hex');
process.env.INTERNAL_API_SECRET = 'mpdf_i_' + crypto.randomBytes(8).toString('hex');
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mpdf-up-'));
let passed = 0, failed = 0;
async function test(n, fn) { try { await fn(); console.log('  ✓ ' + n); passed++; } catch (e) { console.error('  ✗ ' + n + '\n    ' + e.message); failed++; } }
const ok = (c, m) => { if (!c) throw new Error(m || 'atteso true'); };
const eq = (a, e, m) => { if (JSON.stringify(a) !== JSON.stringify(e)) throw new Error(`${m || ''}: atteso ${JSON.stringify(e)}, ottenuto ${JSON.stringify(a)}`); };
const D = path.join(__dirname, '../../../super-admin/backend/src/pacchetti/mediazione-immobiliare/moduli-pdf/');
const mappaDi = (f) => JSON.parse(fs.readFileSync(D + f + '.json', 'utf8'));
const pdfDi = (f) => fs.readFileSync(D + f + '.pdf');

(async () => {
  const modelli = require('./lib/modelli-pdf'), mp = require('./lib/modulo-pdf');
  const { costruisciGet } = require('./lib/modello-documento');
  const { PDFDocument } = require('pdf-lib');
  const clienti = { 1: { nome: 'Rossi Mario', codice_fiscale_piva: 'RSSMRA70A01H501Z', luogo_nascita: 'Roma' }, 2: { nome: 'Rossi Anna' } };
  const get = costruisciGet({ record: { indirizzo: 'Via Roma', comune: 'Roma', proprietario: 1, comproprietario_2: 2, contesto_stabile: 'Signorile', composizione_vani: ['Ingresso', 'Cucina abitabile'], ascensore: true, foglio_catastale: '12' },
    schema: { relations: [{ key: 'proprietario', target_module: 'clienti' }, { key: 'comproprietario_2', target_module: 'clienti' }] }, tenant: { ragione_sociale: 'Agenzia Prova', piva: '01234567890' }, leggiRecord: (m, id) => clienti[id] || null });
  const campoDi = async (buf, nome) => (await PDFDocument.load(buf)).getForm().getField(nome);
  const nomeCampo = (mappa, pred) => mappa.campi.find(pred).campo;

  await test('i quattro moduli del pacchetto si installano: ogni campo della mappa esiste nel PDF', async () => {
    for (const f of ['contratto-incarico', 'scheda-immobile', 'adeguata-verifica-it', 'adeguata-verifica-en']) { const m = mappaDi(f); const r = await modelli.salva({ chiave: f, titolo: m.titolo, pdf: pdfDi(f), mappa: m }); ok(r.campi > 5, f); }
    eq(modelli.elenco().length, 4);
  });
  await test('una mappa che cita un campo che il PDF non ha è rifiutata, un file che non è un PDF pure', async () => {
    let e1 = '', e2 = '';
    try { await modelli.salva({ chiave: 'x1', pdf: pdfDi('contratto-incarico'), mappa: { campi: [{ campo: 'Non esiste', testo: 'a' }] } }); } catch (e) { e1 = e.message; }
    try { await modelli.salva({ chiave: 'x2', pdf: Buffer.from('ciao'), mappa: { campi: [] } }); } catch (e) { e2 = e.message; }
    ok(/campi che il PDF non ha/.test(e1), e1); ok(/non è un PDF/.test(e2), e2);
  });
  await test('contratto: nome del proprietario nel campo giusto, «comproprietario» spuntato, «proprietario esclusivo» no, agenzia dai dati del tenant', async () => {
    const m = mappaDi('contratto-incarico'); const { buffer } = await modelli.compilaPer('contratto-incarico', get);
    eq((await campoDi(buffer, m.campi[0].campo)).getText(), 'Rossi Mario');
    const esclusivo = m.campi.find((c) => c.chiave === 'comproprietario_2' && c.valore === '@vuoto'), co = m.campi.find((c) => c.chiave === 'comproprietario_2' && c.valore === '@pieno');
    eq((await campoDi(buffer, co.campo)).isChecked(), true); eq((await campoDi(buffer, esclusivo.campo)).isChecked(), false);
    eq((await campoDi(buffer, nomeCampo(m, (c) => c.testo === '{{@azienda|vuoto}}'))).getText(), 'Agenzia Prova');
  });
  await test('scheda: caselle da un elenco (composizione vani), da un Sì/No (ascensore) e da una scelta (contesto)', async () => {
    const m = mappaDi('scheda-immobile'); const { buffer } = await modelli.compilaPer('scheda-immobile', get);
    const c = async (chiave, valore) => (await campoDi(buffer, m.campi.find((x) => x.chiave === chiave && x.valore === valore).campo)).isChecked();
    eq(await c('composizione_vani', 'Ingresso'), true); eq(await c('composizione_vani', 'Soggiorno'), false); eq(await c('composizione_vani', 'Cucina abitabile'), true);
    eq(await c('ascensore', 'Sì'), true); eq(await c('portineria', 'Sì'), false); eq(await c('contesto_stabile', 'Signorile'), true); eq(await c('contesto_stabile', 'Popolare'), false);
  });
  await test('un modulo compilato al computer si rilegge: i valori tornano ai campi del record', async () => {
    const m = mappaDi('scheda-immobile'); const { buffer } = await modelli.compilaPer('scheda-immobile', get);
    const letto = await mp.leggi({ buffer, mappa: m });
    eq(letto['proprietario.nome'], 'Rossi Mario'); eq(letto.foglio_catastale, '12'); ok([].concat(letto.composizione_vani).includes('Ingresso'), 'vani'); eq(letto.contesto_stabile, 'Signorile');
  });
  await test('il foglio conservato con la richiesta dà lo stesso modulo anche se la scheda cambia dopo', async () => {
    const { campi } = await modelli.compilaPer('contratto-incarico', get);
    const dopo = await modelli.dalFoglio('contratto-incarico', campi);
    eq((await campoDi(dopo, mappaDi('contratto-incarico').campi[0].campo)).getText(), 'Rossi Mario');
  });
  await test('pacchetto da firmare: moduli appiattiti (nessun campo) + pagina Firma in fondo; un documento di solo testo si mescola', async () => {
    const { pacchettoDaFirmare } = require('./lib/richieste-firma');
    const c = await modelli.compilaPer('contratto-incarico', get), s = await modelli.compilaPer('scheda-immobile', get);
    const docs = [{ key: 'contratto', label: 'Contratto di incarico', pdf_modello: 'contratto-incarico', foglio: c.campi }, { key: 'testo', label: 'Informativa', corpo: 'INFORMATIVA\n\nNome: Mario' }, { key: 'scheda', label: 'Scheda immobile', pdf_modello: 'scheda-immobile', foglio: s.campi }];
    const pk = await pacchettoDaFirmare(docs, {}, '2026-0001');
    const pdf = await PDFDocument.load(pk.buffer);
    eq(pk.pagine, 2 + 1 + 3 + 1); eq(pdf.getForm().getFields().length, 0, 'campi rimasti');
  });
  console.log('\n' + passed + ' passati, ' + failed + ' falliti');
  process.exit(failed ? 1 : 0);
})();
