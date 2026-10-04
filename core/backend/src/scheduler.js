'use strict';
// ─── SCHEDULER TRIGGER TEMPORALE ─────────────────────────────────────────────
// Controlla ogni minuto tutte le automazioni con trigger.evento === 'schedulato'
// e le esegue se la schedulazione lo richiede. Non usa una libreria cron esterna
// (nessuna dipendenza aggiunta) — confronto semplice sull'ora/giorno UTC.
//
// Formato trigger.schedulazione:
//   { tipo: 'giornaliero', ora: 8 }                      — ogni giorno alle 08:xx UTC
//   { tipo: 'mensile', giorno: 27, ora: 6 }              — ogni mese il giorno 27
//   { tipo: 'ogni_N_giorni', giorni: 30, ora: 8 }        — ogni N giorni (dalla prima run)
//
// Formato azione crea_record (kind: 'action', target: '__interno__', azione: 'crea_record'):
//   { config: { modulo: 'slug', dati: { campo: 'valore', ... } } }
// I valori in dati possono essere stringhe letterali o 'campo:XXX' per copiare
// il valore di XXX dal record che ha scatenato il trigger (se disponibile).
//
// Filtro per trigger.modalita === 'per_record' — token speciali per f.valore:
//   '_oggi_'       — data di oggi (YYYY-MM-DD)
//   '_ore_fa:N'    — timestamp di N ore fa (per confronti su '_creato_at')
// '_creato_at' è un campo di sistema iniettato automaticamente in ogni record
// scansionato (records.created_at) — filtrabile come qualunque altro campo, utile
// per promemoria tipo "creato da più di 24 ore e ancora in un certo stato" senza
// dover aggiungere una data dedicata ad ogni modulo.

const db = require('./db');
const { getAutomationSteps, parseSchemaNormalized } = require('./schema-v3');
const { logAudit } = require('./audit-log');
const { runAzioni, compare } = require('./automation-engine');
const { attachComputedFields } = require('./computed-fields');
const { withLock } = require('./scheduler-lock');

function getModuleSchema(slug) {
  const mod = db.prepare('SELECT schema_json FROM modules WHERE slug = ?').get(slug);
  if (!mod) return null;
  return parseSchemaNormalized(mod.schema_json);
}

function getLastRun(moduleSlug, automationId) {
  const row = db.prepare('SELECT last_run_at FROM scheduled_runs WHERE module_slug = ? AND automation_id = ?').get(moduleSlug, automationId);
  return row ? new Date(row.last_run_at) : null;
}

function setLastRun(moduleSlug, automationId, at) {
  db.prepare('INSERT INTO scheduled_runs (module_slug, automation_id, last_run_at) VALUES (?, ?, ?) ON CONFLICT(module_slug, automation_id) DO UPDATE SET last_run_at = excluded.last_run_at').run(moduleSlug, automationId, at.toISOString());
}

function shouldRun(sched, lastRun, now) {
  if (!sched || !sched.tipo) return false;
  const ora = sched.ora !== undefined ? sched.ora : 0;

  if (sched.tipo === 'giornaliero') {
    if (now.getUTCHours() !== ora) return false;
    if (!lastRun) return true;
    const lastDay = lastRun.toISOString().slice(0, 10);
    const today = now.toISOString().slice(0, 10);
    return lastDay < today;
  }

  if (sched.tipo === 'mensile') {
    const giorno = sched.giorno || 1;
    if (now.getUTCDate() !== giorno) return false;
    if (now.getUTCHours() !== ora) return false;
    if (!lastRun) return true;
    const lastMonth = lastRun.toISOString().slice(0, 7);
    const thisMonth = now.toISOString().slice(0, 7);
    return lastMonth < thisMonth;
  }

  if (sched.tipo === 'ogni_N_giorni') {
    const giorni = sched.giorni || 1;
    if (now.getUTCHours() !== ora) return false;
    if (!lastRun) return true;
    const diffMs = now.getTime() - lastRun.getTime();
    return diffMs >= giorni * 86400 * 1000;
  }

  return false;
}

