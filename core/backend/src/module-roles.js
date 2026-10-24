'use strict';
// Ruoli dei moduli: ogni modulo dichiara a cosa serve (spesa, entrata o presenze/timbrature), quali dei suoi campi sono l'importo, la data, la scadenza...
// e dove "lavora" (riepiloghi, avvisi, mail). Le funzioni (Come sta andando, report su WhatsApp, Gmail) leggono questa
// dichiarazione invece di conoscere nomi di moduli e di campi scritti nel codice. Si modifica dal Builder.
const db = require('./db');

// presenze = timbrature: un modulo con una data, un'ora di inizio (entrata) e una di fine (uscita); ruoli `inizio` e `fine`.
// bustapaga = una riga al mese con quanto scritto in busta (lordo, netto, ore pagate, trattenute); ruoli `lordo`, `netto`, `ore_pagate`, `trattenute` (`data` = il mese).
// `pagato_da`: su un modulo di spesa condivisa (un "pot" tra più persone), il campo che dice chi ha pagato quella riga
// direttamente di tasca propria invece che dal conto comune — solo chi lo dichiara entra nel saldo dei contributi (debito-casa.js).
const ROLE_KEYS = ['importo', 'data', 'scadenza', 'categoria', 'descrizione', 'stato', 'gruppo', 'fisso', 'data_pagamento', 'note', 'data_incerta', 'debito', 'inizio', 'fine', 'lordo', 'netto', 'ore_pagate', 'trattenute', 'pagato_da'];
// pratica = una riga con stati e (se serve) una scadenza, senza essere denaro (ticket, ordini, scadenzario, manutenzioni…): entra negli avvisi e nei report, non nei riepiloghi di spese ed entrate.
const KINDS = ['spesa', 'entrata', 'presenze', 'pratica', 'bustapaga'];
const USES = ['riepiloghi', 'avvisi', 'mail', 'estratto'];

db.exec('CREATE TABLE IF NOT EXISTS module_roles (module_slug TEXT PRIMARY KEY, kind TEXT, uses TEXT NOT NULL DEFAULT \'[]\', roles TEXT NOT NULL DEFAULT \'{}\')');
if (!db.prepare('PRAGMA table_info(module_roles)').all().some((c) => c.name === 'extra')) db.exec("ALTER TABLE module_roles ADD COLUMN extra TEXT NOT NULL DEFAULT '{}'");

// Avvisi del modulo (WhatsApp): quali valori del suo stato contano ("nuovo" = da smistare, "da fare" = da pagare/da evadere...),
// quando avvisare, e come chiamare le sue righe nei messaggi. Le funzioni non conoscono nomi di stati scritti nel codice.
// Criteri dei riepiloghi ("Come sta andando") per un modulo di entrate: cosa non conta come entrata, cosa è stipendio, cosa è risparmio.
const DEFAULT_RIEPILOGHI = { exclude_categories: [], exclude_groups: [], exclude_descriptions: [], salary_categories: [], savings_categories: [], rate_categories: [], savings_field: '' };
// Piano a rate: dove si crea il piano quando una riga si divide in rate (un altro modulo, es. i debiti) e quali suoi campi sono nome, importo totale,
// numero di rate, importo della rata e data della prima. Le righe delle rate le genera l'automazione di quel modulo, come per un piano creato a mano.
const DEFAULT_PIANO = { modulo: '', campi: { nome: '', importo_totale: '', n_rate: '', importo_rata: '', data_prima_rata: '' } };
// Estratto conto: il modulo entra nell'abbinamento dei movimenti bancari (uso «estratto»). `giro_categories` = categorie che rappresentano un giro tra conti
// propri (si abbinano ai giri interni, non alle spese), `registra` = qui si registrano le uscite dell'estratto che non hanno ancora una riga, `categoria_default`
// = categoria di una riga registrata dall'estratto se non se ne sceglie un'altra.
// versione della dichiarazione: ogni salvataggio scrive la corrente; i valori di partenza nuovi (ruoli aggiunti dopo) si completano una volta sola, sulle dichiarazioni più vecchie
const SCHEMA_V = 2;
const DEFAULT_ESTRATTO = { giro_categories: [], registra: false, categoria_default: '' };
const DEFAULT_AVVISI = { states: { nuovo: '', da_fare: '', fatto: '' }, piano: DEFAULT_PIANO, nuovo: false, scadenze: false, tag: 'scadenza', label: '', noun_s: 'riga', noun_p: 'righe' };

