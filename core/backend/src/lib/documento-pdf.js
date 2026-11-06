'use strict';
// Trasforma il testo di un «documento da modello» approvato in un PDF da scaricare, stampare e
// firmare, impaginato come il modello grafico dell'azienda: fascia con logo, titolo in serif con
// filetto, SCHEDE con intestazione sfumata e icona, campi con la riga su cui scrivere, voci con icona
// rotonda, riquadro dei consensi, firma. Nessun linguaggio nuovo: si legge il testo già approvato.
//   riga in maiuscolo (anche se segue una parentesi) o che finisce con «:»  → apre una SCHEDA
//   «Etichetta: valore» (più campi sulla stessa riga se separati da due o più spazi) → campo con la riga
//   «Etichetta: testo lungo» → voce con icona rotonda, titoletto colorato e paragrafo
//   «[X] testo» / «[ ] testo» → casella da spuntare (la scheda diventa «dei consensi»)
//   un titoletto subito dopo un altro titoletto → sottovoce della scheda (con le righe che seguono)
//   prima riga in maiuscolo → sottotitolo; righe «Etichetta: valore» prima della prima scheda → scheda
//   intestata alla prima etichetta
//   Una scheda di soli campi, seguita da una di voci, si affiancano su due colonne.
// L'aspetto comune (fascia, colori, piè di pagina) è in lib/identita-pdf.js. Nessun nome di modulo o
// campo qui. Corpo in Helvetica integrata (copre le lettere accentate italiane).

const PDFDocument = require('pdfkit');
const { M, ALTEZZA_FASCIA, TESTO, FONT_TITOLO, coloreValido, tinta, accento, intestazione, pieDiPagina } = require('./identita-pdf');

function eTitoletto(riga) {
  const t = riga.trim();
  if (t.length < 3 || t.length > 140) return false;
  // Conta la parte prima di un'eventuale parentesi: «COME USIAMO I SUOI DATI (art. 13 …)» è un titoletto.
  const testa = t.replace(/\s*\(.*$/, '').trim();
  return testa.length >= 3 && testa.length <= 80 && testa === testa.toUpperCase() && /[A-ZÀ-Ý]/.test(testa) && !/^\[[ X]\]/.test(t);
}
const eIntestazione = (riga) => eTitoletto(riga) || (/:\s*$/.test(riga.trim()) && riga.trim().length < 60);
const eDaCompilare = (v) => /^[_\s/—-]*$/.test(v);

// «Etichetta: valore» (una o più celle sulla riga) oppure null se la riga è un paragrafo.
function celle(riga) {
  const pezzi = riga.trim().split(/\s{2,}/);
  if (pezzi.length > 5) return null;
  const out = [];
  for (const p of pezzi) {
    const m = /^([^:]{1,42}):\s*(.*)$/.exec(p);
    if (!m || /^[a-z]\)/.test(m[1])) return null;
    out.push({ etichetta: m[1].trim(), valore: m[2].trim() });
  }
  return out;
}

const senzaDueP = (t) => t.replace(/:$/, '').trim();
// Titolo = parte prima di una parentesi finale; nota = ciò che sta tra parentesi.
function dividiTitolo(t) { const m = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(t); return m && m[1] ? { titolo: m[1], nota: m[2] } : { titolo: t, nota: '' }; }

function voceDa(riga) {
  const cs = /^\s*\[( |x|X)\]\s*(.*)$/.exec(riga);
  if (cs) return { t: 'casella', spuntata: cs[1] !== ' ', testo: cs[2] };
  const lista = celle(riga);
  if (lista && lista.length === 1 && lista[0].valore.length > 55 && !eDaCompilare(lista[0].valore)) return { t: 'voce', etichetta: lista[0].etichetta, valore: lista[0].valore };
  if (lista) return { t: 'celle', lista };
  return { t: 'testo', testo: riga };
}

