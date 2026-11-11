# Costi di OpenAPI.it per il verticale Mediazione immobiliare

Stima dell'8 novembre 2026. I prezzi sono **di listino, IVA esclusa**, letti dalle pagine pubbliche di OpenAPI (cercate e lette l'8/11; alcune pagine si contraddicono tra loro, dove succede è scritto). **Non sostituiscono il listino del tuo account**: vanno controllati nella console di OpenAPI prima di impegnarsi, e si scrivono in Impostazioni → Connessioni → OpenAPI.it → «Prezzi» così il registro delle spese di Platform li usa. Dove un prezzo non l'ho trovato c'è scritto «n.d.»: non è stato inventato.

## Per passare dalla prova alla produzione

1. **Nella console di OpenAPI**: attiva i servizi che servono (vedi sotto) e crea la chiave di produzione. La chiave di prova e quella di produzione sono di norma due cose diverse (da verificare nella tua console).
2. **In Platform** (Impostazioni → Connessioni → OpenAPI.it): scrivi email e **chiave di produzione**, cambia l'ambiente da «prova» a «produzione», premi «Controlla i servizi», imposta un **tetto di spesa mensile** e i prezzi.
3. **Quello che oggi funziona subito**: valutazione di mercato (Real Estate), annunci comparabili, OMI, ricerca imprese. Per queste basta il passo 1 e 2.
4. **Verifica del soggetto e solvibilità, credit score società e controllo catastale** sono già collegati (versione 0.4.76): restano tra «Altre funzioni» finché la chiave non è abilitata al servizio e **passano da sole tra i pulsanti appena lo è** (il controllo si ricorda per 10 minuti: dopo l'attivazione servono al massimo 10 minuti). Firma elettronica e PEC restano «da attivare» (adattatore da scrivere); le fatture useranno Fatture in Cloud. Il sandbox di OpenAPI è gratuito.

## Prezzi unitari per azione

| Azione in Platform | Servizio OpenAPI | Prezzo unitario (€ + IVA) | Note |
|---|---|---|---|
| **Valutazione di mercato** (pulsante sull'immobile) | Valutazione avanzata €/mq (Advanced Quotation) | **3,00** singola; a scaglioni annui 2,50 (300 chiamate), 1,00 (1.000), 0,79 (5.000), 0,67 (10.000), 0,39 (50.000) | Dalla pagina prodotto (8/11): una pagina di ricerca indicava «da 0,05», che non coincide: vale il prezzo di listino, da confermare nella console. Il servizio «Start» (solo 3 valori al mq) costa da 2,00 a 0,26 |
| ↳ annunci comparabili | Real Estate Comparables | 0,12 singola; 0,09 → 0,032 a scaglioni annui (1.000 → 100.000 chiamate); **30 gratis al mese** | Scaglioni annuali da pagare in anticipo |
| ↳ quotazioni OMI | OMI Real Estate Quotations | 0,02 dopo **1.440 gratis al giorno** | Di fatto gratuita per un'agenzia |
| ↳ fotovoltaico, zona sismica, mappa, luoghi vicini | PVGIS, ISPRA, OpenStreetMap | 0 | Non passano da OpenAPI |
| **Ricerca imprese** (clienti società) | Visure camerali, ricerca | 0 | Senza costi di ricerca |
| **Visura camerale** (società, quote societarie) | Visure Camerali | n.d. (indicativo 2,90 per impresa individuale ordinaria/storica, da confermare) | Il listino vero si legge dall'endpoint `GET /documents` della tua console |
| **Verifica codice fiscale** | Risk · Person | da 0,0081 | Pochi secondi |
| **Verifica eventi negativi** (protesti, procedure) | Risk · Person | da 0,054; protesti 0,90; protesti e atti pregiudizievoli 3,70; con procedure concorsuali 3,90 | |
| **Dati anagrafici incrociati** (Personal Data Check) | Risk · Person | 0,80 | In 2 ore lavorative |
| **Person Report** (rischio, negatività, cariche, partecipazioni, immobili) | Risk · Person | da 3,10 | Da 10 minuti |
| **Top Person Report** (recuperabilità del credito, residenza, lavoro) | Risk · Person | 18,00 | 10 giorni lavorativi |
| **Personal Asset Report** (rapporti bancari, partecipazioni) | Risk · Person | 36,00 | 10 giorni lavorativi |
| **Centrale dei Rischi Banca d'Italia** | Risk · Person | 17,50 | 15-30 giorni |
| **Credit score società: Start** (semaforo 3 classi) | Risk · Company | 0,06 | |
| **Credit score società: Advanced** (rating e fido) | Risk · Company | 0,15 | |
| **Credit score società: Top** (oltre 200 dati) | Risk · Company | 0,42 (openapi.com) oppure 1,10 (openapi.it) | Le due pagine si contraddicono: da chiarire |
| **Controllo dati catastali**: cerca indirizzo | Catasto | 0,10 | Dai prezzi già nel registro di Platform |
| ↳ foglio, particella, richiesta | Catasto | 0,30 l'uno (0,08 con abbonamento) | «Richiesta» (POST /richiesta) confermata dalla console di OpenAPI l'11 novembre 2026 |
| ↳ estratto di mappa, elaborato planimetrico, dettaglio nota | Catasto | 6,90 | |
| ↳ elenco delle note | Catasto | 10,90 | |
| ↳ immobili di una persona dal codice fiscale | Catasto (ispezione nazionale) | 23,70 | |
| ↳ **letture gratuite** del Catasto (territorio, richiesta, visura, ipotecarie, estratto di mappa, elaborato, monitoraggio) | Catasto | **0,001** a richiesta | Non sono a zero: il controllo dell'esito di una ricerca costa un millesimo di euro (Platform le conta 0) |
| ↳ visura catastale (immobile / soggetto) | Catasto | 1,90 l'una (visura immobile 0,39 con abbonamento) | Letti dalla console di OpenAPI l'11 novembre 2026 |
| ↳ monitoraggio (prospetto catastale, ricerca persona, ricerca nazionale) | Catasto | 0,60 l'uno | Idem |
| **Fattura elettronica** (provvigioni) | **Fatture in Cloud** (non OpenAPI) | secondo il tuo piano di Fatture in Cloud | Decisione dell'8/11: le fatture si emettono con Fatture in Cloud; il servizio SDI di OpenAPI non serve e non va attivato. Per confronto, listino SDI di OpenAPI (console, 11/11/2026): fattura IT emessa o ricevuta **0,049** (emesse 0,0135 con abbonamento), configurazione azienda 1,00, punto vendita 9,00, importazione fatture 0,049, scontrini 0,019 (0,009), corrispettivi 0,013 (0,0034); Francia 0,27 (0,051) e 0,09; Germania 0,09; altri paesi 0,09 e 0,001 |
| **Firma elettronica semplice** (preliminare, privacy e incarico: codice per mail o SMS) | eSignature · EU-SES | **0,49 a richiesta** (0,09 con un abbonamento) | Letto dalla console l'11 novembre 2026. È a **richiesta**, non a firmatario: il pacchetto di documenti di «Invia per la firma» è UNA richiesta. In più la marca temporale facoltativa (0,15), che Platform non chiede |
| ↳ firma avanzata (AES) / con prova di vita | eSignature | 1,20 (0,69 con abbonamento) / 1,38 (0,79) | Non usate da Platform |
| ↳ firma qualificata con OTP / automatica / sigillo | eSignature · EU-QES | 0,025 (0,0065 con abbonamento) / 0,05 (0,013) | Non usate da Platform |
| ↳ certificati Namirial | eSignature | 29,00 (OTP) / 137,00 (automatico) | Non usati da Platform |
| ↳ letture e verifiche della firma | eSignature | 0,001 | Controllo dello stato, scaricamento, verifica |
| **SMS ai clienti** (auguri, invio di massa) | SMS v2 · SMS Italia | da 0,036 a segmento da 160 caratteri (listino «da»); sandbox gratuito | Serve un mittente (alias) registrato e approvato nella console. Il costo si registra in Platform per ogni SMS; ogni 160 caratteri è un segmento |
| **PEC** | PEC Massiva | 0,05 a messaggio + canone annuo (flat: 1.500 in offerta) | La PEC singola: n.d. |

Fonti: pagine prodotto di OpenAPI ([Person](https://openapi.com/products/crif-person-report), [Comparables](https://openapi.com/products/real-estate-valuation-comparables-italy), [Start Quotation](https://openapi.com/products/start-quotation-italian-properties), [OMI](https://openapi.com/products/omi-real-estate-quotations-italy), [Credit Scoring Start](https://openapi.com/products/credit-scoring-start-italy), [Credit Scoring Top](https://openapi.com/products/credit-scoring-top-italy), [SDI](https://console.openapi.com/apis/sdi/faq), [eSignature](https://openapi.it/en/digital-trust/esignature-API), [PEC Massiva](https://console.openapi.com/apis/pecmassiva/info)). Il catasto e il credit score start/advanced/top sono quelli già scritti nel registro delle spese di Platform.

## Quali azioni usano OpenAPI, processo per processo

| # | Processo analizzato | Cosa chiede a OpenAPI | Costo per pratica (€ + IVA) |
|---|---|---|---|
| 1 | Cliente: acquisizione e verifica | Persona fisica: verifica CF + eventi negativi + Person Report. Società: credit score + (facoltativa) visura | Persona: 0,0081 + 0,054 + 3,10 ≈ **3,16** (base) fino a +18 se serve il Top Person Report. Società: **0,06** (Start), con visura circa +2,90 |
| 2 | Cliente: società e cessione di quote | Visura camerale (soci, vigenza), credit score | **circa 3** (visura da confermare) + 0,06–0,42 |
| 3 | Immobile: scheda di acquisizione | Catasto: indirizzo, foglio, particella (+ estratto mappa) | **0,70** base; **7,60** con l'estratto di mappa |
| 4 | Valutazione dell'immobile | Valutazione avanzata + comparabili + OMI | **3,00 + 0,12 = circa 3,12** a singola richiesta (OMI gratis; i comparabili sono gratis le prime 30 al mese: **3,00**); con un abbonamento annuale la valutazione scende fino a 0,39 |
| 5 | Abbinamento domanda e offerta | Niente (calcolo interno) | 0 |
| 6 | Trattativa | Firma elettronica del preliminare (+ PEC se serve) | **0,49** a richiesta (0,09 con abbonamento), più 0,05 a PEC |
| 7 | Provvigioni | Fattura elettronica con Fatture in Cloud (non OpenAPI) | secondo il piano di Fatture in Cloud |
| 8 | Contatti e visite / Attività | Niente (avvisi in app); SMS solo se lo vorrai | 0 |
| 9-15 | Promemoria, post-vendita, GDPR, documenti, note, report | Niente | 0 |

Non passano da OpenAPI, e quindi non costano: mappa, luoghi vicini, fotovoltaico, zona sismica (servizi gratuiti), e l'analisi in parole delle considerazioni (usa l'AI, un conto a parte).

## Esempio di spesa mensile (illustrativo: sostituisci i numeri con i tuoi)

Ipotesi: un'agenzia con **20 valutazioni, 15 clienti persona, 5 clienti società, 20 immobili con controllo catastale, 6 trattative, 10 fatture** al mese, e 26 richieste di firma (6 preliminari + 20 pacchetti di privacy e incarico).

| Voce | Quantità | Unitario | Mese |
|---|---|---|---|
| Valutazioni: avanzata 3,00 + comparabili 0,12 (30 gratis al mese; OMI gratis) | 20 | 3,00–3,12 | **60,0–62,4** |
| Clienti persona: verifica CF + eventi negativi + Person Report | 15 | 3,16 | **47,4** |
| Clienti società: credit score Start | 5 | 0,06 | **0,3** |
| Catasto: indirizzo + foglio + particella | 20 | 0,70 | **14,0** |
| Catasto: estratto di mappa su 5 pratiche | 5 | 6,90 | **34,5** |
| Fatture elettroniche (solo se si usasse l'SDI di OpenAPI: invio, 0,049; con Fatture in Cloud è nel loro piano) | 10 | 0,049 | **0,5** |
| Richieste di firma elettronica | 26 | 0,49 (0,09 con abbonamento) | **12,7** (2,3 con abbonamento) |
| **Totale base** | | | **circa 170–175** |
| In più, se per 3 clienti al mese serve il Top Person Report (18,00) | 3 | 18,00 | **+54** |

Quindi **da circa 170 a 230 € al mese + IVA**, a seconda di quanto si approfondiscono i clienti e il catasto. Le voci che pesano sono la valutazione avanzata (3 € l'una a richiesta singola), le verifiche sulle persone e gli estratti catastali; il credit score delle società, le fatture e le firme costano pochi euro. Gli scaglioni annuali (pagati in anticipo) abbassano i prezzi delle chiamate frequenti (valutazione avanzata, comparabili, SDI), ma non quelli dei report a pezzo: con 20 valutazioni al mese (240 l'anno) conviene confrontare il prezzo a richiesta singola (3,00) con il piano da 300 chiamate (2,50 l'una, da pagare in anticipo).

## Regole d'uso di Platform che tengono la spesa sotto controllo

- **Tetto mensile** (Connessioni → OpenAPI.it): oltre il tetto le richieste si fermano.
- **Conferma del costo** prima di ogni richiesta a pagamento, con il prezzo noto o «prezzo non noto».
- **Registro delle spese** con la stima del mese; in prova le richieste si registrano ma non si pagano.
- **Consenso del cliente e parere del DPO** prima di verifiche sulle persone (dati personali, GDPR).
- **Si accende un servizio alla volta**, in sandbox, e si guarda la spesa del primo mese prima di aggiungerne un altro.
