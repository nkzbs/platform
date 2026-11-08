'use strict';
// Adattatore «messaggio_cliente»: il pulsante sul cliente invia SUBITO il messaggio di auguri (con le impostazioni di Impostazioni → Messaggi ai clienti) a quel cliente, solo se ha il consenso alle comunicazioni
// commerciali. Il blocco stesso (con `automatico: 'compleanno'`) è anche la sorgente degli auguri automatici del giorno e dell'invio di massa (routes/messaggi.js).
//   campi: { nome, email, telefono, consenso, data_nascita }
const msg = require('../messaggi-clienti');
const err = (m, status = 400, code) => Object.assign(new Error(m), { status, code });

async function disponibile() {
  const d = await msg.canaliDisponibili(); const ok = d.mail.ok || d.sms.ok;
  return ok ? { ok: true } : { ok: false, motivo: [d.mail.motivo, d.sms.motivo].filter(Boolean).join(' ') };
}
async function esegui({ dati, config, utente, id, slug }) {
  const imp = msg.impostazioni().auguri;
  const prep = await msg.prepara({ records: [{ id: id || 0, data: dati }], config, canali: imp.canali, testoSms: msg.riempi(imp.testo, {}, config.campi || {}) });
  if (!prep.pronti.length) throw err('Il messaggio non può partire: ' + (prep.saltati[0] ? prep.saltati[0].motivo : 'nessun canale disponibile') + '.');
  const e = await msg.spedisci({ pronti: prep.pronti, config, tipo: 'auguri', modulo: slug || null, oggetto: imp.oggetto, testoMail: imp.testo, testoSms: imp.testo, utente: utente && utente.username });
  if (!e.inviati) throw err('Il messaggio non è partito: controlla il registro in Impostazioni → Messaggi ai clienti.', 502);
  return { patch: {}, risposta: e, audit: e };
}
module.exports = { nome: 'messaggio_cliente', disponibile, esegui };
