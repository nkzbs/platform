# Progetto X — l'agente personale di Platform

*Bozza 1 · 25 novembre 2026 · da raffinare insieme. «X» è un segnaposto: il nome lo sceglie Nima (decisione 1, §11).*

Questo documento **progetta** l'agente; non lo costruisce. Dice cosa è, come è fatto, come lo si prova a tappe, cosa può andare storto e cosa va deciso. Dove una cosa non è verificata lo dice: «da verificare». Non è ancora una decisione di progetto: diventa tale solo quando le eccezioni elencate nel §9 vengono scritte in `docs/DECISIONI.md`.

---

## 1. In una pagina

**Cosa è.** X è un assistente personale sempre presente, per Nima e per la sua compagnia, che vive su un **Linode dedicato**. Si parla con lui su **Telegram** (testo, voce, foto, PDF). Conosce le aree della vita (Finance, Work, Health, Sports, Casa) leggendo i **tenant** di Platform attraverso un servizio di controllo, il **portiere**. Capisce, ricorda e si muove da solo: ogni mattina scrive il «giornale», di notte sorveglia i servizi, ti avvisa quando serve. **Per scrivere nei dati propone e aspetta la tua conferma.**

**Perché adesso.** Platform è pronta: Finance è in uso quotidiano, i report girano, esiste un server MCP, il bot parla già dentro ogni tenant. Manca la **mente** che tiene insieme tutto, con memoria e iniziativa.

**La promessa, in tre frasi.**
1. Ogni mattina sai cosa conta oggi, senza aprire nulla.
2. Dici «ho fatto il pieno, 62 euro» o mandi la foto di uno scontrino, e il dato finisce al posto giusto, con la tua conferma.
3. Se qualcosa non va, X lo vede prima di te e te lo dice.

**Cosa non è.** Non sostituisce Platform (i dati restano nei tenant). Non muove soldi. Non è un prodotto per altri. Non apre porte verso internet. Non installa «skill» di terzi.

**Da dove si parte.** Dalla tappa 1, il «Buongiorno»: un messaggio al mattino con i tuoi numeri veri, in sola lettura. È utile da sola e rischia poco.

**Cosa serve decidere subito.** Dieci decisioni nel §11. Le prime cinque bastano per iniziare: nome, fornitore del modello, chi parla con X, come arrivano gli eventi, dove vive il portiere.

---

## 2. Principi

1. **Platform resta la verità.** I dati e le regole stanno nei tenant. X non ne tiene copie: tiene riassunti e ricordi.
2. **Guinzaglio.** X propone, tu confermi. L'autonomia non si accende: si guadagna, per tipo di azione (§6.2).
3. **I documenti sono dati, non ordini.** Un PDF o una mail che dice «paga questo IBAN» non comanda niente.
4. **Tutto è reversibile.** Ogni azione lascia una ricevuta con il motivo e si può annullare.
5. **Nessuna porta aperta su X.** Ascolta Telegram e ritira da una coda: tutto in uscita.
6. **Utile dal primo giorno.** Ogni tappa funziona da sola.
7. **L'AI è uno strato.** Se si spegne, Platform funziona come oggi.
8. **Generico e configurabile**, come Platform: nel codice di X nessun nome di progetto, di modulo o di campo. Le mansioni sono file di dati (§4.9).
9. **Privato tra le persone, di partenza.** Si condivide solo con una scelta esplicita e revocabile.
10. **Regola contro l'eccesso.** Un pezzo entra solo se serve a un uso che si vive davvero; ogni tappa si ferma quando basta.

---

## 3. Punto di partenza

### 3.1 Cosa esiste già

