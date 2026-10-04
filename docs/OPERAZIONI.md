# Operazioni

Come si mette online, si aggiorna e si mantiene Platform sul NAS. Per come è fatto vedi
[`ARCHITETTURA.md`](../ARCHITETTURA.md).

## Dove gira

| Cosa | Valore |
|---|---|
| Server | NAS Synology, x86 (amd64), Docker in `/usr/local/bin/docker` |
| Accesso | `ssh -p 1988 claude@192.168.1.2` (chiave, niente password) |
| Router | inoltra la fascia 4000-4100 al NAS; Cloudflare punta alla porta **4000** |
| Segreti | `/volume1/docker/deploy-secrets/*.env` (permessi 600), mai nel repository |
| Sorgente per le build | `/volume1/docker/platform-build-01/` (viene rimandato a ogni messa online) |
| Copie fuori dal volume | `/volume1/Dati/Backup/Platform` (montata nel container come `/offsite-backups`) |

**Attenzione ai nomi.** Sul NAS il volume dati si chiama `platform-data` (senza prefisso) e la rete
`platform_platform`. Esiste anche un volume `platform_platform-data` che contiene solo un file vuoto: **non è
quello vero**. Con `docker compose` in locale i nomi hanno il prefisso `platform_`; sul NAS non si usa compose.

### I container in produzione

