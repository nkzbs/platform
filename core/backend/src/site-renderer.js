'use strict';
// Sito Web pubblico (2026-09-04, richiesto dall'utente: "vorrei la parte SEO,
// è importante") — HTML generato lato server, mai un bundle React idratato lato
// client: un motore di ricerca deve vedere il contenuto vero nella risposta HTML,
// non una pagina vuota che si popola via JS dopo. Stessa logica "regole come dati"
// già in uso per l'Assessment Engine: blocks_json descrive COSA renderizzare, mai
// codice — un nuovo tipo di blocco è un nuovo case in renderBlock(), mai una
// riscrittura del motore.
const db = require('./db');

// Content-binding dinamico (2026-09-05, "abbiamo Divi?" — fase 2, richiesto
// esplicitamente dall'utente: "un valore di un modulo in QUALSIASI campo di
// testo", non solo la griglia prodotti). Un token {{bind:modulo:id:campo}}
// dentro QUALUNQUE stringa che passa per escapeHtml — che è già il punto di
// passaggio universale per ogni testo/attributo di questo motore, sia
// contenuto visibile che href/src — viene sostituito col valore VERO e
// CORRENTE letto da records al momento del rendering, mai una copia statica
// che si disallinea. Un token che punta a un modulo/record/campo inesistente
// mostra un segnaposto visibile, mai un vuoto silenzioso: "niente dati
// finti, mai" vale anche al contrario, un buco silenzioso nasconderebbe un
// problema reale invece di segnalarlo a chi ha scritto quel blocco.
const BIND_TOKEN_RE = /\{\{bind:([a-z0-9_]+):(\d+):([a-zA-Z0-9_]+)\}\}/g;
function resolveBindings(str) {
  // Short-circuit (2026-09-05) — il caso comune (nessun token) non deve
  // pagare il costo di una regex su OGNI singola stringa che passa per
  // escapeHtml, chiamata moltissime volte per ogni pagina.
  if (str.indexOf('{{bind:') === -1) return str;
  return str.replace(BIND_TOKEN_RE, (full, moduleSlug, recordId, field) => {
    const row = db.prepare('SELECT data FROM records WHERE module_slug = ? AND id = ?').get(moduleSlug, parseInt(recordId, 10));
    if (!row) return '⚠ dato mancante';
    let data;
    try { data = JSON.parse(row.data || '{}'); } catch (e) { return '⚠ dato mancante'; }
    if (!(field in data) || data[field] == null) return '⚠ campo mancante';
    // Il valore del campo va comunque sanificato (escapeHtml, non
    // resolveBindings ricorsivo — un valore di un record non può a sua
    // volta contenere un token, evita un loop se qualcuno ci scrivesse
    // dentro per errore una stringa che sembra un token).
    return String(data[field]).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  });
}
function escapeHtml(s) {
  return resolveBindings(String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));
}

