'use strict';
// Identità grafica comune a TUTTI i PDF che Platform genera (report di valutazione, documenti da modello,
// documenti da firmare): fascia in alto con logo e colore dell'azienda, titoli con grazie, piè di pagina
// con i dati dell'azienda e «Pagina N di M». Logo, colore e dati vengono da Impostazioni → Aspetto
// (tenant_settings); qui non compare il nome di nessun cliente. Il carattere del marchio (se è un font
// commerciale) non si può incorporare: si usa un serif standard (Times) per i titoli.

const M = 44;                       // margine laterale
const ALTEZZA_FASCIA = 78;
const GRIGIO = '#57534e', CHIARO = '#f5f5f4', LINEA = '#e7e5e4', TESTO = '#1c1917';
const FONT_TITOLO = 'Times-Bold';

// Il carattere dei titoli: quello scelto in Aspetto (grassetto), altrimenti Times in grassetto.
const fontTitolo = (doc) => (doc._carattere && doc._carattere.bold) || FONT_TITOLO;

const coloreValido = (c) => (/^#[0-9a-f]{6}$/i.test(String(c || '')) ? c : '#1f4e79');

function rgb(colore) { const n = parseInt(coloreValido(colore).slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
const hex = (r, g, b) => '#' + [r, g, b].map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('');

// Il colore dell'azienda scurito (0 = invariato, 1 = nero): per sfumare la fascia.
function scurisci(colore, quota) { const [r, g, b] = rgb(colore); return hex(r * (1 - quota), g * (1 - quota), b * (1 - quota)); }

// Un azzurro/accento vivo della stessa tinta del colore dell'azienda (filetti, dettagli).
function accento(colore) {
  const [r, g, b] = rgb(colore).map((c) => c / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  const sat = Math.min(0.85, Math.max(0.55, d ? d / (1 - Math.abs(mx + mn - 1)) + 0.15 : 0.55)), l = 0.52;
  const c = (1 - Math.abs(2 * l - 1)) * sat, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r1, g1, b1] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return hex((r1 + m) * 255, (g1 + m) * 255, (b1 + m) * 255);
}

// Il colore dell'azienda schiarito verso il bianco (0 = bianco, 1 = colore pieno): per i fondi delle intestazioni di sezione.
function tinta(colore, quota) {
  const n = parseInt(coloreValido(colore).slice(1), 16);
  const mix = (c) => Math.round(255 - (255 - c) * quota);
  return '#' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => mix(c).toString(16).padStart(2, '0')).join('');
}

// Logo da un data: URI PNG/JPEG o da un indirizzo https; qualunque problema → nessun logo (si scrive il nome).
async function caricaLogo(url) {
  try {
    if (!url) return null;
    if (/^data:image\/(png|jpeg);base64,/i.test(url)) return Buffer.from(url.split(',')[1], 'base64');
    if (/^https:\/\//i.test(url)) {
      const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
      const tipo = r.headers.get('content-type') || '';
      if (!r.ok || !/image\/(png|jpeg)/i.test(tipo)) return null;
      const b = Buffer.from(await r.arrayBuffer());
      return b.length < 3 * 1024 * 1024 ? b : null;
    }
  } catch (e) { /* senza logo */ }
  return null;
}

// Dati dell'azienda e logo del tenant, pronti per i generatori di PDF. `db` = la connessione del tenant.
async function caricaIdentita(db) {
  const t = db.prepare('SELECT ragione_sociale, indirizzo, piva, logo_url, accent_color, font_app FROM tenant_settings WHERE id = 1').get() || {};
  return { azienda: { nome: t.ragione_sociale, indirizzo: t.indirizzo, piva: t.piva, colore: t.accent_color, carattere: t.font_app || null }, logo: await caricaLogo(t.logo_url) };
}

// Larghezza della pillola dell'etichetta: il testo (maiuscolo, con la spaziatura) più il respiro ai lati, tra 118 e 230 punti.
function larghezzaPillola(doc, etichetta) {
  doc.font('Helvetica').fontSize(9);
  const testo = String(etichetta).toUpperCase();
  return Math.min(230, Math.max(118, Math.ceil(doc.widthOfString(testo) + testo.length * 0.8 + 28)));
}

// Testata della pagina corrente: filetto del colore dell'azienda in cima, a sinistra logo (o nome in serif) con indirizzo e P.IVA, a destra il tipo di documento in maiuscoletto con data e,
// se c'è, il numero; sotto un filo sottile. Fondo bianco: niente fascia piena, niente sfumature. L'altezza resta ALTEZZA_FASCIA, così il contenuto sotto non si sposta.
function intestazione(doc, { azienda = {}, logo = null, etichetta = 'DOCUMENTO', data = '', numero = '' }) {
  const colore = coloreValido(azienda.colore);
  // Se in Aspetto è scelto un carattere dell'app, titoli e piè di pagina lo usano (lib/caratteri.js); altrimenti restano Times.
  if (!doc._carattere) doc._carattere = require('./caratteri').registraPdf(doc, azienda.carattere) || { nessuno: true };
  const W = doc.page.width - M * 2;
  const larghDx = 190; // colonna di destra
  doc.rect(0, 0, doc.page.width, 5).fill(colore);
  let xTesto = M, logoMostrato = false;
  if (logo) {
    try {
      const img = doc.openImage(logo);
      const orizzontale = img.width / img.height > 1.4;
      doc.image(logo, M, 20, orizzontale ? { fit: [170, 40] } : { fit: [44, 44] });
      logoMostrato = true; xTesto = orizzontale ? M : M + 56;
      if (orizzontale) { /* il logo largo contiene già il nome */ }
    } catch (e) { /* logo illeggibile: si scrive il nome */ }
  }
  const largSx = W - larghDx - 12 - (xTesto - M);
  const mostraNome = !logoMostrato || xTesto > M; // un logo largo contiene già il nome
  if (mostraNome) {
    doc.font(fontTitolo(doc)).fontSize(17).fillColor(colore).text(azienda.nome || etichetta, xTesto, 21, { width: Math.max(120, largSx), lineBreak: false });
    if (azienda.nome) doc.font('Helvetica').fontSize(8.5).fillColor(GRIGIO).text([azienda.indirizzo, azienda.piva && 'P.IVA ' + azienda.piva].filter(Boolean).join(' · '), xTesto, 43, { width: Math.max(120, largSx), lineBreak: false });
  } else if (azienda.nome) {
    doc.font('Helvetica').fontSize(8.5).fillColor(GRIGIO).text([azienda.indirizzo, azienda.piva && 'P.IVA ' + azienda.piva].filter(Boolean).join(' · '), xTesto, 63, { width: Math.max(120, largSx), lineBreak: false });
  }
  const xd = M + W - larghDx;
  doc.font('Helvetica-Bold').fontSize(8).fillColor(colore).text(String(etichetta).toUpperCase(), xd, 23, { width: larghDx, align: 'right', lineBreak: false, characterSpacing: 1.1 });
  const dettagli = [data, numero && 'N. ' + numero].filter(Boolean).join('  ·  ');
  if (dettagli) doc.font('Helvetica').fontSize(9).fillColor(GRIGIO).text(dettagli, xd, 37, { width: larghDx, align: 'right', lineBreak: false });
  doc.moveTo(M, ALTEZZA_FASCIA - 8).lineTo(M + W, ALTEZZA_FASCIA - 8).lineWidth(0.6).strokeColor(LINEA).stroke();
  return colore;
}

// Titoletto di sezione: barra del colore dell'azienda + titolo con grazie.
function titoloSezione(doc, testo, colore) {
  const W = doc.page.width - M * 2;
  const y = doc.y;
  doc.rect(M, y, 4, 15).fill(colore);
  doc.font(fontTitolo(doc)).fontSize(14).fillColor(TESTO).text(testo, M + 12, y, { width: W - 12 });
}

// Su ogni pagina: filetto, nome dell'azienda in corsivo (o `riserva`) e «Pagina N di M». Da chiamare prima di doc.end().
function pieDiPagina(doc, { azienda = {}, riserva = '', colore }) {
  const W = doc.page.width - M * 2;
  const { count } = doc.bufferedPageRange();
  const c = coloreValido(colore || azienda.colore);
  for (let i = 0; i < count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0; // scrivere nel margine in basso non deve aprire una pagina nuova
    doc.moveTo(M, doc.page.height - 44).lineTo(M + W, doc.page.height - 44).lineWidth(0.6).strokeColor(tinta(c, 0.3)).stroke();
    if (azienda.nome) doc.font((doc._carattere && doc._carattere.italic) || 'Times-Italic').fontSize(11.5).fillColor(c).text(azienda.nome, M, doc.page.height - 38, { width: W - 100, lineBreak: false });
    else doc.font('Helvetica').fontSize(8).fillColor('#78716c').text(riserva, M, doc.page.height - 36, { width: W - 100, lineBreak: false });
    doc.font('Helvetica').fontSize(8.5).fillColor('#44403c').text('Pagina ' + (i + 1) + ' di ' + count, M + W - 90, doc.page.height - 36, { width: 90, align: 'right', lineBreak: false });
  }
}

module.exports = { larghezzaPillola, scurisci, accento, tinta, M, ALTEZZA_FASCIA, GRIGIO, CHIARO, LINEA, TESTO, FONT_TITOLO, coloreValido, caricaLogo, caricaIdentita, intestazione, titoloSezione, pieDiPagina };
