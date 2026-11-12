'use strict';
// Adattatore «firma_elettronica»: fa firmare a distanza un documento PDF già allegato al record (firma elettronica semplice, eSignature di OpenAPI.it: ai firmatari arriva un link, firmano
// con un codice per email o SMS). Il PRIMO clic manda il documento ai firmatari; i clic successivi ricontrollano lo stato (senza costo) e, quando tutti hanno firmato, scaricano il
// documento firmato e lo allegano al record con il tipo `allegato_firmato`: così il passaggio che lo richiede si sblocca da solo. Non conosce nomi di moduli: il blocco dichiara tutto.
//   allegato_da_firmare: tipo di allegato (il PDF da mandare)       allegato_firmato: tipo con cui si salva il firmato
//   firmatari: [{ relazione: 'chiave della relazione del record', ruolo: 'etichetta' }]     campi_firmatario: { nome, email, telefono }  (campi del record collegato)
//   titolo: campo del record usato come titolo (facoltativo)     posizione: { page, x, y } dove mettere la firma (predefinito: pagina 1, in basso)
//   risultato_in: chiave non dichiarata che tiene { id, stato, data }      esito: { esito, data }  campi del record in cui scrive il riassunto
//   autenticazione: 'email' (predefinita) | 'sms'
// Se il servizio non è abilitato sulla chiave, la funzione resta «da attivare» (nessuna richiesta, nessun costo). Mai provato con il servizio vero: vedi docs/NOTE-DI-RILASCIO.md.
const openapiIt = require('../openapi-it');
const allegati = require('./allegati');
const DOM = 'esignature';
const SCOPI = [['POST', '/EU-SES'], ['GET', '/signatures']];
const err = (m, status = 400, code) => Object.assign(new Error(m), { status, code });
const MAX_BASE64 = 11 * 1024 * 1024; // il servizio rifiuta oltre 11 MB in base64

async function disponibile() {
  const a = await openapiIt.servizioAttivo('esignature_ses', DOM, SCOPI);
  return a.ok ? a : { ok: false, motivo: 'serve il servizio eSignature di OpenAPI.it. ' + a.motivo };
}
const inCorso = ({ dati, config }) => { const r = config.risultato_in && dati[config.risultato_in]; return !!(r && r.id && r.stato !== 'DONE'); };

