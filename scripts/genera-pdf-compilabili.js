#!/usr/bin/env node
'use strict';
// Genera i PDF COMPILABILI che l'agenzia non aveva (testi con segnaposto «[…]» non compilabili): Incarico di ricerca (Property Finder), Proposta irrevocabile d'acquisto,
// Accordo provvigionale con il Proponente. Stesso stile degli altri moduli dell'agenzia (logo, barre blu, riquadri, campi bianchi), i testi sono quelli dei documenti dell'agenzia.
// Ogni campo si chiama come la chiave del sistema che lo riempie (relazioni: `cliente__nome` = cliente.nome), così la mappa nasce dalla stessa descrizione del PDF:
// `moduli-pdf/<chiave>.pdf` + `<chiave>.json`. I campi che iniziano per `x_` non hanno un dato nel sistema (REA, polizza, luogo e data…): restano da compilare a mano.
// Si lancia a mano dopo aver cambiato un testo o un campo:  node scripts/genera-pdf-compilabili.js [cartella-copia-per-l-agenzia]
const fs = require('fs'), path = require('path');
const { PDFDocument, StandardFonts, rgb } = require(path.join(__dirname, '../core/backend/node_modules/pdf-lib'));
const PAC = path.join(__dirname, '../super-admin/backend/src/pacchetti/mediazione-immobiliare/moduli-pdf/');

const W = 595.28, H = 841.89, ML = 45, CW = W - 2 * ML, TOP = 48, BOT = 66;
const NAVY = rgb(22 / 255, 53 / 255, 91 / 255), GRIGIO = rgb(0.957, 0.957, 0.957), BORDO = rgb(0.851, 0.867, 0.886), TESTO = rgb(0.13, 0.13, 0.15), SOTTO = rgb(0.45, 0.47, 0.5), BIANCO = rgb(1, 1, 1);
const BORDO_CAMPO = rgb(0.72, 0.75, 0.8), AZZURRINO = rgb(0.93, 0.95, 0.98);

class Modulo {
  constructor(pdf, f, opz, def) { this.pdf = pdf; this.f = f; this.opz = opz; this.def = def; this.pagine = []; this.campi = []; this.box = null; this.nuova(); }
  nuova() {
    this.page = this.pdf.addPage([W, H]); this.pagine.push(this.page); this.y = TOP;
    if (this.pagine.length === 1) this.intestazione();
  }
  py(y) { return H - y; }
  intestazione() {
    const { page, opz } = this;
    page.drawPage(opz.logo, { x: 0, y: H - 126, width: W, height: 126 });
    this.y = 132; this.linea(this.y, NAVY, 0.9); this.y += 6;
    const alto = 46;
    page.drawRectangle({ x: ML, y: this.py(this.y + alto), width: CW, height: alto, color: GRIGIO });
    const t = opz.titolo, tw = this.f.bold.widthOfTextAtSize(t, 13.5);
    page.drawText(t, { x: (W - tw) / 2, y: this.py(this.y + 20), size: 13.5, font: this.f.bold, color: NAVY });
    const s = opz.sottotitolo, sw = this.f.ital.widthOfTextAtSize(s, 8.5);
    page.drawText(s, { x: (W - sw) / 2, y: this.py(this.y + 35), size: 8.5, font: this.f.ital, color: SOTTO });
    this.y += alto; this.linea(this.y, NAVY, 0.9); this.y += 14;
  }
  linea(y, colore, sp = 0.5, x0 = ML, x1 = W - ML) { this.page.drawLine({ start: { x: x0, y: this.py(y) }, end: { x: x1, y: this.py(y) }, thickness: sp, color: colore }); }
  // Va a pagina nuova se mancano `h` punti; un riquadro aperto si chiude in fondo alla pagina e si riapre sulla successiva.
  assicura(h) {
    if (this.y + h <= H - BOT) return;
    if (this.box) this.disegnaBox(this.box.start, H - BOT + 6);
    this.nuova();
    if (this.box) { this.box.start = this.y; this.y += 8; }
  }
  disegnaBox(da, a) { this.page.drawRectangle({ x: ML, y: this.py(a), width: CW, height: a - da, borderColor: BORDO, borderWidth: 0.9 }); }
  apriBox() { this.assicura(40); this.box = { start: this.y }; this.y += 8; }
  chiudiBox() { this.disegnaBox(this.box.start, this.y + 2); this.box = null; this.y += 12; }
  barra(testo) {
    this.assicura(50); const h = 16;
    this.page.drawRectangle({ x: ML, y: this.py(this.y + h), width: CW, height: h, color: NAVY });
    this.page.drawText(testo.toUpperCase(), { x: ML + 8, y: this.py(this.y + 11.2), size: 7.8, font: this.f.bold, color: BIANCO });
    this.y += h + 4;
  }
  sottotitolo(testo) { this.assicura(24); this.page.drawText(testo, { x: ML + 10, y: this.py(this.y + 8), size: 8.8, font: this.f.bold, color: NAVY }); this.y += 8; this.linea(this.y + 3, BORDO, 0.6, ML + 10, W - ML - 10); this.y += 10; }
  // «Art. N – titolo» con filo sottile
  articolo(testo) { this.assicura(34); this.page.drawText(testo, { x: ML + 10, y: this.py(this.y + 8), size: 9.2, font: this.f.bold, color: NAVY }); this.y += 8; this.linea(this.y + 3, BORDO, 0.6, ML + 10, W - ML - 10); this.y += 11; }

  campo(nome, x, yAlto, w, h, multi = false) { this.campi.push({ nome, tipo: 't', pagina: this.pagine.length - 1, x, y: this.py(yAlto + h), w, h, multi }); }
  spunta(nome, x, yAlto) { this.campi.push({ nome, tipo: 'c', pagina: this.pagine.length - 1, x, y: this.py(yAlto + 9), w: 9, h: 9 }); }

