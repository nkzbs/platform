// Guida di Super Admin — copre solo funzionalità REALMENTE costruite ad oggi,
// nessuna promessa di roadmap. Distinta dalla Guida di core/frontend (quella spiega
// Platform Core a chi usa un tenant; questa spiega il pannello con cui si
// amministrano tutti i tenant insieme — pubblico e contenuto diversi, non un
// duplicato). Se qualcosa qui dentro smette di essere vero perché il codice
// cambia, questo testo va aggiornato insieme, stesso principio del gemello.
const GUIDA_SECTIONS = [
  {
    title: 'Tenant', icon: 'grid', color: '#2563EB',
    topics: [
      {
        title: 'Creare un tenant', body: [
          'Un tenant è un\'installazione indipendente di Platform Core (il proprio database SQLite, il proprio container Docker) — un cliente, un\'attività. Creane uno da "Tenant" → "Nuovo tenant": puoi partire da zero oppure clonare un template esistente (Retail, Servizi & Consulenza, Associazione), che copia i moduli reali di quel verticale nel nuovo tenant.',
          'La creazione avvia un container reale con la sua porta e il suo dominio — non è un record simulato: se qualcosa va storto nella creazione (porta occupata, immagine mancante) lo vedi come errore reale, non come uno stato "in sospeso".',
        ]
      },
      {
        title: 'Avviare, fermare, eliminare', body: [
          'Un tenant fermato non risponde più alle richieste ma i suoi dati restano intatti — utile per sospendere temporaneamente un cliente senza cancellare nulla. L\'eliminazione è distruttiva: prima di procedere il sistema fa sempre un backup di sicurezza automatico, indipendente da quelli programmati.',
        ]
      },
      {
        title: 'Redeploy', body: [
          'Aggiorna il container di un tenant all\'ultima immagine `platform-core` caricata — serve dopo ogni modifica di codice che deve raggiungere i tenant reali. Il pannello "Update Manager" mostra, per ciascun tenant, un badge (verde/ambra) letto dal vivo da `docker inspect`: se sta girando davvero l\'ultima immagine o no, mai da uno stato salvato che potrebbe mentire.',
          'Prima di un redeploy conviene controllare le sessioni attive (non un poll passivo, un uso reale — vedi sotto): un redeploy interrompe chi sta lavorando in quel momento sul tenant.',
        ]
      },
      {
        title: 'Sessione attiva', body: [
          'Nella scheda di ogni tenant, il pallino verde "attivo ora" accanto al nome distingue un uso reale (qualcuno sta davvero guardando lo schermo) da un poll automatico in background (campanella notifiche, log attività) — utile per capire se è un buon momento per un redeploy senza interrompere nessuno.',
        ]
      },
      {
        title: 'Backup, export e ripristino', body: [
          'Uno stesso motore genera sia i backup programmati (frequenza configurabile per tenant) sia quello manuale sia quello di sicurezza pre-cancellazione — tre modi di attivarlo, una sola logica, mai comportamenti diversi tra loro.',
          'Ogni backup è scaricabile direttamente: il file `.db` SQLite scaricato È lo snapshot completo e portabile di quel tenant, nessun formato parallelo da mantenere allineato.',
          'Il ripristino riporta un tenant a un backup precedente — anche questo passaggio genera prima un backup di sicurezza dello stato attuale, per poter tornare indietro anche da un ripristino sbagliato.',
        ]
      },
      {
        title: 'Accesso come admin, reset credenziali, dominio', body: [
          'Il pulsante "Apri →" nella scheda di un tenant chiede le credenziali admin di quel tenant (non quelle di Super Admin) e poi lo apre: senza la password non si entra.',
          'Il reset credenziali genera nuove credenziali admin per un tenant che le ha perse o compromesse. Il dominio pubblico di un tenant (es. `nome.platform-core.it`) è modificabile dalla stessa scheda.',
        ]
      },
      {
        title: 'Invitare una persona', body: [
          'Nella scheda Credenziali di un tenant (e dopo la creazione dall\'Analisi) il pulsante «Invita» crea un link monouso: la persona sceglie da sé nome utente e password, nessuna password gira. Vale 72 ore e si usa una volta sola; si vede una volta sola.',
          'Il link si copia, si manda su WhatsApp o Telegram (si apre il messaggio già scritto, premi tu «invia») oppure parte per mail dalla posta di Super Admin, se è configurata e il tenant ha un dominio. L\'admin di un tenant invita i suoi utenti da Utenti & Ruoli, con lo stesso meccanismo.',
        ]
      },
      {
        title: 'Distacco su un server', body: [
          'Un tenant può farsi una copia su un server Linux dell\'utente, via SSH (Impostazioni → Dati del tenant). Lo avvia l\'admin del tenant; Super Admin esegue la copia (immagine, database, allegati, segreti) senza fermare né cancellare l\'originale. Il tenant copiato funziona da solo: senza Super Admin non ha AI, Libreria e aggiornamenti.',
          'Gli indirizzi privati sono vietati di partenza: per un server in rete locale si imposta `EXPORT_ALLOW_PRIVATE=1` su Super Admin. Le credenziali SSH restano in memoria per il tempo della copia.',
        ]
      },
    ]
  },
  {
    title: 'Store moduli (Registro)', icon: 'box', color: '#7C3AED',
    topics: [
      {
        title: 'Pubblicare un modulo nello Store', body: [
          'Non esiste un "carica file" — pubblicare parte sempre da un modulo che vive già, per davvero, in un tenant reale (costruito nel Builder o via Super Builder). Da "Store moduli" scegli il tenant sorgente e il modulo, e la pubblicazione ne legge lo schema reale in quel momento: da lì diventa una fotografia versionata e indipendente, sicura da distribuire anche se il tenant sorgente viene poi cancellato.',
          'Ogni pubblicazione compila descrizione, categorie (usate anche per il filtro "settore" nello Store lato tenant — Retail, Servizi & Consulenza, Associazione, Coffee, Finance, o "Generico" per moduli utili a chiunque), e una guida opzionale mostrata a chi lo installa.',
        ]
      },
      {
        title: 'Filtri, «Dove è usato» e verticali', body: [
          'La Libreria si filtra per gruppo e per «ruoli dichiarati» (i moduli che dicono a cosa servono e quindi lavorano con report, bot e riepiloghi). Nel dettaglio di un modulo la scheda «Dove è usato» elenca i tenant che lo hanno installato, con la versione e chi può aggiornare, e i moduli che si collegano a lui. Da qui non si aggiorna niente: decide ogni tenant.',
          'I verticali (sezione «Verticali» della Libreria) sono i modelli che i tenant vedono come tessere in «Parti da un modello»: un nome, un\'icona e un gruppo di moduli. Si creano, si modificano, si eliminano e si ripristinano i predefiniti da qui. Il tenant sceglie quali moduli tenere e li installa insieme.',
        ]
      },
      {
        title: 'Moduli generici vs verticali', body: [
          'Un modulo "Generico" (es. Contatti, Documenti) è utile a qualunque settore e compare sempre nella scheda "Consigliati" dello Store di ogni tenant. Un modulo con categorie di settore specifiche (es. Soci, Quote Associative per Associazione) compare come consigliato solo a chi ha impostato quel settore.',
        ]
      },
    ]
  },
  {
    title: 'Super Builder', icon: 'sparkles', color: '#F59E0B',
    topics: [
      {
        title: 'Cos\'è', body: [
          'L\'editor completo del Builder (lo stesso che gira dentro ogni tenant) integrato qui in Super Admin, senza dover aprire il tenant a parte — con in più un assistente AI opzionale per generare una prima bozza da una descrizione testuale.',
          'La parte AI richiede una chiave `ANTHROPIC_API_KEY` configurata sul backend di Super Admin — senza quella chiave, il pulsante di generazione mostra chiaramente che l\'AI non è configurata, ma tutto il resto (editor manuale, pubblicazione) funziona comunque.',
        ]
      },
      {
        title: 'Costruire un modulo da zero (senza AI)', body: [
          'Il pulsante "Nuovo modulo da zero" prepara (o riusa, se già esiste) un tenant sandbox condiviso dedicato a questi esperimenti, e apre subito l\'editor sul nuovo modulo — non serve scegliere prima un tenant esistente dal menu.',
          'Da lì è l\'editor Builder reale e completo: campi, relazioni, workflow, automazioni. Quando il modulo è pronto, si pubblica nello Store esattamente come un modulo costruito in un tenant vero.',
        ]
      },
      {
        title: 'Generare una bozza con l\'AI', body: [
          'Descrivi il modulo che vuoi (es. "gestione soci con quota annuale e scadenza") e l\'AI genera uno schema v3 di partenza — campi, relazioni, eventuali stati di workflow. La bozza generata si scrive nel tenant sandbox (o in un tenant già aperto, se ne hai scelto uno), poi si rifinisce nello stesso editor manuale.',
          'L\'AI non pubblica mai da sola: ogni bozza generata resta da rivedere e correggere prima di pubblicarla nello Store.',
        ]
      },
    ]
  },
  {
    title: 'Analisi', icon: 'git-branch', color: '#22C55E',
    topics: [
      {
        title: 'Dai processi al tenant', body: [
          'Il modo più veloce: «Fai tutto». Scrivi come funziona l\'attività e premi il pulsante: in circa un minuto l\'AI trova i processi, li completa e sceglie moduli, report e AI; poi vedi un riepilogo e crei il tenant con un tocco. I dettagli a passi restano disponibili.',
          'A passi: racconti come funziona un\'attività; l\'AI propone i processi (mai salvati da soli) e tu li rifinisci: scopo, ruoli, passaggi in ordine (anche i bivi), eccezioni, documenti, KPI. Per ogni processo scegli il modulo della Libreria che lo copre, oppure lo segni «da costruire».',
          'Dall\'analisi si apre il manuale dei processi (si stampa o si salva in PDF) e, se vuoi, si crea il tenant: installa i moduli scelti, crea i ruoli degli utenti e trasforma i passaggi negli stati del flusso. Non tocca un modulo che ha già i suoi. Fino alla conferma non si scrive niente.',
          'Un processo di solito usa più moduli: «Cosa manca?» (da solo in «Fai tutto») propone i moduli in più e segna ciò che nessun modulo copre, senza toccare le tue scelte. «Correggi a parole» traduce una frase («togli la fatturazione, aggiungi i turni») in operazioni che vedi in italiano e applichi tu.',
          'Oltre al manuale c\'è la «Guida all\'uso» del verticale (ruolo per ruolo, processo per processo, modulo per modulo, da dati e senza AI): entrambi si stampano o si salvano in PDF.',
          'Il testo che racconti passa dall\'AI con i dati personali tolti, e costa sulla chiave di Super Admin (Impostazioni → Chiavi AI). Super Admin non legge dati dai tenant: l\'analisi riguarda solo ciò che scrivi qui.',
        ]
      },
    ]
  },
  {
    title: 'Attività', icon: 'list', color: '#EF4444',
    topics: [
      {
        title: 'Un\'unica cronologia', body: [
          'Le azioni fatte da Super Admin (creazione tenant, aggiornamenti, backup...) e gli errori tecnici non gestiti dei tenant, in un solo elenco cronologico con una descrizione leggibile, filtrabile per tipo e per tenant. Per privacy qui NON compare cosa fanno gli utenti dentro un tenant: quello sta nel registro del tenant stesso.',
          'Gli errori qui mostrati non sostituiscono i messaggi già mostrati agli utenti per un\'azione fallita (quelli restano chiari a sé) — qui compare solo ciò che nessun try/catch aveva già intercettato.',
        ]
      },
    ]
  },
  {
    title: 'Utenti e sicurezza', icon: 'shield', color: '#0EA5E9',
    topics: [
      {
        title: 'Utenti di Super Admin', body: [
          'Distinti dagli utenti di ciascun tenant (quelli vivono nel `.db` del tenant, questi nel database di Super Admin) — sono le persone che amministrano la piattaforma nel suo complesso, non chi la usa per il proprio lavoro quotidiano.',
        ]
      },
      {
        title: '2FA', body: [
          'Gli utenti di Super Admin possono attivare l\'autenticazione a due fattori, da "Impostazioni" — stesso meccanismo TOTP + codici di backup già in uso lato tenant. È opzionale: nessun utente è obbligato ad attivarla, resta una scelta individuale di ciascun account.',
        ]
      },
    ]
  },
]

export { GUIDA_SECTIONS }