| Esiste | Dove | A cosa serve per X |
|---|---|---|
| Finance, in uso quotidiano (0.5.69) | tenant su Linode | primo tenant da leggere |
| Timbrature e busta paga | moduli di Platform | base dell'area Work |
| Server MCP con 9 strumenti (`elenco_moduli`, `schema_modulo`, `lista_record`, `leggi_record`, `crea_record`, `modifica_record`, `chiedi_ai_dati`, `report_busta_paga`, `debito_casa`) | `mcp-server/` | punto di partenza del portiere |
| Bot Telegram dentro ogni tenant, con «Conferma» | `core/backend/src/telegram.js`, `bot-*.js` | modello dell'interazione e delle proposte |
| Motore dei report (8 tipi, anteprima, invio ora) | `core/backend/src/reports.js` | contenuto del giornale e dei riepiloghi |
| Token API per utente, con i permessi di chi li crea | Impostazioni → Il mio account | identità per persona |
| Permessi di ruolo e regola «vedo solo le mie righe» | `core/backend/src/permissions.js` | confine tra le due persone |
| Super Admin con voce «Server (Linode)» e `docker-provisioner` | `super-admin/` | creazione della macchina (da verificare) |
| Backup su tre livelli | Super Admin / NAS | la memoria di X va inclusa |
| Lettura AI di scontrini, bollette, buste paga | funzioni AI di Platform (il fornitore attuale per la Reportistica è Mistral; per il bot non è verificato) | lettura dei documenti |

### 3.2 Limiti noti che il progetto deve rispettare
- L'API di Finance ha un **limite di richieste**: stasera ha risposto «troppe richieste» (429) dopo circa 600 chiamate in poco tempo. Il portiere deve aspettare e riprovare, e tenere una cache.
- **Cloudflare blocca** i client con l'identificativo predefinito di alcuni linguaggi (errore 1010). Il portiere si presenta con un nome di client esplicito.
- L'MCP di oggi è **locale** (parte da un comando) e parla con **un solo** tenant.
- Non esiste una **coda in uscita** dei tenant: i report partono direttamente sui canali del tenant.
- La RAM del NAS è fuori discussione per un agente sempre acceso: X vive su una macchina sua.

---

## 4. Architettura

### 4.1 La mappa

```
  Tu e la tua compagnia  ──  Telegram (una stanza per area)
              │
              ▼
   ┌──────────────────────────────┐
   │  X — Linode dedicato         │   gateway di chat · memoria · orologio
   │  (nessuna porta aperta)      │   mansioni (file) · tetto di spesa · interruttore
   └──────────────┬───────────────┘
                  │ domande e proposte  ▲ eventi (ritirati dalla coda)
                  ▼                     │
   ┌──────────────────────────────┐
   │  Il portiere — un solo MCP   │   tiene i token · regole per persona e per area
   └──────────────┬───────────────┘
        ┌─────────┼─────────┬─────────┐
        ▼         ▼         ▼         ▼
     Finance     Work     Health    Sports      (ogni tenant: DB e token propri)
```

### 4.2 I componenti

| Componente | Cosa fa | Dove gira | Cosa NON fa |
|---|---|---|---|
| **X** | conversa, ragiona, ricorda, ha l'orologio, propone | Linode dedicato | non tiene i token dei tenant; non cambia le proprie mansioni; non apre porte |
| **Portiere** | unico MCP verso X; sceglie il tenant, applica le regole per persona e per area, registra ogni richiesta | processo separato da X, con segreti propri (idealmente macchina propria) | non unisce dati di tenant diversi; non conserva dati, solo configurazione e registro |
| **Coda in uscita** | ogni tenant mette gli eventi in una tabella; il portiere li consegna a X | dentro ogni tenant | non spinge verso l'esterno |
| **Tenant** | i dati, le regole e i permessi di ogni area | come oggi (Finance e zucca su Linode) | non sa che esiste X |
| **Telegram** | l'unico canale a doppio senso | servizio esterno | non è cifrato end-to-end: niente password o referti in chat |
| **WhatsApp** | solo in uscita (come oggi con CallMeBot) | servizio esterno | la ricezione non ufficiale rischia il blocco del numero: non si fa |

### 4.3 Il contratto tra i tenant e X

Tre canali, solo tre.

1. **Eventi** (tenant → X). Un fatto che è successo: «è arrivata una bolletta», «una rata scade tra 7 giorni», «un allenamento è stato registrato». Il tenant li scrive in una coda; il portiere li ritira e li consegna a X. *Riassunto, non contenuto grezzo, per le aree sensibili.*
2. **Domande** (X → tenant). Sola lettura: «peso medio di ottobre», «quanto devo pagare questo mese». La risposta passa dal portiere, che applica le regole della persona e dell'area.
3. **Proposte** (X → tenant). «Registro 80 € dal dentista?». Il portiere la porta al tenant come bozza; arriva a te con «Conferma / Annulla»; scrive solo dopo la conferma.

