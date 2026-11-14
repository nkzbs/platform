#!/usr/bin/env node
'use strict';
// Genera, da UNA sola descrizione, le due cose che devono combaciare: i CAMPI del sistema (estensioni del pacchetto Mediazione immobiliare, con la loro sezione)
// e la MAPPA dei campi dei PDF compilabili dell'agenzia (moduli-pdf/*.json). Così un modulo compilato a mano si riporta nella scheda voce per voce, e viceversa.
// Si lancia a mano dopo aver cambiato un modulo o un campo:  node scripts/genera-mappe-moduli-pdf.js
// I campi dei PDF sono nominati «Campo testo N» (Illustrator): si identificano per ORDINE DI LETTURA (pagina, riga dall'alto, da sinistra). Se il PDF cambia nel
// numero o nell'ordine dei campi, la verifica sotto si ferma e il test modelli-pdf.test.js lo segnala.
const fs = require('fs'), path = require('path');
const { PDFDocument } = require(path.join(__dirname, '../core/backend/node_modules/pdf-lib'));
const PAC = path.join(__dirname, '../super-admin/backend/src/pacchetti/mediazione-immobiliare/');
const D = PAC + 'moduli-pdf/';

async function ordinati(f) {
  const d = await PDFDocument.load(fs.readFileSync(D + f)); const pagine = d.getPages().map((p) => p.ref);
  const righe = d.getForm().getFields().map((fl) => { const w = fl.acroField.getWidgets()[0]; const r = w.getRectangle(); return { n: fl.getName(), p: pagine.findIndex((x) => x === w.P()) + 1, x: r.x, y: Math.round(r.y + r.height / 2) }; });
  righe.sort((a, b) => a.p - b.p || (Math.abs(b.y - a.y) > 6 ? b.y - a.y : a.x - b.x));
  return righe.map((r) => r.n);
}
const T = (t) => ({ t }), C = (c, v) => ({ c, v });
const tk = (k) => T(`{{${k}|vuoto}}`);
const SN = (k) => [C(k, 'Sì'), C(k, 'No')];
const NS = (k) => [C(k, 'No'), C(k, 'Sì')];
const scelte = (k, voci) => voci.map((v) => C(k, v));

// ── Campi nuovi del sistema ──────────────────────────────────────────────────────────────────────
const campi = { clienti: [], immobili: [] };
const F = (mod, sezione, key, label, type = 'text', options) => { campi[mod].push({ block_type: 'field', key, label, type, sezione, ...(options ? { options } : {}) }); return key; };
const SINO = ['Sì', 'No'];

