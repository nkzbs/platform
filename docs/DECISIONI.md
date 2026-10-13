# Registro delle decisioni

Cosa è stato tolto o deciso e perché, così tra un anno si sa perché una cosa non c'è. Ogni voce ha una data.

## 2026-10-02 — Platform riparte da 0.1

**Contesto.** Platform era diventata una piattaforma commerciale: livelli Core / Partner / Tenant, licenze,
fatturazione, marketplace dei moduli, verticali, CRM dei clienti, federazione tra istanze, app mobile. Il
bisogno vero era uno solo: gestire le proprie finanze (Finance). Dopo uno sguardo dal vivo a Super Admin è
emerso che il problema non erano le singole funzioni ma la direzione: troppa infrastruttura per tenant
ipotetici. Il vecchio repository (con tutta la storia) è stato archiviato come privato (`platform-old`) e il
lavoro riparte da questo, con il codice potato e la versione 0.1.0.

**Identità.** Platform è il coltello multiuso personale per i miei progetti, non un prodotto. Vedi
[`PLATFORM-VISIONE.md`](../PLATFORM-VISIONE.md).

**Regola contro l'eccesso.** Un pezzo nuovo entra solo se serve a un progetto reale che esiste oggi. "Potrebbe
servire a un tenant futuro" non è un motivo.

### Tolto

| Cosa | Perché |
|---|---|
| Partner, billing, licenze, prezzi, CRM dei clienti, fatture, supporto commerciale | Nessun cliente, nessun rivenditore: erano costi di manutenzione senza uso |
| Verticali (modelli di tenant per settore) | Erano template commerciali; un tenant nuovo si costruisce o si riempie dalla Libreria |
| Marketplace dei moduli: certificazione, autore, vendor, categorie, "in evidenza", screenshot, ciclo di vita, visibilità privata/pubblica, anteprima | Sono funzioni per un ente che approva moduli di terzi; qui c'è un solo autore. Sostituito dalla **Libreria** |
| Federazione tra istanze (pairing, tenant esterni, migrazione verso altri server, import/export delle immagini) | Pensata per più "core" che si agganciano; non esiste più quella visione |
| App mobile (SwiftUI e Capacitor iOS/Android), modalità offline e sincronizzazione, stampa Bluetooth | Nessun uso; avevano reso `api.js` e `useApi.js` più complicati |
| Raccomandazioni e misurazioni da "analisi clienti" | Nate dal CRM dei clienti |
| Pagina **Reportistica** (provvigioni degli agenti e margini sui prodotti, nata con Coffee) e la sua rotta AI | Compariva solo nei tenant con agenti, fatture e prodotti: Finance non l'ha mai vista. I riepiloghi veri stanno nei moduli di spesa e nella dashboard |
| Tour guidato al primo accesso | Non serve a chi ha costruito il sistema |
| Invito di un "cliente" via email e creazione utente dal link | Un solo operatore: gli utenti si creano a mano |
| Integrazioni non usate (Fatture in Cloud, WhatsApp Business, Slack, Stripe, Mailchimp, Resend) dall'elenco | Restano visibili solo Google e WhatsApp (CallMeBot), le uniche usate. Ricompare un'integrazione se un modulo installato la richiede |
| Password admin fissa scritta nel codice | Sostituita da una password casuale (o da variabile d'ambiente) |
| ~25 colonne commerciali di `tenants`, ~20 tabelle inerti, la storia di migrazioni di `db.js` | Il database di Super Admin riparte da uno schema pulito di 12 tabelle |

- **Update Manager** (13 ottobre): tolti la pagina, la coda per la propagazione notturna e il rollback/import/export dell'immagine. Con un solo tenant il pulsante **Aggiorna** sulla scheda del tenant basta. Restano `redeploy-all` e la tabella `update_manager` (inerte, non toccata).

- **Privacy dell'Attività di Super Admin** (13 ottobre): Super Admin non legge più cosa fanno gli utenti dentro un tenant. Dal tenant esce solo l'elenco degli **errori tecnici** (`/api/audit-log/internal/monitoring-feed` risponde solo con `error_logs`); le azioni degli utenti e i movimenti dei record restano nel tenant, nel suo registro e nello storico di ogni riga. Nell'Attività di Super Admin restano le azioni di Super Admin stesso e gli errori dei tenant.

- **Accesso di Super Admin ai tenant, da ridurre** (13 ottobre): «Apri →» **chiede le credenziali admin del tenant** (non entra da solo) e resta. Decisione di Nima: **in futuro Super Admin non dovrà avere ponti verso i dati dei tenant**. Oggi i ponti reali sono: «Reset credenziali» (imposta una nuova password admin del tenant), le chiavi del tenant (`jwt_secret`, `encryption_key`) conservate nel database di Super Admin e il controllo dei container. Niente di nuovo in Super Admin deve dipendere da questi: così toglierli sarà solo una cancellazione.

- **Report come definizioni, proprietario per modulo** (13 ottobre): i tre report non sono più tre messaggi scritti a mano ma definizioni (tipo + parametri) con quattro tipi generici; il proprietario delle righe automatiche si sceglie per modulo (con ripiego sul predefinito del progetto). Motivo: «Platform sempre generico e configurabile» (vedi `PLATFORM-VISIONE.md`). Un tipo nuovo di report richiede ancora codice (una primitiva), un report nuovo di un tipo esistente no.

- **Analisi dei processi tornata, senza la parte commerciale** (13 ottobre): ripresa dal vecchio Platform (processo con ruoli, passaggi e bivi, copertura della Libreria, manuale stampabile, creazione del tenant con ruoli e stati). Restano fuori clienti, partner, preventivi, prezzi e licenze, e la misurazione prima/dopo che leggeva i dati dei tenant. Un'analisi è un documento di Super Admin, collegabile al tenant che ne nasce.

### Tenuto, anche se "non serve oggi"

| Cosa | Perché |
|---|---|
| **Sito Web** (page builder del tenant) | È lavoro già fatto e testato che potrebbe servire; resta isolato e **spento di default** (`site_enabled = 0`). Unica eccezione alla regola sopra |
| **Super Builder / Builder** | È il pezzo di maggior valore: dove nascono i moduli |
| **Dominio pubblico automatico** (Cloudflare + nginx) | Un tenant nuovo deve essere raggiungibile subito |
| **Statistiche tra tenant** e **API interna tra Super Admin e tenant** | Base per far "interrogare" più tenant tra loro |
| **Backup, export, ripristino, 2FA** | Dati finanziari reali |

### Cambiato

| Prima | Dopo |
|---|---|
| "Store" / "Registro" con wizard di pubblicazione e installazione | **Libreria**: salvi un modulo da un tenant (nasce una versione), lo installi in un altro tenant come **copia**, e il tenant vede "Aggiorna" quando esce una versione nuova |
| Dettaglio modulo con 8 schede (Panoramica, Versioni, Campi, Relazioni, Workflow, Permessi, Guida, Certificazione) | 3 schede: **Panoramica, Struttura, Versioni** |
| Pagina Store nei tenant con tab, settori, categorie, copertine | **Libreria** a due sezioni, Installati e Disponibili |
| Pulsante "Installa" nel tenant che andava in errore (`setLicenseKey` non esisteva più) | Corretto |

### Difetti trovati e corretti durante la potatura

- **Sottodomini mai creati**: `createTenant` chiamava `upsertSubdomain(autoDomainLabel)`, una variabile mai
  definita (già nel codice originale). L'errore finiva solo nel registro attività. Corretto, con test e con un
  avviso visibile in Super Admin.
- **Segreti nelle API**: l'elenco dei tenant restituiva `encryption_key`, `jwt_secret` e le credenziali offsite
  del backup. Ora vengono tolti, con un test.

## 2026-10-02 — Assistente AI per Finance (fase 1)

**Cosa.** Smistamento delle bollette in arrivo da Gmail: l'AI (Mistral, mistral-small) propone categoria, importo,
scadenza e fornitore; l'utente accetta o ignora.

**Scelte.**
- L'AI **propone, non scrive**: nessuna modifica ai dati senza un'accettazione esplicita.
- Il tenant non ha la chiave né parla con Mistral: tutto passa da Super Admin, dove stanno la pulizia dei dati
  personali, il tetto di spesa e il controllo dell'output.
- Il tetto è **in euro al mese** (10 € di default) e a tetto raggiunto le chiamate si fermano da sole.
- **Spento di default.**
- Ai modelli arrivano mittente, oggetto e le prime righe del testo, **senza** IBAN, telefoni, email, codici fiscali
  e numeri lunghi.

## 2026-10-02 — Notifiche WhatsApp con esito vero

**Problema.** CallMeBot risponde HTTP 200 anche quando rifiuta un messaggio (chiave sbagliata, numero non
attivato). L'invio partiva senza attendere la risposta e il registro scriveva "chiamata_reale" prima ancora di
inviare: un messaggio mai arrivato non lasciava nessuna traccia.

**Ora** (`core/backend/src/whatsapp.js`): si legge la risposta, si riprova per i problemi temporanei (rete, servizio
occupato) ma non per quelli certi (chiave non valida), il registro riporta l'esito per destinatario
(inviato / parziale / FALLITO + motivo), un messaggio non consegnato genera un avviso nell'app (uno all'ora per
motivo) e gli invii escono uno alla volta con qualche secondo di distanza. In Impostazioni → Connessioni c'è
"Invia messaggio di prova".

