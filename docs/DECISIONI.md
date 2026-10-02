# Registro delle decisioni

Cosa è stato tolto o deciso e perché, così tra un anno si sa perché una cosa non c'è. Ogni voce ha una data.

## 2026-10-02 — Platform riparte da 0.1

**Contesto.** Platform era diventata una piattaforma commerciale: livelli Core / Partner / Tenant, licenze,
fatturazione, marketplace dei moduli, verticali, CRM dei clienti, federazione tra istanze, app mobile. Il
bisogno vero era uno solo: gestire le proprie finanze (Finance). Dopo uno sguardo dal vivo a Super Admin è
emerso che il problema non erano le singole funzioni ma la direzione: troppa infrastruttura per tenant
ipotetici. Il vecchio repository (con tutta la storia) è stato archiviato come privato (`platform-old`) e il
lavoro riparte da questo, con il codice potato e la versione 0.1.0.

**Identità.** Platform è il coltello multiuso personale per i miei progetti, non un prodotto. Vedi
[`PLATFORM-VISIONE.md`](../PLATFORM-VISIONE.md).

**Regola contro l'eccesso.** Un pezzo nuovo entra solo se serve a un progetto reale che esiste oggi. "Potrebbe
servire a un tenant futuro" non è un motivo.

### Tolto

| Cosa | Perché |
|---|---|
| Partner, billing, licenze, prezzi, CRM dei clienti, fatture, supporto commerciale | Nessun cliente, nessun rivenditore: erano costi di manutenzione senza uso |
| Verticali (modelli di tenant per settore) | Erano template commerciali; un tenant nuovo si costruisce o si riempie dalla Libreria |
| Marketplace dei moduli: certificazione, autore, vendor, categorie, "in evidenza", screenshot, ciclo di vita, visibilità privata/pubblica, anteprima | Sono funzioni per un ente che approva moduli di terzi; qui c'è un solo autore. Sostituito dalla **Libreria** |
| Federazione tra istanze (pairing, tenant esterni, migrazione verso altri server, import/export delle immagini) | Pensata per più "core" che si agganciano; non esiste più quella visione |
| App mobile (SwiftUI e Capacitor iOS/Android), modalità offline e sincronizzazione, stampa Bluetooth | Nessun uso; avevano reso `api.js` e `useApi.js` più complicati |
| Raccomandazioni e misurazioni da "analisi clienti" | Nate dal CRM dei clienti |
| Tour guidato al primo accesso | Non serve a chi ha costruito il sistema |
| Invito di un "cliente" via email e creazione utente dal link | Un solo operatore: gli utenti si creano a mano |
| Integrazioni non usate (Fatture in Cloud, WhatsApp Business, Slack, Stripe, Mailchimp, Resend) dall'elenco | Restano visibili solo Google e WhatsApp (CallMeBot), le uniche usate. Ricompare un'integrazione se un modulo installato la richiede |
| Password admin fissa scritta nel codice | Sostituita da una password casuale (o da variabile d'ambiente) |
| ~25 colonne commerciali di `tenants`, ~20 tabelle inerti, la storia di migrazioni di `db.js` | Il database di Super Admin riparte da uno schema pulito di 12 tabelle |

### Tenuto, anche se "non serve oggi"

| Cosa | Perché |
|---|---|
| **Sito Web** (page builder del tenant) | È lavoro già fatto e testato che potrebbe servire; resta isolato e **spento di default** (`site_enabled = 0`). Unica eccezione alla regola sopra |
| **Super Builder / Builder** | È il pezzo di maggior valore: dove nascono i moduli |
| **Dominio pubblico automatico** (Cloudflare + nginx) | Un tenant nuovo deve essere raggiungibile subito |
| **Statistiche tra tenant** e **API interna tra Super Admin e tenant** | Base per far "interrogare" più tenant tra loro |
| **Update Manager** (stato, aggiornamento, rollback dell'immagine core) | Serve a distribuire una nuova versione del codice ai tenant |
| **Backup, export, ripristino, 2FA** | Dati finanziari reali |

### Cambiato

| Prima | Dopo |
|---|---|
| "Store" / "Registro" con wizard di pubblicazione e installazione | **Libreria**: salvi un modulo da un tenant (nasce una versione), lo installi in un altro tenant come **copia**, e il tenant vede "Aggiorna" quando esce una versione nuova |
| Dettaglio modulo con 8 schede (Panoramica, Versioni, Campi, Relazioni, Workflow, Permessi, Guida, Certificazione) | 3 schede: **Panoramica, Struttura, Versioni** |
| Pagina Store nei tenant con tab, settori, categorie, copertine | **Libreria** a due sezioni, Installati e Disponibili |
| Pulsante "Installa" nel tenant che andava in errore (`setLicenseKey` non esisteva più) | Corretto |

### Difetti trovati e corretti durante la potatura

- **Sottodomini mai creati**: `createTenant` chiamava `upsertSubdomain(autoDomainLabel)`, una variabile mai
  definita (già nel codice originale). L'errore finiva solo nel registro attività. Corretto, con test e con un
  avviso visibile in Super Admin.
- **Segreti nelle API**: l'elenco dei tenant restituiva `encryption_key`, `jwt_secret` e le credenziali offsite
  del backup. Ora vengono tolti, con un test.

### Da fare

- Piano AI con Mistral per Finance: smistamento delle bollette, lettura dei PDF, commento ai report e alla
  reportistica, con tetto di spesa mensile. Predisposto, da costruire.
- Backup su un dispositivo diverso dal NAS.
