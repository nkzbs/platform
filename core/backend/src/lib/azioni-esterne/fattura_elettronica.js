'use strict';
// Adattatore «fattura_elettronica»: emette la fattura di una scheda (per esempio una provvigione) e la manda allo SDI tramite OpenAPI.it (Fatturazione elettronica), in formato FatturaPA 1.2 (lib/fatturapa.js,
// validato con lo schema ufficiale). Il PRIMO clic emette e invia (con conferma del costo e un RIEPILOGO di cosa parte: una fattura inviata non si ritira, si corregge con una nota di credito);
// i clic successivi ricontrollano lo stato nello SDI (senza costo). Una fattura già consegnata non si rifà: il pulsante lo dice.
//   campi: { descrizione, imponibile, totale (facoltativo, per il controllo), scadenza (facoltativo) }       aliquota_iva: 22 (predefinita)
//   cliente: { relazione, campi: { nome, codice_fiscale, tipo_soggetto, indirizzo, cap, comune, provincia, pec, codice_destinatario } }   (campi del record collegato)
//   esito: { esito, data }      risultato_in: chiave non dichiarata con { id, numero, anno, data, stato, sdi }
// I dati dell'azienda: ragione sociale, partita IVA, indirizzo da Impostazioni → Aspetto; CAP, comune, provincia, regime fiscale e IBAN da Connessioni → OpenAPI.it.
// Il numero è progressivo per anno (N/AAAA) e si consuma solo se la fattura parte; una fattura scartata dallo SDI si rimanda con lo stesso numero.
// Mai provato con il servizio vero: vedi docs/NOTE-DI-RILASCIO.md.
const db = require('../../db');
const openapiIt = require('../openapi-it');
const allegati = require('./allegati');
const fatturapa = require('../fatturapa');
const DOM = 'invoice';
const SCOPI = [['POST', '/IT-invoices'], ['GET', '/IT-invoices']];
const err = (m, status = 400, code) => Object.assign(new Error(m), { status, code });
db.exec('CREATE TABLE IF NOT EXISTS fatture_numerazione (anno INTEGER PRIMARY KEY, ultimo INTEGER NOT NULL DEFAULT 0)');

async function disponibile() {
  const a = await openapiIt.servizioAttivo('sdi_fatture', DOM, SCOPI);
  return a.ok ? a : { ok: false, motivo: 'serve il servizio Fatturazione Elettronica (SDI) di OpenAPI.it. ' + a.motivo };
}
const finale = (r) => !!r && (r.stato === 'DONE' || ['ACCEPTED', 'DELIVERED', 'NOT_DELIVERED'].includes(r.sdi));
const respinta = (r) => !!r && (r.stato === 'ERROR' || r.sdi === 'REJECTED');
const inCorso = ({ dati, config }) => { const r = config.risultato_in && dati[config.risultato_in]; return !!(r && r.id && !finale(r) && !respinta(r)); };

