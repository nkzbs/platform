// Avvisi WhatsApp di un modulo quando arriva una riga nello stato "nuovo" (es. una bolletta da Gmail in "da smistare").
// Quando avvisare, che cosa conta come "nuovo", come si chiamano le righe e a quale tag vanno i destinatari lo dichiara il modulo
// (Builder → Avvisi, vedi module-roles.js). Stesso canale e stessi destinatari dei report su WhatsApp (reports.js). Mai un errore verso il chiamante.
const db = require('./db');
const whatsapp = require('./whatsapp');
const moduleRoles = require('./module-roles');

const humanize = (v) => String(v || '').replace(/_/g, ' ').trim().toLowerCase();
const cap = (v) => String(v || '').charAt(0).toUpperCase() + String(v || '').slice(1);
const fmtEur = (n) => Number(n).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';

// Testo dell'avviso per una riga di un modulo; null se il modulo non avvisa per questa riga.
function buildNuovaRiga(slug, data) {
  const m = moduleRoles.get(slug);
  if (!m || !m.avvisi.nuovo || !m.avvisi.states.nuovo) return null;
  const R = m.roles;
  if (data[R.stato || '_stato'] !== m.avvisi.states.nuovo) return null;
  const parti = [cap(m.avvisi.noun_s) + ' ' + humanize(m.avvisi.states.nuovo) + ': ' + String(data[R.descrizione || 'descrizione'] || '(senza descrizione)').trim()];
  const imp = Number(data[R.importo || 'importo']);
  if (imp > 0) parti.push(fmtEur(imp));
  const scad = data[R.scadenza || 'scadenza'];
  if (scad) parti.push('scade ' + String(scad).split('-').reverse().join('/'));
  return { text: parti.join(' · '), tag: m.avvisi.tag };
}

async function notifyNuovaRiga(slug, data) {
  try {
    if (!require('./features').isEnabled('whatsapp')) return { skipped: 'whatsapp non attivo' };
    const msg = buildNuovaRiga(slug, data);
    if (!msg) return { skipped: 'il modulo non avvisa' };
    const row = db.prepare("SELECT credentials FROM connections WHERE integration_id = 'whatsapp_callmebot'").get();
    let creds = null; try { creds = row && row.credentials ? JSON.parse(row.credentials) : null; } catch (e) { /* illeggibili */ }
    if (!creds || !creds.api_key) return { skipped: 'whatsapp non collegato' };
    const dest = require('./notification-settings').recipientsForTag(msg.tag);
    if (!dest.length) return { skipped: 'nessun destinatario' };
    const out = await whatsapp.sendAll({ destinatari: dest, testo: msg.text, apiKey: creds.api_key, kind: 'avviso' });
    try { db.prepare("INSERT INTO automation_logs (module_slug, automation_label, trigger_desc, action_desc, esito) VALUES (?, 'Avviso nuova riga', 'nuova riga', ?, ?)").run(slug, String(out.dettaglio || '').slice(0, 400), out.esito); } catch (e) { /* mai bloccare */ }
    return out;
  } catch (e) {
    console.error('[avvisi]', e.message);
    return { error: e.message };
  }
}

// ── Controllo unico delle righe nuove ───────────────────────────────────────────
// Ogni minuto: le righe che sono nello stato "nuovo" di un modulo con l'avviso acceso e non ancora segnalate partono in un messaggio. Vale per
// qualunque via di creazione (mail Gmail, riga creata a mano, automazione, importazione), non solo per una. Alla prima volta le righe già
// presenti si segnano come viste senza avvisare (niente raffica sulle vecchie). Più righe nuove dello stesso modulo = un solo messaggio.
let ready = false;
function ensure() {
  if (ready) return;
  db.exec('CREATE TABLE IF NOT EXISTS avvisi_notificati (module_slug TEXT NOT NULL, record_id INTEGER NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (module_slug, record_id))');
  db.exec('CREATE TABLE IF NOT EXISTS avvisi_meta (k TEXT PRIMARY KEY, v TEXT)');
  ready = true;
}

async function scanNuove() {
  ensure();
  const mods = moduleRoles.list({}).filter((m) => m.avvisi.nuovo && m.avvisi.states.nuovo);
  const first = !db.prepare("SELECT 1 FROM avvisi_meta WHERE k = 'baseline'").get();
  const mark = db.prepare('INSERT OR IGNORE INTO avvisi_notificati (module_slug, record_id) VALUES (?, ?)');
  const groups = [];
  for (const m of mods) {
    const rows = db.prepare("SELECT id, data FROM records WHERE module_slug = ? AND json_extract(data, ?) = ? AND id NOT IN (SELECT record_id FROM avvisi_notificati WHERE module_slug = ?) ORDER BY id")
      .all(m.module_slug, '$.' + (m.roles.stato || '_stato'), m.avvisi.states.nuovo, m.module_slug);
    if (!rows.length) continue;
    for (const r of rows) mark.run(m.module_slug, r.id);
    if (!first) groups.push({ m, rows: rows.map((r) => ({ id: r.id, data: JSON.parse(r.data) })) });
  }
  if (first) { db.prepare("INSERT OR REPLACE INTO avvisi_meta (k, v) VALUES ('baseline', ?)").run(new Date().toISOString()); return { baseline: true }; }
  const sent = [];
  for (const { m, rows } of groups) {
    if (rows.length === 1) { sent.push(await notifyNuovaRiga(m.module_slug, rows[0].data)); continue; }
    const R = m.roles, A = m.avvisi;
    const righe = rows.slice(0, 4).map((r) => '• ' + String(r.data[R.descrizione || 'descrizione'] || '(senza descrizione)').trim() + (Number(r.data[R.importo || 'importo']) > 0 ? ' ' + fmtEur(Number(r.data[R.importo || 'importo'])) : ''));
    if (rows.length > 4) righe.push('… e altre ' + (rows.length - 4));
    sent.push(await sendText(m.avvisi.tag, rows.length + ' ' + A.noun_p + ' ' + humanize(A.states.nuovo) + ':\n' + righe.join('\n')));
  }
  return { sent };
}

// Invio di un testo ai destinatari di un tag (stesso canale, stesso registro). Mai un errore verso il chiamante.
async function sendText(tag, testo, kind = 'avviso') {
  try {
    if (!require('./features').isEnabled('whatsapp')) return { skipped: 'whatsapp non attivo' };
    const row = db.prepare("SELECT credentials FROM connections WHERE integration_id = 'whatsapp_callmebot'").get();
    let creds = null; try { creds = row && row.credentials ? JSON.parse(row.credentials) : null; } catch (e) { /* illeggibili */ }
    if (!creds || !creds.api_key) return { skipped: 'whatsapp non collegato' };
    const dest = require('./notification-settings').recipientsForTag(tag);
    if (!dest.length) return { skipped: 'nessun destinatario' };
    return await whatsapp.sendAll({ destinatari: dest, testo, apiKey: creds.api_key, kind });
  } catch (e) { console.error('[avvisi]', e.message); return { error: e.message }; }
}

let scanning = false;
function startAvvisi() {
  setInterval(async () => {
    if (scanning) return;
    scanning = true;
    try { await scanNuove(); } catch (e) { console.error('[avvisi] controllo fallito:', e.message); } finally { scanning = false; }
  }, 60 * 1000);
}

module.exports = { buildNuovaRiga, notifyNuovaRiga, scanNuove, sendText, startAvvisi };
