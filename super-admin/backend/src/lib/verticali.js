'use strict';
// I verticali proposti ai tenant: punti di partenza (un nome, un'icona, un gruppo di moduli della Libreria che funzionano insieme), non codice.
// Stanno nella tabella registry_verticals e si gestiscono da Libreria; al primo avvio la tabella si riempie da seeds/verticali.json (mai sovrascrive: «ripristina»
// aggiunge solo quelli che mancano per nome). Qui si risolvono sui moduli che la Libreria ha davvero (ultima versione di ogni slug): un modulo che non c'è si salta,
// un verticale con meno di due moduli non si propone al tenant. Il tenant li installa con l'installazione multipla, poi collega e modifica.
const db = require('../db');
const SEED = require('../seeds/verticali.json');
const { scheda } = require('./guida');

const slugsDi = (row) => { try { const a = JSON.parse(row.module_slugs); return Array.isArray(a) ? a : []; } catch (e) { return []; } };

// Aggiunge i verticali della seed che non ci sono (stesso nome). Ritorna quanti ne ha aggiunti.
function ripristinaPredefiniti() {
  const have = new Set(db.prepare('SELECT name FROM registry_verticals').all().map((r) => r.name));
  const ins = db.prepare('INSERT INTO registry_verticals (name, icon, description, module_slugs, sort_order) VALUES (?, ?, ?, ?, ?)');
  let n = 0;
  db.transaction(() => { SEED.forEach((v, i) => { if (!have.has(v.nome)) { ins.run(v.nome, v.icona, v.descrizione, JSON.stringify(v.moduli), i); n++; } }); })();
  return n;
}
if (db.prepare('SELECT COUNT(*) c FROM registry_verticals').get().c === 0) ripristinaPredefiniti();

function perSlug() {
  const ultimo = db.prepare('SELECT id, name, slug, description, group_name, schema_json FROM registry_modules rm WHERE version = (SELECT MAX(version) FROM registry_modules x WHERE x.slug = rm.slug AND x.source_tenant_slug IS rm.source_tenant_slug) ORDER BY (source_tenant_slug = \'generici\') DESC, id');
  const m = new Map();
  for (const r of ultimo.all()) if (!m.has(r.slug)) m.set(r.slug, r);
  return m;
}

// Per i tenant: solo i verticali con almeno due moduli veri, con la guida all'uso.
function elenco() {
  const nomi = perSlug();
  return db.prepare('SELECT * FROM registry_verticals ORDER BY sort_order, id').all().map((v) => {
    const righe = slugsDi(v).map((s) => nomi.get(s)).filter(Boolean);
    const schede = righe.map((m) => scheda(m, nomi));
    return {
      id: v.id, name: v.name, icon: v.icon || 'box', description: v.description || '',
      moduli: righe.map((m) => ({ id: m.id, slug: m.slug, name: m.name, description: m.description || '' })),
      guida: guida(righe, schede),
    };
  }).filter((v) => v.moduli.length >= 2);
}

// Per chi li gestisce (Super Admin): tutti, anche quelli con moduli che non esistono più, con l'elenco degli slug e quali mancano.
function perGestione() {
  const nomi = perSlug();
  return db.prepare('SELECT * FROM registry_verticals ORDER BY sort_order, id').all().map((v) => {
    const slugs = slugsDi(v);
    return { id: v.id, name: v.name, icon: v.icon || 'box', description: v.description || '', module_slugs: slugs, moduli: slugs.map((s) => ({ slug: s, name: (nomi.get(s) || {}).name || s, mancante: !nomi.has(s) })), mancanti: slugs.filter((s) => !nomi.has(s)).length };
  });
}

function leggi(body, corrente) {
  const b = body || {}, c = corrente || {};
  const name = String(b.name != null ? b.name : (c.name || '')).trim().slice(0, 60);
  const src = Array.isArray(b.module_slugs) ? b.module_slugs : (corrente ? slugsDi(corrente) : []);
  const slugs = [...new Set(src.map((x) => String(x).trim()).filter(Boolean))].slice(0, 100);
  return { name, icon: String(b.icon != null ? b.icon : (c.icon || 'box')).slice(0, 40), description: String(b.description != null ? b.description : (c.description || '')).trim().slice(0, 400), slugs };
}

// Come si usa un verticale, dai suoi moduli: da dove cominciare (prima ciò a cui gli altri si collegano), cosa fa e cosa si compila in ognuno.
// Nessun testo da settore: ordine e collegamenti vengono dalle relazioni degli schemi, i nomi e le descrizioni dai moduli.
function guida(righe, schede) {
  const slugs = new Set(righe.map((m) => m.slug));
  const dipende = new Map(righe.map((m, i) => [m.slug, schede[i].collegamentiSlug.filter((t) => slugs.has(t) && t !== m.slug)]));
  const fatti = new Set(), ordine = [];
  for (let giro = 0; giro < righe.length && ordine.length < righe.length; giro++) {
    for (const m of righe) if (!fatti.has(m.slug) && dipende.get(m.slug).every((t) => fatti.has(t))) { fatti.add(m.slug); ordine.push(m.slug); }
  }
  for (const m of righe) if (!fatti.has(m.slug)) ordine.push(m.slug); // collegamenti circolari: in coda, nell'ordine di partenza
  const per = new Map(righe.map((m, i) => [m.slug, { m, s: schede[i] }]));
  return {
    ordine: ordine.map((slug) => per.get(slug).m.name),
    moduli: ordine.map((slug) => { const { s } = per.get(slug); return { nome: s.nome, descrizione: s.descrizione, campi: s.campi, stati: s.stati, collegamenti: s.collegamenti }; }),
  };
}

module.exports = { elenco, perGestione, leggi, ripristinaPredefiniti, SEED };
