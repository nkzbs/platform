'use strict';
// Ruoli dei moduli: ogni modulo dichiara a cosa serve (spesa o entrata), quali dei suoi campi sono l'importo, la data, la scadenza...
// e dove "lavora" (riepiloghi, avvisi, mail). Le funzioni (Come sta andando, report su WhatsApp, Gmail) leggono questa
// dichiarazione invece di conoscere nomi di moduli e di campi scritti nel codice. Si modifica dal Builder.
const db = require('./db');

const ROLE_KEYS = ['importo', 'data', 'scadenza', 'categoria', 'descrizione', 'stato', 'gruppo', 'fisso', 'data_pagamento'];
const KINDS = ['spesa', 'entrata'];
const USES = ['riepiloghi', 'avvisi', 'mail'];

db.exec('CREATE TABLE IF NOT EXISTS module_roles (module_slug TEXT PRIMARY KEY, kind TEXT, uses TEXT NOT NULL DEFAULT \'[]\', roles TEXT NOT NULL DEFAULT \'{}\')');
if (!db.prepare('PRAGMA table_info(module_roles)').all().some((c) => c.name === 'extra')) db.exec("ALTER TABLE module_roles ADD COLUMN extra TEXT NOT NULL DEFAULT '{}'");

// Avvisi del modulo (WhatsApp): quali valori del suo stato contano ("nuovo" = da smistare, "da fare" = da pagare/da evadere...),
// quando avvisare, e come chiamare le sue righe nei messaggi. Le funzioni non conoscono nomi di stati scritti nel codice.
// Criteri dei riepiloghi ("Come sta andando") per un modulo di entrate: cosa non conta come entrata, cosa è stipendio, cosa è risparmio.
const DEFAULT_RIEPILOGHI = { exclude_categories: [], exclude_groups: [], exclude_descriptions: [], salary_categories: [], savings_categories: [], savings_field: '' };
// Piano a rate: dove si crea il piano quando una riga si divide in rate (un altro modulo, es. i debiti) e quali suoi campi sono nome, importo totale,
// numero di rate, importo della rata e data della prima. Le righe delle rate le genera l'automazione di quel modulo, come per un piano creato a mano.
const DEFAULT_PIANO = { modulo: '', campi: { nome: '', importo_totale: '', n_rate: '', importo_rata: '', data_prima_rata: '' } };
const DEFAULT_AVVISI = { states: { nuovo: '', da_fare: '', fatto: '' }, piano: DEFAULT_PIANO, nuovo: false, scadenze: false, tag: 'scadenza', label: '', noun_s: 'riga', noun_p: 'righe' };

function parse(row) {
  if (!row) return null;
  let uses = [], roles = {}, extra = {};
  try { uses = JSON.parse(row.uses || '[]'); } catch (e) { /* vuoto */ }
  try { roles = JSON.parse(row.roles || '{}'); } catch (e) { /* vuoto */ }
  try { extra = JSON.parse(row.extra || '{}'); } catch (e) { /* vuoto */ }
  const av = extra.avvisi || (extra.states ? extra : {}); // forma vecchia: extra era direttamente gli avvisi
  return { module_slug: row.module_slug, kind: row.kind || null, uses, roles,
    avvisi: { ...DEFAULT_AVVISI, ...av, states: { ...DEFAULT_AVVISI.states, ...(av.states || {}) }, piano: { ...DEFAULT_PIANO, ...(av.piano || {}), campi: { ...DEFAULT_PIANO.campi, ...((av.piano || {}).campi || {}) } } },
    riepiloghi: { ...DEFAULT_RIEPILOGHI, ...(extra.riepiloghi || {}) } };
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
    states: { nuovo: stateKey(a.states && a.states.nuovo), da_fare: stateKey(a.states && a.states.da_fare), fatto: stateKey(a.states && a.states.fatto) },
    piano: { modulo: stateKey(a.piano && a.piano.modulo), campi: Object.fromEntries(Object.keys(DEFAULT_PIANO.campi).map((k) => [k, stateKey(a.piano && a.piano.campi && a.piano.campi[k])])) },
    nuovo: !!a.nuovo, scadenze: !!a.scadenze,
    tag: word(a.tag, 'scadenza', 40).replace(/[^A-Za-z0-9_\-]/g, '') || 'scadenza',
    label: word(a.label, '', 20), noun_s: word(a.noun_s, 'riga', 30), noun_p: word(a.noun_p, 'righe', 30),
  };
  const rp = (input && input.riepiloghi) || {};
  const list = (v) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []).map((x) => String(x).trim().slice(0, 60)).filter(Boolean).slice(0, 30);
  const riepiloghi = {
    exclude_categories: list(rp.exclude_categories), exclude_groups: list(rp.exclude_groups), exclude_descriptions: list(rp.exclude_descriptions),
    salary_categories: list(rp.salary_categories), savings_categories: list(rp.savings_categories),
    savings_field: typeof rp.savings_field === 'string' && /^[A-Za-z0-9_]{1,60}$/.test(rp.savings_field.trim()) ? rp.savings_field.trim() : '',
  };
  return { kind, uses, roles, avvisi, riepiloghi };
}

