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

// [{ valore, n }] dal più usato; a parità, in ordine alfabetico.
function valoriUsati(slug, key) {
  return [...conteggi(slug, key)].map(([valore, n]) => ({ valore, n })).sort((a, b) => b.n - a.n || a.valore.localeCompare(b.valore));
}

// Riporta `v` alla grafia più usata tra quelle equivalenti; se non ce ne sono, `v` ripulito dagli spazi.
function allineaValore(slug, key, v) {
  const nuovo = pulito(v);
  const n = norm(nuovo);
  if (!n) return nuovo;
  const equivalenti = valoriUsati(slug, key).filter((x) => norm(x.valore) === n);
  return equivalenti.length ? equivalenti[0].valore : nuovo;
}

// Applica `allineaValore` a ogni campo del modulo con `suggerisci`; ritorna i dati (gli stessi se non c'è niente da fare).
function allinea(slug, schema, dati) {
  const campi = ((schema && schema.fields) || []).filter((f) => f && f.suggerisci && f.type === 'text');
  if (!campi.length) return dati;
  let out = dati;
  for (const f of campi) {
    if (typeof dati[f.key] !== 'string' || !dati[f.key].trim()) continue;
    const a = allineaValore(slug, f.key, dati[f.key]);
    if (a !== dati[f.key]) out = { ...out, [f.key]: a };
  }
  return out;
}

module.exports = { valoriUsati, allineaValore, allinea };
