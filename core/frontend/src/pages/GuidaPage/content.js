const GUIDA_SECTIONS = [
  {
    title: 'Primi passi', icon: 'home', color: '#2563EB',
    topics: [
      {
        title: 'Moduli e record', body: [
          'Un modulo è un contenitore di record, definito da uno schema che costruisci nel Builder — l\'equivalente di una tabella. Platform Core arriva con alcuni moduli di base (Spese, Contatti, Documenti, Report); ne puoi creare quanti ne servono per il tuo settore.',
          'Un record è ogni singola voce salvata dentro un modulo — un cliente dentro Contatti, una spesa dentro Spese, un ordine dentro Ordini.',
          'Non esistono app separate: ogni progetto è questa stessa piattaforma con i moduli che installi e modifichi. I «modelli» della Libreria sono solo gruppi di moduli pronti da installare insieme.',
        ]
      },
      {
        title: 'Moduli collegati', body: [
          'Non ci sono moduli nascosti: ogni modulo si vede nel menu, nella Libreria e nel Builder. I moduli si parlano con le relazioni (un campo che punta a righe di un altro modulo).',
          'Se installi dalla Libreria un modulo che ha una relazione verso un modulo che non hai, quello mancante viene installato in automatico. Con «Collega i moduli» (Libreria) il sistema propone i collegamenti che mancano tra i moduli già installati: scegli tu quali creare.',
        ]
      },
      {
        title: 'Partire da un modello', body: [
          'In Libreria, in cima, «Parti da un modello» mostra gruppi di moduli pensati per funzionare insieme (vendite, contabilità, magazzino, personale…). Apri una tessera: nella scheda «Moduli» togli la spunta a quelli che non ti servono, nella scheda «Come si usa» leggi da dove cominciare e a cosa serve ogni modulo (si stampa in PDF). Poi «Installa»: compaiono subito nel menu.',
          'Puoi anche spuntare più moduli qualsiasi dalla Libreria e installarli insieme. I «Primi passi» (la pillola in basso a destra su un progetto nuovo) e il giro guidato (Impostazioni → Il mio account) ti accompagnano la prima volta.',
        ]
      },
      {
        title: 'Invitare le persone', body: [
          'Impostazioni → Utenti & Ruoli → «Invita»: scrivi nome, ruolo ed eventuale email. Nasce un link che vale 72 ore e si usa una volta sola: chi lo apre sceglie da sé nome utente e password (almeno 10 caratteri). Il link si vede una volta sola: copialo, mandalo su WhatsApp o Telegram (si apre il messaggio già scritto, premi tu «invia») oppure fai partire la mail, se la posta è configurata.',
          'Sotto trovi gli inviti recenti: in attesa, usato, scaduto, annullato (gli aperti si possono annullare).',
        ]
      },
      {
        title: 'Funzioni facoltative e distacco', body: [
          'Impostazioni → Funzioni: gli interruttori di Suggerimenti, Report, Sito Web, WhatsApp, Gmail e altro. Spente non compaiono; spegnerle non cancella i dati.',
          'Impostazioni → Dati → «Distacca su un tuo server» copia il progetto su un server Linux tuo (con Docker) via SSH, dove funziona da solo. Prima controlla il server (sola lettura) e ti fa confermare l\'impronta; il progetto originale non viene toccato. Il distaccato non ha AI, Libreria e aggiornamenti.',
        ]
      },
      {
        title: 'Bozza e pubblicazione', body: [
          'Ogni modifica nel Builder si salva prima come bozza (pulsante "Bozza") — non è ancora visibile a chi usa il modulo.',
          'Il pulsante "Pubblica" rende effettive le modifiche: da quel momento tutti vedono la nuova versione. Prima di pubblicare, il sistema controlla che le formule del modulo siano valide e blocca la pubblicazione se trova errori.',
          'La sezione "History" mostra tutte le versioni pubblicate in passato, con la possibilità di ripristinarne una come nuova bozza da rivedere e ripubblicare.',
        ]
      },
    ]
  },
  {
    title: 'Campi', icon: 'edit', color: '#2563EB',
    topics: [
      {
        title: 'Tipi di campo disponibili', body: [
          'Testo, Numero, Valuta, Data, Data e ora, Selezione singola, Selezione multipla, Casella di spunta, Area di testo, Email, Telefono, URL, Mappa, File, Calcolato.',
          'La chiave tecnica del campo (usata dentro le formule, es. ordini.totale) si genera da sola dal nome che scrivi — puoi comunque modificarla a mano dal piccolo pulsante "modifica" sotto al campo, se ti serve un nome specifico per compatibilità con formule già scritte altrove.',
        ]
      },
      {
        title: 'Campo Mappa', body: [
          'Un indirizzo o un luogo in testo libero, con un link diretto per aprirlo in Google Maps. Non è una mappa incorporata nella pagina — è un link di ricerca, non richiede nessuna connessione o chiave API da configurare.',
        ]
      },
      {
        title: 'Campo Calcolato (computed)', body: [
          'Un campo calcolato non si compila mai a mano: il suo valore viene ricalcolato ogni volta che il record viene letto, con una formula (testo o a blocchi) che puoi scrivere direttamente nel campo.',
          'Puoi marcarlo "live": in quel caso il valore si aggiorna mentre l\'utente sta ancora compilando il form, prima ancora di salvare — utile per mostrare un\'allerta o un totale provvisorio.',
        ]
      },
    ]
  },
  {
    title: 'Relazioni', icon: 'link', color: '#7C3AED',
    topics: [
      {
        title: 'Collegare due moduli', body: [
          'Il blocco Relazione collega il modulo che stai modificando a un altro modulo esistente. "Molti a uno" è il caso più comune: molti record di questo modulo appartengono a un solo record dell\'altro (es. molti Ordini appartengono a un Cliente).',
          'Il "campo da mostrare" decide quale campo del record collegato si vede nei menu a tendina, al posto di un id numerico senza significato.',
        ]
      },
      {
        title: 'Creazione al volo', body: [
          'Su una relazione puoi attivare "Consenti creazione al volo": nel selettore compare un\'opzione "+ Nuovo..." che apre un mini-form senza uscire dalla pagina corrente.',
          'Puoi limitare quali campi compaiono in quel mini-form (il resto dell\'anagrafica si completa più avanti) e quali ruoli possono usarlo.',
        ]
      },
      {
        title: 'Righe integrate nel form', body: [
          'Su una relazione lato "molti" puoi attivare "Righe integrate nel form del modulo padre": invece di un selettore singolo, comparirà una mini-tabella editabile direttamente dentro il form del modulo collegato — utile per le righe di un ordine, non per un singolo cliente.',
        ]
      },
    ]
  },
  {
    title: 'Workflow', icon: 'git-branch', color: '#10B981',
    topics: [
      {
        title: 'Stati', body: [
          'Uno stato è una fase del ciclo di vita di un record (es. Bozza, Confermato, Spedito). Ogni modulo con workflow ha bisogno di almeno uno stato marcato come "di partenza per un nuovo record".',
        ]
      },
      {
        title: 'Transizioni', body: [
          'Una transizione collega due stati (Da → A) con un nome (il pulsante che vedrà chi compila il record) e i ruoli abilitati a farla scattare.',
          'Se non selezioni nessun ruolo, la transizione esiste nello schema ma non sarà disponibile a nessuno — il Builder te lo segnala con un avviso.',
        ]
      },
    ]
  },
  {
    title: 'Permessi', icon: 'eye', color: '#FFB84D',
    topics: [
      {
        title: 'Ruoli personalizzati', body: [
          'I ruoli non sono fissi a "Admin e Utente" — da Utenti → Ruoli puoi crearne quanti ne servono al tuo settore (es. Agente, Contabile, Magazziniere), ognuno con nome, etichetta visualizzata e colore.',
          'Admin resta sempre il ruolo con accesso pieno, non modificabile/eliminabile — tutti gli altri ruoli sono liberi di creare, rinominare o eliminare.',
        ]
      },
      {
        title: 'La matrice ruolo × azione', body: [
          'Il blocco Permessi decide, per ogni ruolo esistente, chi può Vedere, Creare, Modificare, Eliminare i record di quel modulo — e può anche nascondere del tutto il modulo dalla sidebar per un ruolo (non solo bloccare l\'azione, farlo sparire dal menu).',
          'Se non aggiungi mai questo blocco a un modulo, il comportamento resta quello di sempre: nessuna restrizione, tutti i ruoli vedono tutto.',
        ]
      },
      {
        title: '"Solo i propri"', body: [
          'Attivando questa opzione per un ruolo, ogni persona con quel ruolo vede — e può modificare/eliminare — solo i record che ha creato lei, non quelli creati da altre persone con lo stesso ruolo.',
          'Si basa su chi ha effettivamente salvato il record per primo: non serve nessun collegamento aggiuntivo da configurare.',
        ]
      },
    ]
  },
  {
    title: 'Formule e Aggregati', icon: 'cpu', color: '#F87171',
    topics: [
      {
        title: 'Funzioni disponibili', body: [
          'Aggregazioni semplici su una relazione: sum, avg, count, min, max. Condizionali stile Excel: sumif, avgif, countif, ecc. (es. sumif(ordini.totale, ordini.stato, \'==\', \'pagato\')).',
          'Funzioni su un singolo record e le sue relazioni: sum_children, avg_children, count_children, min_children, max_children — risolvono da sole la relazione giusta.',
          'Funzioni di controllo: round, if, today, diff_days, year, month, day.',
        ]
      },
      {
        title: 'Testo o a blocchi', body: [
          'Ogni formula si può scrivere come testo (il linguaggio sopra) oppure comporre passaggio per passaggio con l\'editor a blocchi — stesso risultato, due modi di arrivarci. Le due rappresentazioni non convivono mai sullo stesso campo: passare da una all\'altra svuota quella precedente.',
        ]
      },
      {
        title: 'Dove si usano', body: [
          'Il blocco "Formula / Aggregato" nel Builder calcola un valore a livello di intero modulo (es. fatturato totale). Un campo di tipo "Calcolato" calcola invece un valore per ogni singolo record.',
        ]
      },
    ]
  },
  {
    title: 'Automazioni', icon: 'zap', color: '#FBBF24',
    topics: [
      {
        title: 'Trigger e azioni', body: [
          'Il blocco Automazione vive dentro il modulo a cui appartiene la logica: quando succede qualcosa (nuovo record, cambio stato, modifica di un campo specifico) esegue una lista di azioni.',
          'Ogni azione usa una Connessione già attiva (vedi sezione Connessioni) e una delle sue azioni disponibili — se nessuna connessione è attiva, il blocco te lo dice invece di lasciare una select vuota.',
        ]
      },
      {
        title: 'Se/Altrimenti', body: [
          'Puoi avvolgere un gruppo di azioni in una condizione (es. "se il totale supera 500"): un ramo si esegue se la condizione è vera, l\'altro se è falsa. Il confronto può usare un campo del modulo o un valore fisso.',
          'Puoi annidare una condizione dentro un altro ramo Se/Altrimenti, senza limite di profondità — usalo quando serve davvero: troppi livelli rendono l\'automazione difficile da leggere per chiunque, incluso te tra qualche mese.',
        ]
      },
      {
        title: 'Catalogo delle azioni', body: [
          '"Crea record in modulo" / "Crea N record (piani rateali/ricorrenti)" — genera uno o più record collegati, es. le rate di un piano di pagamento.',
          '"Aggiorna un campo di un record" — scrive un valore (fisso, calcolato, o il token speciale numero_annuale per una numerazione progressiva AAAA/NNNN) su questo record o su uno collegato.',
          '"Applica prezzo/sconto dal listino del cliente" — su una riga d\'ordine, risale al cliente e al suo listino e copia prezzo/sconto della riga corrispondente, con fallback al prezzo base del prodotto se non trova nulla.',
          '"Aggiorna un record collegato per ogni figlio" / "…instradando su un record correlato se esiste" — propaga un aggiornamento dal record corrente a tutti i record che lo referenziano.',
          '"Libera altri record con lo stesso valore" — utile per un\'assegnazione esclusiva (es. un furgone assegnato a un solo agente alla volta: assegnarlo a uno libera automaticamente chi lo aveva prima).',
          '"Trova (o crea) e aggiorna" / "Aggrega un batch in un nuovo record" — cercano un record esistente per criterio (o lo creano se manca) e vi accumulano un valore, utile per totali/aggregati periodici.',
          '"Clona record + righe in un altro modulo" — copia un record e le sue righe collegate in un modulo diverso (es. da un preventivo a un ordine).',
          '"Storna (inverti i delta di questo record)" — annulla gli effetti contabili/di stock già applicati da questo record, senza cancellarlo.',
          '"Registra provvigione agente (scaglioni)" — calcola una provvigione a scaglioni sul fatturato e la registra.',
          '"Notifica interna (campanella)" — crea una notifica visibile solo dentro l\'app, nessun servizio esterno coinvolto.',
          '"Invia notifica" e "Invia report periodico" via WhatsApp (CallMeBot) — vedi sotto "Cosa succede davvero quando scatta": queste due sono le uniche azioni che oggi mandano davvero un messaggio, se la connessione WhatsApp è configurata.',
        ]
      },
      {
        title: 'Trigger schedulato', body: [
          'Oltre a "nuovo record" e "cambio stato", un\'automazione può avere un trigger schedulato: gira da sola a un\'ora fissata, non serve che qualcuno apra o modifichi un record. Tre tipi: giornaliero (un\'ora al giorno), mensile (un giorno del mese + ora), ogni N giorni (a partire da quando l\'automazione è stata creata).',
          'In modalità "per ogni record" (per_record) scansiona tutti i record del modulo e applica le azioni a quelli che passano un filtro — usa i token speciali _oggi_ (la data di oggi) e _ore_fa:N (N ore fa, utile per un confronto tipo "creato più di 24 ore fa e ancora non gestito").',
          'Uso reale: i report settimanali/mensili via WhatsApp (trigger schedulato, SENZA per_record — gira una volta sola sull\'intero modulo) e i promemoria "se non hai smistato questa spesa entro 24 ore" (trigger schedulato CON per_record, filtro su _ore_fa).',
        ]
      },
      {
        title: 'Cosa succede davvero quando scatta', body: [
          'Il trigger e la condizione Se/Altrimenti girano SEMPRE su dati reali del record — non sono mai finti. L\'azione finale dipende dalla connessione: se collega un servizio dove le credenziali sono davvero attive (oggi: WhatsApp via CallMeBot), il messaggio parte per davvero. Per un servizio non ancora collegato con credenziali reali, l\'azione resta SIMULATA — loggata comunque, ma nessuna chiamata esce davvero.',
          'Il Log automazioni (pagina Connessioni) distingue i due casi: "chiamata_reale" per un invio davvero partito, "simulato" quando le credenziali non ci sono ancora — mai spacciato l\'uno per l\'altro.',
        ]
      },
    ]
  },
  {
    title: 'Connessioni', icon: 'plug', color: '#F59E0B',
    topics: [
      {
        title: 'Cosa sono', body: [
          'Le Connessioni sono le credenziali dei servizi esterni — valgono per tutta l\'istanza, non per singolo modulo: le colleghi una volta sola, poi qualunque automazione di qualunque modulo può usarle.',
          'Non sono tutte allo stesso punto: WhatsApp (CallMeBot) è reale — una volta inserita la chiave, "Invia notifica" e "Invia report periodico" mandano davvero un messaggio. Google (Gmail + Calendar) è reale — login OAuth vero, usato dal poller Gmail per smistare bollette e creare eventi di scadenza. Fatture in Cloud, WhatsApp Business Cloud API, Slack, Stripe, Mailchimp restano invece simulate: lo stato "connesso" si salva, ma nessuna azione verso quei servizi esce davvero — richiederebbero le credenziali app reali di ognuno.',
        ]
      },
      {
        title: 'Log automazioni', body: [
          'Nella stessa pagina trovi il registro di tutte le esecuzioni recenti, da qualunque modulo — cosa è scattato, quale trigger l\'ha causato, quale azione è stata eseguita (davvero o simulata, vedi sopra).',
        ]
      },
    ]
  },
  {
    title: 'Il Builder', icon: 'tool', color: '#7C3AED',
    topics: [
      {
        title: 'Il canvas', body: [
          'Ogni modulo è un unico elenco verticale di blocchi (Campo, Relazione, Stato/Transizione workflow, Permessi, Formula/Aggregato, Automazione, Documento di stampa) — l\'ordine sul canvas non cambia il comportamento, puoi riordinarli liberamente trascinandoli.',
        ]
      },
      {
        title: 'Il pannello a destra', body: [
          'Sempre visibile mentre modifichi un modulo: clic su un blocco per aggiungerlo in fondo, oppure trascinalo sopra un punto preciso del canvas per inserirlo lì.',
        ]
      },
      {
        title: 'Icona e nome del modulo', body: [
          'Clic sull\'icona in alto per cambiarla o cambiarne il colore. Clic sul nome per rinominarlo — lo slug tecnico (usato dalle formule e dai record già salvati) non cambia mai, solo il nome visualizzato.',
        ]
      },
    ]
  },
  {
    title: 'Stampa e documenti', icon: 'file', color: '#EC4899',
    topics: [
      {
        title: 'Cos\'è un documento di stampa', body: [
          'Un blocco "Documento di stampa" nel Builder definisce un modello HTML (nome, formato A4 o scontrino 80mm, contenuto) per generare un documento a partire da un record — una fattura, un preventivo, una nota di credito, o qualunque altro modulo dove ha senso stampare qualcosa.',
          'Un modulo può avere più documenti di stampa (es. "Fattura" e "Copia cortesia") — tutti compaiono come opzioni distinte quando apri un record che li ha.',
        ]
      },
      {
        title: 'I token disponibili', body: [
          '{{campo:X}} — il valore del campo X del record corrente. Se X è una relazione, mostra il valore del campo scelto come "display" della relazione (es. il nome del cliente, non un numero id illeggibile).',
          '{{azienda:X}} — un campo dei dati aziendali dell\'istanza (ragione_sociale, indirizzo, piva, logo_url), configurati in Impostazioni.',
          '{{oggi}} — la data odierna, formattata.',
          '{{#righe modulo="X" campo="Y"}}...{{/righe}} — ripete il contenuto tra i due tag per ogni record del modulo X il cui campo Y punta al record corrente (le righe di una fattura, i partecipanti di un evento, ecc.) — dentro il ciclo, {{campo:}} si riferisce alla riga, non più al record padre.',
        ]
      },
      {
        title: 'Dove si stampa', body: [
          'Qualunque record di un modulo con almeno un documento di stampa configurato mostra un bottone "Stampa" nel suo pannello di dettaglio — completamente generico, nessuna configurazione aggiuntiva richiesta oltre al blocco nel Builder.',
          'Il documento si apre in anteprima, pronto per la stampa del browser (o per salvarlo come PDF dalla finestra di stampa) — niente da installare, nessun servizio esterno coinvolto.',
        ]
      },
    ]
  },
  {
    title: 'Dashboard', icon: 'bar-chart', color: '#EC4899',
    topics: [
      {
        title: 'Widget', body: [
          'Due tipi: KPI (un numero aggregato da un modulo) e Tabella (gli ultimi record). Per i KPI puoi scegliere l\'aggregazione: Somma, Media, Conteggio, Minimo, Massimo.',
          'I widget sono condivisi da chiunque apra questa istanza — non sono legati al tuo browser o al tuo utente.',
        ]
      },
    ]
  },
  {
    title: 'Store', icon: 'store', color: '#2563EB',
    topics: [
      {
        title: 'Installare e creare moduli', body: [
          'Lo Store elenca i tuoi moduli e quelli disponibili dal Registro in un\'unica griglia — installati o meno. Un modulo non installato non compare in sidebar né è utilizzabile finché non lo installi. I moduli di supporto non compaiono qui (vedi sopra) — restano gestibili dal Builder.',
          'La card in cima allo Store, "Crea il tuo gestionale da zero", apre direttamente il wizard "nuovo modulo" del Builder — due passi: dati base del modulo, poi (facoltativo) collegarlo subito a un modulo già esistente con una relazione già pronta in bozza, oppure partire clonando lo schema di un modulo che hai già installato.',
        ]
      },
      {
        title: 'Registro moduli', body: [
          'Oltre a creare da zero, un modulo può arrivare già pronto dal Registro — un catalogo curato da chi gestisce la piattaforma (Super Admin), con moduli pubblicati da altri tenant o verificati. Installarne uno da lì copia lo schema così com\'è, poi resta un modulo tuo, modificabile come qualunque altro.',
        ]
      },
    ]
  },
  {
    title: 'Backup', icon: 'download', color: '#10B981',
    topics: [
      {
        title: 'Backup manuale', body: [
          'Da Backup puoi scaricare in qualunque momento una copia completa del database di questa istanza (formato .db) o un export leggibile in JSON — utile per archiviare uno stato preciso o portare i dati altrove.',
        ]
      },
      {
        title: 'Ripristino', body: [
          'Caricando un file .db precedentemente scaricato, puoi ripristinare l\'istanza a quello stato — sovrascrive i dati attuali, chiede conferma esplicita prima di procedere.',
        ]
      },
    ]
  },
  {
    title: 'Impostazioni', icon: 'settings', color: '#6B7280',
    topics: [
      {
        title: 'Dati dell\'istanza', body: [
          'Ragione sociale, indirizzo, partita IVA e logo — usati nei documenti generati (fatture, stampe) invece di lasciarli vuoti o hardcoded.',
        ]
      },
    ]
  },
  {
    title: 'Audit', icon: 'list', color: '#6B7280',
    topics: [
      {
        title: 'Log attività', body: [
          'Ogni azione amministrativa (login, creazione/modifica utente, pubblicazione modulo, ecc.) resta tracciata qui — chi, cosa, quando.',
          'Un interruttore mostra anche il log delle automazioni (le stesse esecuzioni visibili da Connessioni), utile per avere tutto in un unico posto quando serve capire "cosa è successo".',
        ]
      },
    ]
  },
  {
    title: 'Sessioni', icon: 'shield', color: '#F87171',
    topics: [
      {
        title: 'Chi è collegato ora', body: [
          'Da Super Admin (non da qui) si vede quale tenant ha un utente davvero attivo in questo momento — un bollino verde accanto al nome, aggiornato in tempo quasi reale.',
          'Da lì è anche possibile terminare da remoto la sessione di qualcuno: il token che sta usando smette di funzionare immediatamente, alla prossima richiesta gli viene chiesto di rientrare — utile se serve forzare un logout senza avere accesso al suo dispositivo.',
        ]
      },
    ]
  },
]

