'use strict';
// La grafica unica delle mail che il tenant manda ai suoi clienti (documenti, solleciti, auguri, richieste di firma, conferme):
// fascia con logo e colore dell'agenzia, titolo in serif, testo in paragrafi, un solo pulsante, firma di chi scrive e piè di pagina
// con i dati dell'azienda. Logo, colore e dati vengono da Impostazioni → Aspetto (tenant_settings), gli stessi dei PDF.
// Niente immagini incorporate (Gmail e Outlook le bloccano): il logo si usa solo se è un indirizzo https, altrimenti l'iniziale del nome.

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const coloreValido = (c) => (/^#[0-9a-f]{6}$/i.test(String(c || '')) ? String(c) : '#1f4e79');

// Il testo sopra il colore dell'agenzia: bianco, salvo colori chiari (allora quasi nero).
function testoSu(colore) {
  const n = parseInt(coloreValido(colore).slice(1), 16);
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return L > 0.55 ? '#1c1917' : '#ffffff';
}
function chiaro(colore, quota) { // colore schiarito verso il bianco (0 = bianco, 1 = pieno), per il fondo dei riquadri
  const n = parseInt(coloreValido(colore).slice(1), 16);
  const mix = (c) => Math.round(255 - (255 - c) * quota);
  return '#' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => mix(c).toString(16).padStart(2, '0')).join('');
}

function identita() {
  let t = {};
  try { t = require('../db').prepare('SELECT ragione_sociale, indirizzo, piva, logo_url, accent_color FROM tenant_settings WHERE id = 1').get() || {}; } catch (e) { /* tabella assente nei test minimi */ }
  return { nome: t.ragione_sociale || '', indirizzo: t.indirizzo || '', piva: t.piva || '', logo: /^https:\/\//i.test(t.logo_url || '') ? t.logo_url : '', colore: coloreValido(t.accent_color) };
}

// Testo → paragrafi. Riga vuota = nuovo paragrafo; a capo semplice = <br>. Un indirizzo https nel testo diventa un collegamento.
function paragrafi(testo, colore) {
  return String(testo || '').replace(/\r/g, '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).map((p) => {
    const h = esc(p).replace(/(https:\/\/[^\s<]+)/g, (u) => '<a href="' + u + '" style="color:' + colore + '">' + u + '</a>').replace(/\n/g, '<br>');
    return '<p style="margin:0 0 14px">' + h + '</p>';
  }).join('');
}

// opzioni: titolo, pulsante {testo, url}, nota (sotto il pulsante), elenco [{nome, dettaglio}], firmaDa {nome, ruolo}, piede (riga in più), scadenza
function htmlComunicazione(testo, op = {}) {
  const a = op.identita || identita();
  const c = a.colore, su = testoSu(c);
  const nome = a.nome || 'La tua agenzia';
  const logo = /^https:\/\//i.test(a.logo || '')
    ? '<img src="' + esc(a.logo) + '" alt="' + esc(nome) + '" height="34" style="display:block;height:34px;max-width:160px;border:0">'
    : '<div style="width:34px;height:34px;border-radius:8px;background:rgba(255,255,255,.18);color:' + su + ';font:600 18px Georgia,serif;line-height:34px;text-align:center">' + esc(nome.trim().charAt(0).toUpperCase() || '·') + '</div>';
  const elenco = (op.elenco || []).length
    ? '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 18px;border:1px solid #e7e3dc;border-radius:8px;border-collapse:separate;overflow:hidden">' +
      op.elenco.map((x, i) => '<tr><td style="padding:10px 14px;font-size:14px;' + (i ? 'border-top:1px solid #e7e3dc' : '') + '">' + esc(x.nome) + '</td><td align="right" style="padding:10px 14px;font-size:12px;color:#6b665f;white-space:nowrap;' + (i ? 'border-top:1px solid #e7e3dc' : '') + '">' + esc(x.dettaglio || '') + '</td></tr>').join('') + '</table>'
    : '';
  const pulsante = op.pulsante && /^https:\/\//i.test(op.pulsante.url || '')
    ? '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0 6px"><tr><td align="center" style="border-radius:8px;background:' + c + '"><a href="' + esc(op.pulsante.url) + '" style="display:block;padding:14px 20px;font:600 15px Arial,Helvetica,sans-serif;color:' + su + ';text-decoration:none;border-radius:8px">' + esc(op.pulsante.testo) + '</a></td></tr></table>' +
      (op.nota ? '<p style="margin:8px 0 0;text-align:center;font-size:12.5px;color:#6b665f">' + esc(op.nota) + '</p>' : '')
    : (op.nota ? '<p style="margin:0 0 14px;font-size:12.5px;color:#6b665f">' + esc(op.nota) + '</p>' : '');
  const firma = op.firmaDa && op.firmaDa.nome
    ? '<div style="padding:16px 28px 22px;border-top:1px solid #e7e3dc;font-size:13px"><div style="font:600 15px Georgia,serif">' + esc(op.firmaDa.nome) + '</div><div style="color:#6b665f">' + esc(op.firmaDa.ruolo || '') + '</div></div>' : '';
  const dati = [a.nome, a.indirizzo, a.piva && 'P.IVA ' + a.piva].filter(Boolean).map(esc).join(' · ');
  const piede = [dati, op.piede && esc(op.piede)].filter(Boolean).join('<br>');
  return '<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>' +
    '<body style="margin:0;padding:0;background:#f1efea"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1efea"><tr><td align="center" style="padding:24px 12px">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e7e3dc;border-radius:12px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;color:#1c1917">' +
    '<tr><td style="background:' + c + ';padding:18px 28px"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="padding-right:12px;vertical-align:middle">' + logo + '</td><td style="vertical-align:middle;color:' + su + '"><div style="font:600 17px Georgia,serif;line-height:1.15">' + esc(nome) + '</div></td></tr></table></td></tr>' +
    '<tr><td style="padding:26px 28px 10px;font-size:15px;line-height:1.6">' +
    (op.titolo ? '<h1 style="margin:0 0 14px;font:600 22px/1.25 Georgia,serif;color:#1c1917">' + esc(op.titolo) + '</h1>' : '') +
    paragrafi(testo, c) + elenco + pulsante + '</td></tr>' +
    (firma ? '<tr><td>' + firma + '</td></tr>' : '') +
    (piede ? '<tr><td style="background:#faf9f6;border-top:1px solid #e7e3dc;padding:14px 28px;font-size:11.5px;line-height:1.6;color:#6b665f">' + piede + '</td></tr>' : '') +
    '</table></td></tr></table></body></html>';
}

module.exports = { htmlComunicazione, identita, testoSu, chiaro, coloreValido, paragrafi, esc };
