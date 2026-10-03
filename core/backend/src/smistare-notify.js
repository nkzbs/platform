// Avviso WhatsApp quando una riga arriva in "da smistare" (es. bolletta da Gmail).
// Stesso canale e stessi destinatari del riepilogo del mattino. Mai un errore verso il chiamante.
const db = require('./db');
const whatsapp = require('./whatsapp');

const TAG = 'scadenza';

async function notifyDaSmistare({ descrizione, importo, scadenza }) {
  try {
    if (!require('./features').isEnabled('whatsapp')) return { skipped: 'whatsapp non attivo' };
    const row = db.prepare("SELECT credentials FROM connections WHERE integration_id = 'whatsapp_callmebot'").get();
    let creds = null; try { creds = row && row.credentials ? JSON.parse(row.credentials) : null; } catch (e) { /* illeggibili */ }
    if (!creds || !creds.api_key) return { skipped: 'whatsapp non collegato' };
    const dest = require('./notification-settings').recipientsForTag(TAG);
    if (!dest.length) return { skipped: 'nessun destinatario' };
    const parti = ['Nuova riga da smistare: ' + descrizione];
    if (Number(importo) > 0) parti.push(Number(importo).toFixed(2).replace('.', ',') + ' €');
    if (scadenza) parti.push('scade ' + scadenza.split('-').reverse().join('/'));
    const out = await whatsapp.sendAll({ destinatari: dest, testo: parti.join(' · '), apiKey: creds.api_key });
    try { db.prepare("INSERT INTO automation_logs (module_slug, automation_label, trigger_desc, action_desc, esito) VALUES ('sistema', 'Avviso da smistare', 'nuova riga da smistare', ?, ?)").run(String(out.dettaglio || '').slice(0, 400), out.esito); } catch (e) { /* mai bloccare */ }
    return out;
  } catch (e) {
    console.error('[smistare-notify]', e.message);
    return { error: e.message };
  }
}

module.exports = { notifyDaSmistare };
