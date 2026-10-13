'use strict';
// «Collega i moduli»: propone le relazioni mancanti tra i moduli installati e, se l'utente conferma, le crea.
// Le proposte sono regole sui NOMI (nessun settore nel codice): il nome di un modulo contenuto nel nome di un altro («Righe ordine» → «Ordini»)
// oppure un campo di testo che si chiama come un altro modulo («Cliente» → «Clienti»). Chi applica NON si fida di quello che gli arriva: da/a,
// chiave, etichetta e campo da mostrare si ricalcolano qui; niente si sovrascrive e un collegamento già presente non si duplica.
const db = require('./db');
const { parseSchemaNormalized, isV3 } = require('./schema-v3');
const { logAudit } = require('./audit-log');

const STOP = new Set(['di', 'del', 'della', 'dei', 'delle', 'degli', 'dello', 'da', 'e', 'ed', 'il', 'la', 'le', 'lo', 'i', 'gli', 'un', 'una', 'per', 'in', 'a', 'generico', 'generica', 'nuovo', 'nuova']);
const MAX_PER_MODULE = 6;

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
// Radice di una parola: senza vocale finale, così «cliente», «clienti» e «cliente» coincidono (singolare/plurale italiano).
const stem = (w) => w.replace(/[aeio]+$/, '');
const stems = (s) => norm(s).split(/[^a-z0-9]+/).filter((w) => w && !STOP.has(w)).map(stem).filter((w) => w.length >= 3);

function parse(row) { try { return JSON.parse(row.schema_json_draft || row.schema_json || '{}'); } catch (e) { return {}; } }

function carica() {
  return db.prepare('SELECT id, name, slug, registry_slug, schema_json, schema_json_draft, schema_version FROM modules WHERE installed = 1 AND COALESCE(is_system, 0) = 0').all().map((m) => {
    let s = {}; try { s = parseSchemaNormalized(m.schema_json_draft || m.schema_json); } catch (e) { /* schema illeggibile: nessun campo */ }
    return { ...m, fields: s.fields || [], relations: s.relations || [] };
  });
}

const mostra = (m) => {
  const testo = m.fields.filter((f) => f.type === 'text' || f.type === 'textarea');
  return (testo.find((f) => /nome|ragione|titolo|name|descrizione|targa|codice/.test(norm(f.key))) || testo[0] || m.fields[0] || {}).key || null;
};
const giaCollegati = (a, b) => a.relations.some((r) => r.target_module === b.slug || (b.registry_slug && r.target_module === b.registry_slug));
const chiaveLibera = (a, base) => {
  const usate = new Set([...a.fields.map((f) => f.key), ...a.relations.map((r) => r.key)]);
  let k = ('rel_' + base).replace(/[^a-zA-Z0-9_]/g, '_').replace(/^_+|_+$/g, ''), n = 2; const k0 = k;
  while (usate.has(k)) k = k0 + '_' + n++;
  return k;
};

function proposte() {
  const mods = carica(), out = [];
  const sNome = new Map(mods.map((m) => [m.slug, stems(m.name + ' ' + m.slug.replace(/_/g, ' '))]));
  const nomeSolo = new Map(mods.map((m) => [m.slug, stems(m.name)]));
  for (const a of mods) {
    const mine = [];
    for (const b of mods) {
      if (a.slug === b.slug || giaCollegati(a, b) || !mostra(b)) continue;
      const sb = nomeSolo.get(b.slug), sa = nomeSolo.get(a.slug);
      if (!sb.length) continue;
      let motivo = null;
      // R1: il nome di B è contenuto nel nome di A, che ha qualcosa in più («Righe ordine» contiene «Ordini»)
      if (sa.length > sb.length && sb.every((w) => sa.includes(w))) motivo = 'il nome contiene «' + b.name + '»';
      // R2: A ha un campo di testo che si chiama come B
      if (!motivo) {
        const f = a.fields.find((x) => (x.type === 'text' || !x.type) && (() => { const sf = stems(x.label || x.key); return sf.length && sb.length && sb.every((w) => sf.includes(w)); })());
        if (f) motivo = 'ha già il campo «' + (f.label || f.key) + '» (resta com\'è, lo puoi togliere dal Builder)';
      }
      if (!motivo) continue;
      // se B contiene A per R1 è la direzione opposta a quella che stiamo valutando: già coperta quando A e B si scambiano
      if (sb.length > sa.length && sa.every((w) => sb.includes(w))) continue;
      mine.push({ da: a.slug, da_nome: a.name, a: b.slug, a_nome: b.name, motivo });
    }
    out.push(...mine.slice(0, MAX_PER_MODULE));
  }
  return out;
}

// links: [{ da, a }]. Ritorna { creati: [{da,a,key}], saltati: [{da,a,motivo}] }.
function applica(links, actor) { // actor = { id, username }
  const creati = [], saltati = [];
  for (const l of (Array.isArray(links) ? links : []).slice(0, 100)) {
    const mods = carica();
    const a = mods.find((m) => m.slug === (l && l.da)), b = mods.find((m) => m.slug === (l && l.a));
    const salta = (motivo) => saltati.push({ da: l && l.da, a: l && l.a, motivo });
    if (!a || !b) { salta('modulo non trovato'); continue; }
    if (a.slug === b.slug) { salta('un modulo non si collega a sé stesso'); continue; }
    if (giaCollegati(a, b)) { salta('già collegati'); continue; }
    const campo = mostra(b);
    if (!campo) { salta('il modulo collegato non ha campi da mostrare'); continue; }
    const row = db.prepare('SELECT * FROM modules WHERE id = ?').get(a.id);
    const schema = parse(row);
    const key = chiaveLibera(a, b.slug);
    const rel = { key, label: b.name, type: 'many_to_one', target_module: b.slug, display_mode: 'select_inline', display_field: campo };
    if (isV3(schema)) { schema.steps = [...(schema.steps || []), { id: 'rel_' + Math.random().toString(36).slice(2, 8), block_type: 'relation', ...rel }]; }
    else schema.relations = [...(schema.relations || []), rel];
    const nuovo = JSON.stringify(schema);
    db.prepare('INSERT INTO modules_schema_history (module_id, schema_json, version, published_by) VALUES (?, ?, ?, ?)').run(row.id, row.schema_json, row.schema_version, actor.id || null);
    db.prepare('UPDATE modules SET schema_json = ?, schema_json_draft = NULL, schema_version = schema_version + 1, published_at = CURRENT_TIMESTAMP WHERE id = ?').run(nuovo, row.id);
    logAudit(actor.username, 'module.link', a.slug, { a: b.slug, key });
    creati.push({ da: a.slug, a: b.slug, key });
  }
  return { creati, saltati };
}

module.exports = { proposte, applica, stems };
