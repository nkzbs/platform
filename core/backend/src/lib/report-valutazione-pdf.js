'use strict';
// PDF «Report di valutazione» con grafica: intestazione con logo e colore dell'azienda, riquadri
// con le quotazioni, tabelle (OMI, comparabili), barre (mercato, tempi, annunci) e la mappa di OpenStreetMap con i luoghi utili vicini.
// Parte dal report GIÀ salvato sul record: non chiama OpenAPI.it (nessun credito consumato). Per la mappa chiede solo le tessere a OpenStreetMap (lib/mappa-pdf.js,
// gratuite, con cache) e legge i luoghi vicini dalla cache di lib/servizi-vicini.js (se non ci sono ancora li fa cercare in secondo plano: il report non aspetta). L'identità grafica (fascia, logo, piè di pagina)
// è in lib/identita-pdf.js, comune a tutti i PDF. Nessun nome di azienda qui:
// logo, colore e dati vengono da `azienda` (Impostazioni → Azienda).

const PDFDocument = require('pdfkit');

const { M, GRIGIO, CHIARO, LINEA, TESTO, coloreValido, caricaLogo, intestazione, pieDiPagina } = require('./identita-pdf');
const mappaPdf = require('./mappa-pdf');

const num = (n) => (n == null || n === '' || isNaN(Number(n)) ? '—' : String(Math.round(Number(n))).replace(/\B(?=(\d{3})+(?!\d))/g, '.'));
const euro = (n) => (num(n) === '—' ? '—' : num(n) + ' €');
const pct = (n) => (n == null || n === '' || isNaN(Number(n)) ? '—' : String(Math.round(Number(n) * 10) / 10).replace('.', ',') + '%');
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-zà-ú0-9]/g, '');

// → Promise<Buffer>. Prima raccoglie mappa e luoghi vicini (senza mai bloccare il report se non ci sono), poi costruisce il PDF.
async function creaPdfReport(args) {
  const co = ((args.report || {}).dettaglio || {}).coordinate || {};
  const haCoordinate = isFinite(Number(co.lat)) && isFinite(Number(co.lng)) && co.lat != null && co.lng != null;
  let mappa = null, servizi = null, serviziInCorso = false;
  if (haCoordinate) {
    try { const sv = require('./servizi-vicini').stato(co.lat, co.lng); if (sv.pronto) servizi = sv.categorie; else serviziInCorso = !!sv.in_corso; } catch (e) { /* senza luoghi vicini il report resta valido */ }
    try { mappa = await mappaPdf.preparaMappa(co.lat, co.lng, { w: 595.28 - M * 2, h: 250 }); } catch (e) { mappa = null; }
  }
  return costruisciPdf({ ...args, mappa, servizi, serviziInCorso, haCoordinate });
}

