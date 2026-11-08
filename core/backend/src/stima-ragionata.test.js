'use strict';
const assert = require('assert');
const path = require('path'), os = require('os'), fs = require('fs'), crypto = require('crypto');
process.env.DB_PATH = path.join(os.tmpdir(), 'sr-test-' + crypto.randomBytes(6).toString('hex') + '.db');
process.env.JWT_SECRET = 'sr_secret_' + crypto.randomBytes(8).toString('hex');
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sr-uploads-'));
const { stimaRagionata, condizioneOmi } = require('./lib/stima-ragionata');
const { creaPdfReport } = require('./lib/report-valutazione-pdf');

const omi = { omi_zone: 'E7', values: [
  { property_type: 'Abitazioni civili', condition: 'NORMALE', sale: { min: 1550, max: 1900 } },
  { property_type: 'Abitazioni civili', condition: 'OTTIMO', sale: { min: 1900, max: 2200 } },
  { property_type: 'Autorimesse', condition: 'NORMALE', sale: { min: 750, max: 960 } } ] };
const comparabili = [1951, 2604, 2625, 3282, 1508, 3764].map((p, i) => ({ property_type: 'Trilocale', total_sqm: 96 + i, price_per_sqm: p }));
const report = { omi, comparabili, dettaglio: { quotazione: { min: 1294, max: 1616, med: 1455 } } };

(async () => {
  assert.strictEqual(condizioneOmi('Ottimo'), 'OTTIMO');
  assert.strictEqual(condizioneOmi('Da ristrutturare'), 'SCADENTE');
  assert.strictEqual(condizioneOmi('Buono'), 'NORMALE');
  assert.strictEqual(condizioneOmi(undefined), 'NORMALE');

  const r = stimaRagionata({ dati: { superficie_mq: 96, stato_edificio: 'Ottimo', pertinenze_box: ['Garage singolo'], superficie_box_mq: 27 }, report });
  assert.strictEqual(r.appartamento.min, 96 * 1900);
  assert.strictEqual(r.pertinenze.length, 1);
  assert.strictEqual(r.totale.min, 96 * 1900 + 27 * 750);
  assert.ok(r.totale.med > 200000 && r.totale.med < 240000);
  assert.ok(r.annunci && r.annunci.n >= 3);
  assert.strictEqual(r.zona.valore, 1455 * 96);

  // Senza superficie del box: il box non è incluso e la nota lo dice.
  const senza = stimaRagionata({ dati: { superficie_mq: 96, stato_edificio: 'Buono', pertinenze_box: ['Garage singolo'] }, report });
  assert.strictEqual(senza.pertinenze.length, 0);
  assert.ok(senza.note.some((n) => /superficie/i.test(n)));

  // Stato senza fascia propria (scadente assente): ripiego sulla normale, con nota.
  const rist = stimaRagionata({ dati: { superficie_mq: 80, stato_edificio: 'Da ristrutturare' }, report });
  assert.strictEqual(rist.appartamento.condizione, 'NORMALE');
  assert.ok(rist.note.length);

  // Senza OMI o senza superficie: nessuna stima ragionata (il PDF ripiega sulla media di zona).
  assert.strictEqual(stimaRagionata({ dati: { superficie_mq: 96 }, report: { dettaglio: report.dettaglio } }), null);
  assert.strictEqual(stimaRagionata({ dati: {}, report }), null);

  // Il PDF si genera con e senza stima ragionata, senza rete.
  const a = await creaPdfReport({ record: { data: { titolo: 'T', superficie_mq: 96, stato_edificio: 'Ottimo' } }, report: { ...report } });
  const b = await creaPdfReport({ record: { data: { titolo: 'T', superficie_mq: 96 } }, report: { dettaglio: report.dettaglio } });
  assert.ok(a.slice(0, 4).toString() === '%PDF' && b.slice(0, 4).toString() === '%PDF');
  console.log('stima-ragionata.test.js OK'); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