function set(slug, input) {
  const c = clean(input);
  db.prepare('INSERT INTO module_roles (module_slug, kind, uses, roles, extra) VALUES (?, ?, ?, ?, ?) ON CONFLICT(module_slug) DO UPDATE SET kind = excluded.kind, uses = excluded.uses, roles = excluded.roles, extra = excluded.extra')
    .run(slug, c.kind, JSON.stringify(c.uses), JSON.stringify(c.roles), JSON.stringify({ avvisi: c.avvisi, riepiloghi: c.riepiloghi }));
  return get(slug);
}

// Valori di partenza per i moduli di finanza che esistono già: gli stessi nomi che le funzioni usavano prima, così per chi li ha
// già niente cambia. Si scrivono solo dove non c'è ancora una dichiarazione (una scelta fatta dal Builder non si tocca).
const PIANO_FINANCE = { nome: 'nome', importo_totale: 'importo_totale', n_rate: 'n_rate', importo_rata: 'importo_rata', data_prima_rata: 'data_prima_rata' };
const FINANCE = {
  spese_personali: { kind: 'spesa', uses: ['riepiloghi', 'avvisi', 'mail'], roles: { importo: 'importo', data: 'data', scadenza: 'scadenza', categoria: 'categoria', descrizione: 'descrizione', stato: '_stato', fisso: 'fisso', data_pagamento: 'data_pagamento' },
    avvisi: { states: { nuovo: 'da_smistare', da_fare: 'da_pagare', fatto: 'pagato' }, piano: { modulo: 'debiti_personali', campi: PIANO_FINANCE }, nuovo: true, scadenze: true, tag: 'scadenza', label: 'pers.', noun_s: 'bolletta', noun_p: 'bollette' } },
  spese_casa: { kind: 'spesa', uses: ['avvisi', 'mail'], roles: { importo: 'importo', data: 'data', scadenza: 'scadenza', categoria: 'categoria', descrizione: 'descrizione', stato: '_stato', fisso: 'fisso', data_pagamento: 'data_pagamento' },
    avvisi: { states: { nuovo: 'da_smistare', da_fare: 'da_pagare', fatto: 'pagato' }, piano: { modulo: 'debiti_casa', campi: PIANO_FINANCE }, nuovo: true, scadenze: true, tag: 'scadenza', label: 'casa', noun_s: 'bolletta', noun_p: 'bollette' } },
  entrate: { kind: 'entrata', uses: ['riepiloghi'], roles: { importo: 'importo', data: 'data', categoria: 'categoria', descrizione: 'descrizione', gruppo: 'gruppo' },
    riepiloghi: { exclude_categories: ['Risparmi', 'Fondo'], exclude_groups: ['Casa'], exclude_descriptions: ['Saldo conto'], salary_categories: ['Stipendio'], savings_categories: ['Fondo'], savings_field: 'accantonamento_suggerito' } },
};
function seedIfEmpty() {
  let n = 0;
  for (const [slug, cfg] of Object.entries(FINANCE)) {
    if (!db.prepare('SELECT 1 FROM modules WHERE slug = ?').get(slug)) continue;
    if (get(slug)) continue;
    set(slug, cfg); n++;
  }
  // Moduli di finanza dichiarati prima degli "Avvisi" e dei criteri dei riepiloghi: prendono i valori di prima, una sola volta
  // (una scelta già fatta, anche "tutto spento", non si tocca: si guarda se il campo è mai stato scritto).
  for (const [slug, cfg] of Object.entries(FINANCE)) {
    const cur = get(slug);
    const raw = db.prepare('SELECT extra FROM module_roles WHERE module_slug = ?').get(slug);
    if (!cur || !raw) continue;
    let parsed = {}; try { parsed = JSON.parse(raw.extra || '{}'); } catch (e) { /* vuoto */ }
    const needAvvisi = cfg.avvisi && !parsed.avvisi && !parsed.states;
    const needRiep = cfg.riepiloghi && !parsed.riepiloghi;
    // dichiarato prima del piano a rate: si aggiungono stato "fatto", piano e campo data di pagamento
    const avOld = parsed.avvisi || (parsed.states ? parsed : null); // forma vecchia: extra era direttamente gli avvisi
    const needPiano = cfg.avvisi && cfg.avvisi.piano && avOld && !('piano' in avOld);
    if (!(needAvvisi || needRiep || needPiano)) continue;
    let avvisi = needAvvisi ? cfg.avvisi : cur.avvisi, roles = cur.roles;
    if (needPiano) {
      avvisi = { ...avvisi, states: { ...avvisi.states, fatto: cfg.avvisi.states.fatto }, piano: cfg.avvisi.piano };
      roles = { ...roles, data_pagamento: roles.data_pagamento || cfg.roles.data_pagamento };
    }
    set(slug, { kind: cur.kind, uses: cur.uses, roles, avvisi, riepiloghi: needRiep ? cfg.riepiloghi : cur.riepiloghi }); n++;
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