### 4.4 Identità e permessi per due persone

- Ogni persona è riconosciuta dal proprio **identificativo Telegram**, collegato a un utente di Platform (come fa il bot oggi).
- Per ogni persona il portiere usa il **token di quella persona**, con il suo ruolo. I permessi reali li impone il tenant (la regola «vedo solo le mie righe» c'è già).
- Il portiere aggiunge un secondo filtro, scritto in un file di configurazione (esempio in appendice C).
- **Aree private** (Finance, Work, Health, Sports di ognuno) e **aree condivise** (Casa, spese comuni). Per condividere una cosa privata serve una scelta esplicita, per categoria e revocabile.
- Una pagina in Platform, **«Cosa ha visto X di me»**, mostra cosa è stato chiesto sulle tue aree, quando e per chi.

### 4.5 La memoria

| Livello | Contenuto | Esempio | Durata |
|---|---|---|---|
| **Profilo** | chi sei, come ti piace essere trattato | «preferisce messaggi brevi; paga il 27» | finché lo cambi |
| **Note per area** | cosa conta in quell'area | «la carta del dentista è la Visa» | a lungo, rivedibile |
| **Riassunti** | cosa è successo in un periodo | «a ottobre 57 pagamenti, il doppio del solito» | scadenza (es. 12 mesi) |
| **Conversazione recente** | gli ultimi scambi | gli ultimi giorni | breve |

Regole: file di testo leggibili (si possono aprire e correggere), cifrati a riposo e inclusi nei backup; ogni persona ha la **sua** memoria privata e c'è una memoria **condivisa**; esiste il comando «**dimentica**» (per un ricordo, per un'area, per tutto).

### 4.6 L'orologio

| Lavoro | Quando | Cosa fa |
|---|---|---|
| **Buongiorno** | ogni mattina all'ora scelta | scrive il giornale: scadenze, anomalie, cosa è successo |
| **Sentinella** | ogni pochi minuti | controlla i servizi (es. i container, i siti); avvisa e *propone* il rimedio |
| **Revisione** | domenica sera | la settimana, anche incrociata tra le aree |
| **Mensile** | il giorno scelto | prepara il mensile e segnala cosa non torna |
| **Ritiro eventi** | ogni minuto | consegna a X ciò che i tenant hanno messo in coda |

### 4.7 I modelli AI e i livelli di sensibilità

X non usa un solo modello: un **router** sceglie in base al compito e alla sensibilità.

| Livello | Dati | Dove si elabora |
|---|---|---|
| **A, leggero** | conversazione, domande semplici, formattazione | modello economico |
| **B, finanza e lavoro** | righe, importi, documenti | modello forte, con le regole del §6 |
| **C, salute** | referti, misure | solo **riassunti** verso il cloud; la lettura dei documenti, se possibile, in locale o su un servizio privato |

Il fornitore da usare (Claude, Mistral o entrambi) è la decisione 2. Il costo si controlla con un **tetto in euro al giorno**, una cache e il modello economico per la lettura.

### 4.8 I canali

- **Telegram con argomenti**: un gruppo con una stanza per area (Finance, Work, Health, Sports, Casa) e una generale. Scrivi nella stanza giusta e parli con la mansione giusta. In alternativa, chat separate (decisione 7).
- **Voce**: un vocale su Telegram viene trascritto da un servizio di trascrizione (da scegliere, decisione 5) e trattato come testo; le risposte restano scritte.
- **Foto e PDF**: inoltrati a X, che li legge e propone la riga.
- **WhatsApp**: solo in uscita, come ora.

### 4.9 Costruire o adottare

OpenClaw, secondo gli articoli consultati (fonti di terzi, non la documentazione ufficiale), è un agente sempre acceso, self-hosted, con più canali di chat, memoria persistente, un sistema di skill e un negozio della comunità. Gli stessi articoli riportano skill malevole nel negozio e molte installazioni esposte senza autenticazione.

| | **OpenClaw** | **X su misura** |
|---|---|---|
| Tempo per partire | basso | medio |
| Superficie d'attacco | grande (molti canali, skill di terzi) | piccola (un canale, nessuna skill esterna) |
| Adatto a Platform | generico, va adattato | nasce per Platform e il suo MCP |
| Manutenzione | segue un progetto altrui | tua |
| Linguaggio | Node | Node (come Platform) |

