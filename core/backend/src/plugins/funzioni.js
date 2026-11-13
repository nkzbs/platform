'use strict';
// Le FUNZIONI attivabili che non hanno una cartella propria: ognuna è una voce dello «store» (Impostazioni → Funzioni) che accende un adattatore delle azioni esterne
// (lib/azioni-esterne/) e, se serve, le rotte che le servono. `marcatori`: scritte che, se compaiono nello schema di un modulo, dicono che la funzione è già in uso
// (installando un modulo della Libreria che la usa, la funzione si accende da sola).
const PACCHETTO = ['mediazione-immobiliare'];
module.exports = [
  { id: 'firma', nome: 'Firma elettronica', descrizione: 'Manda un documento al cliente da firmare con un codice (o stampato e ricaricato), controlla chi ha firmato e archivia il PDF firmato.',
    icona: 'edit', colore: '#584aec', categoria: 'Documenti', pacchetti: PACCHETTO, costo: 'A pagamento (OpenAPI.it) per ogni richiesta',
    marcatori: ['"adapter":"firma_elettronica"', '"delivery":"firma"'], rotte: ['/firma', '/public-firma'],
    adattatori: { firma_elettronica: () => require('../lib/azioni-esterne/firma_elettronica') } },
  { id: 'fattura', nome: 'Fattura elettronica', descrizione: 'Prepara e invia la fattura elettronica al Sistema di Interscambio dal record, e ne segue lo stato.',
    icona: 'receipt', colore: '#0ea5e9', categoria: 'Documenti', pacchetti: PACCHETTO, costo: 'A pagamento (OpenAPI.it)',
    marcatori: ['"adapter":"fattura_elettronica"'], adattatori: { fattura_elettronica: () => require('../lib/azioni-esterne/fattura_elettronica') } },
  { id: 'messaggi', nome: 'Messaggi ai clienti', descrizione: 'Mail e SMS ai clienti dal record, con modelli e auguri automatici.',
    icona: 'message-circle', colore: '#10b981', categoria: 'Comunicazione', pacchetti: PACCHETTO, costo: 'Mail gratuite, SMS a pagamento',
    marcatori: ['"adapter":"messaggio_cliente"'], adattatori: { messaggio_cliente: () => require('../lib/azioni-esterne/messaggio_cliente') } },
  { id: 'verifiche', nome: 'Verifica clienti', descrizione: 'Controlla una persona o una società (verifica identità, credit score) con i servizi di OpenAPI.it.',
    icona: 'shield', colore: '#f59e0b', categoria: 'Controlli', pacchetti: PACCHETTO, costo: 'A pagamento (OpenAPI.it)',
    marcatori: ['"adapter":"verifica_persona"', '"adapter":"credit_score_societa"'],
    adattatori: { verifica_persona: () => require('../lib/azioni-esterne/verifica_persona'), credit_score_societa: () => require('../lib/azioni-esterne/credit_score_societa') } },
];