function parse(row) {
  if (!row) return null;
  let uses = [], roles = {}, extra = {};
  try { uses = JSON.parse(row.uses || '[]'); } catch (e) { /* vuoto */ }
  try { roles = JSON.parse(row.roles || '{}'); } catch (e) { /* vuoto */ }
  try { extra = JSON.parse(row.extra || '{}'); } catch (e) { /* vuoto */ }
  const av = extra.avvisi || (extra.states ? extra : {}); // forma vecchia: extra era direttamente gli avvisi
  return { module_slug: row.module_slug, kind: row.kind || null, uses, roles, owner_user_id: Number.isInteger(extra.owner_user_id) && extra.owner_user_id > 0 ? extra.owner_user_id : null,
    avvisi: { ...DEFAULT_AVVISI, ...av, states: { ...DEFAULT_AVVISI.states, ...(av.states || {}) }, piano: { ...DEFAULT_PIANO, ...(av.piano || {}), campi: { ...DEFAULT_PIANO.campi, ...((av.piano || {}).campi || {}) } } },
    riepiloghi: { ...DEFAULT_RIEPILOGHI, ...(extra.riepiloghi || {}) },
    estratto: { ...DEFAULT_ESTRATTO, ...(extra.estratto || {}) } };
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
    salary_categories: list(rp.salary_categories), savings_categories: list(rp.savings_categories), rate_categories: list(rp.rate_categories),
    savings_field: typeof rp.savings_field === 'string' && /^[A-Za-z0-9_]{1,60}$/.test(rp.savings_field.trim()) ? rp.savings_field.trim() : '',
  };
  const es = (input && input.estratto) || {};
  const estratto = { giro_categories: list(es.giro_categories), registra: !!es.registra, categoria_default: word(es.categoria_default, '', 60) };
  const ow = input && input.owner_user_id;
  const owner_user_id = ow === undefined ? undefined : (Number.isInteger(Number(ow)) && Number(ow) > 0 ? Number(ow) : null); // undefined = non indicato: si conserva quello che c'è
  return { kind, uses, roles, avvisi, riepiloghi, estratto, owner_user_id };
}

function set(slug, input) {
  const c = clean(input);
  if (c.owner_user_id === undefined) { const cur = get(slug); c.owner_user_id = cur ? cur.owner_user_id : null; }
  db.prepare('INSERT INTO module_roles (module_slug, kind, uses, roles, extra) VALUES (?, ?, ?, ?, ?) ON CONFLICT(module_slug) DO UPDATE SET kind = excluded.kind, uses = excluded.uses, roles = excluded.roles, extra = excluded.extra')
    .run(slug, c.kind, JSON.stringify(c.uses), JSON.stringify(c.roles), JSON.stringify({ v: SCHEMA_V, owner_user_id: c.owner_user_id, avvisi: c.avvisi, riepiloghi: c.riepiloghi, estratto: c.estratto }));
  return get(slug);
}

// Valori di partenza per i moduli di finanza che esistono già (dati in seeds/finance-roles.json: nomi di moduli e di campi stanno lì, non nel codice):
// gli stessi nomi che le funzioni usavano prima, così per chi li ha già niente cambia. Si scrivono solo dove non c'è ancora una dichiarazione
// (una scelta fatta dal Builder non si tocca).
const FINANCE = require('./seeds/finance-roles.json');
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
    // dichiarato prima dell'estratto conto: si aggiungono l'uso «estratto» e le sue scelte, e il campo note
    const needEstratto = cfg.estratto && !parsed.estratto;
    // ruoli aggiunti dopo (note, data incerta, debito) e categorie «rata»: si completano solo se mancano (una scelta già fatta non si tocca)
    const vecchia = (parsed.v || 0) < SCHEMA_V;
    const nuoviRuoli = vecchia ? ['note', 'data_incerta', 'debito'].filter((k) => cfg.roles[k] && !cur.roles[k]) : [];
    const needRate = vecchia && cfg.riepiloghi && cfg.riepiloghi.rate_categories && parsed.riepiloghi && !('rate_categories' in parsed.riepiloghi);
    if (!(needAvvisi || needRiep || needPiano || needEstratto || nuoviRuoli.length || needRate)) continue;
    let avvisi = needAvvisi ? cfg.avvisi : cur.avvisi, roles = cur.roles;
    if (needPiano) {
      avvisi = { ...avvisi, states: { ...avvisi.states, fatto: cfg.avvisi.states.fatto }, piano: cfg.avvisi.piano };
      roles = { ...roles, data_pagamento: roles.data_pagamento || cfg.roles.data_pagamento };
    }
    let uses = cur.uses;
    if (needEstratto) {
      if (!uses.includes('estratto') && (cfg.uses || []).includes('estratto')) uses = [...uses, 'estratto'];
    }
    for (const k of nuoviRuoli) roles = { ...roles, [k]: cfg.roles[k] };
    let riepiloghi = needRiep ? cfg.riepiloghi : cur.riepiloghi;
    if (needRate) riepiloghi = { ...riepiloghi, rate_categories: cfg.riepiloghi.rate_categories };
    set(slug, { kind: cur.kind, uses, roles, avvisi, riepiloghi, estratto: needEstratto ? cfg.estratto : cur.estratto }); n++;
  }
  return n;
}

module.exports = { ROLE_KEYS, KINDS, USES, get, list, field, set, clean, seedIfEmpty };
