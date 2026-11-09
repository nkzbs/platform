# Zucca da zero: cosa serve all'analisi dei processi per dare un tenant operativo al 100%

9 novembre 2026. Esperimento: ricostruire le funzioni di zucca in un **tenant vuoto**, passando solo dalle rotte che usa il Builder (crea modulo, salva bozza, pubblica) più ruoli, permessi e Dashboard. Nessun pacchetto, nessun seed, nessuna modifica al core (le modifiche al core sono «extra» e restano elencate a parte).

Script (rieseguibili): `ricostruisci.mjs`, `prova-comportamento.mjs`, `confronto.mjs`. Esiti: `esito-*.json`.

## 1. Cosa è risultato

**Il motore e il Builder reggono tutto lo schema di zucca.**
- 7 moduli (Clienti, Immobili, Trattative, Provvigioni, Attività, Quote societarie, Richieste privacy) creati, salvati e pubblicati senza errori: 41 passi su 43 riusciti; i 2 falliti sono i ruoli `admin` e `user`, nomi riservati che esistono già.
- Stessi blocchi, per tipo, di zucca in tutti e 7 i moduli; stesso menu, stessi 6 riquadri della Dashboard, stessi ruoli e liste.
- Prova di comportamento sul tenant ricostruito (11 su 11): codice fiscale non valido rifiutato; passaggio a «Preliminare firmato» bloccato finché manca il contratto; con il contratto allegato il passaggio riesce e **nascono da sole due provvigioni**, una per parte, con importo calcolato.

**Quello che il tenant ricostruito non ha** (confronto con zucca):
| Cosa | Perché manca | Dove vive oggi |
|---|---|---|
| Guida: 7 capitoli, 3 flussi, 8 voci di glossario | testo scritto a mano nel pacchetto | `guida.json` del pacchetto |
| Giro guidato: 8 passi | idem | `guida.json` del pacchetto |
| Dati dimostrativi | idem | `dimostrativi.json` |
| Collegamento OpenAPI.it | è un segreto, lo mette una persona | Connessioni |

**Limite dell'esperimento**: gli schemi li ho copiati da zucca e passati dal Builder. Questo prova che il Builder può *contenere* tutto, non che qualcuno saprebbe *scriverlo* da solo. Per questo ho controllato anche gli editor: quasi ogni proprietà usata da zucca ha un editor nel Builder. Mancano solo (controllo per nome nel codice, da rifinire a mano): `external_action` (tipologie, risultato, pdf, servizio richiesto, come attivare), `relation.eredita`, `map_view.paese`. Il confronto di aspetto, funzioni attive e AI non è valido: il tenant di partenza non li aveva configurati.

## 2. Cosa fa oggi l'analisi dei processi
Dal racconto dell'attività l'AI ricava processi (ruoli, passaggi, eccezioni) e **sceglie moduli che esistono già nella Libreria**. Ciò che la Libreria non ha resta «da costruire» e finisce solo come documentazione. Per ricreare zucca è servito un pacchetto scritto a mano.

## 3. Cosa serve per arrivare al 100%
1. **Generatore di moduli.** Per ogni processo senza modulo, l'AI scrive la bozza di schema (campi, relazioni, stati, passaggi, requisiti, automazioni, documenti, viste) nel formato del Builder. Si valida con ciò che esiste già: pubblicazione con controllo delle formule, `/builder/formula/check`, prova a secco delle automazioni. Se la validazione fallisce, l'AI corregge e riprova.
2. **Prova di accettazione automatica.** Dai passaggi dei processi si generano scenari come `prova-comportamento.mjs` (crea record lungo il flusso, controlla blocchi, automazioni e importi). La copertura di un processo diventa «coperta» solo se la prova passa; l'analisi mostra una percentuale «operativo».
3. **Livello non-schema dentro il tenant.** Guida, giro guidato e glossario oggi vivono solo nei pacchetti: servono un posto nel tenant (e un editor) e una bozza generata dall'AI da schema e processi. Lo stesso per i dati dimostrativi, generati dallo schema.
4. **Lista «da completare a mano».** Ciò che l'AI non può fare (chiavi dei servizi, logo, mittente della posta, ruoli reali degli utenti) compare come promemoria con collegamenti diretti alle schede giuste.
5. **Revisione umana a ogni passo.** L'AI propone, tu confermi: come oggi, per non scrivere nel tenant senza OK.

## 4. Extra nel core (fuori dall'esperimento)
- **Azione esterna generica** (indirizzo, connessione, campi da mandare, dove scrivere la risposta): oggi servizi come valutazione, verifica persona, catasto e credit score sono funzioni scritte a mano.
- Rifiniture degli editor: dettagli di `external_action`, `relation.eredita`, `map_view.paese`.
- Primitive di settore usate da zucca nel codice (report PDF con mappa, servizi vicini, stima ragionata): restano nel core, ma dichiarate dal pacchetto/schema.