## 2026-10-03 — Riepilogo del mattino

**Problema.** Un messaggio WhatsApp per ogni riga in scadenza è rumoroso (CallMeBot limita anche la frequenza) e
l'avviso "scadenza oggi" guardava solo il campo `scadenza`, che le righe di Finance usano poco: la data di
scadenza sta di solito in `data`. Inoltre i lavori pianificati contano le ore in **UTC**: "ora: 8" significa le
10 in estate e le 9 in inverno in Italia.

**Ora** (`core/backend/src/daily-digest.js`): un solo messaggio al giorno, all'ora italiana scelta (default 08:00),
con le spese da pagare *oggi*, *domani* e *in ritardo* (entro 45 giorni, per non trascinare residui vecchi),
più il numero di bollette da smistare. La scadenza è `scadenza` se c'è, altrimenti `data`. Non manda nulla se
non c'è niente da segnalare, e al massimo una volta al giorno.

**Spento di default.** Quando è acceso, gli avvisi "scadenza oggi" per singola riga non partono più (verrebbero
doppi); gli altri tag (bolletta, rata, report) non cambiano. Si accende da Impostazioni → Notifiche, dove ci sono
anche l'anteprima e "Invia ora".

## 2026-10-03 — Commento ai report e "Spiega questo report" (fasi 2 e 3)

**Cosa.** Due usi dello stesso meccanismo: (2) il report mensile su WhatsApp si chiude con una frase di commento;
(3) in ogni pagina Report, il pulsante «Spiega questo report» scrive qualche riga sui totali che stai guardando.
Era previsto "Reportistica" come pagina, ma quella pagina non esiste più (vedi sopra): il pulsante sta nel
pannello Report che ogni modulo con un campo numerico e uno a selezione già ha.

**Scelte.**
- All'AI vanno **solo i totali per gruppo** (le categorie, con il confronto col periodo prima), mai le righe né le descrizioni.
- Le **variazioni percentuali le calcola il programma**: il modello non fa conti.
- **Ogni numero** scritto dal modello deve esistere nei dati forniti (anche arrotondato o scritto all'italiana; le
  percentuali devono essere una delle variazioni date). Altrimenti il testo è scartato e non arriva a nessuno.
- Il commento WhatsApp è **spento di default** e **non blocca mai il report**: se l'AI non risponde, ha raggiunto il
  tetto o sbaglia un numero, il report parte com'era. Non parte nulla all'anteprima delle automazioni.
- «Spiega questo report» funziona anche con l'interruttore spento (è una richiesta esplicita) e rispetta lo stesso
  tetto di spesa mensile.
- Le istruzioni al modello stanno su Super Admin (`lib/ai-report.js`), insieme alla verifica dei numeri.

## 2026-10-03 — Una chiave Mistral per ogni tenant

**Scelta.** Ogni progetto (Finance, ...) ha la sua chiave Mistral e il suo tetto di spesa. Si inserisce da
Impostazioni → Assistente AI del tenant. Il tenant la manda a Super Admin, che la controlla con Mistral (elenco
modelli, nessun costo), la conserva **cifrata** nel registro e non la restituisce mai (le API mostrano solo
"configurata" e le ultime 4 cifre). Il tenant non la tiene.

**Perché a Super Admin e non nel tenant.** Le chiamate continuano a passare da Super Admin, che resta l'unico punto
verso Mistral: pulizia dei dati personali, controllo dei numeri e tetto restano in un posto solo.

- Il **tetto** (default 10 € al mese, `AI_MONTHLY_BUDGET_EUR`) vale **per tenant**: i consumi sono registrati con il tenant
  che li ha fatti (`ai_usage_log.tenant_slug`) e gli avvisi dell'80% e del 100% sono separati per tenant.
- `MISTRAL_API_KEY` dell'ambiente resta come **ripiego**: un tenant senza chiave sua la usa (e la spesa conta comunque
  nel suo tetto). Senza né l'una né l'altra, l'assistente risponde "nessuna chiave" e non chiama nessuno.

## 2026-10-03 — Regole Gmail e Destinatari WhatsApp: impostazioni del sistema, non moduli

**Perché.** Non sono spese o entrate da consultare ma impostazioni: chi riceve quali messaggi, e quali mail diventano
spese. Averli come moduli era un residuo di come erano nati.

**Ora.** Hanno tabelle proprie (`whatsapp_recipients`, `gmail_rules`) e si gestiscono da Impostazioni: i destinatari in
**Notifiche**, le regole Gmail in **Connessioni** (sotto Google). I moduli `whatsapp_destinatari` e `gmail_regole` non esistono
più: né nel menu, né nella Libreria, né nel Builder. Il codice è in `core/backend/src/notification-settings.js`.