// escapeAttr (2026-09-05, fase 3 — vedi sanitizeRichText sotto) — escape
// per il contesto ATTRIBUTO HTML (solo & e "), non per contenuto testuale:
// serve per incastonare un blob HTML già sanificato (che contiene < e >
// VERI, es. <strong>) dentro un attributo come data-i18n-en="..." senza
// romperlo — escapeHtml normale codificherebbe anche < e >, restituendo i
// tag come testo letterale invece che come markup una volta riletti dal
// browser (che decodifica automaticamente le entità di un attributo).
function escapeAttr(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

// Formattazione di testo (2026-09-05, "abbiamo Divi?" — fase 3, richiesta
// esplicitamente dall'utente dopo aver riletto il motivo per cui era stata
// esclusa in un turno precedente: rompe "mai HTML nei campi di testo").
// Sottoinsieme MINIMO e rigorosamente sanificato — grassetto/corsivo/link,
// mai HTML libero — SOLO per i campi di testo libero più lunghi (body/
// intro), mai titoli/etichette/bottoni (un titolo con un link incorporato
// non ha un caso d'uso reale). Tokenizza con un'allowlist fissa invece di
// un parser HTML vero (niente dipendenze nuove, principio ripetuto in
// questo file): ogni frammento di testo TRA i tag riconosciuti passa
// comunque per escapeHtml (eredita gratis anche il content-binding della
// fase 2). Un tag NON in whitelist scritto a mano nel campo (es. <script>)
// finisce escapato come testo letterale, mai eseguito — la sicurezza non
// dipende da quanto l'admin del tenant è disciplinato nello scriverlo.
const RICH_TAG_RE = /<(\/?)(strong|em|b|i)>|<a\s+href="([^"]*)"[^>]*>|<\/a>/gi;
function sanitizeRichText(raw) {
  if (raw == null || raw === '') return '';
  const str = String(raw);
  let result = '';
  let lastIndex = 0;
  let openA = false;
  RICH_TAG_RE.lastIndex = 0;
  let m;
  while ((m = RICH_TAG_RE.exec(str))) {
    result += escapeHtml(str.slice(lastIndex, m.index));
    lastIndex = RICH_TAG_RE.lastIndex;
    if (m[0].toLowerCase() === '</a>') {
      if (openA) { result += '</a>'; openA = false; }
      continue;
    }
    if (m[3] !== undefined) {
      // href validato ad allowlist di schema (2026-09-05) — mai
      // "javascript:" o simili, un link che l'admin scrive qui è comunque
      // testo libero, non un campo URL già validato altrove in questo file.
      const href = m[3];
      const safe = /^(https?:|mailto:|tel:|#|\/)/i.test(href) ? href.replace(/&/g, '&amp;').replace(/"/g, '&quot;') : '#';
      if (openA) result += '</a>'; // mai <a> annidati, chiude quello precedente prima di aprirne un altro
      result += `<a href="${safe}" target="_blank" rel="noopener noreferrer">`;
      openA = true;
      continue;
    }
    // <b>/<i> normalizzati a <strong>/<em> (2026-09-05) — il contenteditable
    // di alcuni browser produce <b>/<i>, non <strong>/<em>: un'unica
    // whitelist di OUTPUT invece di mantenerne due equivalenti.
    const closing = m[1] === '/';
    const raw2 = m[2].toLowerCase();
    const tag = raw2 === 'b' ? 'strong' : raw2 === 'i' ? 'em' : raw2;
    result += closing ? `</${tag}>` : `<${tag}>`;
  }
  result += escapeHtml(str.slice(lastIndex));
  if (openA) result += '</a>'; // <a> mai chiuso nel testo originale: chiude comunque, mai markup rotto
  return result;
}

// Sito Web è funzionalità CORE (2026-09-05, richiesto dall'utente: "il
// modulo così non è gestibile tramite builder -> fallo diventare
// funzionalità core e gestibile dall'attuale schema in impostazioni") —
// prima era un modulo Store installabile con licenza, con blocchi "PRO"
// (galleria/testimonianze/html_custom) sbloccati solo a modulo installato.
// Trovato mentre si eseguiva questa richiesta: il registry aveva ANCHE un
// doppione mai ripulito dopo la rinomina (id 204 "Editor Avanzato" +
// id 205 "Sito Web", entrambi pubblicati) — da qui "uniscili in un unico
// modulo". Ora tutti i blocchi sono sempre disponibili per ogni tenant,
// gratis, attivabile/configurabile solo da tenant_settings.site_enabled
// (Impostazioni → Sito Web) — stesso schema già in uso per GDPR/dati
// aziendali, mai un'installazione da Store per questa funzionalità.

// Sezione scura (2026-09-04, richiesto dall'utente dopo un mockup reale — sezioni
// scure alternate a chiare, non un unico sfondo piatto) — flag per BLOCCO
// (block.dark), non per pagina: un brand può volere hero scuro, sezione valori
// chiara, timeline scura, esattamente come nel mockup mostrato. Classe aggiunta
// dal chiamante (renderBlock), non da ogni singolo case, per non ripetere la
// stessa condizione ovunque.
// Bug reale trovato il 2026-09-04 (feedback dal vivo: "a livello grafico siamo
// all'opposto" — troppo chiaro dove il brand è prevalentemente scuro) — dopo aver
// riequilibrato i blocchi verso lo scuro, blocchi .s-dark CONSECUTIVI mostravano
// una fessura bianca tra loro (ognuno arrotondato/con margine indipendentemente),
// spezzando quella che nel mockup è un'unica sezione scura continua. ctx.darkPos
// ('top'/'bottom'/'both'/null) arriva da renderPageHtml, che conosce l'intera
// sequenza di blocchi — un singolo blocco non può sapere da solo se è isolato o
// parte di una serie.
function darkClass(block, ctx) {
  if (!block.dark) return '';
  const pos = (ctx && ctx.darkPos) || 'both';
  let cls = ' s-dark';
  if (pos === 'top' || pos === 'both') cls += ' s-dark-top';
  if (pos === 'bottom' || pos === 'both') cls += ' s-dark-bottom';
  return cls;
}

// Click-to-edit (2026-09-04, primo passo verso "stile Divi/Elementor" dopo
// l'anteprima live — l'utente: "Divi è importante") — SOLO quando ctx.editable
// è true (mai sulla pagina pubblica vera, solo nell'iframe di POST /preview):
// aggiunge contenteditable + attributi data-sw-* ai campi di testo più
// comuni. Lo script iniettato in fondo al body (vedi renderPageHtml) ascolta
// gli eventi 'input' su questi elementi e li rimanda al genitore via
// postMessage — sync silenzioso dello stato React, MAI un ricaricamento
// dell'iframe (perderebbe il focus/cursore a ogni tasto). Copertura di
// questo primo giro: hero (headline/subheadline) e testo (title/body) — i
// campi editati più di frequente, non ancora ogni tipo di blocco.
function editAttrs(ctx, field) {
  if (!ctx || !ctx.editable) return '';
  // Bug reale trovato il 2026-09-04 aggiungendo le immagini cliccabili: header/
  // footer/valori applicano editAttrs a elementi che hanno GIÀ una classe
  // propria (es. <div class="s-footer-brand">) — un secondo class="sw-editable"
  // sullo stesso tag è HTML non valido (comportamento imprevedibile tra
  // browser, non un semplice "si sovrascrive"). Niente class= qui: il CSS
  // sotto usa il selettore d'attributo [data-sw-field] direttamente.
  // ctx.fieldPrefix (2026-09-05, blocco 'riga') — un blocco figlio dentro una
  // colonna non vive in blocks_json[N].config, ma in
  // blocks_json[N].config.columns[C].blocks[B].config: il campo va scritto lì,
  // non alla radice. ctx.blockIndex resta SEMPRE l'indice del blocco riga
  // (quello vero in blocks_json), solo il percorso del campo si allunga —
  // stesso setDeep() del frontend, nessun codice nuovo lato client per questo.
  const f = (ctx.fieldPrefix || '') + field;
  return ` contenteditable="true" data-sw-block="${ctx.blockIndex}" data-sw-field="${f}"`;
}

// Immagini cliccabili (2026-09-04, terzo passo dopo drag/riordino — l'utente:
// "vorrei qualcosa di operativo uguale a divi/elementor") — un'immagine non è
// testo, contenteditable non ha senso: click -> postMessage al genitore, che
// mostra un piccolo popover con un campo URL (vedi SitoWebPage.jsx), mai un
// vero media-library/upload (fuori scope, vedi piano in stato-lavori).
// URL dei link editabili nel canvas (2026-09-04, quinto passo — l'utente:
// "vorrei qualcosa di operativo uguale a divi/elementor") — un href non è
// testo (contenteditable non ha senso) né un'immagine: piccola icona
// separata subito dopo il link, mai sul link stesso (altrimenti il click
// per aprire il popover finirebbe anche sul testo cliccabile per l'etichetta,
// già gestito da editAttrs sullo stesso <a>). Stesso popover del click su
// un'immagine, riusato lato frontend con un campo `url` invece di `value`
// per la label del bottone ("Cambia link" vs "Cambia immagine").
function urlEditIcon(ctx, field, url) {
  if (!ctx || !ctx.editable) return '';
  const f = (ctx.fieldPrefix || '') + field;
  return `<span class="sw-url-edit" data-sw-url-block="${ctx.blockIndex}" data-sw-url-field="${f}" data-sw-url-value="${escapeHtml(url || '')}" title="Cambia link">🔗</span>`;
}

function imgEditAttrs(ctx, field, value) {
  if (!ctx || !ctx.editable) return '';
  // Niente class="..." qui apposta — alcuni <img> hanno già una classe
  // propria (es. s-testo-photo) e un secondo attributo class= sullo stesso
  // tag non è HTML valido. Il CSS sotto usa il selettore d'attributo
  // [data-sw-img-block] direttamente, non una classe dedicata.
  // value opzionale (2026-09-05, "hero full-bleed" — la foto qui è un
  // background-image su una <section>, non un <img src>: niente attributo
  // src da cui leggere il valore attuale al click, serve un fallback esplicito.
  const f = (ctx.fieldPrefix || '') + field;
  return ` data-sw-img-block="${ctx.blockIndex}" data-sw-img-field="${f}"${value !== undefined ? ` data-sw-img-value="${escapeHtml(value || '')}"` : ''}`;
}

// Icona cliccabile (2026-09-05, canvas WYSIWYG fase B — "gestione voci di
// lista in canvas") — stesso schema di imgEditAttrs, un attributo in più
// (data-sw-icon-value, sempre presente anche vuoto: a differenza di
// un'immagine, un'icona può non esserci affatto e va comunque possibile
// cliccare "aggiungine una", non solo "cambia quella esistente").
function iconEditAttrs(ctx, field, value) {
  if (!ctx || !ctx.editable) return '';
  const f = (ctx.fieldPrefix || '') + field;
  return ` data-sw-icon-block="${ctx.blockIndex}" data-sw-icon-field="${f}" data-sw-icon-value="${escapeHtml(value || '')}"`;
}

// IT/EN (2026-09-05, richiesto dall'utente: "il tasto ita eng" del mockup
// deve funzionare davvero) — convenzione generica: qualunque campo testuale
// "campo" può avere un compagno opzionale "campo_en" nello stesso config.
// Se presente, il tag riceve data-i18n-en con la traduzione — la pagina
// pubblica mostra SEMPRE l'italiano come default (comportamento identico a
// oggi per chi non compila mai un campo _en), il tasto IT/EN nell'header
// (vedi i18nScript) scambia il testo via JS, mai un secondo giro di rendering
// server. A differenza di editAttrs, NON dipende da ctx.editable: deve
// esserci anche sulla pagina pubblica vera, è lì che serve.
// rich (2026-09-05, fase 3) — opt-in ESPLICITO per campo: senza questo,
// OGNI altro campo i18n (titoli, etichette, bottoni — la stragrande
// maggioranza) resta ESATTAMENTE sul percorso testContent di sempre, zero
// rischio nuovo. Solo i pochi campi chiamati con rich=true (intro/body)
// prendono il percorso innerHTML, e SEMPRE con contenuto già sanificato
// da questo stesso file (mai testo libero non passato da sanitizeRichText).
function i18nAttr(c, field, rich) {
  const en = c && c[field + '_en'];
  if (!en) return '';
  if (rich) return ` data-i18n-en="${escapeAttr(sanitizeRichText(en))}" data-i18n-rich="1"`;
  return ` data-i18n-en="${escapeHtml(en)}"`;
}

// Occhiello (2026-09-05, bug reale trovato confrontando testo per testo col
// mockup: "i testi sono uguali al mockup? a me non pare" — l'utente aveva
// ragione. Il mockup ha, su quasi OGNI sezione, una piccola etichetta sopra
// il titolo (es. "Le origini" sopra "Un mondo di origini, una sola
// torrefazione.") — un campo che il motore non aveva affatto, per questo in
// una sessione precedente l'occhiello era finito scambiato per il titolo
// vero in almeno due sezioni. Campo generico opzionale su hero/testo/
// timeline/valori/cta/form, non specifico di un tipo di blocco.
// Swoosh decorativo (2026-09-06, confronto 1:1 col mockup — fase 8,
// impostazione di Tema `eyebrow_swoosh`): stesso path SVG del mockup di
// riferimento, un piccolo tratto che si "disegna" (stroke-dashoffset)
// quando il blocco entra in vista. Riusa .s-in-view — il blocco che
// contiene l'eyebrow riceve GIÀ quella classe da revealScript/withReveal,
// zero JS nuovo per questo pezzo (solo CSS, funziona anche su touch).
const SWOOSH_SVG = '<svg class="s-swoosh" viewBox="0 0 88 20" aria-hidden="true"><path d="M2 4 C 30 2, 55 2, 78 10 C 70 8, 60 14, 62 17"/></svg>';
// emptyBlockHint (2026-09-06, bug reale segnalato dall'utente: "se aggiungo
// componenti nel live composer non si crea il nuovo blocco") — indagine dal
// vivo: il blocco viene inserito correttamente (verificato passo-passo,
// compare nella sidebar al posto giusto), ma un blocco "testo" appena
// creato ha titolo e corpo entrambi vuoti — nessun <h2>, un <div><p></p></div>
// senza contenuto: nel canvas non c'è NULLA da vedere, sembra che il click
// non abbia fatto niente anche se in realtà ha funzionato. SOLO in
// ctx.editable (mai sulla pagina pubblica vera — un blocco vuoto lì è un
// problema di contenuto dell'admin, non qualcosa da segnalare ai visitatori).
function emptyBlockHint(ctx, text) {
  if (!(ctx && ctx.editable)) return '';
  return `<div class="s-empty-block-hint">${escapeHtml(text)}</div>`;
}

function eyebrowHtml(ctx, c) {
  if (!c.eyebrow) return '';
  const span = `<span class="s-eyebrow"${editAttrs(ctx, 'eyebrow')}${i18nAttr(c, 'eyebrow')}>${escapeHtml(c.eyebrow)}</span>`;
  // Wrapper SOLO quando il toggle di Tema è attivo (2026-09-06) — output
  // identico byte-per-byte a prima per chiunque non usi lo swoosh, mai un
  // <span> in più nel DOM di ogni tenant esistente per una funzionalità
  // che non ha attivato.
  if (!(ctx && ctx.eyebrowSwoosh)) return span;
  return `<span class="s-eyebrow-wrap">${span}${SWOOSH_SVG}</span>`;
}

// Scritta a mano decorativa opzionale (2026-09-05, dal mockup reale — "Più di
// un caffè, una scelta consapevole.", "La qualità che senti, il piacere che
// ricordi."): campo generico su hero/footer, font Caveat caricato SOLO se
// almeno un blocco lo usa (vedi renderPageHtml).
function handwrittenHtml(ctx, c) {
  if (!c.handwritten) return '';
  return `<div class="s-handwritten"${editAttrs(ctx, 'handwritten')}${i18nAttr(c, 'handwritten')}>${escapeHtml(c.handwritten).replace(/\n/g, '<br>')}</div>`;
}

// Set fisso di icone (2026-09-05, richiesto dall'utente: mix tra il mockup
// scuro e una seconda grafica con badge/icone in cerchio su timeline e
// griglia valori) — stesso principio già seguito per la mappa icone del
// frontend (shared/frontend/Icon.jsx): un allowlist fissa, MAI nomi liberi
// renderizzati alla cieca. Nessuna libreria esterna (coerente con "niente
// dipendenze nuove" già scritto più sopra in questo file), solo path SVG
// inline minimi, stroke=currentColor.
const ICONS = {
  leaf: '<path d="M5 20c0-8 5-14 14-15-1 9-7 14-15 15Z"/><path d="M6 19c3-4 6-7 12-13"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>',
  truck: '<path d="M2 8h11v9H2z"/><path d="M13 11h4l3 3v3h-7z"/><circle cx="6" cy="19" r="1.6"/><circle cx="17" cy="19" r="1.6"/>',
  flame: '<path d="M12 2c1 4-4 5-4 9a4 4 0 0 0 8 0c0-2-1-3-1-3s2 1 2 5a6 6 0 0 1-12 0c0-6 5-6 7-11Z"/>',
  dots: '<circle cx="6" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18" cy="12" r="1.4"/>',
  cup: '<path d="M4 4h13v9a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5Z"/><path d="M17 7h2a3 3 0 0 1 0 6h-2"/><path d="M6 20h10"/>',
  heart: '<path d="M12 20s-7-4.4-9.5-8.8C1 8 2.5 4.5 6 4a5 5 0 0 1 6 2.2A5 5 0 0 1 18 4c3.5.5 5 4 3.5 7.2C19 15.6 12 20 12 20Z"/>',
  trophy: '<path d="M7 4h10v4a5 5 0 0 1-10 0Z"/><path d="M5 5H3v2a4 4 0 0 0 4 4M19 5h2v2a4 4 0 0 1-4 4M9 20h6M12 13v7"/>',
  users: '<circle cx="8.5" cy="8" r="3"/><circle cx="16" cy="9" r="2.4"/><path d="M2.5 20c0-3.5 2.7-6 6-6s6 2.5 6 6M15 14.5c2.6.2 4.5 2.3 4.5 5.5"/>',
  shield: '<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6Z"/><path d="M9 12l2 2 4-4"/>',
  headphones: '<path d="M4 13a8 8 0 0 1 16 0"/><rect x="2.5" y="13" width="4" height="6" rx="1.4"/><rect x="17.5" y="13" width="4" height="6" rx="1.4"/>',
  book: '<path d="M4 5h6a3 3 0 0 1 2 .8A3 3 0 0 1 14 5h6v13h-6a3 3 0 0 0-2 .8A3 3 0 0 0 12 18V5"/><path d="M12 5v13"/>',
};
function iconHtml(name, attrs) {
  const path = ICONS[name];
  if (!path) return '';
  return `<svg${attrs || ''} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
}

// Variante multi-paragrafo (2026-09-05, blocco 'testo') — il corpo testo è
// già spezzato in più <p> dal chiamante: se lo scambiassimo con
// el.textContent come ogni altro campo, l'inglese finirebbe in un unico
// blocco di testo senza andare a capo tra un paragrafo e l'altro. Porta
// anche il testo italiano RAW (non derivato da el.textContent, che perde i
// confini tra paragrafi) così i18nScript può ricostruire i <p> in entrambe
// le direzioni con createElement+textContent — mai innerHTML, zero rischio
// di iniezione anche se il campo EN contenesse caratteri HTML.
// rich (2026-09-05, fase 3) — stesso opt-in esplicito di i18nAttr sopra.
// Per un campo rich, il blob HTML già spezzato in paragrafi e sanificato
// va incastonato nell'attributo con escapeAttr (solo &/" — mai escapeHtml,
// che codificherebbe anche i tag < > appena generati da sanitizeRichText,
// restituendoli come testo letterale invece che come markup).
function i18nMultiAttr(c, field, rich) {
  const en = c && c[field + '_en'];
  if (!en) return '';
  if (rich) {
    const buildHtml = (text) => (text || '').split('\n\n').map((p) => `<p>${sanitizeRichText(p)}</p>`).join('');
    return ` data-i18n-en="${escapeAttr(buildHtml(en))}" data-i18n-multi="1" data-i18n-rich="1" data-i18n-it-raw="${escapeAttr(buildHtml(c[field]))}"`;
  }
  return ` data-i18n-en="${escapeHtml(en)}" data-i18n-multi="1" data-i18n-it-raw="${escapeHtml(c[field] || '')}"`;
}

// Scansione generica (2026-09-05) — vero per QUALUNQUE valore che contenga
// una chiave "_x_en" compilata, a qualunque profondità (nav_links[].label_en,
// columns[].title_en, un domani anche dentro una 'riga' se un blocco figlio
// avrà campi _en) — mai un elenco di campi noti per tipo da tenere
// aggiornato a mano ogni volta che se ne aggiunge uno nuovo.
function hasI18nContent(value) {
  if (Array.isArray(value)) return value.some(hasI18nContent);
  if (value && typeof value === 'object') {
    return Object.keys(value).some((k) => (k.endsWith('_en') ? !!value[k] : hasI18nContent(value[k])));
  }
  return false;
}

// anchor_id (2026-09-04) — bug reale trovato dall'utente ("i link non
// vanno"): la nav dell'header (html_custom, markup del mockup con
// data-target="#chi-siamo" ecc.) puntava a id che non esistevano da
// nessuna parte nei blocchi nativi di contenuto — zero corrispondenze nel
// DOM, nessuno scroll poteva mai succedere. Campo opzionale generico su
// QUALUNQUE blocco (non solo per Nico Caffè), inserito nel tag di apertura
// del risultato invece di duplicare la logica in ogni singolo case dello
// switch sotto.
// Comparsa allo scroll (2026-09-05, richiesto dall'utente dopo un confronto
// diretto col mockup: "vorrei avere la stessa identica resa" — l'unica cosa
// dichiarata esplicitamente come non replicata). SOLO sulla pagina pubblica
// vera (mai in ctx.editable: l'iframe di anteprima si ricarica spesso
// mentre si modifica, un fade-in ripetuto ad ogni ricarica sarebbe solo
// fastidioso), mai su header/footer (chrome sempre visibile, un nav che
// sparisce e riappare mentre si scrolla non ha senso). Inserita nella
// classe GIÀ presente sul tag radice (mai un secondo attributo class=,
// bug reale già trovato ed evitato altrove in questo file per lo stesso
// motivo) — ogni case dello switch sopra produce sempre un tag radice con
// una classe propria, quindi `class="` esiste sempre come primo
// occorrenza nella stringa.
// Varianti di animazione (2026-09-05, "guardati Elementor e Divi" — animazioni
// reali, non solo il fade-in generico unico che c'era prima). Allowlist fissa
// (stesso principio già in uso per le icone: un valore non riconosciuto viene
// ignorato, mai passato alla cieca in una classe CSS) — 'fade' è il default
// storico (nessuna classe modificatore, comportamento identico a prima di
// oggi, zero regressione), le altre aggiungono una classe modificatrice che
// SOVRASCRIVE il transform di partenza di .s-reveal (vedi CSS: selettore
// composto .s-reveal.s-reveal-X, più specifico del solo .s-reveal).
const REVEAL_ANIMATIONS = ['fade', 'left', 'right', 'zoom'];
function withReveal(html, animation) {
  const variant = REVEAL_ANIMATIONS.includes(animation) && animation !== 'fade' ? ' s-reveal-' + animation : '';
  return html.replace(/class="/, 'class="s-reveal' + variant + ' ');
}

// Stile per singolo blocco (2026-09-05, "guardati Elementor e Divi" — lì
// ogni widget ha controlli di sfondo/spaziatura/allineamento propri, non
// solo un font/colore globali di pagina). Valori sanificati alla brutta
// (via escapeHtml, coerente col resto del motore) — stesso livello di
// fiducia già dato a logo_svg/html_custom: chi scrive qui è admin del
// proprio tenant, non un visitatore.
function styleOverridePairs(so) {
  if (!so) return [];
  const pairs = [];
  if (so.background) pairs.push(['background', so.background]);
  if (so.padding) pairs.push(['padding', so.padding]);
  if (so.text_align) pairs.push(['text-align', so.text_align]);
  if (so.color) pairs.push(['color', so.color]);
  return pairs;
}
function styleOverrideCss(so) {
  return styleOverridePairs(so).map(([k, v]) => `${k}:${escapeHtml(v)}`).join(';');
}
// Override per dispositivo (2026-09-05, "guardati Elementor e Divi" — lì
// ogni widget può avere valori diversi per desktop/tablet/mobile, non un
// unico stile fisso). Un inline style="" non può esprimere @media: serve
// una regola vera in un <style>, agganciata a un selettore STABILE presente
// anche sulla pagina pubblica (data-s-blk, sempre scritto, non solo in
// modalità editable come data-sw-block-root). !important perché deve poter
// vincere anche su un override di base già scritto inline sullo stesso tag.
function responsiveOverrideCss(blockIndex, so) {
  if (!so) return '';
  let css = '';
  if (so.tablet) {
    const pairs = styleOverridePairs(so.tablet);
    if (pairs.length) css += `@media (max-width:900px){[data-s-blk="${blockIndex}"]{${pairs.map(([k, v]) => `${k}:${escapeHtml(v)} !important`).join(';')}}}`;
  }
  if (so.mobile) {
    const pairs = styleOverridePairs(so.mobile);
    if (pairs.length) css += `@media (max-width:640px){[data-s-blk="${blockIndex}"]{${pairs.map(([k, v]) => `${k}:${escapeHtml(v)} !important`).join(';')}}}`;
  }
  return css;
}
// Raccolta ricorsiva (2026-09-05, blocchi annidati di prima classe) — stesso
// schema di percorso usato da renderRiga per blockPath: primo livello =
// origIndex reale (calcolato PRIMA del filtro hidden, coerente con
// renderBlock), annidato = percorso_padre + '.c'+ci+'.b'+bi con bi = indice
// REALE dentro col.blocks (anch'esso pre-filtro, vedi renderRiga). Non
// replica il tetto MAX_RIGA_DEPTH/i filtri hidden di renderRiga: una regola
// CSS per un blocco che poi non viene renderizzato è solo innocua CSS morta
// (il selettore [data-s-blk="..."] semplicemente non trova nulla).
function collectResponsiveOverrides(blocksWithOrigIndex) {
  let css = '';
  function walk(list, pathFor) {
    (list || []).forEach((b, i) => {
      if (!b) return;
      const path = pathFor(b, i);
      if (b.style_overrides) css += responsiveOverrideCss(path, b.style_overrides);
      if (b.type === 'riga') {
        ((b.config && b.config.columns) || []).forEach((col, ci) => {
          walk(col.blocks, (cb, bi) => path + '.c' + ci + '.b' + bi);
        });
      }
    });
  }
  walk(blocksWithOrigIndex, (b, i) => String(b.origIndex != null ? b.origIndex : i));
  return css;
}

// Zona "+" (2026-09-05, canvas WYSIWYG fase D) — SEMPRE renderizzata (mai
// solo on-hover via JS: niente show-on-hover complesso, il "+" è piccolo e
// discreto di suo via CSS, coerente con "less moving parts" per una
// funzionalità additiva). atPath è lo stesso schema di percorso già usato
// per drag/toolbar/stile — un numero per il livello di primo livello
// ("2"), un percorso composto per dentro una colonna ("1.c0.b1").
function renderInsertZone(atPath) {
  return `<div class="sw-insert-zone"><button type="button" class="sw-insert-btn" data-sw-insert-at="${atPath}" title="Inserisci un blocco qui">+</button></div>`;
}

function renderBlock(block, ctx) {
  let html = renderBlockInner(block, ctx);
  if (!html) return html;
  if (block.anchor_id) {
    html = html.replace(/^(\s*<\w+)/, `$1 id="${escapeHtml(block.anchor_id)}"`);
  }
  // blockPath (2026-09-05, blocchi annidati di prima classe — "guardati
  // Elementor e Divi") — identità stabile per il selettore data-s-blk. Un
  // blocco di primo livello ha blockPath === String(blockIndex) (stessa
  // stringa di sempre, zero cambiamento per pagine esistenti); un blocco
  // dentro una colonna ha un percorso tipo "0.c0.b1" (vedi renderRiga),
  // perché più blocchi annidati possono condividere lo stesso blockIndex
  // (l'indice REALE della riga che li contiene) e un selettore CSS
  // identico per due blocchi diversi applicherebbe lo stile dell'uno
  // anche all'altro.
  const blkId = (ctx && ctx.blockPath != null) ? ctx.blockPath : (ctx && ctx.blockIndex);
  if (block.style_overrides) {
    html = html.replace(/^(\s*<\w+)/, `$1 data-s-blk="${blkId}"`);
  }
  const overrideCss = styleOverrideCss(block.style_overrides);
  if (overrideCss) {
    // Se il tag radice ha già un attributo style (es. hero/mission con
    // foto a sfondo), gli override si AGGIUNGONO, non lo sostituiscono —
    // due attributi style= sullo stesso tag non sarebbero HTML valido
    // (stesso principio già seguito per class=).
    const openTagMatch = html.match(/^\s*<\w+[^>]*>/);
    if (openTagMatch && /\sstyle="/.test(openTagMatch[0])) {
      html = html.replace(/(\sstyle=")/, `$1${overrideCss};`);
    } else {
      html = html.replace(/^(\s*<\w+)/, `$1 style="${overrideCss}"`);
    }
  }
  // animation: 'none' (2026-09-05) — disattiva la comparsa allo scroll per
  // QUESTO blocco (es. un form o un blocco già sopra la piega, che non deve
  // mai restare invisibile in attesa dello scroll) — l'unico valore che
  // salta withReveal del tutto, non solo la variante.
  const animation = block.style_overrides && block.style_overrides.animation;
  if (!(ctx && ctx.editable) && block.type !== 'header' && block.type !== 'footer' && animation !== 'none') {
    html = withReveal(html, animation);
  }
  // Drag diretto nel canvas (2026-09-04, secondo passo dopo il riordino via
  // form) + toolbar fluttuante (2026-09-05, primo pezzo del canvas WYSIWYG).
  // Estesi ai blocchi annidati (2026-09-05, canvas WYSIWYG fase C) usando
  // `blkId` (blockPath, es. "1.c0.b0") invece dell'indice piatto — motivo
  // identico a quello già documentato sopra per data-s-blk: due blocchi
  // annidati diversi possono condividere lo stesso ctx.blockIndex (l'indice
  // della riga che li contiene). Lato frontend, reorder/block-action/
  // insert-block ora riconoscono un path composto e navigano dentro
  // columns[ci].blocks invece che nel solo array di primo livello — un
  // riordino/inserimento resta comunque possibile SOLO all'interno dello
  // stesso contenitore (stessa colonna o stesso livello), mai spostando un
  // blocco DA un contenitore ALL'ALTRO: quel gesto in più non è mai stato
  // promesso e apre rischi (es. una riga trascinata dentro una propria
  // colonna) fuori scope per questo pezzo.
  // Una maniglia dedicata (non l'intera sezione draggable) per non entrare
  // in conflitto con la selezione di testo dentro i campi contenteditable
  // dello stesso blocco: un div padre con draggable="true" intercetta i
  // gesti di selezione testo in alcuni browser, una piccola maniglia
  // isolata no. data-sw-block-root identifica la sezione come bersaglio di
  // drop, separato da data-sw-drag-idx sulla maniglia stessa (chi trascina).
  if (ctx && ctx.editable) {
    // Seleziona (2026-09-05, canvas WYSIWYG fase A) — non modifica nulla,
    // segnala solo al pannello quale card evidenziare/raggiungere nella
    // sidebar (per un blocco annidato, la sua card DENTRO il form della
    // riga — vedi SitoWebPage.jsx).
    const toolbarHtml = `<div class="sw-block-toolbar">`
      + `<button type="button" class="sw-block-btn" data-sw-action="select" data-sw-block-idx="${blkId}" title="Seleziona (evidenzia nella sidebar) — Ctrl/Cmd+click per selezionarne più di uno">⚙</button>`
      + `<button type="button" class="sw-block-btn" data-sw-action="move-up" data-sw-block-idx="${blkId}" title="Sposta su">↑</button>`
      + `<button type="button" class="sw-block-btn" data-sw-action="move-down" data-sw-block-idx="${blkId}" title="Sposta giù">↓</button>`
      + `<button type="button" class="sw-block-btn" data-sw-action="duplicate" data-sw-block-idx="${blkId}" title="Duplica">⧉</button>`
      + `<button type="button" class="sw-block-btn" data-sw-action="delete" data-sw-block-idx="${blkId}" title="Elimina">✕</button>`
      + `</div>`;
    html = html.replace(/^(\s*<\w+[^>]*>)/, `$1<span class="sw-drag-handle" draggable="true" data-sw-drag-idx="${blkId}" title="Trascina per riordinare">⠿</span>${toolbarHtml}`);
    html = html.replace(/^(\s*<\w+)/, `$1 data-sw-block-root="${blkId}"`);
  }
  return html;
}

// Menu mobile (2026-09-05, bug reale trovato dall'utente dal vivo: "da pc
// buono" implicava non da mobile — sotto 800px .s-header-nav sparisce
// (max-width:800px) senza NULLA al suo posto, nav_links/tasto IT/EN/CTA
// diventavano irraggiungibili su telefono, non solo esteticamente diversi).
// Overlay a schermo intero, stesso pattern del mockup di riferimento
// (hamburger -> X, body scroll bloccato mentre aperto). onclick inline
// (non editableSyncScript, che esiste solo in modalità admin/preview) — deve
// funzionare sulla pagina pubblica vera, senza dipendere da nessun altro
// script. Niente editAttrs qui: il testo si modifica dal desktop o dal form,
// questo overlay è pensato per i VISITATORI, non per l'editing.
function renderMobileMenu(c, ctx) {
  if (!(c.nav_links || []).length) return '';
  const id = 'sMobileMenu-' + (ctx ? ctx.blockIndex : '0');
  const links = (c.nav_links || []).map((l) => `<a href="${escapeHtml(l.url)}"${i18nAttr(l, 'label')}>${escapeHtml(l.label)}</a>`).join('');
  const lang = ctx && ctx.hasI18n ? `<div class="s-lang-toggle"><button type="button" data-lang="it" class="active">IT</button><button type="button" data-lang="en">EN</button></div>` : '';
  const cta = c.cta_label && c.cta_url ? `<a class="s-header-cta" href="${escapeHtml(c.cta_url)}"${i18nAttr(c, 'cta_label')}>${escapeHtml(c.cta_label)}</a>` : '';
  const toggleJs = `var m=document.getElementById('${id}');var open=!m.classList.contains('s-open');m.classList.toggle('s-open',open);this.textContent=open?'✕':'☰';this.setAttribute('aria-expanded',open);document.body.style.overflow=open?'hidden':'';`;
  return `<button type="button" class="s-header-mobile-toggle" onclick="${toggleJs}" aria-label="Menu" aria-expanded="false">☰</button>
<div class="s-mobile-menu" id="${id}">${links}${lang}${cta}</div>`;
}

function renderBlockInner(block, ctx) {
  const c = block.config || {};
  const dk = darkClass(block, ctx);
  switch (block.type) {
    case 'hero': {
      // Foto a piena pagina con overlay scuro sfumato (2026-09-05, materiale
      // mockup REALE fornito dall'utente — non più uno screenshot ma il file
      // .html originale: la sezione hero lì è `background: linear-gradient(...),
      // url(foto) center/cover`, testo sovrapposto direttamente, non un pannello
      // laterale separato come costruito in precedenza da uno screenshot meno
      // preciso). Stesso gradiente orizzontale del file reale (95%->75%->15%->55%
      // di opacità), solo col nero del tema (#1c1917) invece del loro --espresso.
      const heroCta2 = c.cta_label2 && c.cta_url2
        ? `<a class="s-btn s-btn-ghost" href="${escapeHtml(c.cta_url2)}"${editAttrs(ctx, 'cta_label2')}${i18nAttr(c, 'cta_label2')}>${escapeHtml(c.cta_label2)}</a>` : '';
      // 2026-09-06, confronto diretto con l'artifact vero mostrato dall'utente
      // (non un file .html di una sessione precedente): lì la foto sta a
      // sinistra come una vera colonna propria (non uno sfondo a piena
      // larghezza di cui si rivela solo una fetta) — il testo su un
      // pannello scuro pieno a destra. TENTATIVO PRECEDENTE, sbagliato: un
      // solo background-image su tutta la section con un gradiente che
      // rivelava solo il 38% sinistro — "cover" scala l'immagine per
      // coprire l'INTERA larghezza della section (una foto verticale
      // stretta scalata su una section larga e bassa viene tagliata quasi
      // tutta in verticale), quindi la fetta rivelata mostrava solo un
      // frammento arbitrario e spesso sfocato/decentrato dell'immagine,
      // segnalato dall'utente ("la foto di sfondo non va bene"). Ora la
      // foto è un elemento suo proprio, confinato alla sola colonna
      // sinistra (~46% di larghezza) — "cover" la incornicia dentro
      // quella colonna, non nella section intera.
      // image_position (2026-09-06, opzionale, generico) — quale porzione
      // della foto restare a fuoco quando "cover" la ritaglia dentro la
      // colonna sinistra: una foto ritratto stretta con il soggetto sopra
      // il centro (bug reale trovato con la foto vera di Nico Caffè: il
      // crop centrato tagliava fuori la ciotola di chicchi, restava solo
      // la foglia) ha bisogno di un valore diverso da "center" — non
      // indovinabile in automatico, un campo per tenant/foto, default
      // invariato per chi non lo imposta.
      const heroPhotoEl = c.image_url
        ? `<div class="s-hero-photo-el" style="background-image:url('${escapeHtml(c.image_url)}')${c.image_position ? `;background-position:${escapeHtml(c.image_position)}` : ''}"${imgEditAttrs(ctx, 'image_url', c.image_url)}></div>`
        : '';
      // Ken Burns (2026-09-06, confronto 1:1 col mockup di riferimento) — opt-in,
      // solo con una foto impostata (senza immagine non c'è nulla da animare).
      // Il flag resta sulla SECTION (compatibilità con lo stato/i test
      // esistenti, e per coerenza con dark/parallax/altri flag di blocco),
      // ma la regola CSS ora anima .s-hero-photo-el (il nuovo elemento
      // foto), non più background-size della section stessa.
      const kenBurnsClass = c.image_url && c.ken_burns ? ' s-hero-kenburns' : '';
      // Parallax leggero (2026-09-06, confronto 1:1 col mockup — fase 7,
      // distinto dal Ken Burns: qui la foto si sposta durante lo SCROLL,
      // non un'animazione continua indipendente) — opt-in, solo con una
      // foto impostata. Il flag resta sulla section (vedi sopra); lo
      // script ora anima backgroundPositionY di .s-hero-photo-el dentro
      // di essa, non più della section — la foto è di nuovo un elemento a
      // sé, quindi un domani si potrebbe passare a un transform diretto
      // su di essa senza toccare il testo (non ancora fatto, per restare
      // sullo stesso meccanismo backgroundPositionY già testato).
      const parallaxClass = c.image_url && c.parallax ? ' s-hero-parallax' : '';
      return `<section class="s-hero${c.image_url ? ' s-hero-photo' : ''}${kenBurnsClass}${parallaxClass}${dk}">
        ${heroPhotoEl}
        <div class="s-hero-content">
          ${eyebrowHtml(ctx, c)}
          <h1${editAttrs(ctx, 'headline')}${i18nAttr(c, 'headline', true)}>${sanitizeRichText(c.headline || ctx.pageTitle).replace(/\n/g, '<br>')}</h1>
          ${c.subheadline ? `<p${editAttrs(ctx, 'subheadline')}${i18nAttr(c, 'subheadline')}>${escapeHtml(c.subheadline)}</p>` : ''}
          <div class="s-hero-ctas">${c.cta_label && c.cta_url ? `<a class="s-btn" href="${escapeHtml(c.cta_url)}"${editAttrs(ctx, 'cta_label')}${i18nAttr(c, 'cta_label')}>${escapeHtml(c.cta_label)}</a>` : ''}${heroCta2}</div>
        </div>
        ${handwrittenHtml(ctx, c)}
      </section>`;
    }
    case 'testo':
      // Immagine opzionale affiancata (2026-09-04, richiesto dall'utente: "deve
      // essere bello da vedere") — un campo URL in più nell'editor, non un blocco
      // nuovo: chi scrive "Chi siamo" spesso vuole una foto accanto al testo,
      // senza dover comporre due blocchi separati.
      // stats (2026-09-06, confronto 1:1 col mockup — segnalato dall'utente:
      // "va sotto tazzina"): nel mockup i contatori della mission stanno
      // DENTRO la stessa colonna di testo, subito dopo il corpo — non in
      // un blocco "statistiche" separato sotto la foto (quello resta un
      // tipo di blocco a sé per chi lo vuole come sezione propria altrove).
      // Riusa lo stesso markup/CSS di quel blocco (.s-statistiche/.s-stat),
      // solo con un margin-top proprio invece del padding di sezione.
      const statsHtml = (c.stats || []).length ? `<div class="s-statistiche s-statistiche-inline">${c.stats.map((it, i) => {
        const target = Number(it.valore) || 0;
        const suffix = it.suffisso || '';
        return `<div class="s-stat">
          <b class="s-stat-value" data-counter-target="${target}" data-counter-suffix="${escapeAttr(suffix)}">${target}${escapeHtml(suffix)}</b>
          <span${editAttrs(ctx, 'stats.' + i + '.etichetta')}${i18nAttr(it, 'etichetta')}>${escapeHtml(it.etichetta || '')}</span>
        </div>`;
      }).join('')}</div>` : '';
      const testoEmptyHint = (!c.title || !c.title.trim()) && (!c.body || !c.body.trim())
        ? emptyBlockHint(ctx, 'Blocco di testo vuoto — clicca sopra per scrivere un titolo o un testo')
        : '';
      // photo_overlay (2026-09-06, bug reale segnalato dall'utente con
      // screenshot dell'artifact: "chi siamo" è scuro ma vuole comunque la
      // foto in riquadro affiancata, non piena pagina — sceglievo il
      // trattamento in base a block.dark, confondendo due cose indipendenti:
      // il tema chiaro/scuro della sezione e il layout della foto. Scuro
      // con foto in riquadro è una combinazione legittima (.s-testo-img
      // prende comunque dk per i colori, funziona già su sfondo scuro), non
      // c'era bisogno di dedurre il layout dal tema. Flag esplicito,
      // opt-in, default assente = riquadro affiancato (il caso comune) —
      // solo chi lo attiva esplicitamente (la mission) ottiene la foto
      // piena pagina con overlay.
      if (c.image_url && c.photo_overlay) {
        // aside (2026-09-05, dal file .html "struttura da usare": la
        // sezione "filosofia/mission" ha una breve nota laterale a destra,
        // es. "Rispetto per le origini." — un campo opzionale in più, non
        // un nuovo tipo di blocco.
        const asideHtml = c.aside ? `<div class="s-testo-aside"${editAttrs(ctx, 'aside')}${i18nAttr(c, 'aside')}>${escapeHtml(c.aside).replace(/\n/g, '<br>')}</div>` : '';
        return `<section class="s-testo s-testo-photo-bg${dk}" style="background-image:linear-gradient(90deg,rgba(28,25,23,.95),rgba(28,25,23,.4)),url('${escapeHtml(c.image_url)}')"${imgEditAttrs(ctx, 'image_url', c.image_url)}>
          <div class="s-testo-photo-bg-main">
            ${eyebrowHtml(ctx, c)}
            ${c.title ? `<h2${editAttrs(ctx, 'title')}${i18nAttr(c, 'title', true)}>${sanitizeRichText(c.title).replace(/\n/g, '<br>')}</h2>` : ''}
            <div${editAttrs(ctx, 'body')}${i18nMultiAttr(c, 'body', true)}>${(c.body || '').split('\n\n').map((p) => `<p>${sanitizeRichText(p)}</p>`).join('')}</div>
            ${testoEmptyHint}
            ${statsHtml}
          </div>
          ${asideHtml}
        </section>`;
      }
      if (c.image_url) {
        return `<section class="s-testo s-testo-img${dk}">
          <div class="s-testo-col">
            ${eyebrowHtml(ctx, c)}
            ${c.title ? `<h2${editAttrs(ctx, 'title')}${i18nAttr(c, 'title', true)}>${sanitizeRichText(c.title).replace(/\n/g, '<br>')}</h2>` : ''}
            <div${editAttrs(ctx, 'body')}${i18nMultiAttr(c, 'body', true)}>${(c.body || '').split('\n\n').map((p) => `<p>${sanitizeRichText(p)}</p>`).join('')}</div>
            ${testoEmptyHint}
            ${statsHtml}
          </div>
          <img class="s-testo-photo" src="${escapeHtml(c.image_url)}" alt="" loading="lazy"${imgEditAttrs(ctx, 'image_url')}/>
        </section>`;
      }
      return `<section class="s-testo${dk}">
        ${eyebrowHtml(ctx, c)}
        ${c.title ? `<h2${editAttrs(ctx, 'title')}${i18nAttr(c, 'title', true)}>${sanitizeRichText(c.title).replace(/\n/g, '<br>')}</h2>` : ''}
        <div${editAttrs(ctx, 'body')}${i18nMultiAttr(c, 'body', true)}>${(c.body || '').split('\n\n').map((p) => `<p>${sanitizeRichText(p)}</p>`).join('')}</div>
        ${testoEmptyHint}
        ${statsHtml}
      </section>`;
    case 'immagine': {
      // Parallax leggero (2026-09-06, confronto 1:1 col mockup — fase 7):
      // qui la foto È un vero <img>, non uno sfondo — transform diretto
      // sull'elemento non tocca il layout dei fratelli (caption inclusa),
      // stesso principio già seguito per style_overrides in questo file.
      const parallaxAttr = c.parallax && c.image_url ? ' class="s-immagine-parallax"' : '';
      return `<section class="s-immagine${dk}">
        <img${parallaxAttr} src="${escapeHtml(c.image_url || '')}" alt="${escapeHtml(c.alt || '')}" loading="lazy"${imgEditAttrs(ctx, 'image_url')}/>
        ${c.caption ? `<p class="s-caption"${editAttrs(ctx, 'caption')}>${escapeHtml(c.caption)}</p>` : ''}
      </section>`;
    }
    case 'cta':
      // gold_bg (2026-09-06, confronto diretto col mockup: il CTA finale ha
      // uno sfondo a gradiente oro unico, diverso da ogni altra sezione —
      // prima il motore capiva solo scuro/chiaro binario, quindi questo
      // blocco finiva scuro come tutti gli altri). Booleano opt-in, assente
      // di default (nessuna regressione sui tenant esistenti). Usa lo stesso
      // --s-accent-grad già derivato dall'accent color del tenant per
      // bottoni/icone — zero configurazione aggiuntiva. Il bleed a piena
      // pagina usa uno pseudo-elemento (vedi .s-cta-gold nel CSS) invece del
      // trucco box-shadow di .s-dark, che accetta solo colori pieni.
      return `<section class="s-cta${c.gold_bg ? ' s-cta-gold' : dk}">
        ${eyebrowHtml(ctx, c)}
        ${c.title ? `<h2${editAttrs(ctx, 'title')}${i18nAttr(c, 'title')}>${escapeHtml(c.title)}</h2>` : ''}
        ${c.intro ? `<p class="s-section-intro"${editAttrs(ctx, 'intro')}${i18nAttr(c, 'intro', true)}>${sanitizeRichText(c.intro)}</p>` : ''}
        ${c.cta_label && c.cta_url ? `<a class="s-btn" href="${escapeHtml(c.cta_url)}"${editAttrs(ctx, 'cta_label')}${i18nAttr(c, 'cta_label')}>${escapeHtml(c.cta_label)}</a>` : ''}
      </section>`;
    case 'header':
      // Barra di navigazione (2026-09-04, richiesto dall'utente: "ma header e
      // footer?" — mancavano del tutto nel motore a blocchi, pur essendo parte
      // ovvia di qualunque sito reale). Sticky in cima, non un'altra sezione nel
      // flusso normale — un admin la aggiunge come primo blocco della pagina.
      // Click-to-edit: site_name + l'etichetta di ogni link di nav (URL resta
      // form-only — un href non ha senso "editabile sul posto", il testo sì).
      // Il link è comunque un <a> reale per il rendering pubblico normale —
      // editableSyncScript() blocca la navigazione al click SOLO in modalità
      // editable, per non seguire l'URL invece di posizionare il cursore.
      // Logo (2026-09-05, richiesto dall'utente: "il logo non mi piace") —
      // SVG opzionale incollato dall'admin (stesso livello di fiducia già
      // accordato a html_custom: chi ha accesso a questo campo è admin del
      // proprio tenant), reso PRIMA del testo, non al suo posto — un tenant
      // può volere icona+wordmark insieme, come nel mockup di riferimento.
      // Tasto IT/EN (2026-09-05) — mostrato solo se QUALCHE blocco della
      // pagina ha davvero un campo _en compilato (ctx.hasI18n, calcolato una
      // volta in renderPageHtml): un tenant che non traduce nulla non vede un
      // pulsante che non farebbe niente.
      // overlay_su_hero (2026-09-06, confronto 1:1 col mockup di riferimento
      // nico-caffe-v5.html) — flag opt-in, default assente/falso: comportamento
      // di ogni tenant esistente invariato byte-per-byte. Quando vero, l'header
      // passa da sticky-sempre-opaco a fixed-trasparente-sopra-la-foto-hero,
      // opaco solo dopo aver scrollato (classe .s-header-scrolled aggiunta da
      // headerScrollScript() SOLO sulla pagina pubblica vera — mai in editing,
      // l'iframe di anteprima non scrolla mai abbastanza da avere senso).
      return `<header class="s-header${c.overlay_su_hero ? ' s-header-overlay' : ''}">
        <span class="s-header-logo-wrap">${c.logo_svg ? `<span class="s-header-logo">${c.logo_svg}</span>` : ''}<a class="s-header-brand" href="#top"${editAttrs(ctx, 'site_name')}${i18nAttr(c, 'site_name')}>${escapeHtml(c.site_name || ctx.pageTitle)}</a></span>
        ${(() => {
          // nav_links.N.sub (2026-09-05, dal file .html "struttura da usare":
          // alcuni link sono spostati su una seconda riga, staccati dagli
          // altri — un dettaglio estetico esplicito del layout, non un caso
          // speciale nascosto: un booleano per link, coerente col resto dei
          // campi opzionali già presenti su ogni voce dell'array.
          // 2026-09-06 (confronto diretto col mockup, "pezzi non centrati" —
          // TENTATIVO 1, sbagliato: un div con flex-basis:100% DENTRO .s-header-nav.
          // Funzionava solo per caso alla larghezza in cui l'avevo controllato:
          // la larghezza della riga secondaria dipende dalla larghezza CALCOLATA
          // della nav stessa, che cambia con lo schermo — a un'altra larghezza
          // la riga secondaria finiva scentrata, staccata da tutto. TENTATIVO 2
          // (questo): il gruppo "sub" esce dalla <nav> e diventa un fratello
          // diretto nell'header, ancorato in assoluto in alto a destra —
          // .s-header è già position:sticky, quindi è un contenitore di
          // posizionamento valido. Così la riga secondaria è SEMPRE allineata
          // allo stesso bordo destro dell'header, indipendentemente da quanto
          // sono larghi i link primari o la finestra.
          const primary = [];
          const secondary = [];
          (c.nav_links || []).forEach((l, i) => {
            const link = `<a href="${escapeHtml(l.url)}"${l.sub ? ' class="s-header-nav-sub"' : ''}${editAttrs(ctx, 'nav_links.' + i + '.label')}${i18nAttr(l, 'label')}>${escapeHtml(l.label)}</a>`;
            // Wrapper SOLO in modalità editable — la pagina pubblica vera resta
            // esattamente com'era (nessun elemento in più nel DOM per chi visita
            // il sito, solo per l'admin che lo sta modificando).
            const item = ctx && ctx.editable ? `<span class="s-header-nav-item">${link}${urlEditIcon(ctx, 'nav_links.' + i + '.url', l.url)}</span>` : link;
            (l.sub ? secondary : primary).push(item);
          });
          const navHtml = `<nav class="s-header-nav">${primary.join('')}</nav>`;
          const secondaryHtml = secondary.length ? `<div class="s-header-nav-secondary">${secondary.join('')}</div>` : '';
          return navHtml + secondaryHtml;
        })()}
        <div class="s-header-actions">
          ${ctx && ctx.hasI18n ? `<div class="s-lang-toggle"><button type="button" data-lang="it" class="active">IT</button><button type="button" data-lang="en">EN</button></div>` : ''}
          ${c.cta_label && c.cta_url ? `<a class="s-header-cta" href="${escapeHtml(c.cta_url)}"${editAttrs(ctx, 'cta_label')}${i18nAttr(c, 'cta_label')}>${escapeHtml(c.cta_label)}</a>` : ''}
          ${renderMobileMenu(c, ctx)}
        </div>
      </header>`;
    case 'footer':
      // Click-to-edit: site_name/tagline/copyright_text + titolo di ogni
      // colonna + etichetta di ogni link (percorso a 3 livelli:
      // "columns.<colonna>.links.<link>.label") — gli URL restano form-only,
      // stesso motivo dell'header. logo_svg: stesso meccanismo dell'header.
      return `<footer class="s-footer">
        <div class="s-footer-top">
          <div>
            <div class="s-footer-brand-wrap">${c.logo_svg ? `<span class="s-footer-logo">${c.logo_svg}</span>` : ''}<div class="s-footer-brand"${editAttrs(ctx, 'site_name')}${i18nAttr(c, 'site_name')}>${escapeHtml(c.site_name || ctx.pageTitle)}</div></div>
            ${c.tagline ? `<div class="s-footer-tagline"${editAttrs(ctx, 'tagline')}${i18nAttr(c, 'tagline')}>${escapeHtml(c.tagline)}</div>` : ''}
          </div>
          <div class="s-footer-cols">
            ${(c.columns || []).map((col, ci) => `
              <div class="s-footer-col">
                <h5${editAttrs(ctx, 'columns.' + ci + '.title')}>${escapeHtml(col.title)}</h5>
                ${(col.links || []).map((l, li) => {
                  const link = `<a href="${escapeHtml(l.url)}"${editAttrs(ctx, 'columns.' + ci + '.links.' + li + '.label')}>${escapeHtml(l.label)}</a>`;
                  return ctx && ctx.editable ? `<span class="s-footer-link-item">${link}${urlEditIcon(ctx, 'columns.' + ci + '.links.' + li + '.url', l.url)}</span>` : link;
                }).join('')}
              </div>`).join('')}
          </div>
        </div>
        ${(c.copyright_text || c.handwritten) ? `<div class="s-footer-bottom">
          ${c.copyright_text ? `<span${editAttrs(ctx, 'copyright_text')}${i18nAttr(c, 'copyright_text')}>${escapeHtml(c.copyright_text)}</span>` : '<span></span>'}
          ${handwrittenHtml(ctx, c)}
        </div>` : ''}
      </footer>`;
    case 'griglia_prodotti':
      return renderGrigliaProdotti(c, dk, ctx);
    case 'timeline':
      return renderTimeline(c, dk, ctx);
    case 'valori':
      return renderValori(c, dk, ctx);
    case 'riga':
      return renderRiga(c, dk, ctx);
    case 'form':
      return renderForm(c, dk, ctx, block.anchor_id);
    case 'galleria':
      return `<section class="s-galleria${dk}">
        ${c.title ? `<h2>${escapeHtml(c.title)}</h2>` : ''}
        <div class="s-galleria-grid">${(c.image_urls || []).map((u) => `<img src="${escapeHtml(u)}" loading="lazy"/>`).join('')}</div>
      </section>`;
    case 'testimonianze':
      return `<section class="s-testimonianze${dk}">
        ${c.title ? `<h2>${escapeHtml(c.title)}</h2>` : ''}
        <div class="s-testimonianze-grid">${(c.items || []).map((t) => `<blockquote><p>${escapeHtml(t.testo)}</p><cite>${escapeHtml(t.autore || '')}</cite></blockquote>`).join('')}</div>
      </section>`;
    case 'html_custom':
      // Escape hatch deliberato per la personalizzazione avanzata (2026-09-04) — l'unica
      // eccezione a "niente codice custom, mai" in tutta la piattaforma. Chi ha accesso a
      // questo blocco è già admin del proprio tenant (stesso livello di fiducia di chi
      // scrive un webhook custom altrove nel Builder) — nessuna sanificazione qui.
      return `<section class="s-html-custom">${c.html || ''}</section>`;
    case 'divisore': {
      // Blocco nuovo (2026-09-05, "guardati Elementor e Divi" — un divisore/
      // spaziatore è uno dei widget più elementari di qualunque page builder,
      // mancava del tutto). Nessun contenuto, solo altezza: niente editAttrs.
      const h = c.spaziatura === 'piccola' ? '24px' : c.spaziatura === 'grande' ? '96px' : '56px';
      return `<div class="s-divisore" style="height:${h}"></div>`;
    }
    case 'video': {
      // Blocco nuovo (2026-09-05) — YouTube/Vimeo diventano un vero iframe
      // embed (nessuna libreria esterna, solo URL->src), un file diretto
      // (.mp4/.webm) diventa un tag <video> nativo coi controlli. Se l'URL
      // non è riconosciuto, non si inventa un player finto: niente sezione.
      const url = c.video_url || '';
      let embedSrc = null;
      let isFile = false;
      const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{11})/);
      const vimeo = url.match(/vimeo\.com\/(\d+)/);
      if (yt) embedSrc = `https://www.youtube.com/embed/${yt[1]}`;
      else if (vimeo) embedSrc = `https://player.vimeo.com/video/${vimeo[1]}`;
      else if (/\.(mp4|webm|ogg)(\?|$)/i.test(url)) isFile = true;
      if (!embedSrc && !isFile) return '';
      return `<section class="s-video${dk}">
        ${c.title ? `<h2${editAttrs(ctx, 'title')}${i18nAttr(c, 'title')}>${escapeHtml(c.title)}</h2>` : ''}
        <div class="s-video-frame">${isFile
          ? `<video src="${escapeHtml(url)}" controls></video>`
          : `<iframe src="${escapeHtml(embedSrc)}" title="${escapeHtml(c.title || 'Video')}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe>`}</div>
      </section>`;
    }
    case 'configuratore':
      return renderConfiguratore(c, dk, ctx);
    case 'statistiche': {
      // Contatori animati (2026-09-06, confronto 1:1 col mockup — fase 6):
      // il testo iniziale è SEMPRE il valore vero (mai "0" — un crawler o
      // un browser senza JS deve vedere il numero reale, stesso principio
      // guida di tutto questo file: "niente contenuto finto/nascosto").
      // counterScript() lo anima cosmeticamente da 0 al valore vero quando
      // la sezione entra in vista, mai in ctx.editable (stesso motivo di
      // ogni altro effetto legato allo scroll qui dentro).
      const items = c.items || [];
      if (!items.length) return '';
      // 2026-09-06 (bug reale, segnalato dall'utente con screenshot: il
      // blocco era incollato al bordo sinistro) — ogni altro blocco genera
      // un <section>, che riceve max-width/margin/padding dalla regola CSS
      // condivisa "section{...}". Questo generava un <div>, che non la
      // riceve affatto: niente centratura, niente padding orizzontale.
      return `<section class="s-statistiche${dk}">${items.map((it, i) => {
        const target = Number(it.valore) || 0;
        const suffix = it.suffisso || '';
        return `<div class="s-stat">
          <b class="s-stat-value" data-counter-target="${target}" data-counter-suffix="${escapeAttr(suffix)}">${target}${escapeHtml(suffix)}</b>
          <span${editAttrs(ctx, 'items.' + i + '.etichetta')}${i18nAttr(it, 'etichetta')}>${escapeHtml(it.etichetta || '')}</span>
        </div>`;
      }).join('')}</section>`;
    }
    case 'ticker': {
      // Striscia a scorrimento infinito (2026-09-06, confronto 1:1 col
      // mockup — fase 5): pura CSS (@keyframes che trasla -50%, nessun
      // JavaScript — stesso identico principio del mockup di riferimento),
      // items duplicato una volta esatta per il loop senza soluzione di
      // continuità (a metà del secondo giro di copie il primo è appena
      // uscito dalla vista, lo spettatore non nota il punto di ripartenza).
      const items = (c.items || []).filter(Boolean);
      if (!items.length) return '';
      const doubled = items.concat(items);
      return `<div class="s-ticker${dk}"><div class="s-ticker-track">${doubled.map((t) => `<span>${escapeHtml(t)}</span>`).join('<span class="s-ticker-dot">•</span>')}</div></div>`;
    }
    case 'accordion': {
      // Blocco nuovo (2026-09-05) — <details>/<summary> nativi: espandi/
      // comprimi funziona SENZA JavaScript (coerente con "SEO-first, un
      // crawler deve vedere il contenuto vero" già principio guida di tutto
      // il motore — un crawler vede comunque il testo della risposta nel
      // markup, anche se visivamente collassata).
      const items = c.items || [];
      if (!items.length) return '';
      const rows = items.map((it, i) => `
        <details class="s-accordion-item">
          <summary${editAttrs(ctx, 'items.' + i + '.domanda')}${i18nAttr(it, 'domanda')}>${escapeHtml(it.domanda)}</summary>
          <p${editAttrs(ctx, 'items.' + i + '.risposta')}${i18nAttr(it, 'risposta')}>${escapeHtml(it.risposta)}</p>
        </details>`).join('');
      return `<section class="s-accordion${dk}">
        ${eyebrowHtml(ctx, c)}
        ${c.title ? `<h2${editAttrs(ctx, 'title')}${i18nAttr(c, 'title')}>${escapeHtml(c.title)}</h2>` : ''}
        <div class="s-accordion-list">${rows}</div>
      </section>`;
    }
    default:
      return '';
  }
}

// Timeline (2026-09-04, ispirata a un mockup reale — "il viaggio del caffè": passi
// numerati collegati da una linea verticale, non solo un elenco puntato). steps:
// [{titolo, testo}] — niente icone reali (nessuna libreria icone nel motore
// pubblico, coerente con "niente dipendenze nuove"), il numero del passo fa già
// da marcatore visivo.
function renderTimeline(c, dk, ctx) {
  const steps = c.steps || [];
  // Un blocco senza passi resta invisibile sulla pagina pubblica vera
  // (comportamento di sempre), ma in editing deve comunque rendere il
  // pulsante "+ Aggiungi passo" (2026-09-05, canvas WYSIWYG fase B) —
  // altrimenti un blocco appena aggiunto dalla sidebar, con 0 passi, non
  // avrebbe alcun modo di ricevere il primo passo dal canvas.
  if (!steps.length && !(ctx && ctx.editable)) return '';
  // Campi dentro un array (2026-09-04, click-to-edit) — percorso punteggiato
  // "steps.<indice>.<campo>", parsato lato frontend (SitoWebPage.jsx) per
  // aggiornare l'item giusto dell'array, non solo un campo scalare diretto.
  // Layout orizzontale, non più verticale (2026-09-05, materiale mockup
  // fornito dall'utente: "non puoi farlo uguale a questo punto?" — il
  // riferimento allinea i 7 passi in riga, con un badge numerato sopra un
  // cerchio foto/icona e una linea orizzontale che li collega, non un elenco
  // verticale con linea a sinistra).
  // Gestione passi in canvas (2026-09-05, canvas WYSIWYG fase B) — icona
  // cliccabile (stesso schema di imgEditAttrs), rimuovi per passo, aggiungi
  // in fondo alla timeline. Tutto SOLO in modalità editable.
  // fieldPrefix (2026-09-05, bug reale trovato scrivendo la fase D — la
  // stessa disattenzione già corretta due volte in fase C): data-sw-array-
  // field portava "steps" nudo, mai col ctx.fieldPrefix di un blocco
  // annidato — per un blocco timeline DENTRO una colonna, il popup avrebbe
  // scritto un "steps" fantasma direttamente sul config della RIGA
  // (che non ce l'ha) invece di raggiungere il vero array annidato.
  const arrayFieldPrefix = (ctx && ctx.fieldPrefix) || '';
  const items = steps.map((s, i) => {
    const removeBtn = (ctx && ctx.editable)
      ? `<button type="button" class="sw-array-remove" data-sw-array-action="remove" data-sw-array-block="${ctx.blockIndex}" data-sw-array-field="${arrayFieldPrefix}steps" data-sw-array-idx="${i}" title="Rimuovi passo">✕</button>` : '';
    const marker = s.immagine
      ? `<img class="s-timeline-photo" src="${escapeHtml(s.immagine)}" loading="lazy"${imgEditAttrs(ctx, 'steps.' + i + '.immagine')}/>`
      : (iconHtml(s.icon, iconEditAttrs(ctx, 'steps.' + i + '.icon', s.icon)) || i + 1);
    return `
    <div class="s-timeline-step">
      ${removeBtn}
      <div class="s-timeline-num">${i + 1}</div>
      <div class="s-timeline-marker">${marker}</div>
      <div class="s-timeline-content"><h3${editAttrs(ctx, 'steps.' + i + '.titolo')}${i18nAttr(s, 'titolo')}>${escapeHtml(s.titolo)}</h3><p${editAttrs(ctx, 'steps.' + i + '.testo')}${i18nAttr(s, 'testo')}>${escapeHtml(s.testo)}</p></div>
    </div>`;
  }).join('');
  const addStepBtn = (ctx && ctx.editable)
    ? `<button type="button" class="sw-array-add" data-sw-array-action="add" data-sw-array-block="${ctx.blockIndex}" data-sw-array-field="${arrayFieldPrefix}steps" title="Aggiungi passo">+ Aggiungi passo</button>` : '';
  // Bookend iniziale/finale (2026-09-06, confronto 1:1 col mockup di
  // riferimento — un pezzo mancato nella prima applicazione delle 8 fasi,
  // trovato SOLO confrontando il contenuto vero riga per riga col mockup,
  // non da un controllo di classi CSS): due campi opzionali, un cerchio
  // foto + didascalia prima del primo passo ("Il chicco, all'origine") e
  // dopo l'ultimo ("La tazzina, dal cliente") — invisibili senza foto,
  // mai un cerchio vuoto.
  const bookendHtml = (bookend, field) => {
    if (!bookend || !bookend.immagine) return '';
    return `<div class="s-timeline-bookend">
      <img class="s-timeline-bookend-photo" src="${escapeHtml(bookend.immagine)}" loading="lazy"${imgEditAttrs(ctx, field + '.immagine')}/>
      ${bookend.testo ? `<span class="s-timeline-bookend-label"${editAttrs(ctx, field + '.testo')}${i18nAttr(bookend, 'testo')}>${escapeHtml(bookend.testo)}</span>` : ''}
    </div>`;
  };
  return `<section class="s-timeline${dk}">
    ${eyebrowHtml(ctx, c)}
    ${c.title ? `<h2${editAttrs(ctx, 'title')}${i18nAttr(c, 'title')}>${escapeHtml(c.title)}</h2>` : ''}
    ${c.intro ? `<p class="s-section-intro"${editAttrs(ctx, 'intro')}${i18nAttr(c, 'intro', true)}>${sanitizeRichText(c.intro)}</p>` : ''}
    ${bookendHtml(c.bookend_start, 'bookend_start')}
    <div class="s-timeline-track">${(ctx && ctx.editable) ? '' : '<div class="s-timeline-fill"></div>'}${items}</div>
    ${bookendHtml(c.bookend_end, 'bookend_end')}
    ${addStepBtn}
  </section>`;
}

// Griglia valori (2026-09-04, ispirata allo stesso mockup — un'etichetta breve
// sopra un titolo in grassetto, ripetuto N volte: es. "Trasparenza / Rintracciabilità
// puntuale / ..."). items: [{eyebrow, titolo, testo}].
function renderValori(c, dk, ctx) {
  const items = c.items || [];
  // Stesso principio di renderTimeline sopra: invisibile senza voci sulla
  // pagina pubblica vera, ma in editing serve comunque per raggiungere il
  // pulsante "+ Aggiungi voce" (2026-09-05, canvas WYSIWYG fase B).
  if (!items.length && !(ctx && ctx.editable)) return '';
  // Icona a fianco del testo, non sopra (2026-09-05, dal file .html che
  // l'utente ha detto essere "la struttura che devi usare": la griglia
  // "Perché sceglierci" ha l'icona a fianco in una colonna stretta, non
  // sopra come una card foto — mentre le voci CON foto (es. origini)
  // restano foto-sopra-testo, la stessa distinzione già naturale nei dati:
  // un'icona è un simbolo piccolo da affiancare, una foto è un contenuto
  // da mostrare grande sopra.
  // Gestione voci in canvas (2026-09-05, canvas WYSIWYG fase B) — icona
  // cliccabile (stesso schema di imgEditAttrs), rimuovi per voce, aggiungi
  // in fondo alla griglia. Tutto SOLO in modalità editable, stesso principio
  // di ogni altro controllo canvas-only già in questo file.
  // fieldPrefix (2026-09-05, stesso bug reale corretto in renderTimeline —
  // vedi il commento gemello lì) — data-sw-array-field deve portare il
  // percorso completo per un blocco annidato, non "items" nudo.
  const arrayFieldPrefix = (ctx && ctx.fieldPrefix) || '';
  const cards = items.map((v, i) => {
    const icon = iconHtml(v.icon, iconEditAttrs(ctx, 'items.' + i + '.icon', v.icon));
    const photo = v.immagine ? `<img class="s-valore-photo" src="${escapeHtml(v.immagine)}" loading="lazy"${imgEditAttrs(ctx, 'items.' + i + '.immagine')}/>` : '';
    // Placeholder icona (SOLO editing, SOLO quando la voce non ha ancora né
    // icona né foto — es. appena aggiunta col pulsante "+" del canvas):
    // senza questo, dargli un'icona richiederebbe comunque tornare al form
    // della sidebar, vanificando il punto di poterla aggiungere dal canvas.
    const iconPlaceholder = (!icon && !photo && ctx && ctx.editable)
      ? `<span class="sw-icon-placeholder"${iconEditAttrs(ctx, 'items.' + i + '.icon', v.icon)}>+ icona</span>` : '';
    const removeBtn = (ctx && ctx.editable)
      ? `<button type="button" class="sw-array-remove" data-sw-array-action="remove" data-sw-array-block="${ctx.blockIndex}" data-sw-array-field="${arrayFieldPrefix}items" data-sw-array-idx="${i}" title="Rimuovi voce">✕</button>` : '';
    const body = `
      ${v.eyebrow ? `<span class="s-eyebrow"${editAttrs(ctx, 'items.' + i + '.eyebrow')}${i18nAttr(v, 'eyebrow')}>${escapeHtml(v.eyebrow)}</span>` : ''}
      <h3${editAttrs(ctx, 'items.' + i + '.titolo')}${i18nAttr(v, 'titolo')}>${escapeHtml(v.titolo)}</h3>
      <p${editAttrs(ctx, 'items.' + i + '.testo')}${i18nAttr(v, 'testo')}>${escapeHtml(v.testo)}</p>`;
    if (icon && !photo) {
      return `<div class="s-valore s-valore-inline">${removeBtn}<div class="s-valore-icon">${icon}</div><div>${body}</div></div>`;
    }
    return `<div class="s-valore">${removeBtn}${iconPlaceholder}${photo}${body}</div>`;
  }).join('');
  const addItemBtn = (ctx && ctx.editable)
    ? `<button type="button" class="sw-array-add" data-sw-array-action="add" data-sw-array-block="${ctx.blockIndex}" data-sw-array-field="${arrayFieldPrefix}items" title="Aggiungi voce">+ Aggiungi voce</button>` : '';
  // Griglia a 4 colonne bordata per gli elenchi a icona (2026-09-05, dal
  // file .html "struttura da usare": la griglia "Perché sceglierci" è un
  // riquadro a 4 colonne con divisori, non una griglia a card libere come
  // quella con le foto (origini) — la differenza è già nei dati (icona vs
  // foto), non serve un campo di configurazione in più.
  const allInline = items.length > 0 && items.every((v) => iconHtml(v.icon) && !v.immagine);
  // Card vere con ombra/angoli arrotondati per le voci con foto (2026-09-05,
  // dal file .html "struttura da usare": le origini sono card separate,
  // bordo/ombra/sfondo proprio, non un elenco diviso da una linea sopra).
  const allPhoto = items.length > 0 && items.every((v) => v.immagine);
  return `<section class="s-valori${dk}">
    ${eyebrowHtml(ctx, c)}
    ${c.title ? `<h2${editAttrs(ctx, 'title')}${i18nAttr(c, 'title')}>${escapeHtml(c.title)}</h2>` : ''}
    ${c.intro ? `<p class="s-section-intro"${editAttrs(ctx, 'intro')}${i18nAttr(c, 'intro', true)}>${sanitizeRichText(c.intro)}</p>` : ''}
    <div class="s-valori-grid${allInline ? ' s-valori-grid-inline' : ''}${allPhoto ? ' s-valori-grid-cards' : ''}">${cards}</div>
    ${addItemBtn}
  </section>`;
}

// Riga/colonne (2026-09-05, "il pezzo che manca di più" per lo stile Divi —
// vedi "Piano per finire il modulo Sito Web" in stato-lavori/sito-web.md,
// punto 1 — l'utente: "vorrei qualcosa di operativo uguale a divi/elementor")
// — un contenitore che affianca N blocchi in colonne di larghezza regolabile,
// invece della sola sequenza verticale a piena larghezza usata da ogni altro
// tipo. Scelta di modello: i blocchi figli sono OGGETTI BLOCCO IDENTICI a
// quelli di primo livello (stesso {type, config}), non un formato "leggero"
// dedicato — così riusano subito lo stesso renderBlockInner/BlockEditor,
// nessun codice nuovo per far funzionare un tipo esistente dentro una
// colonna. header/footer non sono ammessi come figli (niente doppio header
// in pagina) — filtrati già lato editor (CHILD_BLOCK_TYPES in
// SitoWebPage.jsx), qui solo un guard difensivo.
// Nesting di 'riga' dentro 'riga' (2026-09-05, "guardati Elementor e Divi" —
// lì una sezione può contenere righe annidate a piacere). fieldPrefix
// (editAttrs) è già una stringa costruita per concatenazione, quindi
// generica per costruzione a qualunque profondità — nessuna modifica lì
// serve. Unico guard nuovo: rigaDepth con un tetto (ctx.rigaDepth, max 4)
// per evitare che un annidamento patologico (anche solo un errore umano
// nell'editor JSON) produca una ricorsione senza fondo lato server.
const MAX_RIGA_DEPTH = 4;
function renderRiga(c, dk, ctx) {
  const columns = c.columns || [];
  if (!columns.length) return '';
  const depth = (ctx && ctx.rigaDepth) || 0;
  // rigaPath (2026-09-05, canvas WYSIWYG fase C — bug reale trovato
  // sistemando il drag dei blocchi annidati): per una riga ANNIDATA,
  // ctx.blockIndex resta quello della riga ANTENATA di primo livello (mai
  // riassegnato durante la ricorsione) — usarlo per identificare QUESTA
  // riga (ridimensionamento colonne, percorso dei figli) scriverebbe sulla
  // riga sbagliata. ctx.blockPath è invece sempre il percorso REALE di
  // questa riga, a qualunque profondità.
  const rigaPath = ctx && ctx.blockPath != null ? ctx.blockPath : (ctx && ctx.blockIndex);
  const colsHtml = columns.map((col, ci) => {
    const width = col.width || (100 / columns.length);
    // origIndex (2026-09-05, stesso principio già in uso per i blocchi di
    // primo livello) — assegnato PRIMA di ogni filtro: un blocco nascosto
    // in mezzo alla colonna non deve far scivolare l'indice (quindi il
    // fieldPrefix/blockPath) dei blocchi dopo di lui.
    const filtered = (col.blocks || [])
      .map((cb, origIndex) => ({ cb, origIndex }))
      .filter(({ cb }) => cb && cb.type !== 'header' && cb.type !== 'footer')
      .filter(({ cb }) => !(cb.type === 'riga' && depth >= MAX_RIGA_DEPTH))
      .filter(({ cb }) => !cb.hidden);
    const renderedChildren = filtered.map(({ cb, origIndex: bi }) => {
      // fieldPrefix (vedi editAttrs) — il campo va scritto dentro
      // config.columns[ci].blocks[bi].config, non alla radice del blocco
      // riga. blockPath (2026-09-05, blocchi annidati di prima classe) — un
      // percorso stabile e unico anche quando più blocchi annidati
      // condividono lo stesso ctx.blockIndex (la riga che li contiene).
      const childCtx = {
        ...ctx,
        fieldPrefix: (ctx && ctx.fieldPrefix || '') + 'columns.' + ci + '.blocks.' + bi + '.config.',
        rigaDepth: depth + 1,
        blockPath: rigaPath + '.c' + ci + '.b' + bi,
        isNested: true,
      };
      return renderBlock(cb, childCtx);
    });
    // Zone "+" dentro una colonna (2026-09-05, canvas WYSIWYG fase D) —
    // stesso principio del livello di primo livello (renderPageHtml), qui
    // ogni posizione è un blockPath completo invece di un indice piatto.
    const inner = ctx && ctx.editable
      ? renderInsertZone(rigaPath + '.c' + ci + '.b' + (filtered.length ? filtered[0].origIndex : 0))
        + renderedChildren.map((html, i) => html + '\n' + renderInsertZone(rigaPath + '.c' + ci + '.b' + (i + 1 < filtered.length ? filtered[i + 1].origIndex : (col.blocks || []).length))).join('\n')
      : renderedChildren.join('\n');
    // Maniglia di ridimensionamento (2026-09-05) — SOLO tra una colonna e la
    // successiva (N colonne hanno N-1 confini), mai dopo l'ultima. Il drag
    // vero avviene in editableSyncScript() via mousedown/mousemove sul CSS
    // (nessun postMessage a ogni pixel), un solo messaggio al mouseup con le
    // larghezze finali — stesso principio del debounce sul testo, ma qui è
    // un singolo evento invece di un timer.
    const handle = ctx && ctx.editable && ci < columns.length - 1
      ? `<span class="sw-col-resize" data-sw-riga-block="${rigaPath}" data-sw-col-idx="${ci}"></span>` : '';
    return `<div class="s-riga-col" style="flex:0 0 ${width}%;max-width:${width}%">${inner}${handle}</div>`;
  }).join('');
  return `<section class="s-riga${dk}"><div class="s-riga-inner">${colsHtml}</div></section>`;
}

// Form di raccolta lead (2026-09-05, piano Sito Web punto 4 — l'utente: form
// vero su "prova" di Nico Caffè con nome/locale/email/telefono/miscela/note,
// non solo testo di copy). Campi generici (fields: [{key,label,type,required}]),
// mai fissi al caso di studio — qualunque tenant definisce i propri. Invio via
// fetch vanilla JS (questa pagina non è React) a POST /negozio/:slug/leads
// (routes/site.js), che valida le chiavi contro QUESTO stesso block.config —
// mai fidarsi di ciò che arriva dal client anche se il modulo lo ha generato
// lui stesso pochi istanti prima.
function renderForm(c, dk, ctx, anchorId) {
  const fields = c.fields || [];
  if (!fields.length) return '';
  const fieldHtml = (f) => {
    const req = f.required !== false;
    const star = req ? ' *' : '';
    if (f.type === 'textarea') {
      return `<label class="s-form-field"><span>${escapeHtml(f.label)}${star}</span><textarea name="${escapeHtml(f.key)}"${req ? ' required' : ''}></textarea></label>`;
    }
    const type = (f.type === 'email' || f.type === 'tel') ? f.type : 'text';
    return `<label class="s-form-field"><span>${escapeHtml(f.label)}${star}</span><input type="${type}" name="${escapeHtml(f.key)}"${req ? ' required' : ''}/></label>`;
  };
  // width:'half' (2026-09-06, confronto 1:1 col mockup — segnalato
  // dall'utente con screenshot reale: "due colonne, due cazzo di colonne":
  // ogni campo era sempre a piena larghezza, uno sotto l'altro. Il mockup
  // accoppia campi brevi come nome/email a due a due in una riga). Due
  // 'half' consecutivi si accoppiano in una .s-form-row; un 'half' spaiato
  // (dispari, o seguito da un 'full') resta comunque a piena larghezza,
  // mai una colonna vuota accanto.
  const inputs = [];
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    const next = fields[i + 1];
    if (f.width === 'half' && next && next.width === 'half') {
      inputs.push(`<div class="s-form-row">${fieldHtml(f)}${fieldHtml(next)}</div>`);
      i++;
    } else {
      inputs.push(fieldHtml(f));
    }
  }
  // Niente id/indice per collegare form e messaggio di esito (2026-09-05) —
  // il messaggio vive DENTRO il proprio <form> (form.querySelector), zero
  // rischio di collisione se due form finiscono con lo stesso ctx.blockIndex
  // (caso reale: due form in colonne diverse della STESSA riga condividono
  // l'indice del blocco riga che li contiene, vedi renderRiga/fieldPrefix).
  return `<section class="s-form${dk}">
    ${eyebrowHtml(ctx, c)}
    ${c.title ? `<h2${editAttrs(ctx, 'title')}${i18nAttr(c, 'title')}>${escapeHtml(c.title)}</h2>` : ''}
    ${c.intro ? `<p${editAttrs(ctx, 'intro')}${i18nAttr(c, 'intro', true)}>${sanitizeRichText(c.intro)}</p>` : ''}
    <form class="s-form-el" data-s-form-anchor="${escapeHtml(anchorId || '')}">
      ${inputs.join('')}
      <button type="submit" class="s-btn">${escapeHtml(c.submit_label || 'Invia')}</button>
      <div class="s-form-msg"></div>
    </form>
  </section>`;
}

// Griglia prodotti (2026-09-04) — legge RECORD VERI dal modulo indicato in config
// (source_module_slug), mai dati finti: stesso principio "mai un check finto" già
// applicato ovunque nel motore Assessment. La mappatura campo->nome/prezzo/ecc è
// ESPLICITA (scelta nell'editor dal vero schema del modulo), mai indovinata per
// nome — schemi reali variano troppo (vedi 'prezzo' vs 'prezzo_unitario' vs...).
function renderGrigliaProdotti(c, dk, ctx) {
  // Due fonti possibili (2026-09-05, richiesto dall'utente: "l'elenco dei
  // prodotti ora è il magazzino... mantieni la possibilità di inserire i
  // prodotti del magazzino a scelta del cliente") — un modulo reale del
  // tenant (magazzino/inventario, dati veri) OPPURE un elenco scritto a mano
  // nell'editor (es. le miscele brandizzate di un sito vetrina, che non
  // esistono come record di un modulo). Il modulo reale, quando collegato,
  // vince sempre sull'elenco manuale — mai dati finti quando ne esistono di
  // veri (stesso principio già seguito ovunque nel motore Assessment).
  let resolved;
  if (c.source_module_slug && c.campo_nome) {
    const records = db.prepare('SELECT data FROM records WHERE module_slug = ?').all(c.source_module_slug);
    // Filtro su un campo QUALUNQUE (2026-09-04, generalizzato da "solo _stato" —
    // un caso reale trovato subito: un modulo che marca la disponibilità pubblica con
    // un booleano 'attivo', non con un workflow). Confronto per stringa: sia "true"
    // (booleano) sia un valore testuale di uno stato funzionano con lo stesso codice.
    const items = records.map((r) => { try { return JSON.parse(r.data || '{}'); } catch (e) { return null; } }).filter(Boolean)
      .filter((d) => !c.filter_field || String(d[c.filter_field]) === String(c.filter_value));
    resolved = items.map((d) => ({
      nome: d[c.campo_nome], categoria: c.campo_categoria && d[c.campo_categoria], descrizione: c.campo_descrizione && d[c.campo_descrizione],
      immagine: c.campo_immagine && d[c.campo_immagine], prezzo: c.campo_prezzo ? d[c.campo_prezzo] : null, editable: false,
    }));
  } else if (Array.isArray(c.items) && c.items.length) {
    resolved = c.items.map((d) => ({ nome: d.nome, categoria: d.categoria, descrizione: d.descrizione, dettagli: d.dettagli, nota: d.nota, immagine: d.immagine, prezzo: d.prezzo, editable: true }));
  } else {
    return '';
  }
  if (!resolved.length) return '';
  // mostra_prezzo di default true (2026-09-04) — un tenant B2B/Ho.Re.Ca. che non
  // pubblica prezzi al pubblico può spegnerlo esplicitamente, ma il comportamento
  // di default resta quello di prima (mostra il prezzo) per non cambiare nulla a
  // chi ha già configurato questo blocco.
  const showPrice = c.mostra_prezzo !== false;
  // Card "foto sopra, corpo sotto" (2026-09-06, confronto 1:1 col mockup
  // incollato dall'utente in chat — "nell'artifact sono box diversi": la
  // versione precedente (foto a sfondo dell'intera card, testo sovrapposto)
  // veniva da un file .html DIVERSO di una sessione precedente, non da
  // questo mockup. Qui la foto è un elemento proprio in cima (non uno
  // sfondo), sotto una barra colorata sottile, poi corpo con occhiello/
  // titolo/dettagli/descrizione e una riga di note in fondo separata da un
  // bordo. dettagli/nota sono opzionali e generici (non solo per il caffè:
  // "dettagli" è una riga breve sotto il titolo — origini, materiali,
  // specifiche —, "nota" una riga corta in fondo — confezione, tempi,
  // garanzia). .s-prodotto resta la classe della card intera: lo script
  // hover (spotlight/tilt) la seleziona per nome, non deve cambiare.
  const cards = resolved.map((d, i) => {
    const photoHtml = d.immagine
      ? `<div class="s-prodotto-photo"><img src="${escapeHtml(d.immagine)}" alt="" loading="lazy"${d.editable ? imgEditAttrs(ctx, 'items.' + i + '.immagine', d.immagine) : ''}/></div>`
      : '';
    const metaBits = [];
    if (d.nota) metaBits.push(`<span${d.editable ? editAttrs(ctx, 'items.' + i + '.nota') : ''}>${escapeHtml(d.nota)}</span>`);
    if (showPrice && d.prezzo != null && d.prezzo !== '') metaBits.push(`<span>€ ${escapeHtml(Number(d.prezzo).toFixed(2))}</span>`);
    return `
    <div class="s-prodotto">
      <span class="s-prodotto-accent"></span>
      ${photoHtml}
      <div class="s-prodotto-body">
        ${d.categoria ? `<span class="s-eyebrow">${escapeHtml(d.categoria)}</span>` : ''}
        <h3${d.editable ? editAttrs(ctx, 'items.' + i + '.nome') : ''}>${escapeHtml(d.nome)}</h3>
        ${d.dettagli ? `<div class="s-prodotto-dettagli"${d.editable ? editAttrs(ctx, 'items.' + i + '.dettagli') : ''}>${escapeHtml(d.dettagli)}</div>` : ''}
        ${d.descrizione ? `<p${d.editable ? editAttrs(ctx, 'items.' + i + '.descrizione') : ''}>${escapeHtml(d.descrizione)}</p>` : ''}
        ${metaBits.length ? `<div class="s-prodotto-meta">${metaBits.join('')}</div>` : ''}
      </div>
    </div>`;
  }).join('');
  return `<section class="s-griglia-prodotti${dk}">
    ${eyebrowHtml(ctx, c)}
    ${c.title ? `<h2${editAttrs(ctx, 'title')}${i18nAttr(c, 'title')}>${escapeHtml(c.title)}</h2>` : ''}
    ${c.intro ? `<p class="s-section-intro"${editAttrs(ctx, 'intro')}${i18nAttr(c, 'intro', true)}>${sanitizeRichText(c.intro)}</p>` : ''}
    <div class="s-griglia-grid">${cards}</div>
  </section>`;
}

// Configuratore interattivo (2026-09-06, confronto 1:1 col mockup di
// riferimento — fase 4, "il pezzo più grande"): quiz a N step, ogni opzione
// assegna punteggi a uno o più esiti, l'esito con punteggio più alto vince e
// mostra una card risultato (foto/nome/descrizione/CTA). Segue lo stesso
// principio del blocco 'form': niente click-to-edit campo per campo su
// domande/opzioni/esiti (struttura troppo annidata), editati come blocco
// intero da un DSL testuale nel pannello laterale (SitoWebPage.jsx) — stessa
// scelta già fatta per i campi di 'form'. Un blocco senza step O senza esiti
// non compare, nemmeno in editing (stesso comportamento di renderForm con
// fields=[]).
function renderConfiguratore(c, dk, ctx) {
  const steps = c.steps || [];
  const esiti = c.esiti || [];
  if (!steps.length || !esiti.length) return '';
  const totalSteps = steps.length;
  const dotsHtml = steps.map((_, i) => `<span class="s-config-dot${i === 0 ? ' s-config-dot-active' : ''}" data-dot="${i + 1}"></span>`).join('');
  const stepsHtml = steps.map((s, i) => {
    const optsHtml = (s.options || []).map((o) => {
      const scoresAttr = escapeAttr(JSON.stringify(o.scores || {}));
      return `<button type="button" class="s-config-opt" data-scores="${scoresAttr}"${i18nAttr(o, 'label')}>${escapeHtml(o.label)}</button>`;
    }).join('');
    return `<div class="s-config-step" data-step="${i + 1}"${i > 0 ? ' hidden' : ''}>
      <h4${i18nAttr(s, 'question')}>${escapeHtml(s.question)}</h4>
      <div class="s-config-options">${optsHtml}</div>
    </div>`;
  }).join('');
  // Esiti come blob JSON in un data-attribute (2026-09-06) — stesso motivo
  // già visto per i punteggi delle opzioni: la card risultato è riempita da
  // JS al volo (il vincitore dipende dalle risposte, non è noto lato
  // server), niente ID globali (data-s-config-esiti vive DENTRO il box:
  // più configuratori nella stessa pagina restano indipendenti, stesso
  // principio già seguito per due 'form' nella stessa pagina).
  const esitiJson = escapeAttr(JSON.stringify(esiti.map((e) => ({
    key: e.key, nome: e.nome || '', nome_en: e.nome_en || '',
    descrizione: e.descrizione || '', descrizione_en: e.descrizione_en || '',
    immagine: e.immagine || '', cta_label: e.cta_label || '', cta_label_en: e.cta_label_en || '', cta_target: e.cta_target || '',
  }))));
  return `<section class="s-configuratore${dk}">
    ${eyebrowHtml(ctx, c)}
    ${c.title ? `<h2${editAttrs(ctx, 'title')}${i18nAttr(c, 'title')}>${escapeHtml(c.title)}</h2>` : ''}
    ${c.intro ? `<p class="s-section-intro"${editAttrs(ctx, 'intro')}${i18nAttr(c, 'intro', true)}>${sanitizeRichText(c.intro)}</p>` : ''}
    <div class="s-config-box" data-s-config-esiti="${esitiJson}">
      <div class="s-config-progress">${dotsHtml}</div>
      ${stepsHtml}
      <div class="s-config-result" data-step="${totalSteps + 1}" hidden>
        <img class="s-config-result-img" alt="" style="display:none"/>
        <div class="s-config-result-body">
          <h3 class="s-config-result-nome"></h3>
          <p class="s-config-result-desc"></p>
          <a class="s-btn s-config-result-cta" href="#" style="display:none"></a>
        </div>
        <button type="button" class="s-config-reset">Rifai il quiz</button>
      </div>
    </div>
  </section>`;
}

// Foglio di stile minimo inline (2026-09-04) — nessuna dipendenza CSS esterna
// (coerente con "niente librerie nuove" già seguito per i grafici), un layout
// pulito e leggibile di base: il modulo 'sito_web' aggiunge personalizzazione
// (blocco html_custom può includere <style>), questo è solo il livello base.
// Tema (2026-09-04, richiesto dall'utente dopo un mockup reale) — variabili CSS
// pagina-livello: --s-accent (colore d'accento, default un blu neutro se la pagina
// non ne imposta uno) e la scelta font (sans di default, serif opzionale per un
// registro più editoriale come nel mockup — Georgia è già disponibile su ogni
// sistema, nessun font esterno da caricare). Le sezioni ".s-dark" invertono
// fondo/testo mantenendo lo stesso accento, così un brand può alternare sezioni
// scure e chiare come nel mockup senza definire due temi separati.
// 'editorial' (2026-09-04, richiesto dall'utente: "deve essere bello da vedere e
// modificabile da backend" — dopo aver visto che il fallback di sistema per
// 'serif' (Georgia/Playfair Display) non regge il confronto con un vero font
// editoriale) — usa Fraunces/Inter veri via Google Fonts, caricati nel <head>
// reale (mai dentro il body — stesso bug già risolto per html_custom). Resta
// un'opzione del select "Stile testo" nell'editor, non codice: un admin la
// sceglie da un menu, non scrive HTML.
// 'dm_serif' (2026-09-05, richiesto dall'utente dopo un confronto diretto tra
// 4 coppie di font reali sullo sfondo scuro vero del sito — "C, DM Serif
// Display + DM Sans") — stesso principio di 'editorial': font veri via
// Google Fonts, non un nome scritto in CSS sperando che il sistema ce l'abbia.
function baseCss(accentColor, fontStyle) {
  const accent = accentColor || '#2563EB';
  const bodyFont = fontStyle === 'editorial' ? "'Inter', -apple-system, sans-serif"
    : fontStyle === 'dm_serif' ? "'DM Sans', -apple-system, sans-serif"
    : fontStyle === 'playfair' ? "'DM Sans', -apple-system, sans-serif"
    : fontStyle === 'serif' ? 'Georgia, "Times New Roman", serif'
    : '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';
  const headingFont = fontStyle === 'editorial' ? "'Fraunces', Georgia, serif"
    : fontStyle === 'dm_serif' ? "'DM Serif Display', Georgia, serif"
    : fontStyle === 'playfair' ? "'Playfair Display', Georgia, serif"
    : fontStyle === 'serif' ? '"Playfair Display", Georgia, serif'
    : bodyFont;
  return `
  /* Gradiente oro derivato automaticamente da QUALUNQUE colore d'accento
     (2026-09-06, confronto diretto col mockup: bottoni/badge lì sono un
     gradiente a più tonalità, non un oro piatto) — color-mix() genera un
     chiaro->accento->scuro senza bisogno di un secondo campo colore da
     configurare, funziona per qualunque tenant scelga qualunque tinta. */
  /* 90deg (orizzontale puro), non 120deg come nel mockup: quando il CTA
     gold_bg continua nel form subito sotto (vedi .s-cta-gold + .s-form),
     un angolo con componente verticale darebbe stop percentuali diversi
     tra le due sezioni (altezze diverse) e si vedrebbe la giunzione. A
     90deg lo stop dipende solo dalla larghezza, identica su entrambe
     (bleed 100vw) — giunzione invisibile. */
  /* --s-hero-photo-w a sé, più grande di --s-photo-box-w (2026-09-06,
     confermato confrontando l'artifact vero: la foto dell'hero è
     visibilmente più larga di quelle di mission/chi-siamo, non la
     stessa dimensione — l'hero è il pezzo più grande della pagina, le
     altre restano piccole e coerenti TRA LORO). */
  :root{--s-accent:${accent};--s-accent-grad:linear-gradient(90deg,color-mix(in srgb,${accent} 55%,#fff) 0%,${accent} 55%,color-mix(in srgb,${accent} 65%,#000) 100%);--s-photo-box-w:min(440px,90vw);--s-hero-photo-w:min(600px,92vw)}
  *{box-sizing:border-box} html,body{overflow-x:hidden} body{margin:0;font-family:${bodyFont};color:#1c1917;line-height:1.6;background:#faf6ef}
  /* max-width/padding allineati al mockup reale (2026-09-04, segnalato
     dall'utente: "coffee dovrebbe essere full size sulla pagina" — 960px
     con padding fisso lasciava margini vuoti enormi su schermi larghi,
     mentre header/footer (html_custom, markup del mockup) sono a piena
     larghezza: incoerenza visibile. Valori presi da .container/.pad nel
     sorgente originale del mockup, non inventati). */
  /* Larghezza aumentata (2026-09-05, richiesto dall'utente: "amplia la
     larghezza dei blocchi al margine della pagina") — 1200px/6vw era il
     valore preso dal mockup originale (vedi sopra), ma l'utente lo vuole
     più largo di quanto lo sia anche l'originale: 1400px, padding ridotto
     a 4vw. Generico per qualunque tenant, non solo Nico. */
  section{max-width:1400px;margin:0 auto;padding:80px 4vw}
  h1,h2,h3{font-family:${headingFont}}
  h1{font-size:2.4rem;margin:0 0 12px} h2{font-size:1.6rem;margin:0 0 20px} h3{font-size:1.15rem;margin:0 0 8px}
  em,.s-eyebrow{font-style:italic}
  .s-eyebrow{display:block;color:var(--s-accent);font-size:.8rem;text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px}
  .s-eyebrow-wrap{display:inline-flex;flex-direction:column;gap:4px;margin-bottom:6px}
  .s-eyebrow-wrap .s-eyebrow{margin-bottom:0}
  .s-swoosh{width:60px;height:14px;display:block}
  .s-swoosh path{fill:none;stroke:var(--s-accent);stroke-width:2;stroke-linecap:round;stroke-dasharray:100;stroke-dashoffset:100;transition:stroke-dashoffset 1.1s cubic-bezier(.2,.7,.3,1)}
  .s-in-view .s-swoosh path{stroke-dashoffset:0}
  /* Paragrafo introduttivo (2026-09-05, bug reale: il mockup ha quasi
     sempre una frase tra il titolo e il contenuto della sezione, il motore
     non aveva un campo per questo). */
  .s-section-intro{color:#78716c;max-width:640px;margin:-8px 0 28px}
  .s-dark .s-section-intro{color:#a8a29e}
  .s-hero{text-align:center;padding:96px 24px;position:relative}
  /* Foto come colonna propria a sinistra (2026-09-06, confronto diretto con
     l'artifact — vedi commento sopra in renderBlockInner sul perché non è
     più un unico background-image su tutta la section), sfumata nel buio
     verso destra dove inizia il testo. */
  /* min-height:100vh, non solo l'altezza della foto (2026-09-06,
     confermato confrontando l'artifact vero: la sua hero è alta quasi
     tutto lo schermo, non solo quanto basta a contenere la foto — la foto
     è POSIZIONATA dentro una sezione alta, non È quello che decide
     l'altezza della sezione: .s-hero-photo-el usa top:0;bottom:0, quindi
     si adatta lei all'altezza della section, non il contrario). */
  .s-hero-photo{text-align:left;min-height:100vh;display:flex;align-items:center;background:#1c1917;overflow:hidden}
  /* margin-left agganciato alla larghezza della foto (2026-09-06,
     segnalato dall'utente: "il bordo della foto deve avvicinarsi alla
     scritta") — prima justify-content:flex-end spingeva il testo al
     bordo destro della section INDIPENDENTEMENTE da dove finisse la
     foto (due elementi scollegati, il vuoto tra loro dipendeva solo
     dalla larghezza della finestra): ora il testo parte a un gap fisso
     dalla foto, sempre agganciato a lei qualunque sia lo schermo. Gap
     ridotto da 56px a 20px poi a 0 (2026-09-06, doppia segnalazione
     dell'utente sullo stesso punto: "lo spazio tra foto e scritta è
     troppo devono stare vicini", poi "avvicina la foto" — col gap
     esplicito sommato alla zona sfumata della foto (vedi mask-image su
     .s-hero-photo-el) il vuoto scuro percepito restava troppo largo).
     "24px +" TOLTO del tutto (2026-09-06, l'utente insisteva ancora:
     "puoi avvicinare la foto al titolo?" — bug reale trovato misurando
     dal vivo: quel 24px sommava un secondo margine identico al
     padding-left GIÀ presente su .s-hero{padding:96px 24px} — essendo
     .s-hero-content un figlio flex normale (non absolute come la foto),
     il padding della section si applica per davvero, il margin-left si
     somma sopra. Il testo partiva 24px più lontano di quanto la formula
     lasciasse credere, anche col gap "a zero"). */
  .s-hero-photo .s-hero-content{margin-left:var(--s-hero-photo-w)}
  /* Dimensione fissa, non più derivata dalla section (2026-09-06,
     segnalato dall'utente: "voglio dei box laterali della stessa
     dimensione" — prima height:100% dava a questo box l'altezza della
     section hero, diversa dall'altezza naturale di .s-testo-photo).
     --s-hero-photo-w PROPRIA, non --s-photo-box-w condivisa: confrontando
     di nuovo con l'artifact vero, la foto dell'hero è genuinamente più
     grande di quelle di mission/chi-siamo — l'hero è il pezzo più grande
     della pagina, le altre restano piccole e coerenti TRA LORO. */
  /* left uguale al padding di .s-hero, non 0 (2026-09-06, confermato
     confrontando l'artifact vero aperto nel browser: lì la foto rispetta
     lo stesso margine sinistro dell'header/testo, non tocca il bordo —
     bug reale, un elemento position:absolute con left:0 si posiziona
     rispetto al padding-box del genitore, ignorando IL VALORE del
     padding stesso). top:80px, non 0 (2026-09-06, segnalato
     dall'utente: "il bordo in alto deve andare sotto il menu" — l'header
     è .s-header-overlay, position:fixed e quindi FUORI dal flusso
     normale: la section dell'hero comincia già a y:0 della pagina, e
     top:0 sulla foto la mandava fin sotto l'header fisso (~68px reali,
     misurati) invece di iniziare sotto di lui. bottom:0 resta invariato,
     nessuna lamentela sul bordo inferiore. */
  /* Sfumatura ristretta ancora, al 95%-100% (era 60%, poi 80%): segnalato
     dall'utente ("avvicina la foto", poi "non voglio vedere lo spazio
     nero") — anche all'80% restava una fascia larga 120px (20% di 600px)
     che sfumava verso il colore di sfondo scuro identico alla section,
     percepita come un vuoto nero a sé. Ora è solo un bordo morbido
     (30px), non più una zona "vuota" larga quanto un quinto della foto. */
  .s-hero-photo-el{position:absolute;left:24px;top:80px;bottom:0;width:var(--s-hero-photo-w);background-size:cover;background-position:center;-webkit-mask-image:linear-gradient(90deg,#000 95%,transparent 100%);mask-image:linear-gradient(90deg,#000 95%,transparent 100%)}
  /* Ken Burns (2026-09-06, confronto 1:1 col mockup di riferimento) — zoom
     lento continuo, avanti-indietro (alternate) invece di un loop con salto
     visibile a fine ciclo. Il flag resta sulla section (.s-hero-kenburns),
     la regola anima .s-hero-photo-el al suo interno. */
  .s-hero-kenburns .s-hero-photo-el{animation:s-kenburns 20s ease-in-out infinite alternate}
  @keyframes s-kenburns{from{background-size:112%}to{background-size:132%}}
  @media (prefers-reduced-motion:reduce){.s-hero-kenburns .s-hero-photo-el{animation:none}}
  .s-hero-content{position:relative;z-index:1;max-width:700px}
  /* 2026-09-06, confronto diretto con l'artifact: il titolo dell'hero è
     deliberatamente più grande del solito h1 di pagina (2.4rem) — è la
     prima cosa che si legge del sito. La parte in <em> (corsivo, via
     sanitizeRichText — l'admin lo scrive come testo normale col corsivo
     dall'editor, stesso meccanismo già in uso per corpo/intro altrove)
     prende il colore accento invece del bianco/crema del resto. */
  .s-hero-content h1{font-size:clamp(2.6rem,5.2vw,4.2rem);line-height:1.08}
  /* 2026-09-06, confronto diretto con l'artifact ("anche il font non va
     bene") — non è un font diverso, è lo stesso corsivo ma riempito col
     gradiente oro invece di un colore piatto (background-clip:text): il
     variare del tono lungo le lettere è quello che dà l'impressione di un
     carattere più ricco/decorativo. Solo qui (titolo hero, il pezzo più
     grande della pagina) — .s-testo h2 em resta un colore piatto, coerente
     con quanto già confermato corretto lì. */
  /* font-variation-settings 'opsz' 144 (2026-09-06, l'utente insiste: "è
     DIVERSO" — aveva ragione): Fraunces è un font variabile, l'asse opsz
     lo rende molto più calligrafico/decorativo alle impostazioni alte —
     nel mockup nessun font in più è caricato (stesso URL Fraunces+Inter
     di qui), ma il browser non spinge l'optical sizing automatico al
     massimo da solo. Forzato esplicitamente al valore più alto
     registrato dal font (144, lo stesso già richiesto nell'URL Google
     Fonts) invece di affidarsi all'euristica automatica del browser. */
  .s-hero-content h1 em{font-style:italic;font-optical-sizing:auto;font-variation-settings:'opsz' 144;background:var(--s-accent-grad);-webkit-background-clip:text;background-clip:text;color:transparent}
  .s-handwritten{font-family:'Caveat',cursive;font-size:1.5rem;line-height:1.25;color:var(--s-accent)}
  .s-hero .s-handwritten{position:absolute;z-index:1;right:6vw;top:120px;max-width:180px;text-align:right}
  @media (max-width:900px){.s-hero .s-handwritten{display:none}}
  .s-footer-bottom .s-handwritten{font-size:1.15rem;text-align:right}
  @media (max-width:640px){.s-hero-photo{min-height:480px}}
  /* 2026-09-06, confronto diretto con l'artifact: il titolo del blocco
     "testo" è più grande del solito h2 di sezione (1.6rem), e la parte in
     <em> (via sanitizeRichText, stesso meccanismo già in uso per corpo/
     hero) prende il colore accento invece del colore normale del testo. */
  .s-testo h2{font-size:clamp(1.9rem,3.4vw,2.6rem);line-height:1.15}
  .s-testo h2 em{font-style:italic;font-variation-settings:'opsz' 144;color:var(--s-accent)}
  .s-testo-img{display:grid;grid-template-columns:1.1fr 1fr;gap:36px;align-items:center;text-align:left}
  /* aspect-ratio verticale fisso (2026-09-06, segnalato dall'utente: "la
     vorrei sempre verticale in tutti i blocchi") — prima height:100% su
     una colonna larga e bassa forzava object-fit:cover a ritagliare quasi
     tutta l'altezza di una foto verticale, restava solo una fetta
     orizzontale stretta e molto ingrandita. Un aspect-ratio fisso rende
     il box stesso verticale, indipendentemente da quanto è larga la
     colonna o alta la riga della grid. */
  /* justify-self:center (2026-09-06, segnalato dall'utente: "i blocchi
     non sono centrati" — bug reale introdotto dal fix precedente):
     un'immagine a larghezza fissa dentro una colonna di grid più larga
     di lei si allinea di default a sinistra della colonna, lasciando
     vuoto visibile a destra — l'intero blocco sembrava sbilanciato. */
  .s-testo-photo{width:var(--s-photo-box-w);max-width:100%;aspect-ratio:4/5;object-fit:cover;border-radius:16px;justify-self:center}
  @media (max-width:640px){.s-testo-img{grid-template-columns:1fr}.s-testo-photo{order:-1}}
  .s-testo-photo-bg{background-size:cover;background-position:center;text-align:left;display:flex;justify-content:space-between;align-items:center;gap:30px;flex-wrap:wrap}
  .s-testo-photo-bg-main h2,.s-testo-photo-bg-main div{max-width:680px}
  .s-testo-aside{font-size:1.1rem;font-weight:600;text-transform:uppercase;color:var(--s-accent);max-width:200px;line-height:1.3}
  /* Scroll-progress bar (2026-09-05, confronto 1:1 col mockup di riferimento
     nico-caffe-v5.html) — colore d'accento della pagina, stesso var(--s-accent)
     già usato ovunque nel motore, nessun nuovo colore da configurare. */
  .s-scroll-progress{position:fixed;top:0;left:0;height:3px;width:0%;background:var(--s-accent-grad);z-index:300}
  /* Header/footer (2026-09-04, richiesto dall'utente: "ma header e footer?" —
     mancavano del tutto). Colori fissi (non seguono block.dark): sono chrome di
     sito, non una sezione di contenuto che deve alternarsi con le vicine. */
  .s-header{position:sticky;top:0;z-index:100;display:flex;align-items:center;justify-content:space-between;gap:20px;padding:14px 24px;background:rgba(28,25,23,.92);backdrop-filter:blur(8px);color:#fff}
  /* Switch IT/EN e "Parliamo" raggruppati (2026-09-06, segnalato
     dall'utente: "avvicinali") — prima erano due figli diretti separati
     di .s-header, e justify-content:space-between li spargeva sull'intera
     larghezza come fossero due sezioni di menu indipendenti, non un
     gruppetto di azioni correlate. */
  .s-header-actions{display:flex;align-items:center;gap:14px}
  /* Header trasparente-poi-opaco sull'hero (2026-09-06, confronto 1:1 col
     mockup di riferimento) — fixed invece di sticky (esce dal flusso, la
     sezione successiva — tipicamente l'hero — risale sotto di lui invece di
     essere spinta in basso), trasparente di default, riusa GLI STESSI valori
     rgba/blur di .s-header sopra solo quando lo scroll supera la soglia. */
  .s-header-overlay{position:fixed;left:0;right:0;background:transparent;backdrop-filter:none;transition:background .3s ease,backdrop-filter .3s ease}
  .s-header-overlay.s-header-scrolled{background:rgba(28,25,23,.92);backdrop-filter:blur(8px)}
  .s-header-logo-wrap{display:flex;align-items:center;gap:9px}
  .s-header-logo{display:flex;width:26px;height:26px;flex-shrink:0}
  .s-header-logo svg{width:100%;height:100%}
  /* Trattamento tipografico del nome sito (2026-09-05, richiesto dall'utente
     dopo un confronto diretto col mockup: "non è 1:1" — il font body senza
     tracking sembrava generico rispetto al wordmark curato del riferimento).
     Font del titolo (non del corpo) + maiuscolo tracciato, coerente con
     qualunque tenant scelga lo stile 'editorial'/'serif', non solo Nico. */
  .s-header-brand{color:#fff;text-decoration:none;font-weight:600;font-size:1rem;font-family:${headingFont};text-transform:uppercase;letter-spacing:.06em}
  .s-header-nav{display:flex;gap:20px;flex-wrap:wrap}
  .s-header-nav a,.s-header-nav-secondary a{color:#e7e5e4;text-decoration:none;font-size:.72rem;text-transform:uppercase;letter-spacing:.07em}
  /* Ancorata in assoluto rispetto a .s-header (position:sticky, quindi
     contenitore di posizionamento valido) — SEMPRE allo stesso bordo destro,
     indipendentemente da quanto è larga la nav primaria o la finestra. */
  .s-header-nav-secondary{position:absolute;top:6px;right:24px;display:flex;gap:16px}
  .s-header:has(.s-header-nav-secondary){padding-top:26px}
  .s-header-nav-sub{font-size:.64rem;opacity:.75}
  .s-header-nav a:hover,.s-header-nav-secondary a:hover{color:var(--s-accent)}
  .s-header-nav a.s-nav-active{color:var(--s-accent)}
  .s-header-cta{padding:8px 18px;border:1px solid var(--s-accent);color:var(--s-accent);text-decoration:none;border-radius:8px;font-size:.85rem;white-space:nowrap}
  /* Tasto IT/EN (2026-09-05) — stesso pattern a "pillola" del mockup di
     riferimento (bordo sottile, stato attivo pieno), qui generico per
     qualunque tenant scelga di tradurre dei contenuti. */
  .s-lang-toggle{display:flex;align-items:center;gap:2px;border:1px solid rgba(255,255,255,.28);border-radius:20px;padding:3px;flex-shrink:0}
  .s-lang-toggle button{border:none;background:transparent;color:#e7e5e4;font-size:.7rem;font-weight:700;letter-spacing:.03em;padding:4px 9px;border-radius:16px;cursor:pointer;font-family:inherit}
  .s-lang-toggle button.active{background:var(--s-accent-grad);color:#fff}
  .s-header-mobile-toggle{display:none;background:none;border:none;color:#fff;font-size:1.5rem;line-height:1;cursor:pointer;padding:2px 4px}
  .s-mobile-menu{display:none;position:fixed;inset:0;z-index:200;background:rgba(20,17,13,.98);flex-direction:column;align-items:center;justify-content:center;gap:26px}
  .s-mobile-menu.s-open{display:flex}
  .s-mobile-menu a{color:#fff;text-decoration:none;font-size:1.3rem}
  @media (max-width:800px){.s-header-nav{display:none}.s-header-mobile-toggle{display:block}}
  .s-footer{background:#1c1917;color:#d6d3d1;padding:48px 24px 24px}
  .s-footer-top{max-width:1400px;margin:0 auto;display:flex;justify-content:space-between;gap:40px;flex-wrap:wrap;padding-bottom:28px;border-bottom:1px solid #332f2b}
  .s-footer-brand-wrap{display:flex;align-items:center;gap:9px}
  .s-footer-logo{display:flex;width:24px;height:24px;flex-shrink:0}
  .s-footer-logo svg{width:100%;height:100%}
  .s-footer-brand{color:#fff;font-weight:600;font-size:1.05rem;font-family:${headingFont};text-transform:uppercase;letter-spacing:.06em}
  .s-footer-tagline{color:#a8a29e;font-size:.85rem;margin-top:4px;font-style:italic}
  .s-footer-cols{display:flex;gap:48px;flex-wrap:wrap}
  .s-footer-col h5{font-size:.7rem;text-transform:uppercase;letter-spacing:.08em;color:var(--s-accent);margin-bottom:10px}
  .s-footer-col a{display:block;color:#a8a29e;text-decoration:none;font-size:.88rem;margin-bottom:6px}
  .s-footer-col a:hover{color:#fff}
  .s-footer-bottom{max-width:1400px;margin:0 auto;padding-top:18px;font-size:.78rem;color:#78716c;display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap}
  .s-btn{display:inline-block;margin-top:16px;padding:10px 24px;background:var(--s-accent-grad);color:#fff;text-decoration:none;border-radius:8px;transition:transform .2s ease-out}
  /* Secondo pulsante dell'hero (2026-09-05, bug reale: il mockup ne ha due,
     uno pieno e uno "fantasma" — bordo, sfondo trasparente). */
  .s-hero-ctas{display:flex;gap:14px;flex-wrap:wrap;justify-content:inherit}
  .s-btn-ghost{background:transparent;border:1px solid currentColor;color:inherit}
  .s-immagine img{max-width:100%;border-radius:12px} .s-caption{color:#78716c;font-size:.9rem;margin-top:8px}
  .s-cta{text-align:center;background:#f5f5f4;border-radius:16px}
  /* 2026-09-06, confronto 1:1 col mockup (segnalato dall'utente): il titolo
     del CTA finale è deliberatamente più grande del solito h2 di sezione
     (1.6rem generico) — è la chiusura della pagina, non un titolo qualunque.
     .s-section-intro generico ha margin:...0 (non auto): il testo dentro è
     centrato, ma il BOX resta appoggiato a sinistra nelle sezioni asimmetriche
     del resto del sito (voluto lì) — qui, dentro .s-cta che è text-align:center,
     va centrato anche come blocco. */
  .s-cta h2{font-size:clamp(2.1rem,4.4vw,3.2rem)}
  .s-cta .s-section-intro{margin-left:auto;margin-right:auto}
  /* .s-cta-gold (2026-09-06): box-shadow (usato da .s-dark/.s-ticker per il
     bleed a piena pagina) accetta solo colori pieni, non gradienti — qui
     serve uno pseudo-elemento posizionato oltre i bordi della sezione. */
  .s-cta.s-cta-gold{position:relative;background:transparent;border-radius:0;color:#241E12;z-index:0}
  .s-cta-gold::before{content:"";position:absolute;top:0;bottom:0;left:50%;width:100vw;transform:translateX(-50%);background:var(--s-accent-grad);z-index:-1}
  .s-cta-gold .s-eyebrow{color:#241E12;opacity:.75}
  .s-cta-gold .s-section-intro{color:#4a3f2a}
  .s-cta-gold .s-btn{background:#241E12;color:#F6F0E2}
  /* Nel mockup vero il CTA finale e il form di contatto sono UN SOLO blocco
     (titolo/intro poi il form direttamente sotto, stesso sfondo oro dietro
     entrambi — il form è solo una card crema che galleggia sopra, non una
     sezione chiara a parte). Il motore li tratta come due blocchi distinti
     (cta/form restano tipi separati ovunque altrove), ma quando un form
     segue DIRETTAMENTE un cta gold_bg, continuiamo lo stesso oro dietro
     anche a lui invece di lasciarlo cadere sul crema di pagina — stessa
     tecnica di .s-cta-gold, così la giunzione tra le due sezioni sparisce. */
  .s-cta-gold + .s-form{position:relative;background:transparent;z-index:0;padding-top:28px}
  .s-cta-gold + .s-form::before{content:"";position:absolute;top:0;bottom:0;left:50%;width:100vw;transform:translateX(-50%);background:var(--s-accent-grad);z-index:-1}
  /* Senza questo, il gap tra il testo del CTA e il form era la somma dei
     due padding di sezione (80px + 80px, segnalato dall'utente: "meno
     spazio tra scritta e form") — il gold continuo sopra rende comunque
     visivamente le due sezioni un blocco unico, non serve un gap pieno. */
  .s-cta-gold:has(+ .s-form){padding-bottom:28px}
  /* auto-fit, non auto-fill (bug reale, segnalato dall'utente con screenshot:
     con poche card — es. 3 su una sezione larga abbastanza per 6 — auto-fill
     crea comunque le colonne VUOTE fino a riempire la riga, e 1fr le conta
     tutte: le card reali restavano strette a sinistra, vuoto a destra.
     auto-fit collassa le colonne vuote a 0, i 1fr restanti si dividono SOLO
     tra le card che esistono davvero. */
  .s-griglia-grid,.s-galleria-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:20px}
  /* Card "foto sopra, corpo sotto" (2026-09-06, confronto 1:1 col mockup —
     la versione precedente, foto a sfondo dell'intera card, veniva da un
     file .html diverso di una sessione precedente). */
  .s-prodotto{position:relative;border-radius:6px;overflow:hidden;background:#2E2818;color:#fff;transition:transform .15s ease-out}
  .s-prodotto-accent{display:block;height:4px;background:var(--s-accent-grad)}
  .s-prodotto-photo{aspect-ratio:4/5;overflow:hidden;background:#0f0c07}
  .s-prodotto-photo img{width:100%;height:100%;object-fit:cover}
  .s-prodotto-body{padding:1.5rem 1.4rem 1.7rem}
  .s-prodotto-body .s-eyebrow{display:block;margin-bottom:6px}
  .s-prodotto-body h3{color:#fff;margin:0 0 8px}
  .s-prodotto-dettagli{font-size:.82rem;color:#d6d3d1;opacity:.85;margin-bottom:12px;line-height:1.5}
  .s-prodotto-body p{color:#d6d3d1;font-size:.92rem;line-height:1.6;margin:0 0 14px}
  .s-prodotto-meta{display:flex;justify-content:space-between;gap:12px;border-top:1px solid rgba(246,240,226,.14);padding-top:12px;font-size:.78rem;color:#a8a29e}
  .s-prezzo{font-weight:700;margin-top:8px;color:var(--s-accent)}
  .s-testimonianze-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:20px}
  .s-divisore{max-width:1400px;margin:0 auto}
  .s-video-frame{position:relative;max-width:900px;margin:0 auto;padding-top:50.625%;height:0;overflow:hidden;border-radius:12px}
  .s-video-frame iframe,.s-video-frame video{position:absolute;inset:0;width:100%;height:100%;border:0}
  .s-accordion-list{max-width:800px;margin:0 auto;display:flex;flex-direction:column;gap:10px}
  .s-accordion-item{border:1px solid #e7e5e4;border-radius:10px;padding:16px 20px}
  .s-dark .s-accordion-item{border-color:#3a3532}
  .s-accordion-item summary{cursor:pointer;font-weight:600;list-style:none}
  .s-accordion-item summary::-webkit-details-marker{display:none}
  .s-accordion-item summary:before{content:'+ ';color:var(--s-accent);font-weight:700}
  .s-accordion-item[open] summary:before{content:'– '}
  .s-accordion-item p{margin:12px 0 0;color:#78716c}
  .s-dark .s-accordion-item p{color:#d6d3d1}
  blockquote{margin:0;padding:20px;background:#f5f5f4;border-radius:12px} cite{display:block;margin-top:8px;font-style:normal;color:#78716c}
  /* auto-fit, non auto-fill — stesso bug reale di .s-griglia-grid (vedi
     commento lì): con poche voci su una sezione larga, auto-fill lasciava
     comunque le colonne vuote a dividersi lo spazio, voci strette a
     sinistra e vuoto a destra. */
  .s-valori-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:0}
  .s-valore{padding:20px 0;border-top:1px solid #e7e5e4}
  .s-valori-grid-inline{grid-template-columns:repeat(4,1fr);border:1px solid #e7e5e4;border-radius:16px;overflow:hidden;gap:0}
  .s-valore-inline{display:grid;grid-template-columns:36px 1fr;gap:12px;padding:22px;border-top:none;border-right:1px solid #e7e5e4;border-bottom:1px solid #e7e5e4}
  .s-valori-grid-inline .s-valore-inline:nth-child(4n){border-right:none}
  /* Icona piatta, senza cerchio di sfondo (2026-09-05, dal file .html
     "struttura da usare": nel riquadro "Perché sceglierci" l'icona è solo
     un simbolo colorato, non un pallino pieno come nel resto del motore). */
  .s-valore-inline .s-valore-icon{margin-bottom:0;width:auto;height:auto;background:none;color:var(--s-accent)}
  .s-valore-inline .s-valore-icon svg{width:26px;height:26px}
  @media (max-width:800px){.s-valori-grid-inline{grid-template-columns:repeat(2,1fr)}.s-valori-grid-inline .s-valore-inline:nth-child(4n){border-right:1px solid #e7e5e4}.s-valori-grid-inline .s-valore-inline:nth-child(2n){border-right:none}}
  @media (max-width:480px){.s-valori-grid-inline{grid-template-columns:1fr}.s-valori-grid-inline .s-valore-inline{border-right:none}}
  .s-valori-grid-cards{grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px}
  .s-valori-grid-cards .s-valore{padding:0;border-top:none;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 1px 6px rgba(0,0,0,.06)}
  .s-dark .s-valori-grid-cards .s-valore{background:#292524}
  /* aspect-ratio uniformato a 4/5 (2026-09-06, segnalato dall'utente:
     "ogni immagine in ogni blocco deve essere allo stesso livello e
     stessa dimensione") — era 8/5 (orizzontale), diverso da hero/testo/
     griglia_prodotti (tutti già 4/5 verticale), una vera inconsistenza
     tra sezioni fotografiche della stessa pagina. */
  .s-valori-grid-cards .s-valore-photo{margin-bottom:0;border-radius:0;aspect-ratio:4/5}
  .s-valori-grid-cards .s-valore h3,.s-valori-grid-cards .s-valore p,.s-valori-grid-cards .s-valore .s-eyebrow{padding:0 10px}
  .s-valori-grid-cards .s-valore h3{margin-top:8px;font-size:1rem}
  .s-valori-grid-cards .s-valore p{padding-bottom:10px;font-size:.85rem}
  .s-valore-photo{width:100%;aspect-ratio:4/5;object-fit:cover;border-radius:10px;margin-bottom:12px}
  .s-valore-icon{width:44px;height:44px;border-radius:50%;background:var(--s-accent-grad);color:#fff;display:flex;align-items:center;justify-content:center;margin-bottom:12px}
  .s-valore-icon svg{width:22px;height:22px}
  /* Timeline verticale (2026-09-06, confronto diretto col mockup incollato
     dall'utente in questa conversazione: linea dorata continua a sinistra,
     marker/foto in cerchio sulla linea, testo a destra — sostituisce la
     versione orizzontale a griglia scelta in una fase precedente su un
     mockup diverso, ora superato. Nessuna modifica all'HTML/JS generato:
     stessa identica struttura per-passo (num+marker+content), solo un
     layout CSS diverso — click-to-edit/canvas WYSIWYG restano invariati). */
  .s-timeline-track{position:relative;max-width:640px;padding-left:76px;display:flex;flex-direction:column;gap:0}
  .s-timeline-track::before{content:'';position:absolute;top:0;bottom:0;left:27px;width:2px;background:#e7e5e4;z-index:0}
  .s-dark .s-timeline-track::before{background:#3a3532}
  /* 2026-09-06, confronto 1:1 col mockup (segnalato dall'utente: "questo
     blocco ha una animazione nell'artifact che non vedo") — linea oro che
     si riempie dall'alto verso il basso mentre si scorre la sezione, sopra
     la linea grigia fissa di ::before. Deve essere un elemento REALE (non
     un altro ::before): lo script le imposta height via JS ad ogni scroll,
     un pseudo-elemento non è raggiungibile da querySelector. Mai in
     ctx.editable, stesso principio di ogni altro effetto legato allo
     scroll in questo file — l'iframe di anteprima non scrolla mai
     abbastanza perché abbia senso, e comunque qui la card in editing non
     scrolla al centro come dice update(). */
  .s-timeline-fill{position:absolute;top:0;left:27px;width:2px;height:0%;background:var(--s-accent-grad);z-index:0}
  .s-timeline-step{position:relative;display:grid;grid-template-columns:56px 1fr;column-gap:20px;align-items:start;text-align:left;padding-bottom:2.8rem}
  .s-timeline-step:last-of-type{padding-bottom:0}
  .s-timeline-num{position:absolute;z-index:1;top:-22px;left:0;width:56px;height:auto;border-radius:0;background:none;color:var(--s-accent);font-style:italic;font-weight:400;font-size:.72rem;text-align:center;margin-bottom:0}
  .s-timeline-marker{position:relative;z-index:1;grid-column:1;width:56px;height:56px;border-radius:50%;background:var(--s-accent-grad);color:#fff;display:flex;align-items:center;justify-content:center;font-size:.85rem;font-weight:700;margin-bottom:0;overflow:hidden}
  .s-timeline-marker svg{width:22px;height:22px}
  .s-timeline-content{grid-column:2;padding-top:.6rem}
  .s-timeline-photo{width:100%;height:100%;object-fit:cover}
  .s-timeline-bookend{display:flex;align-items:center;gap:12px;margin-bottom:2.4rem;margin-left:-76px}
  .s-timeline-bookend-photo{width:54px;height:54px;border-radius:50%;object-fit:cover;flex-shrink:0;border:2px solid var(--s-accent)}
  .s-timeline-bookend-label{font-style:italic;color:var(--s-accent)}
  @media (max-width:560px){
    .s-timeline-track{padding-left:60px}
    .s-timeline-track::before{left:19px}
    .s-timeline-fill{left:19px}
    .s-timeline-num{width:40px;left:0}
    .s-timeline-marker{width:40px;height:40px}
    .s-timeline-step{grid-template-columns:40px 1fr}
    .s-timeline-bookend{margin-left:-60px}
  }
  /* Riga/colonne (2026-09-05) — i blocchi figli sono <section> complete con
     la loro CSS di base (max-width:1400px, padding grosso) pensata per stare
     SOLE a piena larghezza: dentro una colonna vanno azzerate, altrimenti
     una colonna stretta mostrerebbe un contenuto pieno di spazio vuoto o
     addirittura più largo della colonna stessa. */
  .s-riga{padding-top:40px;padding-bottom:40px}
  .s-riga-inner{display:flex;gap:32px;align-items:flex-start;max-width:1400px;margin:0 auto;padding:0 4vw}
  .s-riga-col{min-width:0;position:relative}
  .s-riga-col>section{max-width:none;padding:0;margin:0}
  @media (max-width:800px){.s-riga-inner{flex-wrap:wrap}.s-riga-col{flex:1 1 100% !important;max-width:100% !important}}
  /* Modulo di contatto centrato (2026-09-05, richiesto dall'utente: "anche
     il form io lo centrerei") — text-align:center sulla sezione centra
     titolo/introduzione E il box del form (che è un elemento flex, quindi
     serve ANCHE margin:0 auto sul box stesso: text-align da solo centra
     testo/inline, non un box a larghezza fissa). Le etichette/campi dentro
     restano allineati a sinistra (text-align:left riportato sul form
     stesso) — un modulo con testo giustificato al centro dentro ogni singolo
     campo sarebbe illeggibile, è il BOX nel suo insieme a dover stare al
     centro della pagina, non il contenuto di ogni etichetta. */
  .s-form{text-align:center}
  /* Card chiara sempre (2026-09-06, confronto diretto col mockup incollato
     dall'utente: .contact-form lì è SEMPRE una card crema con ombra, che
     galleggi su uno sfondo chiaro o scuro non cambia — mai campi scuri
     "nudi" direttamente sulla sezione). */
  .s-form-el{max-width:520px;margin:0 auto;text-align:left;display:flex;flex-direction:column;gap:14px;background:#F6F0E2;color:#241E12;padding:2.2rem 2.4rem;border-radius:10px;box-shadow:0 30px 60px -20px rgba(0,0,0,.4)}
  /* width:'half' (2026-09-06, confronto 1:1 col mockup): due campi corti
     accoppiati in una riga, stessa idea di .form-row nel mockup. */
  .s-form-row{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  @media(max-width:560px){.s-form-row{grid-template-columns:1fr}}
  .s-form-field{display:flex;flex-direction:column;gap:4px;font-size:.85rem;color:#57534e}
  .s-form-field input,.s-form-field textarea{font:inherit;padding:10px 12px;border:1px solid #e2d8c3;border-radius:8px;color:#1c1917;background:#fff}
  .s-form-field textarea{min-height:80px;resize:vertical}
  .s-form-el .s-btn{align-self:stretch;text-align:center;margin-top:2px}
  .s-form-msg{font-size:.85rem;min-height:1.2em}
  .s-dark .s-form-msg{color:#f5f5f4}
  @media (max-width:560px){.s-form-el{padding:1.6rem 1.4rem}}
  .s-configuratore{text-align:center}
  .s-config-box{max-width:640px;margin:0 auto;text-align:left;background:#f5f5f4;border-radius:16px;padding:32px 28px;min-height:220px}
  .s-dark .s-config-box{background:#292524}
  .s-config-progress{display:flex;justify-content:center;gap:8px;margin-bottom:22px}
  .s-config-dot{width:7px;height:7px;border-radius:50%;background:#d6d3d1;display:inline-block;transition:background .3s ease,transform .3s ease}
  .s-dark .s-config-dot{background:#57534e}
  .s-config-dot-active{background:var(--s-accent-grad);transform:scale(1.3)}
  .s-config-step h4{text-align:center;margin:0 0 20px}
  .s-config-options{display:flex;flex-direction:column;gap:10px}
  .s-config-opt{background:transparent;border:1px solid #e7e5e4;color:inherit;padding:14px 18px;border-radius:8px;font:inherit;text-align:left;cursor:pointer;transition:border-color .2s ease,transform .15s ease}
  .s-config-opt:hover{border-color:var(--s-accent);transform:translateX(4px)}
  .s-dark .s-config-opt{border-color:#44403c}
  .s-config-result{display:flex;flex-direction:column;align-items:center;text-align:center}
  /* bug reale, segnalato dall'utente con screenshot ("rifai il quiz" ->
     risultato e prima domanda visibili insieme): display:flex sopra
     vince sempre su [hidden] (display:none della UA stylesheet), stessa
     origine/priorità dell'autore in entrambi i casi — l'attributo hidden
     veniva impostato correttamente dal JS ma non aveva alcun effetto
     visivo. */
  .s-config-result[hidden]{display:none}
  .s-config-result-img{width:100px;height:100px;object-fit:cover;border-radius:8px;margin-bottom:16px}
  .s-config-result-body{text-align:center;margin-bottom:18px}
  .s-config-reset{background:none;border:none;color:inherit;opacity:.7;text-decoration:underline;cursor:pointer;font:inherit}
  .s-config-reset:hover{opacity:1}
  @media (max-width:560px){.s-config-box{padding:22px 16px}}
  .s-statistiche{display:flex;gap:40px;flex-wrap:wrap}
  .s-statistiche-inline{margin-top:1.8rem}
  .s-stat{display:flex;flex-direction:column;gap:4px}
  .s-stat-value{font-size:1.9rem;font-family:${headingFont}}
  .s-stat span{font-size:.8rem;color:#78716c;letter-spacing:.03em}
  .s-dark .s-stat span{color:#d6d3d1}
  /* Fascia sempre scura (2026-09-06, confronto diretto col mockup incollato
     dall'utente in chat: il ticker lì è SEMPRE un nastro marrone scuro che
     separa hero e contenuto, indipendentemente dal chiaro/scuro della
     sezione sopra/sotto — non segue block.dark, è chrome fisso come
     header/footer). */
  .s-ticker{overflow:hidden;background:#2E2818;padding:16px 0;max-width:none;box-shadow:0 0 0 100vmax #2E2818;clip-path:inset(0 -100vmax)}
  .s-ticker-track{display:flex;gap:24px;width:max-content;white-space:nowrap;font-weight:600;font-style:italic;font-family:${headingFont};color:var(--s-accent);animation:s-ticker-scroll 26s linear infinite}
  .s-ticker-dot{opacity:.5;font-style:normal}
  @keyframes s-ticker-scroll{from{transform:translateX(0)}to{transform:translateX(-50%)}}
  @media (prefers-reduced-motion:reduce){.s-ticker-track{animation:none}}
  /* Sfondo scuro a piena larghezza (2026-09-05, bug reale segnalato
     dall'utente confrontando col mockup: "le colonne laterali bianche non
     centrano nulla") — prima: max-width:920px;margin:0 auto rendeva ogni
     blocco scuro una "scheda" più stretta della sezione, mostrando lo
     sfondo bianco della pagina ai lati su schermi larghi (il mockup di
     riferimento è scuro ovunque, corpo della pagina incluso). box-shadow
     con uno spread enorme (100vmax) riempie visivamente OLTRE il box
     dell'elemento — tecnica CSS nota per uno sfondo a piena larghezza senza
     wrapper HTML in più.
     Bug reale trovato SUBITO DOPO dall'utente ("ehmmm" + screenshot: pagina
     completamente vuota) — un box-shadow con spread 100vmax si espande in
     OGNI direzione, non solo ai lati: con più sezioni scure impilate (il
     caso reale di Nico, quasi tutta la pagina) ogni ombra si estendeva
     anche per ~100vmax IN VERTICALE, dipingendo sopra tutto il contenuto
     sovrastante nel normale flusso del documento — non un problema di
     contenuto mancante, un problema di VERNICE che copre tutto il resto.
     clip-path:inset(0 -100vmax) risolve tagliando la vernice esattamente ai
     bordi superiore/inferiore VERI dell'elemento (0 di inset verticale) e
     lasciandola espandersi SOLO in orizzontale (inset negativo = verso
     l'esterno) — l'unica direzione in cui serve davvero. */
  .s-dark{position:relative;background:#1c1917;color:#f5f5f4;box-shadow:0 0 0 100vmax #1c1917;clip-path:inset(0 -100vmax)}
  /* Spotlight dorato (2026-09-06, confronto 1:1 col mockup — fase 8, hover_effects):
     ::before con z-index:-1 (mai un z-index positivo sui figli — nessun contenuto
     esistente di NESSUN blocco scuro va toccato per far spazio a questo overlay),
     .s-dark è già position:relative sopra, resta contenuto lì, non scappa dietro
     l'intera pagina. Aggiornato via JS (variabili --gx/--gy) solo con mouse fine
     (hover_effects, gated (hover:hover) and (pointer:fine) in hoverEffectsScript). */
  .s-dark::before{content:'';position:absolute;inset:0;z-index:-1;pointer-events:none;background:radial-gradient(560px circle at var(--gx,50%) var(--gy,20%),rgba(255,255,255,.08),transparent 42%);opacity:0;transition:opacity .5s ease}
  .s-dark.s-glow-active::before{opacity:1}
  .s-dark h1,.s-dark h2,.s-dark h3{color:#fff}
  .s-dark .s-valore{border-top-color:#3a3532}
  .s-dark .s-valori-grid-inline{border-color:#3a3532}
  .s-dark .s-valore-inline{border-right-color:#3a3532;border-bottom-color:#3a3532}
  .s-dark p{color:#d6d3d1}
  /* Blocchi scuri consecutivi si fondono in un'unica banda continua
     (2026-09-04, feedback dal vivo: "a livello grafico siamo all'opposto"
     di un mockup prevalentemente scuro) — essendo ora a piena larghezza
     (vedi sopra), due sezioni scure adiacenti hanno GIÀ lo stesso colore
     bordo a bordo, senza bisogno di arrotondare gli angoli esterni.
     Bug reale trovato SUBITO dall'utente ("dopo header e prima di footer
     c'è una linea bianca"): s-dark-top/s-dark-bottom portavano ANCHE un
     margine (16px) pensato per il vecchio design "a scheda" — con lo
     sfondo ora a piena larghezza via clip-path (che si ferma esattamente
     al bordo VERO dell'elemento, margine escluso), quel margine lasciava
     scoperto il bianco della pagina proprio lì. Il bug si vede SEMPRE
     quando un blocco scuro è il primo/ultimo della pagina — header e
     footer sono SEMPRE scuri di loro (CSS fisso, non seguono block.dark),
     ma darkClass() non lo sa: calcola prevDark/nextDark solo sul flag
     .dark del blocco precedente/successivo nell'array, e header/footer
     hanno .dark=false per costruzione (non partecipano al toggle chiaro/
     scuro) — quindi il primo blocco scuro reale riceve SEMPRE s-dark-top
     anche se il vero elemento sopra (l'header) è già scuro. Le classi
     restano (per un domani in cui servisse distinguere l'inizio/fine di
     una serie), ma senza margine: i 80px di padding già dentro ogni
     sezione bastano come spazio visivo, mai un margine che rischi di
     scoprire lo sfondo della pagina. */
  .s-dark-top{}
  .s-dark-bottom{}
  /* Mobile (2026-09-04, richiesto dall'utente: "mobile friendly" — mancava del
     tutto prima, mai testato su un viewport stretto). Solo dimensioni/spaziature,
     mai la struttura: stessa gerarchia, stessi blocchi, solo più compatti. */
  @media (max-width: 640px) {
    section{padding:56px 6vw}
    h1{font-size:1.9rem} h2{font-size:1.35rem}
    .s-hero{padding:64px 20px}
    .s-hero-photo-el{left:20px}
    .s-hero-photo .s-hero-content{margin-left:0}
    .s-timeline-marker{width:44px;height:44px;font-size:.72rem}
    .s-timeline-track::before{top:48px}
    .s-timeline-fill{top:48px}
  }
  /* Comparsa allo scroll (2026-09-05) — stato di partenza invisibile, tolto
     da revealScript() al primo ingresso nel viewport. prefers-reduced-motion
     e il <noscript> in renderPageHtml garantiscono che il contenuto resti
     SEMPRE leggibile anche senza JS o con animazioni disattivate — questo è
     un motore SEO-first, un crawler o un browser senza JS non deve mai
     vedere una pagina con sezioni invisibili. */
  .s-reveal{opacity:0;transform:translateY(24px);transition:opacity .8s ease,transform .8s cubic-bezier(.2,.7,.3,1)}
  .s-reveal.s-in-view{opacity:1;transform:translateY(0)}
  /* Varianti di animazione per blocco (2026-09-05) — selettore composto
     .s-reveal.s-reveal-X, più specifico del solo .s-reveal sopra: sovrascrive
     SOLO il transform di partenza/arrivo, transition/opacity restano quelli
     base (stessa durata/curva per coerenza visiva tra blocchi). */
  .s-reveal.s-reveal-left{transform:translateX(-40px)}
  .s-reveal.s-reveal-left.s-in-view{transform:translateX(0)}
  .s-reveal.s-reveal-right{transform:translateX(40px)}
  .s-reveal.s-reveal-right.s-in-view{transform:translateX(0)}
  .s-reveal.s-reveal-zoom{transform:scale(.92)}
  .s-reveal.s-reveal-zoom.s-in-view{transform:scale(1)}
  @media (prefers-reduced-motion: reduce){
    .s-reveal{opacity:1;transform:none;transition:none}
    .s-reveal.s-reveal-left,.s-reveal.s-reveal-right,.s-reveal.s-reveal-zoom{transform:none}
  }
  /* Popup (2026-09-05) — nascosto via opacity/pointer-events, non display:none,
     per poter avere una transizione morbida quando compare (classe
     s-popup-visible aggiunta da renderPopup()). */
  .s-popup-overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:20px;z-index:200;opacity:0;pointer-events:none;transition:opacity .3s ease}
  .s-popup-overlay.s-popup-visible{opacity:1;pointer-events:auto}
  .s-popup-card{position:relative;background:#fff;color:#1c1917;border-radius:14px;max-width:420px;width:100%;padding:32px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.35)}
  .s-popup-card h3{margin:0 0 10px;font-size:1.3rem}
  .s-popup-card p{margin:0 0 18px;color:#57534e}
  .s-popup-img{width:100%;border-radius:10px;margin-bottom:16px;aspect-ratio:16/9;object-fit:cover}
  .s-popup-close{position:absolute;top:10px;right:14px;background:none;border:none;font-size:1.4rem;line-height:1;cursor:pointer;color:#78716c}
  .s-popup-close:hover{color:#1c1917}
  @media (prefers-reduced-motion: reduce){.s-popup-overlay{transition:none}}
`;
}

// Pagina completa (2026-09-04) — <title>/meta description/Open Graph reali dai
// dati della pagina (mai placeholder), un solo <h1> (il blocco hero se presente,
// altrimenti il titolo pagina) per una gerarchia semantica corretta.
// Tasto Login + modale (2026-09-04, richiesto dall'utente: "frontend è il sito,
// aggiungi un tasto login per accedere tramite modale" — quando il Sito Web
// pubblico prende il posto della SPA sulla root del dominio, chi lavora nel
// tenant deve poter comunque raggiungere l'app interna). JS vanilla (questa
// pagina non è React, è HTML puro reso lato server) — chiama le stesse route di
// sempre (POST /api/auth/login, 2FA se attivo), salva token/utente con le STESSE
// chiavi localStorage già usate da core/frontend/src/lib/api.js
// ('platform_token'/'platform_user'), poi porta a /app: l'unico percorso che
// mostra SEMPRE la SPA anche quando la root è occupata dal sito pubblico (vedi
// nginx.conf, "location = /" intercetta solo la root esatta).
// Bug reale trovato il 2026-09-04 (verifica dal vivo su Nico Caffè con header) —
// il tasto Accedi fluttuante in alto a destra si sovrapponeva al CTA della nav
// (blocco 'header' nativo, o una nav reale dentro un blocco html_custom — non
// distinguibile in modo affidabile da qui). In basso a destra SEMPRE: nessuna
// pagina reale mette elementi cliccabili in quell'angolo, zero collisioni
// possibili con qualunque contenuto.
function renderLoginModal() {
  return `
<button id="s-login-btn" onclick="document.getElementById('s-login-modal').style.display='flex'"
  style="position:fixed;bottom:16px;right:16px;z-index:999;padding:8px 18px;border-radius:8px;border:1px solid var(--s-accent);background:rgba(28,25,23,.85);color:var(--s-accent);font-size:.85rem;cursor:pointer;backdrop-filter:blur(6px);letter-spacing:.02em">
  Accedi
</button>
<div id="s-login-modal" style="display:none;position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.5);align-items:center;justify-content:center;font-family:-apple-system,sans-serif">
  <div style="background:#fff;border-radius:14px;padding:28px;width:300px;max-width:90vw">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <strong style="font-size:1rem;color:#1c1917">Accedi</strong>
      <span onclick="document.getElementById('s-login-modal').style.display='none'" style="cursor:pointer;color:#78716c;font-size:1.2rem;line-height:1">&times;</span>
    </div>
    <div id="s-login-err" style="display:none;color:#DC2626;font-size:.8rem;margin-bottom:10px"></div>
    <div id="s-login-step1">
      <input id="s-login-user" placeholder="Username" style="width:100%;padding:9px 10px;margin-bottom:8px;border:1px solid #e7e5e4;border-radius:8px;font-size:.9rem;box-sizing:border-box"/>
      <input id="s-login-pass" type="password" placeholder="Password" style="width:100%;padding:9px 10px;margin-bottom:12px;border:1px solid #e7e5e4;border-radius:8px;font-size:.9rem;box-sizing:border-box"/>
      <button onclick="sLoginSubmit()" style="width:100%;padding:10px;background:#1c1917;color:#fff;border:none;border-radius:8px;font-size:.9rem;cursor:pointer">Accedi</button>
    </div>
    <div id="s-login-step2" style="display:none">
      <input id="s-login-2fa" placeholder="Codice a 6 cifre" style="width:100%;padding:9px 10px;margin-bottom:12px;border:1px solid #e7e5e4;border-radius:8px;font-size:.9rem;box-sizing:border-box"/>
      <button onclick="sLoginVerify2fa()" style="width:100%;padding:10px;background:#1c1917;color:#fff;border:none;border-radius:8px;font-size:.9rem;cursor:pointer">Verifica</button>
    </div>
  </div>
</div>
<script>
let sPendingToken = null;
function sLoginErr(msg) { const e = document.getElementById('s-login-err'); e.textContent = msg; e.style.display = 'block'; }
async function sLoginSubmit() {
  const username = document.getElementById('s-login-user').value;
  const password = document.getElementById('s-login-pass').value;
  try {
    const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
    const data = await res.json();
    if (!res.ok) return sLoginErr(data.error || 'Accesso non riuscito');
    if (data.needs_2fa) {
      sPendingToken = data.pending_token;
      document.getElementById('s-login-step1').style.display = 'none';
      document.getElementById('s-login-step2').style.display = 'block';
      return;
    }
    localStorage.setItem('platform_token', data.token);
    localStorage.setItem('platform_user', JSON.stringify(data.user));
    window.location.href = '/app';
  } catch (e) { sLoginErr('Errore di rete'); }
}
async function sLoginVerify2fa() {
  const code = document.getElementById('s-login-2fa').value;
  try {
    const res = await fetch('/api/auth/login/2fa-verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pending_token: sPendingToken, code }) });
    const data = await res.json();
    if (!res.ok) return sLoginErr(data.error || 'Codice non valido');
    localStorage.setItem('platform_token', data.token);
    localStorage.setItem('platform_user', JSON.stringify(data.user));
    window.location.href = '/app';
  } catch (e) { sLoginErr('Errore di rete'); }
}
</script>`;
}

function renderPageHtml(page, settings, tenantName, opts) {
  // block.hidden (2026-09-04, richiesto dall'utente: "uno switch per farlo comparire
  // o meno") — nasconde un blocco senza eliminarlo: la configurazione resta salvata,
  // utile per spegnere temporaneamente una sezione (es. la griglia prodotti) senza
  // perdere la mappatura dei campi già impostata.
  // origIndex (2026-09-04, per il click-to-edit) — assegnato PRIMA del filtro
  // sotto: un blocco nascosto non compare nell'array finale, quindi l'indice
  // post-filtro NON corrisponde più alla posizione reale in blocks_json. Il
  // sync col form (SitoWebPage.jsx) deve sempre scrivere sull'indice VERO,
  // non su quello della sequenza visibile.
  // Theme Builder (2026-09-05) — se il tenant ha un header/footer condiviso
  // (tenant_settings.site_header_json/footer_json), un blocco header/footer
  // ANCORA presente in blocks_json di questa pagina va ignorato qui, non
  // reso due volte: il condiviso ha sempre la priorità. Con le colonne a
  // NULL questo filtro non toglie nulla — comportamento identico a prima
  // di questa funzionalità.
  const sharedHeader = settings && settings.site_header_json ? JSON.parse(settings.site_header_json) : null;
  const sharedFooter = settings && settings.site_footer_json ? JSON.parse(settings.site_footer_json) : null;
  // Design-token globali (2026-09-05, "abbiamo Divi?" — fase 1) — variabili
  // CSS emesse nel vero <head> SOLO se almeno un token è configurato (zero
  // output per chi non li usa). Un blocco li usa scrivendo "var(--sw-
  // primary)" invece di un hex letterale nel campo colore di sempre —
  // styleOverrideCss non cambia, inietta già qualunque stringa CSS ricevuta.
  // Stesso livello di fiducia già dato a page.accent_color: un valore CSS
  // scritto dall'admin del proprio tenant, mai HTML-escapato (sarebbe
  // comunque inutile in un contesto <style>, non un attributo).
  const designTokens = settings && settings.design_tokens_json ? JSON.parse(settings.design_tokens_json) : null;
  const designTokensCss = designTokens && Object.values(designTokens).some(Boolean)
    ? `<style>:root{${Object.entries(designTokens).filter(([, v]) => v).map(([k, v]) => `--sw-${k}:${v}`).join(';')}}</style>`
    : '';
  // Scroll-progress bar (2026-09-05, confronto 1:1 col mockup di riferimento)
  // — impostazione di Tema, mai in ctx.editable (l'iframe di anteprima
  // ricarica spesso mentre si modifica, una barra che salta a ogni ricarica
  // sarebbe solo rumore — stesso principio già seguito per revealScript).
  const scrollProgressOn = !!(settings && settings.scroll_progress) && !(opts && opts.editable);
  // Effetti hover desktop-only (2026-09-06, confronto 1:1 col mockup —
  // fase 8): impostazione di Tema come scroll_progress, mai in
  // ctx.editable — spotlight/tilt/magnetico sono TUTTI legati al vero
  // cursore del mouse, un iframe di anteprima non ne ha uno significativo.
  const hoverEffectsOn = !!(settings && settings.hover_effects) && !(opts && opts.editable);
  // Swoosh decorativo sotto l'eyebrow (2026-09-06, fase 8) — impostazione
  // di Tema separata da hover_effects: è un disegno che si completa allo
  // scroll (via .s-in-view, lo stesso meccanismo di revealScript), funziona
  // anche su touch — SEMPRE disponibile in anteprima/pubblico allo stesso
  // modo del resto del contenuto (mai legato al cursore reale).
  const eyebrowSwooshOn = !!(settings && settings.eyebrow_swoosh);
  const blocks = JSON.parse(page.blocks_json || '[]')
    .map((b, origIndex) => ({ ...b, origIndex }))
    .filter((b) => !b.hidden)
    .filter((b) => !(sharedHeader && b.type === 'header'))
    .filter((b) => !(sharedFooter && b.type === 'footer'));
  // Bug reale trovato il 2026-09-04 (verifica dal vivo su Nico Caffè 1:1): l'H1 di
  // fallback andava aggiunto solo quando NESSUN blocco fornisce già una propria
  // intestazione — un blocco html_custom porta la SUA struttura completa (nav,
  // hero, tutto), aggiungere comunque l'H1 lo sovrapponeva visivamente sopra il
  // design reale. hasHero ora copre anche questo caso, non solo il blocco 'hero'.
  const hasHero = blocks.some((b) => b.type === 'hero' || b.type === 'html_custom');
  // Script di invio form (2026-09-05) — incluso SOLO se la pagina ha davvero
  // un blocco 'form', anche annidato dentro le colonne di una 'riga' (stesso
  // principio di editableSyncScript: niente JS in più per chi non usa la
  // feature).
  const hasForm = blocks.some((b) => b.type === 'form' || (b.type === 'riga' && (b.config?.columns || []).some((col) => (col.blocks || []).some((cb) => cb.type === 'form'))));
  // Configuratore (2026-09-06) — stesso schema di hasForm: script incluso
  // SOLO se la pagina ha davvero un blocco 'configuratore', anche in
  // anteprima/editing (come formSubmitScript — l'admin deve poter provare il
  // quiz mentre lo costruisce, non solo sulla pagina pubblica).
  const hasConfiguratore = blocks.some((b) => b.type === 'configuratore' || (b.type === 'riga' && (b.config?.columns || []).some((col) => (col.blocks || []).some((cb) => cb.type === 'configuratore'))));
  // Contatori animati (2026-09-06) — stesso schema di hasForm/hasConfiguratore.
  // stats inline dentro 'testo' (2026-09-06, confronto 1:1 col mockup):
  // stesso script contatori del blocco 'statistiche' a sé, va incluso
  // anche quando i numeri vivono dentro un blocco 'testo' (mission).
  const hasStatistiche = blocks.some((b) =>
    b.type === 'statistiche'
    || (b.type === 'testo' && (b.config?.stats || []).length)
    || (b.type === 'riga' && (b.config?.columns || []).some((col) => (col.blocks || []).some((cb) => cb.type === 'statistiche' || (cb.type === 'testo' && (cb.config?.stats || []).length)))));
  // Parallax leggero su scroll (2026-09-06, confronto 1:1 col mockup —
  // fase 7, distinto dal Ken Burns fase 3: qui la foto si sposta durante
  // lo SCROLL, non un'animazione continua). Mai in ctx.editable, stesso
  // motivo di ogni altro effetto legato allo scroll in questo file.
  const hasParallax = !(opts && opts.editable) && blocks.some((b) =>
    (b.type === 'hero' && b.config?.image_url && b.config?.parallax)
    || (b.type === 'immagine' && b.config?.image_url && b.config?.parallax)
    || (b.type === 'riga' && (b.config?.columns || []).some((col) => (col.blocks || []).some((cb) =>
      (cb.type === 'hero' && cb.config?.image_url && cb.config?.parallax) || (cb.type === 'immagine' && cb.config?.image_url && cb.config?.parallax))))
  );
  // Riempimento oro della timeline allo scroll (2026-09-06, confronto 1:1
  // col mockup — segnalato dall'utente: "questo blocco ha una animazione
  // nell'artifact che non vedo"). Mai in ctx.editable, stesso motivo di
  // ogni altro effetto legato allo scroll in questo file.
  const hasTimeline = !(opts && opts.editable) && blocks.some((b) =>
    (b.type === 'timeline' && (b.config?.steps || []).length)
    || (b.type === 'riga' && (b.config?.columns || []).some((col) => (col.blocks || []).some((cb) => cb.type === 'timeline' && (cb.config?.steps || []).length)))
  );
  // IT/EN (2026-09-05) — il tasto compare nell'header solo se QUALCHE blocco
  // ha davvero un campo _en compilato, ovunque sia annidato (anche dentro le
  // colonne di una 'riga'): una scansione ricorsiva generica sull'intero
  // config invece di un elenco di campi noti per tipo, così non va
  // aggiornata a mano ogni volta che un nuovo campo _en viene aggiunto a un
  // tipo di blocco.
  // Theme Builder (2026-09-05) — il tasto IT/EN deve comparire anche se solo
  // l'header/footer CONDIVISO ha un campo _en compilato, non solo i blocchi
  // di questa specifica pagina.
  const hasI18n = blocks.some((b) => hasI18nContent(b.config))
    || (sharedHeader && hasI18nContent(sharedHeader.config))
    || (sharedFooter && hasI18nContent(sharedFooter.config));
  // Header overlay (2026-09-06) — mai in ctx.editable, stesso principio già
  // seguito per scroll-progress/reveal: l'iframe di anteprima non ha motivo
  // di scrollare 40px per "sbloccare" lo sfondo dell'header mentre si edita.
  const hasHeaderOverlay = !(opts && opts.editable) && (
    blocks.some((b) => b.type === 'header' && b.config && b.config.overlay_su_hero)
    || !!(sharedHeader && sharedHeader.config && sharedHeader.config.overlay_su_hero)
  );
  // Scroll-spy nav (2026-09-06, confronto 1:1 col mockup — fase 5): nessun
  // campo/markup nuovo, riusa due primitive GIÀ esistenti — un nav_link con
  // url che comincia per "#" e l'anchor_id (già presente su OGNI blocco)
  // che punta lì. Attivo solo se esiste ALMENO un link così, mai in
  // ctx.editable (stesso motivo di hasHeaderOverlay: l'iframe di anteprima
  // non scrolla mai abbastanza perché uno scroll-spy abbia senso).
  const hasScrollSpy = !(opts && opts.editable) && (
    blocks.some((b) => b.type === 'header' && (b.config?.nav_links || []).some((l) => (l.url || '').charAt(0) === '#'))
    || !!(sharedHeader && (sharedHeader.config?.nav_links || []).some((l) => (l.url || '').charAt(0) === '#'))
  );
  const editable = !!(opts && opts.editable);
  const rawBlocksLength = JSON.parse(page.blocks_json || '[]').length;
  const rendered = blocks.map((b, i) => {
    let darkPos = null;
    if (b.dark) {
      const prevDark = i > 0 && blocks[i - 1].dark;
      const nextDark = i < blocks.length - 1 && blocks[i + 1].dark;
      darkPos = !prevDark && !nextDark ? 'both' : !prevDark ? 'top' : !nextDark ? 'bottom' : 'middle';
    }
    return renderBlock(b, { pageTitle: page.title, darkPos, hasI18n, editable, eyebrowSwoosh: eyebrowSwooshOn, blockIndex: b.origIndex });
  });
  // Zone "+" tra due blocchi (2026-09-05, canvas WYSIWYG fase D) — un modo
  // più diretto di "trascina un blocco dalla sidebar in un punto preciso"
  // (già esistente): un piccolo "+" sempre visibile al confine tra due
  // sezioni, click apre lo stesso popover di scelta tipo già usato dalla
  // sidebar. N+1 zone per N blocchi (prima del primo, tra ogni coppia, dopo
  // l'ultimo) — stesso "at" semantico già usato dal drag (origIndex del
  // blocco che segue, o la lunghezza reale dell'array per l'ultima zona:
  // così un blocco nascosto in mezzo non sposta le posizioni sbagliate).
  const body = editable
    ? renderInsertZone(blocks.length ? blocks[0].origIndex : 0)
      + rendered.map((html, i) => html + '\n' + renderInsertZone(i + 1 < blocks.length ? blocks[i + 1].origIndex : rawBlocksLength)).join('\n')
    : rendered.join('\n');
  // Theme Builder (2026-09-05) — resi in sola lettura (editable:false
  // sempre, anche dentro l'editor di UNA pagina): l'header/footer condiviso
  // si modifica dalla schermata "Tema", mai in-canvas da una pagina
  // specifica (scriverebbe comunque su tenant_settings, non su questa
  // pagina — click-to-edit lì darebbe un falso senso di "sto modificando
  // questa pagina"). Sulla pagina pubblica vera restano comunque
  // PIENAMENTE funzionali (nav, mobile menu, IT/EN) — riusano
  // renderBlockInner identico a un header/footer inline di sempre.
  const sharedHeaderHtml = sharedHeader ? renderBlockInner(sharedHeader, { pageTitle: page.title, hasI18n, editable: false, blockIndex: 'shared-header' }) : '';
  const sharedFooterHtml = sharedFooter ? renderBlockInner(sharedFooter, { pageTitle: page.title, hasI18n, editable: false, blockIndex: 'shared-footer' }) : '';
  // Override di stile per tablet/mobile (2026-09-05) — regole vere in un
  // <style>, mai valori inline: un inline style="" non può esprimere @media.
  // Ricorsivo (2026-09-05, blocchi annidati di prima classe) — uno
  // style_override su un blocco dentro una colonna di 'riga' (a qualunque
  // profondità) genera la sua regola @media esattamente come uno di primo
  // livello, con lo stesso blockPath usato da renderBlock/renderRiga per
  // data-s-blk (vedi lì per il perché non basta l'indice piatto).
  const responsiveOverrides = collectResponsiveOverrides(blocks);
  // Bug reale trovato il 2026-09-04 (verifica dal vivo su Nico Caffè 1:1: "il font è
  // male") — un <link rel="stylesheet"> per un font esterno (Google Fonts) messo
  // dentro <body> (dove finisce tutto il contenuto di un blocco html_custom) non è
  // affidabile: alcuni motori di rendering non lo applicano se non è in <head>. Un
  // blocco html_custom può ora portare anche un `config.head` separato — SOLO link/
  // meta/preconnect per font esterni, mai script — iniettato nel vero <head> della
  // pagina, non dentro il body insieme al resto.
  let extraHead = blocks.filter((b) => b.type === 'html_custom' && b.config?.head).map((b) => b.config.head).join('\n');
  if (responsiveOverrides) extraHead += `\n<style>${responsiveOverrides}</style>`;
  // Font 'editorial' (2026-09-04) — stesso principio già corretto per html_custom:
  // il link va nel vero <head>, mai dentro <body>, e la CSP delle pagine pubbliche
  // (routes/site.js, setPublicSiteCsp) già permette fonts.googleapis.com/gstatic.com.
  if (page.font_style === 'editorial') {
    extraHead += `\n<link rel="preconnect" href="https://fonts.googleapis.com">\n<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,600;1,9..144,400;1,9..144,500&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">`;
  } else if (page.font_style === 'dm_serif') {
    extraHead += `\n<link rel="preconnect" href="https://fonts.googleapis.com">\n<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n<link href="https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">`;
  } else if (page.font_style === 'playfair') {
    // 2026-09-05, dal file .html reale del mockup fornito dall'utente
    // ("lo voglio uguale"): coppia di font esatta lì usata, Playfair Display +
    // DM Sans — sostituisce la scelta precedente (DM Serif Display) su
    // richiesta esplicita di allineamento 1:1 col mockup.
    extraHead += `\n<link rel="preconnect" href="https://fonts.googleapis.com">\n<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@500;600;700&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">`;
  } else if (page.font_style === 'cormorant') {
    // 2026-09-05, dal file .html che l'utente ha detto esplicitamente essere
    // "la struttura che devi usare" — coppia di font esatta lì usata,
    // Cormorant Garamond (titoli) + Montserrat (corpo).
    extraHead += `\n<link rel="preconnect" href="https://fonts.googleapis.com">\n<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=Montserrat:wght@400;500;600;700&display=swap" rel="stylesheet">`;
  }
  // Scritte a mano decorative (2026-09-05, dal mockup reale: "Più di un
  // caffè, una scelta consapevole.", "La qualità che senti, il piacere che
  // ricordi.") — un campo opzionale generico `handwritten` su hero/footer,
  // MAI un font caricato di default (solo se almeno un blocco lo usa
  // davvero, stesso principio già seguito per gli altri font extra).
  const hasHandwritten = blocks.some((b) => b.config?.handwritten);
  if (hasHandwritten) {
    extraHead += `\n<link rel="preconnect" href="https://fonts.googleapis.com">\n<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n<link href="https://fonts.googleapis.com/css2?family=Caveat:wght@500;600&display=swap" rel="stylesheet">`;
  }
  const ogImage = (blocks.find((b) => b.type === 'hero') || {}).config?.image_url || settings.site_og_image_url || '';
  const title = escapeHtml(page.title + (tenantName ? ' — ' + tenantName : ''));
  const description = escapeHtml(page.meta_description || '');

  return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${title}</title>
${description ? `<meta name="description" content="${description}"/>` : ''}
<meta property="og:title" content="${title}"/>
${description ? `<meta property="og:description" content="${description}"/>` : ''}
${ogImage ? `<meta property="og:image" content="${escapeHtml(ogImage)}"/>` : ''}
<meta property="og:type" content="website"/>
${extraHead}
${designTokensCss}
<style>${baseCss(page.accent_color, page.font_style)}${opts && opts.editable ? editableCss() : ''}</style>
${!(opts && opts.editable) ? '<noscript><style>.s-reveal{opacity:1 !important;transform:none !important}</style></noscript>' : ''}
</head>
<body data-s-page-slug="${escapeHtml(page.slug)}">
${scrollProgressOn ? '<div class="s-scroll-progress" id="s-scroll-progress"></div>' : ''}
${sharedHeaderHtml}
${!hasHero ? `<section${!(opts && opts.editable) ? ' class="s-reveal"' : ''}><h1>${escapeHtml(page.title)}</h1></section>` : ''}
${body}
${sharedFooterHtml}
${opts && opts.includeLoginModal ? renderLoginModal() : ''}
${hasForm ? formSubmitScript() : ''}
${hasConfiguratore ? configuratoreScript() : ''}
${hasStatistiche && !(opts && opts.editable) ? counterScript() : ''}
${hasParallax ? parallaxScript() : ''}
${hasTimeline ? timelineFillScript() : ''}
${hasI18n ? i18nScript() : ''}
${!(opts && opts.editable) ? revealScript() : ''}
${scrollProgressOn ? scrollProgressScript() : ''}
${hoverEffectsOn ? hoverEffectsScript() : ''}
${hasHeaderOverlay ? headerScrollScript() : ''}
${hasScrollSpy ? scrollSpyScript() : ''}
${!(opts && opts.editable) ? renderPopup(page) : ''}
${opts && opts.editable ? editableSyncScript() : ''}
</body>
</html>`;
}

function editableCss() {
  return `
  [data-sw-field]{outline:2px dashed transparent;outline-offset:3px;cursor:text;transition:outline-color .12s}
  [data-sw-field]:hover{outline-color:rgba(37,99,235,.5)}
  [data-sw-field]:focus{outline:2px solid #2563EB;outline-offset:3px}
  [data-sw-img-block]{cursor:pointer;outline:2px dashed transparent;outline-offset:3px;transition:outline-color .12s}
  [data-sw-img-block]:hover{outline-color:rgba(37,99,235,.6)}
  /* Gestione voci di lista in canvas (2026-09-05, canvas WYSIWYG fase B). */
  [data-sw-icon-block]{cursor:pointer;outline:2px dashed transparent;outline-offset:3px;border-radius:4px;transition:outline-color .12s}
  [data-sw-icon-block]:hover{outline-color:rgba(37,99,235,.6)}
  .sw-icon-placeholder{display:inline-flex;align-items:center;justify-content:center;
    width:44px;height:44px;border:2px dashed rgba(37,99,235,.5);border-radius:8px;
    color:#2563EB;font-size:11px;cursor:pointer;text-align:center;line-height:1.1}
  .sw-icon-placeholder:hover{background:rgba(37,99,235,.08)}
  .sw-array-remove{position:absolute;top:4px;right:4px;z-index:10;width:20px;height:20px;
    border:none;border-radius:50%;background:rgba(220,38,38,.85);color:#fff;font-size:11px;
    line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;
    padding:0;opacity:0;transition:opacity .12s}
  .s-timeline-step:hover .sw-array-remove,.s-valore:hover .sw-array-remove,.s-valore-inline:hover .sw-array-remove{opacity:1}
  .sw-array-remove:hover{background:rgba(220,38,38,1)}
  .sw-array-add{display:block;margin:16px auto 0;padding:8px 16px;border:2px dashed rgba(37,99,235,.5);
    border-radius:8px;background:none;color:#2563EB;font-size:13px;cursor:pointer}
  .sw-array-add:hover{background:rgba(37,99,235,.08)}
  /* .s-timeline-step ha già position:relative nel CSS base, .s-valore/
     .s-valore-inline no (non ne hanno mai avuto bisogno prima) — necessario
     qui perché .sw-array-remove è absolute rispetto al genitore diretto. */
  .s-valore,.s-valore-inline{position:relative}
  /* "+" tra due blocchi (2026-09-05, canvas WYSIWYG fase D) — riga sottile
     sempre presente (non show-on-hover: un "+" piccolo e discreto non
     disturba, e resta scopribile senza dover "trovare" la zona giusta). */
  /* height 28px, non più 14px (2026-09-08, bug reale segnalato dal vivo
     dall'utente — "non riesco ad aggiungere pezzi", due "+" visibilmente
     incollati tra loro): l'area invisibile allargata di .sw-insert-btn::after
     sotto (44px, aggiunta il 2026-09-06 per un problema diverso — mancati
     click vicino al testo) copre più spazio della zona 14px che la contiene.
     Con due blocchi molto sottili vicini, le due aree invisibili da 44px
     finivano per sovrapporsi quasi del tutto: il click su UN "+" poteva
     colpire l'area dell'ALTRO, inserendo nel punto sbagliato — sembrava un
     click a vuoto, non lo era. Raddoppiare lo spazio dedicato a ogni zona
     non elimina la sovrapposizione in ogni caso limite, ma la riduce da
     "quasi totale" a una sottile fascia di confine — mai ridurre invece il
     44px stesso, rimetterebbe in scena il bug del 2026-09-06. */
  .sw-insert-zone{display:flex;align-items:center;justify-content:center;height:28px;position:relative;z-index:40}
  .sw-insert-zone::before{content:'';position:absolute;left:0;right:0;top:50%;height:1px;background:rgba(37,99,235,.25)}
  .sw-insert-btn{position:relative;width:20px;height:20px;border-radius:50%;border:none;
    background:rgba(37,99,235,.85);color:#fff;font-size:13px;line-height:1;cursor:pointer;
    display:flex;align-items:center;justify-content:center;padding:0}
  .sw-insert-btn:hover{background:rgba(37,99,235,1);transform:scale(1.15)}
  /* Area cliccabile allargata (2026-09-06, indagine sul bug "il blocco non si
     crea"): il cerchio VISIBILE resta 20px (invariato, non deve diventare
     invadente), ma un ::after invisibile la estende a 44px — un quasi-mancato
     click su un bersaglio così piccolo, specialmente vicino a testo con un
     suo click-to-edit, atterrava spesso sul contenuto ACCANTO invece che sul
     "+", sembrando un click andato a vuoto anche quando il meccanismo sotto
     funzionava correttamente (verificato dal vivo: il blocco si crea sempre
     quando il "+" viene colpito davvero). */
  .sw-insert-btn::after{content:'';position:absolute;top:50%;left:50%;width:44px;height:44px;transform:translate(-50%,-50%)}
  /* emptyBlockHint (2026-09-06, bug reale segnalato dall'utente: "se aggiungo
     componenti nel live composer non si crea il nuovo blocco") — il blocco in
     realtà si crea sempre (verificato passo-passo), ma un blocco "testo"
     vuoto non ha ALCUN contenuto visibile nel canvas (niente h2, un <p></p>
     vuoto) — sembra un click a vuoto. Solo in ctx.editable, stesso
     linguaggio "tratteggiato" di .sw-array-add sopra. */
  .s-empty-block-hint{border:2px dashed rgba(37,99,235,.35);border-radius:8px;
    padding:14px 16px;color:rgba(37,99,235,.85);font-size:.8rem;text-align:center}
  [data-sw-block-root]{position:relative;transition:outline-color .12s}
  [data-sw-block-root].sw-drop-target{outline:3px dashed #2563EB;outline-offset:-3px}
  .sw-drag-handle{position:absolute;top:8px;left:8px;z-index:50;width:28px;height:28px;
    display:flex;align-items:center;justify-content:center;border-radius:6px;
    background:rgba(37,99,235,.85);color:#fff;font-size:16px;line-height:1;
    cursor:grab;user-select:none;opacity:0;transition:opacity .12s}
  [data-sw-block-root]:hover .sw-drag-handle{opacity:1}
  .sw-drag-handle:active{cursor:grabbing}
  /* Toolbar fluttuante (2026-09-05, "avanti con Divi") — angolo opposto alla
     maniglia di drag (che è in alto a sinistra), stesso show-on-hover. */
  .sw-block-toolbar{position:absolute;top:8px;right:8px;z-index:50;display:flex;gap:4px;opacity:0;transition:opacity .12s}
  [data-sw-block-root]:hover .sw-block-toolbar{opacity:1}
  .sw-block-btn{width:26px;height:26px;border:none;border-radius:6px;background:rgba(0,0,0,.65);
    color:#fff;font-size:14px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0}
  .sw-block-btn:hover{background:rgba(37,99,235,.9)}
  .sw-url-edit{display:inline-block;cursor:pointer;font-size:.75rem;opacity:.55;margin-left:3px;vertical-align:middle;transition:opacity .12s}
  .sw-url-edit:hover{opacity:1}
  .s-header-nav-item{display:inline-flex;align-items:center;gap:2px}
  .s-footer-link-item{display:block}
  .sw-col-resize{position:absolute;top:0;right:-17px;width:14px;height:100%;cursor:col-resize;z-index:40}
  .sw-col-resize::after{content:'';position:absolute;top:0;bottom:0;left:6px;width:2px;background:rgba(37,99,235,.35);transition:background .12s}
  .sw-col-resize:hover::after{background:#2563EB}`;
}

// Sincronizzazione col form (2026-09-04) — 'input' su ogni campo
// contenteditable manda il nuovo testo al genitore (SitoWebPage.jsx,
// window.addEventListener('message', ...)) via postMessage. Debounce QUI
// (non nel genitore) per non spedire un messaggio a ogni singolo tasto —
// il genitore riceve comunque solo aggiornamenti di stato locali (mai un
// nuovo giro di rendering dell'iframe), quindi il focus/cursore non si
// perde mai durante la digitazione.
function editableSyncScript() {
  return `<script>
(function(){
  var t = null;
  document.querySelectorAll('[data-sw-block]').forEach(function(el){
    // Alcuni campi editabili sono <a href="..."> reali (etichette di nav_links/
    // colonne footer) — in modalità editing un click deve posizionare il
    // cursore, MAI seguire il link.
    if (el.tagName === 'A') el.addEventListener('click', function(e){ e.preventDefault(); });
    el.addEventListener('input', function(){
      clearTimeout(t);
      var block = el.dataset.swBlock, field = el.dataset.swField, value = el.innerText;
      t = setTimeout(function(){
        window.parent.postMessage({ source: 'sitoweb-preview', block: parseInt(block, 10), field: field, value: value }, '*');
      }, 250);
    });
  });

  // Immagini cliccabili (2026-09-04) — click -> messaggio al genitore, che
  // mostra un popover con un campo URL (SitoWebPage.jsx). preventDefault
  // non serve qui (un <img> non naviga al click), ma stopPropagation sì:
  // un'immagine dentro un blocco con maniglia di drag non deve avviare
  // anche un drag involontario al click semplice.
  document.querySelectorAll('[data-sw-img-block]').forEach(function(img){
    img.addEventListener('click', function(e){
      e.stopPropagation();
      window.parent.postMessage({
        source: 'sitoweb-preview', type: 'image-click',
        block: parseInt(img.dataset.swImgBlock, 10), field: img.dataset.swImgField, value: img.getAttribute('src') || img.dataset.swImgValue || '',
      }, '*');
    });
  });

  // URL dei link editabili nel canvas (2026-09-04) — icona separata, mai il
  // link stesso (che rimane cliccabile per l'etichetta, gestito sopra).
  document.querySelectorAll('.sw-url-edit').forEach(function(icon){
    icon.addEventListener('click', function(e){
      e.stopPropagation();
      window.parent.postMessage({
        source: 'sitoweb-preview', type: 'url-click',
        block: parseInt(icon.dataset.swUrlBlock, 10), field: icon.dataset.swUrlField, value: icon.dataset.swUrlValue,
      }, '*');
    });
  });

  // Toolbar fluttuante (2026-09-05, "avanti con Divi") — un solo tipo di
  // messaggio (block-action) con l'azione come dato, non quattro tipi
  // separati: stesso principio già seguito per image/url-click (kind).
  document.querySelectorAll('.sw-block-btn').forEach(function(btn){
    btn.addEventListener('click', function(e){
      e.stopPropagation();
      window.parent.postMessage({
        source: 'sitoweb-preview', type: 'block-action',
        // idx NON parseInt (2026-09-05, canvas WYSIWYG fase C) — può essere
        // un percorso composto ("1.c0.b0") per un blocco annidato, non solo
        // un indice piatto: parseInt lo troncherebbe silenziosamente al
        // primo carattere non numerico ("1.c0.b0" -> 1), causando
        // un'azione sul blocco SBAGLIATO invece di un errore rumoroso.
        action: btn.dataset.swAction, idx: btn.dataset.swBlockIdx,
        // Multi-selezione (2026-09-05, "abbiamo Divi?" — fase 4) — solo il
        // pulsante "seleziona" (⚙) legge questo flag lato SitoWebPage.jsx;
        // per ogni altro pulsante (duplica/elimina/sposta) è innocuo, mai
        // controllato.
        multi: !!(e.ctrlKey || e.metaKey),
      }, '*');
    });
  });

  // Icone cliccabili (2026-09-05, canvas WYSIWYG fase B) — stesso schema di
  // image-click, un popover diverso lato SitoWebPage.jsx (elenco icone
  // invece di un campo URL) selezionato dal type icon-click.
  document.querySelectorAll('[data-sw-icon-block]').forEach(function(el){
    el.addEventListener('click', function(e){
      e.stopPropagation();
      window.parent.postMessage({
        source: 'sitoweb-preview', type: 'icon-click',
        block: parseInt(el.dataset.swIconBlock, 10), field: el.dataset.swIconField, value: el.dataset.swIconValue || '',
      }, '*');
    });
  });

  // Aggiungi/rimuovi voce di lista (2026-09-05, canvas WYSIWYG fase B) — un
  // solo tipo di messaggio (array-item-action) con l'azione come dato,
  // stesso principio di block-action sopra.
  document.querySelectorAll('.sw-array-add,.sw-array-remove').forEach(function(btn){
    btn.addEventListener('click', function(e){
      e.stopPropagation();
      window.parent.postMessage({
        source: 'sitoweb-preview', type: 'array-item-action',
        action: btn.dataset.swArrayAction, block: parseInt(btn.dataset.swArrayBlock, 10),
        field: btn.dataset.swArrayField, idx: btn.dataset.swArrayIdx !== undefined ? parseInt(btn.dataset.swArrayIdx, 10) : null,
      }, '*');
    });
  });

  // "+" tra due blocchi (2026-09-05, canvas WYSIWYG fase D) — apre il
  // popover di scelta tipo lato genitore, mai un inserimento diretto: a
  // differenza del drag (dove il tipo è già scelto trascinandolo), qui va
  // ancora chiesto quale tipo di blocco inserire.
  document.querySelectorAll('.sw-insert-btn').forEach(function(btn){
    btn.addEventListener('click', function(e){
      e.stopPropagation();
      window.parent.postMessage({
        source: 'sitoweb-preview', type: 'open-block-picker', at: btn.dataset.swInsertAt,
      }, '*');
    });
  });

  // Drag diretto nel canvas (2026-09-04) — la maniglia (.sw-drag-handle) porta
  // l'indice REALE del blocco (data-sw-drag-idx, coerente con l'origIndex già
  // usato per l'editing di testo — vedi commento su renderBlock). Il drop
  // avviene sulla SEZIONE bersaglio (data-sw-block-root), non sulla maniglia:
  // un utente rilascia dove VUOLE il blocco, non su un'altra maniglia
  // specifica. type:'reorder' distingue questo messaggio da un edit di testo.
  //
  // Trascinare un blocco NUOVO dal pannello (2026-09-05, "guardati Elementor
  // e Divi": lì un widget si trascina dalla libreria direttamente nel punto
  // desiderato del canvas, non si aggiunge sempre in fondo alla pagina) — il
  // pannello vive nel documento GENITORE, fuori da questo iframe: niente
  // variabile JS condivisa possibile, l'informazione deve viaggiare nel vero
  // dataTransfer nativo (letto solo al drop, non durante il dragover, per
  // limite di sicurezza del browser). Formato: "reorder:<idx>" o
  // "new-block:<type>", stessa zona di drop per entrambi i casi.
  document.querySelectorAll('.sw-drag-handle').forEach(function(handle){
    handle.addEventListener('dragstart', function(e){
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', 'reorder:' + handle.dataset.swDragIdx);
    });
  });
  document.querySelectorAll('[data-sw-block-root]').forEach(function(root){
    root.addEventListener('dragover', function(e){
      e.preventDefault();
      root.classList.add('sw-drop-target');
    });
    root.addEventListener('dragleave', function(){ root.classList.remove('sw-drop-target'); });
    root.addEventListener('drop', function(e){
      e.preventDefault();
      root.classList.remove('sw-drop-target');
      var payload = e.dataTransfer.getData('text/plain') || '';
      // toPath NON parseInt (2026-09-05, canvas WYSIWYG fase C) — stesso
      // motivo di data-sw-block-idx sopra: può essere un percorso composto.
      var toPath = root.dataset.swBlockRoot;
      if (payload.indexOf('reorder:') === 0) {
        var fromPath = payload.slice(8);
        if (fromPath !== toPath) {
          window.parent.postMessage({ source: 'sitoweb-preview', type: 'reorder', from: fromPath, to: toPath }, '*');
        }
      } else if (payload.indexOf('new-block:') === 0) {
        window.parent.postMessage({ source: 'sitoweb-preview', type: 'insert-block', blockType: payload.slice(10), at: toPath }, '*');
      }
    });
  });

  // Ridimensionamento colonne (2026-09-05) — trascinare la maniglia tra due
  // colonne cambia le loro percentuali IN TEMPO REALE nel canvas (solo CSS
  // durante il drag, nessun postMessage a ogni pixel — sarebbe un giro di
  // stato React a ogni movimento del mouse), un SOLO messaggio al rilascio
  // con le larghezze finali. 10% di larghezza minima per colonna: sotto
  // diventa illeggibile e il drag stesso perde la maniglia (posizionata al
  // bordo della colonna).
  document.querySelectorAll('.sw-col-resize').forEach(function(handle){
    handle.addEventListener('mousedown', function(e){
      e.preventDefault();
      var rigaBlock = handle.dataset.swRigaBlock, colIdx = parseInt(handle.dataset.swColIdx, 10);
      var colA = handle.parentElement, colB = colA.nextElementSibling;
      if (!colB) return;
      var inner = colA.parentElement;
      var innerWidth = inner.getBoundingClientRect().width;
      var startX = e.clientX;
      var startWidthA = colA.getBoundingClientRect().width;
      var startWidthB = colB.getBoundingClientRect().width;
      var totalPct = (startWidthA + startWidthB) / innerWidth * 100;
      var pendingA = null, pendingB = null;
      function onMove(e2){
        var dx = e2.clientX - startX;
        var rawPctA = (startWidthA + dx) / innerWidth * 100;
        var pctA = Math.max(10, Math.min(totalPct - 10, rawPctA));
        var pctB = totalPct - pctA;
        colA.style.flex = '0 0 ' + pctA + '%'; colA.style.maxWidth = pctA + '%';
        colB.style.flex = '0 0 ' + pctB + '%'; colB.style.maxWidth = pctB + '%';
        pendingA = pctA; pendingB = pctB;
      }
      function onUp(){
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (pendingA !== null) {
          window.parent.postMessage({
            source: 'sitoweb-preview', type: 'resize-col',
            block: rigaBlock, colIdx: colIdx, widthA: pendingA, widthB: pendingB,
          }, '*');
        }
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  });
})();
</script>`;
}

// Popup (2026-09-05, "andiamo avanti con Divi" — popup builder semplice: un
// popup a comparsa condizionale SOPRA la pagina, non un blocco tra gli altri
// nel flusso verticale). Markup+script SOLO se page.popup_json esiste, è
// abilitato, e ha almeno un contenuto reale (title o body) — mai un overlay
// vuoto iniettato per una pagina che non lo configura, stesso principio già
// seguito per form/i18n/hamburger. sessionStorage (non localStorage): "non
// disturbare di nuovo in QUESTA visita", non "mai più su questo browser" —
// un popup di marketing troppo persistente sarebbe controproducente, ma va
// bene ripresentarsi a una visita successiva. Nessun trigger "exit intent"
// equivalente esiste su mobile (non c'è un mouse che lascia il viewport) —
// limite noto e accettato, non un bug da mascherare con un fallback finto.
function renderPopup(page) {
  let popup;
  try { popup = page.popup_json ? JSON.parse(page.popup_json) : null; } catch (e) { return ''; }
  if (!popup || !popup.enabled || (!popup.title && !popup.body)) return '';
  // Solo il ramo scelto finisce nell'HTML (2026-09-05) — stesso principio già
  // seguito per il blocco 'video' (YouTube/Vimeo/file emettono ciascuno SOLO
  // il proprio markup, mai i tre insieme con un if runtime): più pulito, e
  // nessun codice morto visibile in una pagina pubblica reale.
  const triggerScript = popup.trigger === 'exit_intent'
    ? "document.addEventListener('mouseleave', function(e){ if (e.clientY <= 0) show(); });"
    : `setTimeout(show, ${Math.max(0, Number(popup.delay_seconds) || 3) * 1000});`;
  const imgHtml = popup.image_url ? `<img class="s-popup-img" src="${escapeHtml(popup.image_url)}" alt=""/>` : '';
  const ctaHtml = popup.cta_label && popup.cta_url ? `<a class="s-btn" href="${escapeHtml(popup.cta_url)}">${escapeHtml(popup.cta_label)}</a>` : '';
  return `<div class="s-popup-overlay" id="s-popup">
  <div class="s-popup-card">
    <button type="button" class="s-popup-close" id="s-popup-close" aria-label="Chiudi">&times;</button>
    ${imgHtml}
    ${popup.title ? `<h3>${escapeHtml(popup.title)}</h3>` : ''}
    ${popup.body ? `<p>${escapeHtml(popup.body)}</p>` : ''}
    ${ctaHtml}
  </div>
</div>
<script>
(function(){
  var KEY = 's_popup_dismissed_' + document.body.dataset.sPageSlug;
  if (sessionStorage.getItem(KEY)) return;
  var el = document.getElementById('s-popup');
  if (!el) return;
  function show(){ el.classList.add('s-popup-visible'); }
  function dismiss(){ el.classList.remove('s-popup-visible'); sessionStorage.setItem(KEY, '1'); }
  document.getElementById('s-popup-close').addEventListener('click', dismiss);
  el.addEventListener('click', function(e){ if (e.target === el) dismiss(); });
  ${triggerScript}
})();
</script>`;
}

// Invio form (2026-09-05) — vanilla JS (questa pagina non è React), sempre
// presente sulla pagina pubblica vera quando c'è un blocco 'form' (a
// differenza di editableSyncScript, che è SOLO per l'admin che modifica).
// slug della pagina letto da data-s-page-slug sul <body> — funziona
// identico sia servita da /negozio/:slug sia dalla root del dominio
// (__root_public), che rendono lo STESSO HTML con page.slug reale in
// entrambi i casi, mai un URL costruito indovinando il path corrente.
function formSubmitScript() {
  return `<script>
document.querySelectorAll('.s-form-el').forEach(function(form){
  form.addEventListener('submit', function(e){
    e.preventDefault();
    var msgEl = form.querySelector('.s-form-msg');
    var btn = form.querySelector('button[type=submit]');
    var data = {};
    new FormData(form).forEach(function(v, k){ data[k] = v; });
    var slug = document.body.dataset.sPageSlug;
    btn.disabled = true;
    fetch('/negozio/' + slug + '/leads', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ block_anchor: form.dataset.sFormAnchor || null, data: data }),
    }).then(function(res){ return res.json().then(function(body){ return { ok: res.ok, body: body }; }); })
      .then(function(r){
        btn.disabled = false;
        if (r.ok) { msgEl.textContent = 'Richiesta inviata, grazie!'; msgEl.style.color = '#16A34A'; form.reset(); }
        else { msgEl.textContent = (r.body && r.body.error) || 'Errore, riprova.'; msgEl.style.color = '#DC2626'; }
      })
      .catch(function(){ btn.disabled = false; msgEl.textContent = 'Errore di rete, riprova.'; msgEl.style.color = '#DC2626'; });
  });
});
</script>`;
}

// Tasto IT/EN (2026-09-05, richiesto dall'utente: "il tasto ita eng" del
// mockup di riferimento deve funzionare davvero) — vanilla JS, sempre
// presente sulla pagina pubblica vera quando c'è almeno un campo _en
// compilato (hasI18n). Cambio SOLO lato client, mai un secondo rendering
// server per lingua: ogni elemento porta già sia l'italiano (contenuto
// visibile di default) sia l'inglese (data-i18n-en) nello stesso HTML.
// data-i18n-multi (blocco 'testo', vedi i18nMultiAttr) ricostruisce i
// paragrafi con createElement+textContent — MAI innerHTML, zero rischio di
// iniezione anche con testo EN che contenga caratteri HTML.
function i18nScript() {
  return `<script>
(function(){
  document.querySelectorAll('[data-i18n-en]').forEach(function(el){
    if (!el.dataset.i18nMulti) el.dataset.i18nIt = el.dataset.i18nRich ? el.innerHTML : el.textContent;
  });
  function rebuildParagraphs(el, text){
    el.innerHTML = '';
    (text || '').split('\\n\\n').forEach(function(p){
      var pEl = document.createElement('p');
      pEl.textContent = p;
      el.appendChild(pEl);
    });
  }
  function applyLang(lang){
    document.querySelectorAll('[data-i18n-en]').forEach(function(el){
      if (el.dataset.i18nMulti) {
        if (el.dataset.i18nRich) {
          el.innerHTML = lang === 'en' ? el.dataset.i18nEn : el.dataset.i18nItRaw;
        } else {
          rebuildParagraphs(el, lang === 'en' ? el.dataset.i18nEn : el.dataset.i18nItRaw);
        }
      } else {
        if (el.dataset.i18nRich) {
          el.innerHTML = lang === 'en' ? el.dataset.i18nEn : el.dataset.i18nIt;
        } else {
          el.textContent = lang === 'en' ? el.dataset.i18nEn : el.dataset.i18nIt;
        }
      }
    });
    document.querySelectorAll('.s-lang-toggle button').forEach(function(b){
      b.classList.toggle('active', b.dataset.lang === lang);
    });
    document.documentElement.lang = lang;
  }
  document.querySelectorAll('.s-lang-toggle button').forEach(function(btn){
    btn.addEventListener('click', function(){ applyLang(btn.dataset.lang); });
  });
})();
</script>`;
}

// Configuratore interattivo (2026-09-06, confronto 1:1 col mockup di
// riferimento — fase 4): un solo listener per .s-config-box, scoperto punto
// per punto sul DOM (querySelector DENTRO il box, mai un id globale) — più
// configuratori nella stessa pagina restano indipendenti, stesso principio
// già seguito per formSubmitScript con due 'form'. La lingua del risultato
// (nome/descrizione dell'esito, riempiti da JS al click) legge
// document.documentElement.lang al MOMENTO del click, non al caricamento
// della pagina — corretto sia se l'utente cambia lingua prima di rispondere,
// sia se la cambia dopo aver già visto un risultato (rifà il quiz o no).
function configuratoreScript() {
  return `<script>
document.querySelectorAll('.s-config-box').forEach(function(box){
  var esiti = [];
  try { esiti = JSON.parse(box.dataset.sConfigEsiti || '[]'); } catch (e) {}
  var steps = box.querySelectorAll('.s-config-step');
  var resultEl = box.querySelector('.s-config-result');
  var dots = box.querySelectorAll('.s-config-dot');
  var totalSteps = steps.length;
  var scores = {};

  function goToStep(n){
    steps.forEach(function(s){ s.hidden = Number(s.dataset.step) !== n; });
    if (resultEl) resultEl.hidden = Number(resultEl.dataset.step) !== n;
    dots.forEach(function(d, i){ d.classList.toggle('s-config-dot-active', i + 1 === n); });
  }

  function showResult(){
    var winnerKey = null, best = -Infinity;
    Object.keys(scores).forEach(function(k){ if (scores[k] > best) { best = scores[k]; winnerKey = k; } });
    var esito = null;
    esiti.forEach(function(e){ if (e.key === winnerKey) esito = e; });
    if (!esito) return;
    var lang = document.documentElement.lang === 'en' ? 'en' : 'it';
    var img = box.querySelector('.s-config-result-img');
    var nome = box.querySelector('.s-config-result-nome');
    var desc = box.querySelector('.s-config-result-desc');
    var cta = box.querySelector('.s-config-result-cta');
    if (img) {
      if (esito.immagine) { img.src = esito.immagine; img.style.display = ''; }
      else { img.style.display = 'none'; }
    }
    if (nome) nome.textContent = (lang === 'en' && esito.nome_en) ? esito.nome_en : esito.nome;
    if (desc) desc.textContent = (lang === 'en' && esito.descrizione_en) ? esito.descrizione_en : esito.descrizione;
    if (cta) {
      var label = (lang === 'en' && esito.cta_label_en) ? esito.cta_label_en : esito.cta_label;
      if (label && esito.cta_target) { cta.textContent = label; cta.href = esito.cta_target; cta.style.display = ''; }
      else { cta.style.display = 'none'; }
    }
    goToStep(totalSteps + 1);
  }

  box.querySelectorAll('.s-config-opt').forEach(function(opt){
    opt.addEventListener('click', function(){
      var stepEl = opt.closest('.s-config-step');
      var stepN = stepEl ? Number(stepEl.dataset.step) : 0;
      var optScores = {};
      try { optScores = JSON.parse(opt.dataset.scores || '{}'); } catch (e) {}
      Object.keys(optScores).forEach(function(k){ scores[k] = (scores[k] || 0) + optScores[k]; });
      if (stepN < totalSteps) goToStep(stepN + 1); else showResult();
    });
  });

  var resetBtn = box.querySelector('.s-config-reset');
  if (resetBtn) resetBtn.addEventListener('click', function(){ scores = {}; goToStep(1); });
});
</script>`;
}

// Contatori animati (2026-09-06, confronto 1:1 col mockup — fase 6): il
// numero VERO è già nel markup (renderBlock, case 'statistiche' — vedi lì
// per il perché), questo script lo azzera e lo riconta su fino al valore
// reale SOLO quando la sezione entra in vista —
// puramente cosmetico, mai l'unica fonte del valore (un browser senza JS
// vede comunque il numero vero, statico, da subito). Stessa easing
// cubica/soglia 0.6 del mockup di riferimento.
function counterScript() {
  return `<script>
(function(){
  var els = document.querySelectorAll('.s-stat-value[data-counter-target]');
  if (!els.length || !('IntersectionObserver' in window)) return;
  function animate(el){
    var target = parseFloat(el.dataset.counterTarget);
    var suffix = el.dataset.counterSuffix || '';
    if (isNaN(target)) return;
    var duration = 1200;
    var start = performance.now();
    function tick(now){
      var p = Math.min(1, (now - start) / duration);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(target * eased) + suffix;
      if (p < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }
  var io = new IntersectionObserver(function(entries){
    entries.forEach(function(entry){
      if (entry.isIntersecting) { animate(entry.target); io.unobserve(entry.target); }
    });
  }, { threshold: 0.6 });
  els.forEach(function(el){ io.observe(el); });
})();
</script>`;
}

// Parallax leggero su scroll (2026-09-06, confronto 1:1 col mockup — fase
// 7): rispetta prefers-reduced-motion con un check esplicito PRIMA di
// agganciare qualunque listener (mai solo via CSS qui, la libreria non usa
// animazioni CSS per questo effetto) — stesso principio già seguito nel
// mockup di riferimento. Hero: backgroundPositionY su .s-hero-photo-el
// (2026-09-06: da quando la foto è un elemento a sé e non più uno sfondo
// condiviso con la section del testo, il selettore punta al figlio, non
// più a .s-hero-parallax stessa — il flag/classe resta sulla section per
// compatibilità, solo il bersaglio dell'animazione è cambiato). Immagine:
// transform diretto sull'<img> stesso, innocuo perché lì la foto è
// sempre stata un elemento a sé, non uno sfondo condiviso col testo.
function parallaxScript() {
  return `<script>
(function(){
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var heroEls = document.querySelectorAll('.s-hero-parallax .s-hero-photo-el');
  var imgEls = document.querySelectorAll('.s-immagine-parallax');
  if (!heroEls.length && !imgEls.length) return;
  var ticking = false;
  function update(){
    var vh = window.innerHeight;
    heroEls.forEach(function(el){
      var rect = el.parentElement.getBoundingClientRect();
      el.style.backgroundPositionY = (rect.top * -0.12) + 'px';
    });
    imgEls.forEach(function(el){
      var rect = el.getBoundingClientRect();
      var center = rect.top + rect.height / 2 - vh / 2;
      el.style.transform = 'translateY(' + (center * 0.06) + 'px) scale(1.08)';
    });
    ticking = false;
  }
  document.addEventListener('scroll', function(){
    if (!ticking) { requestAnimationFrame(update); ticking = true; }
  }, { passive: true });
  window.addEventListener('resize', update);
  update();
})();
</script>`;
}

// Riempimento oro della timeline allo scroll (2026-09-06, confronto 1:1
// col mockup — segnalato dall'utente: "questo blocco ha una animazione
// nell'artifact che non vedo"). .s-timeline-fill parte da height:0 e
// cresce mentre la sezione attraversa il viewport — stessa formula del
// mockup di riferimento (progress = quanto della track è già passata
// oltre l'80% del viewport, normalizzato sulla sua altezza + metà
// viewport, così il riempimento finisce un po' prima che l'ultimo passo
// tocchi il fondo, non esattamente al pixel).
function timelineFillScript() {
  return `<script>
(function(){
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var tracks = document.querySelectorAll('.s-timeline-track');
  if (!tracks.length) return;
  var ticking = false;
  function update(){
    tracks.forEach(function(track){
      var fill = track.querySelector('.s-timeline-fill');
      if (!fill) return;
      var rect = track.getBoundingClientRect();
      var vh = window.innerHeight;
      var total = rect.height + vh * 0.5;
      var passed = vh * 0.8 - rect.top;
      var progress = Math.max(0, Math.min(1, passed / total));
      fill.style.height = (progress * 100) + '%';
    });
    ticking = false;
  }
  document.addEventListener('scroll', function(){
    if (!ticking) { requestAnimationFrame(update); ticking = true; }
  }, { passive: true });
  window.addEventListener('resize', update);
  update();
})();
</script>`;
}

// Effetti hover desktop-only (2026-09-06, confronto 1:1 col mockup — fase
// 8, ultimo pezzo): spotlight dorato sulle sezioni scure, tilt 3D leggero
// sulle card prodotto, bottoni magnetici — TUTTI dietro un unico check
// esplicito (hover:hover) and (pointer:fine) fatto UNA volta all'inizio,
// stesso identico principio del mockup di riferimento: un dispositivo
// touch non ha un "cursore" con cui questi effetti abbiano senso, e
// mousemove su touch è comunque inaffidabile/fantasma su molti browser
// mobile — meglio non agganciare proprio i listener che filtrarli dopo.
function hoverEffectsScript() {
  return `<script>
(function(){
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

  document.querySelectorAll('.s-dark').forEach(function(el){
    el.addEventListener('mousemove', function(e){
      var r = el.getBoundingClientRect();
      el.style.setProperty('--gx', ((e.clientX - r.left) / r.width * 100).toFixed(1) + '%');
      el.style.setProperty('--gy', ((e.clientY - r.top) / r.height * 100).toFixed(1) + '%');
      el.classList.add('s-glow-active');
    });
    el.addEventListener('mouseleave', function(){ el.classList.remove('s-glow-active'); });
  });

  document.querySelectorAll('.s-prodotto').forEach(function(card){
    card.addEventListener('mousemove', function(e){
      var r = card.getBoundingClientRect();
      var px = (e.clientX - r.left) / r.width - 0.5;
      var py = (e.clientY - r.top) / r.height - 0.5;
      card.style.transform = 'perspective(1000px) rotateY(' + (px * 8) + 'deg) rotateX(' + (-py * 8) + 'deg)';
    });
    card.addEventListener('mouseleave', function(){ card.style.transform = ''; });
  });

  document.querySelectorAll('.s-btn').forEach(function(btn){
    btn.addEventListener('mousemove', function(e){
      var r = btn.getBoundingClientRect();
      var x = e.clientX - r.left - r.width / 2;
      var y = e.clientY - r.top - r.height / 2;
      btn.style.transform = 'translate(' + (x * 0.16) + 'px, ' + (y * 0.35) + 'px)';
    });
    btn.addEventListener('mouseleave', function(){ btn.style.transform = ''; });
  });
})();
</script>`;
}

// Comparsa allo scroll (2026-09-05) — IntersectionObserver nativo (nessuna
// libreria di animazione), soglia bassa (12% visibile) e un margine
// negativo in basso perché la sezione inizi a comparire un po' prima di
// toccare il fondo reale del viewport, coerente con l'effetto del mockup di
// riferimento. Fallback esplicito se IntersectionObserver non esiste
// (browser molto vecchi): mostra tutto subito, mai contenuto bloccato
// invisibile per sempre.
function revealScript() {
  return `<script>
(function(){
  var els = document.querySelectorAll('.s-reveal');
  if (!('IntersectionObserver' in window)) { els.forEach(function(el){ el.classList.add('s-in-view'); }); return; }
  var io = new IntersectionObserver(function(entries){
    entries.forEach(function(entry){
      if (entry.isIntersecting) { entry.target.classList.add('s-in-view'); io.unobserve(entry.target); }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -60px 0px' });
  els.forEach(function(el){ io.observe(el); });
})();
</script>`;
}

// Scroll-progress bar (2026-09-05, confronto 1:1 col mockup di riferimento) —
// window.scrollY / (altezza documento - altezza viewport) in percentuale,
// aggiornato ad ogni scroll. Nessun throttle: un aggiornamento di una singola
// proprietà CSS (width) per evento scroll è un costo trascurabile, stesso
// livello di semplicità già scelto per revealScript.
// Header overlay (2026-09-06, confronto 1:1 col mockup di riferimento) —
// una sola soglia fissa (40px), niente di configurabile: lo scopo è solo
// distinguere "in cima, sopra la foto" da "scrollato, serve leggibilità",
// non un effetto regolabile a piacere.
function headerScrollScript() {
  return `<script>
(function(){
  var header = document.querySelector('.s-header-overlay');
  if (!header) return;
  function update(){ header.classList.toggle('s-header-scrolled', window.scrollY > 40); }
  document.addEventListener('scroll', update, { passive: true });
  update();
})();
</script>`;
}

// Scroll-spy nav (2026-09-06, confronto 1:1 col mockup — fase 5): stesso
// rootMargin del mockup di riferimento (-45% dall'alto, -50% dal basso) —
// una sezione conta "attiva" quando ha superato il centro dello schermo,
// non appena sfiora il bordo. Un link ripetuto (stessa url in più punti,
// es. header + footer) è ammesso: solo i link DENTRO .s-header-nav vengono
// evidenziati, mai quelli del footer (non ha senso "attivo" lì).
function scrollSpyScript() {
  // 2026-09-06, bug reale segnalato dall'utente ("vedi il menu che
  // evidenzia la voce sbagliata?", riprodotto: scrollare fino a "Il
  // viaggio" poi tornare in cima lasciava quella voce evidenziata). La
  // versione precedente toglieva 's-nav-active' da una voce solo quando
  // un'ALTRA sezione diventava attiva (isIntersecting true altrove), mai
  // quando si usciva da TUTTE le sezioni osservate (es. tornando sopra la
  // prima, o scendendo sotto l'ultima) — un set di sezioni correntemente
  // intersecanti sostituisce quel toggle "solo in positivo".
  return `<script>
(function(){
  var links = Array.prototype.filter.call(document.querySelectorAll('.s-header-nav a[href]'), function(a){
    var href = a.getAttribute('href');
    return href.charAt(0) === '#' && href.length > 1;
  });
  if (!links.length || !('IntersectionObserver' in window)) return;
  var targets = [];
  links.forEach(function(a){
    var el = document.getElementById(a.getAttribute('href').slice(1));
    if (el && targets.indexOf(el) === -1) targets.push(el);
  });
  var active = [];
  function apply(){
    var current = targets.filter(function(el){ return active.indexOf(el) !== -1; })[0];
    var href = current ? '#' + current.id : null;
    links.forEach(function(a){ a.classList.toggle('s-nav-active', !!href && a.getAttribute('href') === href); });
  }
  var io = new IntersectionObserver(function(entries){
    entries.forEach(function(entry){
      var i = active.indexOf(entry.target);
      if (entry.isIntersecting && i === -1) active.push(entry.target);
      else if (!entry.isIntersecting && i !== -1) active.splice(i, 1);
    });
    apply();
  }, { rootMargin: '-45% 0px -50% 0px', threshold: 0 });
  targets.forEach(function(el){ io.observe(el); });
})();
</script>`;
}

function scrollProgressScript() {
  return `<script>
(function(){
  var bar = document.getElementById('s-scroll-progress');
  if (!bar) return;
  function update(){
    var h = document.documentElement;
    var max = h.scrollHeight - h.clientHeight;
    bar.style.width = (max > 0 ? (h.scrollTop / max) * 100 : 0) + '%';
  }
  document.addEventListener('scroll', update, { passive: true });
  update();
})();
</script>`;
}

function renderSitemapXml(baseUrl) {
  const pages = db.prepare('SELECT slug, updated_at FROM site_pages WHERE published = 1').all();
  const urls = pages.map((p) => `  <url><loc>${escapeHtml(baseUrl)}/negozio/${escapeHtml(p.slug)}</loc><lastmod>${new Date(p.updated_at).toISOString().slice(0, 10)}</lastmod></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;
}

function renderRobotsTxt(baseUrl) {
  return `User-agent: *\nAllow: /negozio\nDisallow: /api\nSitemap: ${baseUrl}/negozio/sitemap.xml\n`;
}

module.exports = { renderPageHtml, renderSitemapXml, renderRobotsTxt };
