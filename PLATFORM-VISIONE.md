# Platform — Visione

## Cos'è

Platform è il **coltello multiuso personale** di Nima per i suoi progetti. Nasce da un bisogno concreto, gestire
le proprie finanze, e Finance è la prova che funziona. Non è un prodotto per altri e non ha clienti.

Un progetto = un **tenant**. Ogni tenant è fatto di **moduli**, e i moduli migliori si riusano da un progetto
all'altro grazie alla **Libreria**.

## Le quattro parti

| Parte | Cos'è |
|---|---|
| **Tenant** | Un progetto (Finance, Timbrature, ...): un'istanza con i suoi dati (un database SQLite) e i suoi moduli |
| **Modulo** | Un attrezzo riutilizzabile, definito da uno schema: campi, relazioni, workflow, formule, automazioni |
| **Builder** | Il banco da lavoro dove si disegnano e si modificano i moduli. È il pezzo di maggior valore |
| **Libreria** | I miei moduli, con una versione. Installare un modulo in un tenant ne crea una **copia**: il tenant la modifica senza toccare gli altri e vede "disponibile la v2, aggiorna?" quando vuole |

**Super Admin** è l'officina che tiene insieme le parti: crea, avvia e ferma i tenant, assegna il dominio, fa i
backup, ospita Builder e Libreria. Nient'altro.

## Cosa non sarà mai

Partner, fatturazione, licenze, prezzi, marketplace, certificazione dei moduli, visibilità pubblico/privato,
verticali commerciali, utenti esterni o clienti, federazione tra istanze, app mobile, provisioning di tenant
ipotetici.

## La regola contro l'eccesso

> Un pezzo nuovo entra solo se serve a un progetto reale che esiste oggi.
> Se la motivazione è "potrebbe servire a un tenant futuro", non entra.

Le eccezioni si scrivono, con il motivo, in [`docs/DECISIONI.md`](docs/DECISIONI.md) (oggi: il Sito Web, già
fatto e testato, tenuto spento di default).

## Sempre generico e configurabile

Platform resta un motore generico: **nel codice non ci sono nomi di moduli, di campi, di stati o di categorie di nessun progetto**. Ciò che un progetto è e come si comporta lo dichiara il progetto, dal Builder (Ruoli del modulo, Avvisi, Estratto conto, formule, automazioni, permessi). Valori di partenza di un progetto esistente stanno solo in file di dati (`core/backend/src/seeds/`), mai nel codice.

- Prima di scrivere una funzione che «serve a Finance», si chiede: quale **primitiva** manca? Si costruisce quella, configurabile, e Finance la usa.
- Il test `no-hardcoded-names.test.js` fallisce se un nome di progetto entra nel codice del nucleo.
- Se una scelta non si può configurare dal Builder o dalle impostazioni, è un difetto da correggere, non una scorciatoia accettata.

## Documentazione

La documentazione è parte del prodotto, non un extra:

- **Pochi documenti, ognuno con un ruolo solo**: `README.md` (cos'è e come si avvia), questo file (perché),
  [`ARCHITETTURA.md`](ARCHITETTURA.md) (come è fatto), [`docs/OPERAZIONI.md`](docs/OPERAZIONI.md) (come si mette
  online e si mantiene), [`docs/DECISIONI.md`](docs/DECISIONI.md) (cosa è stato tolto e perché). Mai due file che
  dicono la stessa cosa.
- **Scritta insieme al codice**: una modifica che cambia il comportamento aggiorna il documento nello stesso
  commit. Un documento non verificabile con il codice non entra.
- **Una sola storia, non un diario**: niente log cronologici lunghi. Il "perché" delle scelte importanti sta
  in `docs/DECISIONI.md`; il resto lo dice `git log`.
- **Documentare anche ciò che si toglie**: ogni taglio lascia una riga nel registro delle decisioni.