// ── Adeguata verifica della clientela (Clienti) ──
const SA = 'Anagrafica', SR = 'Residenza e domicilio', SD = "Documento d'identità", ST = 'Titolare effettivo e deleghe', SP = 'Situazione personale', SPR = 'Professione', SPEP = 'PEP e cariche', SRR = 'Rapporto, reddito e fondi';
const cl = (...a) => F('clienti', ...a);
const paeseNascita = cl(SA, 'paese_nascita', 'Paese di nascita'), nazionalita = cl(SA, 'nazionalita', 'Nazionalità'), paeseRes = cl(SR, 'paese_residenza', 'Paese di residenza');
const cittMult = cl(SA, 'cittadinanza_multipla', 'Più di una cittadinanza?', 'select', SINO), cittPaesi = cl(SA, 'cittadinanze_paesi', 'Altre cittadinanze (Paesi)');
const resFisc = cl(SR, 'residenza_fiscale', 'Residenza fiscale');
const altrove = cl(SR, 'attivita_altrove', 'Attività o vita privata in luogo diverso dalla residenza?', 'select', SINO), domPaese = cl(SR, 'domicilio_paese', 'Domicilio — Paese');
const domInd = cl(SR, 'domicilio_indirizzo', 'Domicilio — indirizzo'), domCom = cl(SR, 'domicilio_comune', 'Domicilio — comune'), domProv = cl(SR, 'domicilio_provincia', 'Domicilio — provincia'), domCap = cl(SR, 'domicilio_cap', 'Domicilio — CAP');
const docTipo = cl(SD, 'documento_tipo', 'Tipo di documento', 'select', ["Carta d'identità", 'Altro']), docAltro = cl(SD, 'documento_altro', 'Altro documento (patente, passaporto…)');
const docNum = cl(SD, 'documento_numero', 'Numero del documento'), docEnte = cl(SD, 'documento_rilasciato_da', 'Rilasciato da'), docRil = cl(SD, 'documento_data_rilascio', 'Data di rilascio', 'date'), docSca = cl(SD, 'documento_scadenza', 'Data di scadenza', 'date');
const titEff = cl(ST, 'titolare_effettivo', 'Esiste un titolare effettivo diverso dal cliente?', 'select', ['No', 'Sì']), titEffNome = cl(ST, 'titolare_effettivo_nome', 'Titolare effettivo — nominativo');
const delegati = cl(ST, 'delegati', 'Sono presenti soggetti delegati ad operare?', 'select', ['No', 'Sì']), delegatiNome = cl(ST, 'delegati_nome', 'Delegati — nominativo');
const familiari = cl(SP, 'familiari_a_carico', 'Familiari a carico privi di reddito', 'select', ['No', 'Sì', 'Preferisco non rispondere']);
const istruzione = cl(SP, 'livello_istruzione', "Livello di istruzione", 'select', ['Laurea triennale o magistrale in economia, giurisprudenza o ingegneria', 'Licenza media', 'Laurea in altre discipline / diploma di scuola secondaria di secondo grado', 'Nessuno dei precedenti']);
const tae = cl(SPR, 'tae_codice', 'Codice TAE (tipo di attività economica)'), condizione = cl(SPR, 'condizione_professionale', 'Condizione professionale', 'select', ['Non occupato/a', 'Casalingo/a', 'Studente/ssa', 'Pensionato/a', 'Altra attività']);
const taePens = cl(SPR, 'pensionato_tae_precedente', 'Pensionato/a — TAE precedente'), altraAtt = cl(SPR, 'altra_attivita', 'Altra attività — descrizione');
const SETTORI_SX = ['Commercio all’ingrosso e al dettaglio di gioielli e/o pietre preziose', 'Attività di compro oro', 'Commercio di pellicce e articoli in pelle', 'Commercio di oggetti d’antiquariato / titolare di casa d’aste', 'Operatore nel settore del gioco d’azzardo e delle scommesse', 'Società/organizzazione operante nel settore sportivo', 'Produzione, fornitura o gestione di energia elettrica, gas o acqua', 'Gestione o produzione di impianti per calore o energia da fonti rinnovabili', 'Fornitura o vendita al dettaglio di medicinali e/o apparecchiature sanitarie', 'Industria chimica, petrolchimica o biotecnologica'];
const SETTORI_DX = ['Estrazione mineraria (cave, miniere, torbiere, pozzi)', 'Raccolta, gestione e smaltimento dei rifiuti', 'Commercio e produzione di armi e materiale bellico', 'Costruzione e ristrutturazione di edifici', 'Produzione di materiali da costruzione', 'Trasporto valori', 'Cambio valuta', 'Attività di trasferimento di denaro', 'Attività di consulenza', 'Attività di importazione/esportazione', 'Nessuna delle precedenti'];
const settori = cl(SPR, 'settori_a_rischio', 'Posizioni dirigenziali o settori a rischio', 'multiselect', [...SETTORI_SX, ...SETTORI_DX]);
const anni = cl(SPR, 'anni_professione', 'Da quanti anni esercita la professione', 'select', ['Meno di 1 anno', 'Tra 1 e 5 anni', 'Oltre 5 anni', 'Nessuna delle precedenti']), taePrec = cl(SPR, 'tae_precedente', 'TAE della professione precedente (se meno di 1 anno)');
const fondiPub = cl(SPR, 'fondi_pubblici', 'Gestione o uso di fondi pubblici', 'select', ['No', 'Sì, in misura marginale', 'Sì, costituiscono una componente importante del reddito']);
const sedeAtt = cl(SPR, 'sede_attivita', 'Dove svolge prevalentemente l’attività', 'select', ['In Italia, nella regione di residenza/domicilio', 'In Italia, in una regione diversa', 'All’estero, in paesi UE', 'All’estero, in paesi extra-UE', 'All’estero, in paesi extra-UE indicati nella nota 4']);
const pep = cl(SPEP, 'pep', 'Persona politicamente esposta (PEP)', 'select', ['No', 'Sì']), pepAltre = cl(SPEP, 'pep_altre_cariche', 'Titolare di altre cariche pubbliche (non PEP)', 'select', ['No', 'Sì']);
const pepFam = cl(SPEP, 'pep_familiare', 'Familiare stretto di una PEP o di un LIP', 'select', ['No', 'Sì']), pepRapp = cl(SPEP, 'pep_rapporti', 'Stretti rapporti finanziari con una PEP', 'select', ['No', 'Sì']);
const enteTipo = cl(SPEP, 'ente_tipo', 'Carica presso un ente: tipo di ente', 'select', ['Associazione', 'Fondazione', 'Società', 'Altro ente giuridico']), enteCarica = cl(SPEP, 'ente_carica', 'Carica prevalente', 'select', ['Amministratore', 'Revisore', 'Socio con influenza significativa', 'Altro']);
const enteSett = cl(SPEP, 'ente_settori_rischio', 'L’ente opera in uno dei settori a rischio?', 'select', ['No', 'Sì']), enteSede = cl(SPEP, 'ente_sede', 'Sede dell’ente', 'select', ['Italia/UE', 'Al di fuori dell’UE']);
const enteRapp = cl(SPEP, 'ente_rapporti', 'Paesi con cui l’ente intrattiene rapporti', 'select', ['Italia/UE', 'Al di fuori dell’UE']), enteContr = cl(SPEP, 'ente_contributi', 'L’ente riceve contributi pubblici o donazioni oltre 500.000 €?', 'select', ['No', 'Sì']);
const natura = cl(SRR, 'rapporto_natura', 'Natura del rapporto continuativo', 'multiselect', ['Rapporto amministrato', 'Rapporto gestito', 'Servizi alle imprese (specialist, nomad, M&A)', 'Consulenza in materia di investimenti', 'Consulenza di corporate finance']);
const finalita = cl(SRR, 'rapporto_finalita', 'Finalità del rapporto continuativo', 'multiselect', ['Trading', 'Risparmio', 'Consulenza in materia di investimenti', 'Consulenza di corporate finance']);
const reddito = cl(SRR, 'reddito_annuo', 'Reddito annuo imponibile', 'currency'), fonteRed = cl(SRR, 'fonte_reddito', 'Fonte principale del reddito', 'multiselect', ['Reddito da lavoro dipendente o pensione', 'Reddito da lavoro autonomo', 'Reddito da immobili / redditi da investimento', 'Reddito d’impresa', 'Nessun reddito']);
const rimpatrio = cl(SRR, 'rimpatrio_attivita', 'Operazioni di rimpatrio o regolarizzazione di attività all’estero', 'select', ['No', 'Scudo fiscale', 'Voluntary disclosure (collaborazione volontaria)', 'Altro']);
const fondiProv = cl(SRR, 'fondi_provenienza', 'Provenienza dei fondi', 'multiselect', ['Lavoro', 'Risparmio', 'Vendita di beni materiali', 'Vendita di strumenti finanziari', 'Vincite', 'Eredità', 'Donazione', 'Liquidità/titoli detenuti presso altro intermediario']);
const fondiOrig = cl(SRR, 'fondi_origine', 'Principale origine dei fondi', 'select', ['Banca/altro intermediario', 'Altri mezzi di pagamento']), fondiPaese = cl(SRR, 'fondi_paese', 'Paese di origine dei fondi', 'select', ['Italia/UE', 'Extra UE']);
const invFin = cl(SRR, 'investimento_finalita', 'Finalità dell’investimento', 'select', ['Ottenimento del visto per investitori in Italia', 'Altro']), invFinAltro = cl(SRR, 'investimento_finalita_altro', 'Finalità dell’investimento — altro');