**Raccomandazione:** X su misura, **piccolo**, che prende da OpenClaw le idee (gateway di chat, memoria in file, orologio, mansioni scritte come file) e lascia fuori il negozio di skill e i canali che non servono. Le **mansioni** sono cartelle di testo scritte da noi, versionate in git, di sola lettura per X.

---

## 5. I quattro flussi, passo per passo

### 5.1 Il Buongiorno
1. L'orologio avvia il lavoro all'ora scelta.
2. X chiede al portiere, per ogni area di quella persona, i numeri di oggi (scadenze, anomalie, eventi della notte).
3. X scrive il messaggio (appendice A). Ogni cifra ha un «perché?» che, se chiesto, apre le righe da cui viene.
4. Se non c'è niente da dire, **non scrive**.

### 5.2 «Ho fatto il pieno, 62 euro» (vocale)
1. Il vocale arriva su Telegram, viene trascritto.
2. X capisce: spesa, categoria Auto, 62 €, oggi.
3. X manda la **proposta** con i tasti: «Registro 62 € in Spese personali, categoria Auto?».
4. Tu confermi. Il portiere scrive nel tenant con **il tuo** token. X risponde con la ricevuta e il tasto «Annulla».

### 5.3 Una bolletta nuova
1. Arriva una mail con un PDF. Il tenant la legge (come oggi) e mette un evento in coda.
2. X lo riceve, confronta con le bollette precedenti («+18% rispetto a ottobre»).
3. Se l'**IBAN** non è mai stato visto per quel fornitore: **sempre** una domanda a te, prima di qualunque cosa.
4. X propone la riga e la scadenza; con la conferma il tenant le crea.

### 5.4 Una domanda che attraversa le aree
«Nelle settimane in cui ho dormito poco ho speso di più?»
1. X chiede a **Health** un riassunto settimanale del sonno (non i referti) e a **Finance** le spese per settimana.
2. Il portiere risponde a ciascuna domanda separatamente, con le regole della persona.
3. X mette insieme i **due riassunti**, mai le righe, e risponde con i numeri e con quanto è incerta la conclusione.

---

## 6. Sicurezza e privacy

### 6.1 Minacce e controlli

| Minaccia | Cosa potrebbe succedere | Controllo |
|---|---|---|
| **Istruzioni nascoste in un documento o in una mail** (prompt injection) | X viene indotto a fare cose che non hai chiesto | i documenti sono dati; azioni solo da te o dalle mansioni; scritture sempre con conferma; X non ha strumenti per muovere soldi |
| **IBAN cambiato** | un pagamento va a un conto sbagliato | IBAN nuovo per quel fornitore = conferma tua, sempre |
| **Token rubato** | accesso ai dati | token con ruolo minimo, sola lettura di partenza, revocabili in un attimo; i token dei tenant li ha il portiere, non X |
| **X sbaglia o «impazzisce»** | scrive cose sbagliate, o troppe | proposte con conferma, tetto di azioni al giorno, ricevute, annullamento, interruttore generale |
| **Costi fuori controllo** | l'AI consuma troppo | tetto in euro al giorno, avviso a metà, blocco al limite |
| **Il portiere compromesso** | tutti i token in mano ad altri | ruoli ristretti, segreti cifrati, macchina separata, revoca dai tenant, registro delle richieste |
| **Account Telegram compromesso** | qualcuno parla a X come te | X risponde solo agli identificativi riconosciuti; azioni rischiose con un secondo passaggio (da definire) |
| **Privacy tra le due persone** | una vede cose dell'altra | privato di partenza, condivisione esplicita e revocabile, pagina «Cosa ha visto X di me» |
| **Dipendenze e aggiornamenti** | una libreria vulnerabile | niente skill di terzi; audit delle dipendenze come per Platform; un aggiornamento passa da una copia prima di toccare il vero |

### 6.2 La scala della fiducia

| Livello | X può | Come si sale |
|---|---|---|
| **L0** | leggere e rispondere | all'inizio |
| **L1** | **proporre** una scrittura (con la tua conferma) | dopo la tappa 2 |
| **L2** | eseguire da solo una *classe* di azioni piccole e a basso rischio (es. «registra spesa da scontrino sotto 20 €»), con riepilogo la sera e annullamento entro 24 ore | dopo 50 proposte di quella classe accettate senza correzioni |
| **L3** | come L2 con limiti più alti | dopo un periodo lungo senza errori |
| **mai** | muovere soldi, firmare, cancellare dati, cambiare le proprie regole | mai |

