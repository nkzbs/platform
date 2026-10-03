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

### Tenuto, anche se "non serve oggi"

| Cosa | Perché |
|---|---|
| **Sito Web** (page builder del tenant) | È lavoro già fatto e testato che potrebbe servire; resta isolato e **spento di default** (`site_enabled = 0`). Unica eccezione alla regola sopra |
| **Super Builder / Builder** | È il pezzo di maggior valore: dove nascono i moduli |
| **Dominio pubblico automatico** (Cloudflare + nginx) | Un tenant nuovo deve essere raggiungibile subito |
| **Statistiche tra tenant** e **API interna tra Super Admin e tenant** | Base per far "interrogare" più tenant tra loro |
| **Update Manager** (stato, aggiornamento, rollback dell'immagine core) | Serve a distribuire una nuova versione del codice ai tenant |
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

### Da fare (nell'ordine deciso)

1. **Movimenti bancari**, partendo dal solo conto personale (poi Conto Casa e gli altri, uno alla volta): lettura degli estratti PDF
   (formato regolare, già verificato su 2.800 movimenti), esclusione dei giri tra i propri conti, collegamento alle spese di
   Finance, categorie proposte da Mistral per i pagamenti con carta (accetti o ignori), IBAN e nomi tolti prima dell'invio.
2. **Previsione di cassa** (30/60/90 giorni) e **debiti e rate**: richiedono saldi dei conti aggiornati (oggi tutti a 0).
3. **Pulizia delle categorie** (doppioni come *Benzina* e *Auto & Benzina*) e **budget** per categoria.
4. **Domande libere** ("quanto ho speso di luce nel 2025?") tradotte in un filtro strutturato, mai SQL libero; poi gli allegati PDF.
5. Backup su un dispositivo diverso dal NAS.
