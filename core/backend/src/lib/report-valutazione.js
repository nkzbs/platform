'use strict';
// Testo del PDF «Report di valutazione» di un Immobile, ricavato dal report GIÀ salvato sul record
// (nessuna chiamata a OpenAPI.it, nessun credito consumato). Funzione pura: dati in, testo fuori;
// il PDF lo crea lib/documento-pdf.js. Una riga tutta in maiuscolo è un titoletto di sezione.

// Separatore delle migliaia scritto a mano: non dipende dai dati di localizzazione di Node.
const num = (n) => (n == null || n === '' || isNaN(Number(n)) ? '—' : String(Math.round(Number(n))).replace(/\B(?=(\d{3})+(?!\d))/g, '.'));
const pct = (n) => (n == null || n === '' || isNaN(Number(n)) ? '—' : String(Math.round(Number(n) * 10) / 10).replace('.', ',') + '%');
const euro = (n) => (num(n) === '—' ? '—' : num(n) + ' €');
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-zà-ú0-9]/g, '');

function sezione(righe, titolo, linee) {
  const utili = linee.filter((l) => l != null && l !== '');
  if (!utili.length) return;
  righe.push('', titolo.toUpperCase(), ...utili);
}

// → { titolo, corpo }
function testoReport({ record, report }) {
  const d = record.data || {};
  const r = report || {};
  const det = r.dettaglio || {};
  const q = det.quotazione || {};
  const demo = det.demografico || {};
  const med = parseFloat(String(q.med || '').replace(/[^0-9.]/g, '')) || null;
  const mq = parseFloat(d.superficie_mq) || null;
  const righe = [];

  const indirizzo = [d.indirizzo, d.numero_civico, d.cap, d.comune, d.provincia].filter(Boolean).join(' ');
  righe.push(d.titolo || 'Immobile');
  if (indirizzo) righe.push(indirizzo);
  righe.push('Data della valutazione: ' + (d.stima_data ? new Date(d.stima_data).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'));

  // Il report descrive il luogo che la fonte ha trovato: se non è quello dell'immobile va detto chiaro.
  const trovato = det.formatted || [det.citta, det.provincia].filter(Boolean).join(' ');
  if (d.comune && det.citta && norm(d.comune) !== norm(det.citta)) {
    righe.push('', 'ATTENZIONE: i dati di mercato qui sotto si riferiscono a «' + trovato + '», che non coincide con il comune indicato sull\'immobile (' + d.comune + '). Controllare l\'indirizzo e rifare la valutazione prima di usarli.');
  }

  sezione(righe, 'L\'immobile', [
    d.tipologia && 'Tipologia: ' + d.tipologia,
    mq && 'Superficie: ' + num(mq) + ' mq',
    d.locali && 'Locali: ' + d.locali,
    d.piano && 'Piano: ' + d.piano,
    d.anno_costruzione && 'Anno di costruzione: ' + d.anno_costruzione,
    d.classe_energetica && 'Classe energetica: ' + d.classe_energetica,
    d.stato_edificio && 'Stato dell\'edificio: ' + d.stato_edificio,
    d.prezzo_richiesto && 'Prezzo richiesto dal proprietario: ' + euro(d.prezzo_richiesto),
  ]);

  sezione(righe, 'Valutazione', [
    'Quotazione di zona al metro quadro: minima ' + euro(q.min) + ' · media ' + euro(med) + ' · massima ' + euro(q.max),
    mq && med ? 'Valore stimato (media × ' + num(mq) + ' mq): ' + euro(Math.round(med * mq)) + ' (intervallo ' + euro(Math.round(q.min * mq)) + ' – ' + euro(Math.round(q.max * mq)) + ')' : 'Valore stimato: non calcolabile, manca la superficie dell\'immobile.',
    d.stima_fonte && 'Fonte: ' + d.stima_fonte,
  ]);

  if (r.considerazioni) sezione(righe, 'Considerazioni del valutatore', [r.considerazioni]);

  const omi = r.omi;
  if (omi && Array.isArray(omi.values) && omi.values.length) {
    sezione(righe, 'Quotazioni OMI — Agenzia delle Entrate', [
      'Zona ' + (omi.omi_zone || '—') + (omi.zone && omi.zone.description ? ' (' + omi.zone.description + ')' : '') + (omi.municipality ? ' · ' + omi.municipality : ''),
      ...omi.values.map((v) => '· ' + v.property_type + (v.condition ? ' (' + String(v.condition).toLowerCase() + ')' : '') + ': vendita ' + (v.sale ? num(v.sale.min) + ' – ' + num(v.sale.max) + ' €/mq' : '—') + (v.rent ? ' · affitto ' + String(v.rent.min).replace('.', ',') + ' – ' + String(v.rent.max).replace('.', ',') + ' €/mq al mese' : '')),
    ]);
  }

  const comp = Array.isArray(r.comparabili) ? r.comparabili : [];
  sezione(righe, 'Immobili comparabili nella zona', comp.length
    ? comp.slice(0, 10).map((c) => '· ' + (c.property_type || 'Immobile') + ' · ' + (c.total_sqm ? num(c.total_sqm) + ' mq' : '— mq') + ' · ' + euro(c.price) + (c.price_per_sqm ? ' (' + num(c.price_per_sqm) + ' €/mq)' : '') + (c.municipality ? ' · ' + c.municipality : ''))
    : ['Nessun annuncio comparabile trovato vicino a questo indirizzo.']);

  const sism = [];
  if (demo.rischio_sismico) sism.push('Rischio sismico della zona (OpenAPI.it): ' + demo.rischio_sismico);
  if (r.zonaSismicaUfficiale && r.zonaSismicaUfficiale.zona != null) sism.push('Zona sismica ufficiale (ISPRA): ' + r.zonaSismicaUfficiale.zona + ' (1 = alta, 4 = bassa)');
  sezione(righe, 'Rischio sismico', sism);

  const fv = r.fotovoltaico;
  if (fv && fv.kwh_per_kwp_anno) sezione(righe, 'Potenziale fotovoltaico (JRC PVGIS)', [
    'Resa stimata: ' + num(fv.kwh_per_kwp_anno) + ' kWh all\'anno per ogni kW installato',
    fv.irraggiamento_kwh_mq_anno && 'Irraggiamento medio: ' + num(fv.irraggiamento_kwh_mq_anno) + ' kWh/m² all\'anno',
  ]);

  const dinamica = det.capoluoghi_vendite_zona && typeof det.capoluoghi_vendite_zona === 'object' ? Object.entries(det.capoluoghi_vendite_zona) : [];
  sezione(righe, 'Andamento del mercato in zona', dinamica.map(([anno, v]) => '· ' + anno + ': ' + v.numero_abitazioni_vendute + ' abitazioni vendute su ' + v.num_abitazioni_zona + ' (' + (Number(v.perc_variazione_annuale) > 0 ? '+' : '') + Math.round(Number(v.perc_variazione_annuale) * 10) / 10 + '% sull\'anno prima) · dinamicità ' + v.dinamicita_mercato_residenziale));

  const tempi = Array.isArray(det.tempistiche) && Array.isArray(det.tempistiche[0]) ? det.tempistiche[0] : [];
  sezione(righe, 'Tempi medi di vendita per superficie', tempi.map((t) => '· ' + String(t.label).replace(/^(\d+) (\d+) Mq$/, '$1-$2 Mq') + ': ' + t.media_giorni + ' giorni'));

  const rip = (det.ripartizione_annunci && det.ripartizione_annunci.vendita) || null;
  if (rip) sezione(righe, 'Annunci in vendita per tipologia', Object.values(rip).sort((a, b) => b.percentuale - a.percentuale).map((x) => '· ' + x.tipologia + ': ' + pct(x.percentuale)));
  const dim = Array.isArray(det.dimensioni) ? det.dimensioni : [];
  sezione(righe, 'Annunci per superficie', dim.map((x) => '· ' + x.label + ': ' + pct(x.percentuale)));

  const pop = demo.pop || {}, stock = demo.stock || {};
  sezione(righe, 'La zona', [
    demo.geo && demo.geo.nome_localita && 'Area: ' + demo.geo.nome_localita,
    pop.media_componenti_famiglia && 'Famiglie: in media ' + pop.media_componenti_famiglia + ' componenti (nuclei ' + (pop.dimensione_nuclei_familiari || '—') + ')',
    pop.livello_anzianita && 'Età della popolazione: livello ' + pop.livello_anzianita,
    pop.livello_istruzione && 'Istruzione: ' + pop.livello_istruzione,
    pop.livello_disoccupazione && 'Disoccupazione: ' + pop.livello_disoccupazione,
    stock.prc_edifici_residenziali && 'Edifici residenziali: ' + pct(stock.prc_edifici_residenziali),
    stock.prc_abitazioni_di_proprieta && 'Abitazioni di proprietà: ' + pct(stock.prc_abitazioni_di_proprieta),
    stock.prc_abitazioni_vuote_o_2_case && 'Abitazioni vuote o seconde case: ' + pct(stock.prc_abitazioni_vuote_o_2_case),
    stock.mq_abitazione_media && 'Superficie media delle abitazioni: ' + num(stock.mq_abitazione_media) + ' mq',
    stock.abitazioni_per_edificio && 'Abitazioni per edificio: ' + String(stock.abitazioni_per_edificio).replace('.', ','),
  ]);

  righe.push('', 'AVVERTENZA',
    'La valutazione è una stima indicativa basata su quotazioni medie di zona e dati pubblici. Non sostituisce una perizia e non tiene conto dello stato interno, delle finiture, del piano e dell\'esposizione dell\'immobile. Fonti: OpenAPI.it, Agenzia delle Entrate (OMI), ISPRA, JRC PVGIS.');

  return { titolo: 'Report di valutazione', corpo: righe.join('\n') };
}

module.exports = { testoReport };
