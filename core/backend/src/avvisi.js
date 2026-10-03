// Avvisi WhatsApp di un modulo quando arriva una riga nello stato "nuovo" (es. una bolletta da Gmail in "da smistare").
// Quando avvisare, che cosa conta come "nuovo", come si chiamano le righe e a quale tag vanno i destinatari lo dichiara il modulo
// (Builder → Avvisi, vedi module-roles.js). Stesso canale e stessi destinatari del riepilogo del mattino. Mai un errore verso il chiamante.
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

module.exports = { buildNuovaRiga, notifyNuovaRiga };
