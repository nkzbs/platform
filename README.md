# Platform

Il coltello multiuso personale di Nima per i suoi progetti: un motore unico che, installando
moduli, diventa il gestionale di cui ho bisogno (oggi **Finance**, per le finanze personali).
Non è un prodotto per altri e non ha clienti. Versione **0.1.1**.

```
Tenant   un progetto (Finance, Timbrature, ...): un'istanza con i suoi dati e i suoi moduli
Modulo   un attrezzo riutilizzabile, definito da uno schema (campi, relazioni, workflow, automazioni)
Builder  il banco da lavoro dove si disegnano e si modificano i moduli
Libreria i miei moduli, con versione: installare = copiare in un tenant
```

Perché esiste, cosa non sarà mai e la regola che tiene fuori l'eccesso: [`PLATFORM-VISIONE.md`](PLATFORM-VISIONE.md).

## Documenti

| Documento | A cosa serve |
|---|---|
| [`PLATFORM-VISIONE.md`](PLATFORM-VISIONE.md) | Perché Platform esiste, cosa non sarà, le regole |
| [`ARCHITETTURA.md`](ARCHITETTURA.md) | Come è fatto: parti, flussi, dati, sicurezza |
| [`docs/OPERAZIONI.md`](docs/OPERAZIONI.md) | Mettere online, aggiornare, backup, ripristino, cosa fare se qualcosa non va |
| [`docs/DECISIONI.md`](docs/DECISIONI.md) | Cosa è stato tolto e perché (registro delle decisioni) |
| [`docs/NOTE-DI-RILASCIO.md`](docs/NOTE-DI-RILASCIO.md) | Cosa c'è in ogni versione, cosa è da verificare, cosa sapere |
| [`docs/TEST-FINANCE.md`](docs/TEST-FINANCE.md) | Lista di prove a mano per Finance: cosa fare e cosa deve succedere |

## Struttura

```
core/               il tenant: backend (Node + SQLite), frontend (React), Dockerfile
super-admin/        l'officina: backend, frontend, docker-provisioner
shared/             codice condiviso tra core e super-admin (schema dei moduli, rate limit, ...)
infra/nginx/        configurazione del router per dominio
scripts/            messa online sul NAS
docker-compose.yml  stack locale di Super Admin
```

## Provare in locale

Servono Docker e Node 22.

```bash
cp .env.example .env            # compila JWT_SECRET, INTERNAL_API_SECRET, ENCRYPTION_KEY
docker build -f core/Dockerfile -t platform-core:latest .
docker compose up --build       # Super Admin su http://localhost:4000
```

Al primo avvio Super Admin crea l'utente `admin`: la password è `INITIAL_ADMIN_PASSWORD` se la
imposti, altrimenti ne genera una casuale e la stampa **una volta sola** nel log
(`docker compose logs super-admin-backend`). I tenant si creano dall'interfaccia.

## Test

Ogni backend ha la sua suite, nessuna dipendenza esterna (i servizi esterni sono simulati):

```bash
cd core/backend && npm test            # 48 suite
cd super-admin/backend && npm test     # 21 suite
```

I frontend si verificano compilando: `cd core/frontend && npx vite build` (idem `super-admin/frontend`).

## Mettere online sul NAS

```bash
bash scripts/redeploy-nas.sh            # tutto: backend, frontend, core
bash scripts/redeploy-nas.sh core       # solo alcune parti
```

Costruisce le immagini sul NAS. Per ricreare i tenant lo script accede a Super Admin; con il 2FA attivo non può, e si ferma dicendolo: l'immagine è pronta e il tenant si aggiorna da Super Admin con il pulsante **Aggiorna** (popup di avanzamento). Dettagli in [`docs/OPERAZIONI.md`](docs/OPERAZIONI.md).

Dettagli, rollback e primo avvio in [`docs/OPERAZIONI.md`](docs/OPERAZIONI.md).