function raccogli({ slug, dati, config, creds, numero, data }) {
  const C = config.campi || {}, K = (config.cliente && config.cliente.campi) || {};
  const t = db.prepare('SELECT ragione_sociale, indirizzo, piva FROM tenant_settings WHERE id = 1').get() || {};
  const f = (creds && creds.fiscale) || {};
  const cl = allegati.collegato(slug, dati, config.cliente && config.cliente.relazione);
  if (!cl) throw err('Manca il cliente a cui intestare la fattura: sceglilo nella scheda.');
  const nome = String(cl.dati[K.nome || 'nome'] || '').trim();
  const societa = /societ|azienda|giurid/i.test(String(cl.dati[K.tipo_soggetto || 'tipo_soggetto'] || ''));
  const p = nome.split(/\s+/);
  return {
    cedente: { denominazione: t.ragione_sociale, piva: t.piva, indirizzo: t.indirizzo, cap: f.cap, comune: f.comune, provincia: f.provincia, regime: f.regime || 'RF01', codice_fiscale: f.codice_fiscale },
    cessionario: { ...(societa ? { denominazione: nome } : { nome: p.shift() || '', cognome: p.join(' ') }), codice_fiscale: String(cl.dati[K.codice_fiscale || 'codice_fiscale_piva'] || '').trim().toUpperCase().replace(/\s+/g, ''), piva: societa ? String(cl.dati[K.codice_fiscale || 'codice_fiscale_piva'] || '').trim() : '', indirizzo: String(cl.dati[K.indirizzo || 'indirizzo'] || '').trim(), cap: String(cl.dati[K.cap || 'cap'] || '').trim(), comune: String(cl.dati[K.comune || 'comune'] || '').trim(), provincia: String(cl.dati[K.provincia || 'provincia'] || '').trim(), pec: String(cl.dati[K.pec || 'pec'] || '').trim(), codice_destinatario: String(cl.dati[K.codice_destinatario || 'codice_destinatario'] || '').trim() },
    documento: { numero, data, descrizione: String(dati[C.descrizione || 'descrizione'] || '').trim(), imponibile: Number(dati[C.imponibile || 'importo_netto']), totale: dati[C.totale || 'totale'] === undefined ? undefined : Number(dati[C.totale || 'totale']), aliquota: config.aliquota_iva === undefined ? 22 : config.aliquota_iva },
    pagamento: { scadenza: C.scadenza ? String(dati[C.scadenza] || '') : '', iban: f.iban },
  };
}
const oggi = () => new Date().toISOString().slice(0, 10);
const eur = (n) => Number(n).toLocaleString('it-IT', { style: 'currency', currency: 'EUR', useGrouping: 'always' });

// Cosa parte, in chiaro, prima di confermare (il server lo mette nella richiesta di conferma del costo).
function riepilogo({ slug, dati, config }) {
  try {
    const creds = openapiIt.credenziali(); const anno = new Date().getFullYear();
    const prec = config.risultato_in && dati[config.risultato_in];
    const numero = prec && prec.numero ? prec.numero : ((db.prepare('SELECT ultimo FROM fatture_numerazione WHERE anno = ?').get(anno) || { ultimo: 0 }).ultimo + 1) + '/' + anno;
    const d = raccogli({ slug, dati, config, creds, numero, data: oggi() });
    const manca = fatturapa.controlla({ cedente: d.cedente, cessionario: d.cessionario, documento: d.documento });
    if (manca.length) return 'La fattura non può partire: manca ' + manca.join('; ') + '.';
    const imp = Math.round(d.documento.imponibile * 100) / 100, iva = Math.round(imp * d.documento.aliquota) / 100;
    const nomeCl = d.cessionario.denominazione || (d.cessionario.nome + ' ' + d.cessionario.cognome);
    return 'Fattura n. ' + numero + ' del ' + oggi().split('-').reverse().join('/') + ' a ' + nomeCl + ': imponibile ' + eur(imp) + ', IVA ' + d.documento.aliquota + '% ' + eur(iva) + ', totale ' + eur(imp + iva) + '. Una fattura inviata allo SDI non si ritira: si corregge solo con una nota di credito.';
  } catch (e) { return 'La fattura non può partire: ' + e.message; }
}

let coda = Promise.resolve(); // un invio alla volta: il numero progressivo non si duplica

