'use strict';
// Genera la guida illustrata in PDF con l'identità grafica comune (lib/identita-pdf.js). Esegui da core/backend: node <percorso>/gen.js
const path = require('path'); const fs = require('fs');
const CORE = '/Users/nimakarimpour/Desktop/platform/core/backend';
const PDFDocument = require(CORE + '/node_modules/pdfkit');
const Database = require(CORE + '/node_modules/better-sqlite3');
const ID = require(CORE + '/src/lib/identita-pdf');
const SH = path.join(__dirname, 'small');
const OUT = process.argv[2] || path.join(__dirname, '..', 'Guida-illustrata.pdf');
const GUIDA = require('/Users/nimakarimpour/Desktop/platform/super-admin/backend/src/pacchetti/mediazione-immobiliare/guida.json');

const CAP = require('./cap.js');
const FLUSSI = GUIDA.flussi; const GLOS = GUIDA.glossario;

function pulisci(t) { return t.replace(/\*\*/g, ''); }
function riga(doc, testo, x, y, w, opts = {}) { // testo con **grassetto**
  const parti = testo.replace(/→/g, '>').split(/(\*\*[^*]+\*\*)/).filter(Boolean);
  parti.forEach((p, i) => { const b = p.startsWith('**'); doc.font(b ? 'Helvetica-Bold' : 'Helvetica'); const t = b ? p.slice(2, -2) : p; const o = { width: w, continued: i < parti.length - 1, ...opts }; if (i === 0) doc.text(t, x, y, o); else doc.text(t, o); });
  if (!parti.length) doc.text('', x, y);
}

