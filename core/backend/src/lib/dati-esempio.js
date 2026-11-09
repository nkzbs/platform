'use strict';
// DATI DI ESEMPIO GENERATI DALLO SCHEMA: per provare un tenant appena costruito, o mostrarlo a qualcuno, senza inserire a mano decine di schede.
// Per ogni modulo installato crea qualche record con valori plausibili per tipo di campo (nomi, città, importi, date vicine a oggi, scelte a rotazione), collegati tra loro
// dalle relazioni e distribuiti sugli stati del flusso. I record si scrivono direttamente (senza far scattare automazioni, notifiche o mail) e portano `_demo: true`, la stessa
// marcatura dei dati dimostrativi: si tolgono tutti insieme con `rimuovi()` di lib/dati-dimostrativi.js. Nessun nome di settore.
const db = require('../db');
const { codiceFiscaleValido, partitaIvaValida } = require('../../../../shared/validazioni-campo.js');
const dim = require('./dati-dimostrativi');

const NOMI = ['Mario', 'Giulia', 'Luca', 'Anna', 'Paolo', 'Sara', 'Marco', 'Elena', 'Davide', 'Chiara'];
const COGNOMI = ['Rossi', 'Bianchi', 'Verdi', 'Neri', 'Gallo', 'Conti', 'Ferri', 'Riva', 'Marini', 'Costa'];
const CITTA = ['Brescia', 'Milano', 'Verona', 'Bergamo', 'Torino', 'Padova', 'Bologna', 'Trento'];
const giorno = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

function codiceFiscale(i) {
  const base = 'RSSMRA85T10A5' + String(10 + (i % 90)).padStart(2, '0');
  for (let c = 65; c <= 90; c++) { const cf = base + String.fromCharCode(c); if (codiceFiscaleValido(cf)) return cf; }
  return 'RSSMRA85T10A562S';
}
function partitaIva(i) {
  const base = String(1234567890 + i * 37).slice(0, 10);
  for (let d = 0; d <= 9; d++) { const p = base + d; if (partitaIvaValida(p)) return p; }
  return '12345678903';
}

function valore(campo, i) {
  const f = campo; const k = String(f.key || '').toLowerCase();
  if (f.validazione === 'codice_fiscale_it' || f.validazione === 'codice_fiscale_o_piva_it') return f.validazione === 'codice_fiscale_o_piva_it' && i % 4 === 3 ? partitaIva(i) : codiceFiscale(i);
  if (f.validazione === 'partita_iva_it') return partitaIva(i);
  const opz = Array.isArray(f.options) && f.options.length ? f.options : null;
  const scelta = opz ? opz[i % opz.length] : undefined; const v = scelta && typeof scelta === 'object' ? (scelta.value !== undefined ? scelta.value : scelta.key) : scelta;
  switch (f.type) {
    case 'number': return 1 + ((i * 7) % 20);
    case 'currency': return 1000 + ((i * 7919) % 49000) - (((i * 7919) % 49000) % 100);
    case 'date': return giorno(((i * 5) % 40) - 15);
    case 'datetime': return giorno(((i * 5) % 40) - 15) + 'T10:00';
    case 'time': return String(9 + (i % 8)).padStart(2, '0') + ':00';
    case 'select': return v;
    case 'multiselect': return v === undefined ? undefined : [v];
    case 'checkbox': return i % 2 === 0;
    case 'email': return 'contatto' + (i + 1) + '@example.com';
    case 'phone': return '+39 333 ' + String(1000000 + i * 1111);
    case 'url': return 'https://example.com/' + (i + 1);
    case 'textarea': return 'Nota di esempio ' + (i + 1) + '.';
    case 'text': case undefined: case '':
      if (/cognome/.test(k)) return COGNOMI[i % COGNOMI.length];
      if (/(^|_)nome$|^nome_|ragione|referente|intestatari/.test(k)) return NOMI[i % NOMI.length] + ' ' + COGNOMI[(i * 3) % COGNOMI.length];
      if (/citta|comune|localita/.test(k)) return CITTA[i % CITTA.length];
      if (/provincia/.test(k)) return ['BS', 'MI', 'VR', 'BG', 'TO'][i % 5];
      if (/^cap$/.test(k)) return String(25100 + (i % 20));
      if (/indirizzo|via$/.test(k)) return 'Via ' + COGNOMI[i % COGNOMI.length] + ' ' + (1 + ((i * 3) % 40));
      return (f.label || f.key) + ' ' + (i + 1);
    default: return undefined; // computed, file, mappa, encrypted…: non si inventano
  }
}

