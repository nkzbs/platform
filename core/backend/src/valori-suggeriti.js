'use strict';
// Campi di testo con «suggerisci»: il valore si sceglie tra quelli già usati (es. il creditore di un piano) e si scrive sempre con la stessa grafia.
// `valoriUsati` li elenca (i più usati per primi); `allinea` riporta un valore scritto in modo leggermente diverso (maiuscole, spazi, punteggiatura,
// accenti: «AUTOLANZANOVA», «Auto Lanzanova») alla grafia già in uso più frequente. Un valore davvero nuovo resta com'è.
const db = require('./db');

const norm = (v) => String(v == null ? '' : v).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const pulito = (v) => String(v == null ? '' : v).trim().replace(/\s+/g, ' ');

function conteggi(slug, key) {
  const c = new Map(); // grafia -> quante volte
  for (const r of db.prepare('SELECT data FROM records WHERE module_slug = ?').all(slug)) {
    let d; try { d = JSON.parse(r.data); } catch (e) { continue; }
    const v = d && typeof d[key] === 'string' ? pulito(d[key]) : '';
    if (v) c.set(v, (c.get(v) || 0) + 1);
  }
  return c;
}

// Campo con `suggerisci_da: { modulo, campo, crea }`: i valori ammessi stanno in un altro modulo (es. i Fornitori). `crea`: un valore nuovo vi si aggiunge da solo.
const sorgente = (f) => (f && f.suggerisci_da && f.suggerisci_da.modulo && f.suggerisci_da.campo ? f.suggerisci_da : null);

function dallaLista(src) {
  const out = [];
  for (const r of db.prepare('SELECT data FROM records WHERE module_slug = ?').all(src.modulo)) {
    let d; try { d = JSON.parse(r.data); } catch (e) { continue; }
    const v = d && typeof d[src.campo] === 'string' ? pulito(d[src.campo]) : '';
    if (v) out.push(v);
  }
  return out;
}

// [{ valore, n }]: prima i valori della lista (se il campo ne ha una), poi quelli già usati, dal più usato; a parità, in ordine alfabetico.
function valoriUsati(slug, key, f) {
  const usati = [...conteggi(slug, key)].map(([valore, n]) => ({ valore, n })).sort((a, b) => b.n - a.n || a.valore.localeCompare(b.valore));
  const src = sorgente(f);
  if (!src) return usati;
  const lista = [...new Set(dallaLista(src))].sort((a, b) => a.localeCompare(b)).map((valore) => ({ valore, n: 0, lista: true }));
  const visti = new Set(lista.map((x) => norm(x.valore)));
  return [...lista, ...usati.filter((x) => !visti.has(norm(x.valore)))];
}

// Riporta `v` alla grafia della lista o, in mancanza, alla più usata tra quelle equivalenti. Un valore nuovo: resta com'è (ripulito dagli spazi) e, se il campo
// ha `crea`, si aggiunge alla lista. `utente` = chi salva (proprietario del nuovo elemento).
function allineaValore(slug, key, v, f, utente) {
  const nuovo = pulito(v);
  const n = norm(nuovo);
  if (!n) return nuovo;
  const tutti = valoriUsati(slug, key, f);
  const dalla = tutti.find((x) => x.lista && norm(x.valore) === n);
  if (dalla) return dalla.valore;
  const equivalenti = tutti.filter((x) => norm(x.valore) === n);
  if (equivalenti.length) return equivalenti[0].valore;
  const src = sorgente(f);
  if (src && src.crea && db.prepare('SELECT 1 FROM modules WHERE slug = ? AND installed = 1').get(src.modulo)) {
    db.prepare('INSERT INTO records (module_slug, user_id, data) VALUES (?, ?, ?)').run(src.modulo, utente || null, JSON.stringify({ [src.campo]: nuovo }));
  }
  return nuovo;
}

// Applica `allineaValore` a ogni campo del modulo con `suggerisci`; ritorna i dati (gli stessi se non c'è niente da fare).
function allinea(slug, schema, dati, utente) {
  const campi = ((schema && schema.fields) || []).filter((f) => f && f.suggerisci && f.type === 'text');
  if (!campi.length) return dati;
  let out = dati;
  for (const f of campi) {
    if (typeof dati[f.key] !== 'string' || !dati[f.key].trim()) continue;
    const a = allineaValore(slug, f.key, dati[f.key], f, utente);
    if (a !== dati[f.key]) out = { ...out, [f.key]: a };
  }
  return out;
}

module.exports = { valoriUsati, allineaValore, allinea };
