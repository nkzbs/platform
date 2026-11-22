#!/usr/bin/env node
'use strict';
// Rinomina le rate di un piano esistente in «Nome — rata x su y» (come fa da ora la creazione di un piano).
// Prova a secco di default; con --applica salva prima la copia delle righe in ~/Desktop/platform-backup-nas/finance-prima-numera-rate-<data>.json,
// scrive riga per riga e rilegge. Una rata si numera in ordine di data. Un piano le cui rate non sono quante dice `n_rate` si salta e lo dice.
//
//   PLATFORM_URL=https://... PLATFORM_API_TOKEN=plat_... node scripts/numera-rate.js \
//     --piani debiti_personali --figli spese_personali --relazione debito --piano "Antonio Romaniello" [--piano ...] [--applica]
const fs = require('fs');
const os = require('os');
const path = require('path');

function leggiArgomenti(argv) {
  const a = { piano: [], applica: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--applica') a.applica = true;
    else if (k === '--piani') a.piani = argv[++i];
    else if (k === '--figli') a.figli = argv[++i];
    else if (k === '--relazione') a.relazione = argv[++i];
    else if (k === '--piano') a.piano.push(argv[++i]);
    else if (k === '--cartella-copie') a.cartella = argv[++i];
    else throw new Error('Opzione sconosciuta: ' + k);
  }
  if (!a.piani || !a.figli || !a.relazione || !a.piano.length) throw new Error('Servono --piani, --figli, --relazione e almeno un --piano.');
  return a;
}

const nomeRata = (nome, i, tot) => (tot > 1 ? nome + ' — rata ' + i + ' su ' + tot : nome);

// Calcola, per un piano e le sue rate, i nuovi nomi. Ritorna { saltato: motivo } oppure { cambi: [{ riga, da, a }] }.
function calcola(piano, rate) {
  const nome = String((piano.data || {}).nome || '').trim();
  const n = parseInt((piano.data || {}).n_rate, 10) || 0;
  if (!nome) return { saltato: 'il piano non ha un nome' };
  if (n < 1 || rate.length !== n) return { saltato: 'il piano dice ' + n + ' rate ma ne ho trovate ' + rate.length };
  const ordinate = [...rate].sort((x, y) => String(x.data.data || '').localeCompare(String(y.data.data || '')) || x.id - y.id);
  const cambi = [];
  ordinate.forEach((r, k) => { const a = nomeRata(nome, k + 1, n); if ((r.data.descrizione || '') !== a) cambi.push({ riga: r, da: r.data.descrizione || '', a }); });
  return { cambi };
}

async function main() {
  const a = leggiArgomenti(process.argv.slice(2));
  const base = (process.env.PLATFORM_URL || '').replace(/\/$/, '');
  const token = process.env.PLATFORM_API_TOKEN;
  if (!base || !token) throw new Error('Imposta PLATFORM_URL e PLATFORM_API_TOKEN (variabili d\'ambiente).');
  const H = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  const get = async (p) => { const r = await fetch(base + p, { headers: H }); if (!r.ok) throw new Error(p + ' → ' + r.status); return r.json(); };

  const piani = await get('/api/records/' + encodeURIComponent(a.piani));
  const figli = await get('/api/records/' + encodeURIComponent(a.figli));
  console.log((a.applica ? 'APPLICO' : 'PROVA A SECCO (non scrive)') + ' — piani in ' + a.piani + ', rate in ' + a.figli);
  const tutti = [];
  for (const richiesto of a.piano) {
    const p = piani.find((x) => String((x.data || {}).nome || '').trim().toLowerCase() === String(richiesto).trim().toLowerCase());
    if (!p) { console.log('\n«' + richiesto + '»: ATTENZIONE, nessun piano con questo nome'); continue; }
    const rate = figli.filter((f) => Number(f.data[a.relazione]) === Number(p.id));
    const c = calcola(p, rate);
    console.log('\n«' + richiesto + '» (piano #' + p.id + ', ' + rate.length + ' rate)');
    if (c.saltato) { console.log('  SALTATO: ' + c.saltato); continue; }
    if (!c.cambi.length) { console.log('  già a posto'); continue; }
    for (const x of c.cambi) console.log('  #' + x.riga.id + '  ' + x.riga.data.data + '  «' + x.da + '» → «' + x.a + '»');
    tutti.push(...c.cambi);
  }
  if (!a.applica) { console.log('\nPer scrivere aggiungi --applica.'); return; }
  if (!tutti.length) { console.log('\nNiente da scrivere.'); return; }

  const cartella = a.cartella || path.join(os.homedir(), 'Desktop', 'platform-backup-nas');
  fs.mkdirSync(cartella, { recursive: true });
  const copia = path.join(cartella, 'finance-prima-numera-rate-' + new Date().toISOString().slice(0, 10) + '.json');
  fs.writeFileSync(copia, JSON.stringify(tutti.map((x) => x.riga), null, 2));
  console.log('\nCopia salvata: ' + copia);
  let ko = 0;
  for (const x of tutti) {
    const res = await fetch(base + '/api/records/' + encodeURIComponent(a.figli) + '/' + x.riga.id, { method: 'PUT', headers: H, body: JSON.stringify({ ...x.riga.data, descrizione: x.a }) });
    const dopo = res.ok ? (await get('/api/records/' + encodeURIComponent(a.figli) + '/' + x.riga.id)).data : null;
    const ok = !!dopo && dopo.descrizione === x.a;
    if (!ok) ko++;
    console.log('  #' + x.riga.id + '  ' + (ok ? 'OK' : 'NON RIUSCITA (' + res.status + ')'));
  }
  if (ko) { console.log('\n' + ko + ' righe non cambiate: la copia sopra resta valida.'); process.exitCode = 1; }
}

if (require.main === module) main().catch((e) => { console.error('Errore: ' + e.message); process.exit(1); });
module.exports = { leggiArgomenti, calcola, nomeRata };