// Righe → { sottotitolo, sezioni:[{titolo, nota, voci}] } già ripulite.
function struttura(corpo) {
  const righe = String(corpo == null ? '' : corpo).replace(/\r\n/g, '\n').split('\n');
  const sezioni = [], intro = [];
  let corrente = null, sottotitolo = null, primaRiga = true, indenta = false;
  const vuotaCorrente = () => corrente && corrente.voci.every((v) => v.t === 'spazio');
  for (const riga of righe) {
    const vuota = riga.trim() === '';
    if (primaRiga && !vuota) { primaRiga = false; if (eTitoletto(riga)) { sottotitolo = riga.trim(); continue; } }
    if (!vuota && eIntestazione(riga)) {
      if (vuotaCorrente() && sezioni.length) { corrente.voci = [{ t: 'voce', etichetta: senzaDueP(riga.trim()), valore: '', sub: true }]; indenta = true; continue; }
      const d = dividiTitolo(senzaDueP(riga.trim()));
      corrente = { titolo: d.titolo, nota: d.nota, voci: [] }; sezioni.push(corrente); indenta = false; continue;
    }
    const voce = vuota ? { t: 'spazio' } : voceDa(riga);
    if (voce.t === 'voce') indenta = false;
    if (indenta && (voce.t === 'testo' || voce.t === 'casella')) voce.indent = true;
    if (voce.sub) indenta = true;
    if (corrente) corrente.voci.push(voce); else intro.push(voce);
  }
  // Righe prima della prima scheda: una scheda. Se la prima è «Etichetta: valore» già compilato (es. «Titolare del
  // trattamento: …») la scheda prende quell'etichetta come titolo; altrimenti si chiama «Riferimenti».
  const introUtili = intro.filter((v) => v.t !== 'spazio');
  if (introUtili.some((v) => v.t === 'celle' || v.t === 'voce')) {
    const primo = introUtili[0];
    const unico = primo.t === 'celle' && primo.lista.length === 1 && !eDaCompilare(primo.lista[0].valore);
    if (unico) sezioni.unshift({ titolo: primo.lista[0].etichetta, nota: '', voci: [{ t: 'testo', testo: primo.lista[0].valore }, ...introUtili.slice(1)] });
    else sezioni.unshift({ titolo: 'Riferimenti', nota: '', voci: introUtili });
  } else if (introUtili.length) sezioni.unshift({ libero: true, titolo: '', nota: '', voci: intro }); // solo paragrafi: restano paragrafi, senza scheda
  for (const s of sezioni) { while (s.voci.length && s.voci[s.voci.length - 1].t === 'spazio') s.voci.pop(); while (s.voci.length && s.voci[0].t === 'spazio') s.voci.shift(); }
  return { sottotitolo, sezioni };
}

const soloCampi = (s) => s.voci.length >= 3 && s.voci.every((v) => v.t === 'celle' && v.lista.length === 1);
const conVoci = (s) => s.voci.some((v) => v.t === 'voce');
const haCaselle = (s) => s.voci.some((v) => v.t === 'casella');
// La linguetta scura è del riquadro dei consensi; una scheda con caselle di altro tipo (es. «coperto / da fare») ha l'intestazione normale.
const eConsensi = (s) => haCaselle(s) && /consens|dichiaraz|accett/i.test(s.titolo);

// Glifo dalle parole del titolo (sezione o voce).
function glifo(titolo) {
  const t = String(titolo).toLowerCase();
  if (/immobil|localizz|catast|urbanist|casa|ubicaz/.test(t)) return 'casa';
  if (/privacy|informativa|riservatezza|gdpr|sintesi/.test(t)) return 'scudo';
  if (/consens|dichiaraz/.test(t)) return 'spunta';
  if (/finalit/.test(t)) return 'bersaglio';
  if (/base giuridic|legittim|norm/.test(t)) return 'bilancia';
  if (/conserv|durata|tempi/.test(t)) return 'orologio';
  if (/destinatar|soggett|comunicaz|diffusion/.test(t)) return 'persone';
  if (/diritti|sicurezz|protez/.test(t)) return 'lucchetto';
  if (/titolare|trattamento|document/.test(t)) return 'documento';
  if (/anagraf|dati|cliente|propriet|person/.test(t)) return 'utente';
  return 'documento';
}

