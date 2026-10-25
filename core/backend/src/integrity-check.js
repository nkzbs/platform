'use strict';
// Controllo di integrità all'avvio (25/10/2026, richiesto dall'utente dopo l'incidente
// reale dello stesso giorno: il container di Finance montava un database sbagliato,
// quasi vuoto, senza il modulo busta paga — scoperto per caso ore dopo). Generico, non
// specifico a Finance o a nessun modulo: confronta un'impronta minima del database
// montato ORA contro l'ultima impronta nota, e avvisa (mai blocca l'avvio) se sembra
// un database diverso da quello di prima.
//
// L'impronta va SALVATA FUORI dal file .db (altrimenti scambiare il file sposterebbe
// anche il riferimento con sé, rendendo il controllo inutile) — un file a fianco, nella
// stessa cartella di DB_PATH, con nome legato al TENANT_SLUG (non al nome del file .db,
// che può cambiare) così resta al suo posto qualunque file .db venga montato.
const fs = require('fs');
const path = require('path');
const db = require('./db');

function baselinePath() {
  const dir = path.dirname(process.env.DB_PATH || '/data/tenant.db');
  const slug = (process.env.TENANT_SLUG || 'tenant').replace(/[^a-z0-9_-]/gi, '_');
  return path.join(dir, '.' + slug + '.integrity-baseline.json');
}

// Solo due numeri, deliberatamente minimi: l'elenco dei moduli installati (un database
// "sbagliato" ha quasi sempre un elenco di moduli del tutto diverso, visto dal vivo) e
// il totale dei record (un database "quasi vuoto" scambiato con uno vero crolla qui).
function fingerprint() {
  const modules = db.prepare('SELECT slug FROM modules WHERE installed = 1 ORDER BY slug').all().map((r) => r.slug);
  const totaleRecord = db.prepare('SELECT COUNT(*) n FROM records').get().n;
  return { modules, totale_record: totaleRecord, controllato_il: new Date().toISOString() };
}

function leggiBaseline() {
  try { return JSON.parse(fs.readFileSync(baselinePath(), 'utf8')); } catch (e) { return null; }
}

function scriviBaseline(fp) {
  try { fs.writeFileSync(baselinePath(), JSON.stringify(fp, null, 2)); } catch (e) { console.error('[integrity-check] impossibile scrivere il riferimento:', e.message); }
}

// Chiamata UNA volta all'avvio (index.js). Non aggiorna MAI da sola il riferimento
// dopo un'incongruenza — altrimenti un database sbagliato montato per errore
// diventerebbe silenziosamente "il nuovo normale" al riavvio successivo, e l'avviso
// sparirebbe da solo proprio quando serve di più. Si aggiorna solo con accettaStatoAttuale(),
// un'azione esplicita (Impostazioni → Sicurezza).
function checkIntegrity() {
  const attuale = fingerprint();
  const precedente = leggiBaseline();

  if (!precedente) {
    scriviBaseline(attuale); // primo avvio per questo percorso dati: niente da confrontare ancora
    return { ok: true, primo_avvio: true };
  }

  const persi = precedente.modules.filter((m) => !attuale.modules.includes(m));
  const caloDrastico = precedente.totale_record > 20 && attuale.totale_record < precedente.totale_record * 0.5;
  if (persi.length === 0 && !caloDrastico) return { ok: true };

  const msg = 'Il database che questo tenant ha montato ora sembra diverso da quello visto l\'ultima volta'
    + (persi.length ? ': mancano i moduli [' + persi.join(', ') + ']' : '')
    + (caloDrastico ? (persi.length ? ', e' : ':') + ' i record totali sono scesi da ' + precedente.totale_record + ' a ' + attuale.totale_record : '')
    + '. Se è un errore (database sbagliato montato), va corretto SUBITO. Se è un ripristino voluto, conferma da Impostazioni → Sicurezza per aggiornare il riferimento.';
  console.error('[integrity-check] ATTENZIONE:', msg);
  try { require('./audit-log').logAudit('system', 'integrity.mismatch', null, { persi, calo_drastico: caloDrastico, precedente, attuale }); } catch (e) { /* un avviso non deve mai bloccare l'avvio */ }
  try { require('./avvisi').sendText('scadenza', '⚠️ ' + msg); } catch (e) { console.error('[integrity-check] avviso non inviato:', e.message); }
  return { ok: false, persi, calo_drastico: caloDrastico, messaggio: msg };
}

// Azione esplicita (mai automatica): "sì, questo è lo stato giusto da ora in poi".
function accettaStatoAttuale() {
  scriviBaseline(fingerprint());
}

module.exports = { checkIntegrity, accettaStatoAttuale, fingerprint, baselinePath };
