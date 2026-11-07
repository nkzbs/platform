# Note di rilascio

Una voce per ogni chiusura di fase. Il numero di versione è quello di tutta la piattaforma (sidebar di Finance e Super Admin, `/health`, `package.json`); si cambia a mano a ogni chiusura. Il perché delle scelte sta in [`DECISIONI.md`](DECISIONI.md).

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