// SQLite scrive CURRENT_TIMESTAMP come 'YYYY-MM-DD HH:MM:SS' (UTC, senza 'T' né
// millisecondi) — il confronto testuale con un valore calcolato deve essere nello
// STESSO formato, altrimenti lo spazio (' ', minore di 'T' in ASCII) rompe
// silenziosamente l'ordinamento lessicografico contro un ISO string normale.
function sqliteDatetime(d) {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

// Stesso trattamento speciale di null/undefined già usato in automation-engine.js per
// filtri: un valore null nel filtro significa "campo vuoto/non impostato",
// non un confronto letterale (che con compare() darebbe sempre false). '_ore_fa:N' è
// un secondo token speciale (oltre a '_oggi_'): si risolve a "adesso meno N ore", nello
// stesso formato di records.created_at — usato per filtri tipo "creato da più di 24 ore
// e ancora in un certo stato" (promemoria), non serve un campo dedicato per ogni caso.
// '_giorno_oggi_': confronta un campo numerico (es. 'giorno_mese' di un ricorrente) col
// giorno del mese corrente — a differenza degli altri token sopra, il confronto non è
// una semplice uguaglianza testuale: un ricorrente impostato al 31 in un mese da 30
// giorni (o a febbraio) deve scattare comunque l'ultimo giorno disponibile di quel mese,
// non restare silenzioso finché non ricapita un mese abbastanza lungo. Per questo è un
// ramo a parte invece di risolversi a un valore letterale passato a compare() sotto.
function matchesGiornoOggi(d, f) {
  const giornoRecord = parseInt(d[f.campo], 10)
  if (isNaN(giornoRecord)) return false
  const oggi = new Date()
  const giorno = oggi.getUTCDate()
  const ultimoGiornoMese = new Date(Date.UTC(oggi.getUTCFullYear(), oggi.getUTCMonth() + 1, 0)).getUTCDate()
  const giornoEffettivo = Math.min(giornoRecord, ultimoGiornoMese)
  const match = giornoEffettivo === giorno
  return f.op === '!=' ? !match : match
}

function matchesFiltro(d, f) {
  let valore = f.valore
  if (valore === '_giorno_oggi_') return matchesGiornoOggi(d, f)
  if (valore === '_oggi_') valore = new Date().toISOString().slice(0, 10)
  else if (typeof valore === 'string' && /^_ore_fa:\d+$/.test(valore)) {
    const ore = parseInt(valore.split(':')[1], 10)
    valore = sqliteDatetime(new Date(Date.now() - ore * 3600 * 1000))
  }
  if (valore === null || valore === undefined) {
    const vuoto = d[f.campo] === undefined || d[f.campo] === null || d[f.campo] === '';
    return f.op === '!=' ? !vuoto : vuoto;
  }
  return compare(d[f.campo], f.op, valore);
}

// Esegue le azioni di un'automazione schedulata riusando runAzioni di
// automation-engine.js (condizioni, aggiorna_record, crea_record,
// ecc. — tutto il ventaglio, non più una whitelist ridotta come prima) — invece di
// duplicare la logica di esecuzione qui con un sottoinsieme limitato di azioni.
//
// Due modalità:
// - normale (default): esegue una volta sola, senza un record specifico come contesto
//   — adatta ad automazioni che aggregano l'intero modulo (es. ammortamenti mensili).
// - 'per_record' (trigger.modalita + trigger.filtro): itera tutti i record DEL MODULO
//   CHE OSPITA L'AUTOMAZIONE che soddisfano il filtro, ed esegue le azioni una volta
//   per record, con quel record come contesto (recordData/recordId) — come se ogni
//   record scatenasse il trigger individualmente. Serve per scansioni periodiche tipo
//   "crea un insoluto per ogni fattura scaduta non ancora marcata".
function eseguiAutomazioneSchedulata(mod, auto) {
  const triggerDesc = 'schedulato';
  if (auto.trigger.modalita === 'per_record') {
    const filtro = auto.trigger.filtro || [];
    const tutti = db.prepare('SELECT id, data, created_at FROM records WHERE module_slug = ?').all(mod.slug);
    const parseConCreatoAt = (r) => {
      let d;
      try { d = JSON.parse(r.data || '{}'); } catch { return null; }
      // '_creato_at' non è mai nella colonna 'data' (è un campo di sistema della
      // tabella records) — iniettato qui così il filtro/le azioni possono usarlo
      // come qualunque altro campo (es. "creato da più di N ore" per un promemoria),
      // senza dover duplicare la data di creazione dentro ogni modulo a mano.
      d._creato_at = r.created_at;
      return d;
    };
    const matched = tutti.filter((r) => {
      const d = parseConCreatoAt(r);
      return d && filtro.every((f) => matchesFiltro(d, f));
    });
    const schema = getModuleSchema(mod.slug);
    matched.forEach((r) => {
      const d = parseConCreatoAt(r);
      if (!d) return;
      // Come fireNuovoRecordCascata/fireModificaCampoCascata in automation-engine.js:
      // i campi computed non sono mai nella colonna grezza, vanno ricalcolati prima di
      // passare il record alle azioni (es. un importo derivato da altri campi propri).
      const attached = schema ? attachComputedFields(db, { id: r.id, data: d }, schema, mod.slug) : { data: d };
      runAzioni(auto.azioni, attached.data, mod.slug, auto.label || 'Automazione', r.id, { triggerDesc });
    });
    console.log(`scheduler: "${auto.label || auto.id}" su ${mod.slug} — ${matched.length} record processati`);
  } else {
    runAzioni(auto.azioni, {}, mod.slug, auto.label || 'Automazione', null, { triggerDesc });
  }
}

function runScheduledAutomations() {
  const now = new Date();
  try {
    const modules = db.prepare('SELECT slug, schema_json FROM modules WHERE installed = 1').all();
    modules.forEach((mod) => {
      const automations = getAutomationSteps(mod.schema_json);
      automations.forEach((auto) => {
        if (auto.enabled === false) return;
        if (!auto.trigger || auto.trigger.evento !== 'schedulato') return;
        if (!auto.id) return;
        const lastRun = getLastRun(mod.slug, auto.id);
        if (!shouldRun(auto.trigger.schedulazione, lastRun, now)) return;

        setLastRun(mod.slug, auto.id, now);
        console.log(`scheduler: eseguo "${auto.label || auto.id}" su ${mod.slug}`);
        eseguiAutomazioneSchedulata(mod, auto);
      });
    });
  } catch (e) {
    console.error('scheduler: errore nel ciclo:', e.message);
  }
}

// G14 (PLATFORM-0.6-GAP-ANALYSIS.md) — lock distribuito (no-op senza Redis,
// comportamento invariato oggi con un processo per tenant): impedisce a due
// repliche di eseguire lo stesso tick in sovrapposizione. TTL 55s, appena sotto
// l'intervallo di 60s tra un tick e il successivo.
const guardedRun = withLock('automations', 55 * 1000, runScheduledAutomations);

function startScheduler() {
  guardedRun();
  setInterval(guardedRun, 60 * 1000);
  console.log('Scheduler trigger temporale avviato (intervallo: 1 min)');
}

module.exports = { startScheduler };
