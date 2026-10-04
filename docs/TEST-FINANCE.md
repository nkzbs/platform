# Test di Finance

Lista di prove per verificare a mano che Finance funzioni, dopo gli ultimi cambiamenti (ruoli dei moduli, avvisi, coda "Da smistare", "Smista", AI, monitoraggio).
Ogni prova dice **cosa fare** e **cosa deve succedere**. I test automatici (`npm test`) coprono il codice con servizi simulati: qui si prova con i dati veri.
Spunta man mano; se qualcosa non torna, annota cosa hai visto (schermata e passo) e riportalo.

**Prima di cominciare:** ricarica la pagina (Cmd+Shift+R). Se vuoi essere al sicuro, salva una copia dei dati (Impostazioni → Dati → Backup completo).

## 1. Accesso e dashboard

- [ ] Il menu ha 8 moduli: Entrate, Spese personali, Spese casa, Documenti, Conti, Debiti casa, Debiti personali, Timbrature (nessun modulo nascosto: Pagamenti e Ricorrenti sono stati ritirati).
- [ ] Accedi come admin. La dashboard ha, nell'ordine: **Da smistare**, **Come sta andando — Personale**, **Come sta andando — Casa**, Riepilogo mensile, Checklist.
- [ ] **Personale** mostra per settembre entrate 1.799,58 € e spese 1.321,45 €. Il pulsante Mese / Da inizio anno cambia la vista.
- [ ] **Casa** mostra solo spese (niente entrate, saldo, risparmio), con "già pagate" e "ancora da pagare".
- [ ] "Modifica layout" → "Aggiungi widget": l'elenco è in gruppi (Numeri, Elenchi, Andamenti, Finanza) e ogni tipo ha una riga che spiega cosa fa.

## 2. Coda "Da smistare" e pulsante "Smista"

- [ ] La coda elenca le righe in stato "da smistare" di Spese casa e Spese personali.
- [ ] **Smista** apre un pannello con importo, scadenza e categoria modificabili e tre scelte: *Un pagamento*, *Dividi in rate*, *Già pagata*.
- [ ] *Un pagamento* (con importo > 0): la riga sparisce dalla coda, compare un messaggio verde "Smistata: ora è in «da pagare»…" con il link al modulo, e in Spese casa la riga è "da pagare".
- [ ] Una riga con importo 0: il pannello avvisa e *Un pagamento* chiede di controllarlo; *Dividi in rate* è bloccata finché non c'è un importo.
- [ ] *Dividi in rate* (es. 3 rate): il pannello mostra "3 rate da X €, dal … al …". Dopo la conferma: in **Debiti** compare il piano, in Spese le 3 rate "da pagare" collegate, la riga originale non c'è più e il PDF (se c'era) è sulla prima rata.
- [ ] *Già pagata*: la riga finisce "pagato" con la data scelta.
- [ ] Smistare due volte la stessa riga non è possibile (la riga non è più nella coda).

## 3. Avvisi WhatsApp

- [ ] **Messaggio di prova:** Impostazioni → Connessioni → WhatsApp → "Invia messaggio di prova". Arriva sul telefono; in "Ultimi invii" compare la riga con esito "inviato".
- [ ] **Riga nuova da smistare:** crea in Spese casa una riga di prova con stato "Da smistare". Entro circa un minuto arriva "Bolletta da smistare: …". Se ne crei più di una insieme, ne arriva uno solo con l'elenco. Poi smistala o eliminala.
- [ ] **Bolletta vera da Gmail:** alla prossima mail di un mittente con regola, la riga compare in coda entro 15 minuti e arriva l'avviso.
- [ ] **Riepilogo del mattino:** alle 8:00 arriva con scadenze di oggi, domani, in ritardo e le righe "da smistare". *Dopo la pulizia dei dati* (vedi sotto) deve essere breve.
- [ ] **Mail non riconosciute:** una mail con "bolletta" o "fattura" da un mittente senza regola compare in Impostazioni → Connessioni → Google → "Mail non riconosciute" e arriva un messaggio. "Crea regola" precompila il mittente; "Ignora" la toglie.

