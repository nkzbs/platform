'use strict';
// Trasforma il testo di un «documento da modello» approvato in un PDF da scaricare, stampare e
// firmare. Solo testo (niente HTML): righe vuote = nuovo paragrafo, una riga tutta in maiuscolo
// o che finisce con «:» è trattata come titoletto. Nessun nome di modulo o campo qui.
// L'aspetto (fascia con logo e colore dell'azienda, titoli con grazie, piè di pagina) è quello comune a
// tutti i PDF di Platform: vedi lib/identita-pdf.js. Corpo in Helvetica integrata (copre le lettere
// accentate italiane, niente file da installare).

const PDFDocument = require('pdfkit');
const { M, ALTEZZA_FASCIA, GRIGIO, TESTO, FONT_TITOLO, coloreValido, intestazione, titoloSezione, pieDiPagina } = require('./identita-pdf');

function eTitoletto(riga) {
  const t = riga.trim();
  if (t.length < 3 || t.length > 80) return false;
  return t === t.toUpperCase() && /[A-ZÀ-Ý]/.test(t) && !/^\[[ X]\]/.test(t);
}

// `azienda`: { nome, indirizzo, piva, colore } (o solo il nome, come stringa); `logo`: Buffer PNG/JPEG o null.
// → Promise<Buffer>
function creaPdf({ titolo, corpo, azienda, logo = null, etichetta = 'Documento', riquadroFirma = true, piePagina = '' }) {
  const az = typeof azienda === 'string' ? { nome: azienda } : (azienda || {});
  const colore = coloreValido(az.colore);
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: M, bufferPages: true, info: { Title: String(titolo || 'Documento'), Producer: 'Platform' } });
    const pezzi = [];
    doc.on('data', (p) => pezzi.push(p));
    doc.on('end', () => resolve(Buffer.concat(pezzi)));
    doc.on('error', reject);
    const W = doc.page.width - M * 2;

    // Prima pagina: fascia piena con logo. Pagine successive: un filetto del colore dell'azienda in cima.
    intestazione(doc, { azienda: az, logo, etichetta, data: new Date().toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' }) });
    doc.on('pageAdded', () => { doc.rect(0, 0, doc.page.width, 6).fill(colore); doc.y = M; });

    doc.font(FONT_TITOLO).fontSize(22).fillColor(TESTO).text(String(titolo || 'Documento'), M, ALTEZZA_FASCIA + 24, { width: W });
    doc.moveDown(0.9);

    for (const riga of String(corpo == null ? '' : corpo).replace(/\r\n/g, '\n').split('\n')) {
      if (riga.trim() === '') { doc.moveDown(0.6); continue; }
      if (eTitoletto(riga) || /:\s*$/.test(riga.trim()) && riga.trim().length < 60) {
        if (doc.y > doc.page.height - 110) doc.addPage(); // un titoletto non resta solo in fondo alla pagina
        doc.moveDown(0.3);
        titoloSezione(doc, riga.trim(), colore);
        doc.moveDown(0.3);
      } else {
        doc.font('Helvetica').fontSize(10).fillColor('#111111').text(riga, M, doc.y, { width: W, align: 'left', lineGap: 1.5 });
      }
    }

    if (riquadroFirma) {
      if (doc.y > doc.page.height - 190) doc.addPage();
      doc.moveDown(2.5);
      const larghezza = (W - 30) / 2;
      const y = doc.y;
      doc.font('Helvetica').fontSize(9).fillColor(GRIGIO);
      doc.text('Luogo e data', M, y, { width: larghezza });
      doc.text('Firma', M + larghezza + 30, y, { width: larghezza });
      doc.moveTo(M, y + 38).lineTo(M + larghezza, y + 38).strokeColor(colore).lineWidth(0.8).stroke();
      doc.moveTo(M + larghezza + 30, y + 38).lineTo(M + larghezza * 2 + 30, y + 38).stroke();
    }

    pieDiPagina(doc, { azienda: az, riserva: piePagina });
    doc.end();
  });
}

module.exports = { creaPdf, eTitoletto };
