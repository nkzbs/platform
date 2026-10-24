'use strict';
// Bot Telegram: una frase libera diventa UNA azione scelta da un elenco chiuso, mai un comando libero. Il modello vede solo la frase (ripulita dai dati personali) e il
// catalogo dei moduli di spesa (nome, etichetta, categorie ammesse): nessun record, nessun id. La risposta è un JSON che qui si valida rigidamente (azione, valori,
// date, importi, categorie, moduli devono esistere nel catalogo); il tenant la rivalida, risolve da sé a quale riga ci si riferisce, e per ogni scrittura chiede una
// conferma con un tocco. Un modello non può quindi eseguire niente: al massimo propone una delle azioni previste.
const { redact } = require('./ai-redact');

const { AZIONI, ISO, validateIntent } = require('../../../../shared/ai-bot-intent.js');

const BOT_PROMPT = `Sei il traduttore di un bot di un'app gestionale (spese, entrate, scadenze, timbrature). Ricevi un JSON con "frase" (cosa ha scritto l'utente), "oggi" (data di oggi), "timbrature" (true se l'utente può timbrare), "report" (i report disponibili), "moduli": i moduli di spesa disponibili, ciascuno con "slug", "name", "etichetta" e "categorie" (valori ammessi), "moduli_entrata": i moduli di entrata disponibili, ciascuno con "slug", "name", "categorie" (valori ammessi) e "gruppi" (valori ammessi, es. Casa/Personale, solo se il modulo li ha), ed eventualmente "storico" ({"testo","capito"}: l'ultima frase di questa conversazione e cosa si era capito, se recente). Se "frase" da sola è troppo vaga per capire cosa vuole (es. "e il mese scorso?", "anche quelle di casa") ma "storico" c'è ed è chiaramente lo stesso argomento, usalo per interpretarla come un seguito di quella; se "frase" è già chiara da sola, o parla d'altro, ignora "storico". Scegli UNA azione tra queste e rispondi SOLO con un oggetto JSON, senza testo attorno:
- {"azione":"domanda"} se chiede un calcolo o un'informazione sui dati ("quanto ho speso di benzina a settembre?", "quante bollette A2A nel 2025?").
- {"azione":"elenco","cosa":"id di uno dei \"report\""} se vuole vedere uno dei report disponibili (\"report\" è l'elenco di {id, nome}: scegli quello che risponde meglio alla richiesta, per esempio cosa deve pagare, le voci scadute, le righe da smistare).
- {"azione":"segna_pagata","cerca":"parole per riconoscere la voce"} se dice di aver pagato una voce già esistente ("ho pagato l'affitto", "segna pagata la bolletta A2A").
- {"azione":"riapri","cerca":"..."} se vuole rimettere "da pagare" una voce segnata pagata per errore.
- {"azione":"smista","cerca":"...","modo":"uno"|"rate"|"pagata","n_rate":numero,"importo":numero o null,"scadenza":"AAAA-MM-GG" o null} se vuole smistare una bolletta in arrivo: "uno" = un solo pagamento, "rate" = dividerla in rate (n_rate da 2 a 60), "pagata" = già pagata.
- {"azione":"nuova_spesa","descrizione":"...","importo":numero maggiore di zero,"data":"AAAA-MM-GG" o null,"modulo":"slug dei moduli" o null,"pagata":true o false,"categoria":"una delle categorie del modulo" o null} se vuole registrare una spesa nuova ("ho speso 20 euro di benzina": pagata true; "devo pagare 45 euro a Mario il 5": pagata false). La data va calcolata da "oggi". Se non è chiaro il modulo, null.
- {"azione":"nuova_entrata","descrizione":"...","importo":numero maggiore di zero,"data":"AAAA-MM-GG" o null,"modulo":"slug di uno dei moduli_entrata" o null,"categoria":"una delle categorie del modulo" o null,"gruppo":"uno dei gruppi del modulo" o null} se dice che gli è arrivato un reddito o un versamento ("mi è arrivato lo stipendio di 1800", "ho versato 500 euro alla casa", "ho ricevuto 400 da Federica per la casa"). "categoria"/"gruppo" solo se il modulo scelto li ha dichiarati, altrimenti null.
- {"azione":"timbra","tipo":"entrata"|"uscita","ora":"HH:MM" o null,"ora_fine":"HH:MM" o null,"data":"AAAA-MM-GG" o null} SOLO se "timbrature" è true e dice di essere entrato/a o uscito/a dal lavoro ("sono entrata", "ho finito", "uscita alle 12:30", "ieri sono entrata alle 7"). Se la frase descrive un turno già concluso con ENTRAMBI gli orari ("oggi sono entrata alle 12 e uscita alle 21", "ieri ho lavorato dalle 9 alle 17"), usa tipo "entrata" con "ora" l'orario di inizio e "ora_fine" l'orario di fine; altrimenti "ora_fine" resta null. Se non dice l'ora, null; "alle 7" è "07:00", "alle 5 del pomeriggio" è "17:00".
- {"azione":"ore","periodo":"oggi"|"settimana"|"mese"|"mese_scorso"} SOLO se "timbrature" è true e chiede quante ore ha lavorato, o se ha fatto straordinari (lo straordinario è nella risposta a questa stessa azione, non una azione a sé: non esiste su "oggi", solo su settimana/mese).
- {"azione":"altro"} per tutto il resto (saluti, richieste che non rientrano, eliminare o modificare dati, impostazioni).
Non inventare moduli, categorie, gruppi o importi. Gli importi sono in euro, con il punto per i decimali. Se un valore non è nella frase, usa null.`;

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
  const moduliEntrata = (Array.isArray(data.moduli_entrata) ? data.moduli_entrata : []).slice(0, 10).map((m) => ({
    slug: clean(m.slug, 60), name: clean(m.name, 60),
    categorie: (Array.isArray(m.categorie) ? m.categorie : []).slice(0, 60).map((c) => clean(c, 40)).filter(Boolean),
    gruppi: (Array.isArray(m.gruppi) ? m.gruppi : []).slice(0, 60).map((c) => clean(c, 40)).filter(Boolean),
  })).filter((m) => m.slug);
  const oggi = ISO.test(String(data.oggi || '')) ? data.oggi : new Date().toISOString().slice(0, 10);
  const report = (Array.isArray(data.report) ? data.report : []).slice(0, 12).map((r) => ({ id: clean(r && r.id, 31), nome: clean(r && r.nome, 40) })).filter((r) => /^[a-z][a-z0-9_]{1,30}$/.test(r.id));
  const storico = data.storico && typeof data.storico === 'object' && data.storico.testo
    ? { testo: redact(clean(data.storico.testo, 300)), capito: clean(data.storico.capito, 300) } : null;
  return { payload: { frase, oggi, timbrature, report, moduli, moduli_entrata: moduliEntrata, storico } };
}

module.exports = { BOT_PROMPT, sanitizeBot, validateIntent, AZIONI };