| Container | Immagine | Ruolo |
|---|---|---|
| `platform-nginx` | `nginx:alpine` | Router per dominio, porta 4000. Config nel volume `platform-nginx-config` |
| `super-admin-backend` | `super-admin-backend:0.1` | Registro, Libreria, backup. Database `/data/super-admin-01.db` |
| `super-admin-frontend` | `super-admin-frontend:0.1` | Interfaccia di Super Admin |
| `docker-provisioner` | `docker-provisioner:0.1` | Crea e ferma i tenant (l'unico con `docker.sock`) |
| `redis` | `redis:7-alpine` | Contatori del rate limit |
| `platform-<slug>` | `platform-core:latest` | Un container per tenant, creato da Super Admin |

Super Admin e i tenant sono raggiungibili da `admin.platform-core.it` e `<slug>.platform-core.it`.

## Mettere online una modifica

Dal Mac, nella cartella del repository:

```bash
bash scripts/redeploy-nas.sh                # tutto: backend, frontend, core
bash scripts/redeploy-nas.sh frontend       # una sola parte (backend | frontend | core)
```

Lo script manda il sorgente al NAS, ricostruisce le immagini lì (il NAS è amd64, il Mac no), sostituisce i
container di Super Admin e, per il core, aggiorna `platform-core:latest` e ricrea i tenant.

- **Rollback automatico**: di un container di Super Admin viene tenuto il vecchio fino a quando il nuovo non
  risulta in esecuzione; se non parte, torna il vecchio.
- **Sessioni attive**: un tenant dove qualcuno ha fatto un'azione negli ultimi 3 minuti viene **saltato**, mai
  forzato. Si rilancia dopo qualche minuto.
- Dopo una messa online, il browser può tenere la versione vecchia: ricarica con **Cmd+Shift+R**.

### Tornare indietro

Per il core dei tenant l'immagine precedente non viene conservata dallo script: per un rollback del core
si ricostruisce da un commit precedente (`git checkout <commit>` e `redeploy-nas.sh core`).
Per Super Admin il rollback automatico copre solo il caso "il nuovo non parte".

## Creare un tenant

Da Super Admin → **Tenant → Nuovo tenant**. Serve solo nome e slug.

1. Super Admin genera chiavi e password admin, e il provisioner crea il container.
2. Assegna `<slug>.platform-core.it` e crea il record DNS su Cloudflare, proxato.
3. Mostra le credenziali admin **una sola volta**: copiale subito.

Se Cloudflare fallisce il tenant nasce comunque, e la pagina mostra un avviso arancione con il motivo e il
pulsante **Riprova**. Cause tipiche: token Cloudflare scaduto o senza il permesso "Edit zone DNS".

Il record DNS può impiegare qualche minuto a comparire sul tuo computer: se il nome "non si trova", prova da
una finestra privata o dal telefono.

## Backup

- **Automatico**: ogni tenant ha una copia ogni 24 ore (si regola per tenant), ne tiene 7. Stanno in
  `/data/backups/<slug>/` e si vedono in Super Admin → tenant → **Dettagli → Backup**.
- **Manuale**: pulsante "Backup ora" nella stessa scheda.
- **Dal tenant**: voce **Export dati** → scarica il database (`.db`) o un export JSON completo.
- **Fuori dal volume (offsite)**: nella scheda Backup imposta l'indirizzo `file:///offsite-backups/<slug>`.
  Attenzione: `/volume1/Dati/Backup/Platform` è un'altra cartella dello **stesso NAS**: protegge da un
  errore sul volume Docker, non dalla perdita del NAS. Una copia su un altro dispositivo non è configurata.
- **La chiave di cifratura** di ogni tenant sta nel registro di Super Admin (`super-admin-01.db`) e va
  conservata insieme ai backup: senza, i campi cifrati (per esempio il Password Vault) non si leggono più.

### Ripristinare

- **Un tenant da una sua copia**: Super Admin → tenant → Dettagli → Backup → Ripristina. Prima fa una copia
  di sicurezza dello stato attuale.
- **Un tenant su un Super Admin nuovo** (registro perso): **Tenant → Registra esistente**. Si carica il vecchio
  `super-admin-*.db` (le chiavi si copiano da sole) oppure si inseriscono i dati a mano, compresa la chiave
  di cifratura. Il tenant nasce fermo: premi **Start** e il container viene ricreato sul volume dati.

## Collegamenti esterni

### Google (Gmail, Calendar, Drive)

Nel tenant: **Connessioni → Google → Collega**. Servono Client ID e Client Secret di un client OAuth
"Applicazione web" in Google Cloud, con questo URI di reindirizzamento autorizzato:

```
https://<slug>.platform-core.it/api/integrazioni/google/oauth/callback
```

Se l'app OAuth è in stato **Testing**, i token scadono dopo 7 giorni e solo gli utenti di prova possono
accedere (errore `403 access_denied`, oppure `invalid_grant` sui token vecchi). Per l'uso personale: in
Google Cloud → Google Auth Platform → Pubblico, passa l'app a **In produzione**; al consenso Google avvisa
"app non verificata" e si prosegue da Avanzate.

### WhatsApp (CallMeBot)

Connessioni → WhatsApp (CallMeBot), con la API key ottenuta scrivendo al bot dal telefono.

## Utenti, accessi e 2FA

**Creare un utente** (lo fa l'admin del tenant): Impostazioni → Utenti & Ruoli → nuovo utente, con nome, nome utente, password e ruolo (*Utente* o *Admin*). Subito dopo, nella scheda dell'utente,
**"Moduli accessibili"**: spunta solo quelli che deve vedere (per Federica: Timbrature e Spese casa). **Se non si spunta nessun modulo l'utente vede tutto**, quindi la scelta va fatta subito.
Cosa vede un utente non admin:

| Cosa | Regola |
|---|---|
| Menu | Solo i moduli assegnati (più la dashboard) |
| Dashboard | Solo i widget senza restrizione; su Finance sono tutti solo admin, quindi la dashboard è vuota |
| Impostazioni, Builder, Libreria | Non le vede |
| Dati dei moduli | Secondo i permessi del modulo (blocco "Permessi" del Builder): Spese casa tutto, Spese personali solo le proprie righe |

**Attenzione:** la scelta dei moduli per utente nasconde i moduli dal menu ma **non blocca l'API**. Per un blocco vero si usano i permessi per ruolo dentro il modulo (Builder → Permessi).

**Attivare il 2FA** (ogni utente per sé, Impostazioni → Il mio account → Autenticazione a due fattori): *Attiva 2FA*, scansiona il QR con un'app authenticator (Google Authenticator, Authy…), inserisci il codice
a 6 cifre e **salva subito i codici di recupero**: si vedono una sola volta e ognuno vale una volta. Per disattivarlo serve la password. Se un utente perde l'authenticator e i codici, l'admin non può
sbloccarlo dall'app: va ripristinato dal database del tenant. Il Super Admin (admin.platform-core.it) ha lo stesso 2FA sul proprio account.

## Variabili d'ambiente di Super Admin

Elenco in [`.env.example`](../.env.example). Le obbligatorie sono `JWT_SECRET`, `INTERNAL_API_SECRET` e
`ENCRYPTION_KEY`. In produzione stanno in `deploy-secrets/super-admin-backend.env`; lo script di messa online
imposta in più solo `DB_PATH=/data/super-admin-01.db`.

Per l'assistente AI: la chiave Mistral si inserisce **per tenant** da Impostazioni → Assistente AI (`MISTRAL_API_KEY` è solo il
ripiego per i tenant che non ne hanno una), `AI_MONTHLY_BUDGET_EUR` (tetto mensile **per tenant**, di
default 10) e, se cambiano i prezzi, `AI_COST_PER_MTOK_INPUT_MISTRAL` / `AI_COST_PER_MTOK_OUTPUT_MISTRAL`
(di default 0,13 e 0,51 euro per milione di token). La spesa del mese si vede in Impostazioni → Assistente AI.

La password dell'utente `admin` di Super Admin, se manca `INITIAL_ADMIN_PASSWORD`, viene generata al primo
avvio su database vuoto e stampata **una sola volta** nel log (`docker logs super-admin-backend`). Se la perdi,
l'unico modo è reimpostarla direttamente nel database.

## Quando qualcosa non va

| Sintomo | Dove guardare |
|---|---|
| Il tenant "non si trova" nel browser | DNS: `dig +short <slug>.platform-core.it`. Vuoto → record mancante: dalla pagina Tenant, assegna di nuovo il dominio |
| Il tenant non parte | `docker logs platform-<slug>` e l'errore in Super Admin (colonna "fermo a:") |
| Un tenant mostra un errore dopo l'aggiornamento | Ricarica forzata (Cmd+Shift+R); poi `docker logs platform-<slug>` |
| `502` aprendo un allegato | Google non risponde o il token è scaduto: ricollega Google (vedi sopra) |
| Super Admin non risponde | `docker ps` per i 6 container; `docker logs super-admin-backend` |
| Il redeploy dice "Sessione attiva rilevata" (`finance -> saltato: active_session`) | Il tenant ha avuto un'azione negli ultimi 3 minuti (conta `last_active_at`, non il polling passivo). Chiudi le schede di Finance, anche sul telefono, aspetta 3 minuti e rilancia. Anche le chiamate API fatte a mano contano come attività. Per forzare: `POST /api/tenants/finance/redeploy {"force":true}` su Super Admin (la pagina aperta chiede di nuovo l'accesso) |
| Dopo il redeploy il tenant risponde `502` per qualche secondo | Normale: il container sta partendo. Aspetta la risposta 200 di `/api/tenant-info` prima di verificare |
| `redeploy-nas.sh` stampa `aggiornato` ma la vecchia versione è ancora lì | Controlla la riga del tenant: se è `saltato`, il codice nuovo è sul NAS ma il container non è stato ricreato |

Comandi utili (sul NAS: `/usr/local/bin/docker`):

```bash
docker ps -a --format '{{.Names}}\t{{.Status}}'
docker logs --tail 50 platform-finance
docker logs --tail 50 super-admin-backend
```

## Cose da sapere

- Mai committare `.env`, `*.db`, né il contenuto di `deploy-secrets/`.
- Prima di importare o correggere dati in un tenant, salva una copia dei record interessati (per Finance: `~/Desktop/platform-backup-nas/finance-prima-<cosa>-<data>.json`) e fai sempre una prova senza scrivere.
- Dopo ogni deploy di Finance verifica i numeri che contano (per esempio `/api/insights`) confrontandoli con quelli di prima: se il deploy è stato saltato il confronto non prova niente.
- Lo script `redeploy-nas.sh` si lancia solo con i test verdi (`cd core/backend && npm test`). Non concatenare i comandi con `;`: usa `&&`.
- Il Mac non è affidabile per costruire le immagini (Docker Desktop può bloccarsi scaricando le immagini base
  e produce arm64): si costruisce sul NAS, come fa `redeploy-nas.sh`.
- Un tenant si può tenere sul solo volume dati anche con il container fermo: i dati non dipendono dal container.
