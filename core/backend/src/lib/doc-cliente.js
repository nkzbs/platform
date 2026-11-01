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

function htmlDaTesto(testo) {
  const righe = String(testo || '').split('\n').map((r) => r.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
  return '<div style="font-family:system-ui,-apple-system,sans-serif;color:#1c1917;white-space:pre-wrap;line-height:1.6;max-width:640px">' + righe.join('<br>') + '</div>';
}

module.exports = { informativaPrivacyIncarico, htmlDaTesto };