Se una classe di azioni sbaglia, **scende di un gradino**. La scala si decide per classe, non in blocco.

### 6.3 Le regole di ferro
1. X non ha porte aperte verso internet.
2. I documenti sono dati, non ordini.
3. IBAN mai visto per quel fornitore: sempre conferma.
4. Nessun agente muove soldi da solo.
5. X non può cambiare le proprie mansioni né alzare i propri limiti.
6. Ogni azione lascia una ricevuta con il motivo, e si annulla.
7. Un interruttore spegne tutto.
8. Una chat sconosciuta non riceve mai niente.
9. Niente password né credenziali passano da X.

### 6.4 La salute
- È la categoria più delicata. I dati restano sul **tuo** server, cifrati; al cloud vanno **riassunti**, mai il referto intero, salvo una tua scelta.
- Il tenant Health vive in un **volume isolato**, come già si fa per i tenant esistenti.
- Se un giorno l'uso uscisse dalla sfera personale, andrebbe rivalutato con un professionista (non è una consulenza legale).

### 6.5 Cosa si fa se…

| Situazione | Primo gesto |
|---|---|
| X scrive o fa qualcosa di strano | interruttore generale, poi si guarda il registro |
| sospetti un token compromesso | revochi il token nel tenant (Impostazioni → Token API); il portiere smette di funzionare per quell'area, X no |
| i costi salgono | si abbassa il tetto; X si ferma da solo al limite |
| il Linode di X cade | Platform e i tenant non ne risentono; X ritorna con i backup |
| perdi l'accesso a Telegram | X smette di rispondere a quell'identificativo; ne colleghi un altro |

---

## 7. Personalità e voce

- **Nome**: da scegliere (decisione 1). Un nome tuo lo rende una presenza.
- **Tono**: asciutto, caldo, o scherzoso. Si sceglie e si può cambiare.
- **Regole di scrittura**: breve; i numeri prima; mai inventare; dire quando non è sicuro; «perché?» disponibile su ogni cifra.

Esempio della stessa notizia in tre toni:
- *Asciutto*: «Oggi scadono 330,99 €. Il resto del mese: 98 €.»
- *Caldo*: «Buongiorno. Oggi pagano due cose, per 330 €. Il resto del mese è tranquillo.»
- *Scherzoso*: «Giorno di paghe: 330 € in uscita. Poi respiri fino a fine mese.»

---

## 8. Roadmap a tappe

Ogni tappa è usabile da sola. Dimensione: **S** = pochi giorni di lavoro assistito, **M** = una o due settimane, **L** = più di due settimane. Sono stime, da rivedere alla prima tappa.

| Tappa | Cosa si costruisce | Dove | Fatto quando | Dim. |
|---|---|---|---|---|
| **T0 Fondamenta** | macchina, portiere minimo, MCP remoto con login (da verificare come si autentica un client), coda in uscita in un tenant di prova, eccezioni scritte nelle decisioni | Platform, portiere, Linode | un tenant di prova risponde a X attraverso il portiere, in sola lettura | M |
| **T1 Buongiorno** | il giornale del mattino su Finance, con il «perché?» | X, portiere | ricevi il messaggio per sette mattine di fila e dici cosa manca | S |
| **T2 Dimmi** | domande ai dati, a testo (poi a voce) | X | tre domande al giorno per una settimana, con risposte giuste | M |
| **T3 Fai** | proposte di registrazione (voce, foto, PDF) con conferma e annullamento | X, portiere, tenant | 50 proposte accettate, con le correzioni contate | M |
| **T4 Ricorda** | memoria a livelli, «dimentica», profilo | X | X smette di chiederti le cose ovvie | M |
| **T5 Pensa** | revisione settimanale, scenari su una copia del tenant, i tre consiglieri per decisioni grosse | X, tenant | una decisione vera presa con il suo aiuto | L |
| **T6 Aree e voce** | Work, Sports, poi Health; domande incrociate; risposte vocali | tenant, X | le domande incrociate danno risposte che ti servono | L |

**Regola:** il prossimo pezzo è sempre quello che useresti domani mattina.

