'use strict';
// I plugin (src/plugins/): un tenant senza il pacchetto non ha le funzioni del settore; con il pacchetto (o con PLATFORM_PLUGINS) sì.
// Eseguire con: node src/plugins.test.js
const os = require('os'), path = require('path'), fs = require('fs');
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'plug-')), 't.db');
process.env.JWT_SECRET = 'x'.repeat(40);
delete process.env.PLATFORM_PLUGINS; process.env.UPLOAD_DIR = path.join(os.tmpdir(), 'plug-up');
let ok = 0, ko = 0;
const t = (nome, cond) => { if (cond) { ok++; console.log('  ✓ ' + nome); } else { ko++; console.log('  ✗ ' + nome); } };
const db = require('./db'); const E = require('./seed-blocchi-verticale'); const plugins = require('./plugins'); const az = require('./lib/azioni-esterne');
t('senza pacchetto il plugin non è attivo', plugins.attivi().length === 0);
t('senza pacchetto l\'adattatore immobiliare non esiste, quelli del core sì', az.adattatore('valutazione_immobiliare') === null && !!az.adattatore('da_attivare') && az.adattatore('verifica_persona') === null);
t('senza pacchetto le librerie del plugin non si caricano', plugins.libreria('immobiliare', 'servizi-vicini') === null);
E.riceviPacchetto('mediazione-immobiliare', 1, { estensioni: {} });
t('col pacchetto il plugin è attivo', plugins.attivi().map((p) => p.id).includes('immobiliare') && plugins.attivi().length === plugins.tutti().length);
t('col pacchetto l\'adattatore c\'è e ha il suo nome', !!az.adattatore('valutazione_immobiliare') && az.nomiAdattatori().includes('controllo_catastale'));
t('col pacchetto la libreria dei servizi vicini si carica', typeof plugins.libreria('immobiliare', 'servizi-vicini').stato === 'function');
// lo store: accendere e spegnere a mano, e «usata» da un modulo
const fz = () => plugins.catalogo().find((f) => f.id === 'fattura');
db.prepare('DELETE FROM pacchetti_ricevuti').run();
t('catalogo: tutte le funzioni, spente', plugins.catalogo().length >= 5 && plugins.catalogo().every((f) => !f.attiva));
plugins.attiva('fattura');
t('accesa a mano: attiva, motivo «scelta», si può spegnere', fz().attiva && fz().motivo === 'scelta' && fz().puo_spegnere && !!az.adattatore('fattura_elettronica'));
t('si spegne', plugins.spegni('fattura').ok && !fz().attiva && az.adattatore('fattura_elettronica') === null);
db.prepare("INSERT INTO modules (slug, name, schema_json) VALUES ('t1','T1',?)").run('{"external_actions":[{"adapter":"fattura_elettronica","key":"f"}]}');
t('un modulo che la usa la accende da solo e non si spegne', fz().attiva && fz().motivo === 'usata' && plugins.spegni('fattura').errore);
t('funzione sconosciuta rifiutata', plugins.attiva('boh') === false);
console.log('\n' + ok + ' passati, ' + ko + ' falliti');
process.exit(ko ? 1 : 0);