  // Paragrafo con campi e caselle nel testo: {f:nome:larghezza}, {c:nome}, **grassetto**, riquadro `.` all'inizio per l'elenco numerato.
  p(testo, { size = 9, ind = 0, first = null, after = 4, x0 = ML + 10, larghezza = CW - 20 } = {}) {
    const { f } = this, voci = [];
    let grassetto = false;
    for (const pezzo of testo.split(/(\{[fc]:[^}]+\}|\*\*)/)) {
      if (pezzo === '**') { grassetto = !grassetto; continue; }
      const m = /^\{([fc]):([^:}]+)(?::(\d+))?\}$/.exec(pezzo);
      if (m) { voci.push(m[1] === 'f' ? { t: 'f', nome: m[2], w: +(m[3] || 80) } : { t: 'c', nome: m[2], w: 9 }); continue; }
      for (const parola of pezzo.split(/(\s+)/)) { if (!parola) continue; const font = grassetto ? f.bold : f.reg; voci.push(/^\s+$/.test(parola) ? { t: 's', w: Math.max(font.widthOfTextAtSize(' ', size), size * 0.34) } : { t: 'w', s: parola, font, w: font.widthOfTextAtSize(parola, size) }); }
    }
    // la casella resta attaccata alla sua etichetta: i due si spostano insieme a capo
    for (let i = 0; i < voci.length - 1; i++) if (voci[i].t === 'c') { let j = i + 1; while (voci[j] && voci[j].t === 's') j++; if (voci[j] && voci[j].t === 'w') { voci.splice(i, j - i + 1, { t: 'cw', nome: voci[i].nome, s: voci[j].s, font: voci[j].font, w: 12 + voci[j].w }); } }
    const righe = []; let riga = [], larg = 0, spazio = null;
    const maxW = larghezza - ind;
    for (const v of voci) {
      if (v.t === 's') { spazio = v; continue; }
      const sp = riga.length && spazio ? spazio.w : 0;
      if (riga.length && larg + sp + v.w > maxW) { righe.push(riga); riga = []; larg = 0; }
      const lead = riga.length && spazio ? spazio.w : 0;
      riga.push({ ...v, pre: lead }); larg += lead + v.w; spazio = null;
    }
    if (riga.length) righe.push(riga);
    righe.forEach((r, i) => {
      const conCampo = r.some((v) => v.t === 'f'), alt = conCampo ? 17 : size + 3.6;
      this.assicura(alt);
      const base = this.y + (conCampo ? 12 : size);
      let x = x0 + ind;
      if (i === 0 && first) this.page.drawText(first, { x: x0, y: this.py(base), size, font: f.reg, color: TESTO });
      for (const v of r) {
        x += v.pre;
        if (v.t === 'w') this.page.drawText(v.s, { x, y: this.py(base), size, font: v.font, color: TESTO });
        else if (v.t === 'f') this.campo(v.nome, x, base - 10, v.w, 14);
        else if (v.t === 'c') this.spunta(v.nome, x, base - 8);
        else if (v.t === 'cw') { this.spunta(v.nome, x, base - 8); this.page.drawText(v.s, { x: x + 12, y: this.py(base), size, font: v.font, color: TESTO }); }
        x += v.w;
        if (v.t === 'c') x += 3;
      }
      this.y += alt;
    });
    this.y += after;
  }

  // Riga di dati: [{ l: 'etichetta', f: 'campo', w: frazione }] — l'etichetta in grassetto, il campo riempie il resto della cella; `c: [{n, e}]` per caselle con etichetta.
  riga(celle, { alt = 15 } = {}) {
    this.assicura(Math.max(alt, ...celle.map((c) => (c.h || 0) + (c.sopra ? 12 : 0))) + 8); const { f } = this;
    let x = ML + 10; const tot = CW - 20;
    for (const c of celle) {
      const w = tot * c.w; let cx = x;
      if (c.sopra) { this.page.drawText(c.sopra, { x: cx, y: this.py(this.y + 8), size: 8, font: f.bold, color: TESTO }); }
      else if (c.l) { this.page.drawText(c.l, { x: cx, y: this.py(this.y + 10.5), size: 8, font: f.bold, color: TESTO }); cx += f.bold.widthOfTextAtSize(c.l, 8) + 4; }
      if (c.c) for (const s of c.c) { this.spunta(s.n, cx, this.y + 2); cx += 12; this.page.drawText(s.e, { x: cx, y: this.py(this.y + 10), size: 8.5, font: f.reg, color: TESTO }); cx += f.reg.widthOfTextAtSize(s.e, 8.5) + 12; }
      if (c.f) this.campo(c.f, cx, this.y + (c.sopra ? 12 : 0), Math.max(24, x + w - cx - 8), c.h || alt, !!c.h && c.h > 20);
      x += w;
    }
    this.y += (celle.reduce((m, c) => Math.max(m, (c.h || alt) + (c.sopra ? 12 : 0)), alt)) + 8;
  }
  blocco(titolo, testo) {
    const righe = this.misura(testo, 8.6, CW - 36);
    const h = 30 + righe * 11.4; this.assicura(h + 10);
    this.page.drawRectangle({ x: ML, y: this.py(this.y + h), width: CW, height: h, color: AZZURRINO, borderColor: BORDO, borderWidth: 0.8 });
    this.page.drawText(titolo.toUpperCase(), { x: ML + 12, y: this.py(this.y + 14), size: 7.8, font: this.f.bold, color: NAVY });
    const salva = this.box; this.box = null; const y0 = this.y; this.y += 20; this.p(testo, { size: 8.6, x0: ML + 12, larghezza: CW - 24, after: 0 }); this.y = y0 + h + 10; this.box = salva;
  }
  misura(testo, size, larghezza) { let n = 1, x = 0; for (const par of testo.replace(/\*\*/g, '').split(/\s+/)) { const w = this.f.reg.widthOfTextAtSize(par + ' ', size); if (x + w > larghezza) { n++; x = 0; } x += w; } return n; }
  firme(sx, dx, { gap = 24 } = {}) {
    this.assicura(60); const y = this.y + 30, met = CW / 2;
    this.page.drawText(sx, { x: ML + 10, y: this.py(this.y + 8), size: 9, font: this.f.bold, color: TESTO });
    this.page.drawText(dx, { x: ML + met + 10, y: this.py(this.y + 8), size: 9, font: this.f.bold, color: TESTO });
    this.linea(y + gap - 24, NAVY, 0.7, ML + 10, ML + met - 20); if (dx) this.linea(y + gap - 24, NAVY, 0.7, ML + met + 10, W - ML - 10); this.y += 50;
  }
  async chiudi(chiave) {
    const n = this.pagine.length, helv = await this.pdf.embedFont(StandardFonts.Helvetica), form = this.pdf.getForm(), creati = new Map();
    this.pagine.forEach((pg, i) => {
      pg.drawLine({ start: { x: ML, y: 46 }, end: { x: W - ML, y: 46 }, thickness: 0.5, color: BORDO });
      pg.drawText('ZUCCA & PARTNERS | info@zuccarealestate.com', { x: ML, y: 32, size: 7, font: this.f.reg, color: SOTTO });
      const d = this.opz.piede + '  •  Pagina ' + (i + 1) + ' di ' + n; pg.drawText(d, { x: W - ML - this.f.reg.widthOfTextAtSize(d, 7), y: 32, size: 7, font: this.f.reg, color: SOTTO });
    });
    for (const c of this.campi) {
      const pg = this.pagine[c.pagina];
      if (c.tipo === 't') {
        let fld = creati.get(c.nome);
        if (!fld) { fld = form.createTextField(c.nome); creati.set(c.nome, fld); if (c.multi) fld.enableMultiline(); fld.__multi = !!c.multi; }
        fld.addToPage(pg, { x: c.x, y: c.y, width: c.w, height: c.h, borderWidth: 0.7, borderColor: BORDO_CAMPO, backgroundColor: BIANCO, textColor: TESTO, font: helv });
        fld.setFontSize(fld.__multi ? 8.5 : 9);
      } else {
        if (creati.has(c.nome)) throw new Error('casella duplicata: ' + c.nome);
        const cb = form.createCheckBox(c.nome); creati.set(c.nome, cb);
        cb.addToPage(pg, { x: c.x, y: c.y, width: c.w, height: c.h, borderWidth: 0.9, borderColor: NAVY, backgroundColor: BIANCO });
      }
    }
    form.updateFieldAppearances(helv);
    return Buffer.from(await this.pdf.save());
  }
}