// Tratti del glifo `nome` dentro un riquadro 22×22 che parte dall'origine corrente.
function tratti(doc, nome) {
  switch (nome) {
    case 'scudo': doc.path('M11 4 L17 6.5 V11 C17 15 14 17.5 11 19 C8 17.5 5 15 5 11 V6.5 Z').stroke().path('M8.3 11.2 L10.3 13.2 L13.8 9.2').stroke(); break;
    case 'utente': doc.circle(11, 8, 3.2).stroke().path('M5 18 C5 14 8 12.5 11 12.5 C14 12.5 17 14 17 18').stroke(); break;
    case 'spunta': doc.roundedRect(5, 5, 12, 12, 2).stroke().path('M8 11 L10.2 13.4 L14.2 8.4').stroke(); break;
    case 'casa': doc.path('M4.5 11 L11 5 L17.5 11').stroke().path('M6.5 9.8 V17 H15.5 V9.8').stroke().rect(9.5, 12.5, 3, 4.5).stroke(); break;
    case 'bersaglio': doc.circle(11, 11, 6.5).stroke().circle(11, 11, 3.4).stroke().circle(11, 11, 0.7).stroke(); break;
    case 'bilancia': doc.path('M11 4.5 V17.5').stroke().path('M7 17.5 H15').stroke().path('M5 7.5 H17').stroke().path('M5 7.5 L3 12.5 H7 Z').stroke().path('M17 7.5 L15 12.5 H19 Z').stroke(); break;
    case 'orologio': doc.circle(11, 11, 7).stroke().path('M11 7 V11 L14 13').stroke(); break;
    case 'persone': doc.circle(8, 8.5, 2.5).stroke().circle(15, 9.5, 2).stroke().path('M3.5 17 C3.5 13.5 6 12.5 8 12.5 C10 12.5 12.5 13.5 12.5 17').stroke().path('M13 13 C16 12.5 18.5 14 18.5 17').stroke(); break;
    case 'lucchetto': doc.roundedRect(6, 10, 10, 7.5, 1.5).stroke().path('M8 10 V8 C8 5.5 14 5.5 14 8 V10').stroke(); break;
    case 'penna': doc.path('M5 17 L6 13.5 L14.5 5 L17 7.5 L8.5 16 Z').stroke().path('M13 6.5 L15.5 9').stroke(); break;
    case 'calendario': doc.roundedRect(4.5, 6, 13, 11.5, 2).stroke().path('M4.5 10 H17.5').stroke().path('M8 4.5 V7.5').stroke().path('M14 4.5 V7.5').stroke(); break;
    default: doc.rect(6, 4, 10, 14).stroke().path('M8 8 L14 8').stroke().path('M8 11 L14 11').stroke().path('M8 14 L12 14').stroke();
  }
}
// Badge: quadrato pieno con glifo bianco, oppure cerchio chiaro con glifo del colore.
function badge(doc, x, y, lato, nome, colore, tipo) {
  const k = lato / 22;
  if (tipo === 'pieno') doc.roundedRect(x, y, lato, lato, lato * 0.24).fill(colore);
  else doc.circle(x + lato / 2, y + lato / 2, lato / 2).fill(tinta(accento(colore), 0.14));
  doc.save().translate(x, y).scale(k).lineWidth(1.3 / k).strokeColor(tipo === 'pieno' ? '#ffffff' : colore).lineJoin('round').lineCap('round');
  tratti(doc, nome);
  doc.restore();
}

