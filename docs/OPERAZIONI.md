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

## Variabili d'ambiente di Super Admin

Elenco in [`.env.example`](../.env.example). Le obbligatorie sono `JWT_SECRET`, `INTERNAL_API_SECRET` e
`ENCRYPTION_KEY`. In produzione stanno in `deploy-secrets/super-admin-backend.env`; lo script di messa online
imposta in più solo `DB_PATH=/data/super-admin-01.db`.

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
| Il redeploy dice "Sessione attiva rilevata" | Qualcuno è collegato: aspetta 3 minuti e rilancia (mai forzare mentre si usa) |

Comandi utili (sul NAS: `/usr/local/bin/docker`):

```bash
docker ps -a --format '{{.Names}}\t{{.Status}}'
docker logs --tail 50 platform-finance
docker logs --tail 50 super-admin-backend
```

## Cose da sapere

- Mai committare `.env`, `*.db`, né il contenuto di `deploy-secrets/`.
- Il Mac non è affidabile per costruire le immagini (Docker Desktop può bloccarsi scaricando le immagini base
  e produce arm64): si costruisce sul NAS, come fa `redeploy-nas.sh`.
- Un tenant si può tenere sul solo volume dati anche con il container fermo: i dati non dipendono dal container.