### Come si prova ogni tappa
- Prima su un **tenant di prova** con dati finti, poi su Finance in sola lettura.
- Una settimana d'uso prima di passare alla tappa dopo.
- Si contano: proposte accettate, corrette, rifiutate; errori; costo al giorno.

---

## 9. Lavori concreti nel repository

*Proposta, nulla di questo esiste ancora.*

| Lavoro | Dove (proposto) | Note |
|---|---|---|
| MCP remoto con login, un tenant per volta | `core/backend/src/routes/` o `portiere/` | parte dall'`mcp-server/` esistente; autenticazione da verificare |
| **Portiere** (multi-tenant) | `portiere/` (servizio a sé) | configurazione per persona e area; cache; riprova su 429; nome di client esplicito |
| **Coda in uscita** | tabella e rotta nel core (`outbox`) | eventi generici, mai nomi di progetto nel codice |
| **X** | `agente/` | gateway Telegram, memoria, orologio, mansioni, router dei modelli |
| **Mansioni** come dati | `agente/mansioni/` | file di testo versionati, sola lettura per X |
| Moduli Work, Health, Sports | Libreria di Platform | uno alla volta, Health per ultimo, volume isolato |
| Pagina «Cosa ha visto X di me» | core, Impostazioni | legge il registro del portiere |
| Test e `verifica.sh` | `core/`, `portiere/`, `agente/` | il portiere e X entrano nella verifica completa |
| Documentazione | `ARCHITETTURA.md`, `OPERAZIONI.md`, `DECISIONI.md` | come per ogni modifica |
| **Eccezioni alla visione** | `docs/DECISIONI.md` | da scrivere prima della T0 (qui sotto) |

### Le eccezioni da scrivere
La visione di Platform esclude oggi la **federazione tra istanze** e fissa la regola «un pezzo entra solo se serve a un progetto reale di oggi». Questo progetto chiede due eccezioni, da registrare con il motivo:
1. **Lettura incrociata tra tenant**, in sola lettura, solo su riassunti, tramite il portiere. Motivo: una vita sola con un unico punto d'ingresso.
2. **Un agente esterno con un MCP remoto**, con i limiti del §6. Motivo: la mente che manca a Platform per l'uso quotidiano.

---

## 10. Costi e risorse

Non ho verificato i prezzi attuali: vanno fissati prima della T1.

- **La macchina**: un Linode piccolo e dedicato; il portiere sulla stessa macchina in un processo separato, o su una seconda più piccola.
- **L'AI**: costo = numero di messaggi × modello usato. Si controlla con: tetto in euro al giorno, cache delle risposte, modello economico per leggere i documenti, nessuna chiamata se non c'è niente da dire (il Buongiorno non parte senza novità).
- **La trascrizione della voce**: un servizio a parte, da scegliere, a consumo.
- **Il tempo**: la parte più cara è la T0. Dopo, ogni tappa è incrementale.

**Regola:** prima di accendere qualunque tappa si scrive il tetto di spesa giornaliero e si guarda il costo reale dopo la prima settimana.

---

## 11. Le decisioni da prendere

| # | Decisione | Opzioni | Mia raccomandazione | Serve entro |
|---|---|---|---|---|
| 1 | **Il nome** (e il tono) | qualunque | uno corto, tuo | T1 |
| 2 | **Il fornitore del modello** | Claude, Mistral, entrambi con router | entrambi: uno forte per ragionare, uno economico per leggere | T0 |
| 3 | **Chi parla con X** | solo Nima; Nima e la compagnia (è Federica?) | entrambi, con aree private e condivise | T1 |
| 4 | **Come arrivano gli eventi** | X li ritira dalla coda; i tenant li spingono | ritira: nessuna porta aperta | T0 |
| 5 | **La trascrizione della voce** | un servizio a consumo; un modello locale | un servizio a consumo, solo dalla T2 | T2 |
| 6 | **Dove vive il portiere** | processo separato sul Linode di X; macchina propria | macchina propria, se il costo lo permette | T0 |
| 7 | **Telegram** | un gruppo con argomenti; chat separate | gruppo con argomenti | T1 |
| 8 | **Health** | stesso Linode di Finance; a parte | a parte, volume isolato | T6 |
| 9 | **Per quanto tempo ricorda** | 6, 12, 24 mesi per i riassunti | 12 mesi, rivedibile | T4 |
| 10 | **Le eccezioni alla visione** | scriverle; non farlo | scriverle prima della T0 | T0 |