// `azienda`: { nome, indirizzo, piva, colore } (o solo il nome, come stringa); `logo`: Buffer PNG/JPEG o null.
// → Promise<Buffer>
function creaPdf({ titolo, corpo, azienda, logo = null, etichetta = 'Documento', riquadroFirma = true, piePagina = '' }) {
  const az = typeof azienda === 'string' ? { nome: azienda } : (azienda || {});
  const colore = coloreValido(az.colore);
  const vivo = accento(colore), bordo = tinta(vivo, 0.3), chiaro = tinta(vivo, 0.14), chiaro2 = tinta(vivo, 0.24);
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: M, bufferPages: true, info: { Title: String(titolo || 'Documento'), Producer: 'Platform' } });
    const pezzi = [];
    doc.on('data', (p) => pezzi.push(p));
    doc.on('end', () => resolve(Buffer.concat(pezzi)));
    doc.on('error', reject);
    const W = doc.page.width - M * 2;
    const FONDO = doc.page.height - 66;
    const PAD = 14, GAP = 14, TESTA = 40;

    intestazione(doc, { azienda: az, logo, etichetta, data: new Date().toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' }) });
    doc.on('pageAdded', () => { doc.rect(0, 0, doc.page.width, 6).fill(colore); doc.y = M; });

    // ── Titolo, filetto azzurro, sottotitolo ──
    const { sottotitolo, sezioni } = struttura(corpo);
    const dt = dividiTitolo(String(titolo || 'Documento'));
    const yT = ALTEZZA_FASCIA + 22;
    if (dt.nota) {
      doc.font(FONT_TITOLO).fontSize(27).fillColor(TESTO).text(dt.titolo + ' ', M, yT, { width: W, continued: true });
      doc.font(FONT_TITOLO).fontSize(17).fillColor('#44403c').text('(' + dt.nota + ')', { continued: false });
    } else doc.font(FONT_TITOLO).fontSize(27).fillColor(TESTO).text(dt.titolo, M, yT, { width: W });
    doc.roundedRect(M, doc.y + 6, 46, 4, 2).fill(vivo);
    doc.y += 20;
    if (sottotitolo) doc.font('Helvetica').fontSize(11.5).fillColor('#1c1917').text(sottotitolo, M, doc.y, { width: W, characterSpacing: 0.9 });
    doc.y += 14;

    // ── Misura e disegno delle voci ──
    let denso = false; // schede affiancate: testo e righe più compatti
    const fs = () => (denso ? 9 : 10), riga = () => (denso ? 21 : 26);
    const larghEtichetta = (c) => { doc.font('Helvetica').fontSize(fs()); return doc.widthOfString(c.etichetta) + 8; };
    const misura = (v, w) => {
      doc.font('Helvetica').fontSize(fs());
      const wt = v.indent ? w - 38 : w;
      if (v.t === 'spazio') return 4;
      if (v.t === 'casella') return Math.max(22, doc.heightOfString(v.testo, { width: wt - 28, lineGap: 1.5 }) + 8);
      if (v.t === 'testo') return doc.heightOfString(v.testo, { width: wt, lineGap: 1.5 }) + 4;
      if (v.t === 'voce') return v.valore ? Math.max(denso ? 30 : 34, 14 + doc.heightOfString(v.valore, { width: w - 42, lineGap: 1.3 }) + (denso ? 6 : 10)) : (denso ? 30 : 34);
      const cw = (w - GAP * (v.lista.length - 1)) / v.lista.length;
      return Math.max(...v.lista.map((c) => {
        const lw = larghEtichetta(c);
        doc.font('Helvetica').fontSize(fs());
        return eDaCompilare(c.valore) ? riga() : Math.max(riga() - 2, doc.heightOfString(c.valore, { width: Math.max(30, cw - lw), lineGap: 1.2 }) + 12);
      }));
    };
    const disegna = (v, x, y, w, primo) => {
      if (v.t === 'spazio') return;
      const wt = v.indent ? w - 38 : w, xt = v.indent ? x + 38 : x;
      if (v.t === 'casella') {
        doc.roundedRect(xt + 1, y + 3, 14, 14, 3.5).lineWidth(1.2).strokeColor(colore).stroke();
        if (v.spuntata) doc.moveTo(xt + 4, y + 10.5).lineTo(xt + 7.4, y + 14).lineTo(xt + 12.4, y + 6.4).lineWidth(1.8).strokeColor(colore).stroke();
        doc.font('Helvetica').fontSize(10.5).fillColor('#1c1917').text(v.testo, xt + 28, y + 4, { width: wt - 28, lineGap: 1.5 });
      } else if (v.t === 'testo') {
        doc.font('Helvetica').fontSize(fs()).fillColor('#1c1917').text(v.testo, xt, y, { width: wt, lineGap: 1.5 });
      } else if (v.t === 'voce') {
        if (!primo) doc.moveTo(x + 40, y - 3).lineTo(x + w, y - 3).lineWidth(0.5).strokeColor(bordo).stroke();
        badge(doc, x, y + 1, 28, glifo(v.etichetta), colore, 'chiaro');
        doc.font('Helvetica-Bold').fontSize(denso ? 10 : 11).fillColor(colore).text(v.etichetta, x + 38, y + (v.valore ? 1 : 8), { width: w - 42, lineBreak: false });
        if (v.valore) doc.font('Helvetica').fontSize(fs()).fillColor('#1c1917').text(v.valore, x + 38, y + 14, { width: w - 42, lineGap: 1.3 });
      } else {
        const cw = (w - GAP * (v.lista.length - 1)) / v.lista.length;
        v.lista.forEach((c, i) => {
          const cx = x + i * (cw + GAP), lw = larghEtichetta(c);
          const hc = Math.min(riga(), misura({ t: 'celle', lista: [c] }, cw));
          doc.font('Helvetica').fontSize(fs()).fillColor('#1c1917').text(c.etichetta, cx, y + (denso ? 6 : 8), { width: lw + 4, lineBreak: false });
          doc.moveTo(cx + lw, y + hc - 4).lineTo(cx + cw, y + hc - 4).lineWidth(eDaCompilare(c.valore) ? 0.8 : 0.5).strokeColor(eDaCompilare(c.valore) ? colore : bordo).stroke(); // riga piena solo dove si scrive
          if (!eDaCompilare(c.valore)) doc.font('Helvetica').fontSize(fs()).fillColor('#1c1917').text(c.valore, cx + lw + 2, y + (denso ? 6 : 8), { width: Math.max(30, cw - lw - 2), lineGap: 1.2 });
        });
      }
    };

    // ── Una scheda (x, y, larghezza w, altezza h): sfondo con ombra, intestazione sfumata, icona, titolo ──
    const LINGUETTA = (w) => Math.min(w * 0.62, 190);
    const cornice = (sez, x, y, w, h, seguito) => {
      doc.save().fillOpacity(0.07).roundedRect(x + 1.5, y + 2.5, w, h, 10).fill('#0f172a').restore();
      doc.roundedRect(x, y, w, h, 10).lineWidth(0.9).fillAndStroke('#ffffff', bordo);
      doc.save().roundedRect(x + 0.45, y + 0.45, w - 0.9, TESTA, 9.5).clip();
      const g = doc.linearGradient(x, y, x + w, y); g.stop(0, chiaro).stop(1, chiaro2);
      doc.rect(x, y, w, TESTA).fill(g);
      const consensi = eConsensi(sez);
      if (consensi) doc.polygon([x, y], [x + LINGUETTA(w), y], [x + LINGUETTA(w) - 16, y + TESTA], [x, y + TESTA]).fill(colore); // linguetta scura col taglio diagonale
      doc.restore();
      doc.moveTo(x, y + TESTA).lineTo(x + w, y + TESTA).lineWidth(0.6).strokeColor(bordo).stroke();
      badge(doc, x + 9, y + 6, 28, glifo(sez.titolo), colore, 'pieno');
      const titoloTesto = (sez.titolo + (seguito ? ' (segue)' : '')).toUpperCase();
      if (sez.nota && !consensi) {
        doc.font('Helvetica-Bold').fontSize(12).fillColor(colore).text(titoloTesto, x + 46, y + 9, { width: w - 56, lineBreak: false });
        doc.font('Helvetica').fontSize(9.5).fillColor('#44403c').text('(' + sez.nota + ')', x + 46, y + 24, { width: w - 56, lineBreak: false });
      } else {
        doc.font('Helvetica-Bold').fontSize(12).fillColor(consensi ? '#ffffff' : colore).text(titoloTesto, x + 46, y + 14, { width: consensi ? LINGUETTA(w) - 62 : w - 56, lineBreak: false });
        if (sez.nota && consensi) doc.font('Helvetica-Oblique').fontSize(8.5).fillColor('#44403c').text('(' + sez.nota + ')', x + LINGUETTA(w) + 6, y + 16, { width: w - LINGUETTA(w) - 16, align: 'right', lineBreak: false });
      }
    };

    // Quante voci (da i) stanno nella scheda e quanto è alta; max = quota oltre cui non si può scendere.
    const riempi = (sez, i, w, y, max) => {
      const wi = w - PAD * 2;
      let h = TESTA + 10, fine = i;
      while (fine < sez.voci.length) {
        const hv = misura(sez.voci[fine], wi);
        if (y + h + hv + 10 > max && fine > i) break;
        h += hv; fine++;
      }
      return { h: h + 10, fine };
    };
    const contenuto = (sez, da, a, x, y, w) => {
      const wi = w - PAD * 2;
      let yy = y + TESTA + 10, primoVoce = true;
      for (let k = da; k < a; k++) {
        const v = sez.voci[k];
        if (v.t === 'testo' && k > da && !v.indent && sez.voci.slice(0, k).filter((x) => x.t !== 'spazio').pop().t === 'casella') { // dichiarazione finale: filetto, penna e corsivo
          doc.moveTo(x + PAD, yy + 2).lineTo(x + w - PAD, yy + 2).lineWidth(0.5).strokeColor(bordo).stroke();
          doc.save().translate(x + PAD, yy + 8).scale(0.85).lineWidth(1.2).strokeColor(colore).lineJoin('round').lineCap('round'); tratti(doc, 'penna'); doc.restore();
          doc.font('Helvetica-Oblique').fontSize(10.5).fillColor('#1c1917').text(v.testo, x + PAD + 28, yy + 11, { width: wi - 28 });
          yy += 11 + doc.heightOfString(v.testo, { width: wi - 28 }) + 6;
          continue;
        }
        disegna(v, x + PAD, yy, wi, primoVoce && v.t === 'voce');
        if (v.t === 'voce') primoVoce = false;
        yy += misura(v, wi);
      }
    };

    // Due schede affiancate (campi a sinistra, voci a destra), alte uguali.
    const coppia = (a, b) => {
      const wa = Math.round((W - GAP) * 0.43), wb = W - GAP - wa;
      denso = true;
      const h = Math.max(riempi(a, 0, wa, doc.y, 1e9).h, riempi(b, 0, wb, doc.y, 1e9).h);
      if (doc.y + h > FONDO) doc.addPage();
      const y = doc.y;
      cornice(a, M, y, wa, h, false); contenuto(a, 0, a.voci.length, M, y, wa);
      cornice(b, M + wa + GAP, y, wb, h, false); contenuto(b, 0, b.voci.length, M + wa + GAP, y, wb);
      denso = false;
      doc.y = y + h + 14;
    };
    // Una scheda a tutta larghezza; se non entra continua nella pagina dopo con «(segue)».
    const scheda = (sez) => {
      let i = 0, primo = true;
      while (primo || i < sez.voci.length) {
        if (doc.y + TESTA + 36 > FONDO) doc.addPage();
        const y = doc.y;
        const { h, fine } = riempi(sez, i, W, y, FONDO);
        cornice(sez, M, y, W, h, !primo);
        contenuto(sez, i, fine, M, y, W);
        doc.y = y + h + 14;
        primo = false;
        if (fine === i) break;
        i = fine;
      }
    };

    // Testo senza titoletti: paragrafi liberi che scorrono da una pagina all'altra.
    const libero = (sez) => {
      for (const v of sez.voci) {
        const h = misura(v, W);
        if (doc.y + h > FONDO) doc.addPage();
        disegna(v, M, doc.y, W, false);
        doc.y += h;
      }
      doc.y += 8;
    };

    for (let k = 0; k < sezioni.length; k++) {
      const s = sezioni[k], n = sezioni[k + 1];
      if (s.libero) { libero(s); continue; }
      if (n && soloCampi(s) && conVoci(n) && !eConsensi(n)) { coppia(s, n); k++; } else scheda(s);
    }

    // ── Luogo e data / Firma, con le loro icone ──
    if (riquadroFirma) {
      if (doc.y > FONDO - 90) doc.addPage();
      doc.y += 8;
      const larghezza = (W - 50) / 2, y = doc.y;
      [['Luogo e data', 'calendario', M], ['Firma', 'penna', M + larghezza + 50]].forEach(([testo, g, x]) => {
        doc.save().translate(x, y - 2).lineWidth(1.2).strokeColor(colore).lineJoin('round').lineCap('round'); tratti(doc, g); doc.restore();
        doc.font('Helvetica').fontSize(10.5).fillColor('#1c1917').text(testo, x + 28, y + 3, { width: larghezza - 28, lineBreak: false });
        doc.moveTo(x, y + 44).lineTo(x + larghezza, y + 44).lineWidth(0.9).strokeColor(colore).stroke();
      });
    }

    pieDiPagina(doc, { azienda: az, riserva: piePagina, colore });
    doc.end();
  });
}

module.exports = { creaPdf, eTitoletto };
