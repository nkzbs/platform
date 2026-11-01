'use strict';
// Scheda Immobile — testo riepilogativo di tutti i dati raccolti nel sopralluogo, da mostrare
// in anteprima (modificabile) e poi inviare al proprietario per farselo rinviare firmato
// (vedi routes/records.js). A differenza dei documenti Cliente (doc-cliente.js, che il
// cliente compila lui stesso), qui i dati li ha già inseriti l'agente nel record: la scheda
// riporta quello che c'è, lascia "—" dove manca — non inventa né obbliga a compilare tutto
// prima di poterla generare.
const SEZIONI = [
  { titolo: 'Dati identificativi', campi: [['titolo', 'Titolo annuncio'], ['tipologia', 'Tipologia'], ['superficie_mq', 'Superficie (mq)'], ['stato_edificio', 'Stato edificio']] },
  { titolo: 'Localizzazione', campi: [['indirizzo', 'Indirizzo'], ['numero_civico', 'Numero civico'], ['interno', 'Interno'], ['cap', 'CAP'], ['comune', 'Comune'], ['provincia', 'Provincia'], ['zona_quartiere', 'Zona/quartiere'], ['localita', 'Località'], ['piano', 'Piano'], ['piani_totali', 'Piani totali edificio'], ['contesto_stabile', 'Contesto stabile'], ['anno_costruzione', 'Anno costruzione'], ['anno_ristrutturazione', 'Anno ristrutturazione'], ['numero_unita_condominio', 'Numero unità condominio'], ['ascensore', 'Ascensore'], ['portineria', 'Portineria'], ['assenza_barriere_architettoniche', 'Assenza barriere architettoniche']] },
  { titolo: 'Caratteristiche interne', campi: [['totale_vani', 'Totale vani'], ['composizione_vani', 'Composizione vani'], ['numero_camere', 'Numero camere'], ['numero_bagni', 'Numero bagni'], ['sfogo_esterno', 'Sfogo esterno'], ['giardino', 'Giardino'], ['superficie_giardino_mq', 'Superficie giardino (mq)'], ['pertinenze_box', 'Pertinenze e box'], ['posto_auto', 'Posto auto'], ['numero_posti_auto', 'Numero posti auto']] },
  { titolo: 'Serramenti, finiture, isolamento', campi: [['infissi_materiale', 'Infissi'], ['tipo_vetri', 'Vetri'], ['oscuranti_protezioni', 'Oscuranti e protezioni'], ['pavimenti', 'Pavimenti'], ['cappotto_termico', 'Cappotto termico'], ['isolamento_acustico', 'Isolamento acustico'], ['vmc', 'VMC']] },
  { titolo: 'Impianti e certificazione energetica', campi: [['riscaldamento', 'Riscaldamento'], ['tipologia_diffusione_riscaldamento', 'Diffusione riscaldamento'], ['alimentazione_riscaldamento', 'Alimentazione'], ['accessori_impianti', 'Accessori impianti'], ['fotovoltaico_presente', 'Fotovoltaico'], ['fotovoltaico_kw', 'Fotovoltaico — kW'], ['batteria_accumulo', 'Batteria di accumulo'], ['solare_termico', 'Solare termico'], ['stato_impianto_elettrico', 'Impianto elettrico'], ['stato_impianto_idraulico', 'Impianto idraulico'], ['fognatura', 'Fognatura'], ['classe_energetica', 'Classe energetica'], ['agibilita', 'Agibilità']] },
  { titolo: 'Dati catastali e documenti', campi: [['foglio_catastale', 'Foglio'], ['particella_catastale', 'Particella'], ['subalterno_catastale', 'Subalterno'], ['categoria_catastale', 'Categoria'], ['rendita_catastale', 'Rendita catastale'], ['planimetria_conforme', 'Planimetria conforme'], ['documenti_disponibili', 'Documenti disponibili']] },
  { titolo: 'Spese condominiali e mutuo', campi: [['spese_condominiali_importo', 'Spese condominiali'], ['spese_condominiali_periodicita', 'Periodicità'], ['spese_condominiali_comprende', 'Comprendono'], ['spese_deliberate', 'Spese deliberate'], ['residuo_mutuo', 'Residuo mutuo'], ['residuo_mutuo_importo', 'Importo residuo'], ['ipoteche_vincoli', 'Ipoteche/vincoli']] },
  { titolo: 'Valutazione economica e incarico', campi: [['prezzo_richiesto', 'Prezzo richiesto dal proprietario'], ['valutazione_agente', 'Valutazione agente/agenzia'], ['tipologia_incarico', 'Tipologia incarico'], ['durata_incarico', 'Durata incarico'], ['provvigione_accordata', 'Provvigione accordata']] },
  { titolo: 'Esigenze di riacquisto', campi: [['riacquisto_tipologia', 'Tipologia cercata'], ['riacquisto_budget_max', 'Budget massimo'], ['riacquisto_zona', 'Zona/città'], ['riacquisto_caratteristiche', 'Caratteristiche richieste']] },
];

function fmt(v) {
  if (v === true) return 'Sì';
  if (v === false) return 'No';
  if (v == null || v === '') return '—';
  return String(v);
}

function schedaImmobile(immobile, proprietarioNome, tenant) {
  const agenzia = (tenant && tenant.ragione_sociale) || "l'agenzia";
  const oggi = new Date().toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });

  const corpo = `SCHEDA VALUTAZIONE — ACQUISIZIONE IMMOBILE

${agenzia}
Data sopralluogo: ${oggi}
Proprietario: ${proprietarioNome || '—'}

` + SEZIONI.map((s) => s.titolo.toUpperCase() + '\n' + s.campi.map(([k, l]) => l + ': ' + fmt(immobile[k])).join('\n')).join('\n\n') + `

NOTE
${fmt(immobile.note)}

Il sottoscritto proprietario dichiara che i dati sopra riportati corrispondono allo stato reale dell'immobile e conferisce incarico di mediazione a ${agenzia} alle condizioni concordate.

Data: ${oggi}
Firma proprietario: ___________________________
Firma agente: ___________________________`;

  return { oggetto: 'Scheda immobile da verificare e firmare — ' + (immobile.titolo || 'immobile'), corpo };
}

module.exports = { schedaImmobile };