**Migrazione** (`migrateLegacy()`, all'avvio e dopo ogni import di un backup): copia le righe rimaste in `records` nelle
tabelle nuove e, nella stessa transazione, toglie righe, moduli e permessi vecchi. È idempotente. Una riga incompleta
non viene persa: resta dov'è e il modulo non viene tolto finché c'è qualcosa da salvare. Provata su una copia dei dati
reali di Finance (6 righe → 1 destinatario e 5 regole). I backup JSON includono le due tabelle; un backup vecchio
(con i due moduli come righe) si importa lo stesso.

### Corretto durante il lavoro

- **Pile di righe sulla stessa data (importazione del 4/8/2026).** Serie mensili intere erano accatastate su una data sola (13/12/2025 o 18/04/2025):
  gonfiavano singoli mesi (dicembre 2025 sembrava avere 8.263 € di spese, aprile 2025 ne aveva 16.414 €), riempivano di falsi "da pagare" e falsavano i confronti.
  Riallineamento del 3/10/2026 (backup `finance-prima-riallineo-2026-10-03.json`):
  - 46 copie tolte (le pile del 13/12/2025 erano doppioni di serie già presenti con le date giuste: Benzina + treno, Dazn Netflix Prime, iCloud + AC, Spese mese);
  - 63 date ripristinate dalla vecchia app per le pile del 18/04/2025 (anche 22 che un mio errore dello script aveva annullato, poi rifatte);
  - 34 righe "AE 4 n/66" tolte perché doppie delle rate collegate alla Quarta Cartella (le rate 37-48 create il 3/10 duplicavano quella serie);
  - 37 righe ricategorizzate (Benzina → Auto & Benzina, Assicurazione Auto → Assicurazioni).
  Le righe "da pagare" scadute da oltre 30 giorni sono passate da 32 a 4.
  **Restano 35 righe impilate sul 18/04/2025** (circa 7.500 €: Iper Tosano ×17, Spese mese ×9, Cristian Bai, Michele Clerici, R.A.M. caldaia): non esistono nella vecchia app né
  tra i movimenti del conto personale (probabilmente pagate dalla Prepagata), quindi la data vera non è recuperabile. Invece di inventare date, quelle 35 righe (7.509 €) sono marcate `data_incerta` con una nota e **escluse dai conti mensili**; la scheda "Come sta andando" lo dichiara ("Non contate in nessun mese: N spese…").
  Lezione per gli script di scrittura: una riga si riscrive sempre partendo dalla copia più recente, mai da una letta all'inizio.

- La **Checklist** in dashboard (periodo "questo mese") non permetteva di cambiare mese: ora ha le frecce avanti e indietro, il nome del
  mese e "Torna a oggi" (`ChecklistWidget.jsx`).

- **"Chiedi per le righe da smistare (N)" risaliva dopo ogni "Accetta".** Accettare applicava i campi ma lasciava la riga in "da smistare", che tornava tra
  quelle da chiedere. Ora Accetta esegue anche la transizione già prevista dal flusso delle spese, "Conferma categorizzazione"
  (da smistare → da pagare). Una riga già "da pagare" o "pagato" non cambia stato.

- **Scadenza sbagliata (2028) sulle bollette.** `estraiScadenzaGenerica` sceglieva la data futura **più lontana** del testo, che in una
  bolletta è la fine del contratto ("Data di scadenza del contratto: 30.04.2028"), non la scadenza del pagamento ("Rata unica entro il
  08.09.2026", caso reale A2A). Ora: prima una data introdotta da "entro il / scadenza / rata unica", mai una data del contratto, di
  rinnovo o di offerta; altrimenti la più **vicina** nei prossimi 90 giorni; altrimenti nessuna. Anche l'assistente scarta una scadenza
  più lontana di ~13 mesi, e il pannello mostra sempre cosa ha capito (anche i campi già giusti, "già impostato").

- **Luce o gas, controllato sui PDF veri.** La bolletta A2A da 201 € è luce (595 kWh); quella segnata "44 €" è **gas** e il 44 era il consumo
  (44 Smc), non l'importo: il lettore delle email prendeva i consumi per euro. Ora `estraiImporto` scarta le quantità (Smc, kWh, mc, kW).
  Inoltre, con un titolo "Gas/Luce" e **nessuna prova** (né PDF né kWh/Smc nel testo) il modello tirava a indovinare: ora la categoria di
  energia resta vuota con confidenza bassa (la regola sta in Super Admin, `routes/tenant-ai.js`).

- In Libreria compariva un modulo **"Sito Web" da installare**, mentre il Sito Web vero è una funzione delle Impostazioni (scheda Sito Web).
  Erano due moduli segnaposto vuoti (`sito_web`, `sito_avanzato`: nessun campo, non installati) rimasti da una versione vecchia.
  All'avvio `core/backend/src/legacy-cleanup.js` li toglie, ma solo se sono davvero vuoti (non installati, schema senza blocchi, nessun record).

- **Luce o gas?** Una bolletta "A2A Energia Gas/Luce" arrivava all'assistente senza categoria: il titolo non basta, il tipo sta nel PDF
  allegato. Ora il PDF si legge in locale (`core/backend/src/attachment-text.js`, `pdftotext`) e un programma calcola un **indizio**
  (kWh, POD, "energia elettrica" = luce; Smc, PDR, "gas naturale" = gas; entrambi se ci sono segni di tutti e due). A Super Admin
  escono solo l'indizio e un estratto delle righe utili (importi, scadenze, consumi, tipo di fornitura), **senza codici lunghi, IBAN né
  l'intero PDF**. Se l'indizio dice chiaramente luce o gas, la categoria è quella, anche se il modello rispondeva altro o non sapeva;
  se è ambiguo o il PDF non si legge, la proposta parte lo stesso, senza forzare niente.

- Il riquadro delle **proposte dell'assistente** (bollette da smistare) stava sopra l'elenco di Spese Casa, e un riquadro uguale
  sopra Spese Personali. Spostato in **dashboard**, in un elenco solo (`GET /api/ai/overview`): riguarda entrambi i moduli ed è
  la prima cosa che si apre.

- La scheda **Debiti** dentro Spese (e Spese Casa) mostrava solo "#3966" invece del nome del debito: quando una scheda legge un
  altro modulo, la pagina non ha le righe di quel modulo e il titolo ripiegava sull'id. Ora `ParentChildrenView` carica le righe del
  modulo dei debiti, usa il campo *nome* come titolo e aggiunge il creditore.

- Il riepilogo del mattino **non è mai partito in produzione**: `startDailyDigest()` chiamava `.catch()` sul risultato di
  `withLock()`, che è una funzione e non una promessa, e ogni minuto finiva in un `TypeError` nel registro. I test passavano perché
  chiamavano `tick()` direttamente. Corretto, con un test che avvia il controllo come fa il server.

- Il commit "Assistente AI, WhatsApp…" nel repository nuovo conteneva solo la parte `core/`: mancavano i file di Super Admin
  (`lib/ai-budget.js`, `lib/ai-redact.js`, `routes/tenant-ai.js` con lo smistamento bollette, ecc.). Il NAS era a posto,
  il repository no. Recuperati dalla cartella vecchia e committati.

## 2026-10-03 — Piano AI per Finance: "Come sta andando" (fase 1)

**Principio.** Il programma fa i conti, Mistral li racconta. All'AI arrivano solo totali già calcolati, mai righe né
descrizioni; ogni numero del testo è controllato da Super Admin (cfr. "Commento ai report").

**Scelte fatte** (dopo aver confrontato Finance con gli estratti conto del conto personale e del Conto Casa, 2020-2026, e con le
indicazioni di Nima del 2026-10-03):
- **Vista personale ("io").** Entrate = stipendi (il netto accreditato). Spese = **solo Spese Personali**, comprese le quote versate
  alla casa (categoria *Contributo Casa*). Le **spese di casa non contano**: sono un registro condiviso, e in parte le paga
  Federica (l'affitto, spesso direttamente al proprietario: dai movimenti, dal 2026 non passa più dal Conto Casa). Contarle tutte
  gonfiava le spese personali. Fuori dalle entrate anche i contributi alla casa (gruppo *Casa*) e i riporti di saldo ("Saldo conto").
- **Accantonamento.** Dal 2025-12 una parte dello stipendio (10% del lordo) è **trattenuta in busta** e va in un fondo/azioni: sul
  conto arriva il netto, e il netto 2026 è circa 290 €/mese più basso (confermato dai dati: 2.184 € contro 1.894 € di media
  gennaio-settembre). Le righe *Fondo* non sono entrate sul conto, ma sono **risparmio vero**: la scheda mostra "Entrate sul conto",
  "accantonati" e il risparmio contando anche l'accantonato. Dove manca la riga con l'importo vero, si **stima** con il rapporto
  mediano accantonato/netto degli altri mesi, e la scheda lo dichiara ("stima"). Gli estratti conto non contengono il lordo.
- **Accordo sulla casa.** Di norma Nima versa **500 €/mese** al Conto Casa (causali "Budget mese X") e Federica 400 €. Se in un mese
  Nima non versa (non ha budget), l'affitto da 550 € lo paga Federica, direttamente o dal Conto Casa. I versamenti di Nima sono in
  Spese Personali con categoria *Contributo Casa*, con data e importo della banca (22 righe, 9.725 €, gennaio 2025-settembre 2026,
  importate dagli estratti conto). La parte versata **in meno** dei 500 € è un debito verso Federica: da gennaio 2025 a ottobre
  2026 sono 2.130 € nei mesi in meno e 1.355 € nei mesi in più, **775 € netti**; registrato in Debiti Personali (senza piano
  rateale: la creazione del debito genera di norma le rate, qui tolte). Non è una spesa finché non lo restituisce.
- **Pagamenti** e **Debiti** non contano come spese: le rate sono già dentro Spese Personali.
- Le righe "da smistare" non sono spese finché non si smistano.
- **Il mese di una spesa è il campo `data`** di Finance. Il confronto con le banche ha mostrato che le date delle spese NON sono
  sfasate in modo fisso (Finance segna la scadenza, la banca il pagamento: scarto da -2 a 0 mesi), quindi nessuna correzione.
- **Anomalia** = categoria con almeno +25% e +20 € rispetto alla media dei mesi precedenti (finestra di 6; la media conta solo
  i mesi con spese registrate), oppure una categoria nuova da almeno 50 €. Soglia minima di saldo 300 € (per la futura previsione di cassa).
- **Gli stipendi** erano sfasati di un mese (-1 da maggio 2021 a dicembre 2025, +1 nel 2026), con importi arrotondati e 12 mancanti:
  allineati agli estratti conto (75 righe, data e importo al centesimo; lo stipendio arriva il 27, in passato intorno al 10 del mese).
  La vecchia app ha date giuste ma importi arrotondati all'euro e in qualche mese diversi (es. 2025-09: 1860 contro 1.805,43 in banca):
  si tengono gli importi della banca.

**Limite dichiarato.** Finance non vede tutto: solo il 22-42% delle spese registrate compare sul conto personale e circa
21.000 € l'anno di uscite (pagamenti con carta, prelievi, giri tra conti) non hanno una spesa corrispondente. La scheda lo dice
("Cosa conta in questi numeri") e non pretende di essere il flusso di cassa completo.

**Cosa c'è** (`core/backend/src/insights.js`, `routes/insights.js`, `components/InsightsCard.jsx`): in dashboard la scheda
"Come sta andando" mostra entrate, spese, saldo, risparmio, confronto con il mese prima e con la media di 12 mesi, le categorie
con la variazione e le anomalie. "Spiega con l'assistente" racconta i numeri; il testo si salva per mese e si riusa finché i
numeri non cambiano (nessun costo a ogni apertura).

## 2026-10-03 — Movimenti bancari (fase 1: conto personale)

**Cosa.** In Finance c'è la pagina **Movimenti** (solo admin): carichi l'estratto conto in PDF e il programma ne legge i movimenti,
li classifica, li abbina alle spese e alle entrate già registrate e ti mostra quelle che mancano. Il PDF **non si conserva**: si legge
e si scarta, restano i movimenti (tabelle `bank_accounts` e `bank_movements`), con gli IBAN mascherati. Il server usa `pdftotext`
(poppler-utils, aggiunto al `core/Dockerfile`).

**Come funziona** (`core/backend/src/bank-import.js`, `routes/bank.js`, `pages/MovimentiPage.jsx`):
- **Lettura** (`parseStatement`): formato "Estratto Conto Italia", un movimento per riga di importo; si ripuliscono intestazioni e piè di
  pagina (le righe ripetute su ogni pagina) e si assegna a ogni importo il testo giusto anche quando è "centrato" tra due movimenti.
  Provata su un anno vero (429 movimenti su 429 righe di importo). La data di un movimento è la **valuta** (per le carte è il giorno
  dell'acquisto), la data contabile si conserva a parte.
- **Classificazione**: stipendio, commissioni, carta (con esercente), utenza, prelievo, bonifico, **giro tra tuoi conti** (bonifico verso
  l'intestatario, cointestato o "Conto Casa"; **ricarica della prepagata**). I giri non sono spese né entrate. Un bonifico a una persona
  con lo stesso cognome ma nome diverso non è un giro.
- **Doppioni**: caricare di nuovo lo stesso estratto, o uno che si sovrappone, non duplica niente; due movimenti identici nello stesso
  giorno (due caffè uguali) restano due.
- **Abbinamento**: un'uscita si abbina a una spesa di Finance con lo **stesso importo** e una data entro 75 giorni (stipendi alle entrate,
  versamenti alla casa ai *Contributo Casa*); una riga di Finance si abbina a un solo movimento.
- **"Da registrare"**: uscite (carta, utenze, bonifici, altro) senza spesa corrispondente. **Registra** crea una spesa personale già
  pagata con la categoria suggerita da parole chiave (si può cambiare); **Ignora** la toglie dall'elenco.
- La scheda "Come sta andando" mostra, per il mese, entrate e uscite reali in banca e quanto non è registrato in Finance.

**Cosa si è visto sui dati veri.** Nel 2025 sul conto personale sono passati circa 14.600 € di **ricariche della prepagata**: la spesa
vera di quel denaro si vedrà solo con l'estratto della prepagata. Fino a quel momento le uscite del conto personale sono sottostimate
rispetto alle spese reali.

**Non ancora fatto** (nell'ordine): estratti della **Prepagata** e del **Conto Casa** come conti a sé; categorie proposte da Mistral per
i pagamenti con carta (oggi parole chiave); un elenco modificabile dei giri verso conti propri (es. Buddy Bank: da confermare se è un
conto di risparmio).

## 2026-10-03 — Funzioni facoltative per tenant (la modularità torna)

**Problema.** Nel corso del lavoro sull'AI avevo messo nel nucleo circa 1.700 righe che conoscono Finance (movimenti bancari, analisi,
smistamento bollette, riepilogo del mattino), presenti in **ogni** tenant: Timbrature vedeva "Movimenti" e il riquadro delle bollette.
L'affermazione di `ARCHITETTURA.md` "non c'è codice specifico per un tenant" non era più vera.

**Scelta.** Quattro **funzioni facoltative** attivabili per tenant (`movimenti`, `analisi`, `bollette_ai`, `riepilogo_mattino`), spente di default.
Spente: niente voce di menu, niente riquadro, rotte 403, lo smistamento e il riepilogo non partono. Un tenant che usa già la finanza le trova
accese al primo avvio: Finance non cambia. Si gestiscono da Impostazioni → Funzioni. Provato con un tenant senza moduli di finanza.

**Cosa NON risolve.** Il codice resta nel nucleo e conosce i nomi dei moduli di Finance. È il primo tempo; il secondo è l'**AI nei moduli**:

**Aggiornamento (stesso giorno).** Le funzioni sono diventate **capacità installabili dalla Libreria** (non un interruttore nelle Impostazioni: «installare» è il gesto
del progetto che si costruisce da zero) e sono sette: a quelle di finanza si sono aggiunte WhatsApp, mail Gmail e Sito Web, che prima erano sempre presenti. Un progetto nuovo
non ne ha nessuna. **Export dati** è tornato in Impostazioni, non più una voce di menu. Le schede delle Impostazioni mostrano solo ciò che è installato.

### AI nei moduli (progettazione, non ancora costruito)

L'idea (di Nima): abilitare l'AI su un tenant lo fa "evolvere" offrendo versioni potenziate dei moduli; la chiave si inserisce nel tenant
(già così: cifrata in Super Admin, tetto per tenant). Un modulo **dichiara** nel suo schema cosa sa fare con l'AI, con blocchi nuovi come
quelli esistenti per campi, workflow e automazioni:
- `ai_triage`: "quando una riga arriva da smistare, proponi categoria, importo, scadenza"; dichiara il campo categoria e dove prende il testo
  (email, allegati). Oggi è `ai-suggestions.js` con `spese_casa` e `spese_personali` scritti dentro.
- `ai_explain`: "racconta questi totali"; oggi il commento ai report (già generico) e "Come sta andando".
- `ai_import`: "leggi un estratto o un documento e proponi righe"; oggi `bank-import.js`.
Nel nucleo restano pochi motori generici (smistare, spiegare, importare) e la parte di sicurezza (pulizia dei dati personali, tetto di spesa,
controllo dei numeri), che sta già in Super Admin. Le versioni potenziate si pubblicano in Libreria come versione 2 del modulo; il tenant
vede "disponibile v2 con AI" e aggiorna quando vuole (l'aggiornamento è già esplicito). Il Builder all'inizio mostra i blocchi in sola lettura.
**Ordine:** `ai_triage` per primo (la prova più piccola), poi `ai_explain`, infine `ai_import`. Si parte quando nasce un secondo progetto che usa l'AI.

## 2026-10-03 — Vista "Da inizio anno"

La scheda "Come sta andando" ha ora due viste: **Mese** e **Da inizio anno** (`insights.js` → `buildYearSnapshot`, `components/InsightsYear.jsx`).
Da gennaio all'ultimo mese concluso (un anno passato fino a dicembre), con le stesse regole del mese: stipendi, accantonato (registrato o stimato,
dichiarato), quota alla casa, righe "da smistare" e senza data certa fuori. Mostra entrate, spese, saldo, risparmio vero, **come si dividono le spese**
(rate = righe collegate a un debito o categoria Rata; fisse; variabili) con la quota già "impegnata", il confronto con **lo stesso periodo dell'anno
prima** e le categorie con la variazione. "Spiega con l'assistente" racconta l'anno (istruzioni sue in Super Admin, cifre controllate; il testo si salva
per anno, chiave `anno-AAAA`). Sostituisce nell'uso i riquadri sparsi del modulo Spese Personali ("Risparmio anno corrente", "Fondo cumulativo", "Indice
di salute"), che restano nello schema ma contano diversamente (non includono l'accantonato in busta).

### Da fare (nell'ordine deciso)

1. **Movimenti bancari**, passi successivi (la lettura del conto personale c'è, vedi sopra): Prepagata e Conto Casa come conti a sé,
   categorie proposte da Mistral per i pagamenti con carta (accetti o ignori; IBAN e nomi tolti prima dell'invio).
2. **Previsione di cassa** (30/60/90 giorni) e **debiti e rate**: richiedono saldi dei conti aggiornati (oggi tutti a 0).
3. **Pulizia delle categorie** (doppioni come *Benzina* e *Auto & Benzina*) e **budget** per categoria.
4. **Domande libere** ("quanto ho speso di luce nel 2025?") tradotte in un filtro strutturato, mai SQL libero; poi gli allegati PDF.
5. Backup su un dispositivo diverso dal NAS.

## 2026-10-03 — Ruoli dei moduli e base per l'AI

- **Nessuna funzione conosce nomi di moduli o di campi.** Ogni modulo dichiara nel Builder (Proprietà → "Ruoli del modulo") se è una spesa o un'entrata, a cosa serve (riepiloghi, avvisi, mail) e quali suoi campi sono importo, data, scadenza, categoria, descrizione, stato, gruppo, fisso. Tabella `module_roles`, rotte `/api/module-roles`, codice `module-roles.js`. Per Finance i valori di partenza sono i nomi di prima (nessun cambiamento visibile).
- **Chi legge i ruoli:** "Come sta andando" (moduli e campi di entrate/spese), riepilogo del mattino (moduli "avvisi"), regole Gmail (modulo di destinazione scelto sulla regola, colonna `gmail_rules.modulo`; le regole vecchie sono agganciate al modulo che usavano).
- **Impostazioni salvate a mano non congelano i ruoli:** `insights_config` salva solo ciò che è stato cambiato, il resto segue i ruoli.
- **AI per modulo, non globale.** Ogni modulo accende da solo i potenziamenti (smistare, spiegare, importare) dal Builder (Proprietà → "Potenziamenti AI"). Tabella `module_ai`, rotte `/api/module-ai`, codice `module-ai.js`, unico punto che dice se un potenziamento è attivo (`can(slug, key)`: acceso + ruoli richiesti dichiarati). Un widget è "spiegabile" solo se lo dice la sua configurazione (`config.explainable`). Per ora si salvano solo gli interruttori: nessun potenziamento è ancora collegato.
- **Finance senza AI** (decisione dello stesso giorno): via la sezione Capacità dalla Libreria, via la scheda "Assistente AI", via i pulsanti "spiega"; la capacità `bollette_ai` è spenta su Finance. Le bollette restano in "da smistare" con avviso WhatsApp (`smistare-notify.js`).

## 2026-10-03 — Dal modulo all'avviso, al widget: la modularità completata

Seguito del registro precedente, nell'ordine in cui è stato fatto. Tutto è online su Finance.

- **Avvisi per modulo.** Il modulo dichiara quale valore dello stato è "nuovo" (da smistare) e quale "da fare" (da pagare), se avvisare per le righe nuove e se
  mettere le scadenze nel riepilogo del mattino, come chiama le sue righe ("bolletta/bollette") e il tag dei destinatari. Il riepilogo e l'avviso (`avvisi.js`) non
  hanno più parole o stati scritti nel codice. Il testo è neutro rispetto al genere ("Bolletta da smistare", "Ordine nuovo").
- **Criteri dei riepiloghi nel modulo di entrate** (categorie escluse, gruppi esclusi, stipendio, risparmio, campo accantonamento): non più dentro `insights.js`.
  Un modulo di entrate nuovo non eredita niente di Finance.
- **Via i nomi di Finance dai valori di riserva** (riepilogo, insights, Gmail, capacità, frontend). Restano solo la migrazione `FINANCE` in `module-roles.js` e i
  Movimenti bancari, che **non si rendono modulari perché non servono** (spenti su Finance). La migrazione scrive i valori una volta sola: chi ha spento tutto apposta non li ritrova.
- **Regola Gmail con tipo** (*bolletta* o *semplice*) e modulo di destinazione; la riga usa campi e stato dichiarati dal modulo.
- **Coda "Da smistare" in dashboard** con pulsante **Smista**: apre un pannello con tre scelte (un pagamento, in rate, già pagata) invece del clic cieco di prima; l'utente aveva chiesto di capire dove va la riga e come dividere il pagamento. Le rate usano il piano del modulo dei debiti (la sua automazione genera le righe), dichiarato dal modulo come "piano a rate". **L'AI non c'entra**: non legge e non smista. Se un modulo ha "Smistare"
  acceso, l'AI propone solo nell'elenco del modulo, e "Accetta" non cambia lo stato.
- **"Come sta andando" per vista**: un widget per Personale e uno per Casa. La vista (moduli, gruppi, accantonamento, **solo spese**) è nella configurazione del widget e la legge
  il server. Casa è di sole spese: i contributi alla casa non servono come entrate, "in Spese casa io vedo le cose".
- **AI per modulo e per widget**: "Smistare" e "Spiegare" collegati; "Importare" no. "Spiegare" sui widget si accende dal widget (`explainable`), sui report dal modulo.
  Su Finance: "Smistare" spento, "Spiegare" acceso sui due "Come sta andando". Stile dei commenti riscritto (dai del tu, frasi brevi, niente giudizio bene/male per le sole spese).
- **Registro degli invii WhatsApp** (`whatsapp_log`): ogni messaggio con l'esito vero per destinatario. Messaggio di prova: inviato.
- **Impostazioni riordinate**: regole Gmail dentro Google, destinatari e invii dentro WhatsApp, **Dati** (Export CSV, backup `.db`, export/ripristino JSON) come unica voce con tre schede uniformi,
  "Il mio account" con profilo, password e 2FA. Tolta la scheda Assistente AI e la sezione Capacità dalla Libreria.
- **Timbrature**: il modulo `timbrature` è dentro Finance (non un progetto a parte, quello eliminato non esiste più). Aggiornato da uno zip Firestore (1.161 righe, 111 nuove, chiave data+entrata+uscita, date corrette di +2 ore).
  Resta una riga a cavallo della mezzanotte (09/06/2023, 07:00–00:00) con durata calcolata negativa: la formula fa uscita meno entrata. Nel modulo c'è una bozza più vecchia della versione pubblicata: non va pubblicata.
- **Accesso di Federica**: scelta moduli per utente (Utenti & Ruoli → "Moduli accessibili": Timbrature e Spese casa). Nasconde dal menu ma non blocca l'API; se non si spunta nulla l'utente vede tutto.
  I widget della dashboard sono tutti solo admin.

- **Widget generici e facili da usare**: l'elenco dei tipi è in gruppi con una riga di spiegazione, e i widget di finanza compaiono solo nei progetti che hanno spese o entrate ("deve essere generico e facile da usare"). Riepilogo mensile e Come sta andando restano widget di finanza, non resi configurabili fino a perdere il vocabolario.

- **Due buchi degli avvisi chiusi**: (1) l'avviso sulle righe nuove non dipende più da come nascono ma da un controllo unico ogni minuto (`avvisi.js`), che copre anche automazioni e importazioni; (2) le mail che sembrano bollette ma da mittenti senza regola si mettono in lista e si segnalano con un messaggio (`gmail-unknown.js`), invece di perdersi in silenzio.

- **"Power up" dell'AI**: Impostazioni → AI con interruttore generale (spento di default; su Finance l'AI è stata lasciata spenta perché Nima la accenda e veda l'effetto), «Accendi e potenzia», chiave
  e spesa del mese. Con l'AI accesa: **Smista già compilato** dalla bolletta, **Spiega** acceso di default sui widget, **Importa da PDF**, **Chiedi ai dati** (query strutturata validata due volte, mai SQL) e **monitoraggio**
  mensile su WhatsApp (acceso sui due widget di Finance: primo messaggio il 2 novembre alle 9). Ogni potenziamento usa i ruoli dichiarati dai moduli, senza nomi di Finance nel codice.

- **Via i moduli di supporto** (richiesta di Nima: «non deve esistere modulo di supporto, ma solo moduli che tra di loro possono parlarsi»). Tolto il concetto da Builder (casella nel wizard e nelle proprietà, elenco "Supporto"),
  menu, Store, Impostazioni, Guida e Utenti; la colonna è azzerata da un trigger. Su Finance, con copia dei dati prima (`finance-2026-10-04-prima-semplificazione-moduli.db` e `.json`, 2.076 righe): ritirati
  **Pagamenti** (102 righe, calendari delle rate del vecchio sistema, in parte in contraddizione con le rate vere), **Ricorrenti casa** e **Ricorrenti personali** (0 righe) — disinstallati, le righe restano e si riattivano;
  **Debiti casa e personali** e **Conti** (usato da 560 spese su 644 e dal Riepilogo mensile, era solo nascosto) sono ora moduli normali nel menu. Il menu di Finance ha 8 moduli più la dashboard.
- **Idea per dopo**: un solo modulo "Spese" con un campo "Ambito" (Casa/Personale) al posto di due copie, e un solo "Debiti". Richiede prima nel Builder la **visibilità per valore di campo** nei permessi (un ruolo vede solo le righe
  con Ambito = Casa, anche via API), che è anche ciò che serve per un'app più universale.

### Stato alla fine della sessione (2026-10-04)

Tutto è online su Finance e committato. **Finance ora va testato a mano** con `docs/TEST-FINANCE.md`. Nima crea gli utenti (Federica: Timbrature e Spese casa) e attiva il 2FA (vedi `docs/OPERAZIONI.md`).

### Ancora aperto (non bloccante)

- **Da provare dal vivo** (coperti dai test con servizi simulati, mai visti con dati veri): avviso WhatsApp su una bolletta vera, "Smista" in rate, "Importa da PDF", "Chiedi ai dati", proposte dell'AI con la fonte, mail non riconosciute.
- **"Spiegare"** sugli altri widget (Riepilogo mensile, Checklist): non collegato.
- **Pulizia del 04/10/2026**: corretta la scadenza A2A (30/04/2028 → 08/09/2026, dal PDF; copia del database prima). I presunti doppioni **non sono doppioni**: sono pagamenti con data incerta (import del 4/8), e restano.
- **Dati di Finance** da pulire (elenco in `docs/TEST-FINANCE.md`): righe "da smistare" vecchie o a 0 €, settembre ancora "da pagare" (affitto, Spese Casa, rata PayPal), affitto registrato in un solo mese su sei,
  righe scadute, Quarta Cartella marzo–maggio. Il riepilogo delle 8:00 e il messaggio mensile del 2 novembre sono rumorosi finché non si puliscono.
- **Timbrature**: la formula della durata non gestisce i turni a cavallo della mezzanotte (esempio: 09/06/2023, 07:00–00:00).
- **Sicurezza, a carico di Nima**: app Google in produzione (altrimenti il collegamento può scadere dopo circa 7 giorni e Gmail si ferma), password del NAS, 2FA del Super Admin e degli utenti.
- **Movimenti bancari**: non modulari, spenti, non servono.
- Un timeout verso Redis è comparso una volta all'avvio di un container e non si è ripresentato (rete e Redis a posto): niente da cambiare, ma va ricordato se torna.

## 2026-10-04 — Primitive tolte perché non usate
Il Builder resta completo (quello di Super Admin serve per gli altri tenant), ma si sono tolte le primitive che nessun modulo installato usava.
- Blocchi: financial_statement, distance_buckets, reconciliation, document_template, form_step (e Wizard/PrintModal).
- Azioni automazione: applica_prezzo_listino, aggiorna_figli, aggiorna_figli_via_router, libera_altri_con_stesso_valore, trova_o_crea_e_aggiorna, aggrega_in_record, crea_record_da_padre, storna_riferimento, registra_provvigione.
- Restano: crea_record, crea_record_n_volte, notifica_interna, invia_notifica, invia_report_periodico, aggiorna_record.
- Un blocco sconosciuto nei vecchi schemi viene ignorato (lenient), non rompe il modulo.

## 2026-10-10 — Proprietario delle righe automatiche e "Sposta in…"
- **Problema**: Spese Personali ha la regola "ognuno vede solo le proprie righe". Le righe che arrivano da Gmail, dall'estratto conto o dalle automazioni nascevano senza proprietario (e le 427 esistenti erano dell'admin): un utente normale non le vedeva, e Checklist/Riepilogo mostravano solo Casa.
- **Scelta**: la regola resta (se un giorno Federica ha le Personali vede solo le sue). Le righe automatiche prendono un proprietario: quello della riga che le genera (le rate sono di chi ha creato il piano), altrimenti il "proprietario predefinito" scelto in Utenti (`tenant_settings.default_owner_user_id`, `core/backend/src/record-owner.js`). Le righe esistenti si riassegnano con un'azione esplicita dell'admin (Utenti → "Proprietario delle righe automatiche", con anteprima del numero), che cambia solo `records.user_id`.
- **Sposta in…** (Smista): una riga "da smistare" può cambiare modulo di spesa (Casa ↔ Personale). Destinazioni = moduli con lo stesso `kind` e gli avvisi dichiarati. I campi si abbinano per ruolo, gli altri solo con stessa chiave e tipo; ciò che non passa viene mostrato prima e scritto nella cronologia. Stesso id, stessi allegati; se la riga non aveva proprietario diventa di chi la sposta.
- Test: `core/backend/src/sposta-proprietario.test.js`.

## 2026-10-10 — Vista ad archivio (Documenti)
- Nuovo modo di vedere l'elenco di un modulo, accanto a Tabella e Card: **Archivio** (Builder → modulo → "Come si vede l'elenco"). Nessuna pagina su misura: vale per qualunque modulo con un campo «scelta» e un campo «file».
- **Come un archivio (rifatto lo stesso giorno su richiesta)**: la radice mostra solo le cartelle (i valori del primo campo select, anche vuote, sbiadite), si entra per vedere i file, con le briciole «Archivio › cartella › anno». Una cartella con almeno 8 file e almeno 2 anni diversi si divide da sola in **sottocartelle per anno**; l'anno si legge dal titolo (es. `ClientStatements_20190830…`, `CU-2021…`) o, se manca, dalla data del record. Con una ricerca attiva si vede l'elenco piatto di tutto l'archivio.
- File = primo campo file; titolo = primo campo di testo; data = primo campo data. Schede con icona per tipo (miniatura per le immagini), elenco alternativo, anteprima a schermo intero (immagini e PDF con il visualizzatore del browser; gli altri tipi si scaricano). Spostare un file di cartella = cambiare quel solo campo (trascinando su PC, dal menu "Cartella" nell'anteprima).
- Non fatto: miniatura della prima pagina dei PDF (servirebbe pdf.js, peso notevole): le schede PDF mostrano l'icona.
- Codice: `core/frontend/src/pages/ModulePage/ArchiveView.jsx`; `list_view = 'archive'` accettato da `routes/modules.js`.
- **Cartelle modificabili** (stesso giorno): nell'archivio la matita rinomina una cartella, il cestino toglie quelle vuote, «Nuova cartella» ne aggiunge. Una cartella è un valore del campo «scelta», quindi `POST /api/field-options/:modulo/:campo` (`routes/field-options.js`, test `field-options.test.js`) cambia lo schema pubblicato (con una riga di cronologia) e tutte le righe che lo usano, in una transazione. Rifiuta nomi doppi (anche con maiuscole diverse), vuoti, oltre 60 caratteri; rifiuta di rinominare se il vecchio nome è citato in una regola del modulo (condizioni, automazioni) e di togliere una cartella non vuota. Possono usarlo gli utenti con permesso di modifica sul modulo, non solo l'admin.
- Corretto un errore: il parametro `searching` dell'archivio (ricerca = elenco piatto) era stato collegato al componente sbagliato in `ModulePage/index.jsx`.
- **Modulo «Nuovo» più semplice** (stesso giorno): i collegamenti facoltativi a altri moduli (per Documenti: spesa casa/personale, debito casa/personale) stanno chiusi in fondo sotto «Collegamenti (facoltativo)»; i campi obbligatori vengono prima. Nei moduli con vista ad archivio il **file è il primo campo**, il titolo si compila da solo dal nome del file (se vuoto) e il nuovo documento parte dalla **cartella aperta** (campo «Tipo» già scelto). Regola generica in `ModulePage/index.jsx`, nessun nome di modulo.

## 2026-10-10 — Chiusura 0.1.1
- La versione è unica per tutta la piattaforma e si cambia a mano a ogni chiusura di fase (sidebar, `/health`, `package.json`, `package-lock.json`, README). Le note di ogni versione stanno in [`NOTE-DI-RILASCIO.md`](NOTE-DI-RILASCIO.md): cosa c'è, cosa è **da verificare dal vivo** e cosa sapere.
- Chiusa con tre cose dichiaratamente non provate in produzione (Gmail dopo il ricollegamento di Google, invio vero del backup via mail, archivio con i file veri su Drive): sono segnate nelle note e in `TEST-FINANCE.md` (6b, 6c), non nascoste.
- Il deploy dei tenant con il 2FA attivo non si fa da script: l'immagine si costruisce da `redeploy-nas.sh` e il tenant si aggiorna dal pulsante **Aggiorna** in Super Admin.

## 2026-10-11 — Report su WhatsApp: tre messaggi, tutti guardano lo stato di pagamento
- **Problema** (segnalato da Nima): i report arrivavano ma contavano **tutte** le spese per data senza verificare se erano pagate (il settimanale diceva «−100% vs precedente»; il riepilogo del mattino ripeteva ogni giorno le stesse voci), e il mattino alle 08:00 non aveva senso.
- **Scelta**: tre messaggi, ognuno con una sola domanda, che non partono se non c'è niente da dire: **da pagare** (ogni 27, venerdì prima se è weekend; dal 27 al 26 del mese dopo + scadute + «ultimo stipendio → ti restano»), **da smistare** (ogni sera, finché la coda non è vuota), **scadute** (lunedì sera). Tutti leggono lo **stato** dichiarato dai moduli, mai la sola data. Il riepilogo del mattino (`daily-digest.js`) è stato **tolto**, non convertito; la chiave tecnica `riepilogo_mattino` resta (è salvata nei tenant) ma accende i nuovi report.
- **Limite dichiarato**: il report si fida di ciò che è segnato «pagato»; se paghi e non spunti, continua a dire «da pagare». La verifica automatica con la banca (movimenti) non c'è: `bank-import.js` è spento su Finance e non modulare. Il promemoria «scadute» lo rende visibile ogni lunedì.
- Le automazioni vecchie dentro Spese Casa/Personali (report settimanale e mensile, «scadenza oggi» delle 08:00) restano nello schema finché l'admin non preme «Toglili dai moduli» nella scheda Report: rimozione esplicita, con cronologia, non un silenzio nascosto. Nel frattempo gli avvisi «scadenza» per riga restano muti, il report periodico no.
- Test: `reports.test.js` (21), `reports-legacy.test.js` (5).
- **Formato compatto** (stesso giorno, dopo aver visto i primi messaggi veri): troppo lunghi. Ora le scadute stanno in una riga nel messaggio del 27 (l'elenco è nel loro messaggio), «in arrivo» mostra al massimo 8 voci, importi senza centesimi inutili. Limite di CallMeBot: in fondo a ogni messaggio aggiunge «I need your support» (non si toglie). **Secondo destinatario**: oggi il sistema usa **una sola chiave CallMeBot** per tutti, ma la chiave è legata al numero di chi l'ha attivata, quindi a un secondo numero il messaggio non arriva; serviranno una chiave per persona e un filtro per modulo (Federica deve ricevere solo Casa). **Telegram o un bot** (formattazione vera, bottoni «Pagata», un solo bot per più persone, nessuna pubblicità) è stato proposto e **rimandato**: prima si guardano i report per un paio di settimane.

## 2026-10-11 — Bot Telegram: canale a doppio senso, a gradini e senza scritture libere
- **Perché Telegram e non WhatsApp**: CallMeBot spedisce soltanto, con una chiave per numero e una riga pubblicitaria in fondo; un bot vero su WhatsApp (Business Platform) vuole numero dedicato, account Meta, modelli approvati e costo a messaggio. Telegram è gratuito, ha bottoni e formattazione, e un solo bot serve più persone.
- **Cosa fa (gradino 1)**: i report arrivano anche su Telegram, ognuno nella **versione dell'utente**, con «✅ Pagata» e «Apri l'app»; comandi fissi in sola lettura. **Cosa non fa**: nessuna domanda libera all'AI (gradino 2), nessun comando che scrive oltre al bottone (gradino 4), nessuna foto di bollette (gradino 3).
- **Confini di sicurezza** (il bot non ha il 2FA): chat collegata a UN utente con codice monouso da loggato; ogni controllo dell'app riusato, non copiato (`runTransition` estratta da `routes/records.js`, `visibleSlugsFor` da `routes/modules.js`, `filterViewable`); webhook con segreto; token cifrato; solo chat private; 20 messaggi al minuto; ogni azione nel registro; il bottone è l'unico modo di scrivere. Prova «al contrario» fatta: togliendo il filtro per utente 3 test falliscono.
- **Rimandato**: seconda persona su WhatsApp (richiederebbe una chiave CallMeBot per numero): con Telegram il problema non esiste.
- Test: `telegram.test.js` (23, con Telegram simulato).

## 2026-10-11 — Bot «full powered»: frasi libere e azioni, sempre con conferma
- **Richiesta**: un bot che faccia (quasi) tutto ciò che si fa nell'app. **Scelta**: sì, ma l'AI **propone e non esegue**. Una frase diventa UNA azione di un elenco chiuso (`domanda`, `elenco`, `segna_pagata`, `riapri`, `smista`, `nuova_spesa`, `altro`), la riga la trova il tenant, ogni scrittura è una **proposta con bottone di conferma** (15 minuti, una volta sola, solo per chi l'ha originata), e l'esecuzione passa dall'**API dell'app come quell'utente** invece di una seconda copia della logica.
- **Perché così**: il bot non ha il 2FA e parla con un modello: i due rischi sono «un telefono sbloccato» e «un modello che si sbaglia o viene manipolato». Il primo si limita con poche azioni e una conferma; il secondo con un elenco chiuso, doppia validazione (`shared/ai-bot-intent.js`), nessun record né id verso il modello, e nessun testo del modello che arrivi all'utente come descrizione dell'azione (la descrizione viene dai dati validati).
- **Esclusi di proposito**: eliminare, modificare campi liberi, utenti, impostazioni, backup. **Rimandato**: leggere foto di scontrini (servirebbe un OCR/visione nel gateway AI; per ora solo PDF), conversazioni con memoria.
- **Prove «al contrario»**: togliendo il controllo di proprietà della proposta, o il filtro per utente nella ricerca delle voci, due test falliscono.
- Test: `telegram-bot.test.js` (22), `ai-bot.test.js` in Super Admin (11).

## 2026-10-11 — Segreti cifrati a riposo e librerie aggiornate
- **Problema** (domanda di Nima sulla sicurezza): nel database di Finance erano **in chiaro** i token e il segreto di Google (accesso a Gmail e Drive), la chiave di CallMeBot, il segreto del webhook Telegram e i **segreti del 2FA**; vale anche per i segreti 2FA di Super Admin. Chi avesse un file del database o un backup li leggeva.
- **Scelta**: cifrarli con la chiave del progetto, tutto in un modulo (`secrets-at-rest.js`), con lettura retrocompatibile e migrazione all'avvio verificata. Prova «al contrario» fatta dai test: un valore manomesso o con chiave sbagliata diventa «assente», non un testo di errore.
- **Trovato lungo la strada**: l'admin di Finance risultava **senza 2FA** (segreto avviato e mai confermato); e `/2fa/setup` poteva **sostituire il segreto di un utente con il 2FA già attivo** chiudendolo fuori: ora risponde 409 se il 2FA è già attivo.
- **Librerie**: `npm audit fix` in Finance (era 1 critico e 3 moderati → 0) e in Super Admin; nodemailer 6 → 10 (API verificata con un trasporto di prova); nel provisioner (ha `docker.sock`) 1 critico e 1 alto corretti con `dockerode` 4.0.12. Restano 2 moderati su `uuid` (non raggiungibile da noi) che `npm audit fix` può chiudere solo riportando indietro `dockerode`: lasciati, annotato in ARCHITETTURA.
- **Non fatto, di proposito**: cifrare le chiavi dei tenant nel registro di Super Admin (servono al ripristino; una chiave sullo stesso server non protegge da chi ha il server). **Da fare dal proprietario**: ruotare le password vecchie, ruotare i segreti già usciti in backup in chiaro (vedi OPERAZIONI), rilasciare il provisioner.
- Test: `secrets-at-rest.test.js` in Finance (9) e in Super Admin (2).

## 2026-10-11 — Foto di scontrini al bot
- **Richiesta**: mandare la foto di uno scontrino e avere la spesa registrata. **Scelta**: lettura con un modello di visione di Mistral tramite Super Admin (stesso gateway, stesso tetto di spesa), risultato ridotto a pochi campi **validati due volte** (`shared/ai-receipt.js`), proposta con conferma, foto allegata, avviso di doppione. Nessuna scrittura senza il tocco; l'importo letto va **controllato dall'utente sullo scontrino** (il bot lo dice).
- **Perché la conferma è obbligatoria anche qui**: un modello di visione sbaglia più di uno che legge testo (cifre simili, scontrini sgualciti): un totale sbagliato scritto in silenzio vale più di un tocco in più.
- **Limiti dichiarati**: solo euro; foto JPEG/PNG/WebP (le HEIC vanno mandate come «foto» dal telefono, che le converte); non legge le singole voci dello scontrino (solo il totale); l'immagine arriva a Mistral e non si può oscurare; **mai provato con Mistral vero** (solo risposte simulate nei test): il primo scontrino reale dirà se il modello e la chiave in uso la leggono.
- Test: `telegram-bot.test.js` (+10), `ai-receipt.test.js` in Super Admin (8).

## 2026-10-13 — Un solo Builder
I due Builder (tenant e Super Admin) erano copie sincronizzate a mano. Ora c'è un'unica implementazione in `shared/frontend/builder/`, con alias Vite `@shared`/`@app` e una render-prop `moduleActions` per le azioni di promozione del modulo (tenant: Proponi alla Libreria; Super Admin: Salva nella Libreria). Super Admin ha l'alias Tailwind `accent`.

## 2026-10-13 — Il verticale lo costruisce l'utente del tenant
Nessun verticale «curato» da Super Admin: chi costruisce il proprio gestionale spunta più moduli nello store e li installa insieme (`POST /api/modules/registry/bulk-install`: salta i presenti, installa le dipendenze, segnala i falliti), poi crea le relazioni nel Builder. Un primo tentativo con verticali gestiti da Super Admin è stato scartato.

## 2026-10-13 — Collega i moduli e primi passi
- **Collega i moduli** (`core/backend/src/module-links.js`): relazioni proposte da regole sui nomi (nome contenuto, campo che si chiama come un altro modulo), mai verso moduli di sistema; chi applica ricalcola tutto (chiave, etichetta, campo da mostrare), non duplica, scrive storia e versione come una pubblicazione.
- **Primi passi** (`routes/setup-wizard.js`, `SetupWizard.jsx`): compare solo a un admin, se il tenant non ha nessuna riga e il percorso non è mai stato chiuso; quindi un tenant già in uso (Finance) non lo vede e uno creato dall'analisi lo chiude da solo. Lo stato dei passi si legge dai dati. Nel vecchio Platform esisteva un tour guidato con spotlight (ProductTour, sul Sito Web), non un percorso di configurazione: non è stato riportato.

## 2026-10-13 — Verticali proposti come punti di partenza
Un tenant vuoto vede in Libreria «Parti da un modello»: tessere di verticali (gruppi di moduli generici che funzionano insieme), da `super-admin/backend/src/seeds/verticali.json` (dati, non codice) risolti sui moduli che la Libreria ha davvero (`lib/verticali.js`, `GET /api/registry/public/verticals`). Si tolgono le spunte ai moduli che non servono e si installa col solito bulk-install; poi «Collega i moduli». Convive con la scelta libera di più moduli nello store. Corretto: l'installazione multipla non ricaricava il menu laterale.

## 2026-10-13 — Distacco di un tenant su un server dell'utente
Copia (non spostamento) via SSH, avviata dal tenant: `ssh2` in Super Admin, token firmato col segreto del tenant, impronta del server confermata e fissata, credenziali solo in memoria, destinazioni interne vietate. Il tenant copiato non ha più Super Admin (AI, Libreria e aggiornamenti non disponibili finché non esisterà una chiave AI propria del tenant). Super Admin non vede dati: copia un file di database che già custodisce nei backup.
