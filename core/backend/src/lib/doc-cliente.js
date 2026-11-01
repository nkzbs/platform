'use strict';
// Testo dell'informativa Privacy (GDPR) + modulo di incarico per un cliente — mostrato
// all'admin per revisione/modifica PRIMA dell'invio (mai mandato senza controllo umano, vedi
// routes/records.js), poi spedito via email con lib/email.js. Testo generico, personalizzato
// solo coi dati del tenant già in tenant_settings (ragione_sociale/indirizzo/piva) — nessun
// nome d'agenzia scritto nel codice (feedback_always_generic_configurable).
function informativaPrivacyIncarico(cliente, tenant) {
  const agenzia = (tenant && tenant.ragione_sociale) || "l'agenzia";
  const piva = tenant && tenant.piva ? ' (P.IVA ' + tenant.piva + ')' : '';
  const indirizzo = tenant && tenant.indirizzo ? ', ' + tenant.indirizzo : '';
  const oggi = new Date().toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
  const tipo = cliente.tipo_cliente || '';

  const corpo = `INFORMATIVA PRIVACY (GDPR) E MODULO DI INCARICO

${agenzia}${piva}${indirizzo}
${oggi}

Gentile ${cliente.nome || ''},

ai sensi del Regolamento Europeo (UE) 2016/679 (GDPR) e della normativa nazionale vigente, i Suoi dati personali saranno oggetto di trattamento da parte di ${agenzia} in qualità di Titolare del Trattamento.

Finalità: i dati sono raccolti per l'adempimento delle attività connesse all'incarico di mediazione${tipo ? ' (' + tipo.toLowerCase() + ')' : ''}, valutazione e promozione commerciale, per l'inserimento nelle banche dati aziendali, per obblighi contrattuali, fiscali e antiriciclaggio (D.Lgs. 231/2007).

Conservazione: i dati saranno conservati in modalità cartacea ed informatica protetta per la durata dell'incarico e successivamente per i tempi prescritti dalla legge (10 anni).

Diffusione e comunicazione: i dati necessari potranno essere diffusi tramite canali pubblicitari, portali immobiliari e comunicati a potenziali controparti, tecnici o notai, nei limiti di quanto necessario all'incarico.

Il sottoscritto dichiara di aver ricevuto l'informativa completa e presta libero consenso al trattamento e diffusione controllata dei dati.

Con la firma del presente modulo, il cliente conferisce inoltre incarico a ${agenzia} per le attività di mediazione immobiliare relative al presente rapporto.

Data: ${oggi}
Firma cliente: ___________________________
Firma agente: ___________________________`;

  return { oggetto: 'Documenti da firmare — ' + (cliente.nome || 'cliente'), corpo };
}

// Modulo di Adeguata Verifica della Clientela (antiriciclaggio, D.Lgs. 231/2007) — stesso
// principio del Privacy+Incarico: prefilled coi dati già noti dal record Cliente, il resto
// (TAE, PEP, origine fondi, cittadinanze) lasciato da compilare a mano dal cliente, perché
// sono domande con risposte proprie del cliente, non deducibili dal suo record in Platform.
// Non riproduce le tabelle di riferimento del modulo originale (elenco paesi a rischio,
// codici TAE): sono tabelle di consultazione, citate per nome, non il contenuto di questo
// documento — il cliente le compila con l'assistenza dell'agente, come nel modulo cartaceo.
function informativaAntiriciclaggio(cliente, tenant) {
  const agenzia = (tenant && tenant.ragione_sociale) || "l'agenzia";
  const oggi = new Date().toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
  const riga = (etichetta, valore) => etichetta + ': ' + (valore || '___________________________');

  const corpo = `MODULO DI ADEGUATA VERIFICA DELLA CLIENTELA (D.Lgs. 231/2007 e successive modifiche)

${agenzia}
${oggi}

Gentile ${cliente.nome || ''},

ai fini dell'incarico di mediazione immobiliare, la normativa antiriciclaggio ci richiede di raccogliere le informazioni seguenti prima di procedere. La preghiamo di completare le parti mancanti e restituire il modulo firmato.

DATI DI IDENTIFICAZIONE DEL CLIENTE
${riga('Cognome e Nome', cliente.nome)}
${riga('Codice Fiscale / P.IVA', cliente.codice_fiscale_piva)}
Paese e luogo di nascita: ___________________________
Data di nascita: ___________________________
${riga('Indirizzo', cliente.indirizzo)}
Comune, provincia, CAP: ___________________________
Paese di residenza e nazionalità: ___________________________
Possiede più di una cittadinanza? ☐ No ☐ Sì — quali: ___________________________
Svolge la maggior parte della Sua attività/vita privata in un luogo diverso dalla residenza? ☐ No ☐ Sì — dove: ___________________________

DOCUMENTO DI IDENTIFICAZIONE
Tipo (carta d'identità / altro): ___________________________
Numero, rilasciato da, data rilascio e scadenza: ___________________________

TITOLARE EFFETTIVO E DELEGHE
Esiste un titolare effettivo diverso dal cliente? ☐ No ☐ Sì — nominativo: ___________________________
Sono presenti soggetti delegati ad operare? ☐ No ☐ Sì — nominativo: ___________________________

SITUAZIONE PERSONALE E PROFESSIONALE
Stato civile: ___________________________
Livello di istruzione: ___________________________
Settore professionale (codice TAE, vedi tabella allegata dall'agenzia): ___________________________
Da quanti anni esercita l'attuale professione: ___________________________
L'attività comporta la gestione di fondi pubblici? ☐ No ☐ Sì, marginale ☐ Sì, componente importante
Dove svolge prevalentemente l'attività economica: ___________________________

PERSONA POLITICAMENTE ESPOSTA (PEP)
È, o è stato nell'ultimo anno, una Persona Politicamente Esposta o le è equiparato (titolare di altre cariche pubbliche, familiare stretto o persona nota per stretti rapporti con una PEP)? ☐ No ☐ Sì — specificare: ___________________________

NATURA, FINALITÀ DEL RAPPORTO E ORIGINE DEI FONDI
Reddito annuo imponibile: ___________________________
Fonte principale del reddito (lavoro dipendente/autonomo, impresa, immobili/investimenti, nessun reddito): ___________________________
Ha mai partecipato a operazioni di rimpatrio o regolarizzazione di attività finanziarie (scudo fiscale, voluntary disclosure)? ☐ No ☐ Sì — quale: ___________________________
Principale origine dei fondi (lavoro, risparmio, vendita beni/strumenti finanziari, eredità/donazione, altro): ___________________________
Paese di origine dei fondi: ___________________________
Finalità dell'operazione: ___________________________

Il/La sottoscritto/a dichiara di essere consapevole delle sanzioni penali previste in caso di dichiarazioni mendaci o comunque non veritiere ai sensi della vigente normativa antiriciclaggio (art. 22 del D.Lgs. 231/2007), nonché delle conseguenze derivanti dall'eventuale rifiuto di fornire le ulteriori informazioni richieste.

Data e luogo: ___________________________
Firma del cliente: ___________________________`;

  return { oggetto: 'Modulo antiriciclaggio da compilare e firmare — ' + (cliente.nome || 'cliente'), corpo };
}

function htmlDaTesto(testo) {
  const righe = String(testo || '').split('\n').map((r) => r.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
  return '<div style="font-family:system-ui,-apple-system,sans-serif;color:#1c1917;white-space:pre-wrap;line-height:1.6;max-width:640px">' + righe.join('<br>') + '</div>';
}

module.exports = { informativaPrivacyIncarico, informativaAntiriciclaggio, htmlDaTesto };
