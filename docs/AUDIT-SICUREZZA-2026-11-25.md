# Audit di sicurezza e GDPR — 25 novembre 2026

Revisione fatta da Claude come auditor, su richiesta del titolare. **Non è una certificazione**: per quella servono un pentest esterno e un parere legale (DPO o avvocato). Questo documento è il materiale di partenza.

## Come leggerlo

- **Verificato**: provato con un comando o una richiesta (indicato come).
- **Dal codice**: letto nel codice, non provato dal vivo.
- **Da controllare**: sospetto o cosa che non ho potuto vedere.

Perimetro guardato: codice del repository (core, Super Admin, provisioner, shared), configurazione nginx, NAS in sola lettura, controlli esterni non invasivi su `admin.platform-core.it`, `finance.platform-core.it` e `hearth.karimpour.it`.

**Non fatto**: pentest dinamico su una copia locale (il server non parte in questo ambiente: si blocca all'avvio, anche prima delle modifiche di oggi); il server remoto dove girano i tenant (zucca, Finance): non l'ho visto; impostazioni DSM, dashboard Cloudflare, router; test con sessioni di ruoli diversi.

## Riepilogo

| # | Gravità | Problema | Stato |
|---|---------|----------|-------|
| A1 | Alto | Un solo segreto interno per Super Admin e per tutti i tenant | Dal codice + verificato che le rotte sono raggiungibili |
| A2 | Alto | Gli script delle fonti dati escono dal «sandbox» e eseguono codice nel tenant | **Verificato** (prova locale innocua) |
| A3 | Alto | L'origine si raggiunge direttamente, senza Cloudflare | **Verificato** |
| M1 | Medio | Collegamento Google: `state` ottenibile da chiunque | Dal codice |
| M2 | Medio | Token di sessione nell'indirizzo dei download (backup) | Dal codice |
| M3 | Medio | Mancano HSTS e CSP | **Verificato** |
| M4 | Medio | Limite di login per IP del bordo Cloudflare, nessun blocco per account, 2FA facoltativo | Dal codice |
| M5 | Medio | NAS: cartelle con permessi aperti a tutti, anche con dati personali | **Verificato** |
| M6 | Medio | Una dipendenza con vulnerabilità alta (provisioner) | **Verificato** (`npm audit`) |
| M7 | Medio | `internal-setup`: confronto del segreto non a tempo costante, valore di riserva noto | Dal codice |
| B1–B6 | Basso | Vedi sotto | Dal codice |
| G1–G6 | GDPR | Vedi sotto | Misto |

## Problemi alti

### A1 — Un solo segreto interno per tutto
- **Cosa**: `INTERNAL_API_SECRET` è lo stesso per Super Admin e per ogni tenant (`super-admin/backend/src/routes/tenants.js:350`). Con quel segreto, `POST /api/auth/internal-token` restituisce un token **admin** del tenant (`core/backend/src/routes/auth.js:262`). In più, `lib/tenant-auth.js` accetta ancora il segreto condiviso al posto del token firmato per tenant (la «finestra di transizione» del 26/10 è ancora aperta).
- **Prova**: le rotte interne sono raggiungibili da internet, perché `infra/nginx/nginx.conf` non le blocca. `curl` su `finance.platform-core.it/api/auth/internal-token` e `/api/internal-setup/verifica` risponde 401 (protette solo dal segreto).
- **Rischio**: chi ottiene il segreto da un solo punto (un tenant compromesso, un backup, un log) diventa admin su **tutti** i tenant e può leggere la chiave AI di ognuno.
- **Correzione**: (1) bloccare in nginx tutto ciò che ha `/internal` nel percorso; (2) un segreto diverso per tenant; (3) spegnere il ramo «legacy» di `tenant-auth.js` e il token `internal-token` per i tenant che non usano il Builder integrato.

### A2 — Script delle fonti dati: esecuzione di codice
- **Cosa**: `core/backend/src/source-engine.js` esegue gli script con il modulo `vm` di Node, che non è un confine di sicurezza.
- **Prova** (locale, innocua): da dentro lo script, `app.log.constructor('return typeof process')()` restituisce `object`. Quindi si arriva a `process`, alle variabili d'ambiente (`JWT_SECRET`, `INTERNAL_API_SECRET`) e a tutto il filesystem del tenant.
- **Chi può sfruttarlo**: un admin del tenant (il Builder è riservato agli admin) o un'analisi generata dall'AI che produca un blocco `api_source`. Oggi l'admin sei tu; diventa critico appena un cliente ha un admin.
- **In più**: gli script possono chiamare qualunque URL (`app.request(url).send()`), anche interno, senza blocco degli indirizzi privati: accesso al provisioner, a Redis e agli altri container.
- **Correzione**: eseguire gli script in un processo separato senza segreti (o con `isolated-vm`), con un elenco di domini consentiti e blocco degli indirizzi privati.

### A3 — L'origine è raggiungibile senza Cloudflare
- **Prova**: `curl -k -H "Host: admin.platform-core.it" https://hearth.karimpour.it:4000/` risponde 200 dal nginx del NAS. Il nome `hearth.karimpour.it` (rimasto dalla vecchia app) rivela l'indirizzo reale e non passa da Cloudflare. Il router inoltra l'intera fascia 4000-4100.
- **Rischio**: si aggira tutto ciò che Cloudflare dà (filtro, protezione dagli attacchi, blocco dei bot) e il limite di richieste.
- **Correzione**: accettare sulla porta 4000 solo gli indirizzi di Cloudflare (o certificato client «Authenticated Origin Pulls»); togliere o proxare il nome `hearth.karimpour.it`.

## Problemi medi

- **M1 — Collegamento Google** (`routes/google-oauth.js`): `/oauth/start` non richiede login e crea lo `state`. Un attaccante lo ottiene da solo, completa il consenso col **proprio** account Google e fa aprire il link di ritorno all'admin (il callback non lega lo `state` alla sessione): il tenant si collega alla casella dell'attaccante (mail lette dal poller, scadenze scritte nel suo calendario). Correzione: `start` solo da admin loggato e `state` legato alla sessione.
- **M2 — Token nell'indirizzo** (`super-admin/backend/src/routes/auth.js:75`): i download di backup e export usano `?token=` con il token di sessione (24 ore). Finisce in log, cronologia e intestazioni. Correzione: link monouso a scadenza breve.
- **M3 — Intestazioni**: su `admin.platform-core.it` ci sono `X-Frame-Options`, `nosniff` e `Referrer-Policy`, ma **mancano** `Strict-Transport-Security` e `Content-Security-Policy`.
- **M4 — Accessi**: il limite del login è per IP (10 ogni 5 minuti), ma l'IP è quello del bordo Cloudflare (`X-Real-IP` = `$remote_addr` in nginx): utenti diversi condividono il limite, e chi usa l'origine diretta lo aggira. Nessun blocco per account. Il 2FA è facoltativo anche per gli admin. Il PIN del vault può essere di 4 cifre.
- **M5 — NAS** (`/volume1/docker`): la cartella è `drwxrwxrwx` con ACL e quasi tutte le sottocartelle sono aperte a tutti (`platform-build-01`, `tmp_deploy`, `hearth`, `hearth_backup_20260521.tar.gz` con dati personali). `deploy-secrets` è `700` (bene), ma contiene script vecchi di agosto, tarball di immagini da 300 MB e copie `.bak` dei file di ambiente. Il NAS ospita anche altri servizi (Pi-hole, Homebridge, vecchie app).
- **M6 — Dipendenze**: `body-parser` < 1.20.9 nel `docker-provisioner` (blocco del servizio, alta). `npm audit fix`. Le altre quattro parti sono pulite.
- **M7 — `routes/internal-setup.js`**: confronto del segreto con `!==` e valore di riserva `'changeme_internal'`; il resto del codice usa `shared/internal-secret.js`. Mitigato dal controllo all'avvio in produzione. Correzione: usare il modulo condiviso.

## Problemi bassi

- B1: `bot-payslip.js:197` ha un valore di riserva `'changeme'` per il segreto JWT.
- B2: i token API (`plat_…`) non scadono mai.
- B3: i token di sessione emessi prima del log accessi (senza `sid`) non si possono revocare.
- B4: la password con bcrypt costo 10 (si consiglia 12); lunghezza minima 8 solo al cambio password.
- B5: l'accesso con utente inesistente non esegue bcrypt: differenza di tempo che rivela se il nome utente esiste.
- B6: gli strumenti in `docs/guida-utente/strumenti` hanno `admin1234` scritto dentro (solo contro localhost); il file `scripts/` non ha password vere.

## Cosa funziona bene

- Ruolo e stato dell'utente riletti a ogni richiesta; revoca delle sessioni da Super Admin; token di sessione da 24 ore.
- Controllo di proprietà su upload e allegati (falla del 14/10 chiusa); permessi per ruolo su CSV, viste, ricerca.
- SQL con parametri (le concatenazioni trovate usano solo nomi di colonna interni). Nessun `exec`/`spawn` con input utente (solo `pdftotext` con argomenti fissi).
- XSS: i grafici fanno escape delle etichette.
- CORS limitato alla zona `platform-core.it`; TLS Cloudflare «Full (strict)».
- Link di firma con token da 32 byte e limite di tentativi sul codice.
- Nessuna chiave o password reale nel repository; `deploy-secrets` è `700`; a parte nginx nessun container di Platform pubblica una porta (Pi-hole non mostra porte: probabilmente usa la rete dell'host, da controllare cosa espone).
- L'AI è spenta di default.

## GDPR

Dati trattati su zucca: anagrafica, codice fiscale, documenti d'identità e dati antiriciclaggio. Sono dati ad alto rischio, anche se non «particolari» ai sensi dell'art. 9.

- **G1 — Documentazione mancante**: nel repository non trovo il registro dei trattamenti (art. 30), la procedura per le violazioni (art. 33-34, notifica entro 72 ore), una valutazione d'impatto (DPIA) per i dati antiriciclaggio, né l'indicazione dei ruoli. **Chiarire**: zucca è titolare del trattamento, Platform è responsabile; serve un atto di nomina (art. 28).
- **G2 — Fornitori**: servono accordi di trattamento (DPA) con OpenAPI.it, Mistral AI, Cloudflare, Google (Drive e Gmail), il fornitore della posta e il server remoto. Da verificare per ognuno dove stanno i dati: Cloudflare e Google possono trasferirli fuori dall'UE (clausole contrattuali standard); Mistral è in Francia.
- **G3 — Conservazione**: l'avviso di conservazione scaduta **non cancella nulla** (scelta consapevole, DECISIONI.md). Manca una procedura che dica cosa fare dopo i 10 anni dell'antiriciclaggio e per il resto dei dati. Il log degli accessi non ha scadenza.
- **G4 — Diritti degli interessati**: esiste il modulo «Richieste privacy». **Da controllare**: un'esportazione strutturata di tutti i dati di una persona (art. 15 e 20) e una cancellazione che raggiunga allegati, backup e log.
- **G5 — Backup**: il backup settimanale via mail e le copie su Google Drive contengono dati personali. **Da controllare** che gli allegati siano cifrati e protetti.
- **G6 — AI**: spenta per default (privacy by default). **Da controllare** quali campi dei record partono verso Mistral per ogni funzione e se i clienti ne sono informati nell'informativa.

## Correzioni fatte il 25/11 (nel codice; non ancora su zucca)

| Voce | Cosa è cambiato | Come l'ho provato |
|------|-----------------|-------------------|
| A2 | Gli script delle fonti dati girano in un processo figlio senza variabili d'ambiente e, dove Node lo permette, senza disco né processi (`source-engine-child.js`). La rete resta libera, come deciso il 16/10. | 15 test, tra cui uno nuovo: lo script che esce dal vm non trova né segreti né file |
| M1 | L'avvio del collegamento Google è ora `POST` riservato agli admin e restituisce l'indirizzo; la vecchia `GET` aperta non esiste più | Test aggiornato (`google-oauth-state.test.js`), **non eseguito**: il server non parte in questo ambiente |
| M3 | HSTS, X-Frame-Options, nosniff e Referrer-Policy sulle pagine dei tenant e di Super Admin; la CSP è **in sola segnalazione** (Google Fonts la renderebbe bloccante troppo presto) | Solo lettura del file; da vedere nella console del browser dopo il deploy |
| M6 | `npm audit fix` nel provisioner | `npm audit`: 0 vulnerabilità |
| M7 | `internal-setup` usa il confronto a tempo costante di `shared/internal-secret.js`, senza valore di riserva | Controllo di sintassi |
| B1 | Tolto il valore di riserva `'changeme'` del JWT in `bot-payslip.js` | Controllo di sintassi |

**Resta aperto** (serve una tua conferma, tocca la produzione): A1 (segreto interno per tenant), A3 (porta 4000 solo da Cloudflare, nome `hearth.karimpour.it`), M4 (limite di login e 2FA obbligatorio), M5 (permessi del NAS), M2 (download con link monouso).

Nota sul deploy: lo script della fonte dati usa il flag `--permission` di Node (22.13 o più recente). Se il flag non fosse accettato dall'immagine, le fonti dati rispondono con un errore invece di girare senza protezione. Dopo il deploy: provare una fonte dati dal Builder.

## Piano in ordine di priorità

1. **Subito** (poche ore): bloccare le rotte `/internal` in nginx; limitare la porta 4000 a Cloudflare e togliere `hearth.karimpour.it`; `npm audit fix` nel provisioner; chiudere i permessi di `/volume1/docker` e togliere i vecchi file dai segreti.
2. **Questa settimana**: HSTS e CSP; segreto interno diverso per tenant e spegnimento del ramo legacy; `/oauth/start` solo admin; link monouso per i download; 2FA obbligatorio per gli admin.
3. **Prima di dare un accesso admin a un cliente**: sandbox vero per gli script delle fonti dati (A2).
4. **GDPR**: registro dei trattamenti, procedura di violazione, DPIA, nomina del responsabile e DPA con i fornitori; procedura di cancellazione e conservazione.
5. **Poi**: pentest esterno su copia di produzione, con test dei ruoli (cosa vede un utente non admin) e del server remoto.
