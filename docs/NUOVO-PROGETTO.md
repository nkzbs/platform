# Avviare un nuovo progetto, da soli

Come passare da «ho un'attività da gestire» a «ho un tenant che funziona», usando solo Platform (nessuno strumento esterno, nessuna sessione di sviluppo). Ogni passo dice **dove** si fa, **cosa succede** e **come capire se è andato bene**.

Prima volta? Servono solo due cose già impostate in Super Admin: la **chiave AI** (Impostazioni → Chiavi AI) e, per le mail ai clienti, nel tenant la **posta in uscita** (vedi il passo 7).

## 1. Raccontare l'attività — Super Admin → Analisi
1. **Nuova analisi**: scrivi in 5-10 righe come funziona l'attività (chi sono i clienti, cosa si fa, chi fa cosa, cosa si consegna, come si incassa). Niente nomi e dati personali veri: vengono tolti prima di mandare il testo all'AI.
2. **Fai tutto** (o «Proponi i processi»): l'AI scrive i processi (scopo, passaggi, ruoli, eccezioni) e li confronta con i moduli della Libreria.
3. Rileggi i processi, togli quelli inutili, correggi i nomi. **Correggi a parole** («togli la fatturazione, aggiungi i turni») e **Cosa manca?** aggiungono moduli e lacune senza togliere nulla.
4. «Cosa copre la Libreria» dice quali processi hanno già un modulo e quali sono **da costruire**.

*Segno che è andata bene*: ogni processo ha un modulo oppure la voce «da costruire», e il manuale dei processi si legge senza buchi.

## 2. Far scrivere i moduli mancanti — riquadro «Moduli da costruire»
1. Premi **Proponi e scrivi i moduli mancanti**. L'AI decide quali moduli nuovi servono (senza duplicare quelli della Libreria) e ne scrive una bozza ciascuno: campi, relazioni, stati del flusso, requisiti per passare di stato, allegati, automazioni, documenti, calendario. Può servire qualche minuto; puoi lasciare la pagina.
2. Ogni bozza è **controllata dal codice** (lo stesso controllo di «Controlla il tenant»): se ha problemi, il modello li riceve e corregge fino a 3 volte. Quelle senza problemi sono già approvate; quelle con problemi restano non approvate e mostrano cosa non va.
3. **Approva** (casella) le bozze da installare, **scarta** quelle che non servono. «Rigenera» riscrive tutto.

*Segno che è andata bene*: ogni bozza dice «Controllo superato» e il percorso degli stati ha senso per l'attività.

## 3. Creare il tenant — riquadro «Crea il tenant»
Scegli nome e indirizzo (minuscole e trattini) e premi **Crea il tenant**. In 1-3 minuti nascono container, database, dominio, moduli della Libreria, **moduli generati approvati**, ruoli degli utenti, stati dei flussi, report (spenti), guida d'uso e un primo controllo.
Alla fine compare l'**accesso amministratore iniziale** (si vede **una sola volta**: copialo; se lo perdi c'è «Genera una nuova password»).

*Segno che è andata bene*: «Tenant creato», nessun avviso in giallo; sotto compare **Quanto è operativo**.

## 4. Verificare che funzioni davvero — nel tenant
Apri il tenant con l'accesso amministratore → **Impostazioni → Moduli**:
- **Controlla**: punteggio di coerenza (relazioni, stati, requisiti, automazioni, documenti, viste). Ogni problema dice modulo, blocco e cosa non esiste.
- **Collaudo completo** (circa un minuto): in una **copia isolata** crea record di prova, fa avanzare ogni stato (provando che un requisito bloccante blocchi davvero), controlla che le automazioni creino ciò che devono e che i documenti si generino. I dati veri non si toccano e nulla parte verso l'esterno.
- **Dati di esempio**: carica qualche scheda inventata in ogni modulo per provare a mano; «Togli i dati di esempio» le cancella tutte, senza toccare quelle vere.

*Segno che è andata bene*: coerenza e collaudo vicini a 100. Un punteggio più basso può essere un falso allarme (per esempio una condizione di automazione che i dati di prova non soddisfano): il messaggio lo dice, e va letto.

## 5. Sistemare ciò che manca — Builder del tenant
Per ogni problema segnalato apri il modulo nel **Builder** (menu → Builder) e correggi: aggiungi il campo citato, il tipo di allegato, lo stato. Poi di nuovo **Controlla**. Quello che può mettere solo una persona è in «**Da completare a mano**» (per esempio collegare un servizio esterno).

## 6. La guida d'uso — Impostazioni → Guida
È già stata scritta dai moduli. Rileggi ogni capitolo, aggiungi gli esempi e i consigli del tuo mestiere, **Salva**. Compare nel «?» di ogni pagina, nella pagina Guida e nel giro guidato.

## 7. Impostazioni da fare a mano — nel tenant
- **Aspetto**: nome, logo, colore, carattere.
- **Utenti & Ruoli**: invita le persone e dai il ruolo giusto.
- **Connessioni → Posta in uscita**: SMTP del tuo dominio oppure Resend, poi «Invia mail di prova».
- **Connessioni → altri servizi**: solo quelli che servono davvero (Google, OpenAPI.it, Telegram…).
- **Messaggi ai clienti**: auguri e invio di massa, se li usi.

## 8. Metterlo in uso
1. Togli i dati di esempio (Impostazioni → Moduli).
2. Importa i dati veri dal CSV di ogni modulo (pulsante **Importa**), o inseriscili a mano.
3. Fai un **Backup** (Super Admin → Tenant → Dettagli → Backup) prima di iniziare a lavorare.
4. Per aggiornare il tenant a una versione nuova di Platform: Super Admin → Tenant → **Aggiorna** (vedi `docs/OPERAZIONI.md`).

## Se qualcosa non va
| Sintomo | Cosa fare |
|---|---|
| «Nessuna chiave AI» | Super Admin → Impostazioni → Chiavi AI. |
| La generazione dei moduli finisce con un errore | Premi di nuovo **Proponi e scrivi**; se si ripete, accorcia o chiarisci il racconto e rigenera. Le bozze già approvate restano. |
| Una bozza ha problemi anche dopo 3 tentativi | Approvala comunque e correggila nel Builder del tenant, oppure scartala e riscrivila a mano nel Builder. |
| «Tenant creato» ma con avvisi gialli | Ogni avviso dice cosa non è stato applicato; ruoli e flussi si rilanciano con **Riprova**. |
| Il collaudo dà un punteggio basso | Leggi i messaggi: indicano modulo, blocco e cosa non riesce. Spesso basta un requisito che chiede un campo non compilabile o una condizione di automazione troppo stretta. |
| «Aggiorna» dà KO al primo tentativo | Copia la frase nel riquadro rosso (è in `docs/OPERAZIONI.md` come leggerla). |

## Cosa c'è dietro (per chi vuole capire)
- L'analisi: `super-admin/backend/src/lib/analysis.js`; i moduli generati: `lib/generatore-moduli.js` (piano, bozza, pulizia, controllo, correzione).
- Il controllo di coerenza: `shared/verifica-moduli.js` (puro, usato da Super Admin sulle bozze e dal tenant su ciò che è installato).
- Il collaudo: `core/backend/src/lib/collaudo-tenant.js`; la guida generata: `lib/guida-generata.js`; i dati di esempio: `lib/dati-esempio.js`.
- Cosa l'AI **non** fa: non scrive mai in un tenant senza la tua approvazione, non vede dati personali (vengono tolti), non inventa moduli della Libreria (gli id si validano), non genera chiavi o segreti dei servizi esterni.