## 4. AI (Impostazioni → AI)

- [ ] Lo stato è "AI accesa", la chiave è salvata e la spesa del mese è sotto il tetto.
- [ ] **Smista già compilato:** apri "Smista" su una riga *con un PDF allegato*: il pannello si compila e mostra, per importo, scadenza e categoria, la riga del PDF da cui è stato letto, con "Apri PDF". Controlla che i valori corrispondano alla bolletta.
- [ ] Su una riga **senza** PDF né testo: l'AI non propone niente e il pannello lo dice.
- [ ] **Spiega con l'AI** sui due widget "Come sta andando": il testo parla in modo naturale e le cifre sono quelle del widget. Il pulsante "Riscrivi" lo rigenera.
- [ ] **Importa da PDF** (pagina di Spese casa o Spese personali): carichi una bolletta, controlli i campi proposti, confermi; la riga nasce in "da smistare" con il PDF allegato.
- [ ] **Chiedi ai dati** (in alto): "Quanto ho speso lo scorso anno?" mostra un totale, il dettaglio e "Ho capito così: Modulo, Somma, Periodo…". Una domanda assurda ("che tempo fa?") risponde "non so rispondere" con un motivo.
- [ ] Spegni l'AI dall'interruttore: spariscono "Chiedi ai dati", "Importa da PDF", "Spiega" e la precompilazione. Riaccendila con "Accendi e potenzia".

## 5. Dati e Timbrature

- [ ] Timbrature: 1.165 righe, ultima data 03/10/2026. La vista mensile e le ore per settimana funzionano.
- [ ] Il turno del 09/06/2023 (07:00–00:00) risulta con durata negativa: è un errore noto della formula (uscita meno entrata, non gestisce la mezzanotte).
- [ ] Impostazioni → Dati: Export CSV di un modulo, Backup `.db` e Export JSON si scaricano.

## 6. Utenti e accessi (da fare, lo fa Nima)

Sulla riga di ogni utente non admin c'è il pulsante **Moduli · vede tutto** (arancione finché non ha moduli assegnati): si apre, si spuntano i moduli, si salva. Dopo il salvataggio il pulsante mostra il numero di moduli.

Vedi `docs/OPERAZIONI.md` → "Utenti, accessi e 2FA". Dopo averli creati, prova **accedendo come l'utente di Federica**:

- [ ] Vede nel menu **solo** Timbrature e Spese casa (e la dashboard, vuota).
- [ ] Non vede Entrate, Spese personali, Documenti, Pagamenti, Debiti, Ricorrenti, né le Impostazioni.
- [ ] In Spese casa può leggere e creare righe; i widget della dashboard (solo admin) non compaiono.
- [ ] Riga di cautela: la scelta moduli per utente nasconde i moduli dal menu ma **non blocca l'API**.

## 7. 2FA

- [ ] Attiva il 2FA dal proprio account (Impostazioni → Il mio account): scansiona il QR con un'app authenticator e **salva i codici di recupero** (si vedono una volta sola).
- [ ] Esci e rientra: dopo la password chiede il codice a 6 cifre. Prova anche un codice di recupero (ognuno vale una sola volta).
- [ ] Fai lo stesso per il Super Admin (admin.platform-core.it).

## Dati da pulire prima del test degli avvisi

Il primo riepilogo e il messaggio mensile del 2 novembre dipendono da questi:

- [ ] Righe "da smistare" vecchie o a 0 € (smistale, correggile o eliminale).
- [ ] La riga A2A da 201 € ha scadenza 30/04/2028 (è la data del contratto): correggila.
- [ ] Settembre: affitto 550 €, "Spese Casa" 500 € e rata PayPal 50,17 € risultano ancora "da pagare": segnali "pagato" se lo sono.
- [ ] Le righe scadute da verificare (assicurazione auto, hotel Sardegna, A2A Acqua) e la Quarta Cartella marzo–maggio.
