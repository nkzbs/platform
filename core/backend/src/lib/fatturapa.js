'use strict';
// La FATTURA ELETTRONICA nel formato FatturaPA 1.2 (FPR12, fatture tra privati): costruzione dell'XML da dati già controllati. Funzione pura (nessun accesso a database o rete), con i controlli
// che evitano gli scarti più comuni dello SDI (partita IVA e codice fiscale validi, CAP di 5 cifre, importi che tornano). L'ordine degli elementi è quello dello schema: non va cambiato.
// Non fa il controllo completo contro lo schema XSD dell'Agenzia delle Entrate: lo SDI può comunque scartare una fattura, e il motivo arriva a chi preme il pulsante.
const { codiceFiscaleValido, partitaIvaValida } = require('../validazioni-campo');

// Lo schema accetta solo caratteri Basic Latin e Latin-1 (accenti italiani compresi): trattini lunghi, virgolette tipografiche, € e simili fanno scartare la fattura (visto validando l'XML con lo schema ufficiale).
const latin1 = (v) => String(v == null ? '' : v).replace(/[\u2012-\u2015\u2212]/g, '-').replace(/[\u2018\u2019\u201A\u201B]/g, "'").replace(/[\u201C\u201D\u201E]/g, '"').replace(/\u2026/g, '...').replace(/\u20AC/g, 'EUR').replace(/[\u00A0\u2002-\u200A\u202F]/g, ' ').replace(/[^\u0020-\u007E\u00A1-\u00FF]/g, '');
const esc = (v) => latin1(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const el = (nome, v) => (v === undefined || v === null || v === '' ? '' : '<' + nome + '>' + esc(v) + '</' + nome + '>');
const euro = (n) => (Math.round((Number(n) + Number.EPSILON) * 100) / 100).toFixed(2);
const err = (m) => Object.assign(new Error(m), { status: 400 });
const REGIMI = ['RF01', 'RF02', 'RF04', 'RF05', 'RF06', 'RF07', 'RF08', 'RF09', 'RF10', 'RF11', 'RF12', 'RF13', 'RF14', 'RF15', 'RF16', 'RF17', 'RF18', 'RF19'];

// Controlla i dati e dice cosa manca, in italiano, prima di costruire.
function controlla({ cedente, cessionario, documento }) {
  const manca = [];
  const c = cedente || {}, s = cessionario || {}, d = documento || {};
  if (!c.denominazione) manca.push('la ragione sociale dell\'azienda (Impostazioni → Aspetto)');
  if (!partitaIvaValida(c.piva)) manca.push('una partita IVA valida dell\'azienda (Impostazioni → Aspetto)');
  if (!c.indirizzo) manca.push('l\'indirizzo dell\'azienda (Impostazioni → Aspetto)');
  if (!/^\d{5}$/.test(String(c.cap || ''))) manca.push('il CAP dell\'azienda (Impostazioni → Connessioni → OpenAPI.it → Fattura elettronica)');
  if (!c.comune) manca.push('il comune dell\'azienda (Impostazioni → Connessioni → OpenAPI.it → Fattura elettronica)');
  if (c.regime && !REGIMI.includes(c.regime)) manca.push('un regime fiscale valido (RF01…RF19) tra i dati dell\'azienda');
  if (!s.denominazione && !(s.nome && s.cognome)) manca.push('il nome del cliente');
  if (!(partitaIvaValida(s.piva) || codiceFiscaleValido(s.codice_fiscale) || partitaIvaValida(s.codice_fiscale))) manca.push('la partita IVA o il codice fiscale del cliente (validi)');
  if (!s.indirizzo) manca.push('l\'indirizzo del cliente');
  if (!/^\d{5}$/.test(String(s.cap || ''))) manca.push('il CAP del cliente (5 cifre)');
  if (!s.comune) manca.push('il comune del cliente');
  if (s.codice_destinatario && !/^[A-Z0-9]{7}$/i.test(String(s.codice_destinatario))) manca.push('un codice destinatario di 7 caratteri (o niente: si usa la PEC)');
  if (!(Number(d.imponibile) > 0)) manca.push('un importo maggiore di zero');
  if (!d.descrizione) manca.push('la descrizione della prestazione');
  if (!d.numero || !d.data) manca.push('numero e data della fattura');
  return manca;
}

function costruisci({ cedente: c, cessionario: s, documento: d, pagamento: p }) {
  const manca = controlla({ cedente: c, cessionario: s, documento: d });
  if (manca.length) throw err('Per emettere la fattura manca: ' + manca.join('; ') + '.');
  const aliquota = d.aliquota === undefined ? 22 : Number(d.aliquota);
  const imponibile = Math.round(Number(d.imponibile) * 100) / 100;
  const imposta = Math.round(imponibile * aliquota) / 100;
  const totale = Math.round((imponibile + imposta) * 100) / 100;
  if (d.totale !== undefined && d.totale !== null && Math.abs(Number(d.totale) - totale) > 0.011) throw err('Il totale della scheda (' + euro(d.totale) + ') non torna con imponibile + IVA al ' + aliquota + '% (' + euro(totale) + '): correggi la scheda prima di fatturare.');
  const cfCess = codiceFiscaleValido(s.codice_fiscale) || partitaIvaValida(s.codice_fiscale) ? String(s.codice_fiscale).toUpperCase() : '';
  const pivaCess = partitaIvaValida(s.piva) ? String(s.piva).replace(/^IT/i, '') : (partitaIvaValida(s.codice_fiscale) ? String(s.codice_fiscale).replace(/^IT/i, '') : '');
  const anagrCess = s.denominazione ? el('Denominazione', s.denominazione) : el('Nome', s.nome) + el('Cognome', s.cognome);
  const codiceDest = s.codice_destinatario ? String(s.codice_destinatario).toUpperCase() : '0000000';
  const pagamento = p && p.scadenza ? '<DatiPagamento><CondizioniPagamento>TP02</CondizioniPagamento><DettaglioPagamento>' + el('ModalitaPagamento', p.iban ? 'MP05' : 'MP08') + el('DataScadenzaPagamento', p.scadenza) + el('ImportoPagamento', euro(totale)) + (p.iban ? el('IBAN', String(p.iban).replace(/\s+/g, '').toUpperCase()) : '') + '</DettaglioPagamento></DatiPagamento>' : '';
  return '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<p:FatturaElettronica versione="FPR12" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" xmlns:p="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2 http://www.fatturapa.gov.it/export/fatturazione/sdi/fatturapa/v1.2/Schema_del_file_xml_FatturaPA_versione_1.2.xsd">'
    + '<FatturaElettronicaHeader>'
    + '<DatiTrasmissione><IdTrasmittente><IdPaese>IT</IdPaese>' + el('IdCodice', String(c.piva).replace(/^IT/i, '')) + '</IdTrasmittente>' + el('ProgressivoInvio', String(d.progressivo || d.numero).replace(/[^A-Za-z0-9]/g, '').slice(-10) || '1') + '<FormatoTrasmissione>FPR12</FormatoTrasmissione>' + el('CodiceDestinatario', codiceDest) + (codiceDest === '0000000' && s.pec ? el('PECDestinatario', s.pec) : '') + '</DatiTrasmissione>'
    + '<CedentePrestatore><DatiAnagrafici><IdFiscaleIVA><IdPaese>IT</IdPaese>' + el('IdCodice', String(c.piva).replace(/^IT/i, '')) + '</IdFiscaleIVA>' + (c.codice_fiscale ? el('CodiceFiscale', c.codice_fiscale) : '') + '<Anagrafica>' + el('Denominazione', c.denominazione) + '</Anagrafica>' + el('RegimeFiscale', c.regime || 'RF01') + '</DatiAnagrafici><Sede>' + el('Indirizzo', c.indirizzo) + el('CAP', c.cap) + el('Comune', c.comune) + (c.provincia ? el('Provincia', String(c.provincia).toUpperCase()) : '') + '<Nazione>IT</Nazione></Sede></CedentePrestatore>'
    + '<CessionarioCommittente><DatiAnagrafici>' + (pivaCess ? '<IdFiscaleIVA><IdPaese>IT</IdPaese>' + el('IdCodice', pivaCess) + '</IdFiscaleIVA>' : '') + (cfCess && cfCess !== pivaCess ? el('CodiceFiscale', cfCess) : '') + '<Anagrafica>' + anagrCess + '</Anagrafica></DatiAnagrafici><Sede>' + el('Indirizzo', s.indirizzo) + el('CAP', s.cap) + el('Comune', s.comune) + (s.provincia ? el('Provincia', String(s.provincia).toUpperCase()) : '') + '<Nazione>IT</Nazione></Sede></CessionarioCommittente>'
    + '</FatturaElettronicaHeader><FatturaElettronicaBody>'
    + '<DatiGenerali><DatiGeneraliDocumento><TipoDocumento>TD01</TipoDocumento><Divisa>EUR</Divisa>' + el('Data', d.data) + el('Numero', d.numero) + el('ImportoTotaleDocumento', euro(totale)) + el('Causale', String(d.descrizione).slice(0, 200)) + '</DatiGeneraliDocumento></DatiGenerali>'
    + '<DatiBeniServizi><DettaglioLinee><NumeroLinea>1</NumeroLinea>' + el('Descrizione', String(d.descrizione).slice(0, 1000)) + '<Quantita>1.00</Quantita>' + el('PrezzoUnitario', euro(imponibile)) + el('PrezzoTotale', euro(imponibile)) + el('AliquotaIVA', euro(aliquota)) + '</DettaglioLinee>'
    + '<DatiRiepilogo>' + el('AliquotaIVA', euro(aliquota)) + el('ImponibileImporto', euro(imponibile)) + el('Imposta', euro(imposta)) + '<EsigibilitaIVA>I</EsigibilitaIVA></DatiRiepilogo></DatiBeniServizi>'
    + pagamento + '</FatturaElettronicaBody></p:FatturaElettronica>';
}

module.exports = { costruisci, controlla, REGIMI, esc };
