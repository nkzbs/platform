# Note di rilascio

Una voce per ogni chiusura di fase. Il numero di versione è quello di tutta la piattaforma (sidebar di Finance e Super Admin, `/health`, `package.json`); si cambia a mano a ogni chiusura. Il perché delle scelte sta in [`DECISIONI.md`](DECISIONI.md).

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
