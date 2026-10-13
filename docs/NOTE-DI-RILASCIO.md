# Note di rilascio

Una voce per ogni chiusura di fase. Il numero di versione è quello di tutta la piattaforma (sidebar di Finance e Super Admin, `/health`, `package.json`); si cambia a mano a ogni chiusura. Il perché delle scelte sta in [`DECISIONI.md`](DECISIONI.md).

## Dopo la 0.1.1 (non ancora in una versione)

- **Report su WhatsApp ridisegnati** (11 ottobre): niente più riepilogo del mattino né report settimanali. Tre messaggi: **quanto devo pagare** (ogni 27, venerdì prima se è weekend, dal 27 al 26 con totale, scadute e «ti restano»), **da smistare** (ogni sera finché non smisti) e **voci scadute** (lunedì sera). Impostazioni → Report, con anteprima, «Invia ora» e pulsante per togliere i vecchi report dai moduli. Dopo l'aggiornamento di Finance: aprire Impostazioni → Report e premere «Toglili dai moduli».

- **Bot Telegram** (11 ottobre): secondo canale dei report e bot a doppio senso. I report arrivano con i bottoni **«✅ Pagata»** (chiude la voce in Finance, con «↩ Annulla») e «Apri l'app»; comandi `/pagare`, `/scadute`, `/smistare`. Ogni telefono è collegato a un utente con un codice monouso e vede/fa solo ciò che può nell'app (Federica solo Casa). **Non è ancora in uso**: serve creare il bot con BotFather e collegarlo (vedi `docs/OPERAZIONI.md`). Mai provato con Telegram vero (solo con un Telegram simulato nei test). Le domande libere con l'AI non ci sono.
- **Bot Telegram «full powered»** (11 ottobre): capisce frasi libere e fa quasi tutto ciò che si fa nell'app — domande sui dati, segnare pagata/riaprire, smistare, registrare spese, importare un PDF mandato in chat — ma **ogni modifica è una proposta con bottone di conferma** e passa dagli stessi controlli dell'app (permessi dell'utente, «solo propri»). Non elimina né modifica dati a piacere. Richiede l'AI accesa e **Super Admin aggiornato** (nuova rotta `bot-intent`). Mai provato con Telegram e Mistral veri, solo simulati nei test.
- **Sicurezza** (11 ottobre): **segreti cifrati a riposo** (credenziali Google/WhatsApp/Telegram e segreti 2FA, in Finance e Super Admin; migrazione automatica all'avvio), `/2fa/setup` non sostituisce più il segreto di chi ha già il 2FA attivo, **librerie aggiornate** (Finance 0 avvisi; nodemailer 10; dockerode 4.0.12). Il **provisioner** va rilasciato a parte. I backup precedenti hanno ancora i segreti in chiaro fino a quando scadono.
- **Foto di scontrini al bot** (11 ottobre): mandi la foto, Mistral legge esercente/data/totale/categoria, il bot propone la spesa («pagata» o «da pagare») con avviso di doppione, e dopo il tuo tocco la crea con la foto allegata. Richiede **Super Admin aggiornato** (nuova rotta `receipt`) e «Importare» acceso sul modulo. **Mai provato con Mistral vero**; l'immagine arriva a Mistral (non si può oscurare).
- **Timbrature dal bot** (12 ottobre): un modulo può dichiarare nel Builder (Ruoli del modulo → tipo «Timbrature») quali campi sono data, entrata e uscita. Il bot allora capisce «sono entrata», «uscita alle 12:30», «ieri sono entrata alle 7», «quante ore ho fatto questa settimana?» e ha `/timbra` e `/ore`. **Eccezione voluta alla conferma**: la timbratura si registra subito (altrimenti è scomoda) ma passa dagli stessi permessi dell'app e ha il bottone **«↩ Annulla»** (15 minuti). L'uscita chiude solo l'ultima entrata aperta (oggi o ieri). Le ore **a cavallo della mezzanotte** ora si calcolano giuste (22:00→01:00 = 3h, prima negative); turno con un orario mancante = 0. Dopo «Aggiorna» Finance dichiara da solo il modulo `timbrature`; le ore di qualche turno notturno già inserito cambiano. Mai provato con Telegram e Mistral veri.
- **Privacy e pulizia di Super Admin** (13 ottobre): tolto l'**Update Manager** (resta il pulsante Aggiorna); l'**Attività** mostra solo le azioni di Super Admin e gli errori tecnici dei tenant, non più cosa fanno gli utenti dentro Finance (azioni e movimenti dei record restano nel registro di Finance). Richiede **Aggiorna** su Finance perché il tenant smetta di esporre il resto.
- **Più generico** (13 ottobre): tolti dal codice i nomi dei moduli e dei campi di Finance. L'**estratto conto** (abbinamento e registrazione delle uscite), le **mail Gmail**, i **riepiloghi** («Come sta andando»: stati «da smistare»/«pagato», rate, data incerta), lo **smistamento AI** e **Chiedi ai dati** leggono ciò che i moduli dichiarano nel Builder (Ruoli del modulo: nuovi usi «estratto», nuovi ruoli note, data incerta, debito, categorie «rata», sezione «Estratto conto»). I valori di Finance sono un file di dati (`seeds/finance-roles.json`) applicato **una volta** all'aggiornamento (ruoli e uso «estratto» completati sulle dichiarazioni esistenti, senza toccare le scelte già fatte). Tolti il vecchio pulsante «Azzera giacenze» (residuo di Coffee) e la sua rotta. Numeri di Finance invariati (stessi test, con le dichiarazioni dei moduli).
- **Formato dei report su WhatsApp compatto** (scadute non ripetute, importi puliti).

## 0.1.1 — 10 ottobre 2026

Finance in uso reale, con la prima giornata di test dal vivo. Si parte dalla 0.1.0 (codice potato, un solo progetto: Finance).

### Novità

- **Dashboard.** Layout a colonne (Da smistare e Riepilogo a tutta larghezza, "Come sta andando" su due colonne); su telefono i widget lunghi si comprimono con un tocco e ricordano la scelta.
- **Riepilogo mensile** rifatto a riquadri animati (spendibile in grande con anello, entrate, uscite, pagato/da pagare, fissa/variabile, previsto carta/conto: **tutte le voci sempre visibili**). Le entrate di un mese sono lo stipendio di fine mese precedente. Segue il mese scelto con le frecce della Checklist.
- **Smista** nella home leggibile su telefono, e nuova scelta **Sposta in un altro modulo** (Casa ↔ Personale), con l'elenco di ciò che non passa.
- **Proprietario delle righe automatiche**: Gmail, estratto conto e rate prendono un proprietario (predefinito in Utenti, altrimenti quello della riga che le genera). Risolve le righe invisibili in Spese Personali per chi non è admin.
- **Documenti come archivio**: cartelle (anche vuote), sottocartelle per anno nelle cartelle grandi, schede con anteprima, elenco alternativo, ricerca su tutto l'archivio, cartelle rinominabili/aggiungibili/eliminabili se vuote, spostamento trascinando. Modulo "Nuovo" semplificato (file in testa, titolo dal nome del file, cartella aperta preselezionata, collegamenti facoltativi chiusi).
- **Backup settimanale via mail**, cifrato, per tenant (Super Admin → Backup).
- **Super Admin**: pulsante **Aggiorna** sul tenant con popup di avanzamento e "AGGIORNATO" a fine corsa; il deploy da script non ritenta più il login se Super Admin lo rifiuta (con 2FA attivo).
- **Pulizia delle primitive** non usate: 5 tipi di blocco e 9 azioni di automazione tolti (circa 2.400 righe), Builder di Super Admin mantenuto.
- Il "modulo di supporto" non esiste più: solo moduli, che si parlano con le relazioni.
- Correzioni: scadenza A2A letta dal PDF, avvisi WhatsApp per ogni riga nuova, mail Gmail non riconosciute elencate, widget assegnabili per utente.

### Da verificare dal vivo (non provato in produzione)

- **Gmail dopo il ricollegamento di Google** (10 ottobre): l'ultima mail elaborata è del 2 ottobre, non c'è prova che il controllo giri. Prova: inoltrare una bolletta e vedere se compare in "Da smistare".
- **Backup via mail**: la cifratura e la pianificazione sono provate con test e con `openssl`; l'invio di posta vero no (premere "Invia ora una prova").
- **Archivio e modulo "Nuovo"** con i file veri su Google Drive dopo l'aggiornamento di Finance.
- Il 2FA di Federica e il controllo che veda solo Casa.

### Da sapere

- **Google OAuth**: con l'app in modalità "Test" il collegamento scade dopo 7 giorni (è successo il 9 ottobre). Va pubblicata "In produzione" o ricollegata ogni settimana. Scollegare non cancella più "Salva su Drive".
- I documenti stanno su **Google Drive**, non sul NAS: senza collegamento a Google non si aprono.
- Il backup via mail e quelli sul NAS contengono il database, **non** i file caricati.
- Se Finance dà errore 521 da Cloudflare, controllare che `platform-nginx` sia acceso (`docker start platform-nginx`).
- Tutti i backup stanno ancora sul NAS: una copia su un altro dispositivo non è configurata.

### Numeri

42 suite di test per Finance, 18 per Super Admin, tutte verdi alla chiusura.

## 0.1.0

Codice potato dopo lo spegnimento di Platform (2 ottobre 2026): vedi [`DECISIONI.md`](DECISIONI.md).
