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
          'Il pulsante "Apri →" nella scheda di un tenant apre quel tenant con una sessione admin reale, senza dover conoscere la password — utile per verificare un problema segnalato da un cliente. Ogni chiamata di questo tipo resta comunque nella cronologia Attività.',
          'Il reset credenziali genera nuove credenziali admin per un tenant che le ha perse o compromesse. Il dominio pubblico di un tenant (es. `nome.platform-core.it`) è modificabile dalla stessa scheda.',
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
