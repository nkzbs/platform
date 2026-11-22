#!/usr/bin/env node
'use strict';
// Imposta lo stato di alcune righe di un modulo scelte per descrizione (es. rate che hanno lo stato vuoto).
// Prova a secco di default: elenca cosa cambierebbe e non scrive. Con --applica salva prima una copia dei record in
// ~/Desktop/platform-backup-nas/finance-prima-<cosa>-<data>.json, poi scrive riga per riga e rilegge per verificare.
//
//   PLATFORM_URL=https://... PLATFORM_API_TOKEN=plat_... node scripts/imposta-stato.js \
//     --modulo spese_personali --stato da_pagare --descrizione "RATA 6/11 ROMANIELLO" --descrizione "RATA 7/11 ROMANIELLO" [--solo-stato-vuoto] [--applica]
//
// Il token si crea in Platform → Il mio account → Token API (permessi di chi lo crea). Non finisce mai su disco né nei log.
const fs = require('fs');
const os = require('os');
const path = require('path');

function leggiArgomenti(argv) {
  const a = { descrizione: [], applica: false, soloStatoVuoto: false, nome: 'stato' };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--applica') a.applica = true;
    else if (k === '--solo-stato-vuoto') a.soloStatoVuoto = true;
    else if (k === '--descrizione') a.descrizione.push(argv[++i]);
    else if (k === '--modulo') a.modulo = argv[++i];
    else if (k === '--stato') a.stato = argv[++i];
    else if (k === '--nome') a.nome = argv[++i];
    else if (k === '--cartella-copie') a.cartella = argv[++i];
    else throw new Error('Opzione sconosciuta: ' + k);
  }
  if (!a.modulo || !a.stato || !a.descrizione.length) throw new Error('Servono --modulo, --stato e almeno una --descrizione.');
  return a;
}

// Quali righe toccare: descrizione identica (senza badare a maiuscole) e, con --solo-stato-vuoto, solo se lo stato è vuoto.
function scegli(righe, a) {
  const voluti = new Set(a.descrizione.map((d) => String(d).trim().toLowerCase()));
  return righe.filter((r) => voluti.has(String((r.data || {}).descrizione || '').trim().toLowerCase()) && (!a.soloStatoVuoto || !r.data._stato) && r.data._stato !== a.stato);
}

async function main() {
  const a = leggiArgomenti(process.argv.slice(2));
  const base = (process.env.PLATFORM_URL || '').replace(/\/$/, '');
  const token = process.env.PLATFORM_API_TOKEN;
  if (!base || !token) throw new Error('Imposta PLATFORM_URL e PLATFORM_API_TOKEN (variabili d\'ambiente).');
  const H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  const get = async (p) => { const r = await fetch(base + p, { headers: H }); if (!r.ok) throw new Error(p + ' → ' + r.status); return r.json(); };

  const righe = await get('/api/records/' + encodeURIComponent(a.modulo));
  const daFare = scegli(righe, a);
  const trovate = new Set(daFare.map((r) => String(r.data.descrizione).trim().toLowerCase()));
  const mancano = a.descrizione.filter((d) => !trovate.has(String(d).trim().toLowerCase()) && !righe.some((r) => String((r.data || {}).descrizione || '').trim().toLowerCase() === String(d).trim().toLowerCase()));
  console.log((a.applica ? 'APPLICO' : 'PROVA A SECCO (non scrive)') + ' — modulo ' + a.modulo + ', stato → ' + a.stato);
  for (const r of daFare) console.log('  #' + r.id + '  ' + r.data.descrizione + '  data ' + (r.data.data || '-') + '  stato ora: ' + (r.data._stato || '(vuoto)'));
  if (!daFare.length) console.log('  Nessuna riga da cambiare (già a posto, o descrizione non trovata).');
  for (const d of mancano) console.log('  ATTENZIONE: nessuna riga con descrizione «' + d + '»');
  if (!a.applica || !daFare.length) { if (!a.applica) console.log('\nPer scrivere aggiungi --applica.'); return; }

  const cartella = a.cartella || path.join(os.homedir(), 'Desktop', 'platform-backup-nas');
  fs.mkdirSync(cartella, { recursive: true });
  const copia = path.join(cartella, 'finance-prima-' + a.nome + '-' + new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '') + '.json');  // con l'ora: due lanci lo stesso giorno non si sovrascrivono la copia
  fs.writeFileSync(copia, JSON.stringify(daFare, null, 2));
  console.log('\nCopia salvata: ' + copia);

  let ko = 0;
  for (const r of daFare) {
    const res = await fetch(base + '/api/records/' + encodeURIComponent(a.modulo) + '/' + r.id, { method: 'PUT', headers: H, body: JSON.stringify({ ...r.data, _stato: a.stato }) });
    const dopo = res.ok ? (await get('/api/records/' + encodeURIComponent(a.modulo) + '/' + r.id)).data : null;
    const ok = !!dopo && dopo._stato === a.stato;
    if (!ok) ko++;
    console.log('  #' + r.id + '  ' + (ok ? 'OK, ora «' + a.stato + '»' : 'NON RIUSCITA (' + res.status + ')'));
  }
  if (ko) { console.log('\n' + ko + ' righe non cambiate: la copia sopra resta valida.'); process.exitCode = 1; }
}

if (require.main === module) main().catch((e) => { console.error('Errore: ' + e.message); process.exit(1); });
module.exports = { leggiArgomenti, scegli };