// ─── SCHEMI GRAFICI DELLA GUIDA ─────────────────────────────────────────────────
// SVG disegnati a mano, coerenti con la palette dell'app — non screenshot (che
// andrebbero rifatti a ogni cambio UI) e non immagini esterne da mantenere.
// Spiegano un concetto per schema, non l'intera schermata.

// ─── PERCORSO GUIDATO ────────────────────────────────────────────────────────
// A differenza di GUIDA_SECTIONS (enciclopedia consultabile per argomento), questo
// è un percorso in ORDINE DI UTILIZZO REALE: seguendolo dall'inizio alla fine si
// costruisce un tenant funzionante da zero — un modulo con almeno una relazione,
// un workflow e una formula. Non sostituisce il riferimento, lo precede.
const GUIDA_GUIDED_STEPS = [
  {
    n: 1, title: 'Crea il tuo primo modulo', color: '#2563EB',
    body: [
      'Vai su Store → "+ Nuovo modulo" (oppure sul "+" accanto a "Moduli" dentro il Builder). Il wizard ti chiede nome e, facoltativamente, se collegarlo subito a un modulo esistente con una relazione.',
      'Per iniziare, salta la relazione — la aggiungi al passo 3. Ti basta un nome, es. "Ordini".',
    ],
    example: 'Crei il modulo "Ordini", nessuna relazione per ora — la aggiungi al passo 3 collegandolo a "Clienti".',
  },
  {
    n: 2, title: 'Aggiungi i campi', color: '#2563EB',
    body: [
      'Nel Builder, sul modulo appena creato, clicca "Campo" nel pannello a destra tante volte quanti campi ti servono (es. Cliente come testo provvisorio, Totale come numero, Data come data).',
      'Il campo Totale lo trasformerai in un calcolo automatico più avanti (passo 6) — per ora va bene come numero semplice.',
    ],
    example: 'Tre campi bastano per iniziare: "Totale" (numero), "Data" (data), "Note" (testo) — il campo Cliente arriva da solo al passo 3, come relazione.',
  },
  {
    n: 3, title: 'Collega due moduli con una Relazione', color: '#7C3AED', diagram: 'relation',
    body: [
      'Crea un secondo modulo, es. "Clienti", con almeno un campo Nome. Poi torna su Ordini e aggiungi un blocco Relazione: modulo di destinazione Clienti, tipo "molti a uno" (molti ordini appartengono a un cliente).',
      'Il "campo da mostrare" decide cosa vedi nel menu a tendina — scegli il Nome del cliente, non un id senza significato.',
    ],
    example: 'Con "campo da mostrare" = Nome, il form di un nuovo ordine ti fa scegliere tra "Mario Rossi", "Bar Centrale", "Torrefazione Nord" — non tra id numerici senza senso.',
  },
  {
    n: 4, title: 'Definisci un Workflow', color: '#10B981', diagram: 'workflow',
    body: [
      'Aggiungi un blocco Stato workflow per ognuna delle fasi che vuoi tracciare (es. Bozza, Confermato, Spedito, Fatturato) — marca il primo come "di partenza".',
      'Poi aggiungi blocchi Transizione workflow per collegarli (Da → A), scegliendo quali ruoli possono farli scattare. Senza almeno una transizione, gli stati esistono ma nessuno può passare dall\'uno all\'altro.',
    ],
    example: 'Bozza → Confermato aperta a tutti i ruoli; Spedito → Fatturato riservata solo ad Admin — un Commerciale può confermare un ordine ma non fatturarlo.',
  },
  {
    n: 5, title: 'Decidi i Permessi', color: '#FFB84D',
    body: [
      'Aggiungi (facoltativo) un blocco Permessi: per ogni ruolo scegli chi vede, crea, modifica, elimina. Attiva "Solo i propri" se ogni persona deve vedere solo gli ordini che ha inserito lei.',
      'Se salti questo blocco, il modulo resta aperto a tutti — comportamento identico a prima che i Permessi esistessero.',
    ],
    example: 'Con "Solo i propri" attivo su Vedi/Modifica per il ruolo Commerciale, ogni agente vede solo gli ordini che ha creato lui — un Admin continua a vederli tutti.',
  },
  {
    n: 6, title: 'Scrivi una Formula', color: '#F87171', diagram: 'formula',
    body: [
      'Per far tornare il Totale automatico: trasforma il campo Totale in tipo "Calcolato", oppure aggiungi un blocco Formula/Aggregato separato se ti serve un numero a livello di intero modulo (es. fatturato del mese).',
      'La sintassi resta sempre modulo.campo dentro una funzione: sum(righe_ordine.importo) somma un campo di un modulo collegato — non serve scriverlo a mano riga per riga.',
    ],
    example: 'Campo Totale calcolato: sum_children(righe_ordine.importo). Aggregato separato "Margine mensile": sum(ordini.totale) - sum(spese.importo).',
  },
  {
    n: 7, title: 'Pubblica e verifica', color: '#6B7280', diagram: 'publish',
    body: [
      'Ogni modifica nel Builder resta una bozza finché non premi "Pubblica" — prima di allora nessuno la vede. Il sistema controlla che le formule siano valide e blocca la pubblicazione se trova errori.',
      'Dopo aver pubblicato, apri il modulo dalla sidebar e crea un record vero per verificare che relazione, workflow e formula si comportino come previsto.',
    ],
    example: 'Pubblichi, apri Ordini dalla sidebar, crei un ordine di prova per "Mario Rossi" — se il Totale si calcola da solo e il menu Cliente mostra i nomi giusti, ha funzionato.',
  },
  {
    n: 8, title: 'Rendilo visibile: Store e Dashboard', color: '#EC4899',
    body: [
      'Un modulo installato compare da solo in sidebar. Se invece è "di supporto" (es. righe di un ordine), resta nascosto dallo Store e dalla sidebar di proposito — resta comunque un modulo vero, modificabile.',
      'Per un colpo d\'occhio d\'insieme, aggiungi un widget KPI o Tabella dalla Dashboard, puntato su questo modulo.',
    ],
    example: 'Un widget KPI "Ordini questo mese" più un widget Tabella con gli ultimi 10 ordini, entrambi puntati sul modulo Ordini, in Dashboard.',
  },
]

export { GUIDA_SECTIONS, GUIDA_GUIDED_STEPS }
