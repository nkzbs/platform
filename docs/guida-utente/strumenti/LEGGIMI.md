# Come si rifà la guida illustrata in PDF

La guida (`../Guida-illustrata.pdf`) si genera da schermate vere di un ambiente locale di prova. Per aggiornarla dopo una nuova versione:

1. Fai partire in locale backend e frontend del core (le due voci di `.claude/launch.json`: `core-backend` e `core-frontend`), con un database vuoto (`/tmp/platform-core-dev.db`).
2. `node seed.mjs` crea i moduli e installa il pacchetto; `node dati.mjs` e `node widgets.mjs` caricano i dati di esempio e i riquadri della Dashboard. Collega OpenAPI.it con una chiave finta in prova (`PUT /api/connections/openapi_it/credentials`, poi `POST .../toggle`) per far comparire il suo pannello.
3. `node s-tutto.mjs <sezione>` scatta le schermate (sezioni: dashboard, giro, base, clienti, immobili, servizi, attivita, trattative, provvigioni, altri, impostazioni, notifiche, casella) `node s-posta.mjs` quelle di Connessioni (posta in uscita) e Messaggi ai clienti, e `node s-mobile.mjs` quelle da telefono. Serve Google Chrome. Il server limita gli accessi: lo script ne fa uno solo e lo salva in `/tmp/guida-login.json`.
4. Riduci le schermate in `small/` (larghezza 1300, telefono 520) e scrivi i testi in `cap.js` (capitoli per modulo) e `lavoro.js` (la parte «Come si lavora»: relazioni, vendita dall'inizio alla fine, Dashboard, giornate tipo; lo schema delle relazioni si disegna in `gen.js`).
5. `node gen.js` scrive il PDF con l'identità grafica comune dei PDF (lib/identita-pdf.js).

Le schermate e i file intermedi (`shots/`, `small/`) non si conservano nel repository.