const av = [tk('nome'), tk('codice_fiscale_piva'), tk(paeseNascita), tk('luogo_nascita'), tk('data_nascita'), T('{{#indirizzo}}{{indirizzo}}{{/indirizzo}}{{^indirizzo}}{{residenza|vuoto}}{{/indirizzo}}'), tk('comune'), tk('provincia'), tk('cap'), tk(paeseRes), tk(nazionalita),
  ...SN(cittMult), tk(cittPaesi), tk(resFisc), ...SN(altrove), tk(domPaese), tk(domInd), tk(domCom), tk(domProv), tk(domCap),
  C(docTipo, "Carta d'identità"), C(docTipo, 'Altro'), tk(docAltro), tk(docNum), tk(docEnte), tk(docRil), tk(docSca),
  ...NS(titEff), tk(titEffNome), ...NS(delegati), tk(delegatiNome),
  C('stato_civile', ['Coniugato/a', 'Unito/a civilmente']), C('stato_civile', ['Celibe / Nubile', 'Vedovo/a']), C('stato_civile', ['Separato/a', 'Divorziato/a']), null,
  ...scelte(familiari, ['No', 'Sì', 'Preferisco non rispondere']),
  C(istruzione, istruzione && 'Laurea triennale o magistrale in economia, giurisprudenza o ingegneria'), C(istruzione, 'Licenza media'), C(istruzione, 'Laurea in altre discipline / diploma di scuola secondaria di secondo grado'), C(istruzione, 'Nessuno dei precedenti'),
  tk(tae), ...scelte(condizione, ['Non occupato/a', 'Casalingo/a', 'Studente/ssa', 'Pensionato/a']), tk(taePens), C(condizione, 'Altra attività'), tk(altraAtt)];
