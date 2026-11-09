'use strict';
// Una Dashboard di base scritta dai moduli del tenant: «Da fare» (scadenze di tutti i moduli), un numero per i moduli principali, il percorso degli stati dei moduli con un flusso e un «Da sistemare»
// con le scadenze passate. Serve a un tenant appena nato (dall'analisi) per non aprirsi su una pagina vuota; poi si ritocca come ogni Dashboard (Modifica layout). Non tocca una Dashboard già fatta.
// Nessun nome di settore: tutto si ricava da schemi (stati, campi data con «scad» nel nome).
const db = require('../db');

function moduli() {
  const out = [];
  for (const m of db.prepare('SELECT slug, name FROM modules WHERE installed = 1 AND support_module = 0 AND slug != ? ORDER BY group_order, sort_order, id').all('dashboard')) {
    const r = db.prepare('SELECT schema_json FROM modules WHERE slug = ?').get(m.slug); let s; try { s = JSON.parse(r.schema_json || '{}'); } catch (e) { s = {}; }
    const steps = Array.isArray(s.steps) ? s.steps : [];
    if (!steps.some((b) => b.block_type === 'field')) continue;
    out.push({ slug: m.slug, nome: m.name, stati: steps.filter((b) => b.block_type === 'workflow_state'), scadenza: (steps.find((b) => b.block_type === 'field' && b.type === 'date' && /scad/i.test(b.key)) || {}).key });
  }
  return out;
}

// Quali riquadri creerebbe (senza scrivere): serve alla prova e all'anteprima.
function piano() {
  const mods = moduli(); const w = [{ type: 'agenda', label: 'Da fare', aggregation: 'count' }];
  for (const m of mods.slice(0, 3)) w.push({ type: 'kpi', module_slug: m.slug, aggregation: 'count', label: m.nome });
  for (const m of mods.filter((x) => x.stati.length > 1).slice(0, 3)) w.push({ type: 'percorso', module_slug: m.slug, aggregation: 'count', label: 'Percorso: ' + m.nome });
  const voci = mods.filter((m) => m.scadenza).map((m) => ({ etichetta: m.nome.toLowerCase() + ' scaduti', modulo: m.slug, filtri: [{ campo: m.scadenza, op: 'scaduto' }], tono: 'errore' }));
  if (voci.length) w.push({ type: 'segnali', label: 'Da sistemare', aggregation: 'count', config: { voci: voci.slice(0, 8) } });
  return w;
}

function crea({ soloSeVuota = true } = {}) {
  const esistenti = db.prepare("SELECT COUNT(*) n FROM dashboard_widgets WHERE page = 'dashboard'").get().n;
  if (soloSeVuota && esistenti > 0) return { creati: 0, saltata: true };
  const ins = db.prepare("INSERT INTO dashboard_widgets (type, module_slug, field, aggregation, label, color, sort_order, config, roles, user_ids, page) VALUES (?, ?, NULL, ?, ?, '#2563EB', ?, ?, '[]', '[]', 'dashboard')");
  let ordine = (db.prepare("SELECT MAX(sort_order) m FROM dashboard_widgets WHERE page = 'dashboard'").get().m);
  ordine = ordine == null ? -1 : ordine;
  const w = piano();
  db.transaction(() => { for (const x of w) ins.run(x.type, x.module_slug || null, x.aggregation || 'count', x.label, ++ordine, JSON.stringify(x.config || {})); })();
  return { creati: w.length, riquadri: w.map((x) => x.label) };
}

module.exports = { piano, crea };
