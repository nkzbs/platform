'use strict';
// Ruoli dei moduli: ogni modulo dichiara a cosa serve (spesa o entrata), quali dei suoi campi sono l'importo, la data, la scadenza...
// e dove "lavora" (riepiloghi, avvisi, mail). Le funzioni (Come sta andando, riepilogo del mattino, Gmail) leggono questa
// dichiarazione invece di conoscere nomi di moduli e di campi scritti nel codice. Si modifica dal Builder.
const db = require('./db');

const ROLE_KEYS = ['importo', 'data', 'scadenza', 'categoria', 'descrizione', 'stato', 'gruppo', 'fisso'];
const KINDS = ['spesa', 'entrata'];
const USES = ['riepiloghi', 'avvisi', 'mail'];

db.exec('CREATE TABLE IF NOT EXISTS module_roles (module_slug TEXT PRIMARY KEY, kind TEXT, uses TEXT NOT NULL DEFAULT \'[]\', roles TEXT NOT NULL DEFAULT \'{}\')');
if (!db.prepare('PRAGMA table_info(module_roles)').all().some((c) => c.name === 'extra')) db.exec("ALTER TABLE module_roles ADD COLUMN extra TEXT NOT NULL DEFAULT '{}'");

// Avvisi del modulo (WhatsApp): quali valori del suo stato contano ("nuovo" = da smistare, "da fare" = da pagare/da evadere...),
// quando avvisare, e come chiamare le sue righe nei messaggi. Le funzioni non conoscono nomi di stati scritti nel codice.
const DEFAULT_AVVISI = { states: { nuovo: '', da_fare: '' }, nuovo: false, scadenze: false, tag: 'scadenza', label: '', noun_s: 'riga', noun_p: 'righe' };

function parse(row) {
  if (!row) return null;
  let uses = [], roles = {}, extra = {};
  try { uses = JSON.parse(row.uses || '[]'); } catch (e) { /* vuoto */ }
  try { roles = JSON.parse(row.roles || '{}'); } catch (e) { /* vuoto */ }
  try { extra = JSON.parse(row.extra || '{}'); } catch (e) { /* vuoto */ }
  return { module_slug: row.module_slug, kind: row.kind || null, uses, roles, avvisi: { ...DEFAULT_AVVISI, ...extra, states: { ...DEFAULT_AVVISI.states, ...(extra.states || {}) } } };
}

function get(slug) { return parse(db.prepare('SELECT * FROM module_roles WHERE module_slug = ?').get(slug)); }

// Moduli installati con un tipo (e, se dato, che lavorano in quell'uso), con nome e ruoli.
function list({ kind, use } = {}) {
  const rows = db.prepare('SELECT r.*, m.name AS name FROM module_roles r JOIN modules m ON m.slug = r.module_slug WHERE m.installed = 1 ORDER BY m.sort_order, m.id').all();
  return rows.map((r) => ({ ...parse(r), name: r.name })).filter((r) => r.kind && (!kind || r.kind === kind) && (!use || r.uses.includes(use)));
}

// Nome del campo che ha un dato ruolo in un modulo, o null se il ruolo non è assegnato.
function field(slug, role) { const r = get(slug); return (r && r.roles[role]) || null; }

function clean(input) {
  const kind = KINDS.includes(input && input.kind) ? input.kind : null;
  const uses = Array.isArray(input && input.uses) ? [...new Set(input.uses.filter((u) => USES.includes(u)))] : [];
  const roles = {};
  for (const k of ROLE_KEYS) { const v = input && input.roles && input.roles[k]; if (typeof v === 'string' && /^[A-Za-z0-9_]{1,60}$/.test(v.trim())) roles[k] = v.trim(); }
  const a = (input && input.avvisi) || {};
  const word = (v, d, n) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : d);
  const stateKey = (v) => (typeof v === 'string' && /^[A-Za-z0-9_]{1,60}$/.test(v.trim()) ? v.trim() : '');
  const avvisi = {
    states: { nuovo: stateKey(a.states && a.states.nuovo), da_fare: stateKey(a.states && a.states.da_fare) },
    nuovo: !!a.nuovo, scadenze: !!a.scadenze,
    tag: word(a.tag, 'scadenza', 40).replace(/[^A-Za-z0-9_\-]/g, '') || 'scadenza',
    label: word(a.label, '', 20), noun_s: word(a.noun_s, 'riga', 30), noun_p: word(a.noun_p, 'righe', 30),
  };
  return { kind, uses, roles, avvisi };
}