// Istruzione: l'ordine di lettura è «sinistra alto, destra alto, sinistra basso, destra basso»: nell'array sopra è già così; ricontrolla qui se cambia il PDF.
// Settori a rischio: colonna sinistra (10) e colonna destra (11) si leggono per righe alternate dal PDF: nell'ordine di lettura
// sono 54 sx, 55 dx, 56 sx, 57 sx, 58 dx, 59 sx, 60 dx …: sotto l'ordine esatto dei 21 campi.
const ORD_SETTORI = ['sx0', 'dx0', 'sx1', 'sx2', 'dx1', 'sx3', 'dx2', 'sx4', 'dx3', 'sx5', 'dx4', 'sx6', 'dx5', 'sx7', 'dx6', 'dx7', 'sx8', 'dx8', 'dx9', 'sx9', 'dx10'];
for (const o of ORD_SETTORI) av.push(C(settori, (o[0] === 's' ? SETTORI_SX : SETTORI_DX)[Number(o.slice(2))]));
av.push(...scelte(anni, ['Meno di 1 anno', 'Tra 1 e 5 anni', 'Oltre 5 anni', 'Nessuna delle precedenti']), C(taePrec, '@pieno'), tk(taePrec), ...NS(fondiPub).slice(0, 0),
  ...scelte(fondiPub, ['No', 'Sì, in misura marginale', 'Sì, costituiscono una componente importante del reddito']),
  ...scelte(sedeAtt, ['In Italia, nella regione di residenza/domicilio', 'In Italia, in una regione diversa', 'All’estero, in paesi UE', 'All’estero, in paesi extra-UE', 'All’estero, in paesi extra-UE indicati nella nota 4']),
  ...NS(pep), ...NS(pepAltre), ...NS(pepFam), ...NS(pepRapp),
  ...scelte(enteTipo, ['Associazione', 'Fondazione', 'Società', 'Altro ente giuridico']), ...scelte(enteCarica, ['Amministratore', 'Revisore', 'Socio con influenza significativa', 'Altro']),
  ...NS(enteSett), ...scelte(enteSede, ['Italia/UE', 'Al di fuori dell’UE']), ...scelte(enteRapp, ['Italia/UE', 'Al di fuori dell’UE']), ...NS(enteContr),
  ...scelte(natura, ['Rapporto amministrato', 'Rapporto gestito', 'Servizi alle imprese (specialist, nomad, M&A)', 'Consulenza in materia di investimenti', 'Consulenza di corporate finance']),
  ...scelte(finalita, ['Trading', 'Risparmio', 'Consulenza in materia di investimenti', 'Consulenza di corporate finance']),
  tk(reddito), ...scelte(fonteRed, ['Reddito da lavoro dipendente o pensione', 'Reddito da lavoro autonomo', 'Reddito da immobili / redditi da investimento', 'Reddito d’impresa', 'Nessun reddito']),
  ...scelte(rimpatrio, ['No', 'Scudo fiscale', 'Voluntary disclosure (collaborazione volontaria)', 'Altro']),
  ...scelte(fondiProv, ['Lavoro', 'Risparmio', 'Vendita di beni materiali', 'Vendita di strumenti finanziari', 'Vincite', 'Eredità', 'Donazione', 'Liquidità/titoli detenuti presso altro intermediario']),
  ...scelte(fondiOrig, ['Banca/altro intermediario', 'Altri mezzi di pagamento']), ...scelte(fondiPaese, ['Italia/UE', 'Extra UE']),
  C(invFin, 'Ottenimento del visto per investitori in Italia'), C(invFin, 'Altro'), tk(invFinAltro), T('{{comune|vuoto}}, {{@oggi}}'));