function costruisciPdf({ record, report, azienda = {}, logo = null, mappa = null, servizi = null, serviziInCorso = false, haCoordinate = false }) {
  return new Promise((resolve, reject) => {
    const d = (record && record.data) || {};
    const r = report || {};
    const det = r.dettaglio || {};
    const q = det.quotazione || {};
    const demo = det.demografico || {};
    const med = parseFloat(String(q.med || '').replace(/[^0-9.]/g, '')) || null;
    const mq = parseFloat(d.superficie_mq) || null;
    const colore = coloreValido(azienda.colore);
    const W = 595.28 - M * 2;

    const doc = new PDFDocument({ size: 'A4', margin: M, bufferPages: true, info: { Title: 'Report di valutazione — ' + (d.titolo || 'Immobile'), Producer: 'Platform' } });
    const pezzi = [];
    doc.on('data', (p) => pezzi.push(p));
    doc.on('end', () => resolve(Buffer.concat(pezzi)));
    doc.on('error', reject);

    const spazio = (h) => { if (doc.y + h > doc.page.height - 70) doc.addPage(); };
    const titoloSezione = (t, voci = 0) => {
      spazio(50 + voci * 15); // titolo e prime righe restano insieme
      doc.moveDown(0.6);
      const y = doc.y;
      doc.rect(M, y, 4, 15).fill(colore);
      doc.font('Times-Bold').fontSize(14).fillColor(TESTO).text(t, M + 12, y, { width: W - 12 });
      doc.moveDown(0.5);
    };
    const riga = (etichetta, valore) => {
      spazio(16);
      const y = doc.y;
      doc.font('Helvetica').fontSize(9.5).fillColor(GRIGIO).text(etichetta, M, y, { width: 190 });
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor(TESTO).text(String(valore), M + 195, y, { width: W - 195 });
    };
    // Barre orizzontali: etichetta | barra proporzionale al massimo | valore.
    const barre = (voci) => {
      const massimo = Math.max(...voci.map((v) => v.valore), 1);
      for (const v of voci) {
        spazio(16);
        const y = doc.y;
        doc.font('Helvetica').fontSize(9).fillColor(GRIGIO).text(v.etichetta, M, y + 1, { width: 120 });
        doc.rect(M + 125, y + 2, W - 125 - 120, 9).fill(CHIARO);
        doc.rect(M + 125, y + 2, Math.max(2, (W - 125 - 120) * (v.valore / massimo)), 9).fill(colore);
        doc.font('Helvetica-Bold').fontSize(9).fillColor(TESTO).text(v.testo, M + W - 112, y + 1, { width: 112, align: 'right' });
        doc.y = y + 15;
      }
    };
    const tabella = (colonne, righe) => {
      const tot = colonne.reduce((s, c) => s + c.w, 0);
      const largh = colonne.map((c) => (c.w / tot) * W);
      const disegnaTesta = () => {
        const y = doc.y;
        doc.rect(M, y, W, 18).fill(colore);
        let x = M;
        colonne.forEach((c, i) => { doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#ffffff').text(c.titolo, x + 6, y + 5, { width: largh[i] - 12, align: c.dx ? 'right' : 'left', lineBreak: false }); x += largh[i]; });
        doc.y = y + 18;
      };
      spazio(60);
      disegnaTesta();
      righe.forEach((rg, n) => {
        if (doc.y + 18 > doc.page.height - 70) { doc.addPage(); disegnaTesta(); }
        const y = doc.y;
        if (n % 2 === 0) doc.rect(M, y, W, 18).fill(CHIARO);
        let x = M;
        rg.forEach((cella, i) => { doc.font('Helvetica').fontSize(8.5).fillColor(TESTO).text(String(cella), x + 6, y + 5, { width: largh[i] - 12, align: colonne[i].dx ? 'right' : 'left', lineBreak: false, ellipsis: true }); x += largh[i]; });
        doc.y = y + 18;
      });
    };

    // ── Intestazione (identità comune a tutti i PDF) ──
    intestazione(doc, { azienda, logo, etichetta: 'Report di valutazione', data: d.stima_data ? new Date(d.stima_data).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' }) : '' });

    // ── Immobile ──
    doc.y = 100;
    doc.font('Times-Bold').fontSize(24).fillColor(TESTO).text(d.titolo || 'Immobile', M, doc.y, { width: W });
    const indirizzo = [d.indirizzo, d.numero_civico, d.cap, d.comune, d.provincia && '(' + d.provincia + ')'].filter(Boolean).join(' ');
    if (indirizzo) doc.font('Helvetica').fontSize(11).fillColor(GRIGIO).text(indirizzo, M, doc.y + 2, { width: W });
    const caratt = [d.tipologia, mq && num(mq) + ' mq', d.locali && d.locali + ' locali', d.piano && 'piano ' + d.piano, d.anno_costruzione && 'del ' + d.anno_costruzione, d.classe_energetica && 'classe ' + d.classe_energetica].filter(Boolean).join('  ·  ');
    if (caratt) doc.font('Helvetica').fontSize(9.5).fillColor(GRIGIO).text(caratt, M, doc.y + 4, { width: W });
    doc.moveDown(0.8);

    // Avviso se i dati di mercato sono di un altro luogo.
    if (d.comune && det.citta && norm(d.comune) !== norm(det.citta)) {
      const y = doc.y;
      const testo = 'Attenzione: i dati di mercato si riferiscono a «' + (det.formatted || det.citta) + '», che non coincide con il comune indicato sull\'immobile (' + d.comune + '). Controllare l\'indirizzo e rifare la valutazione prima di usarli.';
      const h = doc.heightOfString(testo, { width: W - 20, font: 'Helvetica' }) + 14;
      doc.roundedRect(M, y, W, h, 4).fill('#fef3c7');
      doc.font('Helvetica').fontSize(9).fillColor('#78350f').text(testo, M + 10, y + 7, { width: W - 20 });
      doc.y = y + h + 8;
    }

    // ── Riquadri della valutazione ──
    const boxY = doc.y + 4;
    const scatole = [['MINIMO', euro(q.min), '€/mq'], ['MEDIO', euro(med), '€/mq'], ['MASSIMO', euro(q.max), '€/mq']];
    const bw = (W - 20) / 3;
    scatole.forEach(([e, v, u], i) => {
      const x = M + i * (bw + 10);
      doc.roundedRect(x, boxY, bw, 56, 6).fill(i === 1 ? colore : CHIARO);
      doc.font('Helvetica').fontSize(8).fillColor(i === 1 ? '#f3f4f6' : GRIGIO).text(e + ' ' + u, x + 12, boxY + 10, { width: bw - 24, lineBreak: false });
      doc.font('Times-Bold').fontSize(22).fillColor(i === 1 ? '#ffffff' : TESTO).text(v, x + 12, boxY + 26, { width: bw - 24, lineBreak: false });
    });
    doc.y = boxY + 66;
    if (mq && med) {
      const y = doc.y;
      doc.roundedRect(M, y, W, 44, 6).lineWidth(1.2).strokeColor(colore).stroke();
      doc.font('Helvetica').fontSize(9).fillColor(GRIGIO).text('VALORE STIMATO (media × ' + num(mq) + ' mq)', M + 14, y + 8, { width: W - 28, lineBreak: false });
      doc.font('Times-Bold').fontSize(20).fillColor(colore).text(euro(Math.round(med * mq)), M + 14, y + 21, { width: 200, lineBreak: false });
      doc.font('Helvetica').fontSize(9.5).fillColor(GRIGIO).text('Intervallo: ' + euro(Math.round(q.min * mq)) + ' – ' + euro(Math.round(q.max * mq)), M + 220, y + 25, { width: W - 234, align: 'right', lineBreak: false });
      doc.y = y + 54;
    } else {
      doc.font('Helvetica-Oblique').fontSize(9).fillColor(GRIGIO).text('Valore stimato non calcolabile: manca la superficie dell\'immobile.', M, doc.y, { width: W });
    }

    // ── Considerazioni ──
    if (r.considerazioni) {
      titoloSezione('Considerazioni del valutatore');
      doc.font('Helvetica-Oblique').fontSize(10);
      const h = doc.heightOfString(r.considerazioni, { width: W - 28, lineGap: 2 }) + 18;
      spazio(h);
      const y = doc.y;
      doc.roundedRect(M, y, W, h, 6).fill(CHIARO);
      doc.rect(M, y, 3, h).fill(colore);
      doc.font('Helvetica-Oblique').fontSize(10).fillColor(TESTO).text(r.considerazioni, M + 14, y + 9, { width: W - 28, lineGap: 2 });
      doc.y = y + h + 4;
    }

    // ── Quotazioni OMI ──
    const omi = r.omi;
    if (omi && Array.isArray(omi.values) && omi.values.length) {
      titoloSezione('Quotazioni OMI — Agenzia delle Entrate');
      doc.font('Helvetica').fontSize(9).fillColor(GRIGIO).text('Zona ' + (omi.omi_zone || '—') + (omi.zone && omi.zone.description ? ' · ' + omi.zone.description : '') + (omi.municipality ? ' · ' + omi.municipality : ''), M, doc.y, { width: W });
      doc.moveDown(0.4);
      tabella([{ titolo: 'Tipologia', w: 34 }, { titolo: 'Stato', w: 14 }, { titolo: 'Vendita €/mq', w: 26, dx: true }, { titolo: 'Affitto €/mq mese', w: 26, dx: true }],
        omi.values.map((v) => [v.property_type, String(v.condition || '').toLowerCase(), v.sale ? num(v.sale.min) + ' – ' + num(v.sale.max) : '—', v.rent ? String(v.rent.min).replace('.', ',') + ' – ' + String(v.rent.max).replace('.', ',') : '—']));
    }

    // ── Comparabili ──
    titoloSezione('Immobili comparabili nella zona');
    const comp = Array.isArray(r.comparabili) ? r.comparabili : [];
    if (comp.length) {
      tabella([{ titolo: 'Tipologia', w: 28 }, { titolo: 'Comune', w: 24 }, { titolo: 'Superficie', w: 14, dx: true }, { titolo: 'Prezzo', w: 17, dx: true }, { titolo: '€/mq', w: 12, dx: true }],
        comp.slice(0, 10).map((c) => [c.property_type || 'Immobile', c.municipality || '—', c.total_sqm ? num(c.total_sqm) + ' mq' : '—', euro(c.price), c.price_per_sqm ? num(c.price_per_sqm) : '—']));
    } else {
      doc.font('Helvetica-Oblique').fontSize(9.5).fillColor(GRIGIO).text('Nessun annuncio comparabile trovato vicino a questo indirizzo.', M, doc.y, { width: W });
    }

    // ── Mercato ──
    const dinamica = det.capoluoghi_vendite_zona && typeof det.capoluoghi_vendite_zona === 'object' ? Object.entries(det.capoluoghi_vendite_zona) : [];
    if (dinamica.length) {
      titoloSezione('Andamento del mercato in zona', dinamica.length);
      doc.font('Helvetica').fontSize(9).fillColor(GRIGIO).text('Abitazioni vendute ogni anno nella zona.', M, doc.y, { width: W });
      doc.moveDown(0.4);
      barre(dinamica.map(([anno, v]) => ({ etichetta: anno + ' · ' + String(v.dinamicita_mercato_residenziale || '').toLowerCase(), valore: Number(v.numero_abitazioni_vendute) || 0, testo: num(v.numero_abitazioni_vendute) + ' (' + (Number(v.perc_variazione_annuale) > 0 ? '+' : '') + pct(v.perc_variazione_annuale) + ')' })));
    }
    const tempi = Array.isArray(det.tempistiche) && Array.isArray(det.tempistiche[0]) ? det.tempistiche[0] : [];
    if (tempi.length) {
      titoloSezione('Tempi medi di vendita per superficie', tempi.length);
      barre(tempi.map((t) => ({ etichetta: String(t.label).replace(/^(\d+) (\d+) Mq$/, '$1-$2 mq').replace('Oltre', 'oltre'), valore: Number(t.media_giorni) || 0, testo: t.media_giorni + ' giorni' })));
    }
    const rip = (det.ripartizione_annunci && det.ripartizione_annunci.vendita) || null;
    if (rip) {
      titoloSezione('Annunci in vendita per tipologia', Object.keys(rip).length);
      barre(Object.values(rip).sort((a, b) => b.percentuale - a.percentuale).map((x) => ({ etichetta: x.tipologia, valore: Number(x.percentuale) || 0, testo: pct(x.percentuale) })));
    }
    const dim = Array.isArray(det.dimensioni) ? det.dimensioni : [];
    if (dim.length) {
      titoloSezione('Annunci per superficie', dim.length);
      barre(dim.map((x) => ({ etichetta: x.label, valore: Number(x.percentuale) || 0, testo: pct(x.percentuale) })));
    }

    // ── Territorio e zona ──
    const terr = [];
    if (demo.rischio_sismico) terr.push(['Rischio sismico (OpenAPI.it)', demo.rischio_sismico]);
    if (r.zonaSismicaUfficiale && r.zonaSismicaUfficiale.zona != null) terr.push(['Zona sismica ufficiale (ISPRA)', r.zonaSismicaUfficiale.zona + ' (1 alta, 4 bassa)']);
    if (r.fotovoltaico && r.fotovoltaico.kwh_per_kwp_anno) terr.push(['Resa fotovoltaico (PVGIS)', num(r.fotovoltaico.kwh_per_kwp_anno) + ' kWh/anno per kW installato']);
    if (r.fotovoltaico && r.fotovoltaico.irraggiamento_kwh_mq_anno) terr.push(['Irraggiamento medio', num(r.fotovoltaico.irraggiamento_kwh_mq_anno) + ' kWh/m² all\'anno']);
    if (terr.length) { titoloSezione('Territorio'); terr.forEach(([e, v]) => riga(e, v)); }

    // ── Mappa e luoghi utili vicini ──
    if (haCoordinate) {
      spazio(40 + 258 + 90); // titolo, mappa e legenda restano insieme
      titoloSezione('Dove si trova e cosa c\'è intorno');
      const yMappa = doc.y;
      const segnati = mappaPdf.disegnaMappa(doc, mappa, { x: M, y: yMappa, w: W, h: 250, colore, luoghi: servizi });
      doc.y = yMappa + 258;
      if (servizi && segnati.length) {
        spazio(Math.ceil(segnati.length / 2) * 26 + 24); // la legenda non si spezza a metà
        const colW = (W - 14) / 2, yL = doc.y;
        segnati.forEach((l, i) => {
          const cx = M + (i % 2) * (colW + 14), cy = yL + Math.floor(i / 2) * 26;
          doc.circle(cx + 7, cy + 6, 6.5).fill(mappaPdf.COLORI[l.chiave] || '#475569');
          doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#ffffff').text(String(l.n), cx + 0.5, cy + 3.4, { width: 13, align: 'center', lineBreak: false });
          doc.font('Helvetica-Bold').fontSize(8.5).fillColor(TESTO).text(l.label, cx + 18, cy, { width: colW - 18, lineBreak: false });
          doc.font('Helvetica').fontSize(8.5).fillColor(GRIGIO).text((l.nome ? String(l.nome).slice(0, 30) + ' · ' : '') + l.metri + ' m · ~' + l.minuti + ' min' + (l.quanti > 1 ? ' · ' + l.quanti + ' in zona' : ''), cx + 18, cy + 11, { width: colW - 18, lineBreak: false });
        });
        doc.y = yL + Math.ceil(segnati.length / 2) * 26 + 2;
        doc.font('Helvetica-Oblique').fontSize(7.5).fillColor(GRIGIO).text('Il luogo più vicino per ogni tipo, entro 1 km dall\'immobile (cerchio tratteggiato); «in zona» = quanti ce ne sono nel raggio. I minuti sono a piedi, stimati dalla distanza in linea d\'aria. Luoghi: OpenStreetMap.', M, doc.y, { width: W });
      } else {
        doc.font('Helvetica-Oblique').fontSize(8.5).fillColor(GRIGIO).text('I luoghi utili vicini (supermercati, farmacie, scuole, sanità, trasporti, verde) si stanno cercando: rigenera il report tra un minuto per vederli sulla mappa.', M, doc.y, { width: W });
      }
    }

    const pop = demo.pop || {}, stock = demo.stock || {};
    const zona = [
      demo.geo && demo.geo.nome_localita && ['Area', demo.geo.nome_localita],
      pop.media_componenti_famiglia && ['Componenti per famiglia', String(pop.media_componenti_famiglia).replace('.', ',') + ' (nuclei ' + (pop.dimensione_nuclei_familiari || '—') + ')'],
      pop.livello_anzianita && ['Età della popolazione', pop.livello_anzianita],
      pop.livello_istruzione && ['Istruzione', pop.livello_istruzione],
      pop.livello_disoccupazione && ['Disoccupazione', pop.livello_disoccupazione],
      stock.prc_edifici_residenziali && ['Edifici residenziali', pct(stock.prc_edifici_residenziali)],
      stock.prc_abitazioni_di_proprieta && ['Abitazioni di proprietà', pct(stock.prc_abitazioni_di_proprieta)],
      stock.prc_abitazioni_vuote_o_2_case && ['Vuote o seconde case', pct(stock.prc_abitazioni_vuote_o_2_case)],
      stock.mq_abitazione_media && ['Superficie media abitazioni', num(stock.mq_abitazione_media) + ' mq'],
    ].filter(Boolean);
    if (zona.length) { titoloSezione('La zona'); zona.forEach(([e, v]) => riga(e, v)); }

    // ── Avvertenza ──
    spazio(50);
    doc.moveDown(0.8);
    doc.moveTo(M, doc.y).lineTo(M + W, doc.y).lineWidth(0.5).strokeColor(LINEA).stroke();
    doc.moveDown(0.5);
    doc.font('Helvetica').fontSize(8).fillColor(GRIGIO).text('La valutazione è una stima indicativa basata su quotazioni medie di zona e dati pubblici. Non sostituisce una perizia e non tiene conto dello stato interno, delle finiture, del piano e dell\'esposizione dell\'immobile. Fonti: OpenAPI.it, Agenzia delle Entrate (OMI), ISPRA, JRC PVGIS.', M, doc.y, { width: W });

    pieDiPagina(doc, { azienda, riserva: d.titolo || '' });
    doc.end();
  });
}

module.exports = { creaPdfReport, caricaLogo };
