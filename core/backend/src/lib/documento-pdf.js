'use strict';
// Trasforma il testo di un «documento da modello» approvato in un PDF da scaricare, stampare e
// firmare. Solo testo (niente HTML): righe vuote = nuovo paragrafo, una riga tutta in maiuscolo
// o che finisce con «:» è trattata come titoletto. Nessun nome di modulo o campo qui.
// Font Helvetica integrato (niente file da installare): copre le lettere accentate italiane.

const PDFDocument = require('pdfkit');

const MARGINE = 56;

function eTitoletto(riga) {
  const t = riga.trim();
  if (t.length < 3 || t.length > 80) return false;
  return t === t.toUpperCase() && /[A-ZÀ-Ý]/.test(t) && !/^\[[ X]\]/.test(t);
}

// → Promise<Buffer>
function creaPdf({ titolo, corpo, azienda, riquadroFirma = true, piePagina = '' }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: MARGINE, bufferPages: true, info: { Title: String(titolo || 'Documento'), Producer: 'Platform' } });
    const pezzi = [];
    doc.on('data', (p) => pezzi.push(p));
    doc.on('end', () => resolve(Buffer.concat(pezzi)));
    doc.on('error', reject);

    if (azienda) doc.font('Helvetica').fontSize(9).fillColor('#555555').text(String(azienda), { align: 'right' });
    doc.moveDown(0.5);
    doc.font('Helvetica-Bold').fontSize(15).fillColor('#000000').text(String(titolo || 'Documento'), { align: 'left' });
    doc.moveDown(0.8);

    for (const riga of String(corpo == null ? '' : corpo).replace(/\r\n/g, '\n').split('\n')) {
      if (riga.trim() === '') { doc.moveDown(0.6); continue; }
      if (eTitoletto(riga) || /:\s*$/.test(riga.trim()) && riga.trim().length < 60) {
        doc.font('Helvetica-Bold').fontSize(10.5).fillColor('#000000').text(riga.trim(), { align: 'left' });
      } else {
        doc.font('Helvetica').fontSize(10).fillColor('#111111').text(riga, { align: 'left', lineGap: 1.5 });
      }
    }

    if (riquadroFirma) {
      if (doc.y > doc.page.height - 190) doc.addPage();
      doc.moveDown(2.5);
      const larghezza = (doc.page.width - MARGINE * 2 - 30) / 2;
      const y = doc.y;
      doc.font('Helvetica').fontSize(9).fillColor('#333333');
      doc.text('Luogo e data', MARGINE, y, { width: larghezza });
      doc.text('Firma', MARGINE + larghezza + 30, y, { width: larghezza });
      doc.moveTo(MARGINE, y + 38).lineTo(MARGINE + larghezza, y + 38).strokeColor('#000000').lineWidth(0.6).stroke();
      doc.moveTo(MARGINE + larghezza + 30, y + 38).lineTo(MARGINE + larghezza * 2 + 30, y + 38).stroke();
    }

    // Numero di pagina in fondo a ognuna (serve a vedere se manca un foglio quando il documento torna firmato).
    const { count } = doc.bufferedPageRange();
    for (let i = 0; i < count; i++) {
      doc.switchToPage(i);
      doc.page.margins.bottom = 0; // scrivere nel margine in basso non deve aprire una pagina nuova
      doc.font('Helvetica').fontSize(8).fillColor('#777777');
      doc.text((piePagina ? piePagina + ' · ' : '') + 'Pagina ' + (i + 1) + ' di ' + count, MARGINE, doc.page.height - 38, { width: doc.page.width - MARGINE * 2, align: 'center', lineBreak: false });
    }
    doc.end();
  });
}

module.exports = { creaPdf, eTitoletto };
