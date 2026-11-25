# Valutazione d'impatto sulla protezione dei dati — bozza (art. 35)

Trattamento valutato: **raccolta e conservazione di documenti d'identità, codice fiscale e dati di adeguata verifica dei clienti** nel gestionale.

Perché serve: sono dati che possono permettere un furto d'identità, riguardano molte persone nel tempo, sono tenuti per 10 anni. Anche se non sono «dati particolari» (art. 9), il rischio per le persone in caso di fuga è alto. Il titolare decide se la valutazione è obbligatoria nel suo caso; farla è comunque una buona pratica.

## 1. Descrizione

- **Cosa**: anagrafica, codice fiscale, copia del documento d'identità, professione, provenienza dei fondi, titolare effettivo.
- **Perché**: antiriciclaggio (obbligo di legge) e rapporto con il cliente.
- **Chi vede i dati**: personale autorizzato con ruolo adeguato; amministratori del sistema.
- **Dove stanno**: gestionale su server [da indicare: paese e fornitore dell'hosting], copie di sicurezza [da verificare la cifratura], [fornitori nel pannello].
- **Per quanto**: 10 anni dalla fine del rapporto.

## 2. Necessità e proporzione

- I dati sono richiesti dalla legge e limitati a quelli utili. Non si raccolgono dati più del necessario.
- Base giuridica: obbligo legale. Informativa data al cliente all'inizio (documento da firmare nel gestionale).

## 3. Rischi per le persone e misure

| Rischio | Misura già presente | Misura da aggiungere |
|---------|---------------------|----------------------|
| Accesso non autorizzato da fuori | Login con 2FA o passkey, sessioni a scadenza, limite dei tentativi | 2FA obbligatorio per gli admin; accesso all'origine solo da Cloudflare |
| Un utente vede dati non suoi | Ruoli e permessi per modulo e per scheda | Revisione periodica dei ruoli |
| Perdita o furto del dispositivo | Sessioni revocabili da remoto | Procedura per i dipendenti |
| Fuga dai fornitori | Elenco dei fornitori e accordi di trattamento | Accordi firmati con tutti |
| Fuga dalle copie di sicurezza | Copie cifrate | Controllo del ripristino ogni anno |
| Dati tenuti troppo a lungo | Avvisi di conservazione | Cancellazione periodica |
| Abuso interno | Registro degli accessi | Controllo a campione |

## 4. Esito

Da compilare dal titolare: rischio residuo accettabile / da ridurre; data; chi ha deciso; parere del DPO (se c'è).