function leggi() {
  const mods = {};
  for (const m of db.prepare('SELECT slug, name, schema_json FROM modules WHERE installed = 1').all()) {
    let s; try { s = JSON.parse(m.schema_json || '{}'); } catch (e) { s = {}; }
    const steps = Array.isArray(s.steps) ? s.steps : [];
    mods[m.slug] = { slug: m.slug, nome: m.name, campi: steps.filter((b) => b.block_type === 'field'), relazioni: steps.filter((b) => b.block_type === 'relation' && b.target_module && (!b.type || b.type === 'many_to_one')), stati: steps.filter((b) => b.block_type === 'workflow_state'), passaggi: steps.filter((b) => b.block_type === 'workflow_transition'), riservati: new Set(steps.filter((b) => b.block_type === 'external_action').flatMap((b) => [b.risultato_in, ...Object.values(b.esito || {})]).filter(Boolean)) };
  }
  return mods;
}
// stati raggiungibili dall'iniziale, in ordine di distanza: i record si distribuiscono su tutti
function statiRaggiungibili(m) {
  const ini = m.stati.find((s) => s.initial) || m.stati[0]; if (!ini) return [];
  const out = [ini.key]; for (let k = 0; k < out.length; k++) for (const p of m.passaggi) if (p.from === out[k] && !out.includes(p.to) && m.stati.some((s) => s.key === p.to)) out.push(p.to);
  return out;
}

// Ordina i moduli perché ciò che è citato esista prima di chi lo cita (un giro di relazioni si spezza dove capita).
function ordine(mods) {
  const fatti = []; const visitando = new Set();
  const visita = (slug) => { if (fatti.includes(slug) || visitando.has(slug) || !mods[slug]) return; visitando.add(slug); for (const r of mods[slug].relazioni) visita(r.target_module); visitando.delete(slug); fatti.push(slug); };
  Object.keys(mods).forEach(visita);
  return fatti;
}

function carica({ quanti = 5, utenteId = null } = {}) {
  const n = Math.max(1, Math.min(30, parseInt(quanti, 10) || 5));
  if (dim.totaleDemo() > 0) throw Object.assign(new Error('Ci sono già dati dimostrativi o di esempio: toglili prima di caricarne altri.'), { status: 409, code: 'gia_presenti' });
  const mods = leggi(); const creati = {}; const id = {}; const avvisi = [];
  const utente = utenteId || (db.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get() || {}).id || 1;
  const ins = db.prepare('INSERT INTO records (module_slug, user_id, data) VALUES (?, ?, ?)');
  db.transaction(() => {
    for (const slug of ordine(mods)) {
      const m = mods[slug]; if (!m.campi.length) continue;
      const stati = statiRaggiungibili(m); id[slug] = [];
      for (let i = 0; i < n; i++) {
        const dati = { _demo: true };
        for (const f of m.campi) { if (m.riservati.has(f.key)) continue; const v = valore(f, i); if (v !== undefined) dati[f.key] = v; }
        for (const r of m.relazioni) { const lista = id[r.target_module] || []; if (lista.length) dati[r.key] = lista[i % lista.length]; }
        if (stati.length) dati._stato = stati[i % stati.length];
        id[slug].push(ins.run(slug, utente, JSON.stringify(dati)).lastInsertRowid);
      }
      creati[slug] = n;
    }
  })();
  if (!Object.keys(creati).length) avvisi.push('Nessun modulo con campi: niente da caricare.');
  return { creati, avvisi };
}

module.exports = { carica, rimuovi: dim.rimuovi, conta: dim.conta, totaleDemo: dim.totaleDemo };