// Mappa: nome del campo → cosa lo riempie. `x_…` = nessun dato (a mano); `a__b` = a.b (relazione); una casella ha { k, v }.
function costruisciMappa(modulo, titolo, file) {
  const visti = new Set(), campi = [];
  for (const c of modulo.campi) {
    if (visti.has(c.nome) || c.nome.startsWith('x_')) continue; visti.add(c.nome);
    const d = modulo.def[c.nome];
    if (c.tipo === 'c') { if (!d) throw new Error('casella senza mappa: ' + c.nome); campi.push({ campo: c.nome, chiave: d.k, valore: d.v }); continue; }
    const k = (d && d.k) || c.nome.replace(/__/g, '.');
    campi.push({ campo: c.nome, testo: '{{' + k + (k.startsWith('@') ? '' : '|vuoto') + '}}' });
  }
  return { titolo, file, _nota: 'Mappa dei campi compilabili del PDF (generata da scripts/genera-pdf-compilabili.js): `testo` = modello con segnaposto, `chiave`+`valore` = casella spuntata se il campo vale quel valore. I campi `x_…` non hanno un dato nel sistema: restano da compilare a mano.', campi };
}

async function genera(chiave, titoloMappa, opz, def, disegna) {
  const pdf = await PDFDocument.create();
  const f = { reg: await pdf.embedFont(StandardFonts.TimesRoman), bold: await pdf.embedFont(StandardFonts.TimesRomanBold), ital: await pdf.embedFont(StandardFonts.TimesRomanItalic) };
  const sorgente = await PDFDocument.load(fs.readFileSync(PAC + 'contratto-incarico.pdf'));
  const [logo] = await pdf.embedPages([sorgente.getPage(0)], [{ left: 0, bottom: H - 126, right: W, top: H }]);
  pdf.setTitle(opz.titolo); pdf.setAuthor('Zucca & Partners'); pdf.setCreator('Platform');
  const m = new Modulo(pdf, f, { ...opz, logo }, def);
  disegna(m);
  const buffer = await m.chiudi(chiave);
  fs.writeFileSync(PAC + chiave + '.pdf', buffer);
  fs.writeFileSync(PAC + chiave + '.json', JSON.stringify(costruisciMappa(m, titoloMappa, chiave + '.pdf'), null, 1) + '\n');
  return { chiave, pagine: m.pagine.length, campi: new Set(m.campi.map((c) => c.nome)).size, byte: buffer.length };
}

const AGENZIA = (m) => {
  m.sottotitolo("L'AGENZIA IMMOBILIARE");
  m.riga([{ l: 'Agenzia:', f: 'ag_denominazione', w: 0.62 }, { l: 'P.IVA:', f: 'ag_piva', w: 0.38 }]);
  m.riga([{ l: 'Sede:', f: 'ag_sede', w: 1 }]);
  m.riga([{ l: 'REA n.:', f: 'x_rea', w: 0.28 }, { l: 'CCIAA di:', f: 'x_cciaa', w: 0.3 }, { l: 'Agente / Leg. Rappr.:', f: 'x_agente', w: 0.42 }]);
  m.riga([{ l: 'Polizza RC Prof. n.:', f: 'x_polizza', w: 0.5 }, { l: 'Compagnia:', f: 'x_compagnia', w: 0.5 }]);
};
const DEF_AGENZIA = { ag_denominazione: { k: '@azienda' }, ag_piva: { k: '@piva' }, ag_sede: { k: '@indirizzo' }, immobile__comune_catasto: { k: 'immobile.comune' } };
const PROPONENTE = (m, pre) => {
  m.riga([{ l: 'Cognome e Nome / Rag. Soc.:', f: pre + '__nome', w: 0.62 }, { l: 'Cod. Fisc. / P.IVA:', f: pre + '__codice_fiscale_piva', w: 0.38 }]);
  m.riga([{ l: 'Nato/a a:', f: pre + '__luogo_nascita', w: 0.4 }, { l: 'il:', f: pre + '__data_nascita', w: 0.25 }, { l: 'Stato civile:', f: pre + '__stato_civile', w: 0.35 }]);
  m.riga([{ l: 'Residenza / Sede legale:', f: pre + '__residenza', w: 1 }]);
  m.riga([{ l: "Documento d'identità:", f: pre + '__documento_tipo', w: 0.34 }, { l: 'n.', f: pre + '__documento_numero', w: 0.26 }, { l: 'rilasciato da:', f: pre + '__documento_rilasciato_da', w: 0.4 }]);
  m.riga([{ l: 'Tel.:', f: pre + '__telefono', w: 0.35 }, { l: 'E-mail / PEC:', f: pre + '__email', w: 0.65 }]);
};
const SI = (nome, k) => ({ [nome]: { k, v: 'Sì' } });

