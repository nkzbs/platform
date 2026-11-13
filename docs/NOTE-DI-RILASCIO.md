# Note di rilascio

Una voce per ogni chiusura di fase. Il numero di versione è quello di tutta la piattaforma (sidebar di Finance e Super Admin, `/health`, `package.json`); si cambia a mano a ogni chiusura. Il perché delle scelte sta in [`DECISIONI.md`](DECISIONI.md).

## 0.5.29 — Form a sezioni più leggibile: colori, caselle, avanzamento

Il form «Nuovo»/«Modifica» (`CampiPerSezioni.jsx`) ora è anche più chiaro da vedere: **barra di avanzamento** in cima («12 campi compilati su 80», «Mancano 2 campi necessari»), i campi obbligatori in un **riquadro viola evidenziato** («Da compilare»), ogni **sezione con il suo colore** (fascia a sinistra, titolo su fondo colorato, pillola «compilati/totali» che diventa verde con ✓ quando è completa) e ogni **campo in una casella** propria. Colori con trasparenza, quindi vanno bene in tema chiaro e scuro. Non verificato nel browser: l'aspetto va guardato su telefono dopo «Aggiorna».

## 0.5.28 — Form di inserimento e modifica a sezioni

Il form «Nuovo» e «Modifica» di Clienti e Immobili era un elenco unico di tutti i campi (un'ottantina per un immobile). Ora, per ogni modulo i cui campi hanno una `sezione` (le stesse del dettaglio), il form mostra in alto **«Da compilare»** (i campi obbligatori) e sotto le **sezioni chiuse**, ognuna con «compilati/totali» (Anagrafica, Contatti, Prezzi e valutazione, Edificio…); si aprono toccando il titolo. Se non c'è nessun obbligatorio si apre la prima. I moduli senza sezioni restano un elenco semplice. Componente: `ModulePage/CampiPerSezioni.jsx`, usato dal drawer «Nuovo» (`index.jsx`) e dalla modifica (`RecordDetailModal.jsx`). Non verificato nel browser, solo che si compila.

## 0.5.27 — Scheda Documenti più chiara, con i documenti del cliente

- **Niente più doppioni**: i documenti da firmare comparivano due volte (nel riquadro «Far firmare al cliente» e di nuovo nell'elenco sotto). Ora l'elenco sotto, intitolato «Messaggi e documenti da mandare», ha solo quelli che non si firmano (mail, auguri…); quelli da firmare stanno solo nel riquadro.
- **Il testo del riquadro dice cosa fare**: «Premi “Invia per la firma”: il cliente riceve un link, firma con un codice oppure stampa e ricarica la foto».
- **I documenti del cliente stanno in Documenti**: il riquadro Allegati (carta d'identità, codice fiscale, atti…, con il tipo) è passato dalla scheda Dati alla scheda Documenti, sempre aperto, con «Carica allegati». Dalla scheda Dati è sparita la tessera «Allegati». Non cambia dove sono salvati i file.
- Non verificato nel browser, solo che la pagina si compila.

## 0.5.26 — Ogni cliente vede solo la verifica che gli serve (pacchetto 27)

Un cliente persona fisica vedeva «Credit score società». Ora le azioni esterne hanno una condizione **`visibile_se`** `{ campo, op, valore }` (come `visible_if` dei campi; calcolata sul record aperto in `RecordDetailModal`). Il pacchetto Mediazione immobiliare 27 la imposta con l'estensione `risk_visibilita`: **«Credit score società» compare solo se «Tipo soggetto» è Società**, «Verifica del soggetto e solvibilità» in tutti gli altri casi (anche con il tipo vuoto). Si applica ai moduli già pubblicati con **Aggiorna** (sincronizza i pacchetti). Test: pacchetti, azioni-esterne, risk-collegati verdi; la condizione in interfaccia non ha un test automatico.

## 0.5.25 — Firma: «Controlla» e segno ✓ per ogni firmatario

Nel riquadro «Far firmare al cliente» ogni firmatario ha un segno davanti al nome (✓ verde firmato, ◷ in attesa, ✕ annullato/scaduto) e, finché aspetta, il pulsante **Controlla**: con la firma con codice chiede subito lo stato a eSignature (se ha firmato, scarica il firmato e chiude come sempre) e dice «Non ha ancora firmato» oppure «Ha firmato». **Annulla** ora chiede conferma. Prima il controllo era solo automatico (5 minuti). Rotta: `POST /api/firma/richieste/:rid/controlla`. Non si può annullare una richiesta già firmata (gli allegati sono già nel record).

## 0.5.24 — Firma con codice: il link di eSignature, finalmente mostrato

Trovato alla prima prova dal vivo (12 novembre): la richiesta a eSignature veniva accettata e pagata (3 × 0,49) ma al cliente **non arrivava nessun codice**. Causa: `POST /EU-SES` **non spedisce niente**, restituisce un **link per ogni firmatario** alla pagina di firma di eSignature; il codice parte solo quando il firmatario apre quel link. Noi scartavamo il link e la pagina diceva «ti abbiamo mandato un messaggio».

- **Pagina di firma**: dopo l'avvio compare il pulsante **«Apri la firma»** (il link di eSignature, in una nuova scheda); lì il cliente legge, riceve il codice e firma. Poi «Ho firmato» o attesa automatica come prima. Se il link non c'è, la pagina lo dice e propone di ricaricare. Il link si rilegge dal dettaglio della richiesta (`/detail`, senza costo), quindi funziona anche per le richieste già partite.
- **Pulsante «Firma elettronica» del preliminare**: stesso difetto, ora l'esito riporta i link di ogni firmatario da mandare a mano.
- **Codice via SMS spento** (scelta dell'utente: «tienilo lì ma non possiamo ancora usarlo»): resta nel codice, sulla pagina compare solo «Per mail»; si accende con `FIRMA_CODICE_SMS=1`. Gli SMS con il link di «Invia per la firma» non cambiano.
- **Da sapere**: le 3 richieste di prova di oggi sono pagate e restano «in firma»; annullarle dalla scheda. Le prove costano 0,49 l'una.
- Test: 23 in `richieste-firma.test.js` (link, SMS spento di default).

## 0.5.23 — Guida illustrata aggiornata e caselle della pagina di firma

- **Guida illustrata in PDF** (`docs/guida-utente/Guida-illustrata.pdf`): il capitolo Clienti ha ora «Far firmare i documenti al cliente» con le schermate vere (scheda Documenti, la mail che arriva al cliente, la pagina di firma da telefono con le due scelte), e «Spedire un messaggio (auguri)»; il capitolo Immobili parla di firma con i comproprietari. Le altre schermate restano quelle della 0.4.87 (da rifare in blocco, con i menu e le schede nuovi). Come si rifà: `docs/guida-utente/strumenti/LEGGIMI.md` (aggiunto `s-firma.mjs`).
- **Pagina di firma, correzione trovata scattando la schermata:** le caselle dei consensi e la scelta «Per mail / Per SMS» comparivano come quadrati e cerchi **pieni e scuri anche se non spuntati**, quindi non si capiva cosa il cliente stesse accettando (il tema scuro dell'app arrivava sui controlli nativi). Ora la pagina è sempre chiara e i controlli sono quelli normali, con il colore dell'agenzia.

## 0.5.22 — La guida d'uso di zucca racconta il flusso nuovo

La guida in app (pacchetto Mediazione immobiliare 26) descriveva ancora i documenti spediti uno per uno per mail e da allegare a mano: ora parla di «Invia per la firma» (clienti, immobili con i comproprietari, quote societarie), firma con codice o a mano e solleciti. Le parti ricavate dagli schemi (elenco dei documenti, azioni, stati) si aggiornano da sole. Aggiornati anche `docs/zucca/guida-all-uso.txt` e `docs/zucca/relazione-processi.txt`. **Non aggiornata**: `docs/guida-utente/Guida-illustrata.pdf` (PDF illustrato fatto a mano, da rifare con le schermate nuove).

## 0.5.21 — «Aggiorna» su Linode manda anche i pacchetti

Trovato dall'uso: dopo «Aggiorna» su zucca (tenant su Linode) i documenti erano ancora quelli di prima («Anagrafica + privacy», «Privacy + Incarico» e «Antiriciclaggio» come mail). Causa: l'aggiornamento di un tenant su Linode usciva prima del passo che manda i pacchetti di verticale aggiornati (sul NAS c'era, su Linode no); zucca era rimasta al pacchetto 23. Ora il passo c'è anche su Linode, dopo che il tenant risponde, con la stessa regola («best-effort»: se non riesce lo dice e riprova al prossimo aggiornamento). Per riallineare subito un tenant c'è già `POST /api/tenants/<slug>/pacchetti/sincronizza`. Non c'è un test automatico: il ramo Linode di `redeployTenant` non si lascia simulare facilmente; da verificare dal vivo.

## 0.5.20 — «Invia per la firma»: anche la strada a mano, dentro lo stesso riquadro

Nel riquadro «Far firmare al cliente», sotto il pulsante, c'è ora la sezione «Oppure a mano: scarichi il PDF, lo fai firmare e lo carichi tu» con una riga per ogni documento da firmare («Scarica PDF · Carica firmato»). Apre il pannello del documento già esistente (anteprima del testo, scarica il PDF, carica la foto o il PDF firmato, consensi): allegato, consensi e stato si aggiornano come per il link. Prima quella strada c'era, ma nascosta più in basso nell'elenco dei documenti.

## 0.5.19 — Prezzo degli SMS dalla console

Letto dalla console: SMS in Italia **0,049** a segmento da 160 caratteri (0,036 con un abbonamento); Spagna 0,039 (0,027); il codice monouso (OTP) costa come l'SMS normale; **registrare un mittente (alias) costa 0,30** una tantum; letture 0,001. Prima il registro contava 0,036 (il prezzo con abbonamento): ora 0,049, quindi la stima dei messaggi di massa e dell'SMS di «Invia per la firma» sale di conseguenza. Con un abbonamento si scrive il prezzo in Prezzi. Con questo il registro spese ha tutti i prezzi visibili nella console di OpenAPI.

## 0.5.18 — Risk: anche monitoraggi e controlli KYC singoli

Aggiunti al registro spese i prezzi che mancavano dalla pagina di Risk: PEP, sanzioni e notizie negative una per una (0,31 l'una, 0,0496 con abbonamento), monitoraggio continuo KYC (1,56; 0,25) e del credit score top (1,265; 0,828). Nessuno è usato da Platform: servono quando una funzione li chiederà.

## 0.5.17 — Prezzi di Risk: ora il registro conta il prezzo base

Letti dalla console, colonna «Prezzo base» (la colonna «Miglior prezzo» vale solo con un abbonamento): verifica del codice fiscale **0,045**, eventi negativi **0,45**, credit score società Start **0,19**, Advanced **0,51**, Top **1,10**, report persona 3,60, report patrimoniale 36,00, **PEP, sanzioni e notizie negative insieme 0,39**. **Cambia la stima:** prima il registro contava per verifica CF, Start e Advanced i prezzi con abbonamento (0,0081, 0,06, 0,15), quindi sottostimava; la conferma del costo prima di «Credit score società» ora mostra 0,51 invece di 0,15. Se hai un abbonamento si scrive il prezzo in Prezzi (resta valido). Aggiunti report azienda, eredi e patrimoniale top. Il test sui tempi del controllo dei servizi OpenAPI (che falliva con il computer sotto carico) ha ora un margine più largo: 4,5 secondi, contro più di dieci in sequenza.

## 0.5.16 — Prezzi delle visure camerali

Letti dalla console: visura **ordinaria** impresa individuale 2,90 (2,75 con abbonamento), società di persone 3,40 (2,97), società di capitale 4,90 (3,96); **storica** 3,90 (3,63), 4,40 (3,85), 5,90 (4,95); soci attivi 2,30; bilancio ottico 4,50 (2,95); certificato di iscrizione, anche con vigenza, 13,70; letture 0,001. Nel registro spese la visura camerale conta 4,90 (società di capitali, cautelativo) invece di «da scrivere»; aggiunti soci attivi, bilancio ottico e certificato. La suite `openapi-servizi.test.js` («i servizi si controllano tutti insieme», un test sui tempi) può fallire quando il computer è sotto carico durante l'intero giro dei test e passa da sola: instabile, non un difetto.

## 0.5.15 — Prezzi del Real Estate: la valutazione ha un costo noto

Letti dalla console: valutazione avanzata €/mq **3,00** (0,39 con abbonamento), semplice (start) 2,00 (0,26), valore di mercato (rm value) 4,00 (0,35), quotazioni OMI 0,02 (0,003; 1.440 gratis al giorno), annunci comparabili 0,12 (0,032; 30 gratis al mese), storico del valore al mq 0,12 (0,032). Nel registro spese la **valutazione di mercato** e gli **annunci comparabili** non sono più «da scrivere»: valgono 3,00 e 0,12, quindi la conferma del costo prima del pulsante «Valutazione» e il piano dei costi dei dati dimostrativi mostrano un importo vero. Test aggiornati. Con un abbonamento si scrive il prezzo in Prezzi.

## 0.5.14 — Prezzi della fatturazione elettronica di OpenAPI

Letti dalla console: fattura italiana emessa o ricevuta **0,049** (le emesse 0,0135 con un abbonamento), configurazione di un'azienda 1,00, punto vendita 9,00, importazione 0,049, scontrini 0,019, corrispettivi 0,013; Francia 0,27 e 0,09; Germania 0,09; altri paesi 0,09 e 0,001. Nel registro spese `sdi_fattura` passa da «da scrivere» a 0,049 e c'è `sdi_configurazione`. **Platform non usa l'SDI di OpenAPI**: le fatture delle provvigioni si emettono con Fatture in Cloud (decisione dell'8 novembre); i prezzi servono solo per confronto.

## 0.5.13 — Prezzi di eSignature e delle visure catastali dalla console di OpenAPI

Letti dalla console (11 novembre 2026): la **firma elettronica semplice costa 0,49 a richiesta** (0,09 con un abbonamento), non a firmatario, e non 0,14 come stimato prima: il pacchetto di «Invia per la firma» è UNA richiesta. Marca temporale facoltativa 0,15 (Platform non la chiede). Firma avanzata 1,20 (0,69), con prova di vita 1,38 (0,79), qualificata con OTP 0,025 (0,0065), automatica e sigillo 0,05 (0,013); certificati Namirial 29 e 137; letture e verifiche 0,001. Catasto: **visura immobile e visura soggetto 1,90** (visura immobile 0,39 con abbonamento), **monitoraggio 0,60** (prospetto catastale, ricerca persona, ricerca nazionale). Il registro spese conta ora 0,49 per ogni firma con codice partita; `docs/COSTI-OPENAPI.md` e l'esempio di spesa mensile sono aggiornati (da circa 170 a 230 € al mese + IVA con 26 richieste di firma).

## 0.5.12 — Prezzi del Catasto riletti dalla console di OpenAPI

Confrontati con la pagina Prezzi del Catasto: indirizzo 0,10, foglio e particella 0,30, estratto di mappa, elaborato planimetrico e dettaglio nota 6,90, elenco note 10,90 e ispezione nazionale 23,70 **erano già giusti**. Aggiunto: la **richiesta** (POST /richiesta, 0,30) e il **monitoraggio** (da scrivere); nei nomi dei servizi compare «0,08 con un abbonamento» per foglio, particella e richiesta (Platform conta il prezzo base, cautelativo). Le letture gratuite del Catasto costano in realtà **0,001** a richiesta (Platform le conta 0). **Da leggere ancora**: i prezzi di «visura catastale» e «monitoraggio», righe espandibili nella console.

## 0.5.11 — «Invia per la firma» anche per SMS e WhatsApp

- **SMS**: nella scheda Documenti, sopra il pulsante, la casella «Manda anche un SMS con il link» (compare solo se il mittente degli SMS è impostato e il servizio SMS di OpenAPI.it è attivo; mostra il prezzo se lo hai scritto in Prezzi). Parte un SMS a ogni firmatario che ha un cellulare valido nella scheda, breve e con il nome dell'agenzia («Agenzia: Mario, i documenti sono pronti da firmare (3 minuti). link»); chi non ha il cellulare lo si dice e la mail parte lo stesso. È un messaggio di servizio: non serve il consenso alle comunicazioni commerciali. La spesa va nel registro spese e il messaggio nel registro dei messaggi.
- **WhatsApp**, senza costi né API: un collegamento `wa.me` che apre la chat con il cliente e il messaggio già scritto («Buongiorno Mario, sono Giulia di Agenzia. Ti ho mandato per mail i documenti da firmare. Se preferisci, li firmi da qui: link»); lo invii tu dal tuo telefono. Compare come pulsante dopo l'invio e come «WhatsApp» su ogni riga in attesa (il link si ricostruisce dal token cifrato).
- Il saluto e il numero sono quelli del firmatario, non della scheda. Test: 23 in `richieste-firma.test.js`.

## 0.5.10 — Più firmatari: comproprietari, cedente e cessionario

«Invia per la firma» ora può mandare gli stessi documenti a **più persone**, ognuna con la sua mail, il suo link e il suo nome nel saluto (prima il saluto usava il nome della scheda: sull'immobile avrebbe detto «Buongiorno Villa»). Il documento dichiara chi firma con `recipients` (elenco di campi email del record o di un record collegato); nome e telefono si cercano accanto all'email (`proprietario.email` → `proprietario.nome`, `proprietario.telefono`; `email` → `nome`, `telefono`). Senza elenco valgono `recipient` e, in mancanza, il campo email del record. Gli indirizzi uguali si mandano una volta sola; se una mail non parte, quella richiesta si annulla e lo si dice, le altre restano.
- **Lo stato del record cambia solo quando hanno firmato tutti** (`on_signed_state`); ogni firmato si allega comunque, e l'avviso per l'agente dice chi manca («… ha firmato. Manca ancora: …»).
- La scheda del record mostra una riga per firmatario (stato, solleciti, Sollecita e Annulla per ognuno).
- **Pacchetto Mediazione immobiliare 25**: la Scheda di acquisizione va a proprietario e comproprietari (estensione `firma_comproprietari`), la Proposta di cessione quote a cedente e cessionario (`firma_cedente_cessionario`); si applicano solo se il documento non ha già un elenco e se il modulo ha le relazioni citate. Il Builder controlla i percorsi dei firmatari in pubblicazione.
- **Collaudo**: segnala un passaggio riservato a ruoli che non esistono (lo può eseguire solo l'amministratore); la suite `collaudo-tenant.test.js`, rossa da prima, ora passa. Tutte le 122 suite del tenant sono verdi.
- **Resta com'è**: il **preliminare** della trattativa, che non è un testo generato da Platform ma un PDF che carichi tu tra gli allegati: si firma con il pulsante «Firma elettronica» (venditore e acquirente ricevono link e codice direttamente da eSignature) e sblocca «Preliminare firmato».

## 0.5.9 — Firma con codice (eSignature) dentro «Invia per la firma»

Nella pagina di firma il cliente sceglie **come** firmare: **Firma con un codice** (se il servizio eSignature di OpenAPI.it è attivo sulla chiave del tenant) oppure **Stampa, firma e ricarica** (come prima). Con il codice: una sola richiesta a eSignature con **un solo PDF** che contiene tutti i documenti più una pagina «Firma», **un solo codice** (per mail, o per SMS al cellulare della scheda), **un solo firmato**. Quando eSignature segna la firma completa, Platform scarica il firmato e lo allega a ogni documento (stessa chiusura della firma a mano: consensi, data, versione, stato, avviso all'agente, conferma al cliente). Il server ricontrolla ogni 5 minuti e la pagina ogni 10 secondi; se la firma fallisce o viene annullata la richiesta torna disponibile. **Al massimo 2 tentativi** a pagamento per richiesta (chi ha il link non può far partire firme all'infinito); il costo si scrive nel registro spese (servizio `esignature_ses`, al prezzo che hai impostato in Prezzi). Se il servizio non è attivo, la scelta non compare e resta la stampa. Niente solleciti mentre la firma con codice è in corso. Codice: `lib/richieste-firma.js` (`avviaCodice`, `controllaCodice`), `lib/documento-pdf.js` (`creaPdfPacchetto`), `components/FirmaPage.jsx`. Test: 18 in `richieste-firma.test.js`, con eSignature simulata.

**Non provato dal vivo**: la chiamata vera a eSignature (formato della richiesta copiato dall'adattatore «Firma elettronica» già esistente, mai provato con il servizio vero). Provare con un cliente di prova e un proprio indirizzo; in ambiente di prova di OpenAPI i messaggi potrebbero non arrivare davvero. La posizione della firma (ultima pagina, in basso a sinistra) è quella predefinita dell'adattatore.

## 0.5.8 — Testata dei PDF più pulita

La testata di tutti i PDF (documenti da firmare, report di valutazione) non è più una fascia piena con sfumatura, riflesso e pillola: ora è un filetto del colore dell'agenzia in cima, a sinistra il logo (o il nome in serif) con indirizzo e P.IVA, a destra il tipo di documento in maiuscoletto con data e numero, e un filo sottile sotto. Fondo bianco. L'altezza resta la stessa, quindi il contenuto non si sposta. I documenti mandati con «Invia per la firma» portano un numero (`anno-numero della richiesta`, per esempio 2026-0148).

## 0.5.7 — «Invia per la firma» anche sull'immobile

La Scheda di acquisizione dell'immobile non diceva a chi andava, quindi «Invia per la firma» sull'immobile (che non ha un campo email) non avrebbe trovato un indirizzo. Ora il documento ha come destinatario `proprietario.email` (lo stesso di «Scheda immobile»); sui tenant che hanno già il documento lo imposta l'estensione `firma_scheda_destinatario` (solo se manca). Alla firma l'immobile passa da «Da valutare» a «In mandato», come già prima. Vale per il proprietario: i comproprietari non ricevono ancora il proprio link.

## 0.5.6 — «Invia per la firma»: un pacchetto, un link

Dal record, scheda **Documenti**, il pulsante **Invia per la firma** manda al cliente UNA mail (con la grafica dell'agenzia) con l'elenco dei documenti da firmare e un solo pulsante. Il link porta a una pagina pubblica (`/firma/<codice>`, senza account, pensata per il telefono) in tre passi: rivedi (si scaricano i PDF), firma e carica (la foto o il PDF firmato di ogni documento, più i consensi da spuntare), fatto.
- **Quando il cliente firma**, Platform: allega i firmati nel tipo giusto, scrive consensi, data della firma, versione e scadenza di conservazione sul record, passa allo stato previsto, mette un avviso per l'agente («… ha firmato») e manda al cliente la conferma. Tutto o niente: se qualcosa non va non resta nulla a metà e il cliente può riprovare.
- **Solleciti**: dopo 3 e dopo 7 giorni parte una mail gentile (stesso link), poi nulla; dopo 14 giorni il link scade e lo dice. Si può anche sollecitare o annullare a mano. Sulla scheda si vede lo stato (in attesa da quando, quanti solleciti, firmata, scaduta).
- **Sicurezza**: il testo dei documenti si «congela» all'invio (il cliente firma ciò che ha ricevuto); il destinatario lo decide il server dal record, mai la richiesta; il codice del link (32 byte casuali) nel database c'è solo come impronta SHA-256 (e cifrato, per poter rimandare lo stesso link nei solleciti); la pagina pubblica non mostra dati del cliente.
- **Documenti da firmare** = i `document_action` con `delivery: 'firma'` non archiviati. Nuova proprietà `archiviato` (il documento non compare più nelle liste ma resta nel modulo). Il destinatario è il `recipient` del documento, altrimenti il campo email del record.
- **Pacchetto Mediazione immobiliare 24**: «Anagrafica + privacy» diventa **Informativa privacy e incarico** (con il paragrafo dell'incarico), «Antiriciclaggio» diventa un documento da firmare (tipo `antiriciclaggio_firmato`), «Privacy + Incarico» è archiviato. Sui tenant che hanno già i documenti di prima l'estensione `firma_in_un_pacchetto` li aggiorna **solo se sono ancora com'erano**: ciò che l'agenzia ha cambiato dal Builder non si tocca. Il cambio di stato a «cliente verificato» resta manuale (la verifica dell'identità è dell'agente).
- Codice: `lib/richieste-firma.js`, `routes/firma.js`, `components/FirmaPage.jsx`, `pages/ModulePage/RichiestaFirma.jsx`; `records.js` ora espone `contestoDocumentoDa` e `registraFirmato` (la rotta «firmato» usa lo stesso motore). Test: `richieste-firma.test.js` (12), `pacchetto-firma-in-uno.test.js` (4).

**Non provato dal vivo**: l'invio con la posta vera (provato con posta simulata), la pagina a schermo da telefono, l'aggiornamento di zucca. La firma elettronica con codice (fase 2) non c'è ancora: il cliente firma a mano o con un'app e carica il file.

## 0.5.5 — Una grafica unica per le mail ai clienti

Tutte le mail che un tenant manda ai suoi clienti (documenti da modello, solleciti di pagamento, auguri, messaggi di massa, prova della posta) escono ora con la stessa grafica: fascia con logo e colore dell'agenzia (da Impostazioni → Aspetto, gli stessi dei PDF), titolo in serif, testo in paragrafi, un solo pulsante, firma di chi scrive e piè di pagina con indirizzo e P.IVA. Prima erano testo semplice. Il logo si usa solo se è un indirizzo https (le immagini incorporate le bloccano Gmail e Outlook), altrimenti l'iniziale; il testo sopra il colore dell'agenzia passa da bianco a scuro se il colore è chiaro. Codice: `lib/email-grafica.js`; `email.htmlDaTesto(testo, opzioni)` resta la porta d'ingresso (opzioni: titolo, pulsante, nota, elenco, firmaDa, piede), quindi nessun chiamante cambia. Test: `email-grafica.test.js`.

**Da sapere.** La suite `collaudo-tenant.test.js` («un passaggio che nessuno può eseguire viene segnalato») risulta rossa anche su `main` prima di questa modifica: non l'ho toccata, è da guardare a parte.

## 0.5.4 — Menu Backup non più tagliato

Il menu «⋯» della scheda Backup si apriva sopra la scheda del tenant, che ne tagliava il fondo (da telefono si vedevano solo due voci). Ora il menu sta nel flusso della pagina, sotto la riga del titolo.

## 0.5.3 — Scheda Backup più semplice

La scheda Backup mostra **una frase di stato** («Tutto in ordine» oppure la prima cosa che non va), l'ultimo backup e con cosa è protetto il tenant. Un solo pulsante in evidenza, «Backup ora»; tutto il resto sta nel menu «⋯» (Copie salvate, Copia fuori dal NAS, Disco del server, Copia via mail), che apre **una sezione alla volta**. Prima i tre livelli, la tabella, la mail e l'off-site stavano tutti aperti insieme. Nessun cambiamento nel backend.

## 0.5.2 — Backup in tre livelli, tutto da Super Admin

Tenant → Dettagli → Backup ha in cima una **scheda unica** con i tre livelli e la data dell'ultima copia riuscita di ciascuno.

1. **Copie di Platform**: database **e allegati** (prima gli allegati non erano in nessun backup; per i tenant su Linode erano solo sul loro server). L'archivio `.allegati.tar.gz` sta accanto al database, viene copiato anche fuori dal NAS e si scarica da «Allegati». Oltre 2 GB non si archivia da solo (errore visibile). Un errore sugli allegati non fa fallire il backup del database. **Ripristina** chiede se rimettere anche gli allegati (sovrascrive i file con lo stesso nome, non cancella gli altri). Conservazione: ultimi N giornalieri (come prima) + la più recente di 4 settimane + la più recente di 6 mesi.
2. **Copia fuori dal NAS**: invariata, più la **prova di ripristino mensile** (ogni tenant: l'ultimo backup si apre davvero e l'archivio allegati si legge per intero; esito negativo = mail).
3. **Backup del disco su Linode** (solo tenant su Linode): elenco delle copie con data e stato e **«Ripristina il server a questa copia»**. Chiede di scrivere il nome del tenant; fa prima una copia di sicurezza di Platform (se non riesce non tocca nulla), spegne il server, ripristina con sovrascrittura, lo riaccende; il popup segue le fasi. Un ripristino per volta per tenant.

**Avviso di backup mancante**: se un tenant con backup automatico acceso non ha un backup riuscito da più di 36 ore arriva una mail (al massimo una al giorno per tenant).

**Non provato dal vivo**: il ripristino del disco Linode (provato solo contro Linode simulato: spegni → restore con overwrite → boot), il backup degli allegati su un tenant Linode vero e la prova di ripristino mensile. Provare il ripristino su un server di prova, mai su Finance o zucca.

## 0.5.1 — Server orfani su Linode

«Controlla Linode» (Impostazioni → Server) segna come **ORFANO** un server creato da Platform (etichetta `tenant-…` o tag `platform`) che nessun tenant usa e che ha almeno 15 minuti (uno appena creato non ha ancora il suo tenant). Sotto l'elenco compare un avviso per ogni orfano, con il costo mensile e «Elimina questo server» (con conferma). Il backend rilegge Linode prima di cancellare e rifiuta (409) tutto ciò che non è orfano in quel momento; i server fatti a mano non si toccano mai. Test in `cloud.test.js`. **Non ancora provato** contro Linode vero (solo simulato).

## 0.5.0 — Un server per tenant, spostare un tenant, un'interfaccia unica da telefono

La 0.5 chiude la fase «dal NAS al server per tenant» e la riorganizzazione dell'interfaccia. Dalla 0.4.88 (generatore di moduli e collaudo) a qui:

**Server per tenant (0.4.103–0.4.122).** Super Admin resta sul NAS; ogni tenant in produzione vive su un suo server Linode. Si sceglie dove nasce un tenant (NAS = staging, Linode = produzione) e si può **spostare** dal NAS a Linode con un pulsante, con rete di ritorno sul NAS. Da Super Admin, su un tenant Linode, funzionano: creazione (in background, con le fasi vere), aggiornamento, backup, ripristino, reset credenziali, sessioni e statistiche, Libreria, esportazione, cancellazione sicura (prima la copia). Un solo collegamento a Cloudflare. Collaudato dal vivo: creazione, aggiornamento, backup, ripristino, cancellazione, spostamento (con gli allegati) e il ritorno automatico dopo un fallimento. **Finance e zucca sono spostati e in uso su Linode.**

**Interfaccia (0.4.124–0.4.133).** Dettaglio dei record a schede (Dati, Azioni, Documenti) con il costo di ogni azione visibile prima di premere; un solo pulsante in evidenza per schermata e il resto in un menu con icona, nome e spiegazione (`VoceMenu`), in liste, utenti, Builder, Libreria e Analisi, sia nei tenant sia in Super Admin. Selettori data da iPhone dentro lo schermo. Corretta la «pagina bianca» cambiando utente (un gancio React dopo il return del login).

**Altro.** Rimossa la PEC (pacchetto 22) e le icone distinte di Verifica e Credit score (pacchetto 23). Corretti: allegati a 0 byte via SSH, risposte grandi lette a metà via SSH, reconciliatore che segnalava «container mancante» sui tenant Linode, cancellazione che lasciava il container fermo sul NAS.

**Da sapere.** L'immagine del core dei tenant Linode viene dal NAS: per portarli all'ultima versione si aggiorna prima un tenant del NAS. Dopo uno spostamento la copia sul NAS resta ferma: non cancellare il tenant da Super Admin finché non sei tranquillo (si toglie anche quella). Un'azione già presente in un tenant non viene riscritta da un nuovo pacchetto (le icone di zucca sono state corrette a mano, con copia di sicurezza).

**Da verificare / non ancora.** Una esportazione completa di un tenant Linode verso un server esterno (provate le due parti che dipendevano dal NAS); la barra delle fasi della creazione dal pulsante vero (la creazione di `collaudo` dal pulsante è riuscita, la barra non è stata osservata); l'avvio dell'app da telefono (circa 4 secondi di schermo nero, non misurato); un pulsante per togliere solo la copia ferma sul NAS; un avviso di «server orfano» in «Controlla Linode».

## 0.4.133 — Super Admin: Analisi, Utenti e Libreria con lo stesso schema

Analisi: dopo la creazione del tenant, «Invita il cliente», «Genera una nuova password» e «Riprova la configurazione» sono un elenco di azioni con icona e spiegazione (prima tre link di testo sparsi). Utenti di Super Admin: Abilita/Disabilita, Resetta password, Disattiva 2FA ed Elimina stanno nel menu «⋯» (Elimina separata, in rosso). Libreria: «Moduli generici» e «Moduli di default» nel menu «⋯», resta in evidenza «Salva un modulo». Tutto con il componente condiviso VoceMenu.

## 0.4.132 — Builder: barra del modulo più ordinata; VoceMenu condiviso

Nella barra del modulo del Builder (anche in Super Admin) Anteprima è un'icona con stato, Valida resta con il numero di problemi, e Cronologia ed Esporta stanno nel menu «⋯» con la loro spiegazione. Bozza e Pubblica restano come prima. VoceMenu è ora un componente condiviso (shared/frontend/VoceMenu.jsx) con un ponte in core e in Super Admin.

## 0.4.131 — Utenti: azioni nel menu «⋯»

Nella riga di ogni utente «Disabilita/Abilita» e «Reimposta password» (due link di testo) stanno ora nel menu «⋯», con icona e spiegazione. In vista restano lo stato e le due scelte che dicono un numero: Widget e Moduli visibili. Il menu si apre sotto la riga, dentro lo schermo da telefono.

## 0.4.130 — Liste dei moduli: un solo pulsante in evidenza e un menu «⋯»

In cima a ogni lista di record c'erano fino a dieci pulsanti con testo (Importa da PDF, Busta paga, CSV, Sincronizza Drive, Carica file, Messaggio, Importa, Report, Calendario, Cerca da fonte esterna, Nuovo). Ora: «Nuovo» in evidenza, Report e Calendario come icone con stato, e tutto il resto nel menu «⋯», una riga per voce con icona, nome e spiegazione (componente VoceMenu, usato anche altrove). Il menu resta montato da chiuso, così le finestre di importazione non spariscono. Da telefono sta dentro lo schermo.

## 0.4.129 — Menu del tenant dentro lo schermo

Da telefono il menu «⋯» della riga tenant usciva a sinistra dello schermo (ancorato al tasto, che non sta a destra). Ora si apre sotto la riga, largo come la card su telefono e di 20 rem su schermo largo.

## 0.4.128 — Super Admin, lista dei tenant: Apri, Dettagli e un menu «⋯»

Nella riga di ogni tenant restano in vista solo Apri e Dettagli. Aggiorna, Sposta su Linode, Ferma/Avvia ed Elimina stanno nel menu «⋯», ognuna con la sua riga di spiegazione (cosa fa, quanto costa, cosa succede); Elimina è separata e in rosso. Il menu si chiude toccando fuori.

## 0.4.127 — Dettaglio a tre schede: Dati, Azioni, Documenti

Il dettaglio di ogni record ha, se il modulo lo prevede, tre schede. «Dati» è la scheda di sempre. «Azioni» elenca le azioni esterne con icona, nome, la loro spiegazione e un'etichetta: «a pagamento · circa X €» (costo di listino, nessuna richiesta al servizio), «da attivare» o «non collegato», quindi si sa il costo PRIMA di premere. «Documenti» elenca i documenti da preparare. In alto: matita per Modifica e «⋯» con Elimina, lontano dai tasti di uso comune. Un modulo senza azioni né documenti non mostra le schede. Nessun campo nuovo da compilare: legge quello che lo schema già dichiara (nome, icona, descrizione). Pacchetto mediazione immobiliare 23: «Verifica del soggetto» e «Credit score società» hanno icone diverse (prima due lenti uguali). `/api/records/:slug/azioni-stato` dice anche `a_pagamento` e `costo`.

## 0.4.126 — Uscendo non si svuota più la pagina

Causa vera della «pagina bianca» cambiando utente (vista in una registrazione dello schermo): in App.jsx un useEffect del giro guidato stava dopo il return del login. Uscendo, React vedeva meno ganci di prima, andava in errore («Rendered fewer hooks than expected») e svuotava l'intera pagina fino al ricaricamento. Il gancio ora sta prima del return; un test controlla che non ci siano ganci dopo. La correzione 0.4.123 (pagina corrente azzerata) resta, ma non bastava.

## 0.4.125 — Dettaglio record: barra in basso con etichette

Le azioni del dettaglio (Clienti, Immobili e ogni altro modulo) stanno ora in una barra fissa in basso: icona sopra, nome sotto, massimo 4 voci. Modifica c'è sempre; se le altre non stanno, l'ultima voce è «Altro» con il resto (anche le azioni «da attivare»). «Documenti» apre l'elenco dei documenti. In alto accanto alla X c'è «⋯» con Elimina, lontano dai tasti di uso comune. Nuova icona «more» nella mappa.

## 0.4.124 — Dettaglio più pulito, selettore data da mobile, query grandi su Linode

Nel dettaglio di un record le azioni non sono più una fila di pulsanti con testo che andava su quattro righe: sono icone (Azioni, Documenti, Modifica, Elimina) con il nome al tocco/sopra; le azioni esterne stanno in un solo menu «Azioni» con nome e spiegazione, oppure un solo pulsante se ce n'è una. I selettori data/ora da iPhone restano dentro lo schermo e hanno la stessa altezza degli altri campi. Per i tenant su Linode, una query con risposta grande (lo schema di un modulo, oltre 20 KB) si leggeva a metà: ora si legge intera (toccava la Libreria: esporta, salva, dove è usato).

## 0.4.123 — Cambio utente: niente più pagina bianca

Uscendo (o entrando) la pagina aperta restava quella dell'utente di prima: un admin su «Builder» o «Impostazioni» lasciava la pagina bianca a chi entrava dopo senza quei permessi. Ora a ogni uscita e a ogni accesso si riparte dalla Dashboard. Va portato sui tenant con «Aggiorna» (l'immagine del programma si ricostruisce da un tenant sul NAS).

## 0.4.122 — Cancellare un tenant spostato toglie anche il container fermo sul NAS

Dopo «Sposta su Linode» il tenant resta sul NAS come container fermo. Cancellando il tenant, ora si toglie anche quel container (prima restava orfano; la cartella dati veniva già tolta).

## 0.4.121 — Allegati nello spostamento e nell'esportazione

La prova generale dello spostamento ha trovato un difetto: gli allegati, letti dal NAS con tar, arrivavano al server con 0 byte (il flusso si agganciava alla connessione SSH troppo tardi). Ora si incanalano subito in un flusso proprio. Valeva anche per l'esportazione verso un server esterno. In quella prova il rimedio ha funzionato: dopo l'errore il tenant si è riacceso sul NAS, l'indirizzo è tornato e il server nuovo è stato cancellato.

## 0.4.120 — Sposta su Linode

Nella riga di ogni tenant sul NAS c'è «Sposta su Linode»: copia di sicurezza, nasce il server e si prepara tutto senza toccare il tenant; solo allora il tenant si ferma sul NAS (3-5 minuti di stop), database e allegati vanno sul server, il tenant parte là, l'indirizzo passa al nuovo server (senza proxy il tempo del certificato, poi con). Se qualcosa non va dopo lo stop: server nuovo cancellato, indirizzo e tenant tornano sul NAS, che non è mai stato modificato. A fine lavoro il tenant sul NAS resta fermo con tutti i suoi dati: lo cancella una persona. Lo spostamento in corso ha lo stato «moving», fuori dai controlli automatici; i tenant su Linode non vengono più controllati dal riconciliatore dei container del NAS (segnalava a torto «container mancante» ogni 15 minuti).

## 0.4.119 — Esportazione di un tenant su Linode

L'esportazione verso un server esterno ora funziona anche per un tenant che vive su Linode: il database si copia in modo consistente dal suo server (come i backup) e gli allegati arrivano in streaming dal suo server, invece di leggere file sul NAS.

## 0.4.118 — Libreria: vede anche i moduli dei tenant su Linode

Elenco moduli di un tenant, esportazione, «salva nella Libreria» e «dove è usato» ora leggono il database del tenant ovunque viva: sul NAS dal file, su Linode con una query dentro il container sul suo server.

## 0.4.117 — Tenant su Linode: sessioni e statistiche

Sessioni (elenco, «attivo ora» nella lista, revoca) e statistiche (stato, CPU, memoria, rete, dimensione del database) ora funzionano anche per i tenant su Linode: la query gira dentro il container sul suo server (valori su stdin, mai nel comando). «Attivo ora» è in cache 20 secondi. Lo spazio totale in Analytics conta, per Linode, la dimensione dell'ultimo backup riuscito. Non ancora: la Libreria che legge i moduli dai database dei tenant salta quelli su Linode.

## 0.4.116 — Tenant su Linode: ripristino da backup, reset password, dove vive

Da Super Admin ora un tenant su Linode si ripristina da un suo backup: prima la copia di sicurezza dello stato attuale (se non riesce non si tocca niente), poi il backup viaggia sul server e si controlla (dimensione, integrità, utenti) mentre il tenant gira; solo dopo si ferma, il database attuale resta accanto con la data, si mette quello del backup e si riaccende. Se non riparte si rimette il database di prima. «Reset credenziali» funziona anche su Linode (la password non compare in nessun comando). Nella lista ogni tenant dice se è sul NAS o su Linode con il suo IP.

## 0.4.115 — Server Linode dei tenant: nome `tenant-<slug>` (davvero)

La 0.4.114 diceva di aver cambiato l'etichetta dei server in `tenant-<slug>`, ma la modifica non era entrata nel codice. Ora sì. I server già creati con `plt-<slug>` restano com'erano: il collegamento al server passa dall'id Linode, non dal nome.

## 0.4.114 — Server Linode dei tenant: nome `tenant-<slug>`

Un tenant chiamato «test» si scontrava con la macchina `plt-test` (etichetta già usata su Linode). I server dei tenant ora si chiamano `tenant-<slug>`.

## 0.4.113 — «staging» al posto di «prova»

Nella scelta di dove creare un tenant, il NAS ora si chiama «staging».

## 0.4.112 — Creazione su Linode: la schermata segue la fase vera

La creazione di un tenant su Linode dura minuti: la richiesta si interrompeva e la barra restava ferma al 96%. Ora Super Admin risponde subito «preso in carico», la schermata guarda lo stato vero del tenant (fase, esito, errore) e al termine mostra le credenziali iniziali, leggibili una sola volta (30 minuti in memoria). Corretto anche il bottone che restava bloccato se si annullava la conferma del costo.

## 0.4.111 — Tenant su Linode: funziona dietro Cloudflare (porta 4000)

Il terzo collaudo ha trovato la causa del 521: la zona Cloudflare porta il traffico dei tenant sulla porta 4000 (non 443). Il server ora risponde su entrambe, con lo stesso certificato. Primo tenant su Linode vivo dietro Cloudflare.

## 0.4.110 — Tenant su Linode: Redis sul server

Il secondo collaudo ha mostrato che il certificato ora si ottiene, ma il tenant non partiva: in produzione il core pretende Redis. Ogni server Linode ora ha un suo Redis piccolo su una rete interna (mai esposto fuori) e il tenant lo usa.

## 0.4.109 — Tenant su Linode: il certificato si prende prima, poi si accende Cloudflare

Dal collaudo: Let's Encrypt riceveva 403 passando dal proxy Cloudflare, quindi Caddy non otteneva il certificato. Ora l'indirizzo del tenant nasce senza proxy (solo DNS), il server ottiene il certificato dritto da Let's Encrypt e solo dopo Super Admin accende il proxy. La diagnosi dal server mostra prima il log del tenant.

## 0.4.108 — Tenant su Linode: se non risponde, l'errore dice perché

Il primo collaudo reale è fallito: server creato, ma il tenant non rispondeva da fuori e il server veniva cancellato senza lasciare tracce. Ora, prima di cancellare, Super Admin legge dal server stesso (solo letture) lo stato del container, di Caddy, del certificato e del log, e lo aggiunge al messaggio d'errore.

## 0.4.107 — 10 novembre 2026

**Un tenant può nascere (e vivere) su un suo server Linode.** Nel modulo «Nuovo tenant» e nella creazione dall'analisi c'è la scelta **Dove crearlo**: **NAS (prova, gratis)** di partenza, oppure **Linode (produzione)**, che crea un Nanode (5 $ + 2 $ di backup al mese) con la conferma del costo.
- **Cosa fa su Linode** (`lib/server-remoto.js`): crea il server con l'API (chiave SSH di Super Admin, mai password), ci installa Docker e Caddy, ci porta l'immagine del programma dal NAS, avvia il container con i segreti del tenant, mette Caddy davanti (HTTPS vero, Cloudflare in Full strict), crea il record DNS verso l'IP del server. **Se un passo fallisce cancella il server appena creato** (non resta a costare). **Freno alla spesa:** non crea più di 5 server (si alza da `cloud_settings.max_server`).
- **Gestione a distanza:** avvia, ferma e Aggiorna (immagine nuova + stesso container e stessi dati) funzionano anche per un tenant su Linode; i backup scaricano una copia consistente del database dal server (`VACUUM INTO` nel container, poi SSH, dimensione controllata) e passano dallo stesso motore di prima (retention, copia off-site).
- **Cancellare un tenant su Linode** fa prima la copia di sicurezza; **se la copia non riesce il server NON si cancella** (sul NAS invece un database rotto non blocca).
- **Un solo punto per raggiungere i tenant:** `lib/tenant-host.js` (NAS: dentro Docker; Linode: il suo dominio). Sostituisce 7 indirizzi scritti a mano. Nuove colonne `host`, `remote_ip`, `linode_id`, `remote_fingerprint` (i tenant esistenti restano `nas`).
- **NON ancora disponibile per un tenant su Linode** (risponde 501 o mostra vuoto, mai un errore silenzioso): ripristino da backup, reset credenziali, e le viste di Super Admin che leggono il database del tenant dal disco (sessioni, statistiche di spazio, lettura moduli per il registro). Si portano con la copia periodica del database; per ora non ci sono.
- **Non verificato:** mai creato un server vero (tutto provato con Linode, SSH e Cloudflare simulati); non so se il pacchetto `caddy` e l'immagine `linode/ubuntu24.04` funzionano come previsto a Milano; il certificato HTTPS dietro Cloudflare va visto dal vivo. Il primo collaudo si fa su un tenant di prova, da cancellare. Prove: `server-remoto.test.js` (10), regressione su provisioning, redeploy, restore, export, backup, cloudflare.

## 0.4.106 — 10 novembre 2026

**Cloudflare: niente più doppione, vive tutto in Impostazioni.** Token (cifrato), ID della zona, dominio dei tenant e **indirizzo pubblico del NAS** (nuovo campo) stanno nel database di Super Admin e si cambiano da Impostazioni → Server. Le vecchie variabili d'ambiente (`CLOUDFLARE_*`) non si leggono più a ogni richiesta: all'avvio ogni voce ancora vuota si copia da lì UNA volta (il token cifrato) e poi l'ambiente si può svuotare senza effetti. Sostituisce la regola della 0.4.105 «salvato, altrimenti ambiente». Test: `cloud` (copia unica, nessuna sovrascrittura), `security-status`, `tenant-provisioning`.

## 0.4.105 — 10 novembre 2026

**Un solo collegamento a Cloudflare.** Super Admin aveva già un token nell'ambiente del backend (`CLOUDFLARE_API_TOKEN`, `_ZONE_ID`, `_ZONE_NAME`) per creare e togliere l'indirizzo di ogni tenant; la 0.4.104 ne aveva aggiunto un secondo, da Impostazioni. Ora è uno solo: il token salvato in Impostazioni vince, in sua assenza vale quello dell'ambiente, e `cloudflare.js` (indirizzi dei tenant) e «Controlla Cloudflare» usano la stessa fonte. Il controllo dice da dove viene il token (`salvato` o `ambiente`). Nessun cambio per i tenant esistenti. Test: `cloud`, `security-status`, `tenant-provisioning`.

## 0.4.104 — 10 novembre 2026

**Super Admin si collega anche a Cloudflare (solo token e controllo).** In Impostazioni → Server (Linode), sotto Linode: token API di Cloudflare (cifrato, mai restituito), ID della zona e dominio dei tenant (`platform-core.it`). «Controlla Cloudflare» fa **solo letture**: verifica il token, la zona, elenca i record DNS e legge la modalità SSL (deve essere Full strict; se manca il permesso lo dice e non blocca). Il token giusto ha un solo permesso, *Zona → DNS → Modifica*, limitato alla zona. I record non si creano ancora: arriveranno col driver dei server. Rotte `/api/cloud/cloudflare/*`, `lib/cloudflare.js`, prove in `cloud.test.js` (Cloudflare simulato). **Non verificato:** nessuna chiamata a Cloudflare vera. Serve ridistribuire Super Admin.

## 0.4.103 — 10 novembre 2026

**Super Admin si collega a Linode (primo passo: solo token e controllo).** Nuova sezione Impostazioni → **Server (Linode)**: il token personale si incolla lì, viene controllato con Linode e conservato cifrato (si vedono solo le ultime 4 cifre); regione (predefinita Milano, `it-mil`) e tipo di macchina (Nanode 1 GB, `g6-nanode-1`) sono dati modificabili. «Controlla Linode» fa **solo letture**: conferma il token, mostra saldo, prezzo e RAM della macchina scelta, e i server già presenti. Non crea e non costa nulla. Il saldo è facoltativo (serve il permesso «Account» in sola lettura). Rotte `/api/cloud/*`, codice `lib/linode.js`, prova `cloud.test.js` (Linode simulato). **Non verificato:** nessuna chiamata a Linode vera. Seguirà il driver che crea e cancella i Nanodi, con riepilogo del costo. Serve ridistribuire Super Admin.

## 0.4.102 — 10 novembre 2026

**«Controlla i servizi» elenca anche gli SMS (SMS v2 di OpenAPI.it).** Prova la lettura gratuita dei mittenti (`GET /senders`): serve a sapere se il servizio è attivo sul conto prima di costruire l'invio. Nessun SMS parte ancora. Non verificato: l'esito reale sul conto di zucca.

## 0.4.101 — 10 novembre 2026

**Tolta la PEC da zucca.** Non serve e il servizio non è attivo sul conto: via il pulsante «Invia via PEC» dal pacchetto (versione 22), l'adattatore `invio_pec`, i campi della casella PEC Massiva in Connessioni e il costo di listino. Le fatture elettroniche e la firma restano. Il pulsante già installato su zucca resta finché non lo si toglie dal Builder (Clienti → blocco «Invia via PEC»): il pacchetto non sa cancellare blocchi. Serve ridistribuire Super Admin e «Aggiorna».

## 0.4.100 — 9 novembre 2026

**«Verifica del soggetto» (Risk) mostra lo stato della richiesta presso OpenAPI.it.** Prima, finché il PDF non era scaricabile, il report risultava solo «non ancora pronto»: una richiesta fallita o ferma era indistinguibile da una in attesa. Ora l'adattatore legge lo stato (`GET /IT-report-persona/{id}`) e lo scrive nell'esito («stato presso OpenAPI.it: …»); se lo stato è di errore (fallita, rifiutata, non trovata…) lo dice con il motivo, il record passa a «fallita» e il pulsante non ricontrolla a vuoto: premendolo si fa una richiesta nuova, con conferma del costo. Test: `risk-collegati.test.js`. **Non verificato:** i nomi esatti degli stati di OpenAPI.it (il codice riconosce quelli di errore più comuni e mostra sempre lo stato grezzo, così il primo caso vero chiarisce); un report vero non è ancora stato scaricato. Serve «Aggiorna» su zucca.

## 0.4.99 — 9 novembre 2026

**L'amministratore può far avanzare un record anche quando il passaggio è riservato a un altro ruolo.** In zucca i passaggi di stato del cliente («Documenti inviati» ecc.) sono riservati al ruolo `operatore_front_office`: l'amministratore vedeva il pulsante ma la risposta era «Il tuo ruolo non può eseguire questa transizione». Ora l'amministratore passa sempre, come già avviene per i permessi dei moduli; gli altri ruoli restano limitati a quelli elencati. Vale per tutti i tenant. Test: `records-workflow.test.js`. Serve «Aggiorna» su zucca e Finance.

## 0.4.98 — 9 novembre 2026

**L'archivio pubblicato dal Builder classico torna a registrare le cartelle nuove di Drive.** Il poller di Drive scriveva in continuo «cartella "Ricevute" non registrata: Questo modulo non ha lo schema nel formato atteso»: la rotta delle cartelle (`field-options.js`) leggeva solo lo schema v3 (`steps[]`), mentre il Builder classico salva `fields[]` piatto (la forma di quasi tutti i moduli, già gestita da `option-lists.js`). Ora legge entrambe. Test: caso v2 in `field-options.test.js`. Non verificato online: serve «Aggiorna» su Finance (e zucca) e poi guardare che la riga nei log non compaia più e le cartelle appaiano in Archivio.

## 0.4.97 — 9 novembre 2026

**«Verifica del soggetto» (Risk) non resta più «da attivare» con Risk attivo.** Per capire se il servizio era abilitato l'adattatore chiedeva il token anche con uno scope che non usa mai (la verifica del codice fiscale, un altro prodotto): se l'account non lo ha, il token falliva e il pulsante rispondeva 501 «da attivare» anche con Risk attivo e «Controlla i servizi» tutto ✓. Ora chiede solo gli scope del report sulla persona. Test: `verifica-persona-scopi.test.js`. Non verificato: un report vero (ogni richiesta si paga). Serve «Aggiorna» su zucca e Finance.

## 0.4.96 — 9 novembre 2026

**Il Builder ha gli editor che mancavano e il generatore di moduli scrive anche i permessi.**
- **Azione esterna** (Builder, blocco «Azione esterna»): ora si modificano a mano nome e descrizione del pulsante, adattatore (menu dall'elenco chiuso del server, con costo e PDF), connessione richiesta, dove resta il risultato completo sul record, servizio richiesto e «come si attiva», le tipologie con il codice di riserva e i «Collegamenti dell'adattatore» (campi da mandare, esito, dati del cliente…) come JSON controllato prima di salvare. Prima si poteva solo cambiare il nome.
- **Relazione → «Eredita dal record collegato»:** coppie «mio campo ← campo del record collegato», che si compilano da sole se il tuo campo è vuoto.
- **Mappa → Paese (2 lettere):** restringe la ricerca dell'indirizzo.
- **Generatore di moduli (Analisi):** scrive il blocco **permessi** con una riga per ogni ruolo dell'analisi (chi lavora crea e modifica, chi controlla vede; «solo i miei» solo se la relazione indicata esiste). I ruoli non citati dal modello restano in sola lettura (e anche «user»), per non chiudere nessuno fuori. Nelle automazioni «aggiorna record» ora accetta anche **aumenta/diminuisci** un numero.
- Nuova rotta `GET /api/builder/azioni-esterne` (solo admin).
- **Non verificato:** gli editor non sono stati provati a mano nel browser (compilano e la rotta ha il suo test); il generatore con l'AI vera resta mai provato su un racconto reale. Serve ridistribuire Super Admin e fare Aggiorna sui tenant.

## 0.4.95 — 9 novembre 2026

**Analytics di Super Admin torna a registrare la foto giornaliera.** Sul database di produzione la tabella `metrics_snapshots` ha ancora la vecchia colonna obbligatoria `total_partners` (dei partner, rimossi), e ogni foto falliva con «NOT NULL constraint failed». Ora la foto riempie con 0 le colonne obbligatorie rimaste da versioni vecchie. Test: `analytics-snapshot.test.js`. Non verificato online: serve ridistribuire Super Admin (`bash scripts/redeploy-nas.sh backend`); le foto dei giorni persi non si recuperano.

## 0.4.94 — 9 novembre 2026

**«Controlla i servizi» non elenca più PEC Massiva e Visure camerali.** Nessuna funzione in uso li richiede e sul conto di zucca non sono attivi: restavano due ✗ che sembravano un problema. L'invio via PEC resta nel codice e funziona se un giorno si attiva PEC Massiva (si controlla al momento dell'invio); per rimetterli nell'elenco basta riaggiungere le due voci in `SERVIZI` (`lib/openapi-it.js`).

## 0.4.93 — 9 novembre 2026

**«Controlla i servizi»: Risk ed eSignature risultano attivi.** La prova elenca le richieste fatte; con zero richieste OpenAPI.it risponde 404 «no requests linked to this username», e prima veniva segnato «da verificare». Ora è «attivo, nessuna richiesta ancora». Non verificato: una richiesta vera a Risk o eSignature.

## 0.4.92 — 9 novembre 2026

**«Controlla i servizi» di OpenAPI.it: la prova delle Visure camerali usava un percorso sbagliato.** Dava «non abilitato» anche con il servizio attivo; ora prova la ricerca gratuita delle imprese (`/impresa`), la stessa che usa il resto di Platform. PEC Massiva resta «non abilitato» sul conto di zucca: lo scope (`POST ws.pecmassiva.com/send`) risulta corretto dalla documentazione, quindi il servizio va attivato nella console di openapi.com (attivazione a pagamento, poi costo per messaggio). Non verificato: l'esito reale dopo l'aggiornamento.

## 0.4.91 — 9 novembre 2026

**Le tre funzioni di zucca ancora «da attivare» ora hanno il loro collegamento: firma elettronica, PEC e fattura elettronica.** Ognuna resta tra «Altre funzioni» finché il servizio non è abilitato sulla chiave di OpenAPI.it (nessuna richiesta, nessun costo), poi passa tra i pulsanti normali. Arrivano a zucca con «Aggiorna» (pacchetto di settore alla versione 21).
- **Firma elettronica** (Trattative, eSignature): si carica il PDF del preliminare tra gli allegati con il tipo «Altro» e si preme il pulsante; a venditore e acquirente arrivano per email un link e un codice. Premendo di nuovo si ricontrolla (senza costo); a firma completata il documento firmato entra tra gli allegati come «Contratto preliminare» e sblocca «Preliminare firmato». Servono nome, cognome ed email dei due.
- **Invia via PEC** (Clienti, PEC Massiva): manda per posta certificata oggetto e testo di «Privacy + Incarico», già compilati, alla PEC del cliente. Serve la **casella PEC Massiva** (utente e password, nuovi campi facoltativi in Connessioni → OpenAPI.it: sigillati come la chiave, mai mostrati). 0,05 € a invio, con conferma.
- **Fattura elettronica** (Provvigioni, Fatturazione elettronica SDI): emette la fattura della provvigione (imponibile = importo netto, IVA 22%) in **FatturaPA 1.2**, la manda allo SDI e, premendo di nuovo, ricontrolla la consegna. **Prima di inviare mostra un riepilogo** (numero N/AAAA, cliente, imponibile, IVA, totale) nella conferma del costo, e avvisa che una fattura inviata non si ritira (solo nota di credito). Non si emette due volte; una fattura scartata dallo SDI mostra il motivo e si rimanda con lo stesso numero. Numerazione progressiva per anno, consumata solo se la fattura parte.
  - **Dati necessari**: ragione sociale, partita IVA e indirizzo dell'azienda (Impostazioni → Aspetto); CAP, comune, provincia, regime fiscale (predefinito RF01) e IBAN (Connessioni → OpenAPI.it, nuovi campi facoltativi); del cliente CAP e comune (nuovi campi «CAP», «Comune», «Provincia», «Codice destinatario SDI» in Clienti, sezione «Fatturazione»). Se manca qualcosa la fattura non parte e l'elenco dice cosa.
- **Controlla i servizi** (OpenAPI.it) ora elenca anche eSignature, Fatturazione elettronica e PEC Massiva.
- **Verificato**: l'XML della fattura **supera la validazione con lo schema ufficiale dell'Agenzia delle Entrate** (l'ho vendorizzato in `core/backend/src/xsd/` solo per la prova; la validazione ha trovato un difetto vero: lo schema accetta solo Basic Latin e Latin-1, trattini lunghi e € facevano scartare la fattura, ora normalizzati). Le tre funzioni sono provate con un servizio finto (firma: invio, attesa, scarico del firmato; PEC: invio e rifiuti; fattura: invio con creazione della configurazione, numerazione, nuovo controllo, scarto e rinvio).
- **NON verificato con il servizio vero**: nessuna delle tre è mai stata chiamata su OpenAPI.it (i percorsi e i campi vengono dalla loro documentazione pubblica, letta in parte). Il formato dei permessi del token (scope) di PEC Massiva, la posizione della firma sulla pagina (predefinita: pagina 1, in basso) e la creazione automatica della configurazione SDI sono ipotesi da confermare. **Provale prima in ambiente `sandbox`** (Connessioni → OpenAPI.it → Ambiente): in `produzione` una fattura inviata allo SDI è un atto fiscale vero. Se una dà errore, il messaggio è quello del servizio: copialo e si corregge.
- Codice: `lib/azioni-esterne/{firma_elettronica,invio_pec,fattura_elettronica,allegati}.js`, `lib/fatturapa.js`; prove `firma-elettronica`, `invio-pec`, `fattura-elettronica` (`.test.js`). La richiesta di conferma del costo accetta ora un **riepilogo** dell'adattatore (`riepilogo()`), mostrato come «Cosa parte».

## 0.4.90 — 9 novembre 2026

**«Controlla i servizi» di OpenAPI.it non si blocca più.** Segnalato dall'utente su zucca, dopo aver abilitato i servizi nella console di OpenAPI.it.
- Il controllo faceva i servizi **uno dopo l'altro**, ciascuno con due chiamate da 15 secondi di attesa massima: se OpenAPI.it era lento la somma superava i 100 secondi che Cloudflare concede e la pagina mostrava un errore. Ora i servizi si controllano **tutti insieme** (al massimo circa 30 secondi in totale); l'esito per servizio è identico.
- **Connessioni**: un servizio usato solo da un'azione esterna di un modulo (per esempio la valutazione di un immobile, che usa OpenAPI.it) ora compare nell'elenco anche se non è ancora collegato, come già i servizi richiesti dalle automazioni. Prima poteva non comparire e non si poteva collegare.
- Prove: due nuove in `openapi-servizi.test.js` (parallelo, con 500 ms a chiamata; comparsa in Connessioni).
- Se il controllo dà ancora errore, il messaggio sotto il pulsante dice il motivo (chiave non collegata, servizio non abilitato, nessuna risposta).

## 0.4.89 — 9 novembre 2026

**«Aggiorna» non dà più KO per un avvio lento, e un fallimento lascia traccia.** Segnalato dall'utente: la prima pressione dava KO, la seconda partiva. Causa più probabile (vista su Finance, dalla 0.4.37 alla 0.4.81): dopo un salto di versione il primo avvio del tenant fa le migrazioni del database e supera il minuto, mentre Super Admin aspettava al massimo 60 secondi.
- L'attesa del tenant sale da 60 secondi a **3 minuti**; dopo ~1 minuto il popup dice «il tenant sta ancora partendo (migrazioni…)» invece di restare muto.
- Un aggiornamento **fallito** o un tenant che **non risponde** ora si registrano nel registro attività (`tenant.redeploy_fallito`, `tenant.redeploy_non_risponde`) con il motivo: prima il motivo restava solo nel popup di chi premeva. Se il KO si ripete, il registro dice se era la build o l'avvio.
- Non risolto: se la causa vera è un errore di scarico/build (rete verso GitHub o npm), servirà un nuovo tentativo automatico della build; si deciderà leggendo il registro.

## 0.4.88 — 9 novembre 2026

**Il tenant nato dall'analisi si apre su una Dashboard già utile.** Prima, senza una configurazione scritta a mano, la Dashboard di un tenant nuovo era vuota.
- Alla creazione dall'analisi nasce una **Dashboard di base** scritta dai moduli: «**Da fare**» (scadenze di tutti i moduli), un **numero** per i primi tre moduli, il **percorso degli stati** dei moduli che hanno un flusso (fino a tre) e «**Da sistemare**» con le scadenze passate (ogni campo data con «scad» nel nome). Non tocca una Dashboard già fatta; poi si ritocca con «Modifica layout».
- Codice `lib/dashboard-base.js`, rotta interna `POST /api/internal-setup/dashboard`, prove `dashboard-base.test.js`.

## 0.4.87 — 9 novembre 2026

**L'analisi dei processi costruisce anche i moduli che la Libreria non ha, e consegna un tenant già verificato.** Prima ciò che la Libreria non copriva restava «da costruire» solo come nota; ora si può far scrivere all'AI e approvare.
- **Super Admin → Analisi → «Moduli da costruire»**: l'AI decide quali moduli nuovi servono (senza duplicare la Libreria) e scrive una bozza per ciascuno nel linguaggio del Builder: campi (con sezioni e dati chiave), relazioni, stati e passaggi, requisiti per stato, allegati, automazioni, documenti da modello, calendario. Ogni bozza si **ripulisce** (solo blocchi noti, chiavi valide, un solo stato iniziale) e si **controlla** con lo stesso controllo di «Controlla il tenant»; se ha problemi il modello li riceve e corregge, fino a 3 tentativi. Si lavora in background; la pagina mostra l'avanzamento.
- **Tu approvi**: le bozze senza problemi sono già approvate, quelle con problemi no (mostrano cosa non va). Si scartano, si rigenera. Alla creazione del tenant si installano solo le approvate.
- **Il tenant nasce con tutto**: moduli della Libreria, moduli generati approvati, ruoli, stati, report, e in più la **guida d'uso** scritta dai moduli, il **controllo di coerenza** e il **collaudo completo** in copia isolata (parte da solo). Nell'Analisi, sotto «Crea il tenant», «Quanto è operativo» mostra i due punteggi, i problemi e le cose da completare a mano; «Rilancia il collaudo».
- Rotte (Super Admin): `GET /api/analyses/:id/moduli`, `POST …/moduli/genera`, `PUT/DELETE …/moduli/:slug`, `GET …/operativo`, `POST …/operativo/collaudo`. Nel tenant (secret interno): `POST /api/internal-setup/guida`, `GET /verifica`, `POST/GET /collaudo`.
- Il controllo di coerenza vive ora in `shared/verifica-moduli.js` (funzione pura, usata da Super Admin sulle bozze e dal tenant sui moduli installati); `lib/verifica-tenant.js` lo applica ai moduli del database aggiungendo le formule.
- Nuovo manuale **`docs/NUOVO-PROGETTO.md`**: come avviare un progetto da zero con solo Platform, passo per passo.
- Prove: `generatore-moduli.test.js` (pulizia di blocchi ostili, correzione al secondo tentativo, stop a 3, piano senza doppioni, ordine di dipendenza) e 3 prove nuove in `analyses.test.js`.
- **Non verificato con un modello vero**: i prompt sono provati con un modello finto; la qualità delle bozze con la chiave AI di Super Admin va vista alla prima analisi reale.

## 0.4.86 — 9 novembre 2026

**Dati di esempio generati dallo schema.** In Impostazioni → Moduli, sotto «Controlla il tenant», il riquadro **Dati di esempio** carica qualche scheda inventata in ogni modulo (da 1 a 30 per modulo, di solito 5) per provare o mostrare un tenant appena costruito, senza inserire a mano decine di schede.
- Valori plausibili per tipo di campo (nomi e cognomi, città, importi, date vicine a oggi, scelte a rotazione, codici fiscali e partite IVA **validi e diversi tra loro**), schede **collegate** tra loro dalle relazioni (i record citati nascono prima di chi li cita) e **distribuite su tutti gli stati** del flusso.
- Si scrivono direttamente, **senza far partire automazioni, notifiche o mail**, e portano `_demo: true`: «Togli i dati di esempio» le cancella tutte insieme e non tocca i dati veri. Non si caricano due volte di fila.
- Rotte (solo amministratori): `GET/POST/DELETE /api/builder/dati-esempio`; codice `lib/dati-esempio.js`, prove `dati-esempio.test.js`.

## 0.4.85 — 9 novembre 2026

**La guida d'uso si scrive da sola dai moduli, dentro il tenant.** Prima guida, giro guidato e glossario esistevano solo come file di un pacchetto di settore: un tenant nuovo non li aveva.
- **Impostazioni → Guida** (nuova voce): «Genera dai moduli» scrive introduzione, passi per ruolo, **un capitolo per modulo** (a cosa serve, campi obbligatori e controllati, collegamenti con altri moduli, percorso degli stati, cosa serve per ogni passaggio, documenti, cosa fanno da sole le automazioni, allegati, calendario, mappa, abbinamenti), **un percorso per ogni flusso**, il **giro guidato** e il glossario degli stati. Si parte sempre dallo schema: la guida è allineata a ciò che l'app fa davvero. Poi si rifinisce a mano nella stessa pagina (testi, passi del giro, glossario) e si salva.
- Ciò che il tenant ha scritto **vince** sui testi dei pacchetti; i pacchetti completano il resto. «Togli la guida» riporta ai soli pacchetti.
- Il «?» accanto al titolo di ogni pagina, la pagina Guida e il giro guidato leggono questa guida senza altro da fare.
- Rotte (solo amministratori): `GET/PUT/DELETE /api/guida/tenant`, `POST /api/guida/genera` (con `{ solo_se_vuota: true }` non tocca una guida già scritta: serve alla creazione automatica di un tenant). Codice in `lib/guida-generata.js`, tabella `guida_tenant`, prove in `guida-generata.test.js`.
- Nessuna AI e nessun nome di settore: la bozza è deterministica; l'AI potrà rifinire i testi in un secondo momento.

## 0.4.84 — 9 novembre 2026

**Collaudo completo: i flussi si provano per davvero, in una copia isolata.** In Impostazioni → Moduli, accanto a «Controlla», il pulsante **Collaudo completo** (circa un minuto) fa ciò che il controllo statico non può:
- **Copia isolata**: copia il database in una cartella temporanea, vi toglie ogni credenziale (collegamenti, webhook, chat), avvia una seconda istanza dello stesso codice con i lavori programmati spenti (`COLLAUDO=1`) e un utente amministratore usa-e-getta. Nulla parte verso l'esterno e i dati veri non si toccano; a fine prova la copia si spegne e si cancella.
- **Cosa prova**: per ogni modulo crea un record di prova (valori plausibili per tipo di campo, relazioni risolte creando prima i record collegati), lo legge, lo modifica, genera l'anteprima di ogni documento (segnaposto sostituiti), calcola gli abbinamenti e **percorre tutti gli stati raggiungibili** del flusso: prima verifica che un requisito bloccante blocchi davvero, poi lo soddisfa (campi, relazioni, allegati) e fa il passaggio. Controlla che le automazioni che creano record li abbiano creati, e mostra **cosa hanno prodotto**.
- I campi che compila il sistema (scritti da automazioni o dalle azioni esterne) non si riempiono nei dati di prova, altrimenti le condizioni «una volta sola» non scatterebbero mai.
- Rotte `POST/GET /api/builder/collaudo` (solo amministratori, parte in background e si legge l'esito); codice in `lib/collaudo-tenant.js`, prove in `collaudo-tenant.test.js`.
- Risultato sulla copia di zucca in locale: **100/100** (71 prove, due provvigioni create alla firma del preliminare).

## 0.4.83 — 9 novembre 2026

**«Controlla il tenant»: quanto è operativo uno spazio di lavoro.** In Impostazioni → Moduli un pulsante legge gli schemi di tutti i moduli installati e dice quanti riferimenti stanno in piedi, con un punteggio su 100. Sola lettura: non crea né cambia nulla.
- Controlla **flussi** (stato iniziale unico, passaggi verso stati esistenti, ogni stato raggiungibile), **requisiti per stato** (campi e tipi di allegato che esistono davvero), **relazioni** (modulo e campo mostrato), **automazioni** (stato, campi e moduli citati), **documenti** (segnaposto e destinatario), **viste** (calendario, mappa, abbinamento), **ruoli e permessi** e **calcoli**.
- Ogni problema dice in italiano quale modulo e quale blocco, e cosa non esiste. Ciò che può mettere solo una persona (servizi esterni da collegare) sta in un elenco «Da completare a mano» e non toglie punti.
- Rotta `GET /api/builder/verifica` (solo amministratori); codice in `lib/verifica-tenant.js`, prove in `verifica-tenant.test.js`. Serve da misura per l'analisi dei processi (vedi `docs/zucca-da-zero/RELAZIONE.md`).
- Primo risultato sulla copia di zucca in locale: 99/100, con due difetti veri trovati (la mappa di Immobili cita un campo `numero_civico` che non esiste; il requisito «Scheda di acquisizione firmata» chiede un allegato che nessun documento produce in quella copia).
- **Corretto**: nell'elenco di Impostazioni → Moduli compariva uno «0» dopo il nome di ogni modulo (il campo `menu_nascosto` a 0 veniva stampato).

## 0.4.82 — 9 novembre 2026

**Impostazioni più ordinate.**
- Nel menu, il gruppo «Integrazioni» (che mescolava servizi esterni, messaggi ai clienti e report) è diviso in **Collegamenti** (Connessioni) e **Comunicazioni** (Messaggi ai clienti, Report).
- Dentro **Connessioni** le schede stanno in quattro blocchi con titolo e una riga di spiegazione: **Posta in uscita**, **Dati e servizi** (OpenAPI.it, Google), **Messaggistica** (Telegram, WhatsApp, Slack), **Altro** (Stripe, Mailchimp, Fatture in Cloud). Un blocco senza schede visibili non compare.
- Ogni voce del catalogo ha un `gruppo`; l'ordine dei blocchi è fisso.

## 0.4.81 — 9 novembre 2026

**Posta in uscita: SMTP classico, e finalmente si trova.** Prima le mail dei documenti, dei solleciti e dei messaggi ai clienti partivano solo da Resend, e la sua scheda in Connessioni non compariva se non era già collegata: per questo non si trovava dove inserire la posta.
- **Impostazioni → Connessioni → Posta in uscita** è ora in cima e sempre visibile, con due schede: **SMTP** (server, porta, cifratura SSL/STARTTLS/nessuna, utente, password, mittente, nome del mittente) e **Resend**. Se sono collegate tutte e due, parte l'SMTP; scollegandolo si torna a Resend.
- **Invia mail di prova**: dalla scheda, a un indirizzo a scelta; dice da quale canale è partita e, se il server rifiuta, cosa ha risposto (mai la password).
- Passano da qui anche i documenti ai clienti, i solleciti, i messaggi di massa, gli auguri e le richieste del modulo di contatto del Sito Web.
- **Messaggi ai clienti riordinato** in quattro blocchi numerati (Canali, Regole di invio, Auguri di compleanno, Registro); le card dei canali rimandano alla scheda giusta di Connessioni.
- Password e chiave API sono campi nascosti; le credenziali restano sigillate nel database come le altre.
- Prove: nuova suite `email-smtp.test.js` con un finto server SMTP (scelta del canale, invio vero, password sbagliata, server irraggiungibile).
- **Guida illustrata**: nuova voce «Posta in uscita» in Impostazioni.

## 0.4.80 — 9 novembre 2026

**Quote societarie dentro il Cliente; auguri di compleanno e invio di massa, per mail e SMS.**

- **Quote societarie nella scheda del cliente**: il modulo resta com'è (una quota lega società, socio e acquirente: serve ancora una riga per quota) ma **sparisce dal menu laterale** (nuova proprietà di modulo `menu_nascosto`: attivo, tolto dal menu). Nella scheda di ogni cliente, tra i «Collegati», compare sempre «Quote societarie» con l'elenco (come società, socio o acquirente) e «Aggiungi riga». Prima i «Collegati» comparivano solo se già con righe. Impostazioni → Moduli mostra «nascosto». Pacchetto v19 (`proprieta`: `quote_societarie.menu_nascosto`).
- **Messaggi ai clienti** (Impostazioni → Messaggi ai clienti): mittente degli SMS (alias registrato e approvato nella console di OpenAPI.it), tetto di messaggi al giorno (predefinito 200), riga di disiscrizione in fondo alle mail, e il **registro** di tutto ciò che è partito, saltato, fermato o non riuscito.
- **Auguri di compleanno automatici**: ogni giorno dalle 09:00 (ora italiana), a chi compie gli anni **e ha «Consenso comunicazioni commerciali»**, mail e/o SMS con il tuo testo ({nome}, {cognome}). **Spenti finché non li attivi**; una sola volta all'anno per cliente; chi è saltato (senza consenso o senza contatto) è nel registro con il motivo. Il pulsante «Auguri al cliente» li manda subito a quel cliente.
- **Invio di massa**: pulsante «Messaggio» nella lista Clienti (solo admin): scrive a **tutti i clienti che vedi nella lista** (filtri e ricerca compresi). Prima c'è l'**anteprima** (chi riceve, chi è saltato e perché, quanti SMS e quanto costano, un esempio col nome), poi la conferma; il server ricontrolla il consenso per ognuno. Il tetto giornaliero si ferma e lascia scritto il resto nel registro.
- **SMS**: SMS v2 di OpenAPI.it (`POST /IT-messages`, sandbox gratuito). Se il servizio non è abilitato o manca il mittente, **gli SMS si saltano e lo dice, la mail parte lo stesso**; appena il servizio è abilitato, gli SMS partono da soli. Ogni SMS è una spesa nel registro di OpenAPI (listino «da 0,036 €» a segmento da 160 caratteri).
- Test: `messaggi-clienti.test.js` (8, con mail e SMS finti). Non provato dal vivo: la prima mail e il primo SMS veri.
- Messa online: deploy + **Aggiorna** su zucca. Gli auguri automatici restano spenti finché non li accendi.
- **Guida illustrata PDF finale** (43 pagine, versione 0.4.80): testi nuovi su quote dentro il Cliente, messaggi ai clienti, funzioni che si accendono da sole (solvibilità, credit score, catasto), stima ragionata, Dashboard.
- **Guida illustrata: nuova parte «Come si lavora»** (55 pagine): schema di come sono legate le schede (Cliente, Immobile, Trattativa, Provvigione, Attività, Quote), una vendita seguita dall'inizio alla fine con «cosa cambia» in ogni passo, la Dashboard nuova (Percorso e Segnali cliccabili, filtro dalla Dashboard) con schermate rifatte, giornate tipo e «quando l'app ti ferma».

## 0.4.79 — 9 novembre 2026

**La versione di Platform si vede sempre sotto il titolo.** Prima compariva solo quando il nome «Platform» non era nascosto; sui tenant che mostrano il nome dello studio (zucca) non si vedeva. Ora sotto il titolo in barra laterale c'è sempre «Platform 0.4.79», anche nel menu da telefono. Solo frontend: deploy + **Aggiorna** su zucca.

## 0.4.78 — 9 novembre 2026

**Il campo «Superficie box/garage (mq)» arriva anche sui tenant esistenti, e il Percorso a fasi si legge bene su telefono.**

- Il campo era stato messo in un'estensione già applicata su zucca, quindi lì non è mai arrivato (il valore 27 era sul record ma senza campo da modificare). Ora ha una estensione propria (`superficie_box`, pacchetto v18).
- Il **Percorso a fasi** su schermi stretti usa una griglia a tre colonne con le etichette che vanno a capo (prima si tagliavano: «Da…», «In…»).
- Su zucca ho aggiunto alla Dashboard, dopo «Da fare», il Percorso degli immobili e «Da sistemare» (provvigioni scadute, immobili da valutare, clienti da verificare, dati cliente scaduti, rogiti entro 30 giorni).
- Messa online: deploy + **Aggiorna** su zucca.

## 0.4.77 — 9 novembre 2026

**Dashboard: nuovi widget standard e numeri che si cliccano.**

- **Percorso a fasi** (`PercorsoWidget`): un conteggio per ogni stato del flusso di un modulo, con barra proporzionale. Serve solo il modulo; ogni fase apre il modulo filtrato su quello stato.
- **Segnali** (`SegnaliWidget`): un gruppo di conteggi con soglia (etichetta, modulo, filtri, tono). Le voci a zero spariscono («tutto a posto» se sono tutte a zero). Le voci si scrivono come testo JSON dal modale del widget (un editor a campi arriverà dal Builder).
- **Il clic apre il modulo già filtrato**: il filtro (`lib/filtroWidget.js`: uguale, diverso, vuoto, compilato, scaduto, entro N giorni, questo mese, minore/maggiore) è lo stesso per contare nel widget e per filtrare l'elenco, quindi il numero e le righe coincidono. Nell'elenco di un modulo i riquadri degli **stati del flusso in alto sono ora filtri** (un clic filtra, un altro mostra tutti) e un avviso dice quando c'è un filtro arrivato dalla Dashboard.
- **Contatori** (Numero, Numero con soglia): si cliccano e, a zero, diventano piccoli e grigi («niente per ora») invece di un «0» enorme.
- Il widget «Da fare» esisteva già e resta com'è (già generico e cliccabile).
- Nessun cambiamento ai dati né al pacchetto verticale. Le Dashboard già personalizzate non si toccano: i widget nuovi si aggiungono da **Modifica layout**. Test: `filtroWidget.test.js` (4).
- Messa online: deploy di frontend e backend (basta il core del tenant: **Aggiorna** su zucca).

## 0.4.76 — 8 novembre 2026

**Verifica della persona, credit score e controllo catastale sono collegati a OpenAPI.it: appena attivi i servizi, partono da soli.**

- **Come funziona**: «Verifica del soggetto e solvibilità» (Risk, report sulla persona), «Credit score società» (Risk, semaforo start/advanced) e «Controllo dati catastali» (Catasto, visura dell'immobile) hanno un adattatore vero. Finché la chiave collegata non è abilitata al servizio restano tra **«Altre funzioni»** con la frase «da attivare» (nessuna richiesta, nessun costo, nessuna conferma); quando il servizio è abilitato **passano da sole tra i pulsanti**. Il controllo (`GET /api/records/:modulo/azioni-stato`, nuovo) prova solo a ottenere il token con gli scope del servizio, resta in memoria 10 minuti.
- **Verifica della persona**: richiede l'informativa privacy firmata (`privacy_firmata_il`), un codice fiscale valido e conferma del costo. Il report è asincrono: si paga **una volta**, poi lo stesso pulsante ricontrolla **senza costo** finché non è pronto; compare il pulsante **«Report PDF»**. Nome e cognome si ricavano da «Nome Cognome» (primo nome, resto cognome).
- **Credit score società**: dalla partita IVA o dal codice fiscale, scrive semaforo, rating e fido sul cliente.
- **Controllo catastale**: richiede provincia, comune, foglio e particella (il subalterno se c'è), confronta categoria e rendita con la scheda; stesso schema (si paga una volta, ricontrollo gratuito). La risposta si legge in modo tollerante: se categoria e rendita non si trovano, l'esito lo dice.
- **Costi**: nuove voci in listino (verifica CF 0,0081, report persona 3,60 cautelativo, credit score start 0,06 e advanced 0,15); la visura catastale ha prezzo «non noto» da scrivere in Prezzi.
- **Fatture**: useremo **Fatture in Cloud**, non l'SDI di OpenAPI (tolto da `docs/COSTI-OPENAPI.md`). Firma elettronica, PEC e fatture restano «da attivare».
- **Dominio del Catasto corretto**: secondo lo schema ufficiale è `catasto.openapi.it` (prima `.com`).
- Pacchetto verticale v17. Test: `risk-collegati.test.js` (8, con un finto OpenAPI), aggiornati `openapi-servizi.test.js` e `scheda-completa.test.js`.
- **Non provato dal vivo**: i collegamenti sono scritti sugli schemi ufficiali e provati con un finto servizio; la prima richiesta vera (a pagamento) può richiedere un ritocco. Il tetto mensile e la conferma del costo limitano il rischio.
- Messa online: deploy di backend, frontend e provisioner + **Aggiorna** su zucca.

## 0.4.75 — 8 novembre 2026

**La mail del backup settimanale ha una grafica curata.**

- Intestazione nel **viola di Platform** (il colore dell'icona; il blu è di zucca, non di Platform) e nel carattere serif, tre riquadri con **data, dimensione e «cifrata»**, tre passi numerati per riaprire la copia, il comando `openssl` in un **blocco scuro a righe con la barra rovesciata** (si incolla e funziona; non si spezza a metà), avviso giallo «solo il database, non i file caricati». Colori espliciti: leggibile anche nei client in tema scuro.
- Solo Super Admin: nessun cambiamento per i tenant. Il testo semplice della mail e la cifratura non cambiano (10 test di `weekly-backup-mail.test.js` verdi).
- Messa online: deploy del Super Admin (`redeploy-nas.sh backend`), nessun Aggiorna su zucca.
- **Guida illustrata PDF rigenerata** (43 pagine, versione 0.4.75): nuova figura e testo della **stima ragionata**, avviso «Già eseguita» / «Rifai e paga di nuovo», servizi vicini che non dicono più «non disponibili», civico «n.ro». Le schermate vecchie sono state riprese dal PDF precedente (ordine delle figure di `cap.js`); quelle nuove vengono dal report vero generato con i dati di Via San Benedetto. Nel report, le frasi di controllo scrivono «euro» per esteso (il simbolo si sovrapponeva alla parola dopo).

## 0.4.74 — 8 novembre 2026

**La «stima ragionata» del report: il valore in evidenza non è più la sola media di zona.**

- **Perché**: il report mostrava come «valore stimato» la quotazione media di zona × i mq (~140.000 €), cioè la media di tutto il patrimonio della zona, anche vecchio e in cattivo stato. Per un immobile in ottimo stato con box era molto sotto il mercato reale.
- **Come si calcola ora** (`lib/stima-ragionata.js`, funzione pura): abitazione = mq × fascia OMI «abitazioni civili» scelta dallo **stato dell'edificio** della scheda (Ottimo → ottimo, Buono → normale, Da ristrutturare → scadente, se l'OMI non la ha si usa la normale e lo dice); **box/garage** = mq × OMI autorimesse, solo se nella scheda è scritta la superficie (nuovo campo **«Superficie box/garage (mq)»**, in «Dimensioni e composizione»); cantina, solaio e portico non si quotano e il report lo dichiara. Controllo con la **mediana degli annunci vicini** (prezzi richiesti, più alti dei venduti) e la quotazione media di zona, indicata come stima più prudente.
- **Nel PDF**: il riquadro «VALORE STIMATO» usa la stima ragionata, e una sezione «Come si arriva alla stima» elenca fonte per fonte. Senza OMI o senza superficie il report torna al vecchio calcolo.
- **Nessun costo**: usa solo i dati OMI e i comparabili già salvati nel report. **Per aggiornare un report esistente basta riscaricare il PDF**, senza rifare «Valutazione di mercato» (3 €).
- Pacchetto verticale v16 (campo nuovo). Test: `stima-ragionata.test.js`.
- Messa online: **Aggiorna** su zucca (insieme a 0.4.72 e 0.4.73).

## 0.4.73 — 8 novembre 2026

**Non pagare due volte per distrazione, e i moduli nascosti si riconoscono.**

- **«Già eseguita su questa scheda»**: se l'azione a pagamento (per esempio «Valutazione di mercato») ha già un risultato salvato sul record, la **conferma del costo lo scrive in chiaro** («Il risultato è salvato e si può riaprire, e rifare il PDF, senza spendere. Rifarla costa di nuovo») e il pulsante diventa **«Rifai e paga di nuovo»**. Il server lo segnala (`gia_eseguita` nella risposta di conferma): ogni pressione resta una nuova richiesta a pagamento, ma non si può più rifare per caso.
- **Elenco dei moduli** (Impostazioni → Moduli): un modulo spento o nascosto porta ora la scritta **«nascosto»**, non solo l'icona dell'occhio.
- **Su zucca** (fatto a mano, non è codice): **Interazioni e Visite**, i due moduli vecchi già spenti e vuoti dopo l'unificazione, sono stati **eliminati**; resta Attività.
- Test: `openapi-spese.test.js` (una prova nuova: «già eseguita» su record con report, assente su record nuovo).
- Messa online: **Aggiorna** su zucca (insieme alla 0.4.72).

## 0.4.72 — 8 novembre 2026

**Servizi vicini senza vicoli ciechi, indirizzi copiati dagli atti che la mappa capisce, e la mappa che dice quando non trova.**

- **I servizi vicini arrivano sempre**: il servizio pubblico di Overpass era spesso pieno («502, query workers busy») e la scheda finiva su «Servizi vicini non disponibili ora… riapri più tardi». Quel messaggio **non esiste più**. Ora il server prova **una copia del servizio dopo l'altra** (prima le europee: quella francese risponde in pochi secondi, poi la tedesca, poi le altre; la copia di un servizio russo solo per ultima, con le sole coordinate di un punto) e, se tutte falliscono, **riprova da solo dopo 15 secondi**. La pagina chiede ogni 6 secondi finché è aperta e scrive «Cerco i servizi vicini…», poi «Sto ancora cercando… riprovo da solo»: mai «non disponibile». Una risposta del servizio con un'avvertenza di errore (timeout, memoria) non è più scambiata per «nessun luogo» e non finisce in cache.
- **Civico scritto come negli atti** (`lib/geocodifica.js`): «Via San Benedetto **n.ro 3**» faceva fallire la ricerca dell'indirizzo, quindi **la mappa non compariva**. Ora «n.ro», «nr.», «n°», «n.», «civ.», «numero» si tolgono, **solo prima di una cifra**: «Via N. Sauro 5», «Via Civitavecchia 3», «Piazza 4 Novembre 2», «Via XX Settembre 20» restano come sono. Si cerca prima l'indirizzo ripulito; se non si trova, anche quello scritto: ripulire non fa mai perdere un indirizzo che prima si trovava.
- **La mappa dice quando non trova l'indirizzo**: prima spariva in silenzio; ora un riquadro dice «La mappa non trova «…». Scrivi via e numero civico nei due campi, senza «n.ro» o «n°»».
- Il report PDF, se i luoghi non ci sono ancora, dice sempre «si stanno cercando: rigenera tra un minuto» (non più «non disponibili»).
- Test: `servizi-vicini.test.js` (10 prove: passaggio alla copia successiva, avvertenza di errore non scambiata per «nessun luogo», nessun vicolo cieco, ordine delle copie) e `geocodifica.test.js` (7: civico ripulito, mai toccati gli indirizzi normali, prima ripulito poi scritto). Provato con il servizio vero: l'elenco arriva in meno di 6 secondi dalla copia francese.
- Messa online: **Aggiorna** su zucca.

## 0.4.71 — 8 novembre 2026

**«Servizi vicini» leggibili anche in una scheda stretta, e la guida illustrata in PDF aggiornata.**

- **Servizi vicini** (`MappaOSM.jsx`): nel pannello laterale stretto il nome della categoria si troncava («Ferma…») e un nome lungo usciva dal riquadro. Ora ogni voce è su **due righe**: la categoria sopra, il luogo con distanza e minuti sotto, che va a capo se serve.
- **Guida illustrata** (`docs/guida-utente/Guida-illustrata.pdf`): rifatta alla versione 0.4.71, **42 pagine e 51 schermate** prese da un ambiente locale di prova. Nuovi capitoli e passi: il giro guidato; la casella «fatto» nel «Da fare»; il «?» della Dashboard con i due pulsanti; gli avvisi della campanella; la mappa e i servizi vicini; il report PDF con la mappa e i luoghi numerati; minimo garantito, trattenuta all'agente e allineamento al prezzo concordato nelle Provvigioni; solvibilità, credit score società e le altre funzioni «da attivare»; carattere e logo in versione chiara in Aspetto; dalla prova alla produzione e dati dimostrativi in OpenAPI. Tolto il capitolo dei Contatti (ora sono Attività).
- **Per rifarla** (`docs/guida-utente/strumenti/`): script delle schermate (Chrome in modalità senza finestra), dei dati di esempio e del PDF, con un LEGGIMI. Le schermate intermedie non si conservano.
- Messa online: **Aggiorna** su zucca (solo il pannello dei servizi cambia).

## 0.4.70 — 8 novembre 2026

**Il report di valutazione: la mappa di OpenStreetMap con i luoghi utili vicini, e l'intestazione sistemata.**

- **Mappa nel PDF** (`lib/mappa-pdf.js`): nuova sezione «Dove si trova e cosa c'è intorno» con la mappa di OpenStreetMap centrata sull'immobile (spillo del colore dell'azienda), il **cerchio di 1 km** tratteggiato e i **luoghi utili segnati con un numero colorato**: il supermercato, la farmacia, la scuola, la struttura sanitaria, la fermata e il parco più vicini. Sotto una **legenda** con nome, distanza in metri, minuti a piedi (stima dalla linea d'aria) e quanti ce ne sono nel raggio. Fonte «© OpenStreetMap contributors» sulla mappa, come richiesto dalla licenza.
- **Come si procura i dati**: le tessere della mappa si scaricano da OpenStreetMap con un User-Agent che dice cos'è, due alla volta, e restano in cache 14 giorni (`tile_cache`); non partono né l'indirizzo né dati del proprietario, solo le coordinate. I luoghi vengono dalla stessa cache dei «Servizi vicini» della scheda (se si è già aperta la scheda dell'immobile ci sono): se non ci sono ancora, **il report non aspetta** (il servizio può metterci 30-40 secondi), parte la ricerca in secondo plano e il report dice «rigenera il report tra un minuto». Se le tessere non arrivano, il riquadro lo dice e la legenda resta. Nessun credito di OpenAPI.it consumato.
- **Intestazione**: la pillola «REPORT DI VALUTAZIONE» andava a capo e usciva dal bordo; ora **si allarga al testo** (tra 118 e 230 punti), e il nome dell'azienda non finisce mai sotto di lei. Vale per tutti i PDF che usano l'identità comune.
- `servizi-vicini`: ogni luogo porta ora le sue coordinate (la cache cambia chiave: le voci vecchie si rifanno una volta).
- Test: `mappa-pdf.test.js` (9 prove: coordinate e scala, tessere necessarie, cache e un'unica richiesta, luoghi numerati, report con mappa e legenda, senza luoghi in cache, senza tessere, senza coordinate, pillola). Provato con le tessere vere di OpenStreetMap e letto il PDF a occhio.
- Messa online: **Aggiorna** su zucca. Nessun cambio al pacchetto.
- **Non fatto**: più luoghi per categoria sulla mappa (oggi uno, il più vicino), il percorso a piedi vero, la mappa nei documenti da modello.

## 0.4.69 — 8 novembre 2026

**«Da fare» della Dashboard: la casella per segnare una riga come fatta.**

- Prima una riga usciva dall'elenco solo se la si apriva e si premeva «Segna come fatto» nella scheda. Ora **ogni riga ha una casella** a sinistra: spuntarla fa lo **stesso passaggio di stato** del pulsante nella scheda (stesso ruolo, stessi requisiti, stesse automazioni) e la riga esce subito, con il conteggio aggiornato. Cliccare il titolo apre il modulo come prima.
- **Se il modulo non lo permette** (il passaggio non esiste da dove si trova la riga, o manca qualcosa di bloccante) la riga **resta**, la casella torna vuota e compare il motivo scritto dal server, con «Apri» per andare alla scheda. Succede per esempio a una provvigione «da fatturare»: lo stato «fatto» è «incassata», che non si raggiunge direttamente.
- La casella compare solo se il modulo ha dichiarato quale stato vale «fatto» (Builder → Ruoli del modulo → Avvisi): senza non si saprebbe dove portare la riga.
- Test: `AgendaWidget.test.jsx` (4 prove: spunta e la riga esce col passaggio giusto, rifiuto con motivo, nessuna casella senza stato «fatto», il titolo non segna).
- Messa online: **Aggiorna** su zucca. Nessun cambio al pacchetto.
- **Non fatto**: annullare la spunta dal widget (si riapre dalla scheda), e un esito da scegliere al volo per le Attività (la scheda lo ricorda ma non lo blocca).

## 0.4.68 — 8 novembre 2026

**Il logo dell'app in versione chiara, per il tema scuro.**

- **Nuovo campo in Impostazioni → Aspetto**: «Logo dell'app in versione chiara (per il tema scuro)», accanto al logo dell'app. Sul **tema scuro** barra laterale e schermata di accesso mostrano la versione chiara; sul tema chiaro quella normale. Se la versione chiara non c'è, vale sempre il logo normale (come prima). Si carica, si cambia e si toglie quando si vuole: nulla è scritto nel codice, quindi se il logo cambia basta ricaricare i due file. Salvato in `tenant_settings.app_logo_chiaro_url` (stesse regole di formato e peso degli altri loghi), letto da `/api/tenant-info` quindi anche al login; l'app segue il cambio di tema senza ricaricare.
- **I PDF non cambiano**: usano il «Logo» dell'azienda (sezione sotto), che sta già in un riquadro bianco sulla fascia, quindi va bene la versione normale.
- Test: `caratteri.test.js` (una prova nuova: caricamento, lettura senza accesso, rifiuto di un file non immagine, salvare altro non lo azzera, rimozione).
- Messa online: **Aggiorna** su zucca. Nessun cambio al pacchetto.
- Nota pratica: un PNG esportato con un fondo quasi trasparente (come i due loghi di zucca, con un velo al 13% sull'intero riquadro) mostra un leggero riquadro sul tema scuro: meglio esportare con fondo del tutto trasparente.

## 0.4.67 — 8 novembre 2026

**Il carattere «Zuccà Banner» tra le scelte di Impostazioni → Aspetto.**

- **Cosa si sceglie**: nuovo riquadro «Carattere dell'app» con due voci, **Predefinito** (Inter) e **Zuccà Banner** (serif con grazie), ognuna con un'anteprima. La scelta vale subito, senza ricaricare, in tutta l'app, **anche nella schermata di accesso**, e nei **titoli e nel piè di pagina dei PDF** (grassetto per i titoli, corsivo per il nome dell'azienda in basso). Salvata in `tenant_settings.font_app`.
- **Cosa è il font**: i quattro file forniti (Regular, Bold, Italic, Bold Italic) sono una **versione rinominata di GFS Didot** (Greek Font Society), con licenza **SIL Open Font License 1.1**, come dice il LEGGIMI del pacchetto: non è un disegno esclusivo. La licenza e le note stanno accanto ai file (`core/backend/assets/fonts/zucca-banner/`) e il riquadro lo dice.
- **Dove stanno i file**: serviti dal backend (`GET /api/fonts/<famiglia>/<file>`, pubblici perché servono anche al login, solo i nomi dell'elenco di `lib/caratteri.js`, mai un percorso scritto da fuori) e scaricati dal browser solo se il carattere è scelto. Una copia sola, usata anche dai PDF. Aggiungere un'altra famiglia è aggiungere una voce a `FAMIGLIE`.
- **Da sapere**: è un serif ad alto contrasto, bello nei titoli ma più sottile a corpo piccolo (tabelle, etichette da 10-12 px): il riquadro lo dice, e si torna al predefinito con un clic. Nei PDF il corpo del testo resta Helvetica.
- Test: `caratteri.test.js` (file veri OpenType e licenza accanto, rotta pubblica e chiusa ai percorsi, scelta/rifiuto/ritorno al predefinito, salvare altro non azzera il carattere, PDF con il font incorporato o Times). Provato dal vivo in locale.
- Messa online: **Aggiorna** su zucca (e su ogni tenant che lo voglia). Nessun cambio al pacchetto.

## 0.4.66 — 8 novembre 2026

**Solvibilità segnata «da attivare»: pacchetto Mediazione immobiliare alla versione 15.**

- **«Verifica del soggetto e solvibilità»** (Clienti): il segnaposto già presente cambia etichetta e descrizione. Per le **persone fisiche** non esiste un credit score vero: valgono negatività, protesti e report persona (CRIF). Serve Risk di OpenAPI.it (con «Verifica dell'identità» e «Contratto informazioni commerciali»), il consenso del cliente e la conferma del costo.
- **«Credit score società»** (Clienti, nuovo segnaposto «da attivare»): semaforo di affidabilità a 3 classi dalla partita IVA (start, advanced o top, da circa 0,06 a 0,19 € più IVA a richiesta), con la visura camerale facoltativa (Visure Camerali).
- Nessun servizio è collegato: i due pulsanti dicono cosa serve per accenderli (sandbox gratuito prima). Un passo del giro guidato riservato agli admin li elenca tra le cose da completare.
- **Nuovo `riscrivi` nelle estensioni** (`seed-blocchi-verticale.js`): `[{ block_type, key, proprieta: { nome: { da, a } } }]` cambia un testo di un blocco già pubblicato solo se vale ancora `da`; un testo scelto dall'utente dal Builder non si tocca. Una sola volta, come le altre estensioni. (`imposta` dà solo ciò che manca, `riscrivi` aggiorna ciò che c'è.)
- Test: `provvigioni-avvisi.test.js` (19 prove, una nuova: testi aggiornati solo se ancora quelli di prima, testo dell'utente intatto, segnaposto completi, installazioni nuove già col testo nuovo).
- **Non fatto**: il collegamento vero a Risk (flusso asincrono, consenso registrato prima di ogni richiesta, conferma del costo, tetto di spesa): si fa in sandbox appena il servizio risulta attivo.
- Messa online: Super Admin (pacchetto v15) e **Aggiorna** su zucca.

## 0.4.65 — 8 novembre 2026

**Dati di esempio ordinati e coerenti, con «da attivare» dove OpenAPI non c'è, e la guida a portata del «?»: pacchetto Mediazione immobiliare alla versione 14.**

- **Dati dimostrativi riscritti** (`dimostrativi.json`): 4 clienti (2 venditori, 2 acquirenti con cosa cercano), **4 immobili in stati diversi** (Da valutare, In mandato, In vendita, In trattativa) con indirizzi veri del Garda, **3 trattative una per fase**, 2 provvigioni a due parti (con trattenuta all'agente e minimo garantito) e **5 attività** distribuite nella settimana, tutte collegate tra loro (cliente, immobile, trattativa). Prima c'era una sola trattativa senza immobile. Tutto marcato «(dimostrativo)» e `_demo`, e si toglie insieme da Impostazioni → Connessioni → OpenAPI.it.
- **Dati veri di OpenAPI.it dove il servizio c'è**: imprese dalle visure camerali e annunci vicini a un indirizzo (come prima, con il piano dei costi da confermare prima del caricamento).
- **«Da attivare» dove non ci sono** (nuovo `se_manca` nelle fonti): se un servizio non è abilitato, non risponde o non dà dati, al suo posto si crea un record che dice cosa serve (per esempio «Società di esempio (da attivare: imprese dalle visure camerali)» o «Annunci di zona (da attivare)», con il servizio OpenAPI da accendere). Il guasto si dice comunque negli avvisi del caricamento.
- **`escludi`** nelle fonti: toglie le righe che combaciano con un'espressione (qui i nomi finti dell'ambiente di prova di OpenAPI.it, come «xxx Openapi xxxxx»).
- **La guida a portata del «?»**: il punto interrogativo dei moduli apre il capitolo di quel modulo e ora ha in fondo **«Apri tutta la guida»** e **«Fai il giro guidato»**. Nuovo **«?» anche sulla Dashboard** (`AiutoGuida.jsx`): introduzione del verticale e «Per iniziare» per il ruolo di chi guarda, con gli stessi due pulsanti. Due passi nuovi nella guida dell'admin: i dati di esempio e il «?».
- Test: `dati-dimostrativi.test.js` (10 prove, due nuove: `escludi`, `se_manca` e la forma del set reale: immobili in 4 stati, una trattativa per fase, ogni fonte con il suo «da attivare»).
- **Non fatto**: i dati attuali di zucca non si cambiano da soli. Per averli nuovi: togliere i record presenti e premere «Carica dati dimostrativi» (serve l'accesso del tenant e, per i dati di OpenAPI, la conferma del costo).

## 0.4.64 — 8 novembre 2026

**Servizi vicini sotto la mappa dell'immobile: pacchetto Mediazione immobiliare alla versione 13.**

- **Cosa si vede**: sotto la mappa, per supermercati, farmacie, scuole, ospedali e medici, fermate e stazioni, parchi: **il più vicino** (nome, distanza in metri, minuti a piedi) e **quanti ce ne sono entro 1 km**.
- **Da dove vengono i dati**: OpenStreetMap (servizio Overpass), **gratuito e senza chiave**; non serve OpenAPI. La voce era finita per errore tra le cose di OpenAPI nella lista dell'analisi. Al servizio arrivano solo le coordinate del punto, mai l'indirizzo né dati del proprietario.
- **I minuti a piedi sono una stima** (distanza in linea d'aria × 1,25, a 80 metri al minuto), non un percorso calcolato: il percorso vero è il pulsante «Percorso» della mappa. Un calcolo di percorso vero richiederebbe un servizio con chiave (es. OpenRouteService) oppure un server di routing nostro: non fatto.
- **Il servizio pubblico è lento**: provato l'8/11/2026, anche una richiesta banale ha impiegato 30-40 secondi. Per questo la scheda **non aspetta**: il server cerca in secondo plano, la pagina mostra «Cerco i servizi vicini…» e richiede ogni 5 secondi (al massimo 2 minuti). Il risultato resta in **cache 7 giorni** per una cella di circa 100 metri, quindi dalla seconda apertura è immediato. Se il servizio non risponde, compare «non disponibili ora» e si può riprovare riaprendo la scheda; un guasto non si ripete per 2 minuti.
- **Come si accende**: proprietà `servizi` del blocco `map_view` (casella nel Builder: «Mostra anche i servizi vicini»). Nel pacchetto: estensione `servizi_vicini` per le installazioni esistenti (usa `imposta`), `mappa_osm` la porta già accesa per le nuove.
- Tecnica: `lib/servizi-vicini.js`, `GET /api/geocode/servizi` (risponde subito: pronto, in corso o non disponibile), tabella `servizi_cache`.
- Test: `servizi-vicini.test.js` (8 prove: più vicino per categoria, minuti, cache, errori, una richiesta alla volta, stato in corso/guasto) e una prova nel test delle estensioni. Provato dal vivo in locale con il servizio vero.
- **Non fatto**: percorso vero a piedi o in auto (serve un servizio di routing), altre categorie (ristoranti, banche, palestre: basta aggiungerle alla lista `CATEGORIE`), servizi nel PDF del report di valutazione.
- Messa online: Super Admin (pacchetto v13) e **Aggiorna** su zucca.

## 0.4.63 — 8 novembre 2026

**Passaggio di stato alla firma della scheda: pacchetto Mediazione immobiliare alla versione 12.**

- Quando la «Scheda di acquisizione (da firmare)» torna firmata, l'immobile passa da solo da «Da valutare» a «In mandato». **Correzione di quanto scritto nella 0.4.62**: non serviva un nuovo evento «allegato caricato». Il server sa già cambiare stato alla consegna di un documento firmato (`on_signed_state` del documento, con tutti i controlli del passaggio); mancava solo impostarlo su quel documento, che sui tenant esistenti era stato creato senza.
- **Nuovo `imposta` nelle estensioni** (`seed-blocchi-verticale.js`): `[{ block_type, key, proprieta }]` dà a un blocco già presente le proprietà che non ha, mai sopra un valore già scelto (`on_signed_state` solo se lo stato esiste nel workflow). Una sola volta, come le altre estensioni.
- Il segnaposto «Passaggio di stato alla firma» della 0.4.62 sparisce: non serve più. Restano «da attivare» solo Controllo catastale (OpenAPI) e Auguri al cliente (il tuo testo e il consenso).
- Se il passaggio non esiste nel workflow del modulo (stato diverso da «Da valutare»), la scheda firmata si salva e lo stato resta com'è, senza errori.
- Test: `provvigioni-avvisi.test.js` (17 prove: impostazione una sola volta, valore già scelto intatto).
- Messa online: Super Admin (pacchetto v12) e **Aggiorna** su zucca.

## 0.4.62 — 8 novembre 2026

**Più avvisi automatici, un giro guidato per ogni verticale e i segnaposto «da terminare»: pacchetto Mediazione immobiliare alla versione 11.**

- **Giro guidato del verticale** (`guida.json` → `giro`, `routes/guida.js`, `lib/giro.js`): il pacchetto dichiara i passi (`pagina`, `titolo`, `testo`, `target` e `ruoli` facoltativi). **Parte da solo la prima volta** che una persona entra (e mai davanti ai «Primi passi» di un tenant vuoto), e si rifà quando si vuole dal pulsante **«Fai il giro guidato»** nella Guida. Segnato per persona (`users.giro_visto_at`, `POST /api/guida/giro/visto`) quando lo conclude o lo salta. Un passo su una pagina che chi guarda non ha (modulo non installato, ruolo diverso) si salta; senza passi del verticale resta il giro generico di Platform. Il motore (`ProductTour`) è quello di prima. **Chi c'era già lo vedrà una volta sola, alla prossima apertura**, e può saltarlo.
- **Tre nuove azioni di avviso** del motore automazioni, generiche (`lib/avvisi-automatici.js`, elencate in `INTERNAL_ACTIONS`): `notifica_requisiti_mancanti` (cosa manca per passare a uno stato, allegati compresi), `notifica_abbinamenti` (quanti record compatibili secondo un `match_view`) e `notifica_riepilogo` (nuovi e per stato in un modulo). Non scrivono nulla se non c'è niente da dire. **Il Builder non ha ancora una scheda di configurazione per queste tre**: si dichiarano nel pacchetto (o come dati) e funzionano.
- **Nel pacchetto**: avviso «in agenda oggi» per le Attività (ogni giorno, 06:00 UTC); «cosa manca per la verifica» sui Clienti e «cosa manca per mettere in vendita» sugli Immobili (ogni 7 giorni); avviso di **richieste compatibili** quando un immobile va in mandato; **riepilogo settimanale** delle Trattative.
- **Segnaposto «da attivare»** (stessi pulsanti dei servizi OpenAPI, con scritto cosa serve): **Controllo dati catastali** (serve il servizio Catasto di OpenAPI.it); **Auguri al cliente** (serve il tuo testo e il consenso alle comunicazioni commerciali); **Passaggio di stato alla firma** (serve un nuovo evento «allegato caricato» del motore: è lavoro da fare in Platform, non da attivare). Un passo del giro, riservato agli admin, elenca cosa resta da completare.
- Test: `provvigioni-avvisi.test.js` (16 prove), `guida.test.js` (giro: unione, ruoli, partenza da solo, «visto», giro reale del pacchetto), `giro.test.js` lato frontend. Provato dal vivo in locale: il giro parte da solo, il passo si legge, dopo «Salta» e ricaricamento non riparte, il pulsante nella Guida lo rifà.
- **Non fatto**: auguri ai clienti veri e propri, controllo catastale, passaggio di stato alla firma (vedi sopra); scheda di configurazione delle nuove azioni nel Builder.
- Messa online: Super Admin (pacchetto v11) e **Aggiorna** su zucca. Le estensioni si applicano al primo avvio.

## 0.4.61 — 8 novembre 2026

**Provvigioni più complete e avvisi automatici per Trattative e Clienti: il pacchetto Mediazione immobiliare passa alla versione 10.**

- **Minimo garantito** (Provvigioni): se l'importo calcolato è più basso del minimo, vale il minimo; IVA e totale seguono. Senza minimo nulla cambia. Si applica in due passi (campo, poi formule) perché una formula vede solo i campi che la precedono; le formule si cambiano solo se sono ancora quelle degli scaglioni.
- **Trattenute all'agente** (Provvigioni): agente, percentuale di trattenuta, *importo all'agente* e *resta all'agenzia*, calcolati sull'importo netto.
- **Provvigioni allineate al prezzo concordato**: ogni giorno alle 05:00 UTC le provvigioni ancora *da fatturare*, generate per parte (con trattativa e parte indicate), riprendono il prezzo concordato della trattativa; importi, IVA e totale seguono. Una provvigione fatturata, una senza parte o senza trattativa non si tocca. Il cambio arriva quindi **entro un giorno**, non all'istante.
- **Solleciti per stato** (Trattative), controllo ogni 7 giorni alle 06:00 UTC: rogito con data passata e preliminare ancora da chiudere; trattativa «in corso» da più di 30 giorni. Sono **notifiche in app per tutti i ruoli**, nessun messaggio al cliente.
- **Conservazione dei dati scaduta** (Clienti), stesso ritmo: un avviso per ogni cliente con la data di conservazione già passata. **Non cancella niente**: cancellare o rinnovare il consenso resta una decisione di una persona.
- `scheduler.js` esporta `eseguiAutomazioneSchedulata` (per i test).
- Test: `provvigioni-avvisi.test.js` (10 prove: ordine di applicazione, minimo, trattenute, allineamento col prezzo e i casi che non devono muoversi, solleciti, conservazione).
- Nota sui `package-lock.json` di Super Admin e provisioner: la riga di `iconv-lite` porta un numero di versione che segue per errore quello di rilascio (0.4.xx invece di 0.4.24), ma `npm ci` funziona così e con il valore «giusto» la build fallisce (provato l'8/11 sul NAS, prima di toccare i container). **Non correggerla a mano e non usare sostituzioni globali**: la riga si aggiorna col numero di rilascio, come nei rilasci precedenti.
- **Non fatto**, perché serve altro: controllo dei dati catastali (servizio Catasto di OpenAPI.it), passaggio di stato alla firma della scheda (la firma è un allegato, non un evento che il motore sa leggere), avviso sugli allegati mancanti per tipo di cliente, avviso quando entra un immobile compatibile con una richiesta, riepilogo di avanzamento per periodo (il report esistente conosce solo importi), auguri ai clienti (serve il consenso alle comunicazioni commerciali e l'invio email).
- Messa online: Super Admin (pacchetto v10) e poi **Aggiorna** su zucca. Le estensioni si applicano al primo avvio, una volta sola.

## 0.4.60 — 7 novembre 2026

**Attività come unico modulo: visite, telefonate, incontri e promemoria stanno nello stesso posto, collegati a clienti, immobili e trattative.**

- **Il modello**: un'**Attività** ha un *tipo* (Visita, Telefonata, Incontro, Sopralluogo, Messaggio, Promemoria), *Quando* (data) e ora, chi se ne occupa, esito, e **tre collegamenti facoltativi: cliente, immobile, trattativa**. Un cliente con più immobili e più trattative ha così le sue attività in un'unica lista, e le schede di cliente, immobile e trattativa le mostrano in «Collegati». Il riquadro «per passare a Fatto» ricorda che servono un collegamento e l'esito (promemoria, non blocco).
- **Calendario unico** (blocco `calendar_view` sulle Attività): tutte le attività insieme, quelle fatte sbarrate. «Da fare» della Dashboard legge già le Attività, quindi la Dashboard non cambia.
- **Eredita dalla relazione** (nuova proprietà `eredita` sul blocco relazione, `lib/eredita-relazione.js`, applicata dal server a creazione e salvataggio): scegliendo una **trattativa**, immobile e cliente si compilano da lì se sono vuoti, mai sopra un valore scritto.
- **Migrazione dei dati** (nuova parte `migrazioni` del pacchetto, `migraModuli`): i record di Visite e Interazioni passano in Attività una volta sola (visita → tipo Visita, programmata → da fare, conclusa → fatto; interazione → stesso tipo, data e ora separate, pianificata → da fare, svolta → fatto; le dimostrative restano dimostrative). I record di partenza restano, segnati `_migrato`; **i moduli vecchi si spengono, non si cancellano** (si riaccendono da Impostazioni → Moduli). Un modulo spento esce da «Collegati» e dall'agenda.
- **`rinomina`** nelle estensioni: «Scadenza» diventa «Quando» solo se si chiama ancora così (un nome scelto dall'utente non si tocca).
- **Pacchetto** alla versione 9: modulo base `attivita` (per i tenant che non l'hanno), estensione `attivita_unificata`, ruoli, sezioni, migrazioni, dati dimostrativi e guida riscritti; Visite non si crea più sui tenant nuovi.
- **«Annullata» come esito, non come stato** (scelta per non toccare i report «in ritardo», che conoscono un solo stato «fatto»): si chiude l'attività come fatta con l'esito «Rimandata o annullata».
- Test: `attivita-unificata.test.js` (rinomina, migrazione una volta sola, modulo assente, campi mancanti, eredita) più i test dei moduli e della guida aggiornati. Provato su un tenant locale: 6 record migrati, modulo Visite spento, calendario e «Collegati» corretti. La guida illustrata in PDF è aggiornata.
- **Da fare a mano**: nell'analisi «Mediazione immobiliare» (Super Admin) togliere i moduli Visite e Interazioni, così i tenant nuovi nascono già con le sole Attività.
- **Non fatto**: campi diversi a seconda del tipo (oggi sono uguali per tutti e facoltativi); colori per tipo nel calendario; l'attività su una trattativa non compare ancora nella scheda del cliente della trattativa (solo se collegata anche al cliente, cosa che `eredita` fa da sola quando la trattativa ha un cliente).

## 0.4.59 — 7 novembre 2026

**La mappa di OpenStreetMap nella scheda dell'immobile.**

- **Blocco `map_view`** (generico, `shared/schema-v3-core.js` → `schema.map_views`): `campi` (i campi che formano l'indirizzo, nell'ordine), `label`, `paese` (es. `it`). Nella scheda, sotto i dati chiave, compare una **mappa** con il segnaposto; **+ / −** avvicinano e allontanano, **Apri la mappa** la apre su openstreetmap.org, **Percorso** dà le indicazioni. Se l'indirizzo non si trova la mappa non compare. Scheda del blocco nel Builder (con il blocco portato nel salvataggio, come per il calendario).
- **Come funziona**: l'indirizzo scritto nella scheda si cerca su **Nominatim** dal nostro server (`GET /api/geocode`, `lib/geocodifica.js`: gratuito e senza chiave, User-Agent dichiarato, **una richiesta al secondo al massimo**, risultati in cache 30 giorni, «non trovato» ricordato un giorno, un errore del servizio non si mette in cache). Le tessere della mappa si disegnano nel browser (`MappaOSM.jsx`, `lib/tile-osm.js`), senza librerie e senza chiave; in basso «© OpenStreetMap contributors».
- **Privacy**: a Nominatim e ai server delle tessere arriva solo l'indirizzo dell'immobile (non i dati del proprietario); il browser di chi guarda chiede le tessere a OpenStreetMap.
- **Pacchetto** alla versione 8: estensione `mappa_osm` per gli Immobili (indirizzo, numero civico, CAP, comune, provincia, paese `it`) e un passo nel capitolo di guida degli Immobili.
- Test: `geocodifica.test.js` (cache, una richiesta alla volta, errori, non trovato), `tile-osm.test.js` (calcolo delle tessere, verificato a parte), blocco nello schema e andata e ritorno del Builder. Provato dal vivo in locale: 15 tessere su 15 caricate (Brescia).
- **Non fatto**: mappa nei moduli che non siano Immobili (basta dichiarare il blocco), clic sulla mappa per correggere la posizione, mappa nel PDF del report (il report ha già la sua).

## 0.4.58 — 7 novembre 2026

**Il totale delle Provvigioni usa gli scaglioni.**

- **Il difetto**: importo netto, IVA e totale usavano solo la percentuale scritta a mano. Con la percentuale vuota la scheda mostrava «Provvigione da scaglione 4.560» e «Totale con IVA 0».
- **La correzione**: nuova estensione del pacchetto `scaglioni_nel_totale` (pacchetto alla versione 7). Importo netto, IVA e totale ora usano la **Percentuale applicata**: quella scritta a mano se c'è, altrimenti quella dello scaglione. Con 152.000 € e percentuale vuota: 3% → netto 4.560, totale 5.563,20.
- **Meccanismo generico `ricalcola`** nelle estensioni (`seed-blocchi-verticale.js`): `[{ key, da, a, in_fondo? }]` cambia la formula di un campo calcolato già presente **solo se è ancora quella di prima** (`da`): una formula modificata dal Builder non si tocca mai. `in_fondo` sposta il campo dopo gli altri, perché un calcolo vede solo i campi che lo precedono. Una volta sola per estensione, come le altre.
- **Su zucca**: arriva con deploy di Super Admin e Aggiorna; le provvigioni esistenti si ricalcolano da sole (i campi sono calcolati al volo, nessun dato da migrare). Se qualcuno ha cambiato a mano la formula di importo netto, resta com'è.
- Test: `ricalcolo-estensioni.test.js` con le estensioni vere (scaglione, percentuale scritta, scaglione alto, solo importo, formula dell'utente intatta, ripetere non cambia nulla). Provato su un tenant locale con il pacchetto reale.
- La guida illustrata in PDF è stata rigenerata con il nuovo comportamento.

## 0.4.57 — 7 novembre 2026

**Due difetti trovati preparando la guida illustrata.**

- **«Annulla» illeggibile nel tema chiaro**: i pulsanti grigi con testo bianco (15 punti dell'app: moduli «Nuovo», finestre dei widget…) avevano il testo bianco su grigio chiaro. Ora nel tema chiaro il testo prende il colore del tema.
- **Pannelli laterali**: le azioni stanno sempre sotto il titolo (anche su computer), perché accanto lo facevano troncare («Provvigio…») quando erano quattro.
- **Guida illustrata in PDF** (`docs/guida-utente/Guida-illustrata.pdf`, 35 pagine, 43 schermate): ogni azione dei moduli, della Dashboard e delle Impostazioni, con l'intestazione grafica comune dei PDF. Le schermate sono di un ambiente di prova con dati di esempio, non di zucca.
- Il totale delle Provvigioni che ignorava lo scaglione è corretto nella 0.4.58.

## 0.4.56 — 7 novembre 2026

**La scheda di dettaglio torna usabile su telefono.**

- **Intestazione**: il titolo ha la sua riga (prima si spezzava in tre righe) e le azioni stanno sotto, come pulsanti con bordo, tutti visibili e a capo se non stanno in una riga (valeva per ogni pannello laterale dell'app, `FormDrawer`). Margini laterali ridotti su telefono.
- **«Altre funzioni»**: le funzioni «da attivare» (verifica del soggetto, PEC, firma, fattura) non sono più pulsanti affiancati con l'etichetta: stanno in un unico menu con la spiegazione, e il menu occupa la larghezza dello schermo.
- **Valori**: non più in carattere a spaziatura fissa (solo i campi cifrati), a destra e a capo se lunghi.
- **Collegati**: un modulo che punta al record con più relazioni (Trattative come venditore e come acquirente) è una sola voce, con le righe unite senza doppioni; prima compariva due volte e la seconda cancellava le righe della prima.
- **Dati dimostrativi**: un record senza stato scelto parte dal primo stato del flusso (come fa il modulo), non più «—» con «0 transizioni disponibili».
- Provato nel browser in locale a 375 px (intestazione, menu «Altre funzioni», valori). **Non provato**: il tema scuro, e «Collegati» con righe vere da due relazioni (il codice è semplice ma non l'ho visto in azione).

## 0.4.55 — 7 novembre 2026

**La guida d'uso interna: «Come si lavora» nella pagina Guida e un «?» in ogni modulo.**

- **Il pacchetto del verticale porta la sua guida** (nuova parte `guida`, `guida.json`): introduzione, passi per ruolo (chiave = ruolo dell'utente, altrimenti `default`), un capitolo per modulo (a cosa serve, come si usa, consigli), flussi passo per passo e glossario. Scritto a mano solo il «perché» e i casi d'uso. Rotta `GET /api/guida` (unisce i testi dei pacchetti attivi, nessun nome di settore nel codice).
- **Ciò che si può ricavare non è scritto a mano**: in ogni capitolo, il percorso degli stati, i dati chiave, **cosa serve per ogni passaggio (obbligatorio o promemoria)**, i documenti, le funzioni collegate a servizi esterni (con «da attivare») e il calendario vengono letti dallo schema del modulo (`lib/guida-da-schema.js`), quindi restano allineati anche se il modulo cambia dal Builder.
- **Pagina Guida → «Come si lavora»** (scheda iniziale quando c'è una guida): introduzione, i passi per il tuo ruolo, i flussi, un capitolo per ogni modulo installato, il glossario, con ricerca su tutto il testo.
- **«?» accanto al titolo di ogni modulo**: apre il capitolo di quel modulo senza lasciare la pagina; funziona anche senza testi del pacchetto (mostra la parte ricavata dallo schema).
- Il Percorso guidato, il Riferimento e «I tuoi moduli» restano com'erano.
- Test: `guida.test.js` (unione dei pacchetti, pacchetto reale con capitoli solo per moduli esistenti), `guida-da-schema.test.js` (percorso, passaggi, azioni da attivare). Pacchetto alla versione 6.
- **Non fatto**: note proprie dei tenant sui capitoli (la guida è di sola lettura), PDF stampabile. **Non provato nel browser** su un tenant con la guida attiva.

## 0.4.54 — 7 novembre 2026

**Le Visite hanno la vista a calendario; il widget «Da fare» arriva da solo sulla Dashboard di zucca.**

- **Vista a calendario** (nuovo blocco di schema `calendar_view`, `ModulePage/CalendarView.jsx`): un mese alla volta, con le righe sul loro giorno per un campo data (`date_field`), l'ora (`time_field`), il titolo (`title_field`), il sottotitolo (`subtitle_fields`, relazioni comprese) e le righe concluse attenuate (`done_state`). Toccando un giorno le sue righe compaiono sotto (su telefono i giorni mostrano un punto per riga); toccando una riga si apre la scheda. Nella pagina del modulo un selettore **Calendario / Elenco** permette di tornare alla tabella. Generico: qualunque modulo può dichiararlo; oggi lo usano le Visite (dal pacchetto).
- **Builder**: scheda del blocco per cambiare campo data, ora, titolo e stato concluso, e il blocco è portato dentro il salvataggio (senza, riaprire e pubblicare il Builder lo avrebbe cancellato: stesso errore già visto per le altre viste).
- **«Da fare» automatico**: quando un modulo dichiara la scadenza negli Avvisi e la Dashboard ha già dei widget, il motore dei pacchetti aggiunge **una volta sola** il widget «Da fare» in fondo (marcatore `widget:agenda`); una Dashboard vuota la riempie il profilo dell'analisi. Su zucca arriva con l'Aggiorna, senza toccare i dati a mano.
- Test: calendario nello schema delle Visite (campi citati esistenti, andata e ritorno del Builder), widget automatico (una volta sola, mai su una Dashboard vuota).
- Provato nel browser in locale (mese, etichette, elenco del giorno). **Non provato**: telefono e tema scuro.

## 0.4.53 — 7 novembre 2026

**Visite, scaglioni di provvigione, solleciti, auguri e una Dashboard che aiuta il lavoro del giorno; le funzioni che richiedono OpenAPI.it ci sono, con l'avviso «da attivare».**

- **Dashboard «Da fare»** (nuovo widget `agenda`, `components/AgendaWidget.jsx`, rotta `GET /api/module-roles/agenda`): le scadenze **in ritardo, di oggi e dei prossimi 7 giorni** di tutti i moduli che hanno acceso le scadenze negli Avvisi e dichiarato il campo scadenza (Builder → Ruoli del modulo). Le righe già nello stato «fatto» non compaiono; si leggono dall'elenco normale del modulo, quindi valgono i permessi di chi guarda. Nessun nome di modulo nel codice. Si aggiunge da Dashboard → modifica → Aggiungi widget → «Da fare» (anche da analisi: `type: agenda`).
- **Visite** (modulo nuovo del pacchetto, `moduli.json`): immobile, cliente interessato, data, ora, chi accompagna, esito (Interessato / Da pensarci / Non interessato / Rimandata); stati Programmata → Conclusa. Entra nell'agenda tramite i ruoli.
- **Provvigioni da incassare** entrano nell'agenda con la loro scadenza (ruoli del pacchetto; «fatto» = incassata).
- **Scaglioni di provvigione** (estensione `scaglioni`): «Percentuale da scaglione» (2% da 500.000 €, 2,5% da 250.000 €, 3% sotto; **soglie e percentuali sono un esempio da adattare** nella formula dal Builder), «Percentuale applicata» (quella scritta a mano vince) e «Provvigione da scaglione». Le formule sono verificate nei test dei calcoli.
- **Sollecito di pagamento** (documento sulle Provvigioni, email al cliente collegato) e **Auguri** (documento sui Clienti): il testo si rivede e si modifica prima dell'invio, come gli altri documenti.
- **«Da attivare»**: Verifica del soggetto (Risk), Invia via PEC, Firma elettronica, Fattura elettronica (SDI) hanno già il pulsante nella scheda, con l'etichetta «da attivare»; premuto, spiega quale servizio di OpenAPI.it serve e non fa nulla né costa nulla. Adattatore segnaposto `da_attivare` (501, `code: da_attivare`): quando il servizio sarà attivo si sostituisce l'`adapter` del blocco con quello vero.
- Test: `agenda-e-segnaposto.test.js`; aggiornati i test dei moduli e dei documenti del pacchetto (che ora ne hanno uno in più). Pacchetto alla versione 5.
- **Per averlo su zucca**: deploy di Super Admin e Aggiorna (il widget «Da fare» si aggiunge da solo, vedi 0.4.54).
- **Non fatto**: l'invio automatico dei solleciti e degli auguri (oggi si inviano a mano dalla scheda), il collegamento reale ai servizi «da attivare».

## 0.4.52 — 7 novembre 2026

**Codice fiscale e partita IVA controllati, passaggi di stato critici davvero bloccanti, dock con il fondo pieno.**

- **Validazione di campo** (`validazione` sul campo, `shared/validazioni-campo.js`): `codice_fiscale_it`, `partita_iva_it`, `codice_fiscale_o_piva_it`. Controllo locale e gratuito (forma e carattere di controllo), fatto dal server alla creazione e alla modifica (400 col nome del campo); un dato vecchio invariato non blocca altre modifiche. Il pacchetto la assegna al campo «Codice fiscale / P.IVA» dei Clienti (marcatore `validazioni:<modulo>`). È il primo gradino della verifica di un nuovo cliente; la verifica del soggetto con Risk resta da fare quando ci saranno prezzi e attivazione.
- **Requisiti di stato bloccanti** per i passaggi critici del pacchetto: fatturata, incassata, preliminare firmato, rogito completato, chiusa, cliente verificato, quota ceduta, richiesta privacy completata. Gli altri restano promemoria. Il test del pacchetto fissa l'elenco.
- **Dock**: sotto il vetro c'è un fondo pieno del colore del tema (82%), così il testo della pagina non si vede attraverso le icone.
- Pacchetto alla versione 4: serve il deploy di Super Admin, poi Aggiorna.

## 0.4.51 — 7 novembre 2026

**Dati dimostrativi da OpenAPI.it, segnati e rimovibili; accento leggibile nel tema scuro; menu Documenti entro lo schermo sul telefono.**

- **Dati dimostrativi** (Impostazioni → Connessioni → OpenAPI.it → «Dati dimostrativi»): il pacchetto del verticale dichiara cosa mostrare (`dimostrativi.json`, versione 3 del pacchetto) e il motore generico `lib/dati-dimostrativi.js` lo carica: imprese reali dalla ricerca gratuita di Visure Camerali, annunci con valutazione e comparabili, e record statici collegati tra loro. Prima di caricare mostra il **piano con i costi** e chiede conferma; rispetta il tetto di spesa. Ogni record creato è segnato `_demo` e **«Togli i dati dimostrativi» li rimuove tutti** senza toccare i dati veri. Rotte `GET/POST/DELETE /api/connections/openapi_it/dati-dimostrativi`. Test `dati-dimostrativi.test.js`.
- **Accento leggibile**: un colore d'accento scuro (il blu notte di zucca) rendeva quasi invisibili le icone e i testi in tema scuro. Il colore scelto non cambia; quello mostrato viene schiarito (o scurito nel tema chiaro) quanto basta per avere contrasto, e si ricalcola al cambio tema. Colori già leggibili: identici.
- **Menu «Documenti» su telefono**: era tagliato sul bordo sinistro; ora occupa la larghezza dello schermo sotto i 640 px.
- **Per averlo su zucca**: Super Admin con il pacchetto v3 (da mettere online), poi «Aggiorna» sul tenant.

## 0.4.50 — 7 novembre 2026

**Ogni richiesta a pagamento a OpenAPI.it chiede prima il costo e finisce in un contatore delle spese del mese.** In più, i riquadri della scheda tornano leggibili.

- **Conferma del costo, chiesta dal server.** Un'azione esterna che consuma un servizio a pagamento (oggi la «Valutazione di mercato») non parte senza `conferma: true`: il server risponde 409 con importo, ambiente, spesa del mese e tetto, e la scheda mostra un riquadro «conferma il costo» con *Procedi* e *Annulla*. Un client non può saltarla. In ambiente di prova il riquadro dice che non si paga e quanto costerebbe in produzione.
- **Registro delle spese** (`openapi_spese`): ogni richiesta riuscita si registra con servizio, costo, utente e ambiente; una richiesta fallita non si registra. **Produzione e prova si contano a parte**: la spesa reale è solo quella di produzione.
- **Tetto di spesa mensile** (facoltativo): una richiesta che lo supererebbe è rifiutata (402) senza chiamare il servizio.
- **Pannello «Spese del mese»** in Impostazioni → Connessioni → OpenAPI.it: contatore del mese, richieste, tetto modificabile, **prezzi per richiesta** (listino del catalogo, modificabili: quelli ignoti si scrivono a mano; vuoto torna al listino) e ultime richieste. Listino noto: catasto 0,10–23,70 €, semaforo di rischio società 0,19 €; i prezzi di Real Estate e di Risk sulle persone non risultano dalle pagine viste.
- **È una stima di Platform** sui prezzi di listino (IVA esclusa): il conto vero è quello di openapi.com. Un prezzo ignoto non blocca: chiede conferma dicendo che il prezzo non è noto e si registra a 0 finché non lo si scrive.
- **Leggibilità**: il riquadro «Per passare a… manca» e gli avvisi avevano testo giallo chiaro su fondo giallo chiaro (illeggibile nel tema chiaro): ora il testo è del colore del tema, il colore sta nel fondo, nel bordo e nelle icone. I dati chiave lunghi (un'email) vanno a capo e occupano due colonne invece di essere tagliati.
- Test nuovo `openapi-spese.test.js` (conferma, registro, produzione e prova, tetto, errore del servizio, validazione, mese corrente); `azioni-esterne.test.js` aggiornato.
- **Non fatto**: i dati dimostrativi da OpenAPI.it (segnati e rimovibili), in arrivo.

## 0.4.49 — 7 novembre 2026

**«Controlla i servizi» di OpenAPI.it, per sapere cosa la chiave collegata può usare davvero.** Con più prodotti da attivare nella console (Risk, Catasto, Visure Camerali…) serviva un modo per vedere cosa è abilitato senza spendere credito.

- **Pulsante in Impostazioni → Connessioni → OpenAPI.it** (visibile a connessione attiva) e rotta `POST /api/connections/openapi_it/servizi` (solo amministratori). Per ogni servizio chiede il token con lo scope di **una lettura gratuita** (l'elenco delle proprie richieste, o un elenco di servizio) e la prova: esito *attivo*, *non abilitato* (con il motivo che dà OpenAPI.it), *token ottenuto* (Real Estate, che è quello della valutazione) o *da verificare*. **Nessun controllo a pagamento parte mai.**
- **L'elenco dei servizi è un dato** (`SERVIZI` in `lib/openapi-it.js`: nome, dominio, rotta): per un prodotto in più si aggiunge una riga. Oggi: Real Estate, Catasto, Risk (report patrimoniale e report sulla persona), Visure camerali. I domini sono quelli del catalogo: nota che le visure camerali stanno su `visurecamerali.openapi.it`, un dominio `.it` diverso dagli altri. In ambiente di prova gli host hanno il prefisso `test.`.
- **La chiave non esce mai** dalla risposta; l'ambiente (prova o produzione) è scritto nel risultato.
- Test nuovo `openapi-servizi.test.js` con un OpenAPI.it finto: non collegato, esiti misti, solo letture, host di prova e di produzione, nessuna credenziale nella risposta.
- **Login fuori centro, corretto.** Nella schermata di accesso la scheda restava appoggiata a sinistra (di circa 80-110 px, di più con un nome lungo): il contenitore dello sfondo prendeva la larghezza del suo contenuto più largo (550 px) e non quella della scheda (384 px). Ora la larghezza sta sul contenitore: misurato in locale, la scheda è centrata (scostamento 0).
- **Da sapere**: Real Estate non ha una lettura gratuita nota, quindi si controlla solo che il token si ottenga. Il Catasto «ricerca per codice fiscale» che è nel codice costa 23,70 € a richiesta e non è collegato a nessun pulsante. Il catalogo e i prezzi sono nella memoria di progetto.

## 0.4.48 — 7 novembre 2026

**La scheda di Immobili vale ora per Clienti, Trattative, Provvigioni, Quote societarie, Richieste privacy e Contatti.** Pacchetto Mediazione immobiliare alla versione 2, più un riquadro «Collegati» generico.

- **Clienti**: sezioni Anagrafica, Contatti, Cosa cerca, Privacy e consensi, Note; dati chiave tipo cliente, telefono, email, budget massimo; per passare a «Documenti inviati» servono codice fiscale o P.IVA e un recapito, per «Cliente verificato» il documento d'identità allegato e la privacy firmata.
- **Trattative**: sezioni Trattativa, Prezzo e provvigioni, Date, Professionisti, Note; dati chiave tipo, prezzo concordato, data del preliminare e del rogito; requisiti per «In corso» (immobile, venditore, acquirente), «Preliminare firmato» (prezzo, data, contratto preliminare allegato), «Rogito completato» (data, atto allegato), «Chiusa» (provvigioni generate).
- **Provvigioni**: sezioni Provvigione, Importi, Scadenze, Note; dati chiave parte, totale con IVA, scadenza, incasso; «Fatturata» chiede importo e scadenza, «Incassata» la data di incasso.
- **Quote societarie** (con il nuovo riquadro Allegati: visura, statuto, atto di cessione), **Richieste privacy** e **Contatti**: dati chiave e un requisito ciascuno (acquirente e valore per «In cessione»; data e proposta firmata per «Ceduta»; la risposta per «Completata»; l'esito per «Svolta»).
- Tutti i requisiti sono **promemoria**, non bloccano. Attività, Note e Report non cambiano: hanno 3-4 campi, bastano i miglioramenti generici.
- **Riquadro «Collegati»** (core, per ogni modulo con relazioni): sotto i dati chiave elenca i moduli che puntano a questo record con il numero («Immobili di proprietà 1, Trattative 2…»); un clic apre quella sezione. I dati chiave di tipo data e data/ora si mostrano come 12/11/2026 e i campi calcolati con le migliaia.
- **Super Admin**: nuova rotta `POST /api/tenants/:slug/pacchetti/sincronizza` per mandare a un tenant il pacchetto aggiornato senza ricostruirne il core (lo fa già da solo ogni Aggiorna).
- Test: coerenza dei requisiti e delle sezioni di tutto il pacchetto (nessun campo in due sezioni, campi citati tra quelli richiesti). I campi citati sono stati controllati uno per uno contro i moduli di zucca.
- **Ordine di messa online**: deploy di Super Admin (porta il pacchetto v2), poi invio a zucca (rotta sopra o Aggiorna); il riquadro «Collegati» arriva con l'Aggiorna.

## 0.4.47 — 7 novembre 2026

**In Aspetto il nome e il logo dell'app si scelgono: prendono il posto di «Platform».** Prima il nome mostrato era quello dato al tenant alla creazione e il logo era uno solo, lo stesso dei documenti.

- **Nome dell'app** (Impostazioni → Aspetto, massimo 40 caratteri, una riga): se impostato è l'unico nome mostrato, senza «Platform» e senza il numero di versione, nella barra laterale, nella schermata di accesso e nel titolo della scheda del browser. Vuoto: tutto come prima.
- **Logo dell'app** (PNG, JPEG o WebP fino a circa 650 KB, oppure un indirizzo https): prende il posto del logo Platform nella barra laterale e nella schermata di accesso. Se non c'è, vale il logo dell'azienda (quello dei PDF); se non c'è nemmeno quello, resta il logo Platform. Il logo dell'azienda per i documenti resta separato.
- Dati in `tenant_settings.app_name` e `app_logo_url`, esposti dalla schermata di accesso (`/api/tenant-info`, senza accesso, come il logo di prima). `PUT /api/settings/azienda` li cambia solo se la richiesta li porta: un client vecchio che rimanda la riga non li azzera. Solo l'amministratore; un logo non valido dà 400.
- **Il marchio sfumato dietro ogni pagina e il login** (lo «sfondo liquid glass») usa lo stesso logo: stessa sfocatura e trasparenza di sempre, con il logo scelto al posto di quello Platform; senza logo, il marchio Platform o l'iniziale del nome scelto. Lo legge da un contesto (`components/IdentitaApp.jsx`) fornito da `App.jsx`, così non serve passare props a ogni pagina.
- Test nuovo `app-identita.test.js`.
- **Da sapere**: un logo scuro su sfondo scuro, sfocato, si vede poco (è lo stesso effetto del marchio Platform); l'icona dell'app sul telefono (PWA) continua a usare il suo colore e non il logo; dopo aver cambiato il nome si ricarica la pagina per vederlo ovunque.

## 0.4.46 — 7 novembre 2026

**Il report di valutazione non copre più la scheda: è una sezione chiusa sotto i dati chiave.** Dalla schermata di zucca: il report occupava la prima pagina e spingeva giù percorso dello stato, «per passare a… manca», dati chiave e sezioni.

- **L'esito di un'azione esterna** (blocco `external_action` con una `vista`) si mostra in una riga apribile con il nome dell'azione e una sintesi (per la valutazione: «2.371–3.476 €/mq · stima 845.000 € · 07/11/2026»), sotto i dati chiave e prima dei campi. Si apre con un clic e **da sola subito dopo aver eseguito l'azione**; «Scarica PDF» resta dentro.
- **Ordine della scheda**: avviso, documento in preparazione, percorso dello stato, «manca», dati chiave, esito delle azioni, abbinamenti, campi per sezione, riquadri (Stato, Cronologia, Allegati…).
- Vale per ogni modulo con un'azione esterna con vista: la sintesi è del registro delle viste (`VISTE_AZIONE`), non di Immobili.
- Solo interfaccia del core. Provato in locale.

## 0.4.45 — 7 novembre 2026

**I pacchetti di verticale vivono in Super Admin, accanto all'analisi, e il core non ne contiene più.** Ultimo punto del piano di modularità: i dati di Mediazione immobiliare erano ancora una cartella dentro il core.

- **Super Admin** custodisce i pacchetti in `super-admin/backend/src/pacchetti/<nome>/` (una parte per tipo di blocco, più `pacchetto.json` con nome, descrizione e **versione**) e li **invia** ai tenant (`lib/pacchetti.js`): alla creazione, quando l'analisi sceglie il pacchetto, e a ogni **Aggiorna** di un tenant (best-effort, con una riga nel popup di avanzamento: «Pacchetti aggiornati: …»).
- **Il tenant riceve e tiene il pacchetto** (`pacchetti_ricevuti`, con la versione) e lo applica ai riavvii anche senza Super Admin. `POST /api/internal-setup/pacchetto` ora accetta `{ slug, versione, parti }` (nome, forma e dimensione controllati, parti sconosciute scartate, tetto 2 MB); `GET /api/internal-setup/pacchetti` dice cosa ha il tenant e quali blocchi ha già applicato. Il core non ha più cartelle di pacchetti.
- **Riallineamento**: un tenant che aveva già applicato blocchi del pacchetto prima che esistessero (zucca) viene riconosciuto dai blocchi già applicati (la definizione dei marcatori è una sola, in `shared/pacchetto-marcatori.js`, usata da core e Super Admin) e riceve il pacchetto all'Aggiorna. Un tenant che non usa pacchetti (Finance) non riceve niente.
- **Per cambiare un pacchetto**: si cambiano i dati e si **aumenta `versione`** in `pacchetto.json`; i tenant lo ricevono all'Aggiorna successivo.
- Test: `pacchetti.test.js` nel core (ricezione, forma, marcatori, rotte) e in Super Admin (lettura, invio, riallineamento con un tenant finto). I test del core che usano il pacchetto come esempio lo leggono da Super Admin.
- **Ordine di messa online**: prima Super Admin (invia il pacchetto anche a un core vecchio, che usa ancora il suo), poi l'Aggiorna dei tenant.

## 0.4.44 — 7 novembre 2026

**«Per passare a… manca» sulla scheda, dichiarato nello schema e non nel codice.** Ultimo punto del piano di modularità sulla scheda Immobili.

- **Blocco di schema `state_requirements`**: per uno stato di arrivo (`stato`) elenca i requisiti, ognuno di un tipo: un **campo** compilato (anche una relazione o l'esito salvato di un'azione esterna), **uno tra più campi**, un **allegato** di un certo tipo. Un solo calcolo, puro, in `shared/requisiti-stato.js`, usato da server e scheda.
- **Scheda**: sotto il percorso dello stato compare, per ogni passaggio possibile da dove si trova il record, un riquadro con i requisiti spuntati o no: «Per passare a «In vendita» manca …» (giallo) oppure «Tutto pronto per passare a …» (verde).
- **Bloccante o promemoria**: con `bloccante` spuntato (dal Builder) il server rifiuta il passaggio e risponde con ciò che manca (`400`, «Per passare a «X» manca: a, b.»); senza è solo un promemoria. Il Builder conserva il blocco e permette di scegliere lo stato, spuntare «Bloccante», rinominare e togliere i requisiti.
- **Pacchetto Mediazione immobiliare**: nuova estensione `requisiti_stato` su Immobili, solo promemoria. **In mandato**: proprietario, indirizzo o comune, tipologia di incarico. **In vendita**: prezzo richiesto, valutazione di mercato, scheda di acquisizione firmata, foto. Arriva a zucca con l'Aggiorna.
- Test nuovo `requisiti-stato.test.js` (ogni tipo di requisito, passaggi possibili, blocco sul server con e senza allegato, non bloccante, il blocco del pacchetto).
- **Piano di modularità**: tutti e tre i punti sono fatti (pacchetti, azione esterna, requisiti). Resta lo spostamento dei pacchetti dal repository del core a Super Admin.

## 0.4.43 — 7 novembre 2026

**La «Valutazione di mercato» non è più codice scritto per Immobili: è un'azione esterna dichiarata nello schema del modulo.** Era l'ultima eccezione nella scheda: il pulsante e le rotte (`/immobili/:id/valuta`, `/immobili/:id/valutazione/pdf`) conoscevano il modulo e i suoi campi. Il commento nel codice lo ammetteva («finché non esiste un secondo caso»).

- **Blocco di schema `external_action`**: un pulsante sul record che chiama un servizio esterno e scrive l'esito sul record. Dichiara il nome, l'icona, l'**adattatore** da usare, la **connessione** richiesta, i campi che legge (`campi`) e quelli in cui scrive (`esito`), dove tiene l'esito (`risultato_in`), la **vista** con cui mostrarlo e se produce un PDF. Il Builder lo conserva e mostra una scheda con il nome del pulsante; si aggiunge dal pacchetto del verticale.
- **Rotte generiche** `POST /api/records/:slug/:id/azione/:key` e `…/pdf` (solo amministratori, con l'accesso al modulo). Gli adattatori sono un **elenco chiuso** nel core (`lib/azioni-esterne/`): un blocco non può caricare codice a piacere; un adattatore sconosciuto dà un errore chiaro. Se il servizio fallisce non si scrive nulla sul record.
- **Adattatore `valutazione_immobiliare`**: la logica di prima, spostata senza cambiare il comportamento (quotazioni OpenAPI.it, comparabili, OMI, fotovoltaico, zona sismica, considerazioni). Non conosce nomi di campi: i codici delle tipologie sono nel blocco, quindi dati del pacchetto.
- **Interfaccia**: i pulsanti e la vista dell'esito nascono dai blocchi del modulo, non da `slug === 'immobili'`; l'avviso «connessione non collegata» vale per la connessione dichiarata dal blocco; i dati minimi richiesti (`richiede_uno_di`) si controllano prima di chiamare.
- **Pacchetto Mediazione immobiliare**: nuova estensione `valutazione_mercato` che aggiunge il blocco a Immobili. Su zucca arriva con l'Aggiorna, senza cambiare i dati già valutati: il report salvato sul record (`report_valutazione`) è lo stesso.
- Test nuovo `azioni-esterne.test.js` (adattatori chiusi, esecuzione con servizio finto, errori, nessuna scrittura se fallisce) e `valutazione-pdf.test.js` sulle rotte nuove.
- **Prossimo passo del piano**: i requisiti per stato («per passare a… manca»).

## 0.4.42 — 7 novembre 2026

**I dati di un verticale diventano un pacchetto che l'analisi sceglie, e il core non porta più nessun nome di settore.** Prima il motore dei seed leggeva file con «immobiliare» nel nome: con un secondo verticale si sarebbe dovuto modificare il core.

- **Cartella `core/backend/src/pacchetti/<nome>/`** con una parte per tipo di blocco (documenti, abbinamenti, estensioni, moduli, ruoli, relazioni, proprietà, sezioni). I file di Mediazione immobiliare si sono spostati in `pacchetti/mediazione-immobiliare/` (stesso contenuto, nomi neutri). Per un altro verticale basta un'altra cartella.
- **Attivazione per tenant** (tabella `pacchetti_attivi`): il tenant applica solo i pacchetti attivi. Li sceglie l'analisi (`configurazione.pacchetti`) alla creazione, con la nuova rotta `POST /api/internal-setup/pacchetto` (secret interno; 404 con l'elenco dei disponibili se il nome non esiste).
- **Nessuna migrazione da fare a mano**: un tenant che aveva già applicato blocchi di un pacchetto (zucca) lo riconosce dai marcatori e lo attiva da solo al riavvio. Un tenant senza pacchetti (Finance) non applica più nulla invece di leggere i seed a ogni avvio.
- Test nuovi: `pacchetti.test.js` (cartella, attivazione, riconoscimento dai marcatori, rotta) e un caso in `workflow-ritorni.test.js`.
- **Da sapere**: per i tenant nuovi dall'analisi serve `configurazione.pacchetti = ["mediazione-immobiliare"]` nell'analisi (dopo il deploy di Super Admin). I pacchetti stanno ancora nel repository del core: spostarli in Super Admin, accanto all'analisi, è il passo successivo.

## 0.4.41 — 7 novembre 2026

**Il dettaglio di un record si legge dall'alto verso il basso invece di essere un elenco di 95 righe.** Primo passo della scheda Immobili più chiara, fatto con mattoni generici (valgono per ogni modulo), non con una pagina su misura.

- **Percorso dello stato** in cima al dettaglio (per i moduli con un flusso): tutte le tappe in fila, quella attuale evidenziata.
- **Dati chiave** (proprietà `dato_chiave` di un campo, casella «Dato chiave» nel Builder): quattro riquadri in alto con i valori che contano (per Immobili: prezzo richiesto, valore stimato, superficie, locali).
- **Sezioni** (proprietà `sezione` di un campo, campo «Sezione» nel Builder): i campi con la stessa sezione stanno insieme in un blocco che si apre e si chiude; la prima sezione è aperta, le altre chiuse con il numero di campi.
- **Campi vuoti nascosti**, con «Mostra anche i N campi vuoti» in fondo: in un immobile quasi nuovo è la riduzione più grande.
- **Menu «Documenti»**: quando un modulo ha due o più documenti, un solo pulsante apre l'elenco, con a fianco di ognuno che cosa fa (email da rivedere, oppure PDF da firmare e scansione da ricaricare). Con un solo documento resta il pulsante di prima.
- **Seed `seeds/sezioni-immobiliare.json`** (`assegnaSezioni`): assegna a Immobili 10 sezioni (Annuncio e posizione, Prezzi e valutazione, Dimensioni e composizione, Edificio, Finiture e impianti, Catasto e documenti, Spese e vincoli, Proprietà e incarico, Riacquisto, Note) e i quattro dati chiave. Una volta sola, solo sui campi che non hanno già una sezione; poi si cambiano dal Builder e non tornano indietro.
- Test nuovo in `moduli-verticale.test.js`.
- **Non fatto (prossimo passo)**: il blocco «per passare a… manca» con la regola di ogni passaggio, e togliere i controlli «OpenAPI.it collegato» quando il modulo lo richiederà per l'installazione.

## 0.4.40 — 7 novembre 2026

**Il dettaglio Immobili dice cosa succede quando si preme un pulsante.** I tre pulsanti in alto sembravano non fare nulla: il pannello dei documenti si apriva sotto il report di valutazione e gli abbinamenti, fuori schermo, e gli errori comparivano in un avviso che spariva in pochi secondi.

- **Il pannello del documento si apre in vista**: appena si preme «Scheda …» la scheda scorre fino al pannello.
- **Avviso fisso in cima alla scheda** (con «Modifica» dove serve) al posto dell'avviso che spariva: manca l'indirizzo o il comune per valutare; OpenAPI.it non è collegato (e dove si collega); la valutazione o la preparazione di un documento non sono riuscite, con il motivo.
- **Nomi più chiari**: «Valutazione di mercato» al posto di «Valuta con OpenAPI.it»; i documenti che si spediscono per email portano «· email» accanto al nome, e ogni pulsante ha un suggerimento che dice cosa fa (email da rivedere prima di spedirla, oppure PDF da firmare e scansione da ricaricare).
- Solo interfaccia del core (`ModulePage/RecordDetailModal.jsx`): nessun dato cambia. Il controllo della connessione OpenAPI.it avviene all'apertura della scheda.
- **Non fatto (prossimo passo proposto)**: scheda a sezioni con i dati chiave in alto e blocco «Documenti» con lo stato della firma.

## 0.4.39 — 7 novembre 2026

**Il cerchio rapido in tabella non compare più in Immobili e Clienti.** Il cerchio (cambia stato senza aprire la riga) si deduce da due stati che si rimandano indietro; in Immobili sono In vendita ↔ In trattativa e in Clienti Documenti inviati ↔ Verifica identità: non sono «fatto / da fare», quindi su una riga come «Ritirato» il cerchio non vuol dire niente.

- **Seed `seeds/proprieta-immobiliare.json`** (`impostaProprieta`): imposta `quick_toggle: 0` su Immobili e Clienti una volta sola, dalla rotta vera dei moduli; se poi si riaccende dal Builder («Cerchio rapido in tabella») non torna spento. Vale per zucca (all'**Aggiorna**) e per i tenant nuovi.
- Test nuovo in `moduli-verticale.test.js`.
- Lasciato com'è su Attività, dove il cerchio ha senso.

## 0.4.38 — 7 novembre 2026

**La relazione «Cliente» di Richieste Privacy ora punta al Clienti vero.** Il modulo della Libreria cita `clienti_generico`, uno slug che nei tenant di questo verticale non esiste (il modulo si chiama `clienti`): l'app legge i record dello slug citato, quindi il campo non mostrava nessun cliente. Trovato confrontando zucca con un tenant nato dall'analisi: lo avevano entrambi.

- **Seed `seeds/relazioni-immobiliare.json`** (`riallineaRelazioni` in `seed-blocchi-verticale.js`): una relazione che cita un modulo inesistente (né come slug né come slug della Libreria) si riallinea al modulo giusto, e il campo mostrato passa a `nome` (prima `ragione_sociale`, che Clienti non ha). Da bozza e pubblicazione del Builder, una volta sola per relazione; se il vecchio bersaglio esiste o il nuovo manca, non tocca nulla.
- Vale per zucca (all'**Aggiorna**) e per ogni tenant nuovo del verticale, senza modificare il modulo nella Libreria.
- Test nuovo in `moduli-verticale.test.js`.
- **Da sapere**: i record di Richieste Privacy già scritti non hanno un cliente collegato (il campo era vuoto); si collega a mano dove serve.

## 0.4.37 — 7 novembre 2026

**Società e cessione di quote, e Promemoria e ricorrenze: i due lavori «da costruire» dell'analisi di zucca sono costruiti.** Più i widget della Dashboard dell'analisi.

- **Quote societarie** (nuovo modulo, creato dai seed `seeds/moduli-immobiliare.json` solo dove esistono Clienti e Immobili; mai sovrascritto): società, socio cedente, quota %, valore, immobile detenuto dalla società, acquirente della quota, date, flusso In essere → In cessione → Ceduta. Il **documento da firmare «Proposta di cessione quote»** (`documenti-immobiliare.json`) porta un avviso: è un modello da far rivedere dal notaio o dal commercialista, la cessione si perfeziona con atto notarile o firma autenticata e deposito al Registro delle Imprese.
- **Report «Ricorrenze»** (tipo `ricorrenze`, spento alla nascita): compleanni e date annuali nei prossimi N giorni, con l'età. Nuovo tipo di modulo **anagrafica** (ruoli `descrizione` e `data_ricorrenza`, Builder → Ruoli del modulo); il seed dichiara Clienti come anagrafica. È un avviso all'agente: gli **auguri al cliente non partono da soli** (servirebbe il consenso alle comunicazioni commerciali).
- **Analisi**: `configurazione.report` (report creati spenti alla nascita) e widget di tipo «periodo» con campo data e periodo (`configurazione.dashboard`). La rotta `/api/internal-setup/apply` salva i widget con `roles` e `user_ids` come la Dashboard («[]», non vuoto).
- Test nuovi: `ricorrenze.test.js`, `moduli-verticale.test.js`, casi in `internal-setup.test.js` e `workflow-ritorni.test.js`.
- **Da sapere**: su zucca i due nuovi pezzi arrivano con l'**Aggiorna** (il modulo e le ruoli si creano all'avvio); il report Ricorrenze va aggiunto da Impostazioni → Report e acceso. Trovato lungo la strada, non toccato: la relazione «Cliente» di Richieste Privacy cita `clienti_generico`, uno slug che nei tenant di questo verticale non esiste (c'è `clienti`).

## 0.4.36 — 7 novembre 2026

**La pagina dell'analisi dice le cose giuste.** Dopo la copia di zucca il riepilogo mostrava «5 processi non sono completi» e «Ruoli utente 3» anche se l'analisi era completa.

- **Processo «senza flusso»** (`senza_flusso`, casella nell'editor del processo quando non ha passaggi): non fa avanzare record in stati (Attività, Report, Privacy), quindi non conta più come incompleto e non va completato con l'AI, che inventerebbe passaggi.
- **Riepilogo**: «Ruoli utente» conta i ruoli della `configurazione` quando c'è (11 per zucca, prima 3 dai processi); compaiono anche «AI generale» e «Widget Dashboard».
- Test nuovo in `workflow-ritorni.test.js`.

## 0.4.35 — 7 novembre 2026

**L'analisi porta anche l'AI e la Dashboard.** Il confronto delle impostazioni (non solo dei moduli) tra zucca e un tenant nato dall'analisi ha mostrato due differenze: zucca ha l'interruttore generale dell'AI acceso e 5 widget in Dashboard, il tenant nuovo no.

- **`configurazione.ai_attiva`**: l'AI generale nasce SPENTA (manda dati a un servizio esterno) e si accende solo se l'analisi lo dice esplicitamente. `POST /api/internal-setup/apply` accetta `ai_master: true`.
- **`configurazione.dashboard`**: widget (tipo, modulo, campo, aggregazione, etichetta) creati alla nascita, solo se la Dashboard è vuota e il modulo è installato; valori non validi si saltano dicendolo.
- Test nuovi in `internal-setup.test.js` e `workflow-ritorni.test.js`.
- **Non si copia**: la connessione OpenAPI.it di zucca (chiave segreta: si inserisce nel tenant), i record e lo storico, l'ordine di menu dei moduli (differisce di pochi punti).
- **Per averlo nei tenant nuovi serve l'Aggiorna** di un tenant (ricostruisce l'immagine del core).

## 0.4.34 — 7 novembre 2026

**L'analisi può riprodurre un tenant esistente, ruoli e flussi compresi.** Il confronto con zucca mostrava ancora tre differenze (flussi di Note e Report, ruoli, permessi e relazioni in più). Erano residui di una vecchia analisi di ottobre su zucca; l'analisi non aveva modo di dichiararli.

- **`profilo.configurazione`** (Super Admin → Analisi): elenco ordinato dei ruoli del tenant (il colore dipende dalla posizione) e, per modulo, i permessi e il flusso con il testo di ogni azione (`azione`, `ritorna_etichetta`, `colore` su ogni passaggio). Se c'è, è l'unica fonte per ruoli, permessi e flussi: i processi restano documentazione. Se manca, tutto funziona come prima.
- **`relazioni_ai: false`** salta la proposta di relazioni dell'AI, che non è ripetibile e aggiungeva relazioni a zucca assenti.
- Test nuovi in `workflow-ritorni.test.js`.

## 0.4.33 — 7 novembre 2026

**L'analisi porta con sé il marchio e i ritorni indietro del flusso.** Dal confronto tra un tenant nato da un'analisi e zucca restavano tre differenze che non erano limiti ma mancanze dell'analisi.

- **Marchio nel profilo dell'analisi** (`profilo.marchio`: ragione sociale, indirizzo, P.IVA, logo, colore): alla fine della creazione Super Admin lo applica al tenant con `POST /api/internal-setup/azienda` (solo secret interno). Regola dei file `internal-setup`: si completa, non si sovrascrive; logo o colore non validi si scartano dicendolo. La regola sul logo sta ora in `core/backend/src/lib/azienda.js`, usata anche dalle Impostazioni. Il logo non ha ancora un campo nell'interfaccia di Analisi: si imposta dal tenant (Impostazioni → Aspetto).
- **Ritorno indietro nei flussi** (`ritorna_a` su un passaggio): il generatore aggiunge la transizione «Torna a …» con i ruoli del passaggio (es. «documenti da rifare» di Clienti). Prima nascevano solo gli avanzamenti in fila.
- **Note e Report**: nell'analisi di zucca sono processi a sé. Note ha il flusso Bozza, Condivisa, Archiviata; Report no, perché è una pagina a widget senza record da far avanzare.
- Test nuovi: `workflow-ritorni.test.js` (Super Admin) e il caso `/azienda` in `internal-setup.test.js`.
- **Non coperto**: logo, P.IVA e indirizzo di zucca (non forniti, restano vuoti e quindi assenti dai PDF).

## 0.4.32 — 7 novembre 2026

**Un tenant nato dall'analisi ora arriva completo, non dopo due riavvii.** Provando l'analisi di zucca su un tenant di prova (copia dell'analisi, poi eliminato) è emerso che Clienti restava a 6 campi, senza documenti né abbinamento: i seed del verticale si applicavano solo all'avvio del tenant, quando i moduli non erano ancora installati, e un solo giro non bastava perché la scheda di Immobili cita campi di Clienti che si estende dopo. Dopo due riavvii il tenant di prova coincideva con zucca (Clienti a 24 campi, 3 documenti, abbinamento, allegati).

- **Seed in più giri** (`seed-blocchi-verticale.js`): `run()` ripete finché c'è qualcosa da applicare, al massimo 4 giri; ogni giro resta idempotente.
- **Fine della creazione** (Super Admin → Analisi → Crea il tenant): chiama `POST /api/internal-setup/seed` sul tenant appena nato (solo con il secret interno). Se non riesce non blocca: compare un avviso e i seed arrivano al riavvio.
- Test nuovi in `internal-setup.test.js` (la rotta e la ripetizione innocua).
- **Differenze rimaste rispetto a zucca**: Note, Report e Richieste Privacy nascono senza i flussi che zucca ha dalla vecchia analisi di ottobre (stati «Registrazione richiesta», «Raccolta dati vendite»…, poco sensati per quei moduli); Clienti ha 2 transizioni invece di 3 (nasce dai 3 passaggi dell'analisi). Logo, colore e dati azienda non si copiano.

## 0.4.31 — 7 novembre 2026

**Il Clienti di zucca non ha più bisogno di una copia nella Libreria.** Per far nascere da un'analisi un tenant uguale a zucca, i moduli di zucca erano stati pubblicati nella Libreria: cinque di loro (Clienti, Attività, Note, Report, Richieste Privacy) avevano un omonimo generico, cioè un doppione. I moduli sono generici apposta: la specificità di un verticale si applica come estensione, non come copia.

- **Estensione `clienti:profilo_mediazione`** (`seeds/estensioni-immobiliare.json`): data di nascita, tipo soggetto, codice fiscale o P.IVA, tipo cliente, esigenza e i tre campi di ricerca dell'acquirente. In zucca erano stati aggiunti a mano nel Builder; ora un Clienti generico a 6 campi li riceve da solo, come gli altri. Su zucca i campi ci sono già e non cambia nulla. Test nuovo in `scheda-completa.test.js`.
- **Libreria di Super Admin**: tolte le cinque copie. Restano di zucca solo Immobili, Trattative, Provvigioni e Interazioni, che non hanno un omonimo generico.
- **Analisi «Mediazione immobiliare»** (Super Admin): 13 processi, ognuno agganciato al suo modulo (i generici per Clienti, Attività, Note, Report, Richieste Privacy). Due sono «da costruire»: società e cessione di quote, promemoria e ricorrenze.
- **Da sapere**: workflow e permessi dei moduli nascono dall'analisi alla creazione del tenant; logo, colore e dati azienda sono impostazioni del tenant e non si copiano. Un tenant di prova creato dall'analisi non è ancora stato confrontato con zucca.

## 0.4.30 — 6 novembre 2026

**Gli allegati dei documenti del cliente non si potevano caricare: corretto.** Scrivendo la relazione su zucca si è scoperto che nessun modulo del verticale aveva il riquadro «Allegati» (il blocco «Allegati tipizzati»): sul cliente non c'era modo di allegare copia del documento, attualità della residenza, atto di provenienza o i moduli firmati. L'unico allegato possibile era il firmato dei documenti da firmare.

- **Clienti**: riquadro «Allegati» con i tipi documento di identità, codice fiscale, attualità della residenza, atto di provenienza (venditore), atto di matrimonio (acquirente, facoltativo), privacy e incarico firmato, antiriciclaggio firmato, altro.
- **Immobili**: tipi della checklist della scheda (atto di provenienza e di successione, visura e planimetria catastale, APE, regolamento e verbali del condominio, certificazione impianti, foto, altro).
- **Trattative**: proposta d'acquisto, contratto preliminare, atto di rogito, altro.
- Arrivano su zucca con «Aggiorna», come le altre estensioni (una volta sola; se un modulo ha già il suo riquadro Allegati non si aggiunge un secondo). Test aggiornati.
- **Non coperto**: l'avviso quando un allegato richiesto manca (il blocco elenca i tipi, non li rende obbligatori); l'upload del firmato di un documento spedito per email.
- **Relazione e Guida** (`docs/zucca/`) corrette: la prima versione affermava che si poteva già allegare qualunque file al cliente, e non era vero.

## 0.4.29 — 6 novembre 2026

**Relazione processi e Guida all'uso di zucca, aggiornate e con il marchio.** I due documenti che l'utente si aspettava in admin non erano allineati: l'analisi salvata in Super Admin è del 30 ottobre (8 processi generici, «Catalogazione immobili» ancora «da costruire») e non conosce i documenti, la scheda completa, l'abbinamento né le provvigioni a due parti.

- **Testi**: `docs/zucca/relazione-processi.txt` (13 processi con come funziona, stato coperto o da fare, cosa manca, e la risposta a «abbiamo coperto tutto?») e `docs/zucca/guida-all-uso.txt` (9 passi di lavoro, dal nuovo cliente alla privacy, con le domande frequenti). Si basano sui moduli installati su zucca letti in sola lettura il 6 novembre.
- **PDF**: `node scripts/genera-documenti-zucca.js <cartella> [logo.png]` crea «Relazione» e «Guida» con l'identità grafica comune.
- **Piccola correzione ai PDF**: la linguetta scura dell'intestazione vale solo per il riquadro dei consensi (una scheda con caselle di altro tipo ha l'intestazione normale); nei campi già compilati la riga sotto il valore è leggera, piena solo dove si scrive.
- **Non fatto**: l'analisi dentro Super Admin (Analisi) non è stata aggiornata: va fatto dall'interfaccia di Super Admin (non si scrive sul suo database) e richiede l'accesso.

## 0.4.28 — 6 novembre 2026

**Documenti impaginati con stile, e report nella UI con la stessa grafica.** Su indicazione dell'utente (mockup di riferimento): i PDF dei documenti non sono più testo in colonna ma schede.

- **PDF dei documenti**: ricostruiti sul modello grafico fornito dall'utente (mockup «Anagrafica + privacy»): fascia sfumata con logo e «pillola» del tipo di documento con la data; titolo in serif con la parentesi più piccola, filetto azzurro e sottotitolo spaziato; ogni sezione è una **scheda** con ombra, intestazione azzurra sfumata, **icona** nel riquadro scuro e titolo in maiuscolo; i campi sono «Etichetta ______» con la riga su cui scrivere (più campi affiancati sulla stessa riga); le voci lunghe hanno **icona rotonda**, titoletto colorato e paragrafo, separate da un filetto; la scheda dei **consensi** ha la linguetta scura con taglio diagonale e le caselle grandi, con la dichiarazione finale in corsivo con la penna; «Luogo e data» e «Firma» hanno le loro icone; piè di pagina con il nome dell'azienda in corsivo e «Pagina N di M». Una scheda di soli campi seguita da una di voci si affiancano su **due colonne**; una scheda lunga continua nella pagina dopo con «(segue)». La regola di lettura del testo è nel commento di `lib/documento-pdf.js`.
- **Report di valutazione nella UI**: stessi riquadri del PDF (minimo/medio/massimo, valore stimato in evidenza), considerazioni in citazione, schede con tabelle (OMI, comparabili) e **barre** (mercato, tempi di vendita, annunci per tipologia e superficie), territorio e zona. Mostra l'avviso se i dati sono di un altro comune. Le migliaia sono sempre separate dal punto (anche a 4 cifre), come nel PDF.
- Pannello del testo di un documento: area più ampia e leggibile, con una riga che spiega come le righe diventano sezioni, campi e caselle.
- **Non coperto**: il carattere del marchio (nei PDF si vede un serif standard, non Miller Banner); il documento dell'anagrafica occupa 2 pagine invece di 1 perché il testo dell'informativa è più lungo di quello del mockup (che ha una «sintesi»); le icone si scelgono dalle parole del titolo, non da una scelta esplicita. Il servizio pubblico di OpenStreetMap (Overpass) non rispondeva in tempo: la fase 2 del report (mappa, servizi, percorrenze) non è integrata e il codice di prova non è nel repository.

## 0.4.27 — 6 novembre 2026

**La scheda di acquisizione dell'agenzia, per intero.** Il modulo che compilano gli agenti (11 sezioni) ora ha tutti i suoi campi, e il documento da firmare lo riproduce uguale. Confrontata voce per voce con il PDF di Zucca&Partners.

- **Immobili — campi nuovi**: data sopralluogo, agente acquisitore (e suo telefono/email), stato interno, terrazzo (mq), portico (mq), pavimenti «altro», valore IPE (Eph), potenza batteria di accumulo (kW), altri documenti / note, prezzo consigliato di mercato, note e punti di forza.
- **Immobili — caselle da spuntare**: le voci che nel modulo cartaceo sono caselle (composizione vani, sfogo esterno, pertinenze e box, posto auto, oscuranti e protezioni, pavimenti, diffusione e alimentazione del riscaldamento, accessori impianti, cosa comprendono le spese, checklist documenti) erano testo libero o scelta singola: ora sono **elenchi a scelta multipla**. I valori già scritti si convertono (zucca ha un solo immobile, senza questi valori).
- **Clienti — campi nuovi** (servono per ogni comproprietario): luogo di nascita, stato civile, regime patrimoniale, residenza, PEC.
- **Nuovo documento «Scheda di acquisizione (da firmare)»** sull'Immobile: le 11 sezioni, i dati dei 3 comproprietari (le righe vuote da compilare a mano), l'informativa privacy del modulo e le firme dei comproprietari e dell'agente. Si vede in anteprima, si scarica in PDF, si firma e si ricarica come gli altri documenti da firmare. Il vecchio «Scheda immobile» (invio per email) resta, ma ha meno campi.
- **Motore dei seed**: nuova chiave `converti` nelle estensioni (un campo di testo o scelta diventa elenco a scelta multipla, con id ed etichetta invariati e i valori già scritti convertiti). Da tipi non compatibili (numero, data…) non si converte: l'estensione non si applica e il campo resta intatto.
- Test `scheda-completa.test.js` (6) e `documento-da-modello.test.js` aggiornato.
- **Identità grafica comune a tutti i PDF** (richiesta: «tutta la documentazione generata deve avere l'identità del report»): fascia con logo e colore dell'azienda, titoli con grazie, titoletti con barra colorata, firma e piè di pagina «Pagina N di M» con i dati dell'azienda. Vale per il report di valutazione e per tutti i documenti da modello e da firmare (privacy, antiriciclaggio, anagrafica, scheda). Codice in `lib/identita-pdf.js`; `documento-pdf.js` e `report-valutazione-pdf.js` lo usano; le rotte leggono logo e dati da Impostazioni → Aspetto.
- **Non coperto**: il carattere del marchio (Miller Banner, Brandon Grotesque) non è incorporato: servono i file del font (OTF/TTF) e un posto dove caricarli; intanto si usa un serif standard per i titoli. La scheda non cambia in automatico lo stato dell'immobile alla firma. La fase 2 del report (mappa, servizi, percorrenze) non è ancora integrata: il servizio pubblico Overpass di OpenStreetMap oggi non risponde in tempo.

## 0.4.26 — 6 novembre 2026

**Report di valutazione con grafica e marchio dell'azienda.** Il PDF della 0.4.25 (solo testo) diventa un documento impaginato: fascia in alto con logo e colore dell'azienda, tre riquadri con minimo, medio e massimo €/mq, valore stimato in evidenza, tabelle (OMI, comparabili), barre per mercato, tempi di vendita e annunci, piè di pagina con i dati dell'azienda e «Pagina N di M». Titoli in carattere con grazie; il carattere del marchio Zucca&Partners (Miller Banner) non è incorporabile, quindi è una resa vicina, non identica.

- **Dati azienda**: nuova scheda in Impostazioni → Aspetto con ragione sociale, indirizzo, partita IVA e logo (PNG, JPEG o WebP fino a ~650 KB, incorporato nel record). Il logo si accetta solo come immagine incorporata o indirizzo https (`PUT /settings/azienda` rifiuta il resto). **Attenzione**: il logo e il colore principale valgono anche per l'interfaccia dell'app (barra laterale, accesso, icona sul dock).
- **Paragrafo «considerazioni» coerente**: usa la città trovata dal report, non il comune scritto sul record, così non mescola due luoghi.
- Se il logo manca o non si legge, nella fascia compare il nome dell'azienda; senza nome, il titolo «Report di valutazione».
- Rimosso il builder di solo testo (`lib/report-valutazione.js`): resta `lib/report-valutazione-pdf.js`. Test `valutazione-pdf.test.js` (7).
- **Non coperto**: mappe e satellite, servizi di zona, redditi ISTAT, tempi di percorrenza (fase 2); telefono, email e sito dell'agenzia non hanno ancora un campo; il piè di pagina mostra nome, indirizzo e P.IVA.

## 0.4.25 — 6 novembre 2026

**PDF completo del report di valutazione.** Nel dettaglio di un Immobile valutato il bottone «Scarica PDF» (al posto di «Stampa o salva in PDF») scarica un PDF vero, su più pagine, con tutto quello che il report contiene: immobile, quotazione e valore stimato (media × superficie, con intervallo), considerazioni del valutatore, quotazioni OMI, comparabili, rischio sismico, fotovoltaico, andamento del mercato, tempi di vendita, annunci per tipologia e superficie, dati della zona, avvertenza.

- Il PDF nasce dal report **già salvato** sul record: nessuna chiamata a OpenAPI.it, nessun credito consumato. Per rifare i dati si rilancia la valutazione.
- Se i dati di mercato si riferiscono a un comune diverso da quello dell'immobile, il PDF lo dice in cima («ATTENZIONE…»); senza superficie spiega perché il valore stimato non c'è.
- Nuova rotta `POST /records/immobili/:id/valutazione/pdf` (solo admin, tracciata nell'audit), `lib/report-valutazione.js` (testo), riuso di `lib/documento-pdf.js`. Test `valutazione-pdf.test.js` (4).
- **Non coperto**: mappe e vista satellitare, servizi di zona, redditi ISTAT, tempi di percorrenza (fase 2); il PDF è solo testo, senza tabelle né grafici.

## 0.4.24 — 6 novembre 2026

**Provvigione a due parti: venditore e acquirente.** Alla firma del preliminare nascono due righe di provvigione, una per parte, con importo netto, IVA e totale già calcolati.

- **Trattative**: nuovi campi «Venditore», «Acquirente», «Provvigione venditore (%)», «Provvigione acquirente (%)» e «Provvigioni generate il».
- **Provvigioni**: nuovi campi «Parte», «Percentuale provvigione (%)», «Prezzo su cui si calcola» e i calcolati «Importo netto», «IVA 22%», «Totale con IVA». Le provvigioni già inserite con il solo importo continuano a funzionare.
- **Automazione «Provvigioni alla firma del preliminare»** (si vede e si modifica dal Builder): una riga per ogni parte con percentuale, cliente della parte, scadenza al rogito, stato «da fatturare». Riaprire e rifirmare non duplica; senza percentuali non nasce nulla e si può rifare dopo.
- **Come arriva su zucca**: al primo avvio dopo l'aggiornamento, dal seed (`estensioni-immobiliare.json`), solo se i moduli Provvigioni e Trattative hanno i campi attesi. Nuovo meccanismo riusabile: le «estensioni» di moduli.
- **Da sapere**: il prezzo della provvigione è una copia fatta alla firma: se il prezzo concordato cambia dopo, la riga già generata non si aggiorna (si corregge a mano). La fattura si emette fuori da Platform; qui si segnano «fatturata» e «incassata». Se una parte aveva la percentuale vuota alla firma, quella riga va creata a mano.
- **Test**: `provvigioni-due-parti.test.js` (8); suite del core 86.

## 0.4.23 — 6 novembre 2026

**Documento da firmare, ricaricare e gestire in ottica GDPR.** La nuova Anagrafica di un cliente genera un PDF da scaricare e far firmare; la copia firmata si ricarica sul record e registra consensi, data, versione e scadenza dei dati.

- **Nuova modalità del «Documento da modello»** (Builder → «Cosa fa il bottone»): «Genera un PDF da scaricare, far firmare e ricaricare». Si sceglie il tipo dell'allegato firmato, lo stato dopo la firma, i consensi (campi spuntabili), dove scrivere data della firma, versione del testo e fino a quando si conservano i dati (data della firma + N mesi).
- **Nel dettaglio del record**: anteprima modificabile, «Scarica PDF da firmare» (A4, caselle da barrare `[ ]`, riquadro Luogo e data / Firma, «Pagina N di M»), poi le copie già firmate, le caselle dei consensi del foglio e il caricamento del file (PDF o foto).
- **Revoca**: ricaricare un nuovo firmato riscrive i consensi e aggiunge una copia; lo storico resta nella cronologia del record e in Attività.
- **Per zucca**: «Anagrafica + privacy (da firmare)» sui Clienti, con consensi (comunicazioni commerciali, comunicazione a partner e portali) e conservazione 10 anni. Al primo avvio il seed crea da sé i 5 campi che servono; se il modulo ha già un campo con lo stesso nome ma di tipo diverso, il documento non si applica.
- **Nuovo filtro** `{{campo|casella}}` nei modelli: `[X]` se spuntato, `[ ]` altrimenti.
- **Da sapere**: non è firma elettronica (carta firmata e scansionata); il testo dell'informativa è un modello da far rivedere da chi cura la privacy; nessun promemoria alla scadenza della conservazione (si fa con le automazioni). Nuova dipendenza `pdfkit` nel backend del core.
- **Test**: `documento-firma.test.js` (11) e seed in `documento-da-modello.test.js` (32); suite del core 85.

## 0.4.22 — 6 novembre 2026

**Abbinamento tra moduli: «Immobili adatti» su un cliente, «Richieste compatibili» su un immobile.** Idea ricavata dall'analisi di Gestim (l'incrocio automatico tra immobili e richieste è la funzione che un'agenzia usa di più), costruita come primitiva generica e non come codice per zucca.

- **Nuovo blocco del Builder** (Layout form → «Abbinamento»): modulo in cui cercare, criteri tra un mio campo e uno (o più) del candidato con 4 operatori (`è simile a`, `è uguale a`, `del candidato ≤ mio`, `del candidato ≥ mio`), titolo e dettagli di ogni risultato, condizione sul mio record (es. solo gli acquirenti) e filtro per stato del candidato (es. solo gli immobili in vendita).
- **Vincoli e affinità**: un criterio «Obbligatorio» esclude chi non lo soddisfa (es. prezzo ≤ budget); gli altri fanno il punteggio e il record deve soddisfarne almeno uno. Un campo vuoto sul mio record non esclude nessuno. Ordine per punteggio, poi il più recente; ogni risultato mostra cosa soddisfa e cosa manca.
- **Nel dettaglio del record**: una sezione per ogni abbinamento, con percentuale, dettagli e le etichette dei criteri (verdi quelle soddisfatte, barrate quelle mancanti). Se la condizione non vale (un venditore) la sezione non compare. Rispetta i permessi del modulo bersaglio.
- **Pubblicare con un campo scritto male non si può**: campi, operatori, modulo bersaglio, filtro e campi mostrati vengono controllati.
- **Per zucca**: i due abbinamenti si applicano da soli al primo avvio dopo l'aggiornamento (budget = vincolo, tipologia e zona = affinità, solo acquirenti, solo immobili in mandato/in vendita), solo se i moduli hanno i campi giusti, e non ricompaiono se li togli dal Builder. Per questo `seed-azioni-documento.js` è diventato `seed-blocchi-verticale.js` e applica documenti e abbinamenti (stessi marcatori di prima: i documenti già applicati non si ripetono).
- **Corretto di passaggio**: dopo l'invio di un documento il dettaglio non si ricaricava (il codice controllava `r.ok` ma `api.get` restituisce direttamente il record): lo stato del record non si aggiornava a schermo finché non lo si riapriva. Era già così prima della 0.4.21.
- **Test**: 18 sul motore, 18 d'integrazione (rotta, permessi, validazione, seed), 4 sullo schema; core 84 suite, Super Admin 35, frontend 15. Verificato dal vivo in locale con dati veri e il seed vero: a una cliente compaiono i 2 immobili giusti (100% e 50%), quello fuori budget è escluso, per un cliente con budget basso nessuno; l'editor nel Builder si apre e mostra i criteri.
- **Non coperto**: nessun avviso automatico quando arriva un immobile compatibile; la zona è testo (nessuna distanza); il confronto di testo non capisce sinonimi; i risultati non si aprono con un clic dal dettaglio.

## 0.4.21 — 6 novembre 2026

**«Documento da modello»: la primitiva «azione su un record» che mancava, al posto delle rotte cablate su Immobili e Clienti.** Era il primo punto degli sviluppi futuri («Custom in platform non esiste»).

- **Nuovo blocco del Builder** (Automazione → «Documento da modello»): bottone sul record, testo con segnaposto (`{{campo}}`, `{{relazione.campo}}`, `{{@azienda}}`, `{{@oggi}}`, filtri `|linea` `|vuoto` `|minuscolo`, sezioni `{{#k}}…{{/k}}`), email di destinazione scelta tra i campi email del record o di un record collegato, e stato opzionale in cui portare il record dopo l'invio. Un selettore «Inserisci un campo…» scrive il segnaposto nel punto in cui si trova il cursore.
- **Anteprima sempre modificabile, mai invio automatico**: `anteprima` non spedisce nulla; `invia` manda il testo approvato. **Il destinatario lo ricava il server**, non la richiesta; l'invio è tracciato in Attività; il secondo invio parte anche se lo stato non può più cambiare.
- **Pubblicare con un campo scritto male non si può più**: segnaposto, destinatario, stato e chiave vengono controllati contro i campi veri del modulo e dei moduli collegati.
- **Tolti** i 4 percorsi dedicati (`genera-documenti`, `invia-documenti`, `genera-scheda`, `invia-scheda`) e i file `lib/doc-cliente.js`, `lib/doc-immobile.js`. Resta specifica solo la **valutazione** (ha un report su misura).
- **Per zucca**: i tre documenti (Privacy+Incarico, Antiriciclaggio, Scheda immobile) diventano blocchi dei moduli Clienti e Immobili, applicati **una sola volta** al primo avvio dopo l'aggiornamento (`seed-azioni-documento.js`, marcatore `seed_applicati`) dalle rotte vere del Builder, solo se i moduli hanno i campi giusti. I testi sono identici al carattere a quelli di prima: 44 casi di confronto, congelati in `fixtures/documenti-parita.json`. Se li togli dal Builder non ricompaiono.
- **Sicurezza trovata dal test**: il motore leggeva anche proprietà ereditate (`{{constructor}}` stampava una funzione). Ora legge solo i campi propri del record.
- **Test**: 71 per il motore (compresa la parità), 31 d'integrazione (anteprima, invio, errori, validazione, seed), 5 sullo schema; tutta la suite del core (82) e di Super Admin (35) passa. Verificato dal vivo in locale: bottone, anteprima, destinatario, errore chiaro se l'email non è configurata.
- **Non coperto**: la valutazione OpenAPI.it resta legata a `immobili`; il Builder non ha un selettore dell'icona del documento; i documenti del verticale non sono ancora un modulo di Libreria.

## 0.4.20 — 6 novembre 2026

**Test del frontend, e lo stesso difetto dei dialoghi corretto anche in Super Admin.** Il frontend (22.000 righe) non aveva nessun test: regressioni come quella dei dialoghi si vedevano solo a occhio.

- **Infrastruttura**: `vitest` + `jsdom` + Testing Library in `core/frontend` (`npm test`), agganciata a `scripts/verifica.sh`.
- **Voci appuntate del dock**: la logica (cosa mostrare, cosa fa un tocco, il limite di 4) estratta in `shared/frontend/dock-pins.js` — prima ogni Sidebar ne teneva una copia — con 11 test (lista vuota = scelta valida, voci sparite scartate, doppioni, dock pieno non salva).
- **Portale**: 2 test (i figli finiscono su `body`, fuori dalla card con `backdrop-filter`; sparisce allo smontaggio).
- **Guardia contro il bug dei dialoghi**: un test controlla che in tenant e in Super Admin ogni overlay `fixed inset-0` sia in un portale (eccezioni elencate nel test, con il motivo). Verificata: aggiungendo un overlay finto il test fallisce e indica il file.
- **Super Admin** aveva lo stesso difetto potenziale: 13 overlay senza portale (Tenant, Libreria, Utenti, creazione/registrazione tenant, Verticali, login...). Ora tutti in `components/Portal.jsx`. Verificato dal vivo: il dialogo "Nuovo tenant" è figlio di `body`, a tutta finestra.
- 15 test frontend, tutti verdi; build e lint puliti.
- Non coperto: nessun test dei componenti più grandi (Dashboard, Builder, pagine di modulo) né test nel browser vero (login, navigazione): il passo successivo, se serve.

## 0.4.19 — 6 novembre 2026

**Velocità: il codice si scarica a pezzi, non tutto insieme.** Richiesto: "si può fare qualcosa per la velocità di caricamento?". Il frontend dei tenant era un unico file JS da 1,09 MB (271 KB compressi), quello di Super Admin da 723 KB (180 KB), scaricati e analizzati a ogni apertura, anche da telefono.

- Le pagine pesanti si caricano alla prima apertura (`React.lazy` + `Suspense`, con un "Caricamento…" breve): nei tenant Libreria, Builder, Impostazioni, Guida, Log attività e la pagina di un modulo; in Super Admin Tenant, Libreria, Analisi, Super Builder, Attività, Impostazioni, Guida. La Dashboard resta nel bundle iniziale (è la prima schermata).
- JS iniziale compresso: **tenant da 271 a 115 KB (−58%)**, **Super Admin da 180 a 70 KB (−61%)**. I file hanno il nome con hash e restano in cache a lungo: la seconda visita non riscarica nulla di invariato.
- Verificato dal vivo (locale): tutte le pagine di entrambe le app si aprono e mostrano il contenuto, nessuna risorsa fallita al caricamento dei tenant.
- **Cosa non ha cambiato**: i secondi di attesa visti sulla *prima richiesta* a un tenant (7–20 s per il primo byte, poi ~0,1 s) non vengono dal frontend: dal NAS la risposta arriva in 1 ms. Diagnosi ancora aperta, vedi `docs/OPERAZIONI.md`.

## 0.4.18 — 6 novembre 2026

**Fix: dopo un deploy, un tenant poteva mostrare per ore la versione vecchia** (segnalato: "perché vedo la 0.4.14?" quando il server serviva già la 0.4.17). Causa: in `core/nginx.conf` solo `/index.html` aveva `Cache-Control: no-cache`; l'indirizzo base del dominio (`/`) passa dal ramo del Sito Web (`/__root_public`, poi `@spa_root`) e non riceveva l'intestazione, quindi il browser — soprattutto l'app aggiunta alla Home di iOS — riusava un `index.html` vecchio che puntava a un bundle vecchio.

- `no-cache` aggiunto a `location = /` e a `@spa_root`. Super Admin non era toccato (la sua `/` passa da `/index.html`, che ce l'ha).
- Sintassi nginx verificata (`nginx -t`). Il bundle JS resta in cache a lungo (nome con hash), solo l'`index.html` viene rivalidato a ogni apertura.
- **Per vederlo funzionare serve Aggiorna sui tenant**; la prima apertura dopo l'aggiornamento può ancora mostrare la copia vecchia già in cache (una volta sola: da lì in poi si rivalida).

## 0.4.17 — 6 novembre 2026

**Menu "Altro" del dock mobile più leggibile, e voci appuntate scelte dall'utente** (core e Super Admin, insieme: i due dock condividono lo stesso stile). Segnalato con uno screenshot di Finance da iPhone: le icone della griglia non avevano nome (due triangoli di avviso e due carte quasi identiche) e il nome compariva solo al passaggio del mouse, che sul telefono non esiste.

- Il nome sotto ogni icona, fino a due righe (prima solo un suggerimento al passaggio del mouse).
- Pannello più compatto: icone 48px, margini ridotti; la versione non ha più una riga propria in testa ma sta accanto al ruolo in fondo.
- **Voci appuntate scelte dall'utente**: tasto **Modifica** nel pannello. Con "Modifica" attivo la griglia mostra tutte le voci (anche quelle già nel dock) con un segno ✓ o +; un tocco appunta o toglie, massimo 4 come prima, con un avviso quando sono già 4; **Ripristina** torna alle prime 4 dell'elenco. In core si possono appuntare anche le voci di sistema (Libreria, Impostazioni, Guida...).
- Salvate su questo dispositivo (`localStorage`, una chiave per utente in core), non sul server: una scelta di comodità, non un dato. Scelta esplicita e visibile, non un riordino automatico per uso.
- Verificato dal vivo a 375px su entrambe le app: etichette, modalità Modifica, limite di 4, salvataggio e ripristino.

### Documentazione, stesso giorno

Nessun cambio di comportamento: `ARCHITETTURA.md` ora descrive vetro, rail/dock, portale degli overlay e il blocco Immobiliare (OpenAPI.it, valutazione, documenti cliente); `DECISIONI.md` registra l'eccezione delle rotte specifiche per Immobili/Clienti, la regola del portale, le voci appuntate scelte dall'utente e i due script eliminati; `OPERAZIONI.md` spiega l'errore `524` di `redeploy-nas.sh` sul passo dei tenant e che per i tenant si usa **Aggiorna**.

## 0.4.16 — 6 novembre 2026

**Il dock mobile di Super Admin diventa uguale a quello dei tenant.** Segnalato guardando i due menu da telefono: erano diversi in quattro punti. Richiesto lo stesso aspetto su entrambi.

- Pannello "Altro": ora lo stesso pannello di vetro di core — logo e versione, campo di ricerca, griglia di icone a 4 colonne con etichetta al passaggio, in fondo account, tema e uscita (prima una seconda pillola con 3 sole icone, senza ricerca).
- Indicatore che scorre tra le icone, misurato via DOM come in core (prima la voce attiva si vedeva solo dal riempimento).
- Account: il cerchio con le iniziali porta a Impostazioni (come la foto profilo di core porta a "Il mio account"), niente più mini-menu a parte; il tema sta nel pannello "Altro" come nei tenant.
- Appuntate 4 pagine invece di 5, come in core (Super Builder passa in "Altro"): con 5 il dock a 375px era più largo di quello dei tenant.
- Non cambiato: la rail laterale su desktop; il cambio password resta dove stava (Impostazioni), il dock di Super Admin non ha la chiave del dock di core.
- Verificato dal vivo a 375px: nessun overflow orizzontale, pannello e indicatore funzionanti.

## 0.4.15 — 6 novembre 2026

**Fix: i dialoghi aperti da dentro una card di vetro restavano intrappolati nella card.** Segnalato con uno screenshot: il dialogo "Smista" di un widget della Dashboard era confinato nei bordi del widget, con l'overlay scuro solo lì. Stessa causa della 0.3.47: un `backdrop-filter` su un antenato (`.glass-panel`) rende quell'antenato il contenitore degli elementi `position: fixed`.

- Nuovo `components/Portal.jsx` (`createPortal` verso `document.body`); `SmistaPanel` usa direttamente `createPortal`.
- Tutti gli altri overlay a tutto schermo senza portale ora ne sono avvolti (18 file: modali di Utenti, Libreria, Backup, Liste, Sito Web, Archivio, Dashboard, Modulo, import PDF/busta paga, invito, wizard, "Chiedi ai dati"...), invece di correggerli uno a uno quando qualcuno li incontra.
- Lasciati com'erano: il backdrop del dock (non è un dialogo) e `ProductTour` (overlay di radice).
- Verificato dal vivo: l'overlay di "Aggiungi widget" è figlio di `body` e copre tutta la finestra. Non provato a mano ogni singolo dialogo.

## 0.4.14 — 1 novembre 2026

**Scheda Immobile completa, invio al proprietario.** Terzo e penultimo pezzo del workflow Clienti/Immobili/AML: Immobili estesa con la scheda reale a 3 pagine dell'agenzia (comproprietari, localizzazione/contesto, caratteristiche interne, serramenti/isolamento, impianti/certificazione energetica, catasto, spese condominiali/mutuo, valutazione/incarico, esigenze di riacquisto) — circa 55 nuovi campi.

- Bottone "Scheda immobile" nel dettaglio di un Immobile: genera un riepilogo di tutto quanto già inserito (non chiede di ricompilare da zero, a differenza dei documenti Cliente), anteprima modificabile, invio via email al Proprietario collegato.
- Checkbox-group del modulo cartaceo con una sola scelta possibile (es. "Infissi: Legno/PVC/Alluminio") diventano select; i gruppi dove più voci coesistono (es. accessori impianti) restano testo libero, più vicino a come si compila davvero un sopralluogo.
- Comproprietari fino a 3 (anagrafica originale), con le rispettive quote di proprietà.
- Resta da fare: la doppia fatturazione automatica delle Provvigioni (venditore + acquirente, salvo accordi diversi) quando una Trattativa arriva a un certo stato.

## 0.4.13 — 1 novembre 2026

**Modulo Antiriciclaggio nel flusso documenti cliente.** Secondo documento del flusso "Genera e invia documenti" (0.4.12): il Modulo di Adeguata Verifica della Clientela (D.Lgs. 231/2007), confrontato con il questionario reale usato dallo studio legale che segue l'agenzia.

- Nel dettaglio di un Cliente, due bottoni distinti ("Privacy + Incarico" e "Antiriciclaggio") invece di uno, stessa anteprima modificabile prima dell'invio.
- Il testo prefilla solo ciò che Platform già sa del cliente (nome, codice fiscale/P.IVA, indirizzo); le domande proprie del cliente (PEP, origine fondi, settore professionale, cittadinanze) restano da compilare a mano, come nel modulo cartaceo — non dedotte né inventate.
- Non riprodotte le tabelle di riferimento del modulo originale (elenco paesi a rischio, oltre 100 codici TAE): sono tabelle di consultazione, citate per nome, compilate con l'assistenza dell'agente.

## 0.4.12 — 1 novembre 2026

**Clienti: anagrafica reale, workflow di verifica, modulo CRM, invio documenti.** Primo pezzo del workflow Clienti/Immobili/AML richiesto dal vivo dopo aver visto i moduli base ("i moduli impostati sono corretti con lo scope di zucca MA..."), confrontato con una scheda cliente e un questionario antiriciclaggio reali dello studio legale che segue l'agenzia.

- Clienti (zucca): nuovi campi tipo soggetto (persona fisica/società), codice fiscale/P.IVA, tipo cliente (venditore/acquirente) e i campi di ricerca per chi compra (tipologia, budget, zona). Il workflow generico mai usato nello scopo reale è sostituito da quello descritto dal vivo: **verifica identità cliente → documenti inviati → cliente verificato**.
- Nuovo modulo **Interazioni** (CRM): telefonate/email/visite collegate a un cliente, con un campo "prossimo contatto" per il planner — mancava un modulo del genere (Attività è una todo-list generica, senza relazione al cliente).
- **Genera e invia documenti**: nel dettaglio di un Cliente, un bottone genera il testo di Informativa Privacy (GDPR) + Modulo Incarico, lo mostra in un'anteprima **modificabile dall'admin prima dell'invio** (mai spedito automaticamente), poi lo manda via email al cliente (stesso connettore Resend già in uso per il modulo di contatto del Sito Web) e aggiorna lo stato a "Documenti inviati". Testo generico, personalizzato solo coi dati del tenant (ragione sociale/indirizzo/P.IVA già in Impostazioni), nessun nome d'agenzia scritto nel codice.
- Non ancora fatto in questo giro, prossimi passi dello stesso filone: il modulo Antiriciclaggio (il questionario è lungo e articolato — PEP, codici TAE, origine fondi: generato come documento da far firmare, non ancora una logica di compliance interattiva), l'estensione della Scheda Immobile con tutti i campi della scheda reale dell'agenzia (comproprietari, impianti, catasto, mutuo/spese, incarico), e la doppia fatturazione automatica delle Provvigioni (venditore+acquirente, salvo accordi diversi).

## 0.4.11 — 1 novembre 2026

**Report di valutazione — fase 1 dell'arricchimento, persistente sul record.** Segnalato dal vivo confrontando con un report di valutazione professionale reale (Case&Co): il nostro era "molto scarno" al confronto. Fase 1: tutto il dato già pagato all'avanzata di OpenAPI.it ma finora scartato, più due fonti pubbliche gratuite, più un paragrafo generato dall'AI — mappe, vista satellitare, servizi di zona, redditi ISTAT e tempi di percorrenza restano una fase 2 esplicita (fattibili senza account a pagamento, con OpenStreetMap/Overpass/OSRM al posto di Google Maps).

- Il report (dettaglio, comparabili, OMI) ora si **salva sul record** (`report_valutazione`, una chiave non dichiarata nello schema — non compare come campo) invece di vivere solo nella sessione: riaprendo il dettaglio in futuro il pannello resta disponibile, senza richiamare OpenAPI.it e senza consumarne credito.
- Pannello arricchito con dati già nella risposta "avanzata" ma prima scartati: dinamicità del mercato per anno, tempi medi di vendita per taglio, ripartizione annunci per tipologia, distribuzione per superficie, quotazioni OMI complete (non più le prime 4).
- Due fonti pubbliche gratuite, nessuna chiave da collegare: **zona sismica ufficiale** (ISPRA, classificazione 1-4) e **potenziale fotovoltaico** (JRC PVGIS, resa annua per kW installato) — `lib/rischi-territorio.js`.
- Un paragrafo **"Considerazioni del valutatore"** generato dall'AI già configurata (Mistral) — stesso meccanismo di sicurezza già in uso per la Reportistica di Finance: ogni numero scritto dal modello è verificato contro i dati forniti, scartato se non trovato (`lib/ai-valutazione.js`, nuova rotta `/explain-valuation` su Super Admin).

## 0.4.10 — 1 novembre 2026

**Menù di nuovo laterale su PC/Mac, la pillola resta solo su mobile.** Richiesto dal vivo: "da pc/mac il menù debba essere ancora laterale, la pillola la terrei solo per la versione mobile — questa cosa tienila per tutti (admin, finance e zucca)". Il dock flottante in vetro, costruito prima in questa stessa sessione, tornava utile solo su schermi piccoli; su desktop occupava spazio senza il vantaggio per cui era nato (un pollice che raggiunge il basso dello schermo).

- `core/frontend/src/components/Sidebar.jsx` e `super-admin/frontend/src/components/Sidebar.jsx`: un solo componente per app, stato condiviso (tema, notifiche, account, password), reso due volte e scelto via classi responsive Tailwind — `hidden md:flex` per la rail verticale, `md:hidden` per il dock — nessun listener di resize in JS. La rail è la vecchia implementazione pre-dock (stretta a riposo, si allarga al passaggio del mouse), riportata dalla cronologia git e adattata per condividere i popover di notifiche/account col dock invece di duplicarli.
- `App.jsx` di entrambe le app: `md:ml-14` per riservare lo spazio della rail su desktop, `pb-28 md:pb-8` perché il dock resti con spazio sotto solo su mobile dove esiste davvero.
- Finance e zucca condividono `core/frontend`, quindi ricevono la stessa rail automaticamente.

## 0.4.9 — 1 novembre 2026

**Report di valutazione — comparabili, OMI, dati di zona.** Richiesto dal vivo dopo aver provato il bottone di 0.4.8: "aggiungi anche comparabili/OMI prima" del PDF. La valutazione ora usa l'endpoint "avanzato" di OpenAPI.it invece di quello base, più due chiamate aggiuntive dalle stesse coordinate.

- `lib/openapi-it.js`: nuove funzioni `valoreAlMqAvanzato` (quotazione + rischio sismico + composizione demografica + dinamicità del mercato — con un piccolo retry se la risposta arriva in modo asincrono, visto nella documentazione), `comparabili` (annunci simili vicini, da lat/lng) e `omi` (quotazioni ufficiali dell'Agenzia delle Entrate per la zona). Le due nuove chiamate partono dalle coordinate che la valutazione principale ha già trovato — se una delle due non trova nulla per quella posizione, non blocca la valutazione principale, che resta comunque scritta sul record.
- La valutazione di un Immobile ora mostra un pannello "Report di valutazione" (quotazione min/med/max, rischio sismico, OMI di zona, fino a 6 comparabili) direttamente nel dettaglio del record, con un bottone "Stampa o salva in PDF" — stesso meccanismo già in uso per la Guida dei verticali (una copia nascosta della pagina, mostrata solo in stampa).
- Resta vero quanto detto prima: mappa con area cerchiata, foto satellitare, qualità dell'aria e fotovoltaico restano integrazioni a parte (Google Maps/JRC PVGIS); il correttivo proprio del tenant (stima vs. prezzo reale di vendita) resta per quando ci saranno vendite vere registrate.

## 0.4.8 — 1 novembre 2026

**"Valuta con OpenAPI.it" — il primo bottone vero sul modulo Immobili.** Chiude il pezzo lasciato aperto in 0.4.7. Confermato dal vivo su zucca in sandbox (indirizzo di Desenzano → quotazione sandbox).

- Nuova rotta `POST /records/immobili/:id/valuta`: legge indirizzo/comune/provincia e tipologia del record, chiama `lib/openapi-it.js` (`IT-sqm_value_start`), scrive sul record `stima_valore` (superficie × quotazione), `stima_eur_mq`, `stima_data`, `stima_fonte` — scritta sul record, non solo mostrata, così resta visibile anche dopo e si può confrontare in futuro col prezzo reale di vendita.
- 4 campi nuovi sul modulo Immobili (`stima_valore`, `stima_eur_mq`, `stima_data`, `stima_fonte`) per mostrare la stima come un campo qualunque del record.
- Bottone "Valuta con OpenAPI.it" nel dettaglio di un record Immobili (`RecordDetailModal.jsx`) — deliberatamente specifico a quel modulo, non un'azione generica: Platform non ha ancora un primitivo "azione esterna su un record esistente" (le Source scriptabili servono solo a crearne di nuovi), e inventarne uno per un solo caso sarebbe prematuro.
- Non ancora fatto, prossimi passi su questo filone: il PDF scaricabile della valutazione, le fonti aggiuntive (comparabili, OMI, dati di zona dall'endpoint "advanced"), e — con qualche vendita vera registrata — un correttivo proprio del tenant tra stima e prezzo reale incassato.

## 0.4.7 — 1 novembre 2026

**Connettore OpenAPI.it — ricerca immobili per CF, valutazioni di mercato.** Richiesto dal vivo dopo aver attivato un account sandbox: "come possiamo testare?". Verificata la documentazione reale della loro console (non indovinata): autenticazione a due passi — Basic Auth (email + API key) per ottenere un token con scope specifici, poi quel token autentica le chiamate vere su `realestate.openapi.com` e `catasto.openapi.com` (o i loro equivalenti sandbox `test.*`).

- Nuova connessione "OpenAPI.it — Immobili" in Impostazioni → Connessioni (stesso meccanismo già in uso per Stripe/Mailchimp/Resend — credenziali sigillate nel database, mai in chiaro).
- `core/backend/src/lib/openapi-it.js`: gestisce da solo il token (richiesto, messo in cache, rigenerato quando serve — mai copiato a mano), espone una valutazione al mq da indirizzo (`IT-sqm_value_start`) e la ricerca immobili per CF/P.IVA (`ipotecarie-ispezione_nazionale`, asincrona).
- Una rotta di prova (`POST /connections/openapi_it/test`) fa una vera chiamata in sandbox per confermare che le credenziali inserite funzionino, prima di usarle in un modulo.
- Non ancora collegato a un bottone nell'interfaccia di un modulo (es. Immobili) — il prossimo passo, una volta confermato che il collegamento funziona.

## 0.4.6 — 1 novembre 2026

**Correzione: pannello "Altro" troppo grande.** Segnalato dal vivo con uno screenshot, subito dopo il rilascio del dock (0.4.5): "hai fatto un super launcher, c'è troppo spazio" — il pannello «Altro» (copiato dalla struttura di core, pensata per decine di moduli + ricerca) per sole 3 voci fisse (Attività, Impostazioni, Guida) mostrava un'intestazione con logo/versione e una griglia vuota sproporzionata.

- Tolta l'intestazione e la griglia: ora è un'altra pillola di chip, identica a quelle del dock sotto, appena sopra — stessa dimensione proporzionata al contenuto reale, nessuno spazio vuoto.
- Il numero di versione (prima nell'intestazione tolta) si è spostato nel menu dell'account, in fondo.

## 0.4.5 — 1 novembre 2026

**Dock comune a tutta la piattaforma.** Richiesto dal vivo: "voglio una linea comune su tutta la piattaforma", dopo che core/frontend era passata al dock flottante il 31/10 (0.4.2) ma Super Admin era rimasta con la vecchia rail verticale a sinistra per scelta esplicita di quel giorno ("ridisegnarla è un cambio di impronta diverso, non chiesto" — richiesto ora davvero).

- Sidebar.jsx di Super Admin riscritta sullo stesso linguaggio del dock di core: chip tondi tinti, pillola di vetro flottante in basso, pannello "Altro" per le voci in eccedenza. Più semplice del dock di core perché le 8 pagine di Super Admin sono una lista fissa, non moduli dinamici di un tenant: 5 appuntate (Dashboard, Tenant, Libreria, Analisi, Super Builder), 3 in «Altro» (Attività, Impostazioni, Guida — prima raggiungibile solo dall'icona "i" di Topbar).
- Topbar.jsx (la barra sticky in alto con notifiche e account) rimossa: notifiche e account vivono ora nel dock stesso, stesso posto del dock di core. La barra laterale non riserva più spazio fisso (tolto `md:ml-14`), stesso `pb-28` di core perché il dock non copra l'ultimo pezzo di pagina.
- Non riportato dal dock di core: l'indicatore che scorre tra un'icona e l'altra (misurato dal vivo via DOM) — 8 voci fisse non ne hanno lo stesso bisogno, lo stato attivo resta leggibile dal riempimento pieno dell'icona.
- Verificato dal vivo chiaro/scuro, dock/Altro/notifiche/account/tema, e a larghezza di telefono (375px, nessun overflow).

## 0.4.4 — 1 novembre 2026

**Il wizard con assistente per l'Analisi.** Richiesto dal vivo: "introdurrei un wizard con assistente che guida l'utente nell'analisi dei processi e nella creazione dei moduli e tenant". Tre pezzi, scelti per restare dentro al flusso già esistente invece di rifarlo:

- **Chiarimenti prima di «Fai tutto»** — se il racconto è ambiguo (più servizi o reparti accennati senza dire quali, un passaggio decisivo non chiaro), l'AI fa fino a 3 domande mirate prima di proporre i processi, invece di tirare a indovinare e lasciare che se ne accorga solo dopo con «Cosa manca?». Si può sempre saltare («Salta, vai così»); un racconto già chiaro non fa domande e parte subito come prima.
- **Narrazione durante «Fai tutto»** — la schermata di avanzamento non mostra più solo il nome della fase, ma cosa sta succedendo davvero: i processi trovati (coi nomi), quale processo sta completando in quel momento, cosa sta controllando nel passaggio finale.
- **«Correggi a parole» esteso oltre i processi** — ora capisce anche richieste come «spegni i report automatici» o «non voglio l'AI per gli scontrini»: due nuove operazioni (accendi/spegni una proposta) agiscono sulle stesse proposte di report e potenziamenti AI già mostrate coi checkbox, stessa anteprima-prima-di-applicare delle altre operazioni.
- Non fatto in questo giro (valutabile in seguito, se richiesto): un intake conversazionale multi-turno vero e proprio, e l'estensione di «Correggi a parole» alla configurazione del tenant già creato (oggi resta nel Builder, o nel nuovo «Riprova» di 0.4.3 per i soli errori).

## 0.4.3 — 1 novembre 2026

**Analisi tenant: due correzioni reali, due proposte già risolte.** Richiesto dal vivo: "Migliora l'analisi. Fammi delle proposte" (poi chiarito: l'Analisi per creare tenant, non il widget di Finance). Di 4 proposte iniziali, 2 erano già coperte da codice esistente non ancora tracciato in queste note (`proponiRelazioni` già richiamato da `applyConfig`, il retry di 18 tentativi già in `tenant-api-client.js`); le altre 2 erano reali:

- **Credenziali admin perse** — prima non c'era modo di recuperarle dalla pagina Analisi dopo la creazione del tenant. Ora un bottone "Genera una nuova password" richiama l'endpoint di reset già esistente (`POST /tenants/:slug/reset-credentials`, lo stesso di Tenant → Reset credenziali) e mostra le nuove credenziali una volta sola.
- **Errori di configurazione post-creazione muti** — se "ruoli e stati del flusso" o "ruoli dei moduli/report/AI" fallivano dopo la creazione del tenant, finivano in un avviso generico illeggibile. Ora l'avviso mostra il messaggio reale dell'errore e un bottone "Riprova" che rilancia solo quel passo (nuova route `POST /:id/retry-config`) senza ricreare il tenant.
- Prossimo passo, non ancora iniziato: il wizard con assistente che guida l'analisi dei processi e la creazione dei moduli/tenant (intake conversazionale, narrazione durante "Fai tutto", "Correggi a parole" esteso oltre la correzione processi, domande di chiarimento dell'IA).

## 0.4.2 — 1 novembre 2026

**Liquid Glass esteso a Super Admin** — richiesto dal vivo: "vorrei che anche super admin venga aggiornato al Liquid Glass".

- Stessi token/classi di core (`.glass-panel`, `.glass-pill`, `.glass-mesh-bg`, `.glass-mesh-logo`) portati in `super-admin/frontend/src/index.css`, con `var(--cp-primary)` al posto di `var(--accent)` (nome equivalente già in uso qui).
- Nuovo `GlassPageBackground.jsx` (copia di quello di core, sotto il `PlatformLogo` di questa app).
- Convertite tutte le pagine: Dashboard, Tenant, Libreria, Analisi (tutte e 4 le schermate interne — elenco, "Fai tutto" in corso, riepilogo, dettaglio con stepper), Super Builder (solo l'ambiente — i pannelli di `shared/frontend/builder/` restano come sono, condivisi col Builder dei tenant), Attività (incluso il tab Metriche annidato), Impostazioni (incluso il tab Utenti Super Admin annidato), Guida.
- **Deliberatamente lasciati come sono**: la barra laterale di navigazione (rail verticale fisso, non il dock di core — ridisegnarla è un cambio di impronta diverso, non chiesto), i menu a tendina/popover (Select, Topbar), ogni modale, la pagina di marketing pre-login (HomePage.jsx, un'altra cosa rispetto a una pagina di lavoro).
- Verificato dal vivo chiaro/scuro su ogni pagina, build di produzione pulita.

## 0.4.1 — 31 ottobre 2026

- **Anche la pagina di login è ora "Liquid Glass"** — richiesto dal vivo: "anche la pagina di login la voglio vedere più bella". Stesso sfondo sfumato + card di vetro del resto della piattaforma, niente illustrazioni (un tentativo precedente il 14/10 era stato bocciato e tolto lo stesso giorno — la fonte dell'immagine era troppo degradata). Verificato dal vivo chiaro/scuro, login funzionante.

## 0.4.0 — 31 ottobre 2026

**Liquid Glass completato — 100% delle pagine.** Terza e ultima tranche, le viste avanzate di modulo e le rifiniture rimaste:

- Viste avanzate: Archivio (cartelle, schede, elenco — restano opache solo l'anteprima file e la cartella-in-creazione, trattamenti attivi non neutri), Gerarchia (parent/children), Periodo, Mesi dell'anno / Per categoria / Per settimana — questi ultimi tre ora di vetro anche come widget Dashboard (prima esclusi apposta perché avevano una card propria opaca).
- Rifiniture sparse trovate nel giro finale: pannello Report di un modulo, report Schema personalizzati, Suggerimenti IA, verticali della Libreria, il riepilogo di una Busta Paga.
- **Deliberatamente lasciati opachi** (stesso principio di sempre, non dimenticati): ogni modale/dialogo di conferma, i pannelli di inserimento blocco/immagine del Sito Web, il contenuto pubblico delle pagine del tenant (non è interfaccia di Platform), la schermata di login, l'onboarding guidato, e alcuni pannelli di integrazione secondari annidati dentro schede già di vetro (Gmail, Telegram, WhatsApp, Smista) — rimandabili a un giro successivo se richiesto, impatto visivo minore essendo già dentro un contenitore di vetro.
- Build di produzione pulita a ogni tranche, verificato dal vivo chiaro/scuro per ogni pagina toccata.

Chiude l'estensione del linguaggio "vetro" oltre la Dashboard iniziata in 0.3.28 — tre tranche (0.3.55, 0.3.56, 0.4.0), nessun retema di Super Admin né del Builder condiviso (restano il loro linguaggio a sé).

## 0.3.56 — 31 ottobre 2026

**Liquid Glass, seconda tranche** — tutte le schede restanti di Impostazioni, più Sito Web (solo l'ambiente editor, i blocchi della pagina del tenant restano come sono: è il sito del tenant, non l'interfaccia di Platform):

- Utenti & Ruoli, Liste, Funzioni, Aspetto, Report (notifiche), AI, Sicurezza, Dati (export/backup), Collegamenti, Movimenti.
- `RecordOwnerCard.jsx` (usata in Utenti & Ruoli) e i pannelli admin del Sito Web (Cronologia, Popup, Valori dinamici, Tema).
- Verificato dal vivo ogni scheda, build di produzione pulita.
- Modali di conferma (es. elimina lista/tenant) restano opachi apposta, come già per ogni altro modale della piattaforma.
- Resta da fare: le viste avanzate di modulo (Archivio, tabelle periodo/gerarchia/ViewTabs) — ultima tranche prima della 0.4.0.

## 0.3.55 — 31 ottobre 2026

**Liquid Glass esteso oltre la Dashboard** (richiesto dall'utente: "aggiornare al liquid glass anche il resto della piattaforma, coprendo il 100% delle pagine") — prima tranche, le pagine principali:

- Nuovo `GlassPageBackground.jsx` — lo sfondo sfumato (prima duplicato dentro DashboardPage.jsx) estratto in un componente condiviso, così ogni pagina lo richiama in un punto solo.
- Convertite: Log attività, Guida (tutte e tre le schede), Libreria, Builder (solo l'ambiente attorno — i pannelli di `shared/frontend/builder/` restano come sono, condivisi con Super Admin), la pagina di ogni modulo (lista, tabella, calendario, stati vuoti — la vista più usata di tutte), Impostazioni (guscio + schede Connessioni e Moduli, incluse qui) e Il mio account.
- `Tile.jsx` (usato in 40+ punti nelle schede di Impostazioni) ora è di vetro — si propaga automaticamente ovunque è già in uso.
- Verificato dal vivo in chiaro e scuro: nessuna card doppiata, nessun modale finito nei guai del `backdrop-filter` (quelli restano appositamente opachi, come già per Sidebar/FormDrawer).
- Ancora da convertire: Utenti & Ruoli, Sito Web, Funzioni, Aspetto, Report, AI, Sicurezza, Dati/Backup, le viste avanzate di un modulo (Archivio, tabelle periodo/gerarchia) — prossima tranche.

## 0.3.54 — 31 ottobre 2026

Tre rifiniture sul launcher "Altro", segnalate dal vivo di seguito:

- **Griglia più fitta**: 4 colonne invece di 2, icone 56px invece di 80px, pochissimo padding — "troppo spazio tra le icone", richiesto più volte.
- **Etichetta vera al passaggio del mouse**, non solo il `title` nativo del browser (troppo lento/invisibile per essere utile): appare subito sopra o sotto l'icona via `group-hover`.
- **Stato attivo meno invadente**: niente più rettangolo pieno attorno all'icona selezionata ("anche quando selezionata la pagina è bruttissima da vedere") — resta solo il riempimento pieno della sola icona, proporzionato.

## 0.3.53 — 31 ottobre 2026

- **Launcher "Altro": solo icona, niente etichetta sotto** — richiesto dal vivo. Il nome resta leggibile al passaggio/pressione lunga (`title`) e filtrando dalla ricerca sopra la griglia.

## 0.3.52 — 31 ottobre 2026

- **Fix reale: il dettaglio di un record aperto da mobile risultava "sfalsato"** — segnalato dal vivo con screenshot (campo Data e un campo di relazione tagliati sul bordo destro). Su iOS Safari un `<input type="date">` può avere una larghezza intrinseca propria che ignora anche `min-w-0`/`max-w-full` sul campo stesso (fix già tentato il 26/10, insufficiente) — quel singolo campo troppo largo rendeva scorrevole ORIZZONTALMENTE l'intero form, spingendo fuori schermo anche i campi sotto. `FormDrawer.jsx` (il pannello di dettaglio/modifica usato da ogni modulo) ora contiene qualunque figlio troppo largo invece di lasciarlo allargare il contenitore — vale ovunque nell'app, non solo per questo campo.

## 0.3.51 — 31 ottobre 2026

- **Launcher "Altro": icone più grandi, griglia a 2 colonne** (prima 3, 64px) — segnalato dal vivo dopo il fix dello spazio vuoto: "ancora troppo spazio, puoi ingrandire le icone?". Con i 5-8 voci tipiche, 2 colonne più grandi riempiono lo stesso spazio con meno righe vuote E icone più leggibili.
- **Fix reale: la foto profilo caricata da un dispositivo non si vedeva su un altro (mobile sì, web Mac no)** — causa: `user` (avatar incluso) viene scritto in `localStorage` SOLO al login, per quel browser/dispositivo; un browser con una sessione già aperta non lo rifà mai, quindi non impara mai di un cambiamento fatto altrove. Nuova rotta `GET /users/me` (profilo fresco dal database, non dal JWT) chiamata da `App.jsx` a ogni avvio per riallineare lo stato locale — un dispositivo con sessione aperta vede ora la foto caricata da un altro entro il prossimo refresh, senza dover rifare login.

## 0.3.50 — 31 ottobre 2026

- **Fix reale: "Riduci" di "Come sta andando" restava fuori dalla card** — segnalato dal vivo con screenshot. Causa: `come_sta_andando` era l'unico tipo con la barra "Riduci" MA senza lo sfondo di vetro sul wrapper condiviso (quello lo disegnava da sé `InsightsCard.jsx`, più sotto) — due riquadri slegati invece di uno, la barra sopra restava visivamente fuori dalla card vera. Ora il wrapper porta il vetro come già per checklist/coda/riepilogo mensile, e `InsightsCard` non disegna più un proprio sfondo.
- **Troppo spazio vuoto nel pannello "Altro"** — segnalato dal vivo su iPhone, non riproducibile su Chrome: un bug noto di Safari/WebKit fa crescere un figlio con `flex-grow` fino a riempire il `max-height` del genitore anche quando il contenuto reale è molto più corto. Sostituito con un `max-height` proprio sulla griglia scorrevole, indipendente dal flex-grow — si adatta sempre al contenuto reale.

## 0.3.49 — 31 ottobre 2026

- **Fix reale: upload della foto profilo falliva ("Errore nel caricamento")** — il nginx esterno (`infra/nginx/nginx.conf`, il primo hop di ogni richiesta: Cloudflare → questo → il nginx del tenant) non aveva mai un `client_max_body_size` proprio, restava sul default di nginx (1MB) — troppo poco per una foto da iPhone. `core/nginx.conf` (dentro ogni container tenant) l'aveva già corretto per lo stesso sintomo sul Sito Web il 2026-09-06, ma essendo un hop più a monte questo primo nginx respingeva la richiesta PRIMA ancora che quel fix potesse avere effetto. Alzato a 20MB (stesso limite di `uploads.js`). Applicato anche live sul nginx del NAS (backup della config precedente, test sintassi, reload).
- **Indicatore del dock che scorre tra le voci** — segnalato dal vivo ("se mi sposto di voce non vedo lo scorrere"): il cambio di voce attiva era solo un cambio di colore istantaneo. Ora un alone della stessa forma/misura dell'icona si sposta con una transizione animata da una posizione all'altra (misurata dal vivo via `data-dock-key`, non calcolata a mano) — invisibile da fermo (perfettamente sovrapposto all'icona già colorata), visibile solo mentre scorre.

## 0.3.48 — 31 ottobre 2026

- **Icone del dock uniformate**: segnalato dal vivo come "irregolare, poca fluidità tra una voce e l'altra" — i moduli appuntati usavano icone piatte colorate senza sfondo, mentre Altro/Notifiche/Account erano cerchi blu pieni (solo se attivi) o grigi. Ora ogni icona del dock è un "chip" tondo tinto allo stesso modo (sfondo colore+alpha, come già nei risultati di ricerca), colorato di accent per le voci di sistema senza colore proprio, pieno solo quando attivo — più un leggero ingrandimento al passaggio del mouse per dare continuità tra un'icona e l'altra.
- **Foto profilo (richiesta: "la mia Memoji come immagine profilo, cerchio accanto al nome")** — nuova colonna `users.avatar_path`, upload/rimozione da Impostazioni → Il mio account (PNG/JPG/WEBP/GIF, 5MB), servita pubblica via `/api/avatars/<file casuale>` (un `<img>` non manda l'header di autenticazione, e il nome file è un UUID, mai l'id utente). Il cerchio con la foto compare ovunque comparisse già l'iniziale colorata: pagina Account, icona "account" del dock, intestazione del pannello "Altro" — un solo componente condiviso (`Avatar.jsx`).

## 0.3.47 — 31 ottobre 2026

**Fix reale: un pannello di dettaglio aperto da un widget della Dashboard "apriva male"** — segnalato dal vivo con screenshot (Checklist → click su una riga). Causa: per specifica CSS, un `backdrop-filter` su un antenato (i pannelli di vetro, `.glass-panel`) crea un nuovo "containing block" per i discendenti `position: fixed` — il pannello di dettaglio (`FormDrawer.jsx`), aperto da dentro una card di vetro, restava intrappolato nei confini di quella card invece di coprire tutta la pagina, invece di sembrare "rotto" sembrava solo uno sfondo piatto scollegato dal resto. Risolto spostando `FormDrawer` fuori dall'albero React con un portale (`createPortal` verso `document.body`, stesso pattern già usato da `Select.jsx`) — vale per qualunque pagina, non solo la Dashboard.

## 0.3.46 — 31 ottobre 2026

Quattro rifiniture sul dock, segnalate dal vivo:

- **Icone del pannello "Altro" più grandi** (44px → 64px, griglia a 3 colonne invece di 4) con un effetto di ingrandimento al passaggio del mouse, stile dock macOS — interpretazione migliore da un video di riferimento che non ho potuto riprodurre direttamente: da confermare o rifinire.
- **L'hamburger in alto a sinistra è sparito da mobile**: era ridondante col pulsante "Altro" del dock, che apre lo stesso pannello (lo apre ancora anche il tour guidato quando serve).
- **Spazio recuperato in cima alla pagina**: la barra in testa ora compare solo quando c'è davvero qualcosa da mostrarci ("Chiedi ai dati", solo admin con AI accesa) — altrimenti non occupa più spazio. Lo spazio per la notch (dispositivi con tacca) si riserva una volta sola su `<main>`, non più nella barra.

## 0.3.45 — 31 ottobre 2026

**Il pannello "Altro" diventa un vero launcher** (richiesto dall'utente dopo aver visto un app-launcher macOS): ricerca in cima al pannello invece che nella testa della pagina, griglia di icone al posto della lista. Digitare filtra la griglia sotto per nome E cerca contemporaneamente nei record di tutti i moduli — stessa identica ricerca di sempre (`GlobalSearch.jsx`, ora un componente a sé, usato sia qui che sulla pillola di vetro di Dashboard/Report), solo spostata e doppiamente utile. La testa della pagina non ha più il campo di ricerca.

## 0.3.44 — 31 ottobre 2026

Tre rifiniture segnalate dal vivo sul dock e sul vetro:

- **"Chiedi ai dati"** era rimasto testo nudo accanto alla pillola di vetro della ricerca — ora è una pillola di vetro anche lei, su Dashboard/Report.
- **"Come sta andando"** non aveva mai preso il vetro: gestisce il proprio sfondo internamente (non passa dal wrapper generico della griglia). Corretto alla fonte in `InsightsCard.jsx`.
- **L'icona "Altro" nel dock** era un hamburger (≡), che legge come "apri la navigazione" — confuso qui dove la navigazione è già il dock. Cambiata in una griglia.

## 0.3.43 — 31 ottobre 2026

**Fix: il marchio nello sfondo era troppo "incollato" da vicino** — segnalato dal vivo con uno zoom reale: a 6px di sfocatura restava una forma dai contorni netti (il rettangolo arrotondato e il riquadro interno si leggevano chiaramente), più un timbro che una texture di sfondo. Sfocatura portata a 40px: ora si scioglie in una macchia di luce, resta solo il tocco di colore.

## 0.3.42 — 31 ottobre 2026

**La sidebar diventa un dock orizzontale flottante** (richiesto dall'utente dopo aver visto due proposte di vetro per la navigazione — preferito il dock in stile barra di WhatsApp/iOS alla sidebar verticale di sempre). Sostituisce la rail fissa a sinistra: dock di vetro centrato in basso, le prime 4 voci fisse, il resto (altri moduli raggruppati come prima, Libreria/Builder/Log/Impostazioni/Guida, account/notifiche/tema/password/esci) dietro un pulsante "Altro" che apre un pannello di vetro sopra il dock. Stessa identica logica di prima sotto (notifiche, cambio password, tema, logout), cambia solo la presentazione — e ora desktop e mobile condividono lo stesso componente (prima erano due: rail + drawer off-canvas).

**Fix reale durante la costruzione**: `.glass-panel`/`.glass-pill` impostavano `position: relative` nel CSS — per ordine di sorgente (stessa specificità, regola dopo nel foglio) vinceva su `fixed`/`absolute` di Tailwind applicati dal chiamante, mandando il dock nel flusso normale della pagina invece che ancorato in basso. Tolto: chi usa la classe porta sempre il proprio posizionamento.

## 0.3.41 — 31 ottobre 2026

**Fix: la pillola di ricerca "fa pena"** — segnalato dal vivo con screenshot. Da quando (0.3.39) la barra sticky in alto ha perso il suo sfondo su Dashboard/Report, la ricerca restava l'unica cosa "piatta" (bordo quadrato, sfondo opaco a blocco) in un contesto tutto di vetro. Nuova classe `.glass-pill` (stesso trattamento di `.glass-panel`, angoli a pillola) applicata alla ricerca solo su quelle due pagine. Sulle altre pagine resta quadrata, come sempre.

## 0.3.40 — 31 ottobre 2026

**Il marchio Platform nello sfondo della Dashboard** (richiesto dall'utente): la chiazza di colore in basso a destra, dietro i pannelli di vetro, ora ha il logo vero e proprio — grande, molto sfumato e sfocato, resta parte dello sfondo e non un timbro sopra i contenuti. Theme-aware (più tenue in chiaro).

## 0.3.39 — 31 ottobre 2026

**Fix definitivo: la riga sopra la Dashboard** — il tentativo precedente (0.3.38, bordo tolto, meno opacità) non bastava: qualunque sfondo proprio sulla barra sticky, per quanto tenue, segna comunque un confine nel punto esatto in cui finisce ("impresentabile questa linea", con screenshot). Tolto del tutto: su Dashboard/Report quella barra non ha più nessuno sfondo né sfocatura propria — la ricerca ha già la sua pillola opaca, resta leggibile lo stesso. Verificato anche durante lo scroll.

## 0.3.38 — 31 ottobre 2026

**Fix: un taglio netto sopra la Dashboard** — segnalato dal vivo con screenshot reale. La barra di ricerca sticky in alto (condivisa da tutta l'app) aveva un bordo netto e uno sfondo quasi opaco, che tagliava bruscamente contro lo sfondo sfumato del vetro appena sotto: una cucitura visibile, non un bordo voluto. Solo su Dashboard/Report quella barra ora è più trasparente, più sfocata e senza bordo — si fonde invece di tagliare. Sulle altre pagine resta identica a sempre.

## 0.3.37 — 31 ottobre 2026

**Rifinitura: spazio tra bordo e "Riduci"** — segnalato dal vivo, la barra di un widget aperto aveva solo 4px di margine dal bordo arrotondato della card (`px-1 py-1`), troppo stretto. Portato allo stesso respiro della barra chiusa (`px-4 py-3`), coerente nei due stati.

## 0.3.36 — 31 ottobre 2026

**Fix: il vetro restava coperto dal basso, non solo dall'alto** — segnalato con screenshot reali, dark e light, da mobile. La barra "Riduci/Espandi" di un widget chiuso aveva un suo sfondo opaco (`bg-surface-card`) sopra la card già di vetro: da mobile, dove i widget sono chiusi di default, quello sfondo copriva per intero l'effetto — l'intera Dashboard sembrava piatta. Tolto lo sfondo proprio della barra: ora lascia vedere il vetro del genitore anche chiusa.

## 0.3.35 — 31 ottobre 2026

**Fix: il vetro diventava piatto sui widget lontani dall'alto** (segnalato dal vivo da mobile, con molti widget impilati: una card del tutto scura, senza colore né sfocatura). Causa reale: lo sfondo sfumato (`.glass-mesh-bg`) era `position: absolute`, ancorato all'altezza del blocco di contenuto — con una pagina lunga, i widget a metà/fondo pagina restavano lontani dalle due chiazze di colore negli angoli e la sfocatura campionava solo pixel scuri uniformi. Cambiato in `position: fixed`, ancorato alla finestra: ora qualunque card, a qualunque punto di scroll, ha sempre qualcosa di colorato sotto — come un vetro vero davanti a uno sfondo, non al contenuto.

## 0.3.34 — 30 ottobre 2026

**Prima direzione "Liquid Glass"** (richiesta esplicitamente dall'utente, dopo un mockup di proposta): pannelli di vetro satinato — sfocatura dello sfondo, bordo con un filo di luce superiore, angoli molto arrotondati — su un'area sola, la Dashboard di Finance, per validare la direzione prima di estenderla. Nuove classi riusabili in `index.css` (`.glass-panel`, `.glass-mesh-bg`), theme-aware (il vetro in tema chiaro è molto più opaco di quello in scuro, altrimenti il testo perde leggibilità). Il resto dell'app (sidebar, le altre pagine, i moduli) resta invariato: non è un retheme completo, solo il primo passo.

## 0.3.33 — 30 ottobre 2026

**Fix: la scheda "Modulo mancante" (0.3.32) usava `cp-primary`**, un colore che esiste solo nel frontend di Super Admin — nel tenant restava senza stile (bordo e icona piatti). Corretto con `accent`, il token vero di quel frontend; icona diversa per tipo di proposta (freccia di download per "installa", bacchetta per "crea un modulo nuovo"), etichetta "MODULO MANCANTE" con l'accento del colore del tenant, motivo con un filo laterale invece del corsivo.

## 0.3.32 — 30 ottobre 2026

**«Ti manca un modulo?»**, dentro ogni tenant (Impostazioni → Suggerimenti). Oltre alle osservazioni giornaliere già esistenti (campo poco usato, righe ferme...), una volta alla settimana — e sempre su richiesta col pulsante "Mi manca un modulo?" — l'AI guarda l'insieme dei moduli installati (mai i valori delle righe, solo struttura e qualche indizio già calcolato in locale) e propone UNA cosa: installare un modulo già pronto in Libreria (un tocco, usa la rotta d'installazione già esistente) o costruirne uno nuovo (apre il Builder sul nuovo modulo, con nome e descrizione proposti già scritti). Se non c'è niente di concreto, l'AI risponde "nessuna" — meglio di un suggerimento a sensazione. Mai un'installazione o una scrittura automatica: propone e basta, un tocco decide.

## 0.3.31 — 30 ottobre 2026

**Analisi: gli ultimi due punti rimasti "a righe".** I report e i potenziamenti AI proposti per il tenant diventano schede selezionabili (icona, bordo acceso quando inclusi); ogni processo nell'elenco ha ora un pallino colorato (verde coperto, rosso da costruire, grigio da valutare) accanto al nome, coerente con gli stessi colori usati nelle schede.

## 0.3.30 — 30 ottobre 2026

**Analisi: anche le proposte dell'AI e l'elenco dei processi come schede.** Dopo lo stepper (0.3.29), la stessa cura sulle due liste rimaste a semplici righe di testo: le "Proposte dell'AI" e i processi del riepilogo finale sono ora schede affiancate, col modulo trovato come bordo/badge verde e "da costruire"/"da valutare" in grigio.

## 0.3.29 — 30 ottobre 2026

**Movimenti spostato dentro Impostazioni**, allo stesso livello di "Rivedi collegamenti": entrambe le voci portano la targhetta (TMP), in attesa di trovare una collocazione definitiva.

**Analisi → Tenant: niente più tetto fisso di 8 processi.** L'AI proponeva al massimo 8 processi indipendentemente da quanto l'attività raccontata fosse ricca di dettagli (un caso reale: una mediazione immobiliare descritta in profondità ne otteneva comunque solo 8, con moduli installati senza nessuna relazione tra loro). Ora il numero segue la descrizione — poche righe restano poche, una descrizione articolata può arrivare a 10-15 processi — e una nuova fase AI propone relazioni reali tra i moduli scelti (letti i processi, non solo quelle che un modulo portava già da sé): mai sovrascrive una relazione esistente.

**Analisi: wizard più chiaro da vedere.** Il racconto testuale delle fasi ("…Cerco i processi", "✓ Ho trovato N processi") diventa uno stepper visivo a cerchi collegati — usato sia per orientarsi nei dettagli dell'analisi (Racconta → Processi → Libreria → Tenant) sia per seguire un avanzamento reale (creazione del tenant, compilazione automatica con "Fai tutto").

## 0.3.28 — 30 ottobre 2026

**Creazione di un tenant mai esistito prima falliva** ("Bind mount failed"): il Docker Engine del NAS (a differenza di Docker Desktop) non crea da sé la sottocartella dati mancante per un volume isolato per tenant — funzionava solo per i tenant già migrati il 26/10. Ora la sottocartella si crea esplicitamente prima di avviare il container.

**Fix di sicurezza reale**: un allegato collegato solo tramite il campo File di un record (non tramite la tabella `record_attachments`) era illeggibile da chiunque non lo avesse caricato personalmente, admin incluso — bug introdotto dal fix IDOR del 14/10, mai notato perché finora ogni allegato veniva sempre aperto da chi lo aveva caricato. Trovato dal vivo (una bolletta importata da Drive, "Non hai i permessi"). 17 test di sicurezza (12 esistenti + 5 nuovi) confermano che le protezioni del 14/10 restano intatte.

**Archivio: vere cartelle annidate** (richiesto dall'utente dopo aver visto la divisione automatica per anno su "Bolletta": "voglio vere sottocartelle"). Il valore di una cartella è ora un percorso ("Bollette/2026", "/" come separatore) sullo stesso campo piatto di sempre — nessuna migrazione dati, una cartella esistente senza "/" resta identica a prima. "Nuova cartella" ora compare anche dentro una cartella reale; rinominare una cartella rinomina in cascata anche le sue sottocartelle (e le righe che le usano); eliminare si rifiuta se la cartella ha sottocartelle.

**Collegamento ricevute↔spese** (richiesto dall'utente dopo l'import massivo di bollette/ricevute da Drive): l'abbinamento automatico per solo importo si è rivelato troppo ambiguo su dati reali (lo stesso importo ricorre su decine di spese non collegate tra loro) — niente link scritti alla cieca. Aggiunta una relazione "Ricevuta/Bolletta collegata" su Spese Casa/Personali e una vista di revisione (**Impostazioni → Dati e sicurezza → "Rivedi collegamenti"**) dove ogni proposta letta dall'AI si conferma o si scarta con un clic. Dei ~440 documenti: 211 collegati in automatico (candidata unica per importo, o per importo+data/mese quando una spesa ricorrente mensile lo permetteva), il resto resta per la revisione a mano (file non ancora leggibili — immagini/email — o importi genuinamente ambigui).

## 0.3.16 — 25 ottobre 2026

Chiusura dell'arco "bot + app alla pari" su busta paga e contributi casa, più la risposta a "Platoform è la base, BOT è opzionale" (richiesto dall'utente): tutto ciò che il bot sa fare su questi temi ora esiste anche come vista nell'app, non solo come conversazione.

- Bot: registrare un'entrata a frase libera, timbrare entrata+uscita nello stesso messaggio, domande sugli straordinari, lettura busta paga da foto (oltre che da PDF).
- Fix: una foto di busta paga oltre ~100KB veniva rifiutata dall'AI per un limite sul corpo della richiesta mai impostato.
- Bot: domande sulla busta paga (ferie residue, ore di un mese, buste mancanti, ultima, spiegazione libera di una voce).
- Bot: domande di confronto e proiezione sui dati ("rispetto al mese scorso?", "di questo passo quanto spenderò?").
- Bot: "debito casa" — chi deve soldi a chi sui contributi all'affitto, da una quota fissa per persona (configurabile) confrontata coi versamenti reali del mese.
- Bot: "le ore tornano con le timbrature?" (ore pagate in busta contro ore davvero timbrate, mese per mese) e "quanti giorni di ferie e permessi ho?" (ferie/permessi/ROL insieme).
- Lo stesso report ore-pagate-vs-timbrate e gli stessi saldi ferie/permessi/ROL sono ora visibili anche DENTRO il modulo Busta Paga nell'app, non solo chiedendoli al bot — si mostra da solo quando il modulo dichiarato come "bustapaga" è quello che si sta guardando.
- Fix reale trovato scrivendo il test di questa vista: il confronto "ore timbrate" sommava le timbrature di TUTTI gli utenti, non solo di chi stava chiedendo, sui moduli di presenze senza "solo propri" configurato (il caso di Finance) — non si notava dal bot perché finora l'unica persona testata dal vivo aveva timbrature proprie uniche nel periodo.
- Le 140 buste paga con un allegato sono ora collegate anche a un record nel modulo Documenti (stesso file, nessun doppio caricamento su Drive), così si vedono anche da lì e non solo aprendo il record busta paga.
- **Incidente reale durante il deploy**: la migrazione automatica "porta destinatari WhatsApp e regole Gmail nelle tabelle nuove" falliva per un vincolo del database mai gestito (un modulo pubblicato lascia una riga in `modules_schema_history`, mai ripulita prima di cancellarlo), bloccando l'avvio dell'intero tenant in un ciclo di crash. Trovato e corretto in diretta, con un test che riproduce l'errore reale.

## 0.3.17 — 25 ottobre 2026

**Drive bidirezionale** (richiesto dall'utente: "così carico i file da app Google drive"): finora Platform scriveva solo su Drive (gli allegati creati dall'app), non leggeva mai ciò che qualcuno aggiungeva direttamente da Drive stesso. Ora un poller, ogni 15 minuti, guarda la cartella Drive del tenant e per ogni file nuovo (non ancora conosciuto da Platform) crea un record nel modulo ad archivio (Documenti su Finance) col file già allegato — generico, nessun nome di modulo scritto nel codice, si attiva da solo se c'è esattamente un modulo del genere. Richiedeva lo scope Drive di sola lettura, già incluso nella richiesta di collegamento esistente: nessuna ri-autorizzazione necessaria.

Trovato e corretto nello stesso giro: il salvataggio su Drive era silenziosamente spento (il collegamento Google aveva perso l'interruttore "salva su Drive" durante un ricollegamento precedente, probabilmente quando è stato aggiunto lo scope di sola lettura) — i nuovi file finivano sul disco locale invece che su Drive senza nessun avviso. Riacceso.

## 0.3.18 — 25 ottobre 2026

Due rifiniture a Drive, trovate/chieste dall'utente lo stesso giorno dello 0.3.17:

- **Niente più cartelle doppie**: `ensureDriveFolder` creava una nuova cartella "Platform - Finance" ogni volta che l'id salvato andava perso (è già successo una volta in produzione) — l'utente l'ha segnalato prima che diventasse un problema vero ("non è che ricrea la cartella ogni volta che riconnetto Google?"). Ora cerca sempre prima per nome una cartella già esistente e la riusa; solo se davvero non c'è ne crea una.
- **Sottocartelle Drive = cartelle dell'app** (richiesto: "vorrei vedere una cartella Finance e relative sottocartelle come le vedo in modulo documenti"): un file trovato dentro una sottocartella Drive che corrisponde a un valore vero del campo "tipo" prende quella cartella nel record che crea; e ogni record con cartella e file su Drive già assegnati viene spostato (o lasciato) nella sottocartella Drive giusta a ogni giro del poller — sia i 140 cedolini busta paga collegati a Documenti sia qualunque file caricato dall'app finiscono organizzati per tipo dentro Drive, non più tutti appiattiti in una cartella sola.

## 0.3.19 — 25 ottobre 2026

**Pulsante "Sincronizza Drive"** in Documenti (richiesto dall'utente dopo aver visto il poller in azione: "un tasto aggiorna nei documenti per forzare il sync"): non serve più aspettare il giro automatico di 15 minuti, un tocco controlla subito e dice quanti file nuovi ha trovato e quanti ha riordinato nella cartella giusta.

Fix trovato provando il pulsante dal vivo prima di spedirlo: con un errore vero di Drive (token scaduto, collegamento rotto) il pulsante mostrava "nessuna novità" invece dell'errore — un fallimento reale sembrava un successo silenzioso. Ora un errore resta un errore in faccia a chi ha premuto il tasto.

**Incidente reale, lo stesso giorno**: il container di Finance leggeva e scriveva su un file database sbagliato (`finance.db`, quasi vuoto — nessun modulo busta paga) invece di quello vero (`finance-01.db`, tutta la cronologia reale, rinominato poi semplicemente `finance.db`). La configurazione in Super Admin puntava al file sbagliato da un punto imprecisato della giornata; password e collegamento Google rifatti nel frattempo erano finiti lì e sono andati persi nel ripristino. Corretto: fermato il tenant dall'API ufficiale (mai un `docker stop` a mano), scambiati i file, riavviato — verificato 142 buste paga, 192 documenti, 2352 timbrature di nuovo al loro posto. Google e Client ID/Secret ricollegati sul file giusto.

## 0.3.20 — 25 ottobre 2026

Rifiniture a Drive bidirezionale e un fix reale sul report busta paga, tutti richiesti/trovati lo stesso giorno di 0.3.17-0.3.19:

- **Cartelle vuote sincronizzate**: una sottocartella Drive creata senza niente dentro ("voglio anche le cartelle vuote syncate") ora diventa comunque una nuova opzione del campo "tipo" di Documenti — prima contava solo quando arrivava il primo file. Stessa rotta reale del Builder/ArchiveView per registrarla (`POST /field-options`, azione "add"), stessa cronologia di pubblicazione.
- **File nella radice di Drive sistemati** ("in drive ci sono file nella root, vanno sistemati"): un documento con un file già su Drive ma senza cartella assegnata finisce in "Altro" (il catch-all già tra le opzioni — mai inventato un valore a caso se "Altro" non è dichiarato) e viene spostato lì, invece di restare per sempre nella radice.
- **Fix reale nel report busta paga** (bug "i mesi sembrano sdoppiati"): chi guarda il report ore/timbrature vedendo più persone insieme (chi guarda non corrisponde a nessun "proprietario", es. l'admin) vedeva lo STESSO numero di ore timbrate ripetuto identico su righe di persone diverse — il confronto usava sempre le timbrature di chi guardava, mai quelle della persona a cui quella riga appartiene davvero. Ogni riga ora si confronta con le timbrature della persona giusta, e quando la vista mostra più persone insieme ciascuna riga dice anche di chi è (sia nel bot sia nell'app), così due mesi uguali di persone diverse non sembrano più un doppione.

## 0.3.21 — 25 ottobre 2026

**Server MCP** (richiesto dall'utente: «un MCP per platform, ha senso?»): un client locale (`mcp-server/`, non deployato sul NAS) che espone Platform come strumenti per Claude Code/Desktop — collegabile a qualunque tenant, non fisso a uno. Serviva prima un modo per autenticarsi senza login/2FA ogni volta: **token API personali**, nuovi in Impostazioni → Il mio account → Token API (self-service come passkey/2FA, uno o più, revocabili in qualunque momento, mai mostrati di nuovo dopo la creazione) — parte del codice di ogni tenant, non solo di Finance.

Gli strumenti sono per lo più lettura/scrittura generica sugli stessi moduli dell'app (elenco moduli, schema, lista/leggi/crea/modifica record — mai "elimina") più le stesse risposte già costruite per il bot (chiedi ai dati, report busta paga, debito casa). Nessuna logica duplicata: ogni strumento chiama la stessa API reale di un browser collegato, stessi permessi dell'utente del token. Testato end-to-end per davvero: backend reale, token reale, server MCP avviato come processo a parte, client MCP reale — non un mock di nessuno dei tre pezzi.

## 0.3.22 — 25 ottobre 2026

**Controllo di integrità all'avvio** (richiesto dall'utente dopo l'incidente reale dello stesso giorno: un container montava un database sbagliato, quasi vuoto, senza il modulo busta paga — scoperto ore dopo per caso): `integrity-check.js`, generico, non specifico a nessun tenant. Confronta un'impronta minima del database appena montato (moduli installati + totale record) contro l'ultima nota, salvata ACCANTO al `.db` (mai dentro: scambiare il file sposterebbe anche il riferimento con sé). Un modulo sparito o un calo drastico dei record avvisa su tre canali — log, Log attività, WhatsApp/Telegram — ma non blocca mai l'avvio e non si auto-corregge mai: il riferimento si aggiorna solo con un'azione esplicita (Impostazioni → Sicurezza, dopo un ripristino voluto).

**Guida del bot Telegram**: mancava del tutto nella Guida in-app — nuova sezione "Bot Telegram" (8 argomenti: collegarlo, comandi e menu, come funziona ogni scrittura, cosa sa fare per spese/dati/timbrature/busta paga/costi condivisi, cosa non fa di proposito, limiti). Anche come documento a sé, `docs/GUIDA-BOT.md`.

## 0.3.23 — 26 ottobre 2026

**Cloudflare: da "Flexible" a "Full (strict)"** (richiesto dall'utente: "il traffico tra Cloudflare e il NAS viaggia in chiaro"). Generato un certificato Origin CA di Cloudflare (15 anni, `*.platform-core.it` + `platform-core.it`) e installato su `platform-nginx`, l'unico ingresso condiviso da tutti i tenant e da Super Admin. Scoperta lungo la strada la vera ragione per cui Cloudflare raggiunge il NAS sulla porta 4000 (non 443): una Origin Rule della zona, esistente da prima e indipendente da questa modifica, riscrive la porta di destinazione a 4000 per ogni richiesta — quindi non è servito aprire nessuna porta nuova né toccare la mappatura Docker. L'unico cambio reale è stata la porta 80 (= 4000 dall'esterno) che ora parla TLS invece che in chiaro; applicato con un `reload` nginx (non un riavvio) fatto nello stesso momento del passaggio a Full (strict) in dashboard, per evitare la finestra in cui i due lati non si capirebbero. Verificato subito dopo: Finance e Super Admin rispondono entrambi, nessun errore nei log, container mai riavviato.

## 0.3.24 — 26 ottobre 2026

**"Aggiorna" di un tenant: niente più falso "Errore di rete"** (scoperto dal vivo: il redeploy di Finance da telefono mostrava "Errore di rete: Load failed" a metà del popup, ma sul server l'aggiornamento finiva comunque con successo pochi secondi dopo). La build dell'immagine e l'attesa che il tenant torni a rispondere possono restare silenziose per diversi minuti — Cloudflare chiude da sé una connessione proxy inattiva intorno ai 100 secondi, scambiando il silenzio per una connessione morta. Il popup di avanzamento ora manda un battito ogni 20 secondi (senza testo visibile, solo per tenere viva la connessione) per tutta la durata del redeploy.

## 0.3.25 — 26 ottobre 2026

**Tre lacune di sicurezza reali chiuse** (emerse rispondendo a "Platform è sicuro al 100%?" — documentate ma mai sistemate, `docs/DECISIONI.md` 16/10/2026):

- **Porte dei tenant non più pubblicate sull'host**: prima raggiungibili dalla rete di casa senza passare da nginx/Cloudflare. platform-nginx instrada già per nome container sulla rete Docker interna — togliere la pubblicazione non cambia nulla del routing reale. Unico effetto collaterale: il link "Apri →" per un tenant senza dominio ancora assegnato ora passa da un proxy interno di Super Admin invece che da host:porta diretto.
- **Permessi moduli fatti valere anche sulle API**, non solo sul menu: nascondere un modulo a un utente (`user_modules`) bloccava solo cosa vedeva nel menu — poteva comunque chiamare le API di quel modulo direttamente. Nuova `requireModuleAccess` (stesso stile di `requireAdmin`) su `records.js`/`field-options.js`/`module-ai.js`, con lo stesso identico comportamento di compatibilità già in uso per il menu (admin sempre libero, nessuna riga configurata = nessuna restrizione).
- **Segreto interno condiviso → JWT per-tenant** sulle rotte dove conta sapere DAVVERO chi chiama (`tenant-ai.js`, `registry.js` proposte modulo): prima ogni tenant, conoscendo lo stesso segreto di tutti, poteva dichiarare lo slug di un altro tenant e leggerne/consumarne la chiave AI o il budget. Riusato il pattern già in produzione per l'export/gli inviti (il tenant firma con il proprio `jwt_secret`, mai condiviso). Finestra di transizione: il vecchio segreto condiviso resta accettato (e loggato) finché non tutti i tenant sono stati ridistribuiti col nuovo codice — la rimozione del ramo vecchio è un passo separato, non di questa versione.
- **Isolamento del volume dati per tenant** — **completato la stessa notte**: ogni container tenant montava l'intero volume condiviso, vedendo i database di tutti gli altri tenant più il registro di Super Admin con le relative chiavi. Tornato Docker Desktop disponibile, 17 test di isolamento confermati su Docker vero, poi migrazione dal vivo di ai-sandbox e Finance (backup verificati, copia mai sposta, verifica dei dati prima e dopo ogni passo, mai un minuto di downtime inatteso): ogni tenant ora vede solo la propria sottocartella, confermato con `docker exec platform-<slug> ls /data`. I vecchi file piatti restano sul volume, intatti, come rete di sicurezza.

Trovato e corretto lungo la strada: `scripts/redeploy-nas.sh` aveva un `DB_PATH` sbagliato cablato (puntava a un database vecchio e incompleto) — mai eseguito da quando la discrepanza esisteva, corretto prima che causasse danno.

## 0.3.26 — 27 ottobre 2026

**Nuovo tipo campo del Builder: `barcode`** (richiesto per archiviare oggetti in magazzino). Si comporta come un campo `text` — stesso salvataggio, stessa visualizzazione, nessuna modifica lato backend — con in più un pulsante che apre la fotocamera e legge il codice con l'API nativa del browser (`BarcodeDetector`, nessuna libreria esterna aggiunta). Dove la fotocamera non è disponibile o il browser non supporta la scansione, il campo resta comunque compilabile a mano: la scansione è una scorciatoia, non l'unico modo di usarlo. Verificato dal vivo nel browser: tipo selezionabile nel Builder, pulsante di scansione nel form "Nuovo record", errore corretto quando la fotocamera non è raggiungibile, salvataggio e visualizzazione in elenco identici a un campo di testo.

## 0.3.27 — 27 ottobre 2026

**Il campo Data sfondava lo schermo su iPhone** (segnalato dal vivo: screenshot reale, "Entrate — dettaglio"). Su iOS Safari il controllo nativo di un `<input type="date">` ha una larghezza propria che può superare quella del contenitore — `w-full` da solo non basta a contenerlo in ogni browser. Aggiunto `min-w-0`/`max-w-full` ovunque mancava (il campo generico del Builder usato da ogni modulo, il modale dettaglio, la creazione rapida, due punti della Dashboard) — `TimbratureWidget.jsx`/`SmistaPanel.jsx` ce l'avevano già, segno che il problema era già noto in parte ma non corretto ovunque. Non riproducibile nei miei strumenti (serve Safari reale, non l'emulazione mobile di Chrome) — fix applicato sulla causa nota e documentata di questo esatto sintomo, da confermare dal vivo.

## 0.3.15 — 24 ottobre 2026

Seguito della domanda dell'utente "le entrate di spese casa, come le gestiamo?": le card "Riepilogo mensile — Personale" e "— Casa" puntavano entrambe allo stesso modulo Entrate senza nessun filtro, quindi avrebbero sommato le STESSE entrate su entrambe (es. lo stipendio intero contato anche nella card Casa, invece dei soli contributi versati alla casa).

- Il widget "Riepilogo mensile" ha ora un filtro facoltativo sulle entrate (un campo a scelta del modulo + un valore, stesso schema già usato per `conti`/`campo_tipo`): su Finance, Personale filtra `gruppo = Personale`, Casa filtra `gruppo = Casa` — campo e valori già esistenti nel modulo Entrate (incluse le categorie "Contributo Nima"/"Contributo Federica", mai usate finora da nessun widget). Verificato in locale: Personale mostra solo lo stipendio, Casa solo i contributi, senza doppio conteggio.

## 0.3.14 — 24 ottobre 2026

Due rifiniture ai widget "Riepilogo mensile" affiancati (0.3.12), trovate dall'utente dal vivo dopo il deploy.

- Soglia per affiancare le due card abbassata da 1024px a 640px (`sm:col-span-1` oltre a `lg:col-span-3`): prima serviva una finestra quasi a schermo intero, ora basta una finestra di media larghezza — richiesto esplicitamente dall'utente ("voglio l'affiancata").
- L'anello dello spendibile veniva tagliato dal bordo della card quando non c'era spazio per stare a fianco del testo. Messo sempre sotto il testo (mai più a fianco, nemmeno su schermi larghi): non solo risolve il taglio, ma toglie anche un'inconsistenza trovata subito dopo dall'utente — un testo più corto ("80%") lasciava stare l'anello a fianco mentre uno più lungo ("Nessuna entrata registrata") lo spingeva sotto, facendo sembrare le due card "sfalsate" quando una aveva un segno più/meno e l'altra no.

## 0.3.13 — 24 ottobre 2026

Il popup "Aggiornamento in corso" di Super Admin mostrava ~80 righe — una per ogni passaggio grezzo di `docker build` ("Step 12/26", "---> hash", "Using cache") — richiesto dall'utente dopo averlo visto dal vivo: "troppo verbose... qualcosa di più minimale".

- `docker.js` (docker-provisioner) non inoltra più l'output riga per riga della build: restano solo i 2-3 messaggi di prima (scarico il sorgente, costruisco l'immagine, pronta) più un eventuale errore vero. L'icona che gira sull'ultima riga del popup basta a dire "sta ancora lavorando" durante il minuto che la build può richiedere.

## 0.3.12 — 24 ottobre 2026

Il widget "Riepilogo mensile" sommava Spese Casa e Spese Personali insieme — l'utente lo voleva solo personale, "al massimo dividi le due cose". Sul tenant Finance: il widget esistente è diventato "Riepilogo mensile — Personale" (solo lui), nuovo widget "— Casa" (lui e Federica) — stesso schema già in uso per "Come sta andando". Fatto con le vere rotte dell'app (non scrivendo a mano sul database di produzione).

- `riepilogo_mensile` ora sta affiancato a un altro dello stesso tipo su schermi larghi (come già `come_sta_andando`), invece di occupare sempre tutta la riga — "due riquadri vicini", richiesto dall'utente dopo aver visto la divisione.

## 0.3.11 — 24 ottobre 2026

Richiesto dall'utente dopo aver visto un report «Da pagare» su Telegram: le righe (sia «In arrivo» sia le scadute elencate nel messaggio) hanno ora un punto elenco e la data in grassetto come "chiave" — più facili da scorrere a colpo d'occhio. Stesso testo condiviso con WhatsApp (nessun doppione da mantenere allineato): `*grassetto*` e `• ` sono già capiti da entrambi i client.

## 0.3.10 — 21 ottobre 2026

Due rifiniture al bot Telegram, richieste dall'utente dopo averlo provato: "ok i comandi sono migliorati? hai messo i tasti?".

- Foto profilo del bot impostata sull'icona di Platform (prima quella di fabbrica di Telegram) — fatto anche a mano sul bot già collegato in produzione.
- Il menu nativo "/" di Telegram ora elenca i comandi fissi del bot (`/menu`, `/report`, `/timbra`, `/ore`, `/aiuto`, `/scollega`) con una breve descrizione: prima Telegram non sapeva che comandi avesse, perché il bot non li aveva mai dichiarati (`setMyCommands`, chiamato ora dentro `connect()`). Applicato anche al bot già collegato in produzione, che altrimenti lo avrebbe avuto solo al prossimo ricollegamento.

## 0.3.9 — 21 ottobre 2026

Richiesto dall'utente ("potenzia il bot il più possibile"), con un vincolo chiaro: niente agente sempre acceso stile OpenClaw — la RAM del NAS è fuori discussione, e il bot di Telegram è già profondo (domande sui dati, azioni proposte con conferma, scontrini/bollette letti dall'AI, timbrature, report proattivi già configurabili su Telegram). Il gap vero, verificato leggendo `bot-ai.js`: ogni frase viene interpretata da sola, senza alcuna memoria — un "e il mese scorso?" dopo una domanda non significava niente per il modello.

- Nuova **memoria minima del bot** (`bot-memory.js`, tabella `telegram_memory`): un solo scambio per chat (ultima domanda + cosa si era capito), passato al modello come contesto facoltativo — "e il mese scorso?", "anche per la luce?" ora funzionano come seguiti naturali.
- Scade da sola dopo 15 minuti di inattività: una domanda nuova non eredita per sbaglio il contesto di una vecchia. Nessun processo in più, nessuna libreria nuova — solo una tabella e un parametro opzionale in più nei prompt già esistenti (`ai-bot.js`/`ai-ask.js` su Super Admin).

## 0.3.8 — 21 ottobre 2026

Richiesto dall'utente: con più verticali diversi, ciascuno salvato come app sul dock (macOS/Chrome), tutte avevano la stessa icona blu/viola — nessun modo di distinguerle a colpo d'occhio nel dock/launcher.

- Nuovo tab **Impostazioni → Aspetto**: un colore per l'app (`accent_color`, colonna già esistente da agosto ma senza UI — "white-label minimo" mai collegato a un posto da cui impostarlo).
- Quel colore ora arriva anche nell'icona: `core/backend/src/pwa-icon.js` ricolora icon-192/512, apple-touch-icon e il `theme_color` del manifest ogni volta che il colore viene salvato (o riportati di fabbrica se il colore viene tolto) — nessuna libreria di grafica con binari nativi (niente canvas/sharp, già causa di problemi in passato), solo pngjs (puro JS) con un lerp(colore, bianco) sulla "bianchezza" di ogni pixel.
- L'apple-touch-icon in `index.html` non è più inline (base64 fisso, non ricolorabile) ma un file esterno, come le altre icone.

## 0.3.7 — 20 ottobre 2026

Bug reale trovato scavando su una segnalazione dell'utente ("oggi è arrivata una mail e non è stata smistata"): con l'app Google in modalità "Test" il token scade dopo 7 giorni (noto, documentato) — ma quando scade, il controllo automatico delle mail (ogni 15 minuti) falliva **in totale silenzio**, zero log e zero avviso, da quando era stato introdotto. Il codice trattava "Google mai collegato" (stato normale, giusto restare muti) e "era collegato, il token è scaduto" (guasto vero) allo stesso identico modo. Risultato: bollette smesse di arrivare senza che nessuno se ne accorgesse finché non mancava una mail vera.

- Ora, solo quando il collegamento ERA attivo e smette di funzionare, parte un avviso WhatsApp una tantum (non si ripete a ogni ciclo di 15 minuti) che dice di ricollegare da Impostazioni → Connessioni → Google. Si azzera da solo al primo controllo che torna a funzionare, pronto per avvisare di nuovo alla prossima scadenza.
- L'utente ha scelto esplicitamente di non pubblicare l'app Google ("non la voglio pubblicare") — il ciclo di scadenza ogni 7 giorni resta quindi normale amministrazione, non un difetto da correggere: da qui in avanti, almeno, non passa inosservato.

## 0.3.6 — 20 ottobre 2026

Due correzioni in core/frontend, segnalate dall'utente dal vivo.

- **Mancava il modo di eliminare un record dalla sua scheda di dettaglio**: l'unico cestino esisteva nell'icona a fianco di ogni riga nell'elenco — chi apriva un record per guardarlo o modificarlo (il posto più naturale dove cercarlo) non trovava modo di cancellarlo. Aggiunto un bottone "Elimina" accanto a "Modifica" nell'intestazione del dettaglio, con conferma, rispettando lo stesso permesso già configurato nel modulo (nessun cambio per chi non ha il permesso di eliminare).
- **Tolta la sotto-intestazione a due gruppi ("Esportazione" / "Backup e disaster recovery") nella scheda Dati di Impostazioni**, aggiunta nel ridisegno del 18/10 — segnalata come non convincente ("nesting... non mi piace così"): la card "Distacca su un tuo server" è da sempre un accordion a tutta larghezza, non una card come le altre due, e sotto un titolo di gruppo stonava. Tornata alla griglia unica di prima.

## 0.3.5 — 18 ottobre 2026

Stesso trattamento della nuova Impostazioni del tenant applicato a quella di Super Admin (solo `super-admin/frontend`) — richiesto esplicitamente dall'utente dopo aver visto le due affiancate ("impostazioni in admin fanno pena comunque"). Qui le sezioni erano già solo 4 in una pagina sola (niente tab-bar da sostituire come nel tenant): aggiunta la stessa sidebar raggruppata (Account / Piattaforma / AI) per coerenza visiva, nessun cambio di logica o di contenuto nelle 4 sezioni esistenti (Utenti Super Admin, Il tuo accesso, Chiavi AI, Sicurezza della piattaforma).

## 0.3.4 — 18 ottobre 2026

Bug reale segnalato dall'utente subito dopo la 0.3.3: le tendine dei `<select>` (es. "Ruolo" in Invita una persona) e gli altri controlli nativi del browser (selettore data/ora, scrollbar) restavano chiari anche col tema scuro — non sono DOM della pagina, li disegna il sistema operativo, quindi le variabili CSS della palette non li toccano. Una riga CSS per tema (`color-scheme: dark`/`light`) basta a farli seguire il tema: nessuna variabile di colore cambiata.

## 0.3.3 — 18 ottobre 2026

Nuova palette colori, su tutta la piattaforma (core/frontend e super-admin/frontend, entrambi i temi) — scelta esplicitamente dall'utente dopo aver visto il mockup di Impostazioni ("mi piace come schema colori").

- **Tema scuro**: sfondo e card passano da blu notte (`#031321`/`#061927`) a grigio neutro (`#0B0D12`/`#14161D`); l'accent da blu acceso (`#087BFF`) a un blu più tenue (`#5B8DEF`).
- **Tema chiaro**: sfondo passa dalla scala Tailwind "stone" (calda) a un grigio neutro freddo (`#F6F7FA`); per la prima volta il tema chiaro ha un suo accent dedicato (`#2F5FEA`) — prima non lo sovrascriveva e restava quello scuro anche di giorno.
- **Lasciati invariati apposta**: i colori semantici di stato (successo/avviso/errore, già tarati per contrasto il 16-17/10) e il bianco-etichetta per tenant (un progetto con un colore proprio continua a sovrascrivere l'accent a runtime, invariato).
- Stessa mappatura applicata identica a entrambe le app, per non rompere la coerenza visiva tra core e Super Admin voluta dal reskin di agosto (`PLATFORM-UI-RESKIN-PLAN.md`).
- Provato dal vivo (tenant locale, non solo compilazione): entrambi i temi, dashboard e Impostazioni.

## 0.3.2 — 18 ottobre 2026

Ridisegno di Impostazioni (solo core/frontend) — "impronta SaaS enterprise" richiesta esplicitamente: la vecchia barra di 12 tab orizzontali non aveva più ordine, sostituita da una sidebar laterale con 6 categorie (Account, Workspace, Integrazioni, Sito Web, AI, Dati & Sicurezza).

- **Riorganizzazione dei contenuti**, non solo la navigazione: destinatari e log WhatsApp spostati da Connessioni a Report (restano un'unica funzione, ma vicino a cosa configurano davvero); email di notifica delle richieste del Sito Web spostata da Sito Web a Connessioni (nuovo `SiteLeadEmailPanel.jsx`); "Giro guidato" tolto da Il mio account e spostato in Guida (bottone in testa alla pagina); intestazioni di raggruppamento aggiunte dentro Il mio account (Profilo/Sicurezza/Notifiche), AI (Attivazione/Chiave e spesa/Per modulo) e Dati (Esportazione/Backup e disaster recovery).
- **Bug trovato e corretto durante il collaudo dal vivo** (tenant locale, non produzione): il nuovo pannello email del Sito Web in Connessioni compariva anche sui tenant con la funzione Sito Web spenta, e il salvataggio falliva sempre (403) perché la rotta richiede quella funzione accesa. Ora il pannello è nascosto quando la funzione è spenta, come lo era la scheda da cui proveniva.
- Provato dal vivo (non solo compilazione): tutte le 6 schede, il salvataggio dei destinatari WhatsApp spostati in Report, e il bottone "Fai il giro guidato" in Guida.

## 0.3.1 — 18 ottobre 2026

Primo giro dal vivo della 0.3.0 su Finance (dati reali): trovati e corretti tre bug reali che la rendevano di fatto inutilizzabile, più un cambio nel modo in cui "Aggiorna" porta online il codice.

- **Il blocco "Vista" nuovo non funzionava mai su un modulo che lo usava da solo** (`core/backend/src/routes/records.js`): le 5 route che calcolano i dati (per periodo, riepilogo annuale, pivot, barre settimanali, genitori-figli) cercavano il blocco solo nei vecchi array per-tipo, mai nel nuovo array unificato `views` — errore "Vista non trovata" anche con lo schema pubblicato giusto. Aggiunta copertura di test che prima mancava del tutto su queste 5 route.
- **"Pubblica" nel Builder poteva pubblicare il nulla**: il tasto mandava sempre un corpo vuoto al server, promuovendo solo una bozza già salvata — su un modulo mai salvato come bozza (tipicamente appena creato) ripubblicava lo schema vecchio invariato, perdendo in silenzio ogni modifica fatta a schermo. Ora salva sempre prima lo schema corrente, poi lo pubblica.
- **"Aggiorna" (Super Admin → Tenant) ora builda sempre dal sorgente più recente su GitHub**, dentro il `docker-provisioner` (unico servizio con accesso Docker) — prima ricreava il container dall'immagine già presente sul NAS, che poteva essere vecchia se nessuno aveva lanciato `redeploy-nas.sh` a mano dal laptop prima. Vedi `OPERAZIONI.md` per il dettaglio.
  - **Incidente reale durante questo cambio**: il nome del volume dati impostato per questo nuovo meccanismo era sbagliato (`platform_platform-data`, un volume quasi vuoto, invece di `platform-data`, quello vero — un errore che `OPERAZIONI.md` avvisava già di evitare). Il primo "Aggiorna" di Finance con questo codice ha agganciato il container al volume sbagliato, facendo credere per una decina di minuti che l'account e i dati fossero spariti. Non è stato perso nulla: il volume vero non era mai stato toccato, e la causa è stata trovata e corretta nello stesso pomeriggio. Nessun dato reale è stato scritto sul volume sbagliato nel frattempo (l'accesso era bloccato).
- Confermato dal vivo, non solo nel sandbox: schema, moduli legacy (period_view, yearly_breakdown, category_pivot) e il nuovo blocco Vista coesistono senza conflitti sullo stesso modulo reale (Spese Personali, Entrate).

## 0.3.0 — 18 ottobre 2026

Semplificazione del Builder ispirata a Collections (l'app da cui Platform discende) — 5 fasi, tutte additive: nessun modulo esistente cambia comportamento finché non si usa esplicitamente qualcosa di nuovo dal Builder.

- **Blocco "Vista" unificato**: una sola voce nel Builder (icona, non più tendina) con 4 modalità — per periodo, pivot per categoria, barre settimanali, genitori con figli — al posto di 5 block_type quasi identici. I moduli con un vecchio blocco (vista per periodo, riepilogo annuale, ecc.) restano identici per sempre, mai convertiti.
- **Liste condivise** (Impostazioni → Liste): un campo `select`/`multiselect` può collegarsi a una lista condivisa invece di avere opzioni private — aggiungere/rinominare/togliere una voce si propaga da sola a tutti i campi collegati, in qualunque modulo, comprese le righe già esistenti in caso di rinomina.
- **Formula più coerente**: il blocco "Formula / Aggregato" (valore singolo) ora vede le stesse funzioni del campo calcolato (`active_tier`, `running_sum`, le aggregazioni sui figli) — prima la verifica dal vivo nell'editor falliva per formule che in pubblicazione funzionavano già.
- **Sources scriptabili** ("Fonte esterna"): un modulo può cercare su un'API esterna (due script JS: uno cerca, l'altro costruisce il record) e proporre un nuovo record — pulsante "Cerca da fonte esterna" accanto a "Nuovo". Gli script girano isolati (niente accesso a file/processi), con un "Prova" dal vivo nel Builder che non scrive mai un record. **Scelta esplicita**: l'accesso di rete degli script è libero (nessun blocco su IP privati) — amplifica il rischio già aperto e non corretto del segreto/volume condivisi tra tenant (vedi `DECISIONI.md`, controllo di sicurezza del 16/10).
- **Sotto-tipi via "Configura sotto-tipi"**: su un campo `select`, un pannello elenca gli altri campi del modulo con "Sempre visibile" / "Solo se [opzione]" — scrive lo stesso "Visibile solo se..." di sempre su più campi da un posto solo, invece di aprirli uno a uno. Nessun concetto nuovo nello schema.
- **Libreria**: il pannello "Struttura" di un modulo registrato mostra ora anche Viste e Fonti esterne, non solo Campi/Relazioni/Workflow/Automazioni/Permessi.

### Limiti noti (scelte, non difetti da correggere)

- Sources e Liste condivise funzionano solo nel codice dei tenant: in Super Builder (il sandbox di Super Admin) si possono disegnare ma non provare davvero (nessuna route lì).
- I widget della Dashboard non supportano ancora il nuovo blocco "Vista" unificato, solo i vecchi tipi.
- ~~Nessuna delle 5 fasi è stata ancora usata su dati reali di Finance~~ — provato dal vivo il 18/10, vedi 0.3.1: tre bug reali trovati e corretti (il blocco Vista in pratica non funzionava).

## 0.2.1 — 17 ottobre 2026

Round di pulizia e sicurezza (16-17 ottobre), senza nuove funzioni visibili.

- **2FA aggirabile sui download di Super Admin corretta**: i link con `?token=` (backup dei tenant, export dei moduli e dell'immagine) accettavano il token "in attesa della 2FA" e gli utenti disabilitati; con la sola password si scaricava il database di un tenant. Ora passano dallo stesso controllo di tutto il resto.
- **Niente più segreti con valore di riserva**: `INTERNAL_API_SECRET` e `JWT_SECRET` non ricadono più su un valore scritto nel codice se la variabile d'ambiente manca — l'avvio si rifiuta invece di aprire le API interne o il provisioner.
- **Utenti disabilitati fuori subito dai tenant** (non più fino alla scadenza del token), un admin declassato perde i privilegi alla richiesta successiva.
- **Allegati**: si aprono nel browser solo PDF, immagini non SVG e testo; il resto si scarica. Corretto anche il download con nomi che hanno accenti o €.
- **Dipendenze aggiornate** (`proxy-addr`, `qs`, `uuid`, `@grpc/grpc-js`, `nodemailer` v10); le immagini Docker usano il lockfile (`npm ci`) invece di `npm install`.
- Super Admin non si apre più dentro un iframe di un altro sito.
- **Pulizia**: tolte sei rotte interne dei tenant mai chiamate, Guida riscritta sul codice attuale (verticali, moduli di supporto, Store non più descritti se non esistono più), qualche funzione morta tolta.
- Pannello **«Sicurezza della piattaforma»** (in Impostazioni, già nelle note del 15 ottobre) resta il punto dove vedere lo stato: 2FA/passkey, limiti anti-forza-bruta, eventi sospetti, TLS Cloudflare.

### Resta aperto (decisioni, non bug corretti)

- Ogni tenant ha lo stesso `INTERNAL_API_SECRET` di Super Admin e del provisioner, e monta tutto il volume `/data` (compreso il registro con le chiavi di tutti i tenant).
- Le porte dei tenant sono pubblicate sull'host: raggiungibili dalla rete locale senza passare da nginx.
- Il limite ai tentativi di accesso conta l'IP del proxy, non quello vero.
- Cloudflare resta in modalità TLS "Flexible" (traffico in chiaro tra Cloudflare e il NAS).
- Password trovate in chiaro nella cronologia Git (prima della pulizia del 21 agosto) non sono state ruotate.
- Nessuna verifica di sicurezza esterna è mai stata condotta.

## 0.2.0 — 13 ottobre 2026

**Dalla sera del 13 ottobre in poi** (le voci più sotto, fino a «Formato dei report su WhatsApp compatto», sono precedenti):

- **Un solo Builder** per tenant e Super Admin (`shared/frontend/builder/`), con «Proponi alla Libreria» (tenant) e «Salva nella Libreria» (Super Admin). Prima erano due copie sincronizzate a mano.
- **Libreria del tenant**: spunti più moduli e li installi insieme (dipendenze comprese, presenti saltati; il menu si aggiorna da solo). **Parti da un modello**: tessere di verticali (gruppi di moduli pensati per funzionare insieme); ogni modello ha la sua **guida all'uso** («Come si usa»: da dove cominciare, modulo per modulo; stampabile in PDF).
- **Collega i moduli**: relazioni proposte dai nomi (es. «Righe ordine» → «Ordini»), confermate una per una, create con storia e versione.
- **Primi passi** al primo avvio di un tenant vuoto (scegli cosa gestire, collega, utenti, connessioni; pillola «Primi passi N/4») e **giro guidato** (evidenzia gli elementi sulla pagina; a richiesta da Primi passi e da Il mio account, mai da solo).
- **Impostazioni → Funzioni**: gli interruttori delle funzioni facoltative (Suggerimenti, Report, Sito Web, WhatsApp…). Prima non esisteva nessuna schermata per accenderle.
- **Analisi più profonda**: un processo ha un modulo principale più altri; il secondo passaggio **«Cosa manca?»** (da solo in «Fai tutto», o su richiesta) propone i moduli in più e segna ciò che nessun modulo copre. **Correggi a parole**: scrivi cosa cambiare, l'AI propone operazioni controllate, le vedi in italiano e le applichi tu. **PDF impaginato** (A4, copertina, schede non spezzate) e **Guida all'uso del verticale** nato dall'analisi (da dati, senza AI).
- **Libreria di Super Admin**: filtri per gruppo e per ruoli dichiarati; scheda **«Dove è usato»** (tenant che hanno il modulo con la versione e chi ha un aggiornamento, moduli che si collegano); **Verticali** gestibili da interfaccia (crea, modifica, elimina, ripristina i predefiniti).
- **Distacco su un tuo server** (Impostazioni → Dati): una **copia** del progetto su un server Linux via SSH (immagine, database, allegati, segreti), che funziona da sola. Controllo di sola lettura prima, impronta del server fissata, credenziali solo in memoria, token firmato col segreto del tenant. Senza Super Admin: niente AI, Libreria e aggiornamenti.
- **Inviti**: link monouso (72 ore) con cui la persona sceglie da sé utente e password; dal tenant (Utenti & Ruoli → «Invita») e da Super Admin (Tenant → Credenziali, e dopo la creazione dall'Analisi). Consegna: copia, WhatsApp e Telegram con messaggio pronto, email dalla posta di Super Admin.
- **Versione 0.2.0** su tutti i badge, `/health` e `package.json`.

- **Report su WhatsApp ridisegnati** (11 ottobre): niente più riepilogo del mattino né report settimanali. Tre messaggi: **quanto devo pagare** (ogni 27, venerdì prima se è weekend, dal 27 al 26 con totale, scadute e «ti restano»), **da smistare** (ogni sera finché non smisti) e **voci scadute** (lunedì sera). Impostazioni → Report, con anteprima, «Invia ora» e pulsante per togliere i vecchi report dai moduli. Dopo l'aggiornamento di Finance: aprire Impostazioni → Report e premere «Toglili dai moduli».

- **Bot Telegram** (11 ottobre): secondo canale dei report e bot a doppio senso. I report arrivano con i bottoni **«✅ Pagata»** (chiude la voce in Finance, con «↩ Annulla») e «Apri l'app»; comandi `/pagare`, `/scadute`, `/smistare`. Ogni telefono è collegato a un utente con un codice monouso e vede/fa solo ciò che può nell'app (Federica solo Casa). **Non è ancora in uso**: serve creare il bot con BotFather e collegarlo (vedi `docs/OPERAZIONI.md`). Mai provato con Telegram vero (solo con un Telegram simulato nei test). Le domande libere con l'AI non ci sono.
- **Bot Telegram «full powered»** (11 ottobre): capisce frasi libere e fa quasi tutto ciò che si fa nell'app — domande sui dati, segnare pagata/riaprire, smistare, registrare spese, importare un PDF mandato in chat — ma **ogni modifica è una proposta con bottone di conferma** e passa dagli stessi controlli dell'app (permessi dell'utente, «solo propri»). Non elimina né modifica dati a piacere. Richiede l'AI accesa e **Super Admin aggiornato** (nuova rotta `bot-intent`). Mai provato con Telegram e Mistral veri, solo simulati nei test.
- **Sicurezza** (11 ottobre): **segreti cifrati a riposo** (credenziali Google/WhatsApp/Telegram e segreti 2FA, in Finance e Super Admin; migrazione automatica all'avvio), `/2fa/setup` non sostituisce più il segreto di chi ha già il 2FA attivo, **librerie aggiornate** (Finance 0 avvisi; nodemailer 10; dockerode 4.0.12). Il **provisioner** va rilasciato a parte. I backup precedenti hanno ancora i segreti in chiaro fino a quando scadono.
- **Foto di scontrini al bot** (11 ottobre): mandi la foto, Mistral legge esercente/data/totale/categoria, il bot propone la spesa («pagata» o «da pagare») con avviso di doppione, e dopo il tuo tocco la crea con la foto allegata. Richiede **Super Admin aggiornato** (nuova rotta `receipt`) e «Importare» acceso sul modulo. **Mai provato con Mistral vero**; l'immagine arriva a Mistral (non si può oscurare).
- **Timbrature dal bot** (12 ottobre): un modulo può dichiarare nel Builder (Ruoli del modulo → tipo «Timbrature») quali campi sono data, entrata e uscita. Il bot allora capisce «sono entrata», «uscita alle 12:30», «ieri sono entrata alle 7», «quante ore ho fatto questa settimana?» e ha `/timbra` e `/ore`. **Eccezione voluta alla conferma**: la timbratura si registra subito (altrimenti è scomoda) ma passa dagli stessi permessi dell'app e ha il bottone **«↩ Annulla»** (15 minuti). L'uscita chiude solo l'ultima entrata aperta (oggi o ieri). Le ore **a cavallo della mezzanotte** ora si calcolano giuste (22:00→01:00 = 3h, prima negative); turno con un orario mancante = 0. Dopo «Aggiorna» Finance dichiara da solo il modulo `timbrature`; le ore di qualche turno notturno già inserito cambiano. Mai provato con Telegram e Mistral veri.
- **Privacy e pulizia di Super Admin** (13 ottobre): tolto l'**Update Manager** (resta il pulsante Aggiorna); l'**Attività** mostra solo le azioni di Super Admin e gli errori tecnici dei tenant, non più cosa fanno gli utenti dentro Finance (azioni e movimenti dei record restano nel registro di Finance). Richiede **Aggiorna** su Finance perché il tenant smetta di esporre il resto.
- **Più generico** (13 ottobre): tolti dal codice i nomi dei moduli e dei campi di Finance. L'**estratto conto** (abbinamento e registrazione delle uscite), le **mail Gmail**, i **riepiloghi** («Come sta andando»: stati «da smistare»/«pagato», rate, data incerta), lo **smistamento AI** e **Chiedi ai dati** leggono ciò che i moduli dichiarano nel Builder (Ruoli del modulo: nuovi usi «estratto», nuovi ruoli note, data incerta, debito, categorie «rata», sezione «Estratto conto»). I valori di Finance sono un file di dati (`seeds/finance-roles.json`) applicato **una volta** all'aggiornamento (ruoli e uso «estratto» completati sulle dichiarazioni esistenti, senza toccare le scelte già fatte). Tolti il vecchio pulsante «Azzera giacenze» (residuo di Coffee) e la sua rotta. Numeri di Finance invariati (stessi test, con le dichiarazioni dei moduli).
- **Report configurabili** (13 ottobre): ogni report è una definizione (tipo + parametri) e si possono aggiungere dalla scheda Report: totale in un periodo, righe in uno stato, in ritardo, **ore lavorate** (per persona, dalle timbrature). Titolo, simbolo, frase finale, stato guardato, righe mostrate, frequenza, giorno e ora si cambiano dall'app. I tre report di prima sono tre definizioni di partenza: **stessi messaggi, stessi orari** (le impostazioni già salvate si convertono da sole). Nel bot ogni report ha il suo comando `/nome` e `/report` li elenca; l'AI sceglie tra i report del tenant. Nuovo tipo **«Riepilogo ore e straordinari»**: ogni domenica sera (a scelta) ogni persona riceve le ore della settimana, il mese finora e lo straordinario (le ore oltre la soglia settimanale, 40 di partenza). **A chi arriva** si sceglie per ogni report: su Telegram gli utenti (nessuna scelta = tutti i telefoni collegati), su WhatsApp il tag dei destinatari.
- **Proprietario delle righe automatiche per modulo** (13 ottobre): in Builder → Ruoli del modulo si sceglie chi è il proprietario delle righe create senza una persona (mail, estratto conto, rate, importazioni) in quel modulo; senza scelta vale il proprietario del progetto (Impostazioni → Utenti), come prima.
- **Chiave AI separata per Super Admin** (13 ottobre): Super Admin ha una chiave sua (Impostazioni → Chiavi AI, salvata cifrata), distinta da quelle dei tenant; non la usa mai un tenant. Un interruttore decide se i tenant senza chiave propria ripiegano sulla chiave generale (di partenza sì): spento, ogni tenant deve avere la sua. Il contatore della spesa di Super Admin è già a parte (consumi senza tenant).
- **Analisi dei processi in Super Admin** (13 ottobre): nuova voce «Analisi». Racconti un'attività, l'AI propone i processi, li rifinisci (scopo, ruoli, passaggi e bivi, eccezioni, documenti, KPI, modulo che li copre o «da costruire»), vedi cosa copre la Libreria, apri il **manuale dei processi** (stampabile / PDF) e puoi **creare il tenant** con moduli, ruoli e stati del flusso. Ripreso dal vecchio Platform senza clienti, preventivi e prezzi. Costa sulla chiave AI di Super Admin; l'AI propone e tu confermi. **Mai provato con Mistral vero.**
- **Proponi alla Libreria** (13 ottobre): un tenant può proporre un suo modulo (dal dettaglio del modulo, nella Libreria del tenant). Parte **solo lo schema** (campi, stati, relazioni), mai le righe, e finisce in una **coda** in Super Admin → Libreria → «Proposte dai tenant»: lo approvi (diventa una nuova versione con l'origine di quel tenant, con gruppo e descrizione modificabili) o lo rifiuti con un motivo, che il tenant vede in «Proposte inviate». Una sola proposta in attesa per modulo (una nuova sostituisce la vecchia). Niente entra nella Libreria da solo.
- **Suggerimenti sul tenant, di nuovo** (13 ottobre): funzione facoltativa **spenta di partenza** (si accende dalle Funzioni del tenant), poi Impostazioni → Suggerimenti. Ogni giorno osserva come usi i moduli, **in locale e senza AI**: campi mai compilati o quasi, campi di testo che ripetono pochi valori (potrebbero essere una scelta), righe ferme in uno stato da oltre 14 giorni, passaggi del flusso mai raggiunti; servono almeno 20 righe. Una notifica agli admin al massimo ogni 7 giorni. «Spiega e proponi» chiama l'AI su una singola osservazione: arrivano solo struttura e conteggi (mai i valori delle righe) e torna una spiegazione prudente con al massimo 4 passi; **niente si applica da solo** (si apre il modulo nel Builder). Le voci ignorate restano ignorate, quelle risolte si chiudono da sole. Non è il vecchio «Usage Insights»: il motore delle segnalazioni di allora era già stato rimosso, questo è nuovo e più piccolo.
- **Controllo automatico del codice** (13 ottobre): ESLint (solo errori veri) e `scripts/verifica.sh` (lint + test + compilazioni), con un hook a ogni push. Il primo giro ha trovato **cinque errori reali** nascosti nei rami poco usati, ora corretti: le azioni di automazione che chiamano un indirizzo web (Slack, WhatsApp…) non avevano caricato `http`/`https`; l'azione «invia notifica» del Builder non riceveva l'elenco dei ruoli (in entrambi i Builder); la scheda dei tenant in Super Admin richiamava due funzioni dei vecchi suggerimenti e dei verticali, rimosse da tempo.
- **Analisi: «Fai tutto»** (13 ottobre): un solo racconto e un pulsante. In background (circa un minuto) l'AI trova i processi e il nome dell'attività, li completa tutti (tre alla volta, solo i campi vuoti, un errore non ferma gli altri) e abbina moduli, report e AI; poi arrivi a **un riepilogo** (processi, moduli, ruoli, report spenti) con un solo tocco per creare il tenant. I dettagli a passi restano per chi vuole controllare («Rivedi i dettagli»). I dati personali vengono tolti prima di mandare il testo all'AI. Mai provato con Mistral vero.
- **Analisi più completa** (13 ottobre): (1) i moduli generici ora portano la **dichiarazione dei ruoli** (quale campo è l'importo, la scadenza, lo stato…): i tenant nati dall'analisi hanno report, riepiloghi e bot già pronti, senza passare dal Builder; (2) la pagina propone i **report** e i **potenziamenti AI** adatti ai moduli scelti (spenti finché non li accendi, ognuno si può togliere); (3) un processo «da costruire» ha il pulsante **«Costruiscilo nel Super Builder»** con la descrizione già pronta; (4) tre moduli generici nuovi: **Spese, Entrate, Timbrature** (55 in tutto), e un nuovo tipo di modulo, la **pratica** (righe con stati e scadenza ma senza denaro: ticket, ordini, scadenzario, manutenzioni…), che entra negli avvisi e nei report senza inventare importi. Il tenant, alla creazione, completa senza sovrascrivere (`/api/internal-setup/apply`). Nel pulsante della Libreria, «Completa i moduli generici» aggiunge i ruoli a quelli già importati.
- **Analisi: «Completa tutti i processi», creazione del tenant in background, eliminazione** (13 ottobre): un pulsante completa con l'AI tutti i processi incompleti (tre alla volta, solo i campi vuoti, un errore non ferma gli altri); la creazione del tenant parte in background e la pagina mostra le fasi e i secondi (container, database, dominio, moduli, ruoli) e, a fine corsa, **dove è andato il tempo** per ogni fase; non installa più i moduli di default (ha scelto l'analisi) e collega il dominio in parallelo all'avvio del database. L'accesso admin iniziale si vede una volta. Le analisi si eliminano dall'elenco e dall'analisi aperta (non durante la creazione).
- **Moduli generici nella Libreria** (13 ottobre): **55 moduli senza settore** (anagrafiche, preventivi, ordini, fatture, scadenzario, presenze, ticket, impianti, soci, prenotazioni…) recuperati dal vecchio Platform e importabili con un tocco da Super Admin → Libreria → «Aggiungi i moduli generici». Sono dati (`seeds/moduli-generici.json`), non codice; si importano una volta, senza sovrascrivere. Hanno nome e descrizione, che l'analisi dei processi usa per abbinarli. Un modulo porta con sé quelli a cui è collegato (righe fattura → fattura, prodotti, clienti). Sono mattoncini di partenza (da 2 a 8 campi): si rifiniscono nel Builder.
- **Menu di Super Admin alleggerito** (14 ottobre): «Utenti» non è più una voce a sé — è ora la prima scheda di Impostazioni (gestione degli account resta lì, password e 2FA restano self-service, invariati). «Analytics» non è più una voce a sé — è ora la scheda «Metriche» dentro Attività, accanto a «Eventi». Nessun dato o funzione tolta, solo due voci in meno nel menu (9 → 7).

- **Gestione utenti di Super Admin più completa** (14 ottobre): ogni riga ora mostra se il 2FA è attivo; si può **rinominare** un utente (clic sul nome), **resettare la password** di un altro admin e **disattivare il suo 2FA** (recupero per chi resta bloccato — entrambe richiedono la TUA password, mai quella del bersaglio, e restano in Attività), **eliminare** un utente per sempre (non più solo disabilitarlo). La propria password e il proprio 2FA restano SOLO self-service (qui sotto, in Impostazioni), nessuna di queste azioni si può fare su se stessi.
- **Passkey** (14 ottobre): in aggiunta al 2FA, non al posto — entri con l'impronta, il volto o il PIN del dispositivo, senza scrivere username né password (tenant e Super Admin). Si aggiungono e si tolgono da Impostazioni/Il mio account → Passkey, quante se ne vuole. Nella schermata di accesso compare solo se il browser le supporta.
- **Login dei tenant semplificato** (14 ottobre): tolta la variante a due colonne con titolo configurabile (un dato vecchio, irraggiungibile da nessuna schermata di questo frontend, dettava un login diverso dal resto dell'app) — ora è sempre la stessa card centrata, come Super Admin.
- **Recupero dell'ultimo admin di Super Admin bloccato** (14 ottobre): se non c'è un altro admin da cui farsi resettare password/2FA, uno script sul NAS lo fa in modo pulito (`docker exec super-admin-backend node src/scripts/break-glass-reset.js <username> <nuova-password> [--disable-2fa]`) — tracciato in Attività, mai una rotta di rete. Vedi `docs/OPERAZIONI.md`.
- **Bot Telegram: menu a bottoni** (14 ottobre, `/menu`): sottomenu a tocco per tutto quello che si fa più spesso — Spese & Entrate (nuova spesa, scontrino/bolletta, chiedi ai dati), Timbrature (se dichiarate), Report. **Si affianca a tutto il resto, non lo sostituisce**: frase libera e comandi funzionano esattamente come prima, il menu è solo un altro modo di arrivarci.
- **Widget dashboard «Timbrature rapide»** (14 ottobre, rivisto il 15): due righe sempre visibili, **Entrata** e **Uscita**, ciascuna con data e orario che scegli tu prima di premere (di partenza oggi/adesso, ma modificabili — non un tocco cieco sull'ora corrente). «Esci» chiude il turno aperto nella data scelta: utile se c'è un turno dimenticato aperto da un altro giorno. Il recap di oggi e l'elenco dei turni restano sola lettura; un link apre il modulo vero per modificare o eliminare una riga già esistente. Generico come gli altri widget — legge QUALE modulo è dichiarato Timbrature (Builder → Ruoli del modulo); visibile a chi vuoi (Impostazioni → Utenti → «Widget · N»), utile per esempio per Federica. (Due versioni precedenti nello stesso giorno, un semplice tocco e poi un editor a comparsa, erano risultate troppo complicate.)
- **Leggi busta paga** (14 ottobre, foto dal rullino il 15): nuovo tipo di modulo, kind `bustapaga` (Builder → Ruoli del modulo: periodo, lordo, netto, ore pagate, trattenute). Con il potenziamento AI «Leggi busta paga» acceso, carichi il PDF **o una foto** della busta paga (anche dal rullino, non serve scansionarla) e l'AI propone periodo/lordo/netto/ore pagate/trattenute (propone, non scrive — confermi tu); il modulo confronta subito le ore pagate con le timbrature già registrate in quello stesso mese (modulo di tipo Timbrature, se c'è), evidenziando la differenza. La riga nasce con il file allegato: un archivio di tutte le buste paga, mese per mese. Sul PDF l'AI legge il testo (a Mistral arriva solo l'estratto, IBAN/codice fiscale/numeri lunghi già tolti da `redact()`, mai il file); sulla foto usa la visione del modello, come per gli scontrini del bot — lì l'immagine arriva per intero, non si può oscurare. **Mai provato con Mistral vero** né con una vera busta paga italiana (PDF o foto): i primi mesi potrebbe servire correggere qualche campo a mano.
- **Formato «Ore» nei report del Builder** (15 ottobre): i blocchi «Ore totali», «Report raggruppato/Formula» e «Grafico settimanale» ora hanno un formato **Ore (da un campo in minuti)**, che divide per 60 e mostra "h" invece del numero grezzo. Bug reale trovato sul modulo Timbrature di Finance: il campo calcolato `durata_minuti` (uscita − entrata, in minuti — corretto, usato anche dalla soglia straordinari) veniva mostrato col formato «Numero», quindi "2123" invece di "35,4 h". Corretto anche dove mancava proprio il selettore del formato (le metriche di «Ore totali», `period_view`). **Da fare sul modulo Timbrature di Finance** (non un redeploy, una scelta nel Builder): aprire Builder → Timbrature e cambiare il formato in «Ore» sui blocchi «Ore oggi», «Ore settimana corrente», «Ore totali» e «Ore per settimana».
- **Bug reale nel Builder: «Vista periodo» e «Ore per settimana» sparivano riaprendo un modulo** (15 ottobre): aprendo nel Builder un modulo che aveva già un blocco `period_view`, `weekly_breakdown`, `yearly_breakdown`, `category_pivot`, `parent_children_view`, `view_tabs` o «Crea in filiale» (es. Timbrature: «Ore totali», «Ore per settimana»), quel blocco non compariva più nell'editor — e una pubblicazione da lì lo cancellava per davvero, non solo dalla vista. Stesso tipo di bug già preso una volta per le automazioni (stessa riga di codice, un pezzo dimenticato): il Builder, riaprendo un modulo, ricostruiva l'elenco dei blocchi senza includerli. Scoperto dal vivo tentando di sistemare il formato di «Ore totali» su Timbrature — nessun modulo risulta averlo perso finora (si corregge solo riaprendo e pubblicando), ma è stato vicino.
- **Super Admin, «Tenant attivi» allineato al grafico a fianco** (15 ottobre): il numero nel riquadro KPI ora viene dallo stesso conteggio live della «Distribuzione tenant per stato» (`/analytics/platform-overview`, solo stato Attivo), non più da una foto storica (`metrics_snapshots`) che poteva restare indietro rispetto ai dati veri — da qui il disallineamento visto (3 contro 2).
- **Libreria: le 55 categorie dei moduli generici, vere** (15 ottobre): finora erano **tutti** etichettati «Generico» (una sola, non divideva niente). Ora nove categorie vere (Finanza, Vendite, Acquisti, Magazzino, Progetti, Risorse umane, Assistenza clienti, Organizzazione, Servizi alla persona), scelte dal nome/descrizione di ciascun modulo. I moduli già importati in Super Admin si ricategorizzano da soli all'avvio (solo quelli ancora con l'etichetta «Generico»: una categoria già cambiata a mano non si tocca).
- **Pannello «Sicurezza della piattaforma»** (15 ottobre): in Impostazioni (Super Admin e, in versione ridotta, ogni tenant) — quanti admin hanno 2FA/passkey attivi, i limiti anti-forza-bruta già in vigore, e gli **ultimi eventi sospetti** (accessi falliti, codici 2FA/passkey sbagliati) dal registro attività. Su Super Admin anche la **cifratura in transito di Cloudflare**, letta davvero dall'API (oggi è «Flexible»: il traffico tra Cloudflare e il NAS viaggia in chiaro — nessuna correzione fatta qui, solo mostrata com'è) e due note ferme (password trovate in chiaro nella cronologia Git prima della pulizia del 21 agosto non sono state ruotate; nessuna verifica di sicurezza esterna è mai stata condotta). Ogni pannello legge SOLO i propri dati: Super Admin non entra in un tenant, un tenant non vede Super Admin né altri tenant.

- **Formato dei report su WhatsApp compatto** (scadute non ripetute, importi puliti).

### Da verificare dal vivo (non provato in produzione)

Nessuna schermata nuova è stata provata in un browser da chi l'ha scritta: i test automatici passano, la verifica visiva è da fare.
- **Libreria**: tessere dei modelli, installazione multipla (compare nel menu senza ricaricare?), «Collega i moduli» (le proposte hanno senso su moduli veri? si è visto un doppio «Clienti» su un tenant: da capire se si ripresenta), guida di un modello e stampa in PDF.
- **Primi passi** su un tenant vuoto e **giro guidato** (anche su telefono: menu aperto, evidenziazione).
- **Analisi**: «Cosa manca?», «Correggi a parole», PDF del manuale e della guida (anteprima di stampa), creazione di un tenant vero con Mistral vero.
- **Inviti**: pagina `/invito/…` sul tenant, mail con la posta vera (mai provata), WhatsApp/Telegram.
- **Distacco su un server**: provato solo con un server SSH di prova e un Docker finto; la prima volta farlo su un server di prova. Gli indirizzi privati sono vietati di partenza (`EXPORT_ALLOW_PRIVATE=1` per un server in rete locale).
- **Suggerimenti** sui tenant reali (vanno accesi da Impostazioni → Funzioni); Gmail, bot, scontrini con Mistral vero; le prove di Federica.
- **Aggiornamento di Finance** a 0.2.0: premere «Aggiorna» da Super Admin (serve il 2FA) e controllare che il badge dica 0.2.0.
- **Leggi busta paga**: mai provato con Mistral vero né con un vero PDF di busta paga italiana — da creare il modulo, dichiarare i ruoli e accendere il potenziamento, poi caricare una busta paga reale e controllare i campi letti.

### Da sapere

- Un tenant **distaccato** non ha Super Admin: AI, Libreria e aggiornamenti non ci sono (l'AI tornerebbe con una chiave propria nel tenant, che non esiste ancora).
- Le **mail** (inviti) partono dalla posta di Super Admin (SMTP): se non è configurata, il messaggio lo dice e si usa il link. Tetto di 30 al giorno per tenant (contatore in memoria).
- Il **link di un invito** si vede una volta sola; nel database resta solo l'impronta.
- I **verticali** stanno in una tabella di Super Admin, riempita al primo avvio da `seeds/verticali.json`; «Ripristina i predefiniti» rimette solo quelli eliminati.
- Idee rimaste fuori di proposito: federazione tra più Super Admin, bot Telegram per l'amministrazione, invio automatico su WhatsApp/Telegram.

### Numeri

62 suite di test per il tenant, 34 per Super Admin, 1 per il provisioner, tutte verdi; `bash scripts/verifica.sh` (lint, test, compilazioni) passa.

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
