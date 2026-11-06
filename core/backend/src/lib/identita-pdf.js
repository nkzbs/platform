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

const coloreValido = (c) => (/^#[0-9a-f]{6}$/i.test(String(c || '')) ? c : '#1f4e79');

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
  const t = db.prepare('SELECT ragione_sociale, indirizzo, piva, logo_url, accent_color FROM tenant_settings WHERE id = 1').get() || {};
  return { azienda: { nome: t.ragione_sociale, indirizzo: t.indirizzo, piva: t.piva, colore: t.accent_color }, logo: await caricaLogo(t.logo_url) };
}

// Fascia colorata in cima alla pagina corrente. A destra: etichetta del documento e data.
function intestazione(doc, { azienda = {}, logo = null, etichetta = 'DOCUMENTO', data = '' }) {
  const colore = coloreValido(azienda.colore);
  const W = doc.page.width - M * 2;
  doc.rect(0, 0, doc.page.width, ALTEZZA_FASCIA).fill(colore);
  let xTesto = M, logoLargo = false;
  if (logo) {
    try {
      const img = doc.openImage(logo);
      if (img.width / img.height > 1.4) {
        // Logo orizzontale (scritta + simbolo): sta direttamente sulla fascia, che ha il suo stesso colore di fondo.
        logoLargo = true;
        doc.image(logo, M - 6, 6, { fit: [210, 66] });
      } else {
        doc.roundedRect(M, 14, 50, 50, 6).fill('#ffffff'); doc.image(logo, M + 5, 19, { fit: [40, 40], align: 'center', valign: 'center' }); xTesto = M + 62;
      }
    } catch (e) { /* logo illeggibile: si scrive il nome */ }
  }
  if (!logoLargo) {
    doc.font(FONT_TITOLO).fontSize(16).fillColor('#ffffff').text(azienda.nome || etichetta, xTesto, 22, { width: 270, lineBreak: false });
    if (azienda.nome) doc.font('Helvetica').fontSize(9).fillColor('#f3f4f6').text([azienda.indirizzo, azienda.piva && 'P.IVA ' + azienda.piva].filter(Boolean).join(' · '), xTesto, 42, { width: 280, lineBreak: false });
  }
  doc.font('Helvetica-Bold').fontSize(11).fillColor('#ffffff').text(String(etichetta).toUpperCase(), M + W - 220, 24, { width: 220, align: 'right', lineBreak: false });
  if (data) doc.font('Helvetica').fontSize(9).fillColor('#f3f4f6').text(data, M + W - 220, 42, { width: 220, align: 'right', lineBreak: false });
  return colore;
}

// Titoletto di sezione: barra del colore dell'azienda + titolo con grazie.
function titoloSezione(doc, testo, colore) {
  const W = doc.page.width - M * 2;
  const y = doc.y;
  doc.rect(M, y, 4, 15).fill(colore);
  doc.font(FONT_TITOLO).fontSize(14).fillColor(TESTO).text(testo, M + 12, y, { width: W - 12 });
}

// Su ogni pagina: filetto, dati dell'azienda (o `riserva`) e «Pagina N di M». Da chiamare prima di doc.end().
function pieDiPagina(doc, { azienda = {}, riserva = '' }) {
  const W = doc.page.width - M * 2;
  const { count } = doc.bufferedPageRange();
  const contatti = [azienda.nome, azienda.indirizzo, azienda.piva && 'P.IVA ' + azienda.piva].filter(Boolean).join(' · ');
  for (let i = 0; i < count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0; // scrivere nel margine in basso non deve aprire una pagina nuova
    doc.moveTo(M, doc.page.height - 44).lineTo(M + W, doc.page.height - 44).lineWidth(0.5).strokeColor(LINEA).stroke();
    doc.font('Helvetica').fontSize(8).fillColor('#78716c');
    doc.text(contatti || riserva, M, doc.page.height - 36, { width: W - 90, lineBreak: false });
    doc.text('Pagina ' + (i + 1) + ' di ' + count, M + W - 90, doc.page.height - 36, { width: 90, align: 'right', lineBreak: false });
  }
}

module.exports = { M, ALTEZZA_FASCIA, GRIGIO, CHIARO, LINEA, TESTO, FONT_TITOLO, coloreValido, caricaLogo, caricaIdentita, intestazione, titoloSezione, pieDiPagina };