---

## 12. Cosa non faremo

- Un **negozio di skill** o l'installazione di estensioni di terzi.
- **Muovere soldi**, firmare, o cancellare dati da parte di X.
- **WhatsApp a doppio senso** con librerie non ufficiali (rischio di blocco del numero).
- **Aprire porte** su X verso internet.
- Un prodotto per altri, utenti esterni, pagamenti.
- Mettere insieme **le righe grezze** di tenant diversi: si uniscono solo riassunti.

---

## 13. Come sapremo che funziona

| Misura | Obiettivo iniziale |
|---|---|
| Apri il messaggio del mattino | quasi ogni giorno, dopo due settimane |
| Proposte accettate senza correzione | almeno 90% prima di salire di livello |
| Errori che toccano i dati | zero |
| Costo giornaliero | sotto il tetto che hai scelto |
| Tempo che ti fa risparmiare | lo dici tu dopo il primo mese |

---

## 14. Il prossimo passo

1. **Rispondere alle prime cinque decisioni** del §11.
2. **Scrivere le due eccezioni** in `docs/DECISIONI.md`.
3. **Verificare** due cose incerte: come si autentica un client a un MCP remoto di Platform, e quanto arriva a creare Super Admin con «Server (Linode)».
4. **Preparare la T0** su un tenant di prova con dati finti.
5. **Una settimana** del Buongiorno su Finance, in sola lettura, prima di ogni altra tappa.

---

## Appendici

### A. Esempio di messaggio «Buongiorno»

```
Buongiorno.

Oggi scade
• 27/11  Ciclo idrico — 253,87 €
• 27/11  Fattura 266969/2026 — 77,12 €

Questa settimana: 341,99 €. Poi un mese tranquillo.
Stanotte: nessun problema ai servizi.
In attesa di te: 2 righe da confermare.

Vuoi il perché di una cifra?
```

### B. Esempio di evento in coda (illustrativo)

```json
{
  "id": "evt_000123",
  "tenant": "finance",
  "tipo": "scadenza_vicina",
  "quando": "2026-11-25T08:00:00+01:00",
  "riassunto": "Una rata scade tra 7 giorni",
  "dettagli": { "voci": 1, "totale": 50.58 },
  "sensibilita": "B"
}
```

### C. Esempio di configurazione del portiere (illustrativo)

```yaml
tenant:
  finance:
    indirizzo: https://finance.example
    token: SEGRETO_CIFRATO        # non lo vede mai X
    strumenti_ammessi: [elenco_moduli, lista_record, leggi_record, chiedi_ai_dati]
  health:
    indirizzo: https://health.example
    token: SEGRETO_CIFRATO
    strumenti_ammessi: [riassunto_settimanale]   # solo riassunti
persone:
  nima:
    aree: [finance, work, health, sports, casa]
  compagnia:
    aree: [finance_sua, work_sua, health_sua, sports_sua, casa]
condivisioni: []    # una cosa privata si condivide solo aggiungendola qui, per categoria
limiti:
  richieste_al_minuto: 30
  riprova_su_429: true
  nome_client: portiere/1.0
```

### D. Esempio di mansione («contabile», illustrativa)

```
mansione: contabile
area: finance
può: leggere righe e scadenze; proporre la registrazione di una spesa
non può: muovere soldi, cancellare, modificare righe già pagate
sempre: chiedere conferma; controllare l'IBAN; spiegare il perché di ogni cifra
tono: asciutto
```

### E. Glossario

- **Agente**: un programma che decide da sé i passi per raggiungere un obiettivo, con strumenti e memoria.
- **Bot**: segue un copione; qui, il bot Telegram dentro ogni tenant.
- **MCP**: il modo standard con cui un'AI usa strumenti esterni.
- **Portiere**: il servizio che sta tra X e i tenant, tiene i token e applica le regole.
- **Coda in uscita (outbox)**: dove un tenant lascia gli eventi che qualcun altro ritira.
- **Tenant**: un progetto di Platform, con il suo database.
- **Scala della fiducia**: i livelli di autonomia di X, che si guadagnano per tipo di azione.