function firmatari({ slug, dati, config }) {
  const C = config.campi_firmatario || {}; const out = []; const auth = config.autenticazione === 'sms' ? 'sms' : 'email';
  for (const f of (config.firmatari || [])) {
    const c = allegati.collegato(slug, dati, f.relazione);
    if (!c) throw err('Manca ' + (f.ruolo ? 'il ' + f.ruolo.toLowerCase() : 'un firmatario') + ' nella scheda: sceglilo prima di far firmare.');
    const nomeCompleto = String(c.dati[C.nome || 'nome'] || '').trim(); const p = nomeCompleto.split(/\s+/); const name = p.shift() || ''; const surname = p.join(' ');
    const email = String(c.dati[C.email || 'email'] || '').trim(); const tel = String(c.dati[C.telefono || 'telefono'] || '').replace(/[\s().-]/g, '');
    if (!name || !surname) throw err((f.ruolo || 'Il firmatario') + ': servono nome e cognome (' + nomeCompleto + ').');
    if (auth === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw err((f.ruolo || 'Il firmatario') + ' «' + nomeCompleto + '»: manca un indirizzo email valido per il codice di firma.');
    const mobile = tel ? (tel.startsWith('+') ? tel : '+39' + tel.replace(/^0+/, '')) : '';
    if (auth === 'sms' && !/^\+\d{8,15}$/.test(mobile)) throw err((f.ruolo || 'Il firmatario') + ' «' + nomeCompleto + '»: manca un numero di cellulare valido per il codice di firma.');
    out.push({ ruolo: f.ruolo, name, surname, email, mobile, auth });
  }
  if (!out.length) throw err('Nessun firmatario dichiarato per questa funzione.');
  return out;
}

async function esegui({ dati, config, utente, id, slug }) {
  const E = config.esito || {}; const patch = {}; const oggi = new Date().toISOString().slice(0, 10);
  const prec = config.risultato_in && dati[config.risultato_in];
  if (prec && prec.id && prec.stato !== 'DONE') {
    // ricontrollo, senza spesa
    const r = await openapiIt.chiama({ dominio: DOM, percorso: '/signatures/' + prec.id + '/detail', scopi: SCOPI });
    const d = (r && r.data) || {}; const stato = String(d.state || '');
    if (stato === 'DONE') {
      const f = await openapiIt.chiama({ dominio: DOM, percorso: '/signatures/' + prec.id + '/signedDocument', scopi: SCOPI, binario: true, timeout: 60000 });
      if (!f || !f.buffer || f.buffer.length < 100) throw err('Il documento risulta firmato ma non si riesce a scaricarlo: riprova tra poco.', 502);
      await allegati.salva({ slug, id, buffer: f.buffer, nome: 'firmato-' + id + '.pdf', mime: /pdf/i.test(f.tipo) ? 'application/pdf' : (f.tipo || 'application/pdf'), tipo: config.allegato_firmato, utenteId: utente && utente.id });
      if (config.risultato_in) patch[config.risultato_in] = { id: prec.id, stato: 'DONE', data: oggi };
      if (E.esito) patch[E.esito] = 'Firmato da tutti: il documento firmato è tra gli allegati (' + config.allegato_firmato + ').'; if (E.data) patch[E.data] = oggi;
      return { patch, risposta: { stato: 'DONE', firmato: true }, audit: { id: prec.id, stato: 'DONE' } };
    }
    if (stato === 'ERROR' || stato === 'CANCELLED') {
      if (config.risultato_in) patch[config.risultato_in] = { id: prec.id, stato, data: oggi };
      if (E.esito) patch[E.esito] = stato === 'CANCELLED' ? 'La richiesta di firma è stata annullata: puoi mandarne una nuova.' : 'La richiesta di firma non è andata a buon fine' + (d.errorMessage ? ': ' + d.errorMessage : '') + '.';
      return { patch, risposta: { stato, firmato: false }, audit: { id: prec.id, stato } };
    }
    const attesa = (d.signers || []).filter((s) => s.state !== 'DONE').map((s) => (s.email || s.mobile || '') ).filter(Boolean);
    if (config.risultato_in) patch[config.risultato_in] = { id: prec.id, stato: stato || prec.stato, data: prec.data || oggi };
    if (E.esito) patch[E.esito] = 'In attesa di firma' + (attesa.length ? ' da: ' + attesa.join(', ') : '') + '. Premi di nuovo per ricontrollare.';
    return { patch, risposta: { stato, firmato: false, in_attesa: attesa }, audit: { id: prec.id, stato } };
  }

  // nuova richiesta
  if (!config.allegato_da_firmare || !config.allegato_firmato) throw err('La funzione non dice quale allegato far firmare e con quale tipo salvarlo.', 500);
  const doc = await allegati.leggi(slug, id, config.allegato_da_firmare);
  if (!doc) throw err('Manca il documento da far firmare: carica un PDF tra gli allegati con il tipo «' + config.allegato_da_firmare + '».');
  if (!/pdf/i.test(doc.mime) && !/\.pdf$/i.test(doc.nome)) throw err('Il documento da firmare deve essere un PDF (quello allegato è «' + doc.nome + '»).');
  const base64 = doc.buffer.toString('base64'); if (base64.length > MAX_BASE64) throw err('Il PDF è troppo grande per la firma a distanza (oltre 11 MB).', 413);
  const f = firmatari({ slug, dati, config });
  const pos = config.posizione || {};
  const corpo = {
    title: String(dati[config.titolo || 'titolo'] || 'Documento da firmare').slice(0, 120),
    signers: f.map((x, i) => ({ name: x.name, surname: x.surname, ...(x.email ? { email: x.email } : {}), ...(x.mobile ? { mobile: x.mobile } : {}), authentication: [x.auth], signatures: [{ page: pos.page || 1, x: (pos.x || 60) + i * 220, y: pos.y || 60 }] })),
    inputDocuments: [{ sourceType: 'base64', payload: base64 }],
    options: { signatureMode: ['drawn', 'typed'] },
  };
  const r = await openapiIt.chiama({ dominio: DOM, metodo: 'POST', percorso: '/EU-SES', corpo, scopi: SCOPI, timeout: 60000 });
  const sid = r && r.data && r.data.id; if (!sid) throw err('OpenAPI.it non ha restituito l\'identificativo della richiesta di firma.', 502);
  if (config.risultato_in) patch[config.risultato_in] = { id: sid, stato: String((r.data && r.data.state) || 'WAIT_SIGN'), data: oggi };
  if (E.data) patch[E.data] = oggi;
  if (E.esito) patch[E.esito] = 'Documento mandato in firma a ' + f.map((x) => x.name + ' ' + x.surname).join(' e ') + ' (' + (f[0].auth === 'sms' ? 'codice via SMS' : 'codice via email') + '). eSignature non spedisce nulla da sola: manda tu a ogni firmatario il suo link, il codice parte quando lo apre. ' + ((r.data && r.data.signers) || []).map((x, i) => (f[i] ? f[i].name + ' ' + f[i].surname + ': ' : '') + (x.url || '')).filter(Boolean).join(' · ') + ' Premi di nuovo per ricontrollare.';
  return { patch, risposta: { id: sid, firmatari: f.length }, audit: { id: sid, firmatari: f.length } };
}

module.exports = { nome: 'firma_elettronica', servizio: 'esignature_ses', disponibile, senzaCosto: inCorso, esegui };
