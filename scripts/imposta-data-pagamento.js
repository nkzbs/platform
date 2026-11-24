#!/usr/bin/env node
'use strict';
// Compila la DATA DI PAGAMENTO delle voci già pagate che non ce l'hanno: il giorno di pagamento (di solito il 27) del mese della scadenza (o, senza scadenza, della data della
// riga), mai nel futuro. Stessa regola che si applica da sola quando una voce passa a «pagato» (core/backend/src/data-pagamento.js), qui per lo storico.
// Non sovrascrive mai una data di pagamento già scritta. Prova a secco di default: elenca cosa cambierebbe e non scrive. Con --applica salva prima una copia delle righe in
// ~/Desktop/platform-backup-nas/finance-prima-<nome>-<data>.json, poi scrive riga per riga e rilegge per verificare.
//
//   PLATFORM_URL=https://... PLATFORM_API_TOKEN=plat_... node scripts/imposta-data-pagamento.js \
//     --modulo spese_casa --modulo spese_personali [--stato-pagato pagato] [--giorno 27] [--campo-pagamento data_pagamento] [--campo-scadenza scadenza] [--campo-data data] [--applica]
//
// Il token si crea in Platform → Il mio account → Token API (permessi di chi lo crea). Non finisce mai su disco né nei log.
const fs = require('fs');
const os = require('os');
const path = require('path');

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function leggiArgomenti(argv) {
  const a = { modulo: [], applica: false, statoPagato: 'pagato', giorno: 27, campoPagamento: 'data_pagamento', campoScadenza: 'scadenza', campoData: 'data', nome: 'data-pagamento' };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--applica') a.applica = true;
    else if (k === '--modulo') a.modulo.push(argv[++i]);
    else if (k === '--stato-pagato') a.statoPagato = argv[++i];
    else if (k === '--giorno') a.giorno = parseInt(argv[++i], 10);
    else if (k === '--campo-pagamento') a.campoPagamento = argv[++i];
    else if (k === '--campo-scadenza') a.campoScadenza = argv[++i];
    else if (k === '--campo-data') a.campoData = argv[++i];
    else if (k === '--nome') a.nome = argv[++i];
    else if (k === '--cartella-copie') a.cartella = argv[++i];
    else throw new Error('Opzione sconosciuta: ' + k);
  }
  if (!a.modulo.length) throw new Error('Serve almeno un --modulo.');
  if (!(a.giorno >= 2 && a.giorno <= 28)) throw new Error('Il giorno deve essere tra 2 e 28.');
  return a;
}

// Il giorno `giorno` del mese di `iso`, ma non oltre `oggi` (mai una data di pagamento nel futuro).
const giornoDiPagamento = (iso, giorno, oggi) => { const d = iso.slice(0, 8) + String(giorno).padStart(2, '0'); return d > oggi ? oggi : d; };

// Cosa cambiare: righe nello stato «pagato» senza data di pagamento, con una data da cui partire. `saltate` = pagate ma senza nessuna data (non si inventa).
function calcola(righe, a, oggi) {
  const daFare = [], saltate = [];
  for (const r of righe) {
    const d = r.data || {};
    if (d._stato !== a.statoPagato || d[a.campoPagamento]) continue;
    const base = String(d[a.campoScadenza] || d[a.campoData] || '').slice(0, 10);
    if (!ISO.test(base)) { saltate.push(r); continue; }
    daFare.push({ r, base, nuova: giornoDiPagamento(base, a.giorno, oggi) });
  }
  return { daFare, saltate };
}

async function main() {
  const a = leggiArgomenti(process.argv.slice(2));
  const base = (process.env.PLATFORM_URL || '').replace(/\/$/, '');
  const token = process.env.PLATFORM_API_TOKEN;
  if (!base || !token) throw new Error('Imposta PLATFORM_URL e PLATFORM_API_TOKEN (variabili d\'ambiente).');
  const H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  const get = async (p) => { const r = await fetch(base + p, { headers: H }); if (!r.ok) throw new Error(p + ' → ' + r.status); return r.json(); };
  const oggi = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

  console.log((a.applica ? 'APPLICO' : 'PROVA A SECCO (non scrive)') + ' — data di pagamento = il ' + a.giorno + ' del mese della scadenza, mai oltre oggi (' + oggi + ')');
  const tutte = [];
  for (const modulo of a.modulo) {
    const righe = await get('/api/records/' + encodeURIComponent(modulo));
    const { daFare, saltate } = calcola(righe, a, oggi);
    const gia = righe.filter((r) => (r.data || {})._stato === a.statoPagato && (r.data || {})[a.campoPagamento]).length;
    console.log('\n' + modulo + ': ' + righe.length + ' righe, ' + gia + ' pagate con data, ' + daFare.length + ' da compilare, ' + saltate.length + ' pagate senza nessuna data (non toccate)');
    for (const x of daFare) console.log('  #' + x.r.id + '  ' + String(x.r.data.descrizione || '').slice(0, 48).padEnd(48) + '  ' + (x.r.data[a.campoScadenza] ? 'scad. ' : 'data  ') + x.base + '  →  ' + x.nuova);
    daFare.forEach((x) => tutte.push({ modulo, ...x }));
  }
  if (!tutte.length) { console.log('\nNiente da compilare.'); return; }
  const perMese = {}; tutte.forEach((x) => { perMese[x.nuova.slice(0, 7)] = (perMese[x.nuova.slice(0, 7)] || 0) + 1; });
  console.log('\nTotale da compilare: ' + tutte.length + '. Per mese di pagamento: ' + Object.entries(perMese).sort().map(([m, n]) => m + ' ' + n).join(' · '));
  if (!a.applica) { console.log('\nPer scrivere aggiungi --applica.'); return; }

  const cartella = a.cartella || path.join(os.homedir(), 'Desktop', 'platform-backup-nas');
  fs.mkdirSync(cartella, { recursive: true });
  const copia = path.join(cartella, 'finance-prima-' + a.nome + '-' + new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '') + '.json');  // con l'ora: due lanci lo stesso giorno non si sovrascrivono la copia
  fs.writeFileSync(copia, JSON.stringify(tutte.map((x) => ({ modulo: x.modulo, id: x.r.id, data: x.r.data })), null, 2));
  console.log('\nCopia salvata: ' + copia);

  let ko = 0;
  for (const x of tutte) {
    const url = '/api/records/' + encodeURIComponent(x.modulo) + '/' + x.r.id;
    const res = await fetch(base + url, { method: 'PUT', headers: H, body: JSON.stringify({ ...x.r.data, [a.campoPagamento]: x.nuova }) });
    const dopo = res.ok ? (await get(url)).data : null;
    const ok = !!dopo && dopo[a.campoPagamento] === x.nuova && dopo._stato === a.statoPagato;
    if (!ok) { ko++; console.log('  #' + x.r.id + '  NON RIUSCITA (' + res.status + ')'); }
  }
  console.log('\n' + (tutte.length - ko) + ' righe aggiornate' + (ko ? ', ' + ko + ' NON riuscite: la copia sopra resta valida.' : ', tutte verificate rileggendole.'));
  if (ko) process.exitCode = 1;
}

if (require.main === module) main().catch((e) => { console.error('Errore: ' + e.message); process.exit(1); });
module.exports = { leggiArgomenti, calcola, giornoDiPagamento };
