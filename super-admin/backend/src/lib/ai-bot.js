'use strict';
// Bot Telegram: una frase libera diventa UNA azione scelta da un elenco chiuso, mai un comando libero. Il modello vede solo la frase (ripulita dai dati personali) e il
// catalogo dei moduli di spesa (nome, etichetta, categorie ammesse): nessun record, nessun id. La risposta è un JSON che qui si valida rigidamente (azione, valori,
// date, importi, categorie, moduli devono esistere nel catalogo); il tenant la rivalida, risolve da sé a quale riga ci si riferisce, e per ogni scrittura chiede una
// conferma con un tocco. Un modello non può quindi eseguire niente: al massimo propone una delle azioni previste.
const { redact } = require('./ai-redact');

const { AZIONI, ISO, validateIntent } = require('../../../../shared/ai-bot-intent.js');

const BOT_PROMPT = `Sei il traduttore di un bot per le finanze personali. Ricevi un JSON con "frase" (cosa ha scritto l'utente), "oggi" (data di oggi), "timbrature" (true se l'utente può timbrare) "report" (i report disponibili) e "moduli": i moduli di spesa disponibili, ciascuno con "slug", "name", "etichetta" e "categorie" (valori ammessi). Scegli UNA azione tra queste e rispondi SOLO con un oggetto JSON, senza testo attorno:
- {"azione":"domanda"} se chiede un calcolo o un'informazione sui dati ("quanto ho speso di benzina a settembre?", "quante bollette A2A nel 2025?").
- {"azione":"elenco","cosa":"id di uno dei \"report\""} se vuole vedere uno dei report disponibili (\"report\" è l'elenco di {id, nome}: scegli quello che risponde meglio alla richiesta, per esempio cosa deve pagare, le voci scadute, le righe da smistare).
- {"azione":"segna_pagata","cerca":"parole per riconoscere la voce"} se dice di aver pagato una voce già esistente ("ho pagato l'affitto", "segna pagata la bolletta A2A").
- {"azione":"riapri","cerca":"..."} se vuole rimettere "da pagare" una voce segnata pagata per errore.
- {"azione":"smista","cerca":"...","modo":"uno"|"rate"|"pagata","n_rate":numero,"importo":numero o null,"scadenza":"AAAA-MM-GG" o null} se vuole smistare una bolletta in arrivo: "uno" = un solo pagamento, "rate" = dividerla in rate (n_rate da 2 a 60), "pagata" = già pagata.
- {"azione":"nuova_spesa","descrizione":"...","importo":numero maggiore di zero,"data":"AAAA-MM-GG" o null,"modulo":"slug dei moduli" o null,"pagata":true o false,"categoria":"una delle categorie del modulo" o null} se vuole registrare una spesa nuova ("ho speso 20 euro di benzina": pagata true; "devo pagare 45 euro a Mario il 5": pagata false). La data va calcolata da "oggi". Se non è chiaro il modulo, null.
- {"azione":"timbra","tipo":"entrata"|"uscita","ora":"HH:MM" o null,"data":"AAAA-MM-GG" o null} SOLO se "timbrature" è true e dice di essere entrato/a o uscito/a dal lavoro ("sono entrata", "ho finito", "uscita alle 12:30", "ieri sono entrata alle 7"). Se non dice l'ora, null; "alle 7" è "07:00", "alle 5 del pomeriggio" è "17:00".
- {"azione":"ore","periodo":"oggi"|"settimana"|"mese"|"mese_scorso"} SOLO se "timbrature" è true e chiede quante ore ha lavorato.
- {"azione":"altro"} per tutto il resto (saluti, richieste che non rientrano, eliminare o modificare dati, impostazioni).
Non inventare moduli, categorie o importi. Gli importi sono in euro, con il punto per i decimali. Se un valore non è nella frase, usa null.`;

const clean = (v, n) => String(v == null ? '' : v).replace(/[\r\n]+/g, ' ').trim().slice(0, n);

function sanitizeBot(data) {
  if (!data || typeof data !== 'object') return { error: 'data obbligatorio' };
  const frase = redact(String(data.frase || '')).replace(/[\r\n]+/g, ' ').trim().slice(0, 300);
  if (frase.length < 2) return { error: 'Scrivi qualcosa.' };
  const timbrature = data.timbrature === true;
  if (!Array.isArray(data.moduli) || (!data.moduli.length && !timbrature)) return { error: 'moduli obbligatorio' };
  const moduli = data.moduli.slice(0, 10).map((m) => ({
    slug: clean(m.slug, 60), name: clean(m.name, 60), etichetta: clean(m.etichetta, 30),
    categorie: (Array.isArray(m.categorie) ? m.categorie : []).slice(0, 60).map((c) => clean(c, 40)).filter(Boolean),
  })).filter((m) => m.slug);
  if (!moduli.length && !timbrature) return { error: 'Nessun modulo.' };
  const oggi = ISO.test(String(data.oggi || '')) ? data.oggi : new Date().toISOString().slice(0, 10);
  const report = (Array.isArray(data.report) ? data.report : []).slice(0, 12).map((r) => ({ id: clean(r && r.id, 31), nome: clean(r && r.nome, 40) })).filter((r) => /^[a-z][a-z0-9_]{1,30}$/.test(r.id));
  return { payload: { frase, oggi, timbrature, report, moduli } };
}

module.exports = { BOT_PROMPT, sanitizeBot, validateIntent, AZIONI };
