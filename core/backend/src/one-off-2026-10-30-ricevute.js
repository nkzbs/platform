'use strict';
// Una tantum, 30/10/2026: Nima ha caricato centinaia di bollette/ricevute su
// Drive (già importate in Documenti dal poller). Due pezzi, entrambi
// idempotenti (si disattivano da soli dopo il primo giro riuscito):
//
// 1) ~200 file della cartella "ricevute" sono finiti sotto "Altro" invece di
//    "Ricevuta di pagamento" (il nome della sottocartella Drive non
//    combaciava con nessuna opzione esistente). Li sposta nella categoria
//    giusta.
// 2) Aggiunge a Spese Casa/Spese Personali una relazione verso Documenti
//    ("Ricevuta/Bolletta collegata") — oggi non esiste alcun modo di
//    agganciare una spesa al suo allegato. Il collegamento vero e proprio
//    (quale spesa per quale ricevuta) resta da fare in un giro separato,
//    che legge l'importo reale dai PDF via AI: costa budget AI per
//    documento, va deciso/lanciato esplicitamente, non parte da qui.
//
// Scoped a questo tenant (nomi di modulo reali, non primitive generiche):
// un tenant senza questi moduli esce subito, nessun effetto.
const db = require('./db');

async function recategorizzaRicevute() {
  const mod = db.prepare("SELECT * FROM modules WHERE slug = 'documenti' AND installed = 1").get();
  if (!mod) return 0;
  const righe = db.prepare("SELECT id, data FROM records WHERE module_slug = 'documenti' AND created_at >= '2026-10-30' AND created_at < '2026-10-31'").all();
  const daSpostare = righe.filter((r) => { try { return JSON.parse(r.data).tipo === 'Altro'; } catch (e) { return false; } });
  if (!daSpostare.length) return 0;
  const { callAs } = require('./lib/internal-api');
  const admin = db.prepare("SELECT * FROM users WHERE role = 'admin' LIMIT 1").get();
  if (!admin) return 0;
  let fatti = 0;
  for (const r of daSpostare) {
    const data = JSON.parse(r.data);
    try {
      const resu = await callAs(admin, 'PUT', '/records/documenti/' + r.id, { ...data, tipo: 'Ricevuta di pagamento' });
      if (resu.ok) fatti++; else console.error('[one-off-ricevute] record', r.id, 'non ricategorizzato:', JSON.stringify(resu.data));
    } catch (e) { console.error('[one-off-ricevute] record', r.id, 'non ricategorizzato:', e.message); }
  }
  return fatti;
}

async function aggiungiRelazioneDocumento(slug) {
  const { parseSchemaNormalized } = require('./schema-v3');
  const mod = db.prepare('SELECT * FROM modules WHERE slug = ? AND installed = 1').get(slug);
  const docMod = db.prepare("SELECT 1 FROM modules WHERE slug = 'documenti' AND installed = 1").get();
  if (!mod || !docMod) return false;
  const schema = parseSchemaNormalized(mod.schema_json);
  if ((schema.relations || []).some((r) => r.key === 'documento_collegato')) return false; // già fatto
  schema.relations = [...(schema.relations || []), { key: 'documento_collegato', label: 'Ricevuta/Bolletta collegata', type: 'many_to_one', target_module: 'documenti' }];
  const { callAs } = require('./lib/internal-api');
  const admin = db.prepare("SELECT * FROM users WHERE role = 'admin' LIMIT 1").get();
  if (!admin) return false;
  const draft = await callAs(admin, 'PUT', '/builder/' + slug + '/draft', { schema });
  if (!draft.ok) { console.error('[one-off-ricevute] draft', slug, 'fallito:', JSON.stringify(draft.data)); return false; }
  const pub = await callAs(admin, 'POST', '/builder/' + slug + '/publish', {});
  if (!pub.ok) { console.error('[one-off-ricevute] publish', slug, 'fallito:', JSON.stringify(pub.data)); return false; }
  return true;
}

async function run() {
  try {
    const spostati = await recategorizzaRicevute();
    if (spostati) console.log('[one-off-ricevute] ' + spostati + ' documenti spostati da "Altro" a "Ricevuta di pagamento"');
  } catch (e) { console.error('[one-off-ricevute] recategorizzazione fallita:', e.message); }
  for (const slug of ['spese_casa', 'spese_personali']) {
    try {
      const fatto = await aggiungiRelazioneDocumento(slug);
      if (fatto) console.log('[one-off-ricevute] relazione "documento_collegato" aggiunta a ' + slug);
    } catch (e) { console.error('[one-off-ricevute] relazione su', slug, 'fallita:', e.message); }
  }
}

module.exports = { run };