// ── Contratto di incarico (Immobili) ──
const SC = 'Incarico di mediazione', im = (...a) => F('immobili', ...a);
const qualita = im(SC, 'mandante_qualita', 'Il mandante agisce come', 'select', ['Proprietario esclusivo', 'Comproprietario', 'Legale rappresentante']);
const occupazione = im(SC, 'stato_occupazione', 'Stato di occupazione', 'select', ['Libero al rogito', 'Occupato dalla proprietà', 'Locato']), locScad = im(SC, 'locazione_scadenza', 'Locazione — scadenza', 'date');
const epgl = im(SC, 'epgl_nren', 'EPgl,nren (kWh/mq anno)'), lettere = im(SC, 'prezzo_in_lettere', 'Prezzo in lettere'), caparra = im(SC, 'caparra_confirmatoria', 'Caparra confirmatoria', 'currency');
const validoFino = im(SC, 'incarico_valido_fino_al', 'Incarico valido fino al', 'date'), rinnovo = im(SC, 'incarico_rinnovo', 'Alla scadenza l’incarico', 'select', ['Cessato alla scadenza naturale', 'Rinnovato tacitamente']);
const rinnMesi = im(SC, 'incarico_rinnovo_mesi', 'Rinnovo tacito per (mesi)', 'number'), preavviso = im(SC, 'incarico_preavviso_giorni', 'Preavviso di disdetta (giorni)', 'number');
const contratto = [tk('proprietario.nome'), tk('proprietario.codice_fiscale_piva'), T('{{proprietario.data_nascita|vuoto}} {{proprietario.luogo_nascita|vuoto}}'), tk('proprietario.telefono'), tk('proprietario.residenza'),
  ...scelte(qualita, ['Proprietario esclusivo', 'Comproprietario', 'Legale rappresentante']),
  T('{{@azienda|vuoto}}'), T('{{@piva|vuoto}}'), T('{{@indirizzo|vuoto}}'), null, tk('agente_acquisitore'),
  T('{{indirizzo|vuoto}} {{numero_civico|vuoto}}, {{cap|vuoto}} {{comune|vuoto}} {{provincia|vuoto}}'), tk('foglio_catastale'), tk('particella_catastale'), tk('subalterno_catastale'), tk('categoria_catastale'), tk('rendita_catastale'),
  T('{{superficie_mq|vuoto}} mq, {{totale_vani|vuoto}} vani'), T('{{pertinenze_box|vuoto}}{{#garage_categoria}} Garage: Fg. {{garage_foglio|vuoto}} Part. {{garage_particella|vuoto}} Sub. {{garage_subalterno|vuoto}} Cat. {{garage_categoria}} Rendita € {{garage_rendita|vuoto}}.{{/garage_categoria}}{{#pertinenza_categoria}} Pertinenza: Fg. {{pertinenza_foglio|vuoto}} Part. {{pertinenza_particella|vuoto}} Sub. {{pertinenza_subalterno|vuoto}} Cat. {{pertinenza_categoria}} Rendita € {{pertinenza_rendita|vuoto}}.{{/pertinenza_categoria}}'), ...scelte(occupazione, ['Libero al rogito', 'Occupato dalla proprietà', 'Locato']), tk(locScad), tk('classe_energetica'), tk(epgl),
  tk('prezzo_richiesto'), tk(lettere), tk(caparra),
  tk(validoFino), C(rinnovo, 'Cessato alla scadenza naturale'), C(rinnovo, 'Rinnovato tacitamente'), tk(rinnMesi), tk(preavviso), C('tipologia_incarico', 'Esclusiva'), C('tipologia_incarico', 'Non esclusiva'), T('{{@oggi}}'), T('{{comune|vuoto}}')];