async function esegui({ dati, config, slug, id }) {
  const E = config.esito || {}; const patch = {};
  const prec = config.risultato_in && dati[config.risultato_in];
  if (prec && finale(prec)) throw err('Questa scheda è già stata fatturata (fattura n. ' + prec.numero + '): non si emette due volte.', 409);
  if (prec && prec.id && !respinta(prec)) {
    // ricontrollo nello SDI, senza spesa
    const r = await openapiIt.chiama({ dominio: DOM, percorso: '/IT-invoices/' + prec.id, scopi: SCOPI });
    const d = (r && r.data) || {}; const det = d.details || {}; const sdi = String(det.sdi_status || ''); const stato = String(d.state || '');
    const nuovo = { ...prec, stato: stato || prec.stato, sdi };
    if (config.risultato_in) patch[config.risultato_in] = nuovo;
    const msg = finale(nuovo) ? 'Fattura n. ' + prec.numero + ' consegnata dallo SDI' + (sdi === 'NOT_DELIVERED' ? ' (messa a disposizione del cliente nel suo cassetto fiscale)' : '') + '.'
      : respinta(nuovo) ? 'La fattura n. ' + prec.numero + ' è stata scartata dallo SDI' + (det.sdi_message ? ': ' + det.sdi_message : '') + '. Correggi i dati e premi di nuovo: si rimanda con lo stesso numero.'
        : 'Fattura n. ' + prec.numero + ' inviata, in attesa dello SDI' + (sdi ? ' (stato ' + sdi + ')' : '') + '. Premi di nuovo per ricontrollare.';
    if (E.esito) patch[E.esito] = msg; if (E.data) patch[E.data] = oggi();
    return { patch, risposta: { stato, sdi, consegnata: finale(nuovo) }, audit: { id: prec.id, stato, sdi } };
  }
  const creds = openapiIt.credenziali(); if (!creds) throw err('OpenAPI.it non è collegato.', 503, 'not_connected');
  const lavoro = coda.then(async () => {
    const anno = new Date().getFullYear(); const riuso = prec && respinta(prec) ? prec : null;
    const ultimo = (db.prepare('SELECT ultimo FROM fatture_numerazione WHERE anno = ?').get(anno) || { ultimo: 0 }).ultimo;
    const numero = riuso ? riuso.numero : (ultimo + 1) + '/' + anno; const data = riuso ? riuso.data : oggi();
    const d = raccogli({ slug, dati, config, creds, numero, data });
    const xml = fatturapa.costruisci(d);
    const invia = () => openapiIt.chiama({ dominio: DOM, metodo: 'POST', percorso: '/IT-invoices', xml, scopi: SCOPI, timeout: 60000 });
    let r;
    try { r = await invia(); }
    catch (e) {
      // la prima fattura di un'azienda richiede la sua configurazione nel servizio (fatture emesse): la si crea e si riprova una volta
      if (/configur|customer_invoice|fiscal/i.test(String(e.message)) || e.status === 403) {
        await openapiIt.chiama({ dominio: DOM, metodo: 'POST', percorso: '/IT-configurations', corpo: { fiscal_id: String(d.cedente.piva).replace(/^IT/i, ''), name: d.cedente.denominazione, email: creds.email, customer_invoice: true }, scopi: [['POST', '/IT-configurations']], timeout: 30000 }).catch(() => null);
        r = await invia();
      } else throw e;
    }
    const sid = r && r.data && r.data.id; if (!sid) throw err('OpenAPI.it non ha restituito l\'identificativo della fattura.', 502);
    if (!riuso) db.prepare('INSERT INTO fatture_numerazione (anno, ultimo) VALUES (?, ?) ON CONFLICT(anno) DO UPDATE SET ultimo = MAX(ultimo, excluded.ultimo)').run(anno, ultimo + 1);
    return { sid, numero, data, stato: String((r.data && r.data.state) || 'SENT'), sdi: String(((r.data && r.data.details) || {}).sdi_status || '') };
  });
  coda = lavoro.catch(() => null);
  const f = await lavoro;
  if (config.risultato_in) patch[config.risultato_in] = { id: f.sid, numero: f.numero, anno: new Date().getFullYear(), data: f.data, stato: f.stato, sdi: f.sdi };
  if (E.esito) patch[E.esito] = 'Fattura n. ' + f.numero + ' inviata allo SDI il ' + f.data.split('-').reverse().join('/') + '. Premi di nuovo per ricontrollare la consegna.';
  if (E.data) patch[E.data] = f.data;
  return { patch, risposta: { id: f.sid, numero: f.numero }, audit: { id: f.sid, numero: f.numero } };
}

module.exports = { nome: 'fattura_elettronica', servizio: 'sdi_fattura', disponibile, senzaCosto: inCorso, riepilogo, esegui };
