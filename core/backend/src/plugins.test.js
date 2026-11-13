'use strict';
// I plugin (src/plugins/): un tenant senza il pacchetto non ha le funzioni del settore; con il pacchetto (o con PLATFORM_PLUGINS) sì.
// Eseguire con: node src/plugins.test.js
const os = require('os'), path = require('path'), fs = require('fs');
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'plug-')), 't.db');
process.env.JWT_SECRET = 'x'.repeat(40);
delete process.env.PLATFORM_PLUGINS;
let ok = 0, ko = 0;
const t = (nome, cond) => { if (cond) { ok++; console.log('  ✓ ' + nome); } else { ko++; console.log('  ✗ ' + nome); } };
const db = require('./db'); const E = require('./seed-blocchi-verticale'); const plugins = require('./plugins'); const az = require('./lib/azioni-esterne');
t('senza pacchetto il plugin non è attivo', plugins.attivi().length === 0);
t('senza pacchetto l\'adattatore immobiliare non esiste, quelli del core sì', az.adattatore('valutazione_immobiliare') === null && !!az.adattatore('verifica_persona'));
t('senza pacchetto le librerie del plugin non si caricano', plugins.libreria('immobiliare', 'servizi-vicini') === null);
E.riceviPacchetto('mediazione-immobiliare', 1, { estensioni: {} });
t('col pacchetto il plugin è attivo', plugins.attivi().map((p) => p.id).join() === 'immobiliare');
t('col pacchetto l\'adattatore c\'è e ha il suo nome', !!az.adattatore('valutazione_immobiliare') && az.nomiAdattatori().includes('controllo_catastale'));
t('col pacchetto la libreria dei servizi vicini si carica', typeof plugins.libreria('immobiliare', 'servizi-vicini').stato === 'function');
console.log('\n' + ok + ' passati, ' + ko + ' falliti');
process.exit(ko ? 1 : 0);
