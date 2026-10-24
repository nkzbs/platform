'use strict';
// Menu a bottoni del bot Telegram (2026-10-14, richiesto dall'utente:
// "qualcosa di più deep con bottoni menu e sottomenu" oltre ai comandi/frase
// libera già esistenti — MAI in sostituzione, solo un front-end più comodo
// alle stesse funzioni). Ogni nodo si ricostruisce da ciò che l'utente può
// fare ORA (stesso principio di bot-ai.js: nessun albero fisso salvato da
// qualche parte) — un report spento o un modulo timbrature non dichiarato
// semplicemente non compaiono.
//
// I nodi "foglia" (nuova spesa, scontrino, chiedi ai dati) non hanno uno
// stato di conversazione: mostrano solo un invito a scrivere/mandare
// qualcosa, poi il messaggio successivo dell'utente passa dal percorso a
// frase libera già esistente (handleMessage → handleFree/foto/documento) —
// stesso principio "senza stato" del resto del bot, nessuna macchina a
// stati nuova da mantenere.

const back = (to) => [{ text: '🔙 Indietro', callback_data: 'mn:' + to }];

function root(user) {
  const tb = require('./bot-timbrature');
  const bp = require('./bot-payslip');
  const rows = [[{ text: '💰 Spese & Entrate', callback_data: 'mn:soldi' }]];
  if (tb.haPresenze(user)) rows.push([{ text: '⏱ Timbrature', callback_data: 'mn:timbrature' }]);
  if (bp.haBustaPaga(user)) rows.push([{ text: '📄 Busta paga', callback_data: 'mn:busta_paga' }]);
  rows.push([{ text: '📑 Report', callback_data: 'mn:report' }]);
  return { html: '<b>Cosa vuoi fare?</b>', keyboard: rows };
}

function soldi() {
  return {
    html: '<b>Spese &amp; Entrate</b>',
    keyboard: [
      [{ text: '➕ Nuova spesa o entrata', callback_data: 'mn:nuova_spesa' }],
      [{ text: '📎 Scontrino o bolletta', callback_data: 'mn:scontrino' }],
      [{ text: '❓ Chiedi ai dati', callback_data: 'mn:domanda' }],
      back('root'),
    ],
  };
}

function timbrature(user) {
  const tb = require('./bot-timbrature');
  if (!tb.haPresenze(user)) return root(user);
  const m = tb.menu();
  return { html: m.html, keyboard: [...m.keyboard, back('root')] };
}

function report() {
  const reports = require('./reports');
  const defs = reports.settings().definizioni.filter((d) => d.enabled);
  const rows = defs.map((d) => [{ text: d.emoji + ' ' + d.nome, callback_data: 'rp:' + d.id }]);
  rows.push(back('root'));
  return { html: defs.length ? 'Quale report vuoi vedere?' : 'Nessun report è acceso (Impostazioni → Report).', keyboard: rows };
}

function nuovaSpesa() {
  return { html: 'Scrivimi la spesa o l\'entrata, per esempio:\n«ho speso 20 euro di benzina»\n«ho ricevuto 500 euro di stipendio»', keyboard: [back('soldi')] };
}
function scontrino() {
  return { html: 'Mandami la foto dello scontrino o il PDF della bolletta: li leggo e ti propongo la riga da creare.', keyboard: [back('soldi')] };
}
function domanda() {
  return { html: 'Scrivimi la domanda sui tuoi dati, per esempio:\n«quanto ho speso di benzina a settembre?»\n«quanto devo ancora in totale?»', keyboard: [back('soldi')] };
}

function bustaPaga() {
  return {
    html: '<b>Busta paga</b>',
    keyboard: [
      [{ text: '❓ Fai una domanda', callback_data: 'mn:busta_paga_domanda' }],
      [{ text: '📎 Carica una busta paga', callback_data: 'mn:busta_paga_carica' }],
      back('root'),
    ],
  };
}
function bustaPagaDomanda() {
  return { html: 'Scrivimi la domanda, per esempio:\n«ferie residue?»\n«quante ore ho fatto a ottobre?»\n«dammi la mia ultima busta paga»\n«che buste paga mancano?»', keyboard: [back('busta_paga')] };
}
function bustaPagaCarica() {
  return { html: 'Mandami la foto o il PDF della busta paga con la didascalia "busta": la leggo e te la archivio.', keyboard: [back('busta_paga')] };
}

const NODES = { root, soldi, timbrature, report, nuova_spesa: nuovaSpesa, scontrino, domanda, busta_paga: bustaPaga, busta_paga_domanda: bustaPagaDomanda, busta_paga_carica: bustaPagaCarica };

// Chiave sconosciuta o scaduta (es. un vecchio messaggio con un bottone che
// non esiste più) -> si torna alla radice invece di un errore secco.
function node(key, user) {
  const fn = NODES[key];
  return fn ? fn(user) : root(user);
}

module.exports = { node };