function set(slug, input) {
  const c = clean(input);
  db.prepare('INSERT INTO module_roles (module_slug, kind, uses, roles, extra) VALUES (?, ?, ?, ?, ?) ON CONFLICT(module_slug) DO UPDATE SET kind = excluded.kind, uses = excluded.uses, roles = excluded.roles, extra = excluded.extra')
    .run(slug, c.kind, JSON.stringify(c.uses), JSON.stringify(c.roles), JSON.stringify(c.avvisi));
  return get(slug);
}

// Valori di partenza per i moduli di finanza che esistono già: gli stessi nomi che le funzioni usavano prima, così per chi li ha
// già niente cambia. Si scrivono solo dove non c'è ancora una dichiarazione (una scelta fatta dal Builder non si tocca).
const FINANCE = {
  spese_personali: { kind: 'spesa', uses: ['riepiloghi', 'avvisi', 'mail'], roles: { importo: 'importo', data: 'data', scadenza: 'scadenza', categoria: 'categoria', descrizione: 'descrizione', stato: '_stato', fisso: 'fisso' },
    avvisi: { states: { nuovo: 'da_smistare', da_fare: 'da_pagare' }, nuovo: true, scadenze: true, tag: 'scadenza', label: 'pers.', noun_s: 'bolletta', noun_p: 'bollette' } },
  spese_casa: { kind: 'spesa', uses: ['avvisi', 'mail'], roles: { importo: 'importo', data: 'data', scadenza: 'scadenza', categoria: 'categoria', descrizione: 'descrizione', stato: '_stato', fisso: 'fisso' },
    avvisi: { states: { nuovo: 'da_smistare', da_fare: 'da_pagare' }, nuovo: true, scadenze: true, tag: 'scadenza', label: 'casa', noun_s: 'bolletta', noun_p: 'bollette' } },
  entrate: { kind: 'entrata', uses: ['riepiloghi'], roles: { importo: 'importo', data: 'data', categoria: 'categoria', descrizione: 'descrizione', gruppo: 'gruppo' } },
};
function seedIfEmpty() {
  let n = 0;
  for (const [slug, cfg] of Object.entries(FINANCE)) {
    if (!db.prepare('SELECT 1 FROM modules WHERE slug = ?').get(slug)) continue;
    if (get(slug)) continue;
    set(slug, cfg); n++;
  }
  // Moduli di finanza dichiarati prima degli "Avvisi": prendono i valori di prima (una scelta già fatta non si tocca).
  for (const [slug, cfg] of Object.entries(FINANCE)) {
    const cur = get(slug);
    const raw = db.prepare('SELECT extra FROM module_roles WHERE module_slug = ?').get(slug);
    // solo se gli avvisi non sono mai stati scritti (extra vuoto): chi li ha spenti apposta non li ritrova accesi al riavvio
    if (cur && cfg.avvisi && raw && (raw.extra || '{}') === '{}') {
      set(slug, { kind: cur.kind, uses: cur.uses, roles: cur.roles, avvisi: cfg.avvisi }); n++;
    }
  }
  // Le regole Gmail fatte prima della scelta del modulo: si agganciano al modulo che usavano (Casa -> spese_casa, il resto -> spese_personali).
  try {
    for (const [gruppo, slug] of [['Casa', 'spese_casa'], ['Personale', 'spese_personali']]) {
      if (db.prepare('SELECT 1 FROM modules WHERE slug = ?').get(slug)) db.prepare("UPDATE gmail_rules SET modulo = ? WHERE (modulo IS NULL OR modulo = '') AND gruppo = ?").run(slug, gruppo);
    }
  } catch (e) { /* tabella non pronta */ }
  return n;
}

module.exports = { ROLE_KEYS, KINDS, USES, get, list, field, set, clean, seedIfEmpty };