(async () => {
  const db = new Database('/tmp/platform-core-dev.db', { readonly: true });
  const { azienda, logo } = await ID.caricaIdentita(db);
  const colore = ID.coloreValido(azienda.colore);
  const doc = new PDFDocument({ size: 'A4', margin: ID.M, bufferPages: true, info: { Title: 'Guida all\'uso illustrata', Producer: 'Platform' } });
  doc.pipe(fs.createWriteStream(OUT));
  const W = doc.page.width - ID.M * 2, X = ID.M, FONDO = doc.page.height - 60;
  const spazio = (h) => { if (doc.y + h > FONDO) { doc.addPage(); doc.y = ID.M; } };

  // Copertina
  ID.intestazione(doc, { azienda, logo, etichetta: 'Guida all\'uso', data: new Date().toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' }) });
  doc.y = 150;
  doc.font(ID.FONT_TITOLO).fontSize(30).fillColor(ID.TESTO).text('Guida all\'uso illustrata', X, 150, { width: W });
  doc.moveDown(0.3).font('Times-Italic').fontSize(15).fillColor(colore).text('Ogni azione, passo per passo, con le schermate', { width: W });
  doc.moveDown(1.4).font('Helvetica').fontSize(10.5).fillColor(ID.GRIGIO);
  doc.text('Questa guida spiega come si lavora con la piattaforma, un\'azione alla volta: cosa premere, cosa succede, cosa fare se qualcosa non va. Ogni capitolo ha le schermate vere dell\'applicazione.', { width: W, lineGap: 3 });
  doc.moveDown(0.8).text('Aggiornata alla versione 0.4.77. Le schermate sono prese da un ambiente di prova con dati di esempio (nessun dato reale); su telefono e su computer l\'aspetto cambia leggermente, ma i nomi dei pulsanti sono gli stessi.', { width: W, lineGap: 3 });
  doc.moveDown(1.6); ID.titoloSezione(doc, 'Cosa trovi', colore); doc.moveDown(0.9);
  let n = 1; for (const c of CAP) { doc.font('Helvetica-Bold').fontSize(11).fillColor(ID.TESTO).text(n + '.  ' + c.t, X + 8, doc.y, { width: W - 8, continued: true }).font('Helvetica').fillColor(ID.GRIGIO).text('   ' + c.intro); doc.moveDown(0.35); n++; }
  doc.font('Helvetica-Bold').fontSize(11).fillColor(ID.TESTO).text(n + '.  Il lavoro, passo per passo', X + 8, doc.y, { width: W - 8, continued: true }).font('Helvetica').fillColor(ID.GRIGIO).text('   I flussi completi: dal mandato al rogito, un nuovo cliente, dalla fattura all\'incasso.'); doc.moveDown(0.35);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(ID.TESTO).text((n + 1) + '.  Parole usate', X + 8, doc.y, { width: W - 8, continued: true }).font('Helvetica').fillColor(ID.GRIGIO).text('   Il glossario.');

  let fig = 0;
  const figura = (file, didascalia, { larg = 440, mobile = false } = {}) => {
    const p = path.join(SH, file + '.jpg'); if (!fs.existsSync(p)) return;
    const img = doc.openImage(p); const w = Math.min(larg, W), h = w * img.height / img.width, x0 = X + (W - w) / 2;
    spazio(h + 26); const y = doc.y;
    doc.save().roundedRect(x0 - 1, y - 1, w + 2, h + 2, 4).lineWidth(0.8).strokeColor('#d6d3d1').stroke().restore();
    doc.image(p, x0, y, { width: w }); doc.y = y + h + 5; fig++;
    doc.font('Helvetica-Oblique').fontSize(8.5).fillColor(ID.GRIGIO).text('Figura ' + fig + ' — ' + didascalia.replace(/→/g, '>'), x0, doc.y, { width: w }); doc.moveDown(0.7);
  };
  const figureAffiancate = (lista) => { // schermate da telefono, una accanto all'altra
    const k = lista.length, gap = 10, w = Math.min(150, (W - gap * (k - 1)) / k);
    const hh = lista.map(([f]) => { const p = path.join(SH, f + '.jpg'); if (!fs.existsSync(p)) return 0; const i = doc.openImage(p); return w * i.height / i.width; });
    const H = Math.max(...hh); spazio(H + 40); const y = doc.y;
    lista.forEach(([f, d], i) => { const p = path.join(SH, f + '.jpg'); if (!fs.existsSync(p)) return; const x = X + i * (w + gap); doc.save().roundedRect(x - 1, y - 1, w + 2, hh[i] + 2, 6).lineWidth(0.8).strokeColor('#d6d3d1').stroke().restore(); doc.image(p, x, y, { width: w }); fig++; doc.font('Helvetica-Oblique').fontSize(8).fillColor(ID.GRIGIO).text('Figura ' + fig + ' — ' + d.replace(/→/g, '>'), x, y + hh[i] + 4, { width: w }); });
    doc.y = y + H + 36;
  };

  let cn = 0;
  for (const c of CAP) {
    cn++; doc.addPage(); doc.y = ID.M;
    doc.font(ID.FONT_TITOLO).fontSize(22).fillColor(colore).text(cn + '. ' + c.t, X, doc.y, { width: W });
    doc.moveDown(0.2).font('Times-Italic').fontSize(12).fillColor(ID.GRIGIO).text(c.intro, { width: W });
    doc.moveTo(X, doc.y + 6).lineTo(X + W, doc.y + 6).lineWidth(0.6).strokeColor(ID.LINEA).stroke(); doc.moveDown(1);
    let an = 0;
    for (const a of c.az) {
      an++;
      spazio(120);
      ID.titoloSezione(doc, cn + '.' + an + '  ' + a.t, colore); doc.moveDown(0.8);
      doc.fontSize(10).fillColor(ID.TESTO);
      a.passi.forEach((p, i) => { spazio(34); const y = doc.y; doc.circle(X + 7, y + 6, 7).fill(colore); doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#ffffff').text(String(i + 1), X, y + 3, { width: 14, align: 'center', lineBreak: false }); doc.fillColor(ID.TESTO).fontSize(10); riga(doc, p, X + 22, y, W - 22, { lineGap: 2 }); doc.moveDown(0.45); });
      if (a.nota) { spazio(40); const y = doc.y; const hh = doc.heightOfString(a.nota, { width: W - 24, lineGap: 2 }) + 12; doc.roundedRect(X, y, W, hh, 4).fill('#fffbeb'); doc.rect(X, y, 3, hh).fill('#f59e0b'); doc.font('Helvetica').fontSize(9.5).fillColor(ID.TESTO).text('Da sapere: ' + a.nota.replace(/→/g, '>'), X + 12, y + 6, { width: W - 24, lineGap: 2 }); doc.y = y + hh + 8; }
      doc.moveDown(0.4);
      if (a.mobile) { const mob = a.fig.filter(([f]) => f.startsWith('m')), desk = a.fig.filter(([f]) => !f.startsWith('m')); desk.forEach(([f, d]) => figura(f, d)); if (mob.length) figureAffiancate(mob); }
      else a.fig.forEach(([f, d]) => figura(f, d));
      doc.moveDown(0.8);
    }
  }

  // Flussi
  doc.addPage(); doc.y = ID.M; doc.font(ID.FONT_TITOLO).fontSize(22).fillColor(colore).text((cn + 1) + '. Il lavoro, passo per passo', X, doc.y, { width: W });
  doc.moveDown(0.2).font('Times-Italic').fontSize(12).fillColor(ID.GRIGIO).text('I tre percorsi che ripeti più spesso.', { width: W }); doc.moveDown(1);
  for (const f of FLUSSI) { spazio(150); ID.titoloSezione(doc, f.titolo, colore); doc.moveDown(0.8); f.passi.forEach((p, i) => { spazio(30); const y = doc.y; doc.circle(X + 7, y + 6, 7).fill(colore); doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#ffffff').text(String(i + 1), X, y + 3, { width: 14, align: 'center', lineBreak: false }); doc.fillColor(ID.TESTO).fontSize(10); riga(doc, p, X + 22, y, W - 22, { lineGap: 2 }); doc.moveDown(0.45); }); doc.moveDown(0.9); }

  // Glossario
  doc.addPage(); doc.y = ID.M; doc.font(ID.FONT_TITOLO).fontSize(22).fillColor(colore).text((cn + 2) + '. Parole usate', X, doc.y, { width: W }); doc.moveDown(1);
  for (const g of GLOS) { spazio(46); doc.font('Helvetica-Bold').fontSize(10.5).fillColor(ID.TESTO).text(g.termine, X, doc.y, { width: W }); doc.font('Helvetica').fontSize(10).fillColor(ID.GRIGIO).text(g.significato, { width: W, lineGap: 2 }); doc.moveDown(0.7); }

  ID.pieDiPagina(doc, { azienda, riserva: 'Guida all\'uso', colore });
  doc.end();
  await new Promise((r) => setTimeout(r, 1500));
  console.log('scritto', OUT, fs.statSync(OUT).size, 'byte,', doc.bufferedPageRange().count, 'pagine,', fig, 'figure');
})().catch((e) => { console.error(e); process.exit(1); });