(async () => {
  const mappe = { 'adeguata-verifica-it': ['adeguata-verifica-it.pdf', av, 'Adeguata verifica della clientela'], 'adeguata-verifica-en': ['adeguata-verifica-en.pdf', av, 'Customer due diligence form'], 'contratto-incarico': ['contratto-incarico.pdf', contratto, 'Contratto di incarico di mediazione'] };
  for (const [nome, [pdf, spec, titolo]] of Object.entries(mappe)) {
    const nomi = await ordinati(pdf);
    if (spec.length !== nomi.length) throw new Error(`${pdf}: la descrizione ha ${spec.length} voci, il PDF ${nomi.length} campi`);
    const campiMappa = []; spec.forEach((s, i) => { if (!s) return; campiMappa.push({ campo: nomi[i], ...(s.t !== undefined ? { testo: s.t } : { chiave: s.c, valore: s.v }) }); });
    const vecchia = JSON.parse(fs.readFileSync(D + nome + '.json', 'utf8'));
    fs.writeFileSync(D + nome + '.json', JSON.stringify({ titolo, file: pdf, _nota: vecchia._nota, campi: campiMappa }, null, 1));
    console.log(nome, campiMappa.length, 'campi mappati su', nomi.length);
  }
  // Estensioni: una per modulo, sostituita se esiste già (idempotente). `sezione` sul campo: i campi nuovi nascono già nel loro gruppo anche sui tenant esistenti.
  const ep = PAC + 'estensioni.json', est = JSON.parse(fs.readFileSync(ep, 'utf8'));
  const metti = (mod, e) => { est[mod] = (est[mod] || []).filter((x) => x.key !== e.key); est[mod].push(e); };
  metti('clienti', { key: 'campi_adeguata_verifica', _nota: 'Tutte le voci del «Modulo di adeguata verifica della clientela» dell\'agenzia diventano campi del Clienti, raggruppati nelle stesse sezioni del modulo: se il cliente lo compila a mano, si riporta qui voce per voce (e il PDF si precompila dagli stessi campi). Generato da scripts/genera-mappe-moduli-pdf.js: non modificare a mano.', richiede: { clienti: ['nome'] }, aggiungi: campi.clienti });
  metti('immobili', { key: 'campi_contratto_incarico', _nota: 'Le voci del «Contratto di incarico di mediazione» che la scheda non aveva (qualità del mandante, stato di occupazione, EPgl,nren, prezzo in lettere, caparra, durata e rinnovo dell\'incarico). Generato da scripts/genera-mappe-moduli-pdf.js: non modificare a mano.', richiede: { immobili: ['indirizzo'] }, aggiungi: campi.immobili });
  fs.writeFileSync(ep, JSON.stringify(est, null, 2));
  console.log('campi nuovi: clienti', campi.clienti.length, 'immobili', campi.immobili.length);
})();