(async () => {
  const esiti = [];
  // ── 1. Incarico di ricerca (Property Finder) — dati del Cliente ──────────────────────────────────
  esiti.push(await genera('incarico-ricerca', 'Incarico di ricerca immobiliare (Property Finder)',
    { titolo: 'INCARICO DI RICERCA IMMOBILIARE (PROPERTY FINDER)', sottotitolo: 'Mandato di mediazione tipica – artt. 1754 e ss. c.c. e legge 39/1989', piede: 'Incarico di ricerca immobiliare' },
    {
      ...DEF_AGENZIA,
      ric_op_acq: { k: 'ricerca_operazione', v: 'Acquisto' }, ric_op_loc: { k: 'ricerca_operazione', v: 'Locazione' },
      ric_uso_abi: { k: 'ricerca_uso', v: 'Abitativo' }, ric_uso_com: { k: 'ricerca_uso', v: 'Commerciale' }, ric_uso_inv: { k: 'ricerca_uso', v: 'Investimento' },
      ric_esc_si: { k: 'ricerca_esclusiva', v: 'In esclusiva' }, ric_esc_no: { k: 'ricerca_esclusiva', v: 'Non in esclusiva' },
      ric_rin_no: { k: 'ricerca_rinnovo', v: 'Cessa senza disdetta' }, ric_rin_si: { k: 'ricerca_rinnovo', v: 'Rinnovo tacito' },
    },
    (m) => {
      m.barra('1. Parti contraenti'); m.apriBox();
      m.sottotitolo('IL CLIENTE (PROPONENTE)');
      m.riga([{ l: 'Cognome e Nome:', f: 'nome', w: 0.62 }, { l: 'Cod. Fisc. / P.IVA:', f: 'codice_fiscale_piva', w: 0.38 }]);
      m.riga([{ l: 'Nato/a a:', f: 'luogo_nascita', w: 0.4 }, { l: 'il:', f: 'data_nascita', w: 0.25 }, { l: 'Tel.:', f: 'telefono', w: 0.35 }]);
      m.riga([{ l: 'Residente in:', f: 'residenza', w: 1 }]);
      m.riga([{ l: "Documento d'identità:", f: 'documento_tipo', w: 0.34 }, { l: 'n.', f: 'documento_numero', w: 0.26 }, { l: 'rilasciato da:', f: 'documento_rilasciato_da', w: 0.4 }]);
      m.riga([{ l: 'E-mail:', f: 'email', w: 0.5 }, { l: 'PEC:', f: 'pec', w: 0.5 }]);
      m.riga([{ l: 'Se società, in qualità di legale rappresentante di:', f: 'azienda', w: 1 }]);
      m.p('di seguito denominato/a «**Cliente**»;', { after: 6 });
      AGENZIA(m);
      m.p('di seguito denominato/a «**Property Finder**».', { after: 2 }); m.chiudiBox();

      m.barra('2. Premesse e oggetto dell\'incarico'); m.apriBox();
      m.p('Il Cliente intende avviare la seguente operazione: {c:ric_op_acq} acquisto   {c:ric_op_loc} locazione, e intende avvalersi della consulenza professionale, della rete di contatti e dell\'attività di ricerca mirata del Property Finder per individuare sul mercato (incluso il mercato off-market e tramite collaborazioni con altri operatori) soluzioni rispondenti alle proprie esigenze.');
      m.articolo('Art. 1 – Oggetto dell\'incarico e caratteristiche dell\'immobile ricercato');
      m.p('Il Cliente conferisce al Property Finder l\'incarico di ricercare e selezionare un immobile da destinare a uso:   {c:ric_uso_abi} abitativo   {c:ric_uso_com} commerciale   {c:ric_uso_inv} investimento   avente le seguenti caratteristiche essenziali:');
      m.riga([{ l: 'Tipologia:', f: 'ricerca_tipologia', w: 1 }]);
      m.riga([{ l: 'Zona / Comune di interesse:', f: 'ricerca_zona', w: 1 }]);
      m.riga([{ l: 'Superficie indicativa: da', f: 'ricerca_superficie_da', w: 0.46 }, { l: 'mq a', f: 'ricerca_superficie_a', w: 0.34 }, { l: 'mq', w: 0.2 }]);
      m.riga([{ sopra: 'Caratteristiche specifiche (locali, piano, ascensore, terrazzo/giardino, box, stato, classe energetica):', f: 'ricerca_caratteristiche', w: 1, h: 42 }], { alt: 42 });
      m.riga([{ l: 'Budget massimo indicativo: €', f: 'ricerca_budget_max', w: 0.5 }, { l: 'Euro (in lettere):', f: 'ricerca_budget_lettere', w: 0.5 }]);
      m.chiudiBox();

      m.barra('3. Obblighi del Property Finder'); m.apriBox();
      m.articolo('Art. 2 – Obblighi e attività del Property Finder');
      m.p('Il Property Finder si impegna a svolgere l\'incarico con la diligenza professionale richiesta dalla natura dell\'attività esercitata, provvedendo a:');
      ['analizzare le esigenze del Cliente e monitorare costantemente il mercato immobiliare (privati, agenzie terze, costruttori, canali off-market);',
        'effettuare una pre-selezione e sopralluoghi preliminari per verificare la rispondenza degli immobili ai criteri indicati all\'art. 1;',
        'presentare al Cliente schede informative dettagliate e accompagnarlo nelle visite agli immobili selezionati;',
        'verificare la documentazione tecnico-urbanistica, catastale e ipotecaria di base dell\'immobile prescelto prima della sottoscrizione di una proposta d\'acquisto;',
        'assistere il Cliente nella fase di trattativa fino alla sottoscrizione della proposta irrevocabile d\'acquisto / contratto preliminare (e, se concordato, fino al rogito notarile).']
        .forEach((t, i) => m.p(t, { ind: 14, first: (i + 1) + '.', after: 2 }));
      m.chiudiBox();

      m.barra('4. Esclusiva e durata'); m.apriBox();
      m.articolo('Art. 3 – Esclusiva e durata dell\'incarico');
      m.p('1. Il presente incarico viene conferito:   {c:ric_esc_si} in forma esclusiva   {c:ric_esc_no} non in esclusiva   per la durata di {f:ricerca_durata_mesi:40} mesi a decorrere dalla data odierna, con scadenza il {f:ricerca_scadenza:90}.', { ind: 14, first: '' });
      m.p('2. Alla scadenza:   {c:ric_rin_no} l\'incarico cesserà automaticamente senza necessità di disdetta   {c:ric_rin_si} si intenderà tacitamente rinnovato per pari periodo salvo disdetta scritta da inviarsi almeno {f:ricerca_preavviso_giorni:36} giorni prima della scadenza.', { ind: 14, first: '' });
      m.p('3. In caso di incarico in esclusiva: per tutta la durata dell\'incarico, il Cliente si impegna a non conferire analogo incarico ad altri mediatori o agenzie per la ricerca di immobili aventi le medesime caratteristiche nella zona indicata e a segnalare tempestivamente al Property Finder eventuali opportunità ricevute direttamente da terzi.', { ind: 14, first: '' });
      m.chiudiBox();

      m.barra('5. Provvigione, rimborso spese e penale'); m.apriBox();
      m.articolo('Art. 4 – Provvigione e modalità di pagamento');
      m.p('1. In caso di conclusione dell\'affare (sottoscrizione del contratto preliminare di compravendita o accettazione della proposta d\'acquisto comunicata al proponente), il Cliente corrisponderà al Property Finder una provvigione pari al {f:ricerca_provvigione_perc:44} % oltre IVA di legge sul prezzo effettivo di compravendita (oppure: un compenso forfettario pari a € {f:ricerca_compenso_forfettario:80} oltre IVA).', { ind: 14, first: '' });
      m.p('2. Il diritto alla provvigione matura alla conclusione dell\'affare (art. 1755 c.c.) e verrà corrisposto con le seguenti modalità (es. 100% al preliminare / 50% al preliminare e 50% al rogito notarile):', { ind: 14, first: '', after: 2 });
      m.riga([{ f: 'ricerca_pagamento_modalita', w: 1 }]);
      m.p('3. Il Property Finder dichiara sin d\'ora che, qualora l\'immobile venga individuato tramite un altro agente immobiliare mandatario del venditore, la provvigione qui pattuita costituirà l\'unico compenso dovuto dal Cliente per l\'attività di mediazione, restando inteso che il Property Finder non richiederà ulteriori compensi al venditore salvo diverso accordo trasparente comunicato per iscritto al Cliente.', { ind: 14, first: '' });
      m.articolo('Art. 5 – Rimborso spese e penale');
      m.p('1. In caso di mancata conclusione dell\'affare alla scadenza naturale dell\'incarico, nulla sarà dovuto al Property Finder a titolo di provvigione (eventuale: salvo il rimborso delle spese vive documentate e preventivamente autorizzate per iscritto dal Cliente fino a un massimo di € {f:ricerca_rimborso_spese_max:80}).', { ind: 14, first: '' });
      m.p('2. Qualora il Cliente violi l\'obbligo di esclusiva di cui all\'art. 3, ovvero rifiuti senza giustificato motivo di concludere l\'affare su un immobile perfettamente conforme a tutti i requisiti dell\'art. 1 e privo di vizi urbanistici/ipotecari, o concluda l\'acquisto entro 12 mesi dalla scadenza dell\'incarico per un immobile segnalato o visitato tramite il Property Finder, sarà tenuto a corrispondere una penale pari al {f:ricerca_penale_perc:44} % della provvigione pattuita.', { ind: 14, first: '' });
      m.chiudiBox();

      m.barra('6. Riservatezza, dati personali, recesso e foro'); m.apriBox();
      m.articolo('Art. 6 – Riservatezza');
      m.p('Il Property Finder si impegna a mantenere la massima riservatezza sui dati personali, patrimoniali e sulle esigenze abitative/di investimento del Cliente. Parimenti, il Cliente si impegna a non divulgare a terzi le informazioni riservate riguardanti gli immobili off-market segnalati dal Property Finder.');
      m.articolo('Art. 7 – Trattamento dei dati personali e antiriciclaggio');
      m.p('1. Il Cliente dichiara di aver ricevuto l\'informativa sul trattamento dei dati personali ai sensi dell\'art. 13 del Regolamento (UE) 2016/679 (GDPR) e presta il consenso al trattamento necessario per l\'esecuzione del presente incarico.', { ind: 14, first: '', after: 2 });
      m.p('2. Il Cliente prende atto degli obblighi di adeguata verifica della clientela previsti dal D.Lgs. 231/2007 (normativa antiriciclaggio) e si impegna a fornire tutta la documentazione richiesta.', { ind: 14, first: '' });
      m.articolo('Art. 8 – Diritto di recesso (Clienti consumatori fuori dai locali commerciali)');
      m.p('Clausola applicabile esclusivamente se il contratto è sottoscritto fuori dai locali commerciali o a distanza. Ai sensi degli artt. 52 e ss. del D.Lgs. 206/2005 (Codice del Consumo), il Cliente che riveste la qualifica di consumatore ha diritto di recedere dal presente contratto entro 14 giorni dalla sottoscrizione senza dover fornire alcuna motivazione, mediante comunicazione scritta da inviare a: {f:ricerca_recesso_contatto:200}. Il Cliente chiede espressamente che il Property Finder inizi l\'esecuzione dell\'incarico durante il periodo di recesso, prendendo atto che, in caso di conclusione dell\'affare prima dell\'esercizio del recesso, il diritto di recesso decade.');
      m.articolo('Art. 9 – Foro competente');
      m.p('Per qualsiasi controversia relativa all\'interpretazione o all\'esecuzione del presente contratto sarà competente in via esclusiva il Foro del luogo di residenza o domicilio del Cliente, qualora questi rivesta la qualifica di consumatore ai sensi del Codice del Consumo; in tutti gli altri casi sarà competente in via esclusiva il Foro di {f:ricerca_foro:130}.');
      m.chiudiBox();

      m.barra('7. Sottoscrizione'); m.apriBox();
      m.riga([{ l: 'Luogo e data:', f: 'x_luogo_data', w: 0.6 }]);
      m.firme('Il Cliente', 'Il Property Finder');
      m.chiudiBox();
      m.blocco('Approvazione specifica ai sensi degli artt. 1341 e 1342 c.c.', 'Ai sensi e per gli effetti degli articoli 1341 e 1342 del Codice Civile, il Cliente dichiara di aver letto, compreso e di approvare specificamente le seguenti clausole: **Art. 3** (Esclusiva e durata dell\'incarico); **Art. 4** (Provvigione e modalità di pagamento); **Art. 5** (Rimborso spese e penale); **Art. 9** (Foro competente).');
      m.firme('Il Cliente (per approvazione specifica)', '');
    }));

  // ── 2. Proposta irrevocabile d'acquisto — dati della Trattativa (cliente, immobile, venditore collegati) ──
  esiti.push(await genera('proposta-acquisto', "Proposta irrevocabile d'acquisto immobiliare",
    { titolo: "PROPOSTA IRREVOCABILE D'ACQUISTO IMMOBILIARE", sottotitolo: 'artt. 1326, 1329, 1385 e 1754 ss. Codice Civile', piede: "Proposta irrevocabile d'acquisto" },
    { ...DEF_AGENZIA, ...SI('prop_cond_nessuna', 'proposta_cond_nessuna'), ...SI('prop_cond_mutuo', 'proposta_cond_mutuo'), ...SI('prop_cond_urb', 'proposta_cond_urbanistica') },
    (m) => {
      m.barra('Alla parte venditrice, tramite l\'agenzia immobiliare'); m.apriBox();
      m.sottotitolo('ALL\'ATTENZIONE DELLA PARTE VENDITRICE');
      m.riga([{ l: 'Sig./Sig.ra / Società:', f: 'venditore__nome', w: 0.6 }, { l: 'C.F. / P.IVA:', f: 'venditore__codice_fiscale_piva', w: 0.4 }]);
      m.riga([{ l: 'Residente / Sede in:', f: 'venditore__residenza', w: 1 }]);
      AGENZIA(m); m.chiudiBox();
      m.barra('Dati del Proponente (parte acquirente)'); m.apriBox();
      PROPONENTE(m, 'cliente');
      m.p('Di seguito denominato/a «**Proponente**», il quale agisce per sé o per persona/ente da nominare ai sensi dell\'art. 1401 c.c. entro la data del rogito notarile.', { after: 2 });
      m.chiudiBox();
      m.p('**PROMETTE IRREVOCABILMENTE DI ACQUISTARE** l\'unità immobiliare di seguito descritta, alle condizioni e nei termini indicati nella presente proposta:', { x0: ML, larghezza: CW, after: 6 });

      m.barra('Art. 1 – Identificazione e stato dell\'immobile'); m.apriBox();
      m.riga([{ l: 'Comune:', f: 'immobile__comune', w: 0.4 }, { l: 'Prov.:', f: 'immobile__provincia', w: 0.14 }, { l: 'Indirizzo:', f: 'immobile__indirizzo', w: 0.46 }]);
      m.riga([{ l: 'N. civico:', f: 'immobile__numero_civico', w: 0.25 }, { l: 'Piano:', f: 'immobile__piano', w: 0.25 }, { l: 'Int.:', f: 'immobile__interno', w: 0.2 }, { l: 'Tipologia:', f: 'immobile__tipologia', w: 0.3 }]);
      m.riga([{ l: 'Composizione:', f: 'immobile__composizione_vani', w: 1 }]);
      m.riga([{ l: 'Camere:', f: 'immobile__numero_camere', w: 0.2 }, { l: 'Bagni:', f: 'immobile__numero_bagni', w: 0.2 }, { l: 'Balconi/terrazzo:', f: 'immobile__sfogo_esterno', w: 0.3 }, { l: 'Cantina/box/posto auto:', f: 'immobile__pertinenze_box', w: 0.3 }]);
      m.riga([{ l: 'Catasto Fabbricati di:', f: 'immobile__comune_catasto', w: 0.4 }, { l: 'Foglio:', f: 'immobile__foglio_catastale', w: 0.18 }, { l: 'Part.:', f: 'immobile__particella_catastale', w: 0.2 }, { l: 'Sub.:', f: 'immobile__subalterno_catastale', w: 0.22 }]);
      m.riga([{ l: 'Cat.:', f: 'immobile__categoria_catastale', w: 0.22 }, { l: 'Rendita €:', f: 'immobile__rendita_catastale', w: 0.3 }, { l: 'Classe energetica:', f: 'immobile__classe_energetica', w: 0.26 }, { l: 'IPE:', f: 'immobile__valore_ipe', w: 0.22 }]);
      m.riga([{ sopra: 'Situazione locativa e possesso (libero da persone e cose / locato con contratto registrato…):', f: 'immobile__stato_occupazione', w: 1, h: 15 }]);
      m.p('L\'immobile è stato visionato dal Proponente e viene accettato nello stato di fatto e di diritto in cui attualmente si trova, con tutti i diritti, pertinenze, servitù attive e passive, nonché quote proporzionali delle parti condominiali.', { after: 2 });
      m.chiudiBox();

      m.barra('Art. 2 – Garanzie della parte venditrice'); m.apriBox();
      m.p('La Parte Venditrice, con l\'accettazione della presente proposta, garantisce:');
      ['la piena ed esclusiva proprietà e disponibilità dell\'immobile, nonché la sua legittima provenienza;',
        'la libertà dell\'immobile da iscrizioni ipotecarie, trascrizioni pregiudizievoli, pignoramenti, sequestri, oneri reali, privilegi anche fiscali e diritti di terzi, salvo quanto eventualmente dichiarato e da cancellarsi a cura e spese della Parte Venditrice entro e non oltre il rogito notarile;',
        'la piena conformità urbanistica, edilizia e catastale dell\'immobile alle norme vigenti e ai titoli abilitativi rilasciati, impegnandosi a fornire tutta la documentazione necessaria per la stipula;',
        'l\'avvenuto regolare pagamento di tutte le spese condominiali ordinarie fino alla data del rogito notarile, restando a carico della Parte Venditrice eventuali spese straordinarie già deliberate dall\'assemblea condominiale prima della data del rogito.']
        .forEach((t, i) => m.p(t, { ind: 14, first: (i + 1) + '.', after: 2 }));
      m.chiudiBox();

      m.barra('Art. 3 – Prezzo offerto e modalità di pagamento'); m.apriBox();
      m.p('Il prezzo complessivo offerto per l\'acquisto dell\'immobile (a corpo e non a misura) è di € {f:proposta_prezzo:90} (Euro {f:proposta_prezzo_lettere:200}), che il Proponente si impegna a corrispondere con le seguenti modalità:');
      m.p('1. € {f:proposta_caparra:80} (Euro {f:proposta_caparra_lettere:180}) alla firma della presente proposta, mediante assegno bancario/circolare non trasferibile n. {f:proposta_assegno_numero:80} tratto su {f:proposta_assegno_banca:110}, intestato a {f:proposta_assegno_intestatario:150}, consegnato in deposito fiduciario gratuito all\'Agente Immobiliare. Tale somma verrà consegnata alla Parte Venditrice al momento dell\'avvenuta conoscenza da parte del Proponente dell\'accettazione della presente proposta (oppure: all\'avveramento delle condizioni sospensive di cui all\'art. 6) e diverrà caparra confirmatoria ai sensi dell\'art. 1385 c.c.;', { ind: 14, first: '', after: 3 });
      m.p('2. € {f:proposta_integrazione:80} (Euro {f:proposta_integrazione_lettere:180}) a titolo di integrazione della caparra confirmatoria (oppure: acconto prezzo) entro e non oltre il {f:proposta_integrazione_data:80}, contestualmente alla eventuale sottoscrizione del contratto preliminare di compravendita riproduttivo (facoltativo) presso {f:proposta_notaio:160};', { ind: 14, first: '', after: 3 });
      m.p('3. € {f:proposta_saldo:80} (Euro {f:proposta_saldo_lettere:180}) a saldo, contestualmente alla stipula dell\'atto pubblico di compravendita (rogito notarile), mediante assegni circolari non trasferibili e/o bonifico bancario irrevocabile (anche tramite eventuale intervento di Istituto mutuante).', { ind: 14, first: '', after: 2 });
      m.chiudiBox();

      m.barra('Art. 4 – Rogito notarile e consegna dell\'immobile'); m.apriBox();
      m.p('1. L\'atto pubblico di compravendita sarà stipulato entro e non oltre il {f:proposta_rogito_entro:90} presso il Notaio scelto dal Proponente, con spese notarili, imposte e tasse relative all\'acquisto a carico del Proponente, ad eccezione di quelle che per legge gravano sulla Parte Venditrice.', { ind: 14, first: '', after: 2 });
      m.p('2. Il possesso giuridico e la materiale disponibilità dell\'immobile (consegna delle chiavi) verranno trasferiti al Proponente contestualmente al rogito notarile e al saldo del prezzo.', { ind: 14, first: '', after: 2 });
      m.chiudiBox();

      m.barra('Art. 5 – Irrevocabilità della proposta e perfezionamento del contratto'); m.apriBox();
      m.p('1. La presente proposta è **irrevocabile** ai sensi dell\'art. 1329 c.c. fino alle ore {f:proposta_validita_ora:50} del giorno {f:proposta_validita_data:90} (termine essenziale). Decorso tale termine senza che la proposta sia stata accettata e comunicata, essa perderà ogni efficacia e l\'Agente Immobiliare restituirà immediatamente al Proponente l\'assegno ricevuto in deposito, senza che sia dovuto a titolo di provvigione o rimborso spese.', { ind: 14, first: '', after: 3 });
      m.p('2. Ai sensi dell\'art. 1326 c.c., la presente proposta, una volta accettata per iscritto dalla Parte Venditrice e comunicata al Proponente (anche tramite PEC, raccomandata A/R o consegna a mani tramite l\'Agente Immobiliare) entro il termine sopra indicato, costituirà **contratto preliminare di compravendita** pienamente vincolante tra le parti, soggetto a registrazione fiscale nei termini di legge a cura e spese del Proponente (con corresponsabilità dell\'Agente ai sensi di legge).', { ind: 14, first: '', after: 2 });
      m.chiudiBox();

      m.barra('Art. 6 – Condizioni sospensive (barrare l\'opzione applicabile)'); m.apriBox();
      m.p('{c:prop_cond_nessuna} **NESSUNA CONDIZIONE SOSPENSIVA:** la presente proposta è incondizionata e produrrà immediatamente i suoi effetti al momento della comunicazione dell\'accettazione.', { after: 5 });
      m.p('{c:prop_cond_mutuo} **CONDIZIONE SOSPENSIVA MUTUO:** l\'efficacia del contratto perfezionato con l\'accettazione della presente proposta è subordinata all\'ottenimento, da parte del Proponente, della delibera reddituale e tecnico-estimativa di un mutuo ipotecario dell\'importo di € {f:proposta_mutuo_importo:80} presso un Istituto di Credito di sua scelta, entro e non oltre il {f:proposta_mutuo_data:80}. Fino all\'avveramento di tale condizione, l\'assegno di cui all\'art. 3 punto 1 resterà in deposito fiduciario presso l\'Agente Immobiliare. Qualora il mutuo non venga deliberato entro il termine indicato, il contratto perderà definitivamente efficacia, l\'assegno sarà restituito al Proponente e nulla sarà dovuto a titolo di provvigione o penale.', { after: 5 });
      m.p('{c:prop_cond_urb} **CONDIZIONE SOSPENSIVA VERIFICA URBANISTICO-CATASTALE:** l\'efficacia del contratto è subordinata alla verifica positiva, entro il {f:proposta_urbanistica_data:80}, della regolarità urbanistica, edilizia e catastale dell\'immobile da parte di un tecnico incaricato dal Proponente.', { after: 2 });
      m.chiudiBox();

      m.barra('Art. 7 – Trattamento dei dati personali e antiriciclaggio'); m.apriBox();
      m.p('Il Proponente dichiara di aver ricevuto l\'informativa privacy ai sensi dell\'art. 13 del Regolamento (UE) 2016/679 (GDPR) e prende atto degli obblighi di identificazione e adeguata verifica previsti dalla normativa antiriciclaggio (D.Lgs. 231/2007).', { after: 4 });
      m.riga([{ l: 'Luogo e data:', f: 'x_luogo_data', w: 0.6 }]);
      m.firme('Il Proponente', 'Per ricevuta assegno in deposito fiduciario (L\'Agente)');
      m.chiudiBox();
      m.blocco('Approvazione specifica ai sensi degli artt. 1341 e 1342 c.c.', 'Ai sensi e per gli effetti degli artt. 1341 e 1342 c.c., il Proponente approva specificamente le seguenti clausole: **Art. 3** (Modalità di pagamento e caparra confirmatoria); **Art. 5** (Irrevocabilità della proposta e perfezionamento del preliminare); **Art. 6** (Condizioni sospensive).');
      m.firme('Il Proponente (per approvazione specifica)', '');
      m.blocco('Spazio riservato all\'accettazione della parte venditrice', 'Il/La sottoscritto/a {f:venditore__nome:200} dichiara di aver preso integrale visione della presente proposta irrevocabile d\'acquisto e **LA ACCETTA INTEGRALMENTE** in ogni sua parte, clausola e condizione, confermando tutte le garanzie di cui all\'art. 2.');
      m.riga([{ l: 'Luogo e data:', f: 'x_accettazione_luogo_data', w: 0.5 }]);
      m.firme('La Parte Venditrice', '');
      m.blocco('Ricevuta di avvenuta comunicazione dell\'accettazione (art. 1326 c.c.)', 'Il/La sottoscritto/a {f:cliente__nome:200} dichiara di aver ricevuto in data odierna copia della presente proposta debitamente accettata dalla Parte Venditrice e di ritirare contestualmente copia della documentazione dell\'immobile.');
      m.riga([{ l: 'Luogo, data e ora:', f: 'x_ricevuta_luogo_data', w: 0.5 }]);
      m.firme('Il Proponente (per presa conoscenza)', '');
    }));

  // ── 3. Accordo provvigionale con il Proponente all'acquisto — dati della Trattativa ──
  esiti.push(await genera('accordo-provvigionale', 'Accordo provvigionale con il Proponente all\'acquisto',
    { titolo: 'ACCORDO PROVVIGIONALE CON IL PROPONENTE ALL\'ACQUISTO', sottotitolo: 'Accordo economico collegato a proposta d\'acquisto – art. 1755 c.c.', piede: 'Accordo provvigionale con il Proponente' },
    { ...DEF_AGENZIA, acc_tipo_perc: { k: 'accordo_tipo', v: 'Percentuale' }, acc_tipo_forf: { k: 'accordo_tipo', v: 'Forfettario' }, acc_mezzo_bon: { k: 'accordo_pagamento_mezzo', v: 'Bonifico bancario' }, acc_mezzo_ass: { k: 'accordo_pagamento_mezzo', v: 'Assegno non trasferibile' } },
    (m) => {
      m.barra('Le parti'); m.apriBox();
      AGENZIA(m);
      m.sottotitolo('IL PROPONENTE (PARTE PROMITTENTE ACQUIRENTE)');
      PROPONENTE(m, 'cliente'); m.chiudiBox();

      m.barra('Art. 1 – Premessa e collegamento con la proposta irrevocabile d\'acquisto'); m.apriBox();
      m.p('Il presente accordo viene sottoscritto contestualmente alla Proposta Irrevocabile d\'Acquisto formulata dal Proponente in data {f:proposta_data:80} (con validità fino alle ore {f:proposta_validita_ora:44} del giorno {f:proposta_validita_data:80}) per l\'acquisto dell\'unità immobiliare di seguito identificata:');
      m.riga([{ l: 'Ubicazione: Comune', f: 'immobile__comune', w: 0.42 }, { l: 'Prov.', f: 'immobile__provincia', w: 0.15 }, { l: 'Via/Piazza', f: 'immobile__indirizzo', w: 0.43 }]);
      m.riga([{ l: 'N. civico', f: 'immobile__numero_civico', w: 0.25 }, { l: 'Piano', f: 'immobile__piano', w: 0.25 }, { l: 'Int.', f: 'immobile__interno', w: 0.2 }]);
      m.riga([{ l: 'Estremi catastali: Catasto Fabbricati di', f: 'immobile__comune_catasto', w: 0.5 }, { l: 'Foglio', f: 'immobile__foglio_catastale', w: 0.17 }, { l: 'Part.', f: 'immobile__particella_catastale', w: 0.17 }, { l: 'Sub.', f: 'immobile__subalterno_catastale', w: 0.16 }]);
      m.riga([{ l: 'Prezzo offerto in proposta: €', f: 'proposta_prezzo', w: 0.46 }, { l: 'Euro (in lettere)', f: 'proposta_prezzo_lettere', w: 0.54 }]);
      m.chiudiBox();

      m.barra('Art. 2 – Riconoscimento dell\'attività di mediazione e misura della provvigione'); m.apriBox();
      m.p('1. Il Proponente riconosce espressamente di aver visionato e selezionato l\'immobile sopra descritto grazie all\'intervento determinante e all\'attività di mediazione svolta dall\'Agenzia Immobiliare indicata in testa al presente accordo.', { ind: 14, first: '', after: 3 });
      m.p('2. Qualora la Proposta Irrevocabile d\'Acquisto venga accettata dalla Parte Venditrice (ovvero qualora l\'affare si concluda anche a seguito di controproposta o successiva rinegoziazione del prezzo tra le medesime parti o soggetti collegati), il Proponente si impegna a corrispondere all\'Agenzia Immobiliare una provvigione pari a:', { ind: 14, first: '', after: 3 });
      m.p('{c:acc_tipo_perc} Compenso a percentuale: {f:accordo_perc:44} % oltre IVA di legge calcolata sul prezzo effettivo di compravendita;', { ind: 28, after: 3 });
      m.p('{c:acc_tipo_forf} Compenso fisso / forfettario: € {f:accordo_forfettario:80} (Euro {f:accordo_forfettario_lettere:170}) oltre IVA di legge.', { ind: 28, after: 2 });
      m.chiudiBox();

      m.barra('Art. 3 – Maturazione del diritto, condizioni sospensive e pagamento'); m.apriBox();
      m.p('1. Ai sensi dell\'art. 1755 c.c., il diritto alla provvigione matura al momento della conclusione dell\'affare, ossia quando il Proponente ha conoscenza dell\'avvenuta accettazione scritta della proposta da parte della Parte Venditrice.', { ind: 14, first: '', after: 3 });
      m.p('2. Proposta subordinata a condizione sospensiva: qualora la Proposta Irrevocabile d\'Acquisto sia subordinata a una condizione sospensiva (es. delibera di mutuo o verifica urbanistica), il diritto alla provvigione maturerà esclusivamente al momento dell\'avveramento della condizione stessa (art. 1359 c.c.). In caso di mancato avveramento entro il termine pattuito per causa non imputabile al Proponente, nulla sarà dovuto all\'Agenzia a titolo di provvigione o rimborso spese.', { ind: 14, first: '', after: 3 });
      m.p('3. Modalità di corresponsione: il pagamento della provvigione avverrà dietro emissione di regolare fattura nei seguenti termini (es. 100% alla comunicazione dell\'accettazione / 50% al preliminare e 50% al rogito notarile):', { ind: 14, first: '', after: 2 });
      m.riga([{ f: 'accordo_pagamento_termini', w: 1 }]);
      m.p('mediante:   {c:acc_mezzo_bon} bonifico bancario   {c:acc_mezzo_ass} assegno non trasferibile.', { ind: 14, after: 2 });
      m.chiudiBox();

      m.barra('Art. 4 – Permanenza dell\'obbligo provvigionale e clausola anti-elusione'); m.apriBox();
      m.p('La provvigione pattuita resterà integralmente dovuta anche qualora: a) dopo il perfezionamento del contratto preliminare le parti decidessero di risolverlo consensualmente o una di esse risultasse inadempiente; b) il Proponente esercitasse la facoltà di nomina di terzo ai sensi dell\'art. 1401 c.c., ovvero l\'acquisto venisse concluso da coniuge, convivente, parenti/affini entro il terzo grado o società partecipate/amministrate dal Proponente medesimo.', { after: 2 });
      m.chiudiBox();

      m.barra('Art. 5 – Informativa privacy (GDPR) e antiriciclaggio'); m.apriBox();
      m.p('Il Proponente dichiara di aver ricevuto l\'informativa sul trattamento dei dati personali ai sensi dell\'art. 13 del Regolamento (UE) 2016/679 e adempie agli obblighi di identificazione previsti dal D.Lgs. 231/2007.', { after: 4 });
      m.riga([{ l: 'Luogo e data:', f: 'x_luogo_data', w: 0.6 }]);
      m.firme('Il Proponente', 'L\'Agenzia Immobiliare');
      m.chiudiBox();
      m.blocco('Approvazione specifica ai sensi degli artt. 1341 e 1342 c.c.', 'Ai sensi e per gli effetti degli artt. 1341 e 1342 c.c., il Proponente dichiara di aver letto e di approvare specificamente le seguenti clausole: **Art. 2** (Misura della provvigione anche in caso di controproposta); **Art. 3** (Maturazione del diritto e pagamento); **Art. 4** (Permanenza dell\'obbligo provvigionale e clausola anti-elusione).');
      m.firme('Il Proponente (per approvazione specifica)', '');
    }));

  console.log(esiti.map((e) => e.chiave + ': ' + e.pagine + ' pagine, ' + e.campi + ' campi, ' + Math.round(e.byte / 1024) + ' KB').join('\n'));
  if (process.argv[2]) { // copia per l'agenzia
    fs.mkdirSync(process.argv[2], { recursive: true });
    const nomi = { 'incarico-ricerca': 'Incarico di ricerca immobiliare (Property Finder) - compilabile.pdf', 'proposta-acquisto': "Proposta irrevocabile d'acquisto - compilabile.pdf", 'accordo-provvigionale': "Accordo provvigionale con il Proponente - compilabile.pdf" };
    for (const e of esiti) fs.copyFileSync(PAC + e.chiave + '.pdf', path.join(process.argv[2], nomi[e.chiave]));
  }
})().catch((e) => { console.error(e); process.exit(1); });
